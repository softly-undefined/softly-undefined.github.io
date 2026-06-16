#!/usr/bin/env python3
"""Generate the Google Docs calibration text used to build glyph metrics."""

from __future__ import annotations

from pathlib import Path


PRINTABLE_NONSPACE = (
    "abcdefghijklmnopqrstuvwxyz"
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "0123456789"
    "!@#$%^&*()-_+={}[]|\\;:\"'?/.,~`<>"
)
REPEAT_COUNT = 32
PAIR_LINE_LENGTH = 36


def de_bruijn_order_two(alphabet: str) -> str:
    """Return a cyclic sequence containing every ordered pair exactly once."""
    size = len(alphabet)
    adjacency = [list(range(size - 1, -1, -1)) for _ in range(size)]
    stack = [0]
    circuit: list[int] = []

    while stack:
        vertex = stack[-1]
        if adjacency[vertex]:
            stack.append(adjacency[vertex].pop())
        else:
            circuit.append(stack.pop())

    vertices = circuit[::-1]
    return "".join(alphabet[index] for index in vertices)


def overlapping_chunks(text: str, length: int) -> list[str]:
    chunks = []
    start = 0
    while start < len(text) - 1:
        end = min(len(text), start + length)
        chunks.append(text[start:end])
        if end == len(text):
            break
        start = end - 1
    return chunks


def calibration_lines() -> list[str]:
    lines = [
        "ASCIIFY_CALIBRATION_V1",
        "BLOCK_LINE_HEIGHT_START",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "HHHHHHHHHHHHHHHH",
        "BLOCK_LINE_HEIGHT_END",
        "BLOCK_SPACE_START",
        "H H",
        "H  H",
        "H   H",
        "H    H",
        "H        H",
        "H                H",
        "H                                H",
        "BLOCK_SPACE_END",
        "BLOCK_SINGLE_ADVANCE_START",
    ]

    lines.extend(char * REPEAT_COUNT for char in PRINTABLE_NONSPACE)
    lines.extend(
        [
            "BLOCK_SINGLE_ADVANCE_END",
            "BLOCK_PAIR_KERNING_START",
        ]
    )

    sequence = de_bruijn_order_two(PRINTABLE_NONSPACE)
    lines.extend(overlapping_chunks(sequence, PAIR_LINE_LENGTH))
    lines.extend(
        [
            "BLOCK_PAIR_KERNING_END",
            "ASCIIFY_CALIBRATION_END",
        ]
    )
    return lines


def main() -> None:
    output = Path(__file__).with_name("google_docs_calibration.txt")
    lines = calibration_lines()
    output.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"Wrote {output} with {len(lines)} lines.")


if __name__ == "__main__":
    main()
