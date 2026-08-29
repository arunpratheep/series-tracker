'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* Series migrated from v2, and anything added by a build that predates
   storing the IMDb id, have no rec.imdb. lookupProviders() used to give up
   on that immediately, which left BOTH the platform and the TMDB watch page
   unset — so "All ways to watch in India" never appeared for those shows
   and re-running detection could never fix it. The IMDb id is now fetched
   from TVmaze on demand, since the record id IS the TVmaze id. */

/* Stubs the two network calls lookupProviders depends on. Both are plain
   top-level function declarations on window, so they can be replaced. */
function stubNetwork(dom, opts){
  const calls = { fetchShow: [], tmdb: [] };
  dom.window.fetchShow = async function(id){
    calls.fetchShow.push(id);
    if(opts.tvmazeFails) throw new Error('network');
    return { id, externals: { imdb: opts.imdbFromTvmaze } };
  };
  dom.window.tmdb = async function(path){
    calls.tmdb.push(path);
    if(path.indexOf('/find/') === 0) return { tv_results: [{ id: 108978 }] };
    return { results: { IN: {
      link: 'https://www.themoviedb.org/tv/108978-reacher/watch?locale=IN',
      flatrate: [{ provider_name: 'Amazon Prime Video' }]
    } } };
  };
  return calls;
}

test('lookupProviders: backfills a missing IMDb id from TVmaze instead of giving up', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['43031'] = { id: 43031, name: 'Reacher', eps: [], platform: 'prime' };   // no imdb, no tmdbId
  const calls = stubNetwork(dom, { imdbFromTvmaze: 'tt9288030' });

  const res = await dom.window.lookupProviders('43031');

  assert.deepEqual(calls.fetchShow, [43031], 'it must ask TVmaze for the record\'s own id to recover the IMDb id');
  assert.equal(t.db.shows['43031'].imdb, 'tt9288030', 'the recovered IMDb id must be stored back on the record');
  assert.equal(t.db.shows['43031'].tmdbId, 108978);
  assert.ok(res);
  assert.equal(res.platformId, 'prime');
});

test('lookupProviders: stores the TMDB watch page, which is what renders "All ways to watch"', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['43031'] = { id: 43031, name: 'Reacher', eps: [], platform: 'prime' };
  stubNetwork(dom, { imdbFromTvmaze: 'tt9288030' });

  await dom.window.lookupProviders('43031');

  assert.equal(t.db.shows['43031'].watchPage, 'https://www.themoviedb.org/tv/108978-reacher/watch?locale=IN');
});

test('lookupProviders: a record that already has an IMDb id does not re-fetch it from TVmaze', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['43031'] = { id: 43031, name: 'Reacher', eps: [], platform: 'prime', imdb: 'tt9288030' };
  const calls = stubNetwork(dom, { imdbFromTvmaze: 'tt9288030' });

  await dom.window.lookupProviders('43031');

  assert.deepEqual(calls.fetchShow, [], 'no TVmaze round-trip is needed when the IMDb id is already known');
});

test('lookupProviders: TVmaze being unreachable degrades to null rather than throwing', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['43031'] = { id: 43031, name: 'Reacher', eps: [], platform: 'prime' };
  stubNetwork(dom, { tvmazeFails: true });

  const res = await dom.window.lookupProviders('43031');
  assert.equal(res, null, 'the app must stay usable when TVmaze is down — detection just reports nothing');
});

test('lookupProviders: a show TVmaze has no IMDb id for returns null without a TMDB call', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['43031'] = { id: 43031, name: 'Obscure Show', eps: [] };
  const calls = stubNetwork(dom, { imdbFromTvmaze: null });

  const res = await dom.window.lookupProviders('43031');
  assert.equal(res, null);
  assert.deepEqual(calls.tmdb, [], 'there is nothing to match on, so TMDB must not be called at all');
});
