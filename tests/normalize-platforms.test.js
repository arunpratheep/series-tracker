'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

test('normalizePlatforms: a fresh/empty list is seeded from DEFAULT_PLATFORMS with order and active set', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const data = { platforms: [] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms.length, t.DEFAULT_PLATFORMS.length);
  data.platforms.forEach((p, i) => {
    assert.equal(p.order, i);
    assert.equal(p.active, true);
  });
  assert.ok(data.platforms.some(p => p.id === 'jiohotstar'));
});

test('normalizePlatforms: backfills missing order/active on existing entries without touching the rest', () => {
  const dom = loadApp();
  const data = { platforms: [
    { id: 'netflix', name: 'Netflix', color: '#E50914', search: 'https://netflix.example/{q}' }
  ] };
  dom.window.normalizePlatforms(data);
  const p = data.platforms[0];
  assert.equal(p.order, 0);
  assert.equal(p.active, true);
  assert.equal(p.search, 'https://netflix.example/{q}', 'an existing search URL must not be clobbered');
});

test('normalizePlatforms: search:null is backfilled from DEFAULT_PLATFORMS by id', () => {
  const dom = loadApp();
  const data = { platforms: [
    { id: 'netflix', name: 'Netflix', color: '#E50914', order: 0, active: true, search: null }
  ] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms[0].search, dom.window.__test.DEFAULT_PLATFORMS.find(p => p.id === 'netflix').search);
});

test('normalizePlatforms: an id with no DEFAULT_PLATFORMS match and search:null falls back to empty string', () => {
  const dom = loadApp();
  const data = { platforms: [
    { id: 'homemade-vhs-rack', name: 'VHS Rack', color: '#000', order: 0, active: true, search: null }
  ] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms[0].search, '');
});

test('normalizePlatforms: jiohotstar shipped-empty search string gets backfilled to the real URL (one-time migration)', () => {
  const dom = loadApp();
  // search:'' (not null) is exactly the shape devices that installed before
  // the real URL was known are stuck with — the null-check alone can't see it.
  const data = { platforms: [
    { id: 'jiohotstar', name: 'JioHotstar', color: '#1A73E8', order: 2, active: true, search: '' }
  ] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms[0].search, 'https://www.hotstar.com/in/search?search_query={q}');
});

test('normalizePlatforms: a user-customized jiohotstar search URL is preserved, not overwritten', () => {
  const dom = loadApp();
  const data = { platforms: [
    { id: 'jiohotstar', name: 'JioHotstar', color: '#1A73E8', order: 2, active: true, search: 'https://my-own-mirror.example/{q}' }
  ] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms[0].search, 'https://my-own-mirror.example/{q}');
});

test('normalizePlatforms: "Other / TV" stays permanently blank — the jiohotstar rule must not leak to other ids', () => {
  const dom = loadApp();
  const data = { platforms: [
    { id: 'other', name: 'Other / TV', color: '#8992B4', order: 14, active: true, search: '' }
  ] };
  dom.window.normalizePlatforms(data);
  assert.equal(data.platforms[0].search, '');
});
