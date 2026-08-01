#!/usr/bin/env node
/**
 * Tests for twitch-no-downscale.user.js (v1.4.0)
 * Pure Node, no dependencies. Runs the userscript body inside a VM sandbox
 * with mocked DOM/Window and asserts behaviour.
 */
'use strict';

const fs = require('fs');
const vm = require('vm');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'twitch-no-downscale.user.js');
const SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

// Strip the UserScript meta block (first line .. ==/UserScript==)
function stripMeta(src) {
  const end = src.indexOf('// ==/UserScript==');
  const start = src.indexOf('// ==UserScript==');
  if (start === -1 || end === -1) throw new Error('meta block not found');
  return src.slice(end + '// ==/UserScript=='.length);
}

let BODY = stripMeta(SOURCE);

// ---- helpers -----------------------------------------------------------

function makeStorage() {
  const store = new Map();
  return {
    setItem(k, v) { store.set(String(k), String(v)); },
    getItem(k) { return store.has(String(k)) ? store.get(String(k)) : null; },
    removeItem(k) { store.delete(String(k)); },
    clear() { store.clear(); },
    keys() { return [...store.keys()]; },
    dump() { return Object.fromEntries(store); },
  };
}

function makeVideo(opts) {
  const calls = [];
  return {
    id: opts.id || 'video',
    paused: !!opts.paused,
    ended: !!opts.ended,
    readyState: opts.readyState !== undefined ? opts.readyState : 4,
    rect: opts.rect || { width: 0, height: 0 },
    playCalls: calls,
    play() {
      calls.push(this.id);
      return Promise.resolve();
    },
    getBoundingClientRect() { return this.rect; },
  };
}

function runScript(body, { document, window, Document, console: consoleMock, replace = {} } = {}) {
  let code = body;
  for (const [from, to] of Object.entries(replace)) {
    if (!code.includes(from)) throw new Error('replace target not found: ' + from);
    code = code.replace(from, to);
  }
  const sandbox = {
    document,
    window,
    Document,
    console: consoleMock,
    localStorage: window && window.localStorage,
    Date,
    JSON,
    Object,
    Map,
    Promise,
  };
  vm.createContext(sandbox);
  vm.runInContext(code, sandbox, { filename: 'userscript.js' });
  return sandbox;
}

function makeDocument(videos, { preventExtensions = false } = {}) {
  const listeners = [];
  const doc = {
    listeners,
    getElementsByTagName(tag) {
      if (tag !== 'video') return [];
      return videos;
    },
    addEventListener(type, fn, capture) {
      listeners.push({ type, fn, capture: !!capture });
    },
  };
  if (preventExtensions) Object.preventExtensions(doc);
  return doc;
}

function makeDocumentCtor({ preventExtensions = false } = {}) {
  function Document() {}
  Document.prototype = {};
  if (preventExtensions) Object.preventExtensions(Document.prototype);
  return Document;
}

function makeConsole() {
  const warns = [];
  return { warns, warn: (...a) => warns.push(a.join(' ')), log() {}, error() {} };
}

function triggerVisibilityChange(documentMock, eventSpy) {
  const l = documentMock.listeners.find(x => x.type === 'visibilitychange');
  if (!l) throw new Error('visibilitychange listener not registered');
  l.fn(eventSpy || {});
  return l;
}

// ---- tests -------------------------------------------------------------

let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    pass++;
    console.log('PASS ' + name);
  } catch (e) {
    fail++;
    console.log('FAIL ' + name + ' :: ' + e.message);
  }
}
function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }

