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

The browser comes from `tests/browser.js`: `PW_CHROME` if set, else CI's pinned Chromium,
else a Chrome or Edge already on the machine, else Playwright's own download
(`npx playwright install chromium`). A Windows or Mac laptop with Chrome installed needs
nothing beyond `npm install playwright`.

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
| `gate.test.js` | The front door: every page locked without the code, the page underneath genuinely hidden, a wrong code refused, the code remembered across pages and reloads — and that it stays a sign rather than a lock, by asserting it knows nothing about the endpoint key and a locked page has fetched no roster |
| `confirm.test.js` | The chicken-dinner button: not offered after one wheel, what it posts, that a re-spin re-arms it and re-spinning onto the same person does not, that a new date is a new morning, and that a refused key or dead endpoint is shown and retryable |
| `central.test.js` | The shared document store from the browser: a device with no folder saving and reading a board archive, `readAll` reaching it so the group report works, the folder still winning on read and a listing being the union of both — and that nothing identified (`working/`, `manifests/`, the live board autosave) is ever sent to it |
| `stt.test.js` | The transcriber: a real recording off a (virtual) microphone through the real whisper model served from this repo, the transcript saved into the submission and read by the rollup, an undecodable file failing with a sentence, and nothing written to localStorage. Needs the fake-audio launch flags, which the suite sets itself. |
| `qr.test.js` | The QR encoder: the published format and version strings, version selection at every capacity boundary, and an independent reader — sharing no code with the encoder — that reverses the mask and the zigzag and reads the text back, at every mask. Fixtures were decoded with a real decoder when generated. Plain `node`, no browser. |
| `baseline.test.js` | The pre-intervention evaluation: that the form is its content file rendered, that the four year-group buttons are required and the link never presses one for you, that a reversed item is stored as it was ticked and turned round only in the read-out, that "no basis to judge" never becomes a middle opinion, the identifier gate, a group of fewer than three suppressed in every cell and its written answers withheld, the straight-lining and acquiescence counts, and two instruments sharing one post box without either taking the other's |
| `feedback.test.js` | Dictation and recording into the boxes, the identifier gate, the rollup arithmetic, one model call per unit, that a recording is discarded unless it was asked for, a phone with no folder posting to the endpoint, and a collection landing it in the folder and emptying the endpoint |
| `qr.test.js` | The QR encoder: the published format and version strings, version selection at every capacity boundary, and an independent reader — sharing no code with the encoder — that reverses the mask and the zigzag and reads the text back, at every mask. Fixtures were decoded with a real decoder when generated. Plain `node`, no browser. |
| `appsscript.test.js` | `server/Code.gs` run in node with the Google globals stubbed: the key gate, name resolution in every form a chief might type, date cells, the seed round-trip, the confirmed draw, and the feedback post box — that the weak key submits and cannot read the roster or drain, and that a collection empties it. No browser and no network — run it with plain `node`. |

## The fake file system

`fakefs.js` stands in for the File System Access API and IndexedDB, backed by
`localStorage` so a second tab sees the same folder — which is how the two-machine test
in `roster.test.js` works. It is test scaffolding. The product keeps no DATA in `localStorage` and
`site.test.js` asserts that, allowing exactly two named keys: the front-door code and
the shared-roster endpoint settings when someone asks to be remembered. Anything else
appearing there fails the sweep.

`roles.test.js` edits `content/roles.json` in place to run the acceptance test from the
spec, and restores it in a `finally`. If it is killed mid-run, check that file with
`git diff` before doing anything else.
