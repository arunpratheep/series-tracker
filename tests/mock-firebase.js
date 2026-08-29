'use strict';
/* Minimal stand-in for the Firebase Firestore surface the app calls through
   its `fb` object (see the CLOUD SYNC block in index.html). Records every
   write in call order so tests can assert on sequencing — the household
   creation bug (#4 in CLAUDE_CONTEXT.md's "bugs already found and fixed")
   was exactly a write-order mistake that only a call-order assertion catches. */
/* Firestore's real setDoc(..., {merge:true}) merges nested map fields
   recursively, not just at the top level — e.g. writing {members:{uid2:..}}
   into a doc that already has {members:{uid1:..}} keeps BOTH uids, because
   `members` itself is merged rather than replaced. A shallow Object.assign
   would silently drop uid1, which is exactly the shape of bug the real
   joinHousehold() write depends on being merged correctly. */
function deepMerge(target, patch){
  if(typeof patch !== 'object' || patch === null || Array.isArray(patch)) return patch;
  const out = Object.assign({}, target);
  for(const key of Object.keys(patch)){
    const existing = target ? target[key] : undefined;
    out[key] = (existing && typeof existing === 'object' && !Array.isArray(existing))
      ? deepMerge(existing, patch[key])
      : patch[key];
  }
  return out;
}

function makeMockFb(){
  const docsByPath = new Map();
  const calls = [];
  const snapshotCallbacks = new Map();   /* path -> onNext, for tests to fire manually */

  function ref(fs, ...segments){
    return { path: segments.join('/') };
  }

  return {
    calls,
    docs: docsByPath,
    snapshotCallbacks,
    fs: {},
    doc: ref,
    async getDoc(r){
      const data = docsByPath.get(r.path);
      return { exists: () => data !== undefined, data: () => data };
    },
    async setDoc(r, data, opts){
      calls.push({ op: 'setDoc', path: r.path, merge: !!(opts && opts.merge), data: JSON.parse(JSON.stringify(data)) });
      const existing = docsByPath.get(r.path);
      docsByPath.set(r.path, (opts && opts.merge && existing) ? deepMerge(existing, data) : data);
    },
    onSnapshot(r, onNext){
      calls.push({ op: 'onSnapshot', path: r.path });
      snapshotCallbacks.set(r.path, onNext);
      return function unsubscribe(){ snapshotCallbacks.delete(r.path); };
    }
  };
}

/* Builds the { exists, metadata, data } shape the app's onSnapshot
   callbacks expect from a Firestore DocumentSnapshot. */
function fakeSnapshot(data, opts){
  const o = opts || {};
  return {
    exists: () => o.exists !== false,
    metadata: { hasPendingWrites: !!o.hasPendingWrites },
    data: () => data
  };
}

module.exports = { makeMockFb, fakeSnapshot };
