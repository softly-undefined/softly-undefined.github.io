#!/usr/bin/env python3
"""Extract Google Docs glyph metrics and raster cells from a calibration PDF."""

from __future__ import annotations

import argparse
import json
import statistics
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import fitz
from PIL import Image

from generate_calibration_text import PRINTABLE_NONSPACE, calibration_lines


DEFAULT_SCALE = 4.0
REFERENCE_FONT_SIZE = 11.0


@dataclass(frozen=True)
class PdfLine:
    page_number: int
    chars: list[dict[str, Any]]
    segment_starts: frozenset[int] = frozenset()

    @property
    def text(self) -> str:
        return "".join(char["c"] for char in self.chars)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    base = Path(__file__).resolve().parent
    parser.add_argument(
        "--pdf", type=Path, default=base / "calibration-pdfs" / "calibration-11.pdf"
    )
    parser.add_argument("--output-dir", type=Path, default=base / "calibration-models" / "11")
    parser.add_argument("--scale", type=float, default=DEFAULT_SCALE)
    parser.add_argument("--fallback-model", type=Path, default=None)
    return parser.parse_args()


def pdf_lines(document: fitz.Document) -> list[PdfLine]:
    result: list[PdfLine] = []
    for page_number, page in enumerate(document):
        raw = page.get_text("rawdict")
        for block in raw["blocks"]:
            for line in block.get("lines", []):
                chars: list[dict[str, Any]] = []
                for span in line["spans"]:
                    chars.extend(span.get("chars", []))
                if chars:
                    result.append(PdfLine(page_number, chars))
    return result


def align_lines(document: fitz.Document) -> tuple[list[str], list[PdfLine]]:
    expected = calibration_lines()
    extracted = pdf_lines(document)
    aligned: list[PdfLine] = []
    cursor = 0

    for expected_text in expected:
        if cursor >= len(extracted):
            raise ValueError(f"Could not find expected calibration line: {expected_text!r}")

        candidate = extracted[cursor]
        if candidate.text[: len(expected_text)] == expected_text:
            aligned.append(PdfLine(candidate.page_number, candidate.chars[: len(expected_text)]))
            cursor += 1
            continue

        chars: list[dict[str, Any]] = []
        segment_starts: set[int] = set()
        while cursor < len(extracted) and len(chars) < len(expected_text):
            physical = extracted[cursor]
            cursor += 1
            fragment_text = physical.text.rstrip()
            if chars:
                segment_starts.add(len(chars))
            chars.extend(physical.chars[: len(fragment_text)])
            actual = "".join(char["c"] for char in chars)
            if not expected_text.startswith(actual):
                raise ValueError(
                    f"Could not align wrapped calibration line: {expected_text!r}"
                )
        if "".join(char["c"] for char in chars) != expected_text:
            raise ValueError(f"Could not find expected calibration line: {expected_text!r}")
        aligned.append(PdfLine(candidate.page_number, chars, frozenset(segment_starts)))

    return expected, aligned


def document_font(document: fitz.Document) -> tuple[str, float]:
    fonts: set[str] = set()
    sizes: set[float] = set()
    for page in document:
        for block in page.get_text("rawdict")["blocks"]:
            for line in block.get("lines", []):
                for span in line["spans"]:
                    if span.get("chars"):
                        fonts.add(span["font"])
                        sizes.add(round(float(span["size"]), 5))
    if len(fonts) != 1 or len(sizes) != 1:
        raise ValueError(f"Expected one font and size, found fonts={fonts}, sizes={sizes}.")
    return fonts.pop(), sizes.pop()


def median_origin_differences(chars: list[dict[str, Any]]) -> float:
    differences = [
        right["origin"][0] - left["origin"][0]
        for left, right in zip(chars, chars[1:])
    ]
    if not differences:
        raise ValueError("At least two characters are required to measure an advance.")
    return statistics.median(differences)


