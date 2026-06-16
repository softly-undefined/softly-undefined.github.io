# Clean Remap Character Export

This folder is the portable final version of the character. It contains only
the cleaned/remapped character data. It does not depend on the comparison site,
the old sheet, or the new sheet.

## Final Animation Map

| Action | Frames | Source behavior |
| --- | ---: | --- |
| `idle` | 6 | Final idle cycle |
| `walk` | 5 | Final movement cycle |
| `jump` | 4 | Jump ascent |
| `fall` | 4 | Falling/landing |
| `attack` | 4 | Attack, including the final-frame arc |
| `hurt` | 3 | Hurt reaction, including particles |
| `die` | 4 | Death sequence |
| `turn` | 4 | Turn-around sequence |
| `blink` | 3 | Blink sequence |

There is intentionally no `run` action.

## Folder Layout

```text
export-information/
├── README.md
├── manifest.json
├── requirements.txt
├── build_ascii.py
├── frames/
│   └── <action>/<frame>.png
├── ascii/
│   ├── clean-remap-ascii.json
│   ├── clean-remap-ascii.js
│   └── text/<font-size>/<action>/<frame>.txt
└── tools/
    ├── asciify_mk2.py
    ├── render_glyph_preview.py
    ├── generate_calibration_text.py
    ├── extract_pdf_calibration.py
    ├── google_docs_calibration.txt
    ├── google_docs_calibration_instructions.md
    ├── calibration-pdfs/
    └── calibration-models/
```

### `frames/`

The 37 canonical raster inputs. Every frame is a `210x180` RGB PNG on a pure
white background. Disconnected edge artifacts are removed. The attack arc and
hurt particles are intentionally preserved.

Frame filenames are zero-based: `00.png`, `01.png`, and so on.

### `ascii/clean-remap-ascii.json`

The easiest runtime format. It contains every action and frame rendered at
Arial sizes `11`, `15`, `20`, `25`, `30`, and `35`.

```js
const frame = data.sizes["11"].sprites.idle[0];
element.textContent = frame;
```

Render the text with:

```css
white-space: pre;
font-family: Arial, sans-serif;
font-size: 11px; /* Must match the selected bundle. */
line-height: 1.34;
```

### `ascii/clean-remap-ascii.js`

The same data as the JSON bundle, exposed as:

```js
window.CLEAN_REMAP_ASCII
```

This is useful for local HTML files that should open without a web server.

### `ascii/text/`

Individual plain-text frames, grouped by font size and action.

### `manifest.json`

Machine-readable animation names, frame counts, default playback settings, and
recommended keyboard controls.

## Regenerating ASCII

Install dependencies:

```bash
python3 -m pip install -r requirements.txt
```

Regenerate all bundled sizes:

```bash
python3 build_ascii.py
```

Or regenerate selected sizes:

```bash
python3 build_ascii.py --font-sizes 25 30 35
```

The renderer uses the bundled Google Docs/Arial calibration models. Build
reports are written to `.build-reports/` and are not required at runtime.

Rebuild only the JSON and JavaScript bundles from existing text frames:

```bash
python3 build_ascii.py --bundle-only
```

## Changing Fonts Or Calibration

The full non-color Asciify toolchain is included under `tools/`. It contains
the beam-search renderer, source calibration PDFs, extracted glyph models, and
all scripts needed to build a model for a different font or size.

To create or replace a calibration:

1. Run `python3 tools/generate_calibration_text.py`.
2. Follow `tools/google_docs_calibration_instructions.md`, applying the desired
   font and size before exporting the PDF.
3. Save it as `tools/calibration-pdfs/calibration-<size>.pdf`.
4. Extract the model:

```bash
python3 tools/extract_pdf_calibration.py \
  --pdf tools/calibration-pdfs/calibration-<size>.pdf \
  --output-dir tools/calibration-models/<size>
```

For a large font whose calibration text wraps, add:

```bash
--fallback-model tools/calibration-models/11/model.json
```

Then generate the character at that calibration size:

```bash
python3 build_ascii.py --font-sizes <size>
```

`build_ascii.py` discovers numeric calibration directories dynamically. A
selected-size rebuild updates that size while preserving all other existing
text and bundled sizes. See `tools/COMMANDS.md` for renderer quality, layout,
progress-video, and diagnostic-preview controls.

## Runtime Notes

- Default font size: `11`
- Recommended animation speed: `8 FPS`
- Movement: use `walk`; there is no faster `run` state.
- Keep spaces and line breaks exactly as stored.
- ASCII output is variable-width Arial text, not monospaced text.
