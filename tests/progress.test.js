'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

const PAST = '2020-01-01';
const FUTURE = '2999-01-01';

/* eps tuple shape: [epId, season, number, airdate, runtime, name] */
function seedShow(dom, id, eps, watchedIds, extra){
  const t = dom.window.__test;
  t.db.shows[id] = Object.assign({ id, name: 'Show ' + id, eps, hold: null }, extra || {});
  const w = {};
  (watchedIds || []).forEach((epId, i) => { w[epId] = 1700000000000 + i * 1000; });
  t.db.watched[id] = w;
}

test('progress: no episodes watched -> status "new", 0%', () => {
  const dom = loadApp();
  seedShow(dom, 'a', [[1, 1, 1, PAST, 40, 'Ep 1'], [2, 1, 2, PAST, 40, 'Ep 2']], []);
  const p = dom.window.progress('a');
  assert.equal(p.status, 'new');
  assert.equal(p.pct, 0);
  assert.equal(p.done, 0);
  assert.equal(p.next[0], 1, 'next should point at the first aired, unwatched episode');
});

test('progress: some aired episodes watched, more aired remain -> status "watching"', () => {
  const dom = loadApp();
  seedShow(dom, 'a', [
    [1, 1, 1, PAST, 40, 'Ep 1'], [2, 1, 2, PAST, 40, 'Ep 2'], [3, 1, 3, PAST, 40, 'Ep 3']
  ], [1]);
  const p = dom.window.progress('a');
  assert.equal(p.status, 'watching');
  assert.equal(p.done, 1);
  assert.equal(p.remaining, 2);
  assert.equal(p.next[0], 2, 'next should be episode 2, not 3, once 1 is watched');
});

test('progress: all AIRED episodes watched, but the show is still running with unaired ones -> "done" (caught up)', () => {
  const dom = loadApp();
  seedShow(dom, 'a', [
    [1, 1, 1, PAST, 40, 'Ep 1'], [2, 1, 2, PAST, 40, 'Ep 2'], [3, 1, 3, FUTURE, 40, 'Ep 3 (unaired)']
  ], [1, 2]);
  const p = dom.window.progress('a');
  assert.equal(p.status, 'done', 'derived status is "done" once every aired episode is watched, per the doc\'s "Caught up" behaviour');
  assert.equal(p.aired, 2, 'the unaired future episode must not count toward aired');
  assert.equal(p.total, 3, 'but it does count toward the total episode count');
  assert.equal(p.next, null, 'there is nothing aired left to watch next');
});

test('progress: on-hold overrides everything, even a fully-watched show', () => {
  const dom = loadApp();
  seedShow(dom, 'a', [[1, 1, 1, PAST, 40, 'Ep 1']], [1], { hold: { since: Date.now(), reason: 'taking a break' } });
  const p = dom.window.progress('a');
  assert.equal(p.status, 'hold');
});

test('progress: specials (season 0) are excluded from total/aired/done entirely', () => {
  const dom = loadApp();
  seedShow(dom, 'a', [
    [1, 0, 1, PAST, 20, 'Special'], [2, 1, 1, PAST, 40, 'Ep 1']
  ], [1]);   // only the special is watched
  const p = dom.window.progress('a');
  assert.equal(p.total, 1, 'the special must not be counted');
  assert.equal(p.done, 0, 'watching only the special leaves the counted total at 0 done');
  assert.equal(p.status, 'new');
});

test('progress: "last" picks the most recently marked-watched episode, not the highest episode number', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, 'a', [
    [1, 1, 1, PAST, 40, 'Ep 1'], [2, 1, 2, PAST, 40, 'Ep 2']
  ], []);
  // mark episode 2 watched first (earlier timestamp), then episode 1 later —
  // "last" should follow the timestamp, not array/episode order.
  t.db.watched.a = { '2': 1700000000000, '1': 1700000009999 };
  const p = dom.window.progress('a');
  assert.equal(p.last[0], 1, 'the higher timestamp (episode 1) must win as "last watched"');
});

test('progress: an unknown show id returns null instead of throwing', () => {
  const dom = loadApp();
  assert.equal(dom.window.progress('does-not-exist'), null);
});
