'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

test('matchPlatform: an exact (case/punctuation-insensitive) name match against the user\'s own list wins', () => {
  const dom = loadApp();
  dom.window.__test.db.platforms = [{ id: 'p1', name: 'My Netflix Mirror' }];
  assert.equal(dom.window.matchPlatform('my netflix mirror'), 'p1');
});

test('matchPlatform: falls back to the alias table when there is no direct name match', () => {
  const dom = loadApp();
  // user has the real 'jiohotstar' platform in their list under its normal name
  dom.window.__test.db.platforms = [{ id: 'jiohotstar', name: 'JioHotstar' }];
  assert.equal(dom.window.matchPlatform('Disney+ Hotstar'), 'jiohotstar');
  assert.equal(dom.window.matchPlatform('JioCinema'), 'jiohotstar');
});

test('matchPlatform: an alias only resolves if the user actually has that platform id in their list', () => {
  const dom = loadApp();
  dom.window.__test.db.platforms = [{ id: 'netflix', name: 'Netflix' }];   // no jiohotstar entry at all
  assert.equal(dom.window.matchPlatform('Disney+ Hotstar'), null);
});

test('matchPlatform: an unrecognised provider name with no alias and no name match returns null', () => {
  const dom = loadApp();
  dom.window.__test.db.platforms = [{ id: 'netflix', name: 'Netflix' }];
  assert.equal(dom.window.matchPlatform('Some Obscure Regional Service'), null);
});

test('matchPlatform: empty/falsy provider name returns null without throwing', () => {
  const dom = loadApp();
  assert.equal(dom.window.matchPlatform(''), null);
  assert.equal(dom.window.matchPlatform(null), null);
});

test('watchLink: a user-pasted exact link always wins, even over a configured search URL', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.platforms = [{ id: 'netflix', name: 'Netflix', search: 'https://netflix.example/search?q={q}' }];
  t.db.shows.s1 = { id: 's1', name: 'A Show', platform: 'netflix', link: 'https://netflix.example/watch/exact123' };
  const L = dom.window.watchLink('s1');
  assert.equal(L.url, 'https://netflix.example/watch/exact123');
  assert.equal(L.exact, true);
});

test('watchLink: falls back to the platform\'s search URL, substituting {q} with the encoded show name', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.platforms = [{ id: 'netflix', name: 'Netflix', search: 'https://netflix.example/search?q={q}' }];
  t.db.shows.s1 = { id: 's1', name: 'The Family Man', platform: 'netflix' };
  const L = dom.window.watchLink('s1');
  assert.equal(L.url, 'https://netflix.example/search?q=' + encodeURIComponent('The Family Man'));
  assert.equal(L.exact, false);
  assert.equal(L.viaTmdb, undefined);
});

test('watchLink: with no exact link and no search URL, falls back to the TMDB watch page', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.platforms = [{ id: 'jiohotstar', name: 'JioHotstar', search: '' }];
  t.db.shows.s1 = { id: 's1', name: 'A Show', platform: 'jiohotstar', watchPage: 'https://www.themoviedb.org/tv/1/watch' };
  const L = dom.window.watchLink('s1');
  assert.equal(L.url, 'https://www.themoviedb.org/tv/1/watch');
  assert.equal(L.viaTmdb, true);
});

test('watchLink: no link, no search URL, no watch page at all -> null (caller shows "set a platform first")', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.platforms = [{ id: 'other', name: 'Other / TV', search: '' }];
  t.db.shows.s1 = { id: 's1', name: 'A Show', platform: 'other' };
  assert.equal(dom.window.watchLink('s1'), null);
});

test('watchLink: no platform set at all on the show -> null', () => {
  const dom = loadApp();
  dom.window.__test.db.shows.s1 = { id: 's1', name: 'A Show' };
  assert.equal(dom.window.watchLink('s1'), null);
});

test('watchLink: unknown show id returns null instead of throwing', () => {
  const dom = loadApp();
  assert.equal(dom.window.watchLink('nope'), null);
});
