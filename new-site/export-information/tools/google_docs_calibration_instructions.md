# Google Docs calibration export

1. Create a new Google Doc using the same environment intended for Asciify.
2. Open **Tools > Preferences** and disable smart quotes and automatic
   substitutions.
3. Paste the entire contents of `google_docs_calibration.txt` using **Paste
   without formatting** (`Cmd+Shift+V` on macOS).
4. Select all pasted text and apply:
   - Font: the exact font you want Asciify to reproduce
   - Size: the exact displayed size you want to calibrate
   - Bold/italic/underline: off
   - Text color: black
   - Paragraph alignment: left
   - Line and paragraph spacing: single
   - Remove space before and after paragraphs
5. Keep the default page margins. Do not manually add or remove line breaks.
6. Do not manually alter lines that wrap at larger font sizes. The extractor
   handles physical PDF line wrapping.
7. Export with **File > Download > PDF Document (.pdf)**.
8. Place the resulting PDF in `calibration-pdfs/`, named for the displayed
   font size, such as `calibration-8.pdf`. Extract it into the matching numeric
   directory under `calibration-models/`.

The calibration file intentionally spans multiple pages. Its blocks measure:

- line height and baseline placement,
- space advance width,
- standalone glyph advance and raster shape for all printable ASCII,
- every ordered pair of non-space printable ASCII characters for kerning.

Do not use screenshots for this calibration. The PDF preserves exact glyph
positions and embedded font information at substantially higher precision.
