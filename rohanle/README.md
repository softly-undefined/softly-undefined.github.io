# Rohanle

Open `index.html` in a modern browser. The dictionary and game are embedded; no installation or server is required.

Reach ERIC, ROHAN, or MEILIN by changing exactly one letter per move. Word length is locked to the target: four for ERIC, five for ROHAN, and six for MEILIN. Rohanle, Ericle, and Meilinle each have a separate tab and daily puzzle. Starting words are selected deterministically each day at midnight UTC, so everyone gets the same three puzzles. Starts were selected with routes of at least five moves in the original dictionary; the expanded dictionary may offer shorter routes.

Green tiles match the target in position. Hints, undo, shortest-route scoring, and copied results follow the selected target. Progress and hints are saved locally for each tab and day. Existing v4 progress is retained in the matching name’s tab. Use the arrow keys, Home, or End to switch tabs from the keyboard.

The dictionary accepts over 43,000 four-to-six-letter entries from the original public-domain Webster’s Second International list and the public-domain ENABLE word-game list, including plurals and inflected forms such as PAID and FEET. Curated starting words and the special destination names are always accepted. See [dictionary sources and rebuild instructions](dictionary/README.md).

Run `node rohanle/test.cjs` to check dictionary coverage, input validation, routes, progress, and tabs.
