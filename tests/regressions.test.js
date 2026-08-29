'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* Bug #1: <html data-theme="dark"> used to match the click delegate's
   [data-theme] selector, so ANY click that bubbled all the way up to
   <html> (empty space, gaps between cards, etc.) was treated as if the
   user had tapped a theme button and opened Settings. Fixed by renaming
   the button attribute to data-settheme AND excluding <html>/<body> from
   the delegate outright — both of those must hold, so this checks both. */
test('click delegate: a click that bubbles to <html> (data-theme lives there) does not navigate anywhere', () => {
  const dom = loadApp();
  const { document } = dom.window;
  const startingRoute = dom.window.__test.route.name;

  const evt = new dom.window.MouseEvent('click', { bubbles: true });
  document.documentElement.dispatchEvent(evt);

  assert.equal(dom.window.__test.route.name, startingRoute, 'a click landing on <html> must never be treated as a navigation/action target');
});

test('click delegate: a click on <body> itself is likewise ignored', () => {
  const dom = loadApp();
  const startingRoute = dom.window.__test.route.name;
  const evt = new dom.window.MouseEvent('click', { bubbles: true });
  dom.window.document.body.dispatchEvent(evt);
  assert.equal(dom.window.__test.route.name, startingRoute);
});

test('click delegate: a real [data-settheme] button still works — the fix did not break theme switching', () => {
  const dom = loadApp();
  const { document } = dom.window;
  const btn = document.createElement('button');
  btn.setAttribute('data-settheme', 'light');
  document.body.appendChild(btn);

  btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));

  assert.equal(dom.window.__test.db.prefs.theme, 'light');
  assert.equal(document.documentElement.dataset.theme, 'light', 'applyTheme() must actually run as a result');
});

/* Bug #7: a bulk-select action bar injected by Select… mode survived
   navigating to a different page and sat there eating taps meant for the
   new page underneath it. go() now force-removes any leftover #bulkbar. */
test('go(): removes a leftover #bulkbar left over from a previous page\'s multi-select mode', () => {
  const dom = loadApp();
  const { document } = dom.window;
  const stray = document.createElement('div');
  stray.id = 'bulkbar';
  document.body.appendChild(stray);

  assert.ok(document.getElementById('bulkbar'), 'sanity: the stray bar exists before navigating');
  dom.window.go('home');
  assert.equal(document.getElementById('bulkbar'), null, 'go() must clean up a stale bulk-select bar on every navigation');
});

test('go(): closes an open bottom sheet when navigating away, so it can\'t linger over the next page', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'A Show', eps: [] };
  dom.window.openLinkSheet('s1');
  assert.ok(dom.window.document.getElementById('sheet').classList.contains('on'), 'sanity: the sheet is open');

  dom.window.go('home');
  assert.equal(dom.window.document.getElementById('sheet').classList.contains('on'), false);
});

/* Bug #10: a sheet used to close over the series object it was opened
   with; if a cloud sync replaced `db` mid-edit, saving wrote into a
   detached, stale object that no longer belonged to the live db. The
   fix looks the record up again at save time, not at open time. */
test('exact-link save: looks the record up at save time, so a db swap between open and save still lands correctly', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'Original', eps: [] };
  dom.window.openLinkSheet('s1');

  // simulate a cloud sync replacing the whole db object while the sheet is open —
  // a NEW show record for the same id, not the one that was live when the sheet opened
  t.db = Object.assign({}, t.db, { shows: Object.assign({}, t.db.shows, {
    s1: { id: 's1', name: 'Original', eps: [], note: 'came from a sync mid-edit' }
  }) });

  const box = dom.window.document.getElementById('linkBox');
  box.value = 'https://example.com/after-sync';
  dom.window.document.getElementById('linkGo').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));

  assert.equal(t.db.shows.s1.link, 'https://example.com/after-sync', 'the save must land on the CURRENT db.shows.s1, not a detached reference from when the sheet opened');
  assert.equal(t.db.shows.s1.note, 'came from a sync mid-edit', 'and it must not have clobbered fields the sync brought in');
});
