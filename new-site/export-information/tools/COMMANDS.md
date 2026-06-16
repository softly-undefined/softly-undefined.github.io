# Commands

Run these commands from the repository root.

## Setup

Install the Python dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Progress videos also require `ffmpeg`:

```bash
ffmpeg -version
```

## Render an image

Put source images in `input/`, then run:

```bash
python3 asciify_mk2.py input/example.png
```

This uses calibrated font size `1` and writes:

- `output/example/font_1.txt`
- `output/example/font_1_report.json`

Select another bundled Google Docs font size with `--font-size`. Available
sizes are `1`, `5`, `8`, `11`, `15`, `20`, `25`, `30`, and `35`. Google Docs
displays size `1` as `2.25pt`.

```bash
python3 asciify_mk2.py input/example.png --font-size 11
```

Render every calibrated size:

```bash
for size in 1 5 8 11 15 20 25 30 35; do
  python3 asciify_mk2.py input/example.png --font-size "$size"
done
```

## Render a diagnostic preview

This creates the image that Asciify believes the generated text will produce:

```bash
python3 render_glyph_preview.py output/example/font_11.txt \
  --report output/example/font_11_report.json \
  --output output/example/font_11_preview.png
```

Use this preview to distinguish search-quality problems from differences in
Google Docs rendering.

## Render a progress video

This searches rows concurrently and records the image forming over time:

```bash
python3 asciify_mk2.py input/example.png \
  --font-size 11 \
  --visualize-progress output/example/font_11_progress.mp4 \
  --workers 8
```

Useful video controls:

- `--workers 8`: concurrent row searches.
- `--progress-fps 12`: output video frame rate.
- `--progress-video-width 1920`: maximum encoded video width.

## Quality and layout controls

Increase search quality at the cost of runtime:

```bash
python3 asciify_mk2.py input/example.png --font-size 11 --beam-width 128
```

Force a specific number of output rows:

```bash
python3 asciify_mk2.py input/example.png --font-size 11 --num-lines 30
```

Override the calibrated page width only when intentionally targeting a
different layout:

```bash
python3 asciify_mk2.py input/example.png --font-size 11 --line-width 1200
```

Other useful controls:

- `--foreground-weight`: increases the importance of dark source pixels.
- `--vertical-squish-factor`: compresses source content vertically before
  matching.
- `--tune-lines`: samples multiple line counts instead of using the
  aspect-preserving default.
- `--max-chars`: caps characters per output row.
- `--quiet`: suppresses normal progress output.

List every option:

```bash
python3 asciify_mk2.py --help
```

## Rebuild calibration data

The bundled calibration models normally do not need rebuilding. To add or
replace a font-size calibration:

1. Regenerate the text block:

```bash
python3 generate_calibration_text.py
```

2. Follow `google_docs_calibration_instructions.md`, exporting the result to
   `calibration-pdfs/calibration-<size>.pdf`.

3. Extract the model:

```bash
python3 extract_pdf_calibration.py \
  --pdf calibration-pdfs/calibration-11.pdf \
  --output-dir calibration-models/11
```

For larger sizes whose pair-calibration lines wrap in Google Docs, use an
existing model as the fallback for ambiguous pair advances:

```bash
python3 extract_pdf_calibration.py \
  --pdf calibration-pdfs/calibration-20.pdf \
  --output-dir calibration-models/20 \
  --fallback-model calibration-models/11/model.json
```

## Project layout

- `asciify_mk2.py`: main beam-search renderer.
- `render_glyph_preview.py`: renders generated text from calibrated glyphs.
- `generate_calibration_text.py`: creates the Google Docs calibration text.
- `extract_pdf_calibration.py`: converts calibration PDFs into models.
- `input/`: source images.
- `output/`: generated text, reports, previews, and videos.
- `calibration-pdfs/`: source Google Docs calibration exports.
- `calibration-models/`: extracted glyph and layout data.
