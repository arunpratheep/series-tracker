'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadApp } = require('./harness');

/* importData() used to skip any show whose id already existed locally —
   which meant re-importing a corrected backup over an existing library
   (e.g. one with fixed platform/link data) did nothing at all for every
   show already tracked. It now replaces a matching show's record
   wholesale with the backup's version, and only leaves an untouched show
   alone if the backup doesn't mention it. Watched episodes are the one
   deliberate exception — always unioned, never replaced, so importing an
   older backup can never erase progress made since it was exported. */

function runImport(dom, data){
  const input = dom.window.document.getElementById('fileIn');
  const file = new dom.window.File([JSON.stringify(data)], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  dom.window.confirm = () => true;
  return new Promise((resolve, reject) => {
    // input.value never reflects the programmatically-assigned file in
    // jsdom (it stays ''), so polling for it resolves before the async
    // FileReader has even started — a real race that made this file
    // itself flaky. save() is importData()'s last synchronous action on
    // success, so hook that instead of guessing at timing.
    const origSave = dom.window.save;
    dom.window.save = function(){ dom.window.save = origSave; origSave(); resolve(); };
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    setTimeout(() => { dom.window.save = origSave; reject(new Error('importData did not call save() within 2s')); }, 2000);
  });
}

function withSettingsScreen(dom){
  dom.window.go('settings');
}

test('import: replaces an existing show\'s metadata with the backup\'s version', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['11'] = { id: 11, name: 'Gotham', eps: [], platform: null, watchPage: null };
  t.db.watched['11'] = {};
  withSettingsScreen(dom);

  await runImport(dom, {
    version: 3,
    shows: { '11': { id: 11, name: 'Gotham', eps: [], platform: 'netflix', watchPage: 'https://www.themoviedb.org/tv/60708-gotham/watch?locale=IN' } },
    watched: {}
  });

  assert.equal(t.db.shows['11'].platform, 'netflix');
  assert.equal(t.db.shows['11'].watchPage, 'https://www.themoviedb.org/tv/60708-gotham/watch?locale=IN');
});

test('import: a show not mentioned in the backup is left completely untouched', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['999'] = { id: 999, name: 'Only Mine', eps: [], platform: 'prime', note: 'my private note' };
  t.db.watched['999'] = { '1': 1700000000000 };
  withSettingsScreen(dom);

  await runImport(dom, { version: 3, shows: { '11': { id: 11, name: 'Gotham', eps: [], platform: 'netflix' } }, watched: {} });

  assert.equal(t.db.shows['999'].platform, 'prime');
  assert.equal(t.db.shows['999'].note, 'my private note');
  assert.equal(t.db.watched['999']['1'], 1700000000000);
});

test('import: watched episodes are unioned, never replaced — local progress since export survives', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['11'] = { id: 11, name: 'Gotham', eps: [], platform: null };
  // watched episode 5 locally, AFTER the backup being imported was taken
  t.db.watched['11'] = { '5': 1700000099999 };
  withSettingsScreen(dom);

  await runImport(dom, {
    version: 3,
    shows: { '11': { id: 11, name: 'Gotham', eps: [], platform: 'netflix' } },
    watched: { '11': { '1': 1600000000000, '2': 1600000001000 } }   // an OLDER backup, doesn't know about episode 5
  });

  assert.equal(t.db.watched['11']['1'], 1600000000000, 'episodes from the backup must still be added');
  assert.equal(t.db.watched['11']['2'], 1600000001000);
  assert.equal(t.db.watched['11']['5'], 1700000099999, 'an episode watched locally after export must survive a replace-on-import');
});

test('import: a genuinely new show (not previously tracked) is added', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  withSettingsScreen(dom);

  await runImport(dom, { version: 3, shows: { '431': { id: 431, name: 'Friends', eps: [] } }, watched: { '431': { '1': 1600000000000 } } });

  assert.ok(t.db.shows['431']);
  assert.equal(t.db.shows['431'].name, 'Friends');
  assert.equal(t.db.watched['431']['1'], 1600000000000);
});

test('import: new platforms from the backup are appended, existing platform ids are not duplicated', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  const before = t.db.platforms.length;
  withSettingsScreen(dom);

  await runImport(dom, {
    version: 3, shows: {}, watched: {},
    platforms: [
      { id: 'netflix', name: 'Netflix (duplicate)', search: '' },
      { id: 'brand-new-service', name: 'Brand New Service', search: '' }
    ]
  });

  assert.equal(t.db.platforms.length, before + 1, 'only the genuinely new platform id should be appended');
  assert.ok(t.db.platforms.some(p => p.id === 'brand-new-service'));
  assert.equal(t.db.platforms.find(p => p.id === 'netflix').name, 'Netflix', 'the existing netflix entry must not be overwritten by the duplicate');
});

test('import: an invalid file is rejected without touching existing data', async () => {
  const dom = loadApp();
  const t = dom.window.__test;
  t.db.shows['11'] = { id: 11, name: 'Gotham', eps: [], platform: 'prime' };
  withSettingsScreen(dom);

  // the reject path never calls save() (nothing to persist), so hook
  // toast() instead — it's the last thing importData() does either way.
  const input = dom.window.document.getElementById('fileIn');
  const file = new dom.window.File([JSON.stringify({ notAValidBackup: true })], 'backup.json', { type: 'application/json' });
  Object.defineProperty(input, 'files', { value: [file], configurable: true });
  await new Promise((resolve, reject) => {
    const origToast = dom.window.toast;
    dom.window.toast = function(msg){ dom.window.toast = origToast; origToast(msg); resolve(); };
    input.dispatchEvent(new dom.window.Event('change', { bubbles: true }));
    setTimeout(() => { dom.window.toast = origToast; reject(new Error('importData did not toast within 2s')); }, 2000);
  });

  assert.equal(t.db.shows['11'].platform, 'prime', 'a file with no .shows must be rejected, leaving the library untouched');
});
