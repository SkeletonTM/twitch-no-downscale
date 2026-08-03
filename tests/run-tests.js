#!/usr/bin/env node
/**
 * Tests for twitch-no-downscale.user.js (v1.4.3)
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
  const r = opts.rect || { width: 0, height: 0 };
  // Complete the rect so viewport-intersection checks have real numbers:
  // default to a top-left-anchored box (top:0, left:0) unless overridden.
  const rect = {
    width: r.width || 0,
    height: r.height || 0,
    top: r.top !== undefined ? r.top : 0,
    left: r.left !== undefined ? r.left : 0,
    bottom: r.bottom !== undefined ? r.bottom : ((r.top !== undefined ? r.top : 0) + (r.height || 0)),
    right: r.right !== undefined ? r.right : ((r.left !== undefined ? r.left : 0) + (r.width || 0)),
  };
  return {
    id: opts.id || 'video',
    paused: !!opts.paused,
    ended: !!opts.ended,
    readyState: opts.readyState !== undefined ? opts.readyState : 4,
    rect,
    playCalls: calls,
    play() {
      calls.push(this.id);
      if (opts.playThrows) throw new Error('legacy sync throw');
      return opts.playResult !== undefined ? opts.playResult : Promise.resolve();
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

// The mock document must INHERIT from the mocked Document.prototype: in real
// browsers the frozen props live on Document.prototype (configurable native
// accessors), and the script's primary path is the prototype define. A plain
// object literal never reads those getters, so every test would silently run
// the instance-fallback branch instead of the production path.
function makeDocument(videos, DocumentCtor, { preventExtensions = false } = {}) {
  const ctor = DocumentCtor || makeDocumentCtor();
  const doc = Object.create(ctor.prototype);
  doc.listeners = [];
  doc.getElementsByTagName = function (tag) {
    return tag !== 'video' ? [] : videos;
  };
  doc.addEventListener = function (type, fn, capture) {
    this.listeners.push({ type, fn, capture: !!capture });
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

function makeWindow(storage, extra = {}) {
  return Object.assign({ localStorage: storage }, extra);
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
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, { document: doc, window: makeWindow(storage), Document: ctor, console: consoleMock });

  const spy = { stopImmediatePropagation() { throw new Error('must not be called'); } };
  triggerVisibilityChange(doc, spy);
  assert(video.playCalls.length === 0, 'play() must not be called on manually paused video');
  assert(storage.keys().length === 3, 'quality keys written once on load (got: ' + storage.keys() + ')');
});

// 2. Ended video must never be played.
test('2. ended video not played', () => {
  const video = makeVideo({ id: 'main', ended: true, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 0, 'play() must not be called on ended video');
});

// 3. Multiple videos: hidden/stale element first, active second -> active wins.
test('3. multiple videos: visible active element wins over hidden first', () => {
  const hidden = makeVideo({ id: 'hidden', paused: false, rect: { width: 0, height: 0 } });
  const active = makeVideo({ id: 'active', paused: false, rect: { width: 1280, height: 720 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([hidden, active], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(hidden.playCalls.length === 0, 'hidden element must not be played');
  assert(active.playCalls.length === 1, 'active visible element must be played');
});

// 3b. Larger visible element wins (ad vs stream, both visible).
test('3b. multiple videos: larger visible element wins', () => {
  const ad = makeVideo({ id: 'ad', paused: false, rect: { width: 640, height: 360 } });
  const stream = makeVideo({ id: 'stream', paused: false, rect: { width: 1280, height: 720 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([ad, stream], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(ad.playCalls.length === 0, 'smaller element must not win');
  assert(stream.playCalls.length === 1, 'larger visible element must win');
});

// 3c. readyState 0 (uninitialized) elements are skipped.
test('3c. uninitialized element (readyState 0) skipped', () => {
  const uninit = makeVideo({ id: 'uninit', paused: false, readyState: 0, rect: { width: 1280, height: 720 } });
  const main = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([uninit, main], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(uninit.playCalls.length === 0, 'uninitialized element must be skipped');
  assert(main.playCalls.length === 1, 'initialized element must win');
});

// 3d. CSS-hidden element (visibility:hidden) with a large rect must NOT win.
test('3d. CSS-hidden big element does not win over smaller visible one', () => {
  const cssHidden = makeVideo({ id: 'css-hidden', paused: false, rect: { width: 1280, height: 720 } });
  const visible = makeVideo({ id: 'visible', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([cssHidden, visible], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle(el) {
      const hidden = el.id === 'css-hidden';
      return { display: 'block', visibility: hidden ? 'hidden' : 'visible', opacity: '1' };
    },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(cssHidden.playCalls.length === 0, 'CSS-hidden element must not be played');
  assert(visible.playCalls.length === 1, 'visible element must win over CSS-hidden one');
});

// 3e. Off-viewport element (negative coords, full size) must be skipped.
test('3e. off-viewport element skipped', () => {
  const off = makeVideo({ id: 'off-screen', paused: false, rect: { width: 1920, height: 1080, top: -9999, left: -9999 } });
  const onScreen = makeVideo({ id: 'on-screen', paused: false, rect: { width: 1280, height: 720 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([off, onScreen], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });

  triggerVisibilityChange(doc);
  assert(off.playCalls.length === 0, 'off-viewport element must be skipped');
  assert(onScreen.playCalls.length === 1, 'on-screen element must win');
});

// 3d2. display:none element (large rect) must NOT win (N5 branch)
test('3d2. display:none big element does not win', () => {
  const cssHidden = makeVideo({ id: 'css-hidden', paused: false, rect: { width: 1280, height: 720 } });
  const visible = makeVideo({ id: 'visible', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([cssHidden, visible], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle(el) {
      const hidden = el.id === 'css-hidden';
      return { display: hidden ? 'none' : 'block', visibility: 'visible', opacity: '1' };
    },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(cssHidden.playCalls.length === 0, 'display:none element must not be played');
  assert(visible.playCalls.length === 1, 'visible element must win');
});

// 3d3. opacity:0 element (large rect) must NOT win (N5 branch)
test('3d3. opacity:0 big element does not win', () => {
  const cssHidden = makeVideo({ id: 'css-hidden', paused: false, rect: { width: 1280, height: 720 } });
  const visible = makeVideo({ id: 'visible', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([cssHidden, visible], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle(el) {
      const hidden = el.id === 'css-hidden';
      return { display: 'block', visibility: 'visible', opacity: hidden ? '0' : '1' };
    },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(cssHidden.playCalls.length === 0, 'opacity:0 element must not be played');
  assert(visible.playCalls.length === 1, 'visible element must win');
});

// 3f. zero-size viewport must not reject all videos (N1 regression)
test('3f. zero-size viewport does not reject all videos (N1)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, { innerWidth: 0, innerHeight: 0 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 1, 'video must still be playable when viewport is 0x0');
});

// 3g. play() throwing synchronously must not break the listener (N2 regression)
test('3g. play() throwing synchronously does not break the listener (N2)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 }, playThrows: true });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, { document: doc, window: makeWindow(storage), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc); // must not throw out of the listener
  assert(video.playCalls.length === 1, 'play() was attempted');
});

// 4. stopImmediatePropagation must NOT be used (no global event blocking).
test('4. no stopImmediatePropagation on visibilitychange (incl. repeated calls)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  let blocked = false;
  const spy = { stopImmediatePropagation() { blocked = true; } };
  triggerVisibilityChange(doc, spy);
  assert(blocked === false, 'other listeners must not be blocked on first dispatch');
  triggerVisibilityChange(doc, spy);
  assert(blocked === false, 'other listeners must not be blocked on repeated dispatch');
});

// 5. Listener registered exactly once per script execution, capture phase.
test('5. visibilitychange listener registered once per script execution (capture)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  const vis = doc.listeners.filter(x => x.type === 'visibilitychange');
  assert(vis.length === 1, 'expected exactly one visibilitychange listener, got ' + vis.length);
  assert(vis[0].capture === true, 'listener must be on capture phase');
});

// 6. Object.defineProperty failure on Document.prototype -> instance fallback works.
test('6. prototype freeze fails, instance fallback succeeds', () => {
  const ctor = makeDocumentCtor({ preventExtensions: true });
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, {
    document: doc,
    window: makeWindow(makeStorage()),
    Document: ctor,
    console: consoleMock,
  });
  assert(doc.hidden === false, 'instance fallback must freeze document.hidden');
  assert(doc.visibilityState === 'visible', 'instance fallback must freeze visibilityState');
  assert(consoleMock.warns.length === 0, 'no warning when fallback succeeds (got: ' + consoleMock.warns + ')');
});

// 6b. Both prototype and instance fail -> partial failure is logged, no throw.
test('6b. full freeze failure logged, script does not crash', () => {
  const ctor = makeDocumentCtor({ preventExtensions: true });
  const doc = makeDocument([], ctor, { preventExtensions: true });
  const consoleMock = makeConsole();
  runScript(BODY, {
    document: doc,
    window: makeWindow(makeStorage()),
    Document: ctor,
    console: consoleMock,
  });
  assert(consoleMock.warns.length === 1, 'expected partial-failure warning, got: ' + consoleMock.warns);
  assert(/partially failed/.test(consoleMock.warns[0]), 'warning must mention partial failure');
});

// 6c. PRODUCTION PATH: the mock document inherits from Document.prototype,
// so the prototype define must succeed and the frozen getters must be read
// through the prototype (no own props), exactly like a real browser.
test('6c. prototype freeze succeeds (production path, no own props)', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, {
    document: doc,
    window: makeWindow(makeStorage()),
    Document: ctor,
    console: consoleMock,
  });
  assert(doc.hidden === false, 'hidden must be false via prototype getter');
  assert(doc.visibilityState === 'visible', 'visibilityState must be visible via prototype getter');
  assert(doc.webkitVisibilityState === 'visible', 'webkitVisibilityState must be visible');
  assert(doc.webkitHidden === false, 'webkitHidden must be false');
  assert(Object.getOwnPropertyDescriptor(doc, 'hidden') === undefined,
    'hidden must live on Document.prototype, not on the document instance (production path)');
  assert(consoleMock.warns.length === 0, 'no warning when prototype path succeeds');
});

// 7. localStorage quality keys.
test('7a. startupQuality "" -> localStorage untouched', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: makeWindow(storage),
    Document: ctor,
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = '';" },
  });
  assert(storage.keys().length === 0, 'no keys should be written (got: ' + storage.keys() + ')');
});

test('7b. startupQuality "source" -> chunked remap', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, { document: doc, window: makeWindow(storage), Document: ctor, console: consoleMock });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'video-quality must be chunked');
  assert(storage.getItem('quality-bitrate') === '0', 'quality-bitrate must be 0');
  assert(/^\d+$/.test(storage.getItem('s-qs-ts')), 's-qs-ts must be a numeric timestamp');
});

test('7c. startupQuality "best" -> chunked remap', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: makeWindow(storage),
    Document: ctor,
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = 'best';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'best must remap to chunked');
});

test('7d. startupQuality "1080p60" -> passthrough', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: makeWindow(storage),
    Document: ctor,
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = '1080p60';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: '1080p60' }), '1080p60 must pass through');
});

test('7e. startupQuality invalid -> written verbatim (documented behaviour)', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: makeWindow(storage),
    Document: ctor,
    console: consoleMock,
    replace: { "const startupQuality = 'source';": "const startupQuality = 'not-a-quality';" },
  });
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'not-a-quality' }), 'invalid value written verbatim (player falls back to auto)');
});

// 8. doOnlySetting=true: freeze skipped, quality still set.
test('8. doOnlySetting=true: no freeze, quality keys still written', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  runScript(BODY, {
    document: doc,
    window: makeWindow(storage),
    Document: ctor,
    console: consoleMock,
    replace: { "const doOnlySetting = false;": "const doOnlySetting = true;" },
  });
  assert(doc.hidden === undefined, 'freeze must be skipped when doOnlySetting=true');
  assert(storage.getItem('video-quality') === JSON.stringify({ default: 'chunked' }), 'quality must still be set');
  assert(doc.listeners.filter(x => x.type === 'visibilitychange').length === 0, 'no visibilitychange listener when doOnlySetting=true');
});

// 9. Zero videos on the page: the visibilitychange listener must not throw.
test('9. no videos on page — listener does not throw', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(true, 'listener ran without throwing when there are no videos');
});

// 10. Legacy engine: play() returns undefined, not a Promise — must not throw.
test('10. play() returning undefined does not throw', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 }, playResult: undefined });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 1, 'play() must be called on the playing video');
});

// ---- summary -----------------------------------------------------------

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail === 0 ? 0 : 1);
