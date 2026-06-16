#!/usr/bin/env python3
"""Render ASCII output using the exact glyph screenshots used by Asciify."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Iterable

import numpy as np
from PIL import Image

from asciify_mk2 import load_glyphs, load_layout_advances, render_text_line


def render_preview(
    text_path: Path,
    output_path: Path,
    glyph_dir: Path,
    glyph_manifest: Path | None,
    layout_model: Path | None,
    line_width: int,
    add_synthetic_space: bool,
    synthetic_space_width: int | None,
) -> Image.Image:
    glyphs = load_glyphs(
        glyph_dir=glyph_dir,
        manifest_path=glyph_manifest,
        add_synthetic_space=add_synthetic_space,
        synthetic_space_width=synthetic_space_width,
    )
    glyphs_by_char = {glyph.char: glyph for glyph in glyphs}
    advances, pair_advances = load_layout_advances(layout_model)
    lines = text_path.read_text().splitlines()
    if not lines:
        raise ValueError(f"No lines found in {text_path}")

    unknown = sorted({char for line in lines for char in line if char not in glyphs_by_char})
    if unknown:
        raise ValueError(f"Text contains characters missing from the glyph set: {unknown!r}")

    rendered_lines = [
        render_text_line(line, glyphs_by_char, line_width, advances, pair_advances)
        for line in lines
    ]
    pixels = np.vstack(rendered_lines)
    image = Image.fromarray(np.clip(pixels * 255.0, 0, 255).astype(np.uint8))
    output_path.parent.mkdir(parents=True, exist_ok=True)
    image.save(output_path)
    return image


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Concatenate Asciify glyph screenshots into an exact diagnostic preview."
    )
    parser.add_argument("text", type=Path, help="ASCII text output to reconstruct.")
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="Asciify JSON report used to infer glyph settings and line width.",
    )
    parser.add_argument("--glyph-dir", type=Path, default=None)
    parser.add_argument("--glyph-manifest", type=Path, default=None)
    parser.add_argument("--layout-model", type=Path, default=None)
    parser.add_argument("--line-width", type=int, default=None)
    parser.add_argument("--synthetic-space-width", type=int, default=None)
    parser.add_argument("--no-synthetic-space", action="store_true")
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("output/glyph_preview.png"),
    )
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    report = json.loads(args.report.read_text()) if args.report else {}

    line_width = args.line_width or report.get("line_width")
    if not line_width:
        raise ValueError("Provide --line-width or --report with a line_width value.")

    glyph_dir = args.glyph_dir
    if glyph_dir is None and report.get("glyph_dir"):
        glyph_dir = Path(report["glyph_dir"])
    if glyph_dir is None:
        raise ValueError("Provide --glyph-dir or --report containing glyph_dir.")

    glyph_manifest = args.glyph_manifest
    if glyph_manifest is None and report.get("glyph_manifest"):
        glyph_manifest = Path(report["glyph_manifest"])

    layout_model = args.layout_model
    if layout_model is None and report.get("layout_model"):
        layout_model = Path(report["layout_model"])

    image = render_preview(
        text_path=args.text,
        output_path=args.output,
        glyph_dir=glyph_dir,
        glyph_manifest=glyph_manifest,
        layout_model=layout_model,
        line_width=line_width,
        add_synthetic_space=not args.no_synthetic_space,
        synthetic_space_width=args.synthetic_space_width,
    )
    print(f"Wrote {args.output} ({image.width}x{image.height})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
