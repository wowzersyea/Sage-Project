# Browser tests

The site itself has no build step and no dependencies — that is deliberate, because
these files get opened by people who are not developers and every dependency is a thing
that breaks at 07:00. These tests are the exception: they are development tooling, they
are never served, and nothing in `/morning-report/` imports them.

```bash
npm install playwright          # not committed; nothing else needs it
python3 -m http.server 8899     # from the repository root
node tests/run.js               # or: node tests/store.test.js
```

Each suite exits non-zero on a failure or on any console error.

| Suite | What it holds down |
|---|---|
| `store.test.js` | Folder round-trips, nesting, listing, deletion, and that the handle survives a reload |
| `roster.test.js` | Eligibility, away windows, neglect weighting, the cycle refill, the year roll, and a draw seen from a second machine |
| `board.test.js` | Autosave, recovery after a hard kill at 0:18, the archive, and the derived facts the scorecard reads |
| `capture.test.js` | The identifier check in both directions, and the prefill from the board |
| `scorecard.test.js` | The sixteen items, the pre-ticks, overrides, and what lands in `sessions/` |
| `roles.test.js` | Every card, the anchors the scorecard links to, the block ladder, and the single-source acceptance test |
| `review.test.js` | Loading `casebank/`, the date and tag filters, and a full play-through |
| `report.test.js` | The four-session floor, cell suppression, and that no session or role is ever named |
| `equity.test.js` | The four flags, the away adjustment, the CSV, and that nothing here reads `sessions/` |
| `site.test.js` | Every page loads clean, every internal link resolves, and nothing writes `localStorage` |
| `remote.test.js` | The optional shared endpoint: that the folder always wins, that the endpoint owns the people while the folder owns the log, that a refused key or a dead endpoint degrades instead of breaking, that only the two name-bearing paths are ever fetched, and that the key is not persisted unless asked |
| `appsscript.test.js` | `server/Code.gs` run in node with the Google globals stubbed: the key gate, name resolution in every form a chief might type, date cells, the seed round-trip, and the feedback post box — that the weak key submits and cannot read the roster or drain, and that a collection empties it. No browser and no network — run it with plain `node`. |
| `qr.test.js` | The QR encoder: the published format and version strings, version selection at every capacity boundary, and an independent reader — sharing no code with the encoder — that reverses the mask and the zigzag and reads the text back, at every mask. Fixtures were decoded with a real decoder when generated. Plain `node`, no browser. |
| `feedback.test.js` | Dictation and recording into the boxes, the identifier gate, the rollup arithmetic, one model call per unit, that a recording is discarded unless it was asked for, a phone with no folder posting to the endpoint, and a collection landing it in the folder and emptying the endpoint |

## The fake file system

`fakefs.js` stands in for the File System Access API and IndexedDB, backed by
`localStorage` so a second tab sees the same folder — which is how the two-machine test
in `roster.test.js` works. It is test scaffolding; the product never touches
`localStorage`, and `site.test.js` asserts that.

`roles.test.js` edits `content/roles.json` in place to run the acceptance test from the
spec, and restores it in a `finally`. If it is killed mid-run, check that file with
`git diff` before doing anything else.
