'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { JSDOM } = require('jsdom');
const fs = require('fs');
const path = require('path');
const { loadApp } = require('./harness');

/* migration runs from localStorage['spine-v2'], which loadApp()'s `seed`
   param can't target directly (it only seeds spine-v3) — so this file
   drives the harness's raw jsdom setup itself for the v2 case. */
function loadAppFromV2(v2Data){
  const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const start = html.indexOf('<script>');
  const script = html.slice(start + '<script>'.length, html.indexOf('</script>', start));
  const dom = new JSDOM(`<!doctype html><html><head></head><body>
    <nav id="nav"></nav>
    <header><button id="btnFind"></button><button id="btnAdd"></button><button id="btnSettings"></button></header>
    <main id="main"></main><div id="scrim"></div><div id="sheet"></div><div id="toast"></div>
  </body></html>`, { runScripts: 'outside-only', url: 'http://localhost/', pretendToBeVisual: true });
  dom.window.scrollTo = function(){};
  dom.window.localStorage.setItem('spine-v2', JSON.stringify(v2Data));
  dom.window.eval(script + `
;window.__test = { get db(){ return db; }, K3: K3, K2: K2 };
`);
  return dom;
}

const V2_FIXTURE = {
  platforms: [
    { id: 'netflix', name: 'Netflix', color: '#E50914', active: true },
    { id: 'prime', name: 'Prime Video', color: '#00A8E1', active: false }
  ],
  shows: {
    '100': {
      id: '100', name: 'Old Show', image: 'img.jpg', premiered: '2018-01-01',
      status: 'Ended', genres: ['Drama'], rating: 7.2, network: 'Some Network',
      summary: '<p>Summary</p>', eps: [[1, 1, 1, '2018-01-01', 45, 'Pilot']],
      platform: 'netflix', touched: 1700000000000, saved: true
    }
  },
  watched: {
    '100': {
      '1': 1,                 // legacy boolean-ish "watched" marker, no real timestamp
      '2': 1700000005000      // already a real timestamp (> 1_000_000)
    }
  }
};

test('migration: v2 shows carry across with all v3 fields defaulted', () => {
  const dom = loadAppFromV2(V2_FIXTURE);
  const db = dom.window.__test.db;
  assert.equal(db.version, 3);
  const show = db.shows['100'];
  assert.ok(show, 'show 100 must survive migration');
  assert.equal(show.name, 'Old Show');
  assert.equal(show.poster, 'img.jpg', 'poster falls back to the old image field');
  assert.equal(show.tvStatus, 'Ended', 'status renamed to tvStatus');
  assert.equal(show.platform, 'netflix');
  // show.eps is an Array from jsdom's realm, not Node's — deepEqual treats
  // cross-realm objects as unequal even with identical structure, so
  // compare through JSON instead.
  assert.equal(JSON.stringify(show.eps), JSON.stringify([[1, 1, 1, '2018-01-01', 45, 'Pilot']]));
  // fields that did not exist in v2 must come through with sane defaults
  assert.equal(show.favourite, false);
  assert.equal(show.pinned, false);
  assert.equal(show.priority, 0);
  assert.equal(show.note, '');
  assert.equal(show.hold, null);
  assert.equal(show.completedAt, null);
  assert.equal(show.saved, true, 'a v2 field that DID exist must be preserved, not defaulted over');
});

test('migration: v2 watched entries without a real timestamp are backfilled from the show\'s touched time', () => {
  const dom = loadAppFromV2(V2_FIXTURE);
  const db = dom.window.__test.db;
  assert.equal(db.watched['100']['1'], 1700000000000, 'boolean-ish "1" becomes the show\'s touched timestamp');
  assert.equal(db.watched['100']['2'], 1700000005000, 'an already-real timestamp is left untouched');
});

test('migration: platforms gain order/active even though v2 never had them', () => {
  const dom = loadAppFromV2(V2_FIXTURE);
  const db = dom.window.__test.db;
  const netflix = db.platforms.find(p => p.id === 'netflix');
  const prime = db.platforms.find(p => p.id === 'prime');
  assert.equal(netflix.order, 0);
  assert.equal(netflix.active, true);
  assert.equal(prime.active, false, 'an explicit v2 active:false must survive migration');
});

test('migration: spine-v2 is left on disk untouched as a fallback copy', () => {
  const dom = loadAppFromV2(V2_FIXTURE);
  const stillThere = dom.window.localStorage.getItem('spine-v2');
  assert.equal(stillThere, JSON.stringify(V2_FIXTURE));
});

test('migration: a v3 key present takes priority over v2 (no re-migration on every load)', () => {
  const dom = loadApp({ version: 3, platforms: [], shows: { keep: { id: 'keep' } }, watched: {}, prefs: {} });
  const db = dom.window.__test.db;
  assert.ok(db.shows.keep, 'v3 data must load as-is when present');
});

test('migration: a completely fresh install (no v2, no v3) boots to an empty, valid db', () => {
  const dom = loadApp();
  const db = dom.window.__test.db;
  assert.equal(db.version, 3);
  assert.equal(Object.keys(db.shows).length, 0);
  assert.equal(Object.keys(db.watched).length, 0);
  assert.ok(db.platforms.length > 0, 'fresh install still gets the default platform list');
});
