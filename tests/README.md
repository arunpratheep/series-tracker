# SPINE test suite

Runs the app's actual `index.html` inline script inside jsdom — not a
reimplementation of its logic, the real file — so these tests fail the
moment behaviour drifts from what's asserted here.

## Running

```
npm install
npm test
```

No build step and no changes to `index.html` are needed to run these; the
harness loads it as-is. Adding a test suite does not change the fact that
the deployed artifact is still one static HTML file — `package.json`,
`node_modules/`, and `tests/` are dev-only and irrelevant to what GitHub
Pages serves.

## How it works (`harness.js`)

`loadApp(seed)` extracts the single classic `<script>` block from
`index.html` (skipping the `type="module"` Firebase block, which pulls
from a CDN and isn't needed for logic tests) and evaluates it in a fresh
jsdom window per call, with a minimal DOM skeleton providing the element
ids the script touches at load time (`#nav`, `#main`, `#sheet`, `#scrim`,
`#toast`, the three top-bar buttons).

Top-level `function` declarations in the app (`unwrapLink`,
`normalizePlatforms`, `progress`, `matchPlatform`, `watchLink`,
`encodeForCloud`, `decodeFromCloud`, `createHousehold`, `joinHousehold`,
`save`, `go`, ...) attach directly onto `window` and are callable as
`dom.window.someFunction(...)`.

Top-level `let`/`const` bindings (`db`, `BUILD`, `PROVIDER_ALIASES`,
`lastLocalEdit`, `fb`, `cloudUser`, `householdId`, ...) do **not** survive
across separate `window.eval()` calls the way they would across `<script>`
tags in a real page — jsdom gives each `eval()` call its own lexical
environment for those. So the harness appends a small snippet to the
*same* eval call that runs the app script, exposing what tests need as
getters/setters on `window.__test` (`dom.window.__test.db`,
`.BUILD`, `.fb = mockFb`, etc.) instead.

`tests/mock-firebase.js` provides a minimal Firestore stand-in
(`makeMockFb()`, `fakeSnapshot()`) used by the household and save-race
tests — it records every write in order (call-order bugs, like household
creation writing docs in the wrong sequence, are otherwise invisible to a
real Firestore emulator too) and does a recursive merge for
`{merge:true}` writes, matching real Firestore's nested-map merge
behaviour.

## What's covered

- `unwrap-link.test.js` — JustWatch clickout decoding (both the old `?r=`
  and newer `?cx=` base64 formats), Netflix `preventIntent` stripping
- `normalize-platforms.test.js` — default seeding, field backfill, the
  jiohotstar one-time search-URL migration, user customization preserved
- `migration-v2.test.js` — the v2 → v3 localStorage migration
- `cloud-encode.test.js` — `encodeForCloud`/`decodeFromCloud`, the
  nested-array-to-JSON-string dance Firestore requires
- `progress.test.js` — derived series status (new/watching/done/hold),
  aired-vs-unaired counting, specials exclusion
- `platform-match.test.js` — TMDB provider-name matching, `watchLink()`'s
  exact-link → search-URL → TMDB-watchpage priority
- `save-race.test.js` — the save/cloud-sync race (bug #8) and the
  temporal-dead-zone hazard around it (bug #9)
- `households.test.js` — household creation write order (bug #4),
  seeding from local data instead of starting blank (bug #3), join-by-code
- `regressions.test.js` — the `data-theme`/`data-settheme` click-delegate
  collision (bug #1), stray bulk-select bar cleanup (bug #7), stale
  object references across a sync (bug #10)

See `CLAUDE_CONTEXT.md` (kept outside the repo, in the assistant's
context) for the full bug list and behavioural contract these guard.
