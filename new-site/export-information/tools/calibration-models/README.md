# Calibrated Google Docs font sizes

Each numbered directory contains a normalized glyph raster set, manifest, and
layout model extracted from the corresponding PDF in `calibration-pdfs/`.

Available displayed Google Docs sizes: `1`, `5`, `8`, `11`, `15`, and `20`.
Google Docs internally renders displayed size `1` as `2.25pt`.

All models are normalized to the same 11pt search coordinate system, so the
default `9019px` paste-safe maximum width and aspect-preserving line calculation remain
consistent when switching sizes.

The 15pt and 20pt calibration text physically wrapped in Google Docs. The 15pt
model still measured every unique pair elsewhere in the document. The 20pt
model infers only the unique pair adjustments lost exactly at wrap boundaries
from the 11pt model:

- 15pt: 0 inferred pairs out of 8,836.
- 20pt: 30 inferred pairs out of 8,836.