def extract_metrics(
    expected: list[str],
    lines: list[PdfLine],
    font_name: str,
    font_size: float,
    fallback_model: dict[str, Any] | None,
) -> tuple[dict[str, Any], dict[str, tuple[int, dict[str, Any]]]]:
    line_index = {text: index for index, text in enumerate(expected)}

    line_height_rows = lines[
        line_index["BLOCK_LINE_HEIGHT_START"] + 1 : line_index["BLOCK_LINE_HEIGHT_END"]
    ]
    baselines = [line.chars[0]["origin"][1] for line in line_height_rows]
    line_height = statistics.median(
        lower - upper for upper, lower in zip(baselines, baselines[1:])
    )

    single_start = line_index["BLOCK_SINGLE_ADVANCE_START"] + 1
    advances: dict[str, float] = {}
    samples: dict[str, tuple[int, dict[str, Any]]] = {}
    for offset, char in enumerate(PRINTABLE_NONSPACE):
        line = lines[single_start + offset]
        advances[char] = median_origin_differences(line.chars)
        samples[char] = (line.page_number, line.chars[0])

    space_differences: list[float] = []
    for line in lines[
        line_index["BLOCK_SPACE_START"] + 1 : line_index["BLOCK_SPACE_END"]
    ]:
        for left, right in zip(line.chars, line.chars[1:]):
            if left["c"] == " ":
                space_differences.append(right["origin"][0] - left["origin"][0])
    advances[" "] = statistics.median(space_differences)

    pair_adjustments: dict[str, float] = {}
    pair_advances: dict[str, float] = {}
    for index in range(
        line_index["BLOCK_PAIR_KERNING_START"] + 1,
        line_index["BLOCK_PAIR_KERNING_END"],
    ):
        line = lines[index]
        for position, (left, right) in enumerate(zip(line.chars, line.chars[1:]), 1):
            if position in line.segment_starts:
                continue
            pair = left["c"] + right["c"]
            pair_advance = right["origin"][0] - left["origin"][0]
            pair_advances[pair] = pair_advance
            pair_adjustments[pair] = pair_advance - advances[left["c"]]

    expected_pairs = {
        left + right for left in PRINTABLE_NONSPACE for right in PRINTABLE_NONSPACE
    }
    measured_pairs = set(pair_adjustments)
    missing_pairs = expected_pairs - measured_pairs
    if missing_pairs and fallback_model is None:
        raise ValueError(
            f"Missing {len(missing_pairs)} wrapped-boundary pairs; provide --fallback-model."
        )
    if fallback_model is not None:
        ratio = font_size / float(fallback_model["font"]["size_points"])
        for pair in missing_pairs:
            adjustment = float(fallback_model["pair_adjustments_points"][pair]) * ratio
            pair_adjustments[pair] = adjustment
            pair_advances[pair] = advances[pair[0]] + adjustment

    first_sample = samples[PRINTABLE_NONSPACE[0]][1]
    bbox_top = first_sample["bbox"][1] - first_sample["origin"][1]
    bbox_bottom = first_sample["bbox"][3] - first_sample["origin"][1]
    bbox_height = bbox_bottom - bbox_top
    extra_leading = line_height - bbox_height
    cell_top = bbox_top - extra_leading / 2

    nonzero_adjustments = {
        pair: adjustment
        for pair, adjustment in pair_adjustments.items()
        if abs(adjustment) > 0.001
    }
    metrics = {
        "format_version": 1,
        "font": {
            "name": font_name,
            "size_points": font_size,
        },
        "line_height_points": line_height,
        "cell_top_relative_to_baseline_points": cell_top,
        "font_bbox_relative_to_baseline_points": {
            "top": bbox_top,
            "bottom": bbox_bottom,
        },
        "space_advance_points": advances[" "],
        "advances_points": advances,
        "pair_adjustments_points": pair_adjustments,
        "pair_advances_points": pair_advances,
        "summary": {
            "character_count": len(advances),
            "pair_count": len(pair_adjustments),
            "measured_pair_count": len(measured_pairs),
            "inferred_pair_count": len(missing_pairs),
            "nonzero_pair_adjustment_count": len(nonzero_adjustments),
            "minimum_advance_points": min(advances.values()),
            "maximum_advance_points": max(advances.values()),
            "minimum_pair_adjustment_points": min(pair_adjustments.values()),
            "maximum_pair_adjustment_points": max(pair_adjustments.values()),
        },
    }
    return metrics, samples


