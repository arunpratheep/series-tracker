'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp, getStyles } = require('./harness');

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

/* The hidden toast sits at z-index 70 — above the sheet (61) — and
   opacity:0 does NOT stop hit-testing. Without pointer-events:none it
   forms an invisible band across the lower screen that swallows taps on
   whatever is under it, which is exactly where a bottom sheet's primary
   button lands. Every earlier test dispatched events straight at the
   element and so never saw this; these assert on hit-testing instead. */
/* Asserted against the stylesheet source rather than getComputedStyle:
   jsdom's cascade is too incomplete to resolve these rules (.toast comes
   back as position:static), so a computed-style assertion here would pass
   for the wrong reason and catch nothing. */
test('toast: is not hit-testable while hidden, so it cannot swallow taps beneath it', () => {
  const css = getStyles().replace(/\s+/g, ' ');
  const baseRule = /\.toast\s*\{([^}]*)\}/.exec(css);
  assert.ok(baseRule, 'a .toast rule must exist');
  assert.match(baseRule[1], /pointer-events:\s*none/, 'the hidden .toast must set pointer-events:none, or it intercepts taps meant for the sheet beneath it');

  const onRule = /\.toast\.on\s*\{([^}]*)\}/.exec(css);
  assert.ok(onRule, 'a .toast.on rule must exist');
  assert.match(onRule[1], /pointer-events:\s*auto/, '.toast.on must restore pointer-events so Undo stays clickable');
});

test('toast: becomes hit-testable again once shown, so its Undo button still works', () => {
  const dom = loadApp();
  let undone = false;
  dom.window.toast('Something happened', () => { undone = true; });
  const toast = dom.window.document.getElementById('toast');
  assert.ok(toast.classList.contains('on'), 'showing a toast must add the .on class that re-enables pointer events');
  const undoBtn = dom.window.document.getElementById('undoBtn');
  assert.ok(undoBtn, 'the toast must render an Undo button when given a callback');
  undoBtn.click();
  assert.equal(undone, true);
});

/* The exact-link input must stay pasteable. Disabling user-select on it
   (briefly tried as a fix for a mis-tap issue) blocks the paste bubble and
   caret placement on Samsung Internet / Chrome Android — pasting is how a
   link actually gets in here, so selection must never be disabled. */
test('exact-link input: text selection is NOT disabled — pasting must keep working', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'A Show', eps: [] };
  dom.window.openLinkSheet('s1');

  const box = dom.window.document.getElementById('linkBox');
  const inlineStyle = (box.getAttribute('style') || '').replace(/\s/g, '').toLowerCase();
  assert.equal(inlineStyle.includes('user-select:none'), false, 'user-select:none on the link input breaks pasting on mobile');
  assert.equal(inlineStyle.includes('touch-callout:none'), false, 'touch-callout:none suppresses the paste bubble on mobile');
});

/* If a paste silently fails the box reads '' — which used to be treated as
   "clear the link" and quietly destroyed an already-saved link. That looks
   identical to "saving does nothing", and also strips the Watch button of
   its link. Clearing must only happen via the explicit Remove link button. */
test('exact-link save: an empty box does NOT wipe a link that is already saved', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'A Show', eps: [], link: 'https://example.com/already-saved' };
  dom.window.openLinkSheet('s1');

  const box = dom.window.document.getElementById('linkBox');
  box.value = '';   // simulate a paste that silently didn't land
  dom.window.document.getElementById('linkGo').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));

  assert.equal(t.db.shows.s1.link, 'https://example.com/already-saved', 'an empty box must never destroy the saved link');
  assert.ok(dom.window.document.getElementById('sheet').classList.contains('on'), 'the sheet stays open so the user can retry the paste');
});

test('exact-link save: saving a real link still overwrites a previously saved one', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'A Show', eps: [], link: 'https://example.com/old' };
  dom.window.openLinkSheet('s1');

  const box = dom.window.document.getElementById('linkBox');
  box.value = 'https://example.com/new';
  dom.window.document.getElementById('linkGo').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));

  assert.equal(t.db.shows.s1.link, 'https://example.com/new');
});

test('exact-link save: a saved link is what watchLink() then hands the Watch button', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.platforms = [{ id: 'prime', name: 'Prime Video', search: 'https://primevideo.example/search?q={q}' }];
  t.db.shows.s1 = { id: 's1', name: 'A Show', eps: [], platform: 'prime' };
  dom.window.openLinkSheet('s1');

  const box = dom.window.document.getElementById('linkBox');
  box.value = 'https://app.primevideo.com/detail?gti=abc123';
  dom.window.document.getElementById('linkGo').dispatchEvent(new dom.window.PointerEvent('pointerdown', { bubbles: true }));

  const L = dom.window.watchLink('s1');
  assert.equal(L.url, 'https://app.primevideo.com/detail?gti=abc123', 'the Watch button must open the exact link just saved, not a platform search');
  assert.equal(L.exact, true);
});
