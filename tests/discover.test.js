'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* Discover was rebuilt because TMDB's own /recommendations for a single
   show clusters hard by genre — verified live against the real API:
   Friends' recommendations are almost entirely 90s sitcoms. Aggregating
   across every tracked show as a weighted "seed", then capping how many
   uncorroborated picks any one seed can contribute, is what actually
   fixes "I watched Friends, don't give me 5 more sitcoms". */

function seedShow(dom, id, name, tmdbId, episodeCount, extra){
  const t = dom.window.__test;
  t.db.shows[id] = Object.assign({
    id, name, tmdbId, touched: Date.now(),
    eps: Array.from({ length: episodeCount }, (_, i) => [1000 * id + i, 1, i + 1, '2020-01-01', 22, 'Ep' + (i + 1)])
  }, extra || {});
  const w = {};
  for(let i = 0; i < episodeCount; i++) w[1000 * id + i] = Date.now();
  t.db.watched[id] = w;
}

function stubGenres(dom){
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/genre/tv/list')) return { genres: [{ id: 35, name: 'Comedy' }, { id: 18, name: 'Drama' }] };
    return orig ? orig(path) : { results: [] };
  };
}

test('seedProfile: episodes watched drives weight, heaviest show first', () => {
  const dom = loadApp();
  seedShow(dom, 1, 'Friends', 1668, 20);
  seedShow(dom, 2, 'Breaking Bad', 1396, 2);
  const seeds = dom.window.seedProfile();
  assert.equal(seeds[0].rec.name, 'Friends');
  assert.equal(seeds[1].rec.name, 'Breaking Bad');
  assert.ok(seeds[0].weight > seeds[1].weight);
});

test('seedProfile: a show with zero watched episodes is not a seed', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows[1] = { id: 1, name: 'Untouched', tmdbId: 1, eps: [[1,1,1,'2020-01-01',20,'x']] };
  t.db.watched[1] = {};
  assert.equal(dom.window.seedProfile().length, 0);
});

test('buildDiscover: a single seed cannot flood the list — caps at 3 uncorroborated picks', async () => {
  const dom = loadApp();
  seedShow(dom, 1, 'Friends', 1668, 20);
  stubGenres(dom);
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/1668/recommendations')){
      return { results: Array.from({ length: 10 }, (_, i) => ({
        id: 9000 + i, name: 'Sitcom ' + i, genre_ids: [35], vote_average: 7, poster_path: '/x.jpg', overview: 'x'
      })) };
    }
    return orig(path);
  };

  const built = await dom.window.buildDiscover();
  assert.equal(built.recs.length, 3, 'exactly 3 uncorroborated picks from the one seed, not all 10');
  assert.ok(built.recs.every(r => r.because[0] === 'Friends'));
});

test('buildDiscover: a candidate recommended by two distinct seeds outranks single-seed picks and is exempt from the cap', async () => {
  const dom = loadApp();
  seedShow(dom, 1, 'Friends', 1668, 20);
  seedShow(dom, 2, 'How I Met Your Mother', 1669, 15);
  stubGenres(dom);
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/1668/recommendations')){
      return { results: [
        ...Array.from({ length: 4 }, (_, i) => ({ id: 9000 + i, name: 'FriendsOnly ' + i, genre_ids: [35], vote_average: 7, poster_path: '/x.jpg', overview: 'x' })),
        { id: 5000, name: 'Shared Pick', genre_ids: [35], vote_average: 8, poster_path: '/x.jpg', overview: 'x' }
      ] };
    }
    if(path.includes('/1669/recommendations')){
      return { results: [
        { id: 5000, name: 'Shared Pick', genre_ids: [35], vote_average: 8, poster_path: '/x.jpg', overview: 'x' },
        { id: 6000, name: 'HIMYM Only', genre_ids: [18], vote_average: 7, poster_path: '/x.jpg', overview: 'x' }
      ] };
    }
    return orig(path);
  };

  const built = await dom.window.buildDiscover();
  assert.equal(built.recs[0].name, 'Shared Pick', 'cross-seed corroboration must rank above a single seed\'s own top pick');
  assert.equal(built.recs[0].corroboration, 2);
  assert.equal(JSON.stringify(built.recs[0].because), JSON.stringify(['Friends', 'How I Met Your Mother']));
  const friendsOnlyCount = built.recs.filter(r => r.name.startsWith('FriendsOnly')).length;
  assert.equal(friendsOnlyCount, 3, 'the 4th uncorroborated Friends pick must still be capped even with a corroborated candidate present');
  assert.ok(built.recs.some(r => r.name === 'HIMYM Only'), 'the second seed\'s own unique pick must still get through (well under its own cap)');
});

