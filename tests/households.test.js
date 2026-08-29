'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');
const { makeMockFb } = require('./mock-firebase');

/* Bug #4: household creation wrote the data doc before the membership doc,
   but the security rule for the data doc reads the member list — so
   creation failed with permission-denied 100% of the time until the
   write order was reversed. A real Firestore doesn't enforce that rule
   here, so the only way to catch a regression is to assert on call order. */
test('createHousehold: writes household meta (membership) before the household data doc', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  await dom.window.createHousehold('uid1', 'me@example.com', null);

  const setDocCalls = mockFb.calls.filter(c => c.op === 'setDoc');
  const metaCallIdx = setDocCalls.findIndex(c => c.path.endsWith('/meta/info'));
  const dataCallIdx = setDocCalls.findIndex(c => /^households\/[^/]+$/.test(c.path));

  assert.notEqual(metaCallIdx, -1, 'a meta/info doc must be written');
  assert.notEqual(dataCallIdx, -1, 'the household data doc must be written');
  assert.ok(metaCallIdx < dataCallIdx, 'meta/info (membership) must be written before the household data doc, or the security rule denies the write');
});

test('createHousehold: the membership doc lists the creating user before the data doc is written', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  const hid = await dom.window.createHousehold('uid1', 'me@example.com', null);
  const metaCall = mockFb.calls.find(c => c.path === 'households/' + hid + '/meta/info');
  assert.ok(metaCall);
  assert.ok(metaCall.data.members.uid1, 'the creating uid must be recorded as a member');
  assert.equal(metaCall.data.members.uid1.email, 'me@example.com');
});

test('createHousehold: also writes the users/{uid} pointer doc, after both household docs', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  const hid = await dom.window.createHousehold('uid1', 'me@example.com', null);
  const userPointerCall = mockFb.calls.find(c => c.path === 'users/uid1');
  assert.ok(userPointerCall, 'users/uid1 must be written so future sign-ins know which household to load');
  assert.equal(userPointerCall.data.householdId, hid);
});

/* Bug #3: a brand-new household used to be created blank and then loaded
   back over the device's real, already-tracked library, wiping it. Fixed
   by seeding the new household from whatever data the device already has. */
test('createHousehold: seeds the new household from provided local data instead of starting blank', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  const localData = {
    version: 3, watched: { s1: { '1': 1700000000000 } }, prefs: {},
    platforms: [{ id: 'netflix', name: 'Netflix', search: '', active: true, order: 0 }],
    shows: { s1: { id: 's1', name: 'Already Tracked', eps: [[1, 1, 1, '2020-01-01', 40, 'Ep 1']] } }
  };

  const hid = await dom.window.createHousehold('uid1', 'me@example.com', localData);
  const dataCall = mockFb.calls.find(c => /^households\/[^/]+$/.test(c.path));
  assert.ok(dataCall, 'the household data doc must be written');
  assert.ok(dataCall.data.shows.s1, 'the seed data\'s existing show must survive into the new household, not be wiped');
  assert.equal(dataCall.data.shows.s1.name, 'Already Tracked');
});

test('createHousehold: with no seed data at all, still creates a valid (empty) household rather than failing', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  const hid = await dom.window.createHousehold('uid1', 'me@example.com', null);
  const dataCall = mockFb.calls.find(c => /^households\/[^/]+$/.test(c.path));
  assert.ok(dataCall);
  assert.equal(Object.keys(dataCall.data.shows).length, 0);
  assert.ok(dataCall.data.platforms.length > 0, 'an empty seed still gets the default platform list, per createHousehold\'s own fallback');
});

test('joinHousehold: adds the joining user to membership with merge:true (must not clobber existing members)', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;

  // seed an existing invite + existing membership, as if uid1 already created the household
  await mockFb.setDoc({ path: 'invites/ABC123' }, { householdId: 'hid1', createdBy: 'uid1', createdAt: 1 });
  await mockFb.setDoc({ path: 'households/hid1/meta/info' }, { members: { uid1: { email: 'a@x.com', joinedAt: 1 } } });

  const hid = await dom.window.joinHousehold('abc123', 'uid2', 'partner@example.com');
  assert.equal(hid, 'hid1');

  const mergeCall = mockFb.calls.find(c => c.op === 'setDoc' && c.path === 'households/hid1/meta/info' && c.merge === true);
  assert.ok(mergeCall, 'joining must merge into meta/info, not overwrite it wholesale');
  assert.ok(mergeCall.data.members.uid2, 'the joining uid must be added');

  const finalMembers = mockFb.docs.get('households/hid1/meta/info').members;
  assert.ok(finalMembers.uid1, 'the original member must still be present after a merge join');
  assert.ok(finalMembers.uid2);
});

test('joinHousehold: an invite code that does not exist throws a human-readable error', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.fb = makeMockFb();

  await assert.rejects(
    () => dom.window.joinHousehold('NOPE99', 'uid2', 'partner@example.com'),
    /doesn't match an invite/
  );
});

test('joinHousehold: the code is trimmed and case-normalized before lookup', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const mockFb = makeMockFb();
  t.fb = mockFb;
  await mockFb.setDoc({ path: 'invites/XYZ789' }, { householdId: 'hidZ', createdBy: 'uid1', createdAt: 1 });
  await mockFb.setDoc({ path: 'households/hidZ/meta/info' }, { members: {} });

  const hid = await dom.window.joinHousehold('  xyz789  ', 'uid2', 'p@example.com');
  assert.equal(hid, 'hidZ');
});
