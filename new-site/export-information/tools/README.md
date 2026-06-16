# Non-Color Asciify Toolchain

This directory contains the complete non-color generation path used for the
clean-remap character.

- `asciify_mk2.py`: variable-width beam-search ASCII renderer.
- `generate_calibration_text.py`: creates printable-ASCII calibration text.
- `google_docs_calibration_instructions.md`: captures a chosen font and size.
- `extract_pdf_calibration.py`: converts a calibration PDF into glyph rasters
  and layout metrics.
- `render_glyph_preview.py`: reconstructs generated ASCII from its exact glyph
  model for visual diagnosis.
- `calibration-pdfs/`: source exports used to build the bundled models.
- `calibration-models/`: ready-to-use models, including glyph images, manifests,
  advances, line heights, and pair spacing.
- `COMMANDS.md`: detailed renderer controls and examples.

Run the character-wide wrapper from the parent directory:

```bash
python3 build_ascii.py
```

Run individual renderer or calibration commands from this directory, or use
the paths documented in the parent README.
