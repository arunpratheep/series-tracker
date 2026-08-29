'use strict';
/* Loads the app's actual inline <script> (the one, single classic script —
   not the `type="module"` Firebase block at the bottom, which pulls from a
   CDN and isn't needed for logic tests) into a fresh jsdom window per call.
   Testing the real file, not a re-implementation, is the point: these tests
   must fail the moment index.html's behaviour drifts from what's asserted. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const INDEX_HTML = path.join(__dirname, '..', 'index.html');

function extractMainScript(html){
  const openTag = '<script>';
  const start = html.indexOf(openTag);
  if(start === -1) throw new Error('No classic <script> tag found in index.html');
  const end = html.indexOf('</script>', start);
  if(end === -1) throw new Error('Unterminated <script> tag in index.html');
  return html.slice(start + openTag.length, end);
}

/* Reused across every load — reading + slicing the file each time is wasted
   work, and the extracted source never changes within a test run. */
let cachedScript = null;
function getMainScript(){
  if(cachedScript === null){
    const html = fs.readFileSync(INDEX_HTML, 'utf8');
    cachedScript = extractMainScript(html);
  }
  return cachedScript;
}

/* Returns a fresh jsdom `window` with the app fully booted (migration run,
   platforms normalized, first save() done) — exactly like a real page load
   with an empty or pre-seeded localStorage.
     seed: optional object written to localStorage under 'spine-v3' *before*
           the script runs, so boot() picks it up as if returning to the app. */
function loadApp(seed){
  const skeleton = `<!doctype html><html><head>
    <meta name="theme-color" content="#0D1220">
  </head><body>
    <nav id="nav"></nav>
    <header>
      <button id="btnFind"></button>
      <button id="btnAdd"></button>
      <button id="btnSettings"></button>
    </header>
    <main id="main"></main>
    <div id="scrim"></div>
    <div id="sheet"></div>
    <div id="toast"></div>
  </body></html>`;

  const dom = new JSDOM(skeleton, {
    runScripts: 'outside-only',   /* we inject + run the app script ourselves, below */
    url: 'http://localhost/',
    pretendToBeVisual: true
  });

  if(seed !== undefined){
    dom.window.localStorage.setItem('spine-v3', JSON.stringify(seed));
  }

  /* jsdom doesn't implement scrollTo/matchMedia's addEventListener fully;
     the app already tolerates a missing matchMedia, but scrollTo is called
     unconditionally by go(), so stub it before the script runs. Assigning
     directly onto `window` works across eval calls even though top-level
     let/const bindings don't (see note below) — property writes land on
     the shared global object, not a call-scoped lexical environment. */
  dom.window.scrollTo = function(){};

  /* fetch is used only inside async functions (tmdb(), corpus building),
     never at top-level boot, so a missing/absent one here is safe until a
     test explicitly calls one of those and needs to stub it in. */
  dom.window.eval(getMainScript() + EXPOSE_INTERNALS);

  return dom;
}

/* Top-level `function` declarations in the app script attach directly onto
   `window` and stay callable across separate eval() calls — that's how
   dom.window.unwrapLink(...) etc. work below. Top-level `let`/`const`
   bindings do NOT: jsdom's window.eval() gives each call its own lexical
   environment for those, unlike a real page where every <script> shares
   one. So anything declared with let/const that a test needs to read or
   mutate (db, BUILD, PROVIDER_ALIASES, ...) is re-exposed here as a plain
   property (or getter/setter, for things that get reassigned) on a single
   `window.__test` object, appended to and run as part of the SAME eval
   call that defines them — at that point they're all in scope normally. */
const EXPOSE_INTERNALS = `
;window.__test = {
  get db(){ return db; }, set db(v){ db = v; },
  get route(){ return route; },
  get cloudUser(){ return cloudUser; }, set cloudUser(v){ cloudUser = v; },
  get fb(){ return fb; }, set fb(v){ fb = v; },
  get householdId(){ return householdId; }, set householdId(v){ householdId = v; },
  get applyingRemote(){ return applyingRemote; }, set applyingRemote(v){ applyingRemote = v; },
  get lastLocalEdit(){ return lastLocalEdit; },
  BUILD: BUILD,
  BLANK: BLANK,
  DEFAULT_PLATFORMS: DEFAULT_PLATFORMS,
  PROVIDER_ALIASES: PROVIDER_ALIASES,
  K3: K3, K2: K2,
  TMDB_KEY: TMDB_KEY, TMDB_REGION: TMDB_REGION
};
`;

module.exports = { loadApp };