def render_glyphs(
    document: fitz.Document,
    output_dir: Path,
    metrics: dict[str, Any],
    samples: dict[str, tuple[int, dict[str, Any]]],
    scale: float,
) -> dict[str, str]:
    if scale <= 0:
        raise ValueError("--scale must be positive.")

    glyph_dir = output_dir / "glyphs"
    glyph_dir.mkdir(parents=True, exist_ok=True)
    page_images: dict[int, Image.Image] = {}
    line_height = metrics["line_height_points"]
    cell_top = metrics["cell_top_relative_to_baseline_points"]
    height_pixels = round(line_height * scale)
    files: dict[str, str] = {}

    for char in " " + PRINTABLE_NONSPACE:
        filename = f"U+{ord(char):04X}.png"
        files[char] = f"glyphs/{filename}"
        width_pixels = max(1, round(metrics["advances_points"][char] * scale))

        if char == " ":
            glyph = Image.new("L", (width_pixels, height_pixels), 255)
        else:
            page_number, sample = samples[char]
            if page_number not in page_images:
                pixmap = document[page_number].get_pixmap(
                    matrix=fitz.Matrix(scale, scale),
                    colorspace=fitz.csGRAY,
                    alpha=False,
                )
                page_images[page_number] = Image.frombytes(
                    "L", (pixmap.width, pixmap.height), pixmap.samples
                )

            origin_x, baseline_y = sample["origin"]
            left = round(origin_x * scale)
            top = round((baseline_y + cell_top) * scale)
            glyph = page_images[page_number].crop(
                (left, top, left + width_pixels, top + height_pixels)
            )

        glyph.save(glyph_dir / filename)

    return files


def main() -> None:
    args = parse_args()
    args.output_dir.mkdir(parents=True, exist_ok=True)

    with fitz.open(args.pdf) as document:
        font_name, font_size = document_font(document)
        expected, lines = align_lines(document)
        fallback_model = (
            json.loads(args.fallback_model.read_text()) if args.fallback_model else None
        )
        metrics, samples = extract_metrics(
            expected,
            lines,
            font_name=font_name,
            font_size=font_size,
            fallback_model=fallback_model,
        )
        normalized_scale = args.scale * REFERENCE_FONT_SIZE / font_size
        glyph_files = render_glyphs(
            document, args.output_dir, metrics, samples, normalized_scale
        )
        metrics["source"] = {
            "pdf": str(args.pdf),
            "page_count": document.page_count,
            "page_width_points": document[0].rect.width,
            "page_height_points": document[0].rect.height,
        }

    metrics["raster"] = {
        "pixels_per_point": normalized_scale,
        "reference_font_size_points": REFERENCE_FONT_SIZE,
        "height_pixels": round(metrics["line_height_points"] * normalized_scale),
        "glyph_files": glyph_files,
    }
    model_path = args.output_dir / "model.json"
    model_path.write_text(json.dumps(metrics, indent=2, sort_keys=True) + "\n")
    manifest_path = args.output_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(
            {
                "glyphs": [
                    {"char": char, "file": glyph_files[char]}
                    for char in " " + PRINTABLE_NONSPACE
                ]
            },
            indent=2,
        )
        + "\n"
    )

    summary = metrics["summary"]
    print(f"Wrote {model_path}")
    print(f"Wrote {manifest_path}")
    print(f"Wrote {len(glyph_files)} glyph rasters to {args.output_dir / 'glyphs'}")
    print(
        f"Advances: {summary['minimum_advance_points']:.3f}pt to "
        f"{summary['maximum_advance_points']:.3f}pt; "
        f"{summary['nonzero_pair_adjustment_count']} nonzero pair adjustments."
    )
    print(
        f"Pair adjustment range: {summary['minimum_pair_adjustment_points']:.3f}pt to "
        f"{summary['maximum_pair_adjustment_points']:.3f}pt."
    )


if __name__ == "__main__":
    main()