// 1. Manual pause is preserved: paused video must NOT get play() called.
test('1. manual pause preserved (no play() on paused video)', () => {
  const video = makeVideo({ id: 'main', paused: true, rect: { width: 640, height: 360 } });
  const doc = makeDocument([video]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = { localStorage: storage };
  runScript(BODY, { document: doc, window: win, Document: makeDocumentCtor(), console: consoleMock });

  const spy = { stopImmediatePropagation() { throw new Error('must not be called'); } };
  triggerVisibilityChange(doc, spy);
  assert(video.playCalls.length === 0, 'play() must not be called on manually paused video');
  assert(storage.keys().length === 3, 'quality keys written once on load (got: ' + storage.keys() + ')');
});

// 2. Ended video must never be played.
test('2. ended video not played', () => {
  const video = makeVideo({ id: 'main', ended: true, rect: { width: 640, height: 360 } });
  const doc = makeDocument([video]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 0, 'play() must not be called on ended video');
});

// 3. Multiple videos: hidden/stale element first, active second -> active wins.
test('3. multiple videos: visible active element wins over hidden first', () => {
  const hidden = makeVideo({ id: 'hidden', paused: false, rect: { width: 0, height: 0 } });
  const active = makeVideo({ id: 'active', paused: false, rect: { width: 1280, height: 720 } });
  const doc = makeDocument([hidden, active]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  triggerVisibilityChange(doc);
  assert(hidden.playCalls.length === 0, 'hidden element must not be played');
  assert(active.playCalls.length === 1, 'active visible element must be played');
});

// 3b. Larger visible element wins (ad vs stream, both visible).
test('3b. multiple videos: larger visible element wins', () => {
  const ad = makeVideo({ id: 'ad', paused: false, rect: { width: 640, height: 360 } });
  const stream = makeVideo({ id: 'stream', paused: false, rect: { width: 1280, height: 720 } });
  const doc = makeDocument([ad, stream]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  triggerVisibilityChange(doc);
  assert(ad.playCalls.length === 0, 'smaller element must not win');
  assert(stream.playCalls.length === 1, 'larger visible element must win');
});

// 3c. readyState 0 (uninitialized) elements are skipped.
test('3c. uninitialized element (readyState 0) skipped', () => {
  const uninit = makeVideo({ id: 'uninit', paused: false, readyState: 0, rect: { width: 1280, height: 720 } });
  const main = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const doc = makeDocument([uninit, main]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  triggerVisibilityChange(doc);
  assert(uninit.playCalls.length === 0, 'uninitialized element must be skipped');
  assert(main.playCalls.length === 1, 'initialized element must win');
});

// 4. stopImmediatePropagation must NOT be used (no global event blocking).
test('4. no stopImmediatePropagation on visibilitychange', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const doc = makeDocument([video]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  let blocked = false;
  const spy = { stopImmediatePropagation() { blocked = true; } };
  triggerVisibilityChange(doc, spy);
  assert(blocked === false, 'other listeners must not be blocked');
});

// 5. Listener registered exactly once, capture phase.
test('5. visibilitychange listener registered once (capture)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const doc = makeDocument([video]);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: { localStorage: makeStorage() }, Document: makeDocumentCtor(), console: consoleMock });

  const vis = doc.listeners.filter(x => x.type === 'visibilitychange');
  assert(vis.length === 1, 'expected exactly one visibilitychange listener, got ' + vis.length);
  assert(vis[0].capture === true, 'listener must be on capture phase');
});

// 6. Object.defineProperty failure on Document.prototype -> instance fallback works.
test('6. prototype freeze fails, instance fallback succeeds', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  runScript(BODY, {
    document: doc,
    window: { localStorage: makeStorage() },
    Document: makeDocumentCtor({ preventExtensions: true }),
    console: consoleMock,
  });
  assert(doc.hidden === false, 'instance fallback must freeze document.hidden');
  assert(doc.visibilityState === 'visible', 'instance fallback must freeze visibilityState');
  assert(consoleMock.warns.length === 0, 'no warning when fallback succeeds (got: ' + consoleMock.warns + ')');
});

// 6b. Both prototype and instance fail -> partial failure is logged, no throw.
test('6b. full freeze failure logged, script does not crash', () => {
  const doc = makeDocument([], { preventExtensions: true });
  const consoleMock = makeConsole();
  runScript(BODY, {
    document: doc,
    window: { localStorage: makeStorage() },
    Document: makeDocumentCtor({ preventExtensions: true }),
    console: consoleMock,
  });
  assert(consoleMock.warns.length === 1, 'expected partial-failure warning, got: ' + consoleMock.warns);
  assert(/partially failed/.test(consoleMock.warns[0]), 'warning must mention partial failure');
});

// 7. localStorage quality keys.
test('7a. startupQuality "" -> localStorage untouched', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: { localStorage: storage },
    Document: makeDocumentCtor(),
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = '';" },
  });
  assert(storage.keys().length === 0, 'no keys should be written (got: ' + storage.keys() + ')');
});

test('7b. startupQuality "source" -> chunked remap', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, { document: doc, window: { localStorage: storage }, Document: makeDocumentCtor(), console: consoleMock });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'video-quality must be chunked');
  assert(storage.getItem('quality-bitrate') === '0', 'quality-bitrate must be 0');
  assert(/^\d+$/.test(storage.getItem('s-qs-ts')), 's-qs-ts must be a numeric timestamp');
});

test('7c. startupQuality "best" -> chunked remap', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: { localStorage: storage },
    Document: makeDocumentCtor(),
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = 'best';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'best must remap to chunked');
});

test('7d. startupQuality "1080p60" -> passthrough', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: { localStorage: storage },
    Document: makeDocumentCtor(),
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = '1080p60';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: '1080p60' }), '1080p60 must pass through');
});

test('7e. startupQuality invalid -> written verbatim (documented behaviour)', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: { localStorage: storage },
    Document: makeDocumentCtor(),
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = 'not-a-quality';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'not-a-quality' }), 'invalid value written verbatim (player falls back to auto)');
});

// 8. doOnlySetting=true: freeze skipped, quality still set.
test('8. doOnlySetting=true: no freeze, quality keys still written', () => {
  const doc = makeDocument([]);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: { localStorage: storage },
    Document: makeDocumentCtor(),
    console: consoleMock,
    replace: { "const doOnlySetting = false;": "const doOnlySetting = true;" },
  });
  assert(doc.hidden === undefined, 'freeze must be skipped when doOnlySetting=true');
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'quality must still be set');
  assert(doc.listeners.filter(x => x.type === 'visibilitychange').length === 0, 'no visibilitychange listener when doOnlySetting=true');
});

// ---- summary -----------------------------------------------------------

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
