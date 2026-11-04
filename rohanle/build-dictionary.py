"""Rebuild the embedded dictionary offline: python3 rohanle/build-dictionary.py."""
from pathlib import Path
import re

root = Path(__file__).resolve().parent
words = (root / 'dictionary/enable-4-6.txt').read_text().splitlines()
assert words == sorted(set(words)), 'Dictionary must be sorted and unique'
assert all(re.fullmatch('[a-z]{4,6}', word) for word in words)
assert {'paid', 'feet', 'held', 'hang', 'proud', 'events'} <= set(words)
page = root / 'index.html'
html = page.read_text()
block = "// BEGIN GENERATED DICTIONARY\n// Public-domain ENABLE; see dictionary/README.md.\nfor(const word of '" + ' '.join(words) + "'.split(' '))WORDS.add(word);\n// END GENERATED DICTIONARY"
html, count = re.subn(r'// BEGIN GENERATED DICTIONARY\n.*?// END GENERATED DICTIONARY', lambda _: block, html, flags=re.S)
assert count == 1, 'Expected exactly one generated dictionary block'
page.write_text(html)
print(f'Embedded {len(words):,} ENABLE entries (4–6 letters).')
