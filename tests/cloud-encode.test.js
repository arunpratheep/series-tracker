'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* Firestore forbids arrays-inside-arrays. eps is exactly that shape
   ([[id, season, number, airdate, runtime, name], ...]), so encodeForCloud
   must serialise it to a string and decodeFromCloud must parse it back —
   this is bug #2 in CLAUDE_CONTEXT.md's "already fixed" list, and a
   regression here means nothing with episodes in it can ever sync again. */

function sampleDb(dom){
  const t = dom.window.__test;
  t.db = {
    version: 3,
    platforms: t.DEFAULT_PLATFORMS.map((p, i) => Object.assign({ active: true, order: i }, p)),
    shows: {
      s1: {
        id: 's1', name: 'Show One', eps: [[1, 1, 1, '2020-01-01', 40, 'Ep 1'], [2, 1, 2, '2020-01-08', 42, 'Ep 2']],
        platform: 'netflix', favourite: true
      }
    },
    watched: { s1: { '1': 1700000000000 } },
    prefs: { theme: 'dark', sort: 'recent', showCompleted: true, lastTab: 'home' }
  };
  return t.db;
}

test('encodeForCloud: eps becomes a JSON string, never a nested array', () => {
  const dom = loadApp();
  const db = sampleDb(dom);
  const encoded = dom.window.encodeForCloud(db);
  assert.equal(typeof encoded.shows.s1.eps, 'string', 'eps must be serialised before it can reach Firestore');
  assert.equal(JSON.parse(encoded.shows.s1.eps).length, 2);
});

test('encodeForCloud + decodeFromCloud round-trips eps back into a real array with identical content', () => {
  const dom = loadApp();
  const db = sampleDb(dom);
  const decoded = dom.window.decodeFromCloud(dom.window.encodeForCloud(db));
  assert.ok(Array.isArray(decoded.shows.s1.eps));
  assert.equal(JSON.stringify(decoded.shows.s1.eps), JSON.stringify(db.shows.s1.eps));
});

test('encodeForCloud + decodeFromCloud round-trips watched, prefs and platforms untouched', () => {
  const dom = loadApp();
  const db = sampleDb(dom);
  const decoded = dom.window.decodeFromCloud(dom.window.encodeForCloud(db));
  assert.equal(JSON.stringify(decoded.watched), JSON.stringify(db.watched));
  assert.equal(decoded.prefs.theme, 'dark');
  assert.equal(decoded.platforms.length, db.platforms.length);
  assert.equal(decoded.shows.s1.favourite, true);
});

test('encodeForCloud: drops undefined fields rather than sending them to Firestore', () => {
  const dom = loadApp();
  const db = sampleDb(dom);
  db.shows.s1.someFutureField = undefined;
  const encoded = dom.window.encodeForCloud(db);
  assert.equal('someFutureField' in encoded.shows.s1, false);
});

test('decodeFromCloud: missing/empty cloud data still produces a valid, fully-shaped db (no throw)', () => {
  const dom = loadApp();
  const decoded = dom.window.decodeFromCloud(undefined);
  assert.equal(decoded.version, 3);
  assert.deepEqual(Object.keys(decoded.shows).length, 0);
  assert.ok(decoded.platforms.length > 0, 'decodeFromCloud must run normalizePlatforms on its output too');
  decoded.platforms.forEach(p => {
    assert.ok(p.order !== undefined && p.active !== undefined);
  });
});

test('decodeFromCloud: a show whose eps already arrived as a real array (not a string) is left as-is', () => {
  const dom = loadApp();
  const decoded = dom.window.decodeFromCloud({
    version: 3, platforms: [], watched: {}, prefs: {},
    shows: { s1: { id: 's1', name: 'X', eps: [[1, 1, 1, '2020-01-01', 40, 'Ep 1']] } }
  });
  assert.ok(Array.isArray(decoded.shows.s1.eps));
  assert.equal(decoded.shows.s1.eps.length, 1);
});

test('decodeFromCloud: unparseable eps string degrades to an empty array instead of throwing', () => {
  const dom = loadApp();
  const decoded = dom.window.decodeFromCloud({
    version: 3, platforms: [], watched: {}, prefs: {},
    shows: { s1: { id: 's1', name: 'X', eps: 'not valid json' } }
  });
  assert.deepEqual(decoded.shows.s1.eps.length, 0);
});

test('decodeFromCloud: jiohotstar backfill also applies to data arriving from the cloud, not just local boot', () => {
  // This is the exact shape of the "migration only ran on local boot" bug
  // (#5): a fix that only touches boot() silently regresses the moment
  // sync brings data down through decodeFromCloud() instead.
  const dom = loadApp();
  const decoded = dom.window.decodeFromCloud({
    version: 3, watched: {}, prefs: {}, shows: {},
    platforms: [{ id: 'jiohotstar', name: 'JioHotstar', color: '#1A73E8', order: 2, active: true, search: '' }]
  });
  assert.equal(decoded.platforms[0].search, 'https://www.hotstar.com/in/search?search_query={q}');
});
