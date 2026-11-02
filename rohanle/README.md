# Rohanle

Open `index.html` in a modern browser. Everything, including the dictionary, is embedded in that single file. No installation, build, server, or internet connection is required.

Change exactly one letter at a time, using valid five-letter words, until you reach **ROHAN**. Every daily start has a route to the destination. The starting word rotates at midnight UTC and is the same for everyone. Undo, hints, shortest-route scoring, and copying your result are included. Progress is stored in browser local storage when available.

The layout uses five square tiles per word, with green for letters matching ROHAN in position and gray for other letters. Adding, deleting, or rearranging letters is not allowed.

The dictionary includes uncommon and older words from the public-domain Webster's Second International word list supplied with macOS, plus ROMAN and ROHAN (the special destination). The game chooses its daily starts from 280 familiar words that are at least five moves from ROHAN.

Verification: all 280 start-to-goal routes, 365 consecutive daily rotations, valid and invalid edits, hints, undo, saved-game restoration, and victory were checked with Node against the embedded game script. A browser preview was unavailable in the development environment.
