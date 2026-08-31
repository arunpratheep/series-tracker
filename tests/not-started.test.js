'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* "Watch again" only ever appears for a fully completed series, so there
   was no way to reset a partially-watched or on-hold series back to Not
   Started short of un-ticking every episode by hand. "Mark as not
   started" fills that gap for the other two statuses. */

function seedShow(dom, id, watchedIds, extra){
  const t = dom.window.__test;
  t.db.shows[id] = Object.assign({ id, name: 'Show ' + id, hold: null }, extra || {});
  t.db.shows[id].eps = [[1,1,1,'2020-01-01',40,'Ep1'], [2,1,2,'2020-01-01',40,'Ep2']];
  const w = {};
  (watchedIds || []).forEach((epId, i) => { w[epId] = 1700000000000 + i; });
  t.db.watched[id] = w;
}

function clickData(dom, attr, value){
  const el = dom.window.document.createElement('button');
  el.setAttribute(attr, value);
  dom.window.document.body.appendChild(el);
  el.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
}

test('menu: "Mark as not started" is offered while watching, not while already new', () => {
  const dom = loadApp();
  seedShow(dom, '1', [1]);   // status: watching
  dom.window.openMenu('1');
  let html = dom.window.document.getElementById('sheet').innerHTML;
  assert.ok(html.includes('Mark as not started'), 'must be offered for a "watching" show');

  dom.window.__test.db.watched['1'] = {};   // status: new
  dom.window.openMenu('1');
  html = dom.window.document.getElementById('sheet').innerHTML;
  assert.equal(html.includes('Mark as not started'), false, 'must not be offered for a show already at "new"');
});

test('mark as not started: clears watched episodes on a "watching" show', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, '1', [1]);
  dom.window.confirm = () => true;
  clickData(dom, 'data-notstarted', '1');

  assert.equal(Object.keys(t.db.watched['1']).length, 0);
  assert.equal(dom.window.progress('1').status, 'new');
});

test('mark as not started: also clears hold, unlike "Watch again"', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, '1', [1], { hold: { since: Date.now(), reason: 'taking a break' } });
  assert.equal(dom.window.progress('1').status, 'hold', 'sanity: hold overrides watching');

  dom.window.confirm = () => true;
  clickData(dom, 'data-notstarted', '1');

  assert.equal(t.db.shows['1'].hold, null, 'hold must be cleared, or the show would still read as on hold');
  assert.equal(dom.window.progress('1').status, 'new');
});

test('mark as not started: declining the confirm dialog changes nothing', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, '1', [1]);
  dom.window.confirm = () => false;
  clickData(dom, 'data-notstarted', '1');

  assert.deepEqual(t.db.watched['1'], { '1': 1700000000000 }, 'declining must leave watch progress untouched');
});

test('mark as not started: undo restores both watched episodes and hold', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, '1', [1, 2], { hold: { since: 123, reason: 'x' } });
  dom.window.confirm = () => true;
  let undoFn = null;
  dom.window.toast = (msg, fn) => { undoFn = fn; };
  clickData(dom, 'data-notstarted', '1');

  assert.equal(Object.keys(t.db.watched['1']).length, 0);
  assert.ok(undoFn, 'toast must offer an undo callback');
  undoFn();

  assert.equal(JSON.stringify(t.db.watched['1']), JSON.stringify({ '1': 1700000000000, '2': 1700000000001 }));
  assert.equal(JSON.stringify(t.db.shows['1'].hold), JSON.stringify({ since: 123, reason: 'x' }));
});

test('mark as not started: leaves a fully completed show\'s "Watch again" path working as before', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedShow(dom, '1', [1, 2]);   // both episodes watched -> status "done"
  assert.equal(dom.window.progress('1').status, 'done');
  dom.window.openMenu('1');
  const html = dom.window.document.getElementById('sheet').innerHTML;
  assert.ok(html.includes('Watch again'), 'the existing completed-show path must be unaffected');
  assert.ok(html.includes('Mark as not started'), 'and the new option must also be offered here (status !== new)');
});
