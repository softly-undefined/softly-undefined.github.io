# Dictionary sources and rebuild

The game accepts the union of its original macOS Webster's Second International
entries, ENABLE entries, curated starting words, and ERIC / ROHAN / MEILIN.
Only lowercase ASCII entries of four through six letters are included. Input is
trimmed and lowercased; numbers, punctuation, and other lengths are rejected.
No speculative suffix rules are used: plurals and conjugations must be listed.

`enable-4-6.txt` contains 27,771 sorted, unique entries filtered from:
https://raw.githubusercontent.com/dolph/dictionary/master/enable1.txt

Downloaded November 4, 2026. SHA-256 of the full upstream file:
`3f16130220645692ed49c7134e24a18504c2ca55b3c012f7290e3e77c63b1a89`

ENABLE is public domain. `ENABLE-NOTICE.txt` preserves the upstream explanatory
notice from https://github.com/BartMassey/wordlists/blob/main/README-enable2k.txt.
The source subset is checked in so rebuilds need no network or installed system
dictionary. Run `python3 rohanle/build-dictionary.py` after editing it, followed by
`node rohanle/test.cjs`. Keep the subset sorted and unique.

The generated block is embedded in index.html so the game still works offline
and when opened directly. The original dictionary is also retained as a frozen
snapshot for daily start selection. Expanded acceptance, shortest paths, hints,
and restored paths all use the full dictionary. This preserves existing starts
and saved progress while allowing newly accepted words to shorten a route.
The per-target route graphs are cached for tab switching.