test('buildDiscover: a show already in the library is never recommended', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, 1, 'Friends', 1668, 20);
  t.db.shows[2] = { id: 2, name: 'Already Tracked', tmdbId: 9000, eps: [] };   // tmdbId matches a "recommendation" below
  stubGenres(dom);
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/1668/recommendations')){
      return { results: [
        { id: 9000, name: 'Already Tracked', genre_ids: [35], vote_average: 7, poster_path: '/x.jpg', overview: 'x' },
        { id: 9001, name: 'New Show', genre_ids: [35], vote_average: 7, poster_path: '/x.jpg', overview: 'x' }
      ] };
    }
    return orig(path);
  };

  const built = await dom.window.buildDiscover();
  assert.equal(built.recs.some(r => r.name === 'Already Tracked'), false);
  assert.ok(built.recs.some(r => r.name === 'New Show'));
});

test('buildDiscover: a show already tracked under a different tmdbId is still excluded by name', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, 1, 'Friends', 1668, 20);
  t.db.shows[2] = { id: 2, name: 'Some Show', tmdbId: null, eps: [] };   // no tmdbId cached yet
  stubGenres(dom);
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/1668/recommendations')){
      return { results: [{ id: 7000, name: 'Some Show', genre_ids: [35], vote_average: 7, poster_path: '/x.jpg', overview: 'x' }] };
    }
    return orig(path);
  };

  const built = await dom.window.buildDiscover();
  assert.equal(built.recs.length, 0, 'name-based fallback dedup must catch it even without a cached tmdbId');
});

test('buildDiscover: one seed failing does not stop the others from contributing', async () => {
  const dom = loadApp();
  seedShow(dom, 1, 'Friends', 1668, 20);
  seedShow(dom, 2, 'Working Show', 1669, 10);
  stubGenres(dom);
  const orig = dom.window.tmdb;
  dom.window.tmdb = async function(path){
    if(path.includes('/1668/recommendations')) throw new Error('tmdb-http');
    if(path.includes('/1669/recommendations')){
      return { results: [{ id: 9001, name: 'Survivor', genre_ids: [18], vote_average: 7, poster_path: '/x.jpg', overview: 'x' }] };
    }
    return orig(path);
  };

  const built = await dom.window.buildDiscover();
  assert.ok(built.recs.some(r => r.name === 'Survivor'), 'a working seed must still produce results even if another seed\'s fetch throws');
});

test('loadDiscover: a fast cache hit still triggers a re-render, not just a data update', async () => {
  // Found live: the cache-hit branch updated discoverCache and returned
  // immediately WITHOUT calling viewDiscover() — so the UI stayed stuck
  // on "Load recommendations" even though the data had already arrived.
  // Only caught by driving the real DOM end to end; buildDiscover() alone
  // can't see this, since the bug is entirely in what loadDiscover() does
  // (or in this case, didn't do) with the result.
  const dom = loadApp();
  seedShow(dom, 1, 'Friends', 1668, 20);
  dom.window.go('discover');

  const signature = dom.window.seedProfile().slice(0, 8).map(s => s.rec.id).join(',');
  dom.window.localStorage.setItem('spine-discover-v2', JSON.stringify({
    at: Date.now(), seedSignature: signature,
    recs: [{ tmdbId: 1, name: 'Cached Pick', poster: null, genres: [], rating: 7, premiered: '2020', summary: 'x', because: ['Friends'], corroboration: 1 }]
  }));

  await dom.window.loadDiscover(false);

  const html = dom.window.document.getElementById('main').innerHTML;
  assert.ok(html.includes('Cached Pick'), 'a cache hit must render the cached recommendations, not leave the load button showing');
  assert.equal(html.includes('id="btnLoadDiscover"'), false);
});

test('viewDiscover: with no watched shows at all, shows the empty state rather than throwing', () => {
  const dom = loadApp();
  dom.window.go('discover');
  const html = dom.window.document.getElementById('main').innerHTML;
  assert.ok(html.includes('Watch something first'));
});

test('addFromDiscover: resolves a TMDB id to a real TVmaze show and adds it', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  dom.window.tmdb = async function(path){
    if(path.includes('/external_ids')) return { imdb_id: 'tt0108778' };
    return {};
  };
  const origFetch = dom.window.fetch;
  dom.window.fetch = async function(url){
    if(String(url).includes('/lookup/shows')) return { ok: true, json: async () => ({ id: 431, name: 'Friends' }) };
    return origFetch ? origFetch(url) : { ok: false };
  };
  dom.window.fetchShow = async function(id){
    return { id, name: 'Friends', _embedded: { episodes: [] } };
  };

  await dom.window.addFromDiscover(1668, null);
  assert.ok(t.db.shows['431'], 'the resolved TVmaze show must be added to the library');
});

test('addFromDiscover: a show TVmaze doesn\'t have fails gracefully with a toast, not a crash', async () => {
  const dom = loadApp();
  dom.window.tmdb = async function(){ return { imdb_id: null }; };   // no imdb id at all
  let toasted = null;
  dom.window.toast = (msg) => { toasted = msg; };

  await assert.doesNotReject(() => dom.window.addFromDiscover(999999, null));
  assert.ok(toasted, 'must toast an explanation rather than fail silently or throw');
});
