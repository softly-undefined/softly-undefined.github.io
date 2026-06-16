#!/usr/bin/env python3
"""Render every clean-remap frame and assemble portable ASCII bundles."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path


ROOT = Path(__file__).resolve().parent
FRAMES_ROOT = ROOT / "frames"
ASCIIFY = ROOT / "tools" / "asciify_mk2.py"
MODEL_ROOT = ROOT / "tools" / "calibration-models"
TEXT_ROOT = ROOT / "ascii" / "text"
BUNDLE_ROOT = ROOT / "ascii"
DEFAULT_FONT_SIZES = (11, 15, 20, 25, 30, 35)


def available_font_sizes() -> list[int]:
    return sorted(
        int(path.name)
        for path in MODEL_ROOT.iterdir()
        if path.is_dir()
        and path.name.isdigit()
        and (path / "manifest.json").is_file()
        and (path / "model.json").is_file()
    )


def frame_jobs() -> list[tuple[str, int, Path]]:
    jobs = []
    for action_dir in sorted(FRAMES_ROOT.iterdir()):
        if not action_dir.is_dir():
            continue
        for frame_path in sorted(action_dir.glob("*.png")):
            jobs.append((action_dir.name, int(frame_path.stem), frame_path))
    return jobs


def render(job: tuple[int, str, int, Path]) -> tuple[int, str, int, Path]:
    font_size, action, index, input_path = job
    output_dir = TEXT_ROOT / str(font_size) / action
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"{index:02d}.txt"
    report_path = ROOT / ".build-reports" / str(font_size) / action / f"{index:02d}.json"
    report_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            sys.executable,
            str(ASCIIFY),
            str(input_path),
            "--font-size",
            str(font_size),
            "--output",
            str(output_path),
            "--report",
            str(report_path),
            "--quiet",
        ],
        cwd=ROOT / "tools",
        check=True,
    )
    return font_size, action, index, output_path


def write_bundle() -> None:
    data = {
        "name": "clean-remap",
        "renderer": "tools/asciify_mk2.py",
        "color": False,
        "defaultFontSize": 11,
        "sizes": {},
    }
    for size_dir in sorted(
        (path for path in TEXT_ROOT.iterdir() if path.is_dir() and path.name.isdigit()),
        key=lambda path: int(path.name),
    ):
        font_size = int(size_dir.name)
        sprites = {}
        for action_dir in sorted(path for path in size_dir.iterdir() if path.is_dir()):
            frames = []
            for frame_path in sorted(action_dir.glob("*.txt"), key=lambda path: int(path.stem)):
                index = int(frame_path.stem)
                while len(frames) <= index:
                    frames.append("")
                frames[index] = frame_path.read_text().removesuffix("\n")
            sprites[action_dir.name] = frames
        data["sizes"][str(font_size)] = {"fontSize": font_size, "sprites": sprites}

    BUNDLE_ROOT.mkdir(parents=True, exist_ok=True)
    serialized = json.dumps(data, indent=2)
    (BUNDLE_ROOT / "clean-remap-ascii.json").write_text(serialized + "\n")
    (BUNDLE_ROOT / "clean-remap-ascii.js").write_text(
        f"window.CLEAN_REMAP_ASCII = {serialized};\n"
    )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--font-sizes",
        type=int,
        nargs="+",
        default=list(DEFAULT_FONT_SIZES),
        help=(
            "Calibration directory names to render. Defaults to 11 15 20 25 30 35. "
            "New sizes work after adding tools/calibration-models/<size>/."
        ),
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=4,
        help="Number of frames to render concurrently. Defaults to 4.",
    )
    parser.add_argument(
        "--bundle-only",
        action="store_true",
        help="Rebuild JSON and JS from ascii/text without rendering frames.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    available = available_font_sizes()
    missing = sorted(set(args.font_sizes) - set(available))
    if missing and not args.bundle_only:
        raise SystemExit(
            f"Missing calibration model(s) for {missing}. Available sizes: {available}"
        )

    if not args.bundle_only:
        frames = frame_jobs()
        jobs = [
            (size, action, index, path)
            for size in args.font_sizes
            for action, index, path in frames
        ]
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = [executor.submit(render, job) for job in jobs]
            for completed, future in enumerate(as_completed(futures), start=1):
                font_size, action, index, _ = future.result()
                print(
                    f"[{completed:03d}/{len(jobs)}] "
                    f"font {font_size} {action} frame {index + 1}"
                )

    write_bundle()
    print(f"Wrote {BUNDLE_ROOT / 'clean-remap-ascii.json'} and clean-remap-ascii.js")


if __name__ == "__main__":
    main()
