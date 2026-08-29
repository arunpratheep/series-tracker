'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeMockFb, fakeSnapshot } = require('./mock-firebase');

/* Bug #8: save() used to debounce the localStorage write itself by 200ms,
   so an incoming Firestore snapshot landing inside that window could
   replace `db` and silently drop whatever the user just typed. Fixed by
   writing to localStorage synchronously and debouncing only the network
   push. These tests pin that behaviour down. */

test('save: writes to localStorage synchronously, with no debounce window at all', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'Test Show', link: 'https://example.com/x' };
  dom.window.save();
  // read back immediately — a debounced write would not be there yet
  const persisted = JSON.parse(dom.window.localStorage.getItem(t.K3));
  assert.equal(persisted.shows.s1.link, 'https://example.com/x');
});

test('save: updates lastLocalEdit to "now" on every call', () => {
  const dom = loadApp();
  const before = Date.now();
  dom.window.save();
  const t = dom.window.__test;
  assert.ok(t.lastLocalEdit >= before, 'lastLocalEdit must be bumped by save()');
  assert.ok(t.lastLocalEdit <= Date.now());
});

test('save: boot() itself can call save() with no temporal-dead-zone crash (bug #9 regression)', () => {
  // boot() runs as an IIFE at script-load time and calls save(), which now
  // reads lastLocalEdit — if that `let` weren't hoisted above boot(), this
  // would throw a ReferenceError before loadApp() ever returns.
  assert.doesNotThrow(() => loadApp());
});

test('household snapshot listener: a snapshot arriving within 4s of a local edit is deferred, not applied', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;
  t.cloudUser = { uid: 'me', email: 'me@example.com' };
  t.householdId = 'hid1';

  t.db.shows.mine = { id: 'mine', name: 'Local Edit', eps: [] };
  dom.window.save();   // sets lastLocalEdit to "now"

  dom.window.startHouseholdListeners('hid1');
  const onNext = mockFb.snapshotCallbacks.get('households/hid1');
  assert.ok(onNext, 'startHouseholdListeners must have registered a snapshot listener on the household doc');

  // A remote snapshot lands immediately after — well inside the 4s guard —
  // and does NOT carry our own pending write (hasPendingWrites: false),
  // so without the fix this would previously overwrite db.shows wholesale.
  const remoteData = { version: 3, platforms: [], watched: {}, prefs: {}, shows: { theirs: { id: 'theirs', name: 'Remote', eps: [] } } };
  onNext(fakeSnapshot(remoteData, { hasPendingWrites: false }));

  assert.ok(t.db.shows.mine, 'the local edit must survive a same-window remote snapshot');
  assert.equal(t.db.shows.theirs, undefined, 'the stale remote snapshot must not be applied while inside the guard window');

  // pushCloud() inside the guard is async (awaits fb.setDoc) — let its
  // microtask settle before checking it actually re-pushed our version
  // rather than just silently discarding the snapshot.
  await new Promise(resolve => setImmediate(resolve));
  assert.ok(mockFb.calls.some(c => c.op === 'setDoc' && c.path === 'households/hid1'), 'the guard must re-push the local state instead of just discarding the snapshot');
});

test('household snapshot listener: a snapshot arriving after the guard window has elapsed IS applied normally', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;
  t.householdId = 'hid1';

  // Fake the edit as having happened 10s ago by rolling Date.now() back for
  // just this one save() call, then restoring real time — so the guard's
  // "Date.now() - lastLocalEdit" comes out well past the 4s window.
  const realNow = dom.window.Date.now;
  dom.window.Date.now = () => realNow() - 10000;
  t.db.shows.mine = { id: 'mine', name: 'Local Edit', eps: [] };
  dom.window.save();
  dom.window.Date.now = realNow;

  dom.window.startHouseholdListeners('hid1');
  const onNext = mockFb.snapshotCallbacks.get('households/hid1');

  const remoteData = { version: 3, platforms: [], watched: {}, prefs: {}, shows: { theirs: { id: 'theirs', name: 'Remote', eps: [] } } };
  onNext(fakeSnapshot(remoteData, { hasPendingWrites: false }));

  assert.equal(t.db.shows.mine, undefined, 'once the guard window has elapsed, a remote snapshot replaces db as it normally should');
  assert.ok(t.db.shows.theirs, 'the remote content must now be applied — the guard must not block sync forever');
});

test('save: repeated rapid saves do not lose earlier fields (no lost-update from re-entrant calls)', () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows.s1 = { id: 's1', name: 'A', note: '' };
  dom.window.save();
  t.db.shows.s1.note = 'first edit';
  dom.window.save();
  t.db.shows.s1.favourite = true;
  dom.window.save();
  const persisted = JSON.parse(dom.window.localStorage.getItem(t.K3));
  assert.equal(persisted.shows.s1.note, 'first edit');
  assert.equal(persisted.shows.s1.favourite, true);
});
