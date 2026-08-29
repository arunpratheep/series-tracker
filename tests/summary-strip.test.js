'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* The home summary strip (Total / Watching / Not started / On hold /
   Completed) rendered as inert <div>s with no handler, so tapping a count
   did nothing at all. Each box now opens the library filtered to that
   status, and the list it lands on must match the number that was tapped. */

const PAST = '2020-01-01';

function seedLibrary(dom){
  const t = dom.window.__test;
  function mk(id, name, eps, watched, extra){
    t.db.shows[id] = Object.assign({ id, name, eps, hold: null, platform: 'netflix' }, extra || {});
    const w = {};
    (watched || []).forEach((epId, i) => { w[epId] = 1700000000000 + i; });
    t.db.watched[id] = w;
  }
  t.db.shows = {}; t.db.watched = {};
  mk('a', 'Watching One', [[1, 1, 1, PAST, 40, 'x'], [2, 1, 2, PAST, 40, 'y']], [1]);
  mk('b', 'Watching Two', [[3, 1, 1, PAST, 40, 'x'], [4, 1, 2, PAST, 40, 'y']], [3]);
  mk('c', 'Fresh',        [[5, 1, 1, PAST, 40, 'x']], []);
  mk('d', 'Held',         [[6, 1, 1, PAST, 40, 'x']], [], { hold: { since: Date.now() } });
  mk('e', 'Done',         [[7, 1, 1, PAST, 40, 'x']], [7]);
}

test('summary strip: every box is a real button carrying its status', () => {
  const dom = loadApp();
  seedLibrary(dom);
  dom.window.go('home');
  const boxes = [...dom.window.document.querySelectorAll('.summary-strip > *')];
  assert.equal(boxes.length, 5);
  boxes.forEach(b => assert.equal(b.tagName, 'BUTTON', 'an inert <div> cannot be tapped — these must be buttons'));
  assert.deepEqual(boxes.map(b => b.dataset.sumstatus), ['all', 'watching', 'new', 'hold', 'done']);
});

test('summary strip: tapping a box opens the library filtered to that status', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  seedLibrary(dom);
  dom.window.go('home');

  const box = dom.window.document.querySelector('.summary-strip [data-sumstatus="watching"]');
  box.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(t.route.name, 'library', 'it must navigate, not just re-render the home view');
  assert.equal(dom.window.document.querySelectorAll('#main .scard').length, 2);
});

test('summary strip: the count shown on a box matches how many series you land on', () => {
  const dom = loadApp();
  seedLibrary(dom);
  for(const status of ['all', 'watching', 'new', 'hold', 'done']){
    dom.window.go('home');
    const box = dom.window.document.querySelector('.summary-strip [data-sumstatus="' + status + '"]');
    const promised = Number(box.querySelector('b').textContent);
    box.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    const shown = dom.window.document.querySelectorAll('#main .scard').length;
    assert.equal(shown, promised, `"${status}" promised ${promised} series but the library showed ${shown}`);
  }
});

test('summary strip: tapping clears stale platform/genre/favourite filters and any active search', () => {
  // Otherwise the library shows fewer series than the number just tapped,
  // because those counts are computed across the whole library.
  const dom = loadApp();
  const t = dom.window.__test;
  seedLibrary(dom);
  dom.window.eval('libFilter = { status:"all", platform:"prime", genre:"Comedy", fav:true }; findQuery = "zzz";');
  dom.window.go('home');

  const box = dom.window.document.querySelector('.summary-strip [data-sumstatus="all"]');
  box.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(dom.window.document.querySelectorAll('#main .scard').length, 5, 'all 5 series must show, not a subset left over from an old filter');
});
