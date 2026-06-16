#!/usr/bin/env python3
"""
Variable-width ASCII renderer for Google Docs-style text rows.

This version treats every output line as a search problem: choose a variable
width sequence of glyph screenshots whose rendered pixels minimize mean
absolute distance from a horizontal strip of the source image.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import json
import math
import random
import shutil
import subprocess
import sys
import threading
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, Iterable

import numpy as np
from PIL import Image, ImageOps


IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tiff", ".webp"}
SIZE_ONE_LINE_WIDTH = 9019
SIZE_ONE_SAFE_LINE_WIDTH = round(SIZE_ONE_LINE_WIDTH * 0.95)
SIZE_ONE_ACTUAL_POINTS = 2.25

# Legacy custom-capture order. Calibrated runs use explicit manifests.
DEFAULT_CAPTURE_ORDER = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "1234567890"
    "!@#$%^&*()-_+={}[]|\\;\"'?/.,~`"
)


@dataclass(frozen=True)
class Glyph:
    char: str
    pixels: np.ndarray
    width: int
    height: int
    path: str | None = None
    synthetic: bool = False


@dataclass(frozen=True)
class BeamState:
    text: str
    width: float
    error_sum: float


@dataclass(frozen=True)
class LineResult:
    line_index: int
    text: str
    score: float
    distance: float
    rendered_width: int
    char_count: int

    def to_json(self) -> dict[str, Any]:
        return {
            "line_index": self.line_index,
            "score": self.score,
            "distance": self.distance,
            "rendered_width": self.rendered_width,
            "char_count": self.char_count,
            "text": self.text,
        }


@dataclass(frozen=True)
class CandidateEvaluation:
    num_lines: int
    sampled_lines: list[int]
    mean_score: float
    mean_distance: float
    score_per_line: float
    tuning_score: float

    def to_json(self) -> dict[str, Any]:
        return {
            "num_lines": self.num_lines,
            "sampled_lines": self.sampled_lines,
            "mean_score": self.mean_score,
            "mean_distance": self.mean_distance,
            "score_per_line": self.score_per_line,
            "tuning_score": self.tuning_score,
        }


def _composite_on_white(image: Image.Image) -> Image.Image:
    if "A" not in image.getbands():
        return image.convert("L")

    rgba = image.convert("RGBA")
    background = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    background.alpha_composite(rgba)
    return background.convert("L")


def image_to_array(image: Image.Image) -> np.ndarray:
    gray = _composite_on_white(image)
    return np.asarray(gray, dtype=np.float32) / 255.0


def load_image_array(path: Path) -> np.ndarray:
    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        return image_to_array(image)


def vertically_squish_source(source: np.ndarray, factor: float) -> np.ndarray:
    """Compress source content vertically and center it on its original canvas."""
    if not 0.0 < factor <= 1.0:
        raise ValueError("--vertical-squish-factor must be greater than 0 and at most 1.")
    if factor == 1.0:
        return source

    height, width = source.shape
    squished_height = max(1, int(round(height * factor)))
    image = Image.fromarray(np.clip(source * 255.0, 0, 255).astype(np.uint8))
    squished = image.resize((width, squished_height), Image.Resampling.LANCZOS)
    squished_array = np.asarray(squished, dtype=np.float32) / 255.0

    result = np.ones_like(source)
    top = (height - squished_height) // 2
    result[top : top + squished_height, :] = squished_array
    return result


def image_paths(root: Path) -> list[Path]:
    return sorted(
        path for path in root.iterdir() if path.suffix.lower() in IMAGE_EXTS
    )


def decode_char_label(label: str) -> str:
    if label == "space":
        return " "
    if label == "tab":
        return "\t"
    if len(label) == 1:
        return label
    try:
        decoded = label.encode("utf-8").decode("unicode_escape")
    except UnicodeDecodeError:
        decoded = label
    if len(decoded) != 1:
        raise ValueError(f"Character label must decode to exactly one character: {label!r}")
    return decoded


def load_manifest(manifest_path: Path, glyph_dir: Path) -> list[tuple[str, Path]]:
    data = json.loads(manifest_path.read_text())

    if isinstance(data, dict) and "glyphs" in data:
        data = data["glyphs"]

    if isinstance(data, dict) and "order" in data:
        order = data["order"]
        if isinstance(order, list):
            chars = [decode_char_label(str(label)) for label in order]
        else:
            chars = list(str(order))
        paths = image_paths(glyph_dir)
        if len(chars) != len(paths):
            raise ValueError(
                f"Manifest order has {len(chars)} characters, but {glyph_dir} has "
                f"{len(paths)} images."
            )
        return list(zip(chars, paths))

    if isinstance(data, dict):
        return [
            (decode_char_label(char), glyph_dir / str(file_name))
            for char, file_name in data.items()
        ]

    if isinstance(data, list):
        pairs = []
        for item in data:
            if not isinstance(item, dict) or "char" not in item or "file" not in item:
                raise ValueError(
                    "Manifest list entries must be objects with 'char' and 'file'."
                )
            pairs.append((decode_char_label(str(item["char"])), glyph_dir / item["file"]))
        return pairs

    raise ValueError("Unsupported glyph manifest format.")


def load_glyphs(
    glyph_dir: Path,
    manifest_path: Path | None = None,
    add_synthetic_space: bool = True,
    synthetic_space_width: int | None = None,
) -> list[Glyph]:
    if manifest_path:
        char_paths = load_manifest(manifest_path, glyph_dir)
    else:
        paths = image_paths(glyph_dir)
        if len(paths) != len(DEFAULT_CAPTURE_ORDER):
            raise ValueError(
                f"{glyph_dir} has {len(paths)} images, but the built-in order maps "
                f"{len(DEFAULT_CAPTURE_ORDER)} glyphs. Pass --glyph-manifest for a "
                "custom mapping."
            )
        char_paths = list(zip(DEFAULT_CAPTURE_ORDER, paths))

    glyphs: list[Glyph] = []
    expected_height: int | None = None
    for char, path in char_paths:
        if not path.exists():
            raise FileNotFoundError(f"Glyph image not found: {path}")

        pixels = load_image_array(path)
        height, width = pixels.shape
        if expected_height is None:
            expected_height = height
        elif height != expected_height:
            raise ValueError(
                f"All glyphs must have the same height. {path} is {height}px, "
                f"expected {expected_height}px."
            )

        glyphs.append(
            Glyph(
                char=char,
                pixels=pixels,
                width=width,
                height=height,
                path=str(path),
            )
        )

    if not glyphs:
        raise ValueError(f"No glyph images found in {glyph_dir}")

    if add_synthetic_space and all(glyph.char != " " for glyph in glyphs):
        height = glyphs[0].height
        width = synthetic_space_width or min(glyph.width for glyph in glyphs)
        if width <= 0:
            raise ValueError("Synthetic space width must be positive.")
        glyphs.insert(
            0,
            Glyph(
                char=" ",
                pixels=np.ones((height, width), dtype=np.float32),
                width=width,
                height=height,
                synthetic=True,
            ),
        )

    return glyphs


def load_layout_advances(
    layout_model_path: Path | None,
) -> tuple[dict[str, float], dict[str, float]]:
    if layout_model_path is None:
        return {}, {}

    model = json.loads(layout_model_path.read_text())
    scale = float(model["raster"]["pixels_per_point"])
    advances = {
        char: float(advance) * scale
        for char, advance in model["advances_points"].items()
    }
    pair_advances = {
        pair: float(advance) * scale
        for pair, advance in model["pair_advances_points"].items()
    }
    return advances, pair_advances


def calibrated_line_width(layout_model_path: Path) -> int:
    model = json.loads(layout_model_path.read_text())
    actual_points = float(model["font"]["size_points"])
    if math.isclose(actual_points, SIZE_ONE_ACTUAL_POINTS):
        return SIZE_ONE_SAFE_LINE_WIDTH
    return round(SIZE_ONE_LINE_WIDTH * SIZE_ONE_ACTUAL_POINTS / actual_points)


def default_output_paths(input_path: Path, font_size: int | None) -> tuple[Path, Path]:
    output_dir = Path("output") / input_path.stem
    name = f"font_{font_size}" if font_size is not None else "ascii"
    return output_dir / f"{name}.txt", output_dir / f"{name}_report.json"


def split_into_strips(
    source: np.ndarray,
    num_lines: int,
    line_width: int,
    glyph_height: int,
) -> list[np.ndarray]:
    if num_lines <= 0:
        raise ValueError("num_lines must be positive.")

    height, width = source.shape
    edges = np.linspace(0, height, num_lines + 1)
    strips: list[np.ndarray] = []

    for index in range(num_lines):
        top = int(round(edges[index]))
        bottom = int(round(edges[index + 1]))
        if bottom <= top:
            bottom = min(height, top + 1)
        cropped = source[top:bottom, :]
        image = Image.fromarray(np.clip(cropped * 255.0, 0, 255).astype(np.uint8))
        resized = image.resize((line_width, glyph_height), Image.Resampling.LANCZOS)
        strips.append(np.asarray(resized, dtype=np.float32) / 255.0)

    return strips


def candidate_num_lines(min_lines: int, max_lines: int, step: int) -> list[int]:
    if min_lines <= 0 or max_lines < min_lines:
        raise ValueError("Expected 0 < min_lines <= max_lines.")
    if step <= 0:
        raise ValueError("line step must be positive.")

    values = list(range(min_lines, max_lines + 1, step))
    if values[-1] != max_lines:
        values.append(max_lines)
    return values


def target_error_weights(target: np.ndarray, foreground_weight: float) -> np.ndarray:
    if foreground_weight < 0:
        raise ValueError("--foreground-weight must be non-negative.")
    return 1.0 + (foreground_weight * (1.0 - target))


def trailing_white_suffix_error(
    target: np.ndarray,
    error_weights: np.ndarray,
) -> np.ndarray:
    column_errors = (np.abs(1.0 - target) * error_weights).sum(axis=0)
    suffix = np.zeros(target.shape[1] + 1, dtype=np.float64)
    suffix[:-1] = np.cumsum(column_errors[::-1])[::-1]
    return suffix


def glyph_segment(glyph: Glyph, width: int) -> np.ndarray:
    segment = np.ones((glyph.height, width), dtype=np.float32)
    usable = min(width, glyph.width)
    segment[:, :usable] = glyph.pixels[:, :usable]
    return segment


def render_text_line(
    text: str,
    glyphs_by_char: dict[str, Glyph],
    line_width: int,
    advances: dict[str, float] | None = None,
    pair_advances: dict[str, float] | None = None,
) -> np.ndarray:
    glyph_height = next(iter(glyphs_by_char.values())).height
    rendered = np.ones((glyph_height, line_width), dtype=np.float32)
    cursor = 0.0
    advances = advances or {}
    pair_advances = pair_advances or {}
    for index, char in enumerate(text):
        glyph = glyphs_by_char[char]
        if index + 1 < len(text):
            advance = pair_advances.get(
                char + text[index + 1],
                advances.get(char, glyph.width),
            )
        else:
            advance = advances.get(char, glyph.width)
        start = round(cursor)
        end = min(round(cursor + advance), line_width)
        usable = end - start
        if usable > 0:
            rendered[:, start:end] = glyph_segment(glyph, usable)
        cursor += advance
        if cursor >= line_width:
            break
    return rendered


def beam_search_strip(
    target: np.ndarray,
    glyphs: list[Glyph],
    line_index: int,
    beam_width: int,
    foreground_weight: float,
    max_chars: int | None = None,
    advances: dict[str, float] | None = None,
    pair_advances: dict[str, float] | None = None,
    progress_callback: Callable[[LineResult], None] | None = None,
) -> LineResult:
    glyph_height, line_width = target.shape
    if beam_width <= 0:
        raise ValueError("beam_width must be positive.")
    if any(glyph.height != glyph_height for glyph in glyphs):
        raise ValueError("Glyph height does not match target strip height.")

    min_width = min(glyph.width for glyph in glyphs)
    if max_chars is None:
        max_chars = math.ceil(line_width / min_width)
    if max_chars <= 0:
        raise ValueError("max_chars must be positive.")

    error_weights = target_error_weights(target, foreground_weight)
    white_suffix_error = trailing_white_suffix_error(target, error_weights)
    total_weight = float(error_weights.sum())
    advances = advances or {}
    pair_advances = pair_advances or {}
    glyph_index_by_char = {glyph.char: index for index, glyph in enumerate(glyphs)}
    segment_error_cache: dict[tuple[int, int, int], float] = {}

    def segment_error(glyph_index: int, x: int, width: int) -> float:
        key = (glyph_index, x, width)
        cached = segment_error_cache.get(key)
        if cached is not None:
            return cached

        glyph = glyphs[glyph_index]
        end = x + width
        err = float(
            (
                np.abs(target[:, x:end] - glyph_segment(glyph, width))
                * error_weights[:, x:end]
            ).sum()
        )
        segment_error_cache[key] = err
        return err

    def final_distance(state: BeamState) -> float:
        if not state.text:
            return white_suffix_error[0] / total_weight
        glyph_index = glyph_index_by_char[state.text[-1]]
        glyph = glyphs[glyph_index]
        start = round(state.width)
        end = round(state.width + advances.get(glyph.char, glyph.width))
        if end > line_width:
            return math.inf
        error = state.error_sum + segment_error(glyph_index, start, end - start)
        return (error + white_suffix_error[end]) / total_weight

    beam = [BeamState(text="", width=0.0, error_sum=0.0)]
    best_state = beam[0]
    best_distance = final_distance(best_state)

    def result_from_state(state: BeamState, distance: float) -> LineResult:
        text = state.text.rstrip()
        return LineResult(
            line_index=line_index,
            text=text,
            score=1.0 - distance,
            distance=distance,
            rendered_width=(
                round(
                    state.width
                    + advances.get(
                        state.text[-1],
                        glyphs[glyph_index_by_char[state.text[-1]]].width,
                    )
                )
                if state.text
                else 0
            ),
            char_count=len(text),
        )

    for _ in range(max_chars):
        expanded: list[BeamState] = []
        for state in beam:
            for glyph_index, glyph in enumerate(glyphs):
                if not state.text:
                    expanded.append(BeamState(text=glyph.char, width=0, error_sum=0.0))
                    continue

                previous = state.text[-1]
                previous_glyph_index = glyph_index_by_char[previous]
                previous_glyph = glyphs[previous_glyph_index]
                advance = pair_advances.get(
                    previous + glyph.char,
                    advances.get(previous, previous_glyph.width),
                )
                new_width = state.width + advance
                if round(new_width + advances.get(glyph.char, glyph.width)) > line_width:
                    continue
                start = round(state.width)
                end = round(new_width)
                expanded.append(
                    BeamState(
                        text=state.text + glyph.char,
                        width=new_width,
                        error_sum=state.error_sum
                        + segment_error(previous_glyph_index, start, end - start),
                    )
                )

        if not expanded:
            break

        expanded.sort(key=lambda state: (final_distance(state), state.error_sum, state.text))
        beam = expanded[:beam_width]

        for state in beam:
            distance = final_distance(state)
            if distance < best_distance:
                best_state = state
                best_distance = distance
                if progress_callback is not None:
                    progress_callback(result_from_state(best_state, best_distance))

    return result_from_state(best_state, best_distance)


def visualize_concurrent_search(
    strips: list[np.ndarray],
    glyphs: list[Glyph],
    beam_width: int,
    foreground_weight: float,
    max_chars: int | None,
    advances: dict[str, float],
    pair_advances: dict[str, float],
    output_path: Path,
    workers: int,
    fps: int,
    video_width: int,
    quiet: bool,
) -> list[LineResult]:
    if workers <= 0:
        raise ValueError("--workers must be positive.")
    if fps <= 0:
        raise ValueError("--progress-fps must be positive.")
    if video_width <= 0:
        raise ValueError("--progress-video-width must be positive.")
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("--visualize-progress requires ffmpeg on PATH.")

    glyphs_by_char = {glyph.char: glyph for glyph in glyphs}
    glyph_height, line_width = strips[0].shape
    canvas = np.ones((glyph_height * len(strips), line_width), dtype=np.float32)
    latest: dict[int, LineResult] = {}
    changed: set[int] = set()
    lock = threading.Lock()

    aspect = canvas.shape[0] / canvas.shape[1]
    encoded_width = min(video_width, line_width)
    if encoded_width % 2:
        encoded_width -= 1
    encoded_height = max(2, round(encoded_width * aspect))
    if encoded_height % 2:
        encoded_height += 1

    output_path.parent.mkdir(parents=True, exist_ok=True)
    command = [
        "ffmpeg",
        "-y",
        "-loglevel",
        "error",
        "-f",
        "rawvideo",
        "-pix_fmt",
        "rgb24",
        "-s",
        f"{encoded_width}x{encoded_height}",
        "-r",
        str(fps),
        "-i",
        "-",
        "-an",
        "-c:v",
        "mpeg4",
        "-q:v",
        "4",
        "-pix_fmt",
        "yuv420p",
        str(output_path),
    ]
    encoder = subprocess.Popen(command, stdin=subprocess.PIPE)
    if encoder.stdin is None:
        raise RuntimeError("Could not open ffmpeg input stream.")

    def publish(result: LineResult) -> None:
        with lock:
            previous = latest.get(result.line_index)
            if previous is None or previous.text != result.text:
                latest[result.line_index] = result
                changed.add(result.line_index)

    def write_frame() -> None:
        image = Image.fromarray(np.clip(canvas * 255.0, 0, 255).astype(np.uint8))
        image = image.resize(
            (encoded_width, encoded_height),
            Image.Resampling.LANCZOS,
        ).convert("RGB")
        encoder.stdin.write(image.tobytes())

    write_frame()
    frame_interval = 1.0 / fps
    next_frame = time.monotonic() + frame_interval
    futures: list[concurrent.futures.Future[LineResult]] = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=workers) as executor:
        for line_index, strip in enumerate(strips):
            futures.append(
                executor.submit(
                    beam_search_strip,
                    target=strip,
                    glyphs=glyphs,
                    line_index=line_index,
                    beam_width=beam_width,
                    foreground_weight=foreground_weight,
                    max_chars=max_chars,
                    advances=advances,
                    pair_advances=pair_advances,
                    progress_callback=publish,
                )
            )

        while not all(future.done() for future in futures):
            delay = next_frame - time.monotonic()
            if delay > 0:
                time.sleep(delay)
            with lock:
                changed_lines = sorted(changed)
                changed.clear()
                snapshots = {index: latest[index] for index in changed_lines}
            for line_index, result in snapshots.items():
                top = line_index * glyph_height
                canvas[top : top + glyph_height] = render_text_line(
                    result.text,
                    glyphs_by_char,
                    line_width,
                    advances,
                    pair_advances,
                )
            write_frame()
            next_frame = time.monotonic() + frame_interval

        results = [future.result() for future in futures]

    for result in results:
        top = result.line_index * glyph_height
        canvas[top : top + glyph_height] = render_text_line(
            result.text,
            glyphs_by_char,
            line_width,
            advances,
            pair_advances,
        )
    for _ in range(fps):
        write_frame()
    encoder.stdin.close()
    return_code = encoder.wait()
    if return_code != 0:
        raise RuntimeError(f"ffmpeg exited with status {return_code}.")
    if not quiet:
        print(f"Wrote progress video: {output_path}", file=sys.stderr)
    return results


def choose_candidate(
    evaluations: list[CandidateEvaluation],
    selection_metric: str,
) -> CandidateEvaluation:
    if selection_metric == "balanced":
        return max(
            evaluations,
            key=lambda item: (item.tuning_score, item.mean_score, item.num_lines),
        )
    if selection_metric == "score_per_line":
        return max(evaluations, key=lambda item: (item.score_per_line, item.mean_score))
    if selection_metric == "mean_score":
        return max(evaluations, key=lambda item: (item.mean_score, item.num_lines))
    raise ValueError(f"Unsupported selection metric: {selection_metric}")


def resolution_factor(num_lines: int, min_lines: int, max_lines: int) -> float:
    if max_lines <= min_lines:
        return 0.0
    return (num_lines - min_lines) / (max_lines - min_lines)


def aspect_preserving_num_lines(
    source_height: int,
    source_width: int,
    line_width: int,
    glyph_height: int,
    vertical_squish_factor: float,
) -> int:
    scaled_height = source_height * vertical_squish_factor
    return max(1, round((scaled_height * line_width) / (source_width * glyph_height)))


def sample_line_indices(
    num_lines: int,
    sample_size: int,
    rng: random.Random,
    sample_mode: str,
) -> list[int]:
    count = min(sample_size, num_lines)
    if sample_mode == "random":
        return sorted(rng.sample(range(num_lines), count))
    if sample_mode != "stratified":
        raise ValueError(f"Unsupported sample mode: {sample_mode}")

    raw_indices = [
        min(num_lines - 1, int(((index + 0.5) / count) * num_lines))
        for index in range(count)
    ]
    indices = sorted(set(raw_indices))
    if len(indices) == count:
        return indices

    for index in range(num_lines):
        if len(indices) == count:
            break
        if index not in indices:
            indices.append(index)
    return sorted(indices)


def asciify(
    input_path: Path,
    glyph_dir: Path,
    output_path: Path,
    report_path: Path,
    glyph_manifest: Path | None,
    layout_model: Path | None,
    min_lines: int,
    max_lines: int,
    fixed_num_lines: int | None,
    tune_lines: bool,
    line_step: int,
    sample_lines: int,
    sample_mode: str,
    beam_width: int,
    seed: int,
    line_width: int | None,
    vertical_squish_factor: float,
    foreground_weight: float,
    selection_metric: str,
    resolution_weight: float,
    add_synthetic_space: bool,
    synthetic_space_width: int | None,
    max_chars: int | None,
    visualize_progress: Path | None,
    workers: int,
    progress_fps: int,
    progress_video_width: int,
    quiet: bool,
) -> dict[str, Any]:
    glyphs = load_glyphs(
        glyph_dir=glyph_dir,
        manifest_path=glyph_manifest,
        add_synthetic_space=add_synthetic_space,
        synthetic_space_width=synthetic_space_width,
    )
    advances, pair_advances = load_layout_advances(layout_model)
    source = vertically_squish_source(
        load_image_array(input_path),
        vertical_squish_factor,
    )
    glyph_height = glyphs[0].height
    resolved_line_width = line_width or SIZE_ONE_LINE_WIDTH
    rng = random.Random(seed)

    evaluations: list[CandidateEvaluation] = []
    sample_cache: dict[tuple[int, int], LineResult] = {}
    if visualize_progress is not None and tune_lines:
        raise ValueError("--visualize-progress cannot be combined with --tune-lines.")

    if fixed_num_lines is not None:
        if fixed_num_lines <= 0:
            raise ValueError("--num-lines must be positive.")
        chosen_num_lines = fixed_num_lines
        if not quiet:
            print(f"Using fixed num_lines={chosen_num_lines}", file=sys.stderr)
    elif not tune_lines:
        chosen_num_lines = aspect_preserving_num_lines(
            source_height=source.shape[0],
            source_width=source.shape[1],
            line_width=resolved_line_width,
            glyph_height=glyph_height,
            vertical_squish_factor=vertical_squish_factor,
        )
        if not quiet:
            print(f"Using aspect-preserving num_lines={chosen_num_lines}", file=sys.stderr)
    else:
        for num_lines in candidate_num_lines(min_lines, max_lines, line_step):
            if not quiet:
                print(f"Sampling num_lines={num_lines}", file=sys.stderr)

            strips = split_into_strips(source, num_lines, resolved_line_width, glyph_height)
            sampled = sample_line_indices(num_lines, sample_lines, rng, sample_mode)
            results = []
            for line_index in sampled:
                result = beam_search_strip(
                    target=strips[line_index],
                    glyphs=glyphs,
                    line_index=line_index,
                    beam_width=beam_width,
                    foreground_weight=foreground_weight,
                    max_chars=max_chars,
                    advances=advances,
                    pair_advances=pair_advances,
                )
                sample_cache[(num_lines, line_index)] = result
                results.append(result)

            mean_score = float(np.mean([result.score for result in results]))
            mean_distance = float(np.mean([result.distance for result in results]))
            tuning_score = mean_score + (
                resolution_weight * resolution_factor(num_lines, min_lines, max_lines)
            )
            evaluations.append(
                CandidateEvaluation(
                    num_lines=num_lines,
                    sampled_lines=sampled,
                    mean_score=mean_score,
                    mean_distance=mean_distance,
                    score_per_line=mean_score / num_lines,
                    tuning_score=tuning_score,
                )
            )

        chosen = choose_candidate(evaluations, selection_metric)
        chosen_num_lines = chosen.num_lines
        if not quiet:
            print(f"Chosen num_lines={chosen_num_lines}", file=sys.stderr)

    chosen_strips = split_into_strips(
        source,
        chosen_num_lines,
        resolved_line_width,
        glyph_height,
    )
    if visualize_progress is not None:
        line_results = visualize_concurrent_search(
            strips=chosen_strips,
            glyphs=glyphs,
            beam_width=beam_width,
            foreground_weight=foreground_weight,
            max_chars=max_chars,
            advances=advances,
            pair_advances=pair_advances,
            output_path=visualize_progress,
            workers=workers,
            fps=progress_fps,
            video_width=progress_video_width,
            quiet=quiet,
        )
    else:
        line_results = []
        for line_index, strip in enumerate(chosen_strips):
            cached = sample_cache.get((chosen_num_lines, line_index))
            if cached is not None:
                line_results.append(cached)
                continue

            if not quiet:
                print(
                    f"Rendering line {line_index + 1}/{chosen_num_lines}",
                    file=sys.stderr,
                )

            line_results.append(
                beam_search_strip(
                    target=strip,
                    glyphs=glyphs,
                    line_index=line_index,
                    beam_width=beam_width,
                    foreground_weight=foreground_weight,
                    max_chars=max_chars,
                    advances=advances,
                    pair_advances=pair_advances,
                )
            )

    line_results.sort(key=lambda result: result.line_index)
    mean_score = float(np.mean([result.score for result in line_results]))
    mean_distance = float(np.mean([result.distance for result in line_results]))
    if fixed_num_lines is not None or not tune_lines:
        evaluations.append(
            CandidateEvaluation(
                num_lines=chosen_num_lines,
                sampled_lines=[],
                mean_score=mean_score,
                mean_distance=mean_distance,
                score_per_line=mean_score / chosen_num_lines,
                tuning_score=mean_score,
            )
        )

    ascii_art = "\n".join(result.text for result in line_results) + "\n"
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(ascii_art)

    glyph_summary = [
        {
            "char": glyph.char,
            "width": glyph.width,
            "height": glyph.height,
            "path": glyph.path,
            "synthetic": glyph.synthetic,
        }
        for glyph in glyphs
    ]
    report = {
        "input": str(input_path),
        "glyph_dir": str(glyph_dir),
        "glyph_manifest": str(glyph_manifest) if glyph_manifest else None,
        "layout_model": str(layout_model) if layout_model else None,
        "output": str(output_path),
        "num_lines_mode": (
            "fixed"
            if fixed_num_lines is not None
            else "tuned"
            if tune_lines
            else "aspect"
        ),
        "chosen_num_lines": chosen_num_lines,
        "selection_metric": selection_metric,
        "line_width": resolved_line_width,
        "vertical_squish_factor": vertical_squish_factor,
        "foreground_weight": foreground_weight,
        "glyph_height": glyph_height,
        "beam_width": beam_width,
        "sample_lines": sample_lines,
        "sample_mode": sample_mode,
        "seed": seed,
        "resolution_weight": resolution_weight,
        "progress_video": str(visualize_progress) if visualize_progress else None,
        "workers": workers if visualize_progress else None,
        "progress_fps": progress_fps if visualize_progress else None,
        "mean_score": mean_score,
        "mean_distance": mean_distance,
        "candidate_evaluations": [item.to_json() for item in evaluations],
        "lines": [result.to_json() for result in line_results],
        "glyphs": glyph_summary,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, indent=2))
    return report


def parse_args(argv: Iterable[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Render an image as variable-width Google Docs-style ASCII art."
    )
    parser.add_argument("input", type=Path, help="Source image to asciify.")
    parser.add_argument(
        "--glyph-dir",
        type=Path,
        default=None,
        help="Optional custom glyph directory. Bundled calibrations are the default.",
    )
    parser.add_argument(
        "--glyph-manifest",
        type=Path,
        default=None,
        help="Optional JSON mapping glyph characters to screenshot files.",
    )
    parser.add_argument(
        "--layout-model",
        type=Path,
        default=None,
        help="Optional calibration model containing Google Docs pair advances.",
    )
    parser.add_argument(
        "--font-size",
        type=int,
        default=None,
        help=(
            "Use calibration-models/<size>/ for this displayed font size. Defaults "
            "to 1; Docs renders size 1 as 2.25pt."
        ),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=None,
        help="Text file for generated ASCII art. Defaults under output/<input-name>/.",
    )
    parser.add_argument(
        "--report",
        type=Path,
        default=None,
        help="JSON report path. Defaults under output/<input-name>/.",
    )
    parser.add_argument("--min-lines", type=int, default=20)
    parser.add_argument("--max-lines", type=int, default=112)
    parser.add_argument(
        "--num-lines",
        type=int,
        default=None,
        help="Render exactly this many lines instead of preserving source aspect.",
    )
    parser.add_argument(
        "--tune-lines",
        action="store_true",
        help="Use sampled beam searches to select num_lines instead of preserving aspect.",
    )
    parser.add_argument("--line-step", type=int, default=5)
    parser.add_argument("--sample-lines", type=int, default=5)
    parser.add_argument(
        "--sample-mode",
        choices=("stratified", "random"),
        default="stratified",
        help="How to choose sample strips during automatic tuning.",
    )
    parser.add_argument("--beam-width", type=int, default=40)
    parser.add_argument("--seed", type=int, default=0)
    parser.add_argument(
        "--line-width",
        type=int,
        default=None,
        help=(
            f"Output line width in normalized pixels. Defaults to {SIZE_ONE_LINE_WIDTH} "
            "without --font-size; calibrated font sizes derive their width from the "
            "fixed Google Docs page width."
        ),
    )
    parser.add_argument(
        "--vertical-squish-factor",
        type=float,
        default=1.0,
        help=(
            "Compress source content vertically before matching while preserving "
            "the original canvas height. Defaults to 1.0."
        ),
    )
    parser.add_argument(
        "--foreground-weight",
        type=float,
        default=4.0,
        help=(
            "Additional error weight applied in proportion to source darkness. "
            "Defaults to 4.0; use 0 for unweighted pixel distance."
        ),
    )
    parser.add_argument(
        "--selection-metric",
        choices=("balanced", "mean_score", "score_per_line"),
        default="balanced",
        help="Metric used to choose num_lines.",
    )
    parser.add_argument(
        "--resolution-weight",
        type=float,
        default=0.03,
        help=(
            "Extra score given to the maximum line count in balanced tuning. "
            "Use 0 for raw mean_score behavior."
        ),
    )
    parser.add_argument(
        "--no-synthetic-space",
        action="store_true",
        help="Do not add a blank space glyph when the captures do not include one.",
    )
    parser.add_argument(
        "--synthetic-space-width",
        type=int,
        default=None,
        help="Width in pixels for the synthetic space glyph. Defaults to min glyph width.",
    )
    parser.add_argument(
        "--max-chars",
        type=int,
        default=None,
        help="Optional hard cap for characters per output line.",
    )
    parser.add_argument(
        "--visualize-progress",
        type=Path,
        default=None,
        help="Write an MP4 showing all beam searches forming the image concurrently.",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=8,
        help="Concurrent line-search workers used by --visualize-progress.",
    )
    parser.add_argument(
        "--progress-fps",
        type=int,
        default=12,
        help="Frames per second for --visualize-progress. Defaults to 12.",
    )
    parser.add_argument(
        "--progress-video-width",
        type=int,
        default=1920,
        help="Maximum encoded progress-video width. Defaults to 1920.",
    )
    parser.add_argument("--quiet", action="store_true")
    return parser.parse_args(argv)


def main(argv: Iterable[str] | None = None) -> int:
    args = parse_args(argv)
    if args.font_size is None and args.glyph_dir is None:
        args.font_size = 1
    default_output, default_report = default_output_paths(args.input, args.font_size)
    output_path = args.output or default_output
    report_path = args.report or default_report
    glyph_dir = args.glyph_dir
    glyph_manifest = args.glyph_manifest
    layout_model = args.layout_model
    if args.font_size is not None:
        calibration_dir = (
            Path(__file__).resolve().parent / "calibration-models" / str(args.font_size)
        )
        glyph_dir = calibration_dir
        glyph_manifest = calibration_dir / "manifest.json"
        layout_model = calibration_dir / "model.json"
        if args.line_width is None:
            args.line_width = calibrated_line_width(layout_model)
    elif glyph_dir is None:
        raise ValueError("Provide --font-size or --glyph-dir.")

    asciify(
        input_path=args.input,
        glyph_dir=glyph_dir,
        output_path=output_path,
        report_path=report_path,
        glyph_manifest=glyph_manifest,
        layout_model=layout_model,
        min_lines=args.min_lines,
        max_lines=args.max_lines,
        fixed_num_lines=args.num_lines,
        tune_lines=args.tune_lines,
        line_step=args.line_step,
        sample_lines=args.sample_lines,
        sample_mode=args.sample_mode,
        beam_width=args.beam_width,
        seed=args.seed,
        line_width=args.line_width,
        vertical_squish_factor=args.vertical_squish_factor,
        foreground_weight=args.foreground_weight,
        selection_metric=args.selection_metric,
        resolution_weight=args.resolution_weight,
        add_synthetic_space=not args.no_synthetic_space,
        synthetic_space_width=args.synthetic_space_width,
        max_chars=args.max_chars,
        visualize_progress=args.visualize_progress,
        workers=args.workers,
        progress_fps=args.progress_fps,
        progress_video_width=args.progress_video_width,
        quiet=args.quiet,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
