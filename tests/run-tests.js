#!/usr/bin/env node
/**
 * Tests for twitch-no-downscale.user.js (v1.4.9)
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
    playReturns: [],
    play() {
      calls.push(this.id);
      if (opts.playThrows) throw new Error('legacy sync throw');
      // Object.hasOwn (not `!== undefined`) so a test can ask for a genuine
      // undefined return - legacy engines return undefined, not a Promise.
      const result = Object.hasOwn(opts, 'playResult') ? opts.playResult : Promise.resolve();
      this.playReturns.push(result);
      return result;
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
  // Wrap like a real userscript manager (Tampermonkey etc.): the body is
  // evaluated inside a function, so a top-level early `return` (top-frame
  // guard) is legal and behaves like in a browser.
  vm.createContext(sandbox);
  vm.runInContext('(function () {\n' + code + '\n})();', sandbox, { filename: 'userscript.js' });
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
  const win = { localStorage: storage };
  win.top = win; // default: the test runs in the top frame (top === self)
  win.self = win;
  return Object.assign(win, extra);
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

// 0. Top-frame guard: in an iframe (window.top !== window.self) the script
// must not register listeners or touch localStorage.
test('0. top-frame guard: no listeners or storage writes in an iframe', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, { top: { /* different window */ } });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  assert(doc.listeners.length === 0, 'no listeners must be registered in an iframe');
  assert(storage.keys().length === 0, 'localStorage must not be written in an iframe');
});

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

// 3h. getComputedStyle throwing must not break the listener (NEW-1 regression)
test('3h. getComputedStyle throwing does not break the listener (NEW-1)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle() { throw new Error('getComputedStyle boom'); },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc); // must not throw
  assert(video.playCalls.length === 1, 'video must still be playable when getComputedStyle throws');
});

// 3i. getBoundingClientRect read once per candidate (N3 regression)
test('3i. getBoundingClientRect read once per candidate (N3)', () => {
  let reads = 0;
  const mk = (id, rect) => ({
    id,
    paused: false,
    ended: false,
    readyState: 4,
    rect,
    playCalls: [],
    getBoundingClientRect() { reads++; return this.rect; },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  });
  const visible = mk('visible', { width: 640, height: 360, top: 0, left: 0 });
  const above = mk('above', { width: 640, height: 100, top: -500, left: 0 });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([above, visible], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(visible.playCalls.length === 1, 'visible element must win');
  assert(reads === 2, 'getBoundingClientRect must be read once per candidate, got ' + reads);
});

// 3j. element fully above viewport with no bottom/right is skipped (N4 regression)
test('3j. fully-above element with no bottom/right is skipped (N4)', () => {
  const above = {
    id: 'above',
    paused: false,
    ended: false,
    readyState: 4,
    playCalls: [],
    // Only width/height/top/left — no bottom/right, as a bare rect object
    rect: { width: 640, height: 100, top: -500, left: 0 },
    getBoundingClientRect() { return this.rect; },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([above], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(above.playCalls.length === 0, 'fully-above element must be skipped (edges derived)');
});

// 3k. checkVisibility fast path: false => skipped, no getComputedStyle read
test('3k. checkVisibility fast path skips hidden elements without getComputedStyle', () => {
  let styleReads = 0;
  const mk = (id, checkVisibility, rect) => ({
    id, paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: rect || { width: 640, height: 360, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    checkVisibility,
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  });
  const hidden = mk('hidden', () => false, { width: 1280, height: 720, top: 0, left: 0 });
  const visible = mk('visible', () => true);
  const ctor = makeDocumentCtor();
  const doc = makeDocument([hidden, visible], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle() { styleReads++; return { display: 'block', visibility: 'visible', opacity: '1' }; },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(hidden.playCalls.length === 0, 'checkVisibility=false element must be skipped');
  assert(visible.playCalls.length === 1, 'visible element must win');
  assert(styleReads === 0, 'getComputedStyle must not be called when checkVisibility exists, got ' + styleReads);
});

// 3m. fallback path: opacity written as '0.000' must count as hidden (parseFloat)
test('3m. fallback path treats opacity 0.000 as hidden (parseFloat)', () => {
  const video = {
    id: 'main',
    paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: { width: 1280, height: 720, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
    // no checkVisibility -> fallback path
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle() { return { display: 'block', visibility: 'visible', opacity: '0.000' }; },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 0, 'opacity 0.000 must be treated as hidden');
});

// 3n. checkVisibility throwing must fall back to getComputedStyle (guard test)
test('3n. checkVisibility throwing falls back to getComputedStyle', () => {
  const video = {
    id: 'hidden',
    paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: { width: 1280, height: 720, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    checkVisibility() { throw new Error('checkVisibility boom'); },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const storage = makeStorage();
  const win = makeWindow(storage, {
    getComputedStyle() { return { display: 'none', visibility: 'visible', opacity: '1' }; },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc); // must not throw
  assert(video.playCalls.length === 0, 'fallback must reject the element');
});

// 3o. checkVisibility must be asked for contentVisibilityAuto explicitly:
// the switch defaults to false, so content-visibility:auto subtrees would
// otherwise be treated as visible.
test('3o. checkVisibility is called with contentVisibilityAuto: true', () => {
  const seen = [];
  const video = {
    id: 'main', paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: { width: 1280, height: 720, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    checkVisibility(opts) { seen.push(opts); return true; },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  const win = makeWindow(makeStorage(), {
    getComputedStyle() { throw new Error('must not be reached'); },
  });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(seen.length === 1, 'checkVisibility must be called once, got ' + seen.length);
  assert(seen[0].contentVisibilityAuto === true, 'contentVisibilityAuto must be true');
  assert(seen[0].checkOpacity === true && seen[0].checkVisibilityCSS === true,
    'checkOpacity and checkVisibilityCSS must stay on');
  assert(video.playCalls.length === 1, 'visible element must be selected');
});

// 3p. Engines that reject the wider option set: retried with the minimal set.
test('3p. checkVisibility rejecting the wider option set retries minimally', () => {
  const seen = [];
  const video = {
    id: 'main', paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: { width: 1280, height: 720, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    checkVisibility(opts) {
      seen.push(opts);
      if (Object.hasOwn(opts, 'contentVisibilityAuto')) throw new Error('unsupported option');
      return true;
    },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc); // must not throw
  assert(seen.length === 2, 'expected a retry, got ' + seen.length + ' call(s)');
  assert(!Object.hasOwn(seen[1], 'contentVisibilityAuto'), 'retry must drop contentVisibilityAuto');
  assert(video.playCalls.length === 1, 'element must still be selected after the retry');
});

// 3q. Engines between the two support floors (Chrome 105-120 / Firefox 106-121)
// have the method but silently drop the unknown contentVisibilityAuto member
// during Web IDL dictionary conversion. That cannot be detected from script
// code, so the call must succeed in one go: no retry, no throw. The missing
// content-visibility:auto filtering is a documented limitation, not a bug we
// can work around here.
test('3q. engines that silently ignore the option are not retried', () => {
  let calls = 0;
  const video = {
    id: 'main', paused: false, ended: false, readyState: 4,
    playCalls: [],
    rect: { width: 1280, height: 720, top: 0, left: 0 },
    getBoundingClientRect() { return this.rect; },
    checkVisibility() { calls += 1; return true; },
    play() { this.playCalls.push(this.id); return Promise.resolve(); },
  };
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(calls === 1, 'checkVisibility must be called exactly once, got ' + calls);
  assert(video.playCalls.length === 1, 'element must still be selected on such engines');
});
// 3r. A zero-size video alone on the page must not be nudged (line 92: the
// width/height guard). The rect is offset from the origin on purpose: a 0x0
// rect at (0,0) is also rejected by the "fully above/left" check on line 97,
// which would hide a missing width/height guard. With a second video present
// the larger-area race hides the predicate too, so the single-candidate,
// offset case is the only real probe.
test('3r. a single zero-size video is not nudged', () => {
  const v = makeVideo({ id: 'zero', paused: false, rect: { width: 0, height: 0, top: 100, left: 100 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([v], ctor);
  const win = makeWindow(makeStorage(), { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: makeConsole() });
  triggerVisibilityChange(doc);
  assert(v.playCalls.length === 0, 'zero-size video must not be nudged');
});

// 3s. A video whose top edge is below the viewport must be skipped
// (line 101: the far-edge check against innerHeight).
test('3s. a video below the viewport is not nudged', () => {
  const v = makeVideo({ id: 'below', paused: false, rect: { width: 640, height: 360, top: 1200 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([v], ctor);
  const win = makeWindow(makeStorage(), { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: makeConsole() });
  triggerVisibilityChange(doc);
  assert(v.playCalls.length === 0, 'video starting below the viewport must not be nudged');
});

// 3t. A video whose left edge is right of the viewport must be skipped
// (line 102: the far-edge check against innerWidth).
test('3t. a video right of the viewport is not nudged', () => {
  const v = makeVideo({ id: 'right', paused: false, rect: { width: 640, height: 360, left: 2000 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([v], ctor);
  const win = makeWindow(makeStorage(), { innerWidth: 1600, innerHeight: 900 });
  runScript(BODY, { document: doc, window: win, Document: ctor, console: makeConsole() });
  triggerVisibilityChange(doc);
  assert(v.playCalls.length === 0, 'video starting right of the viewport must not be nudged');
});

// 3u. A video entirely left of the viewport must be skipped (line 97, left
// half: rect.left + rect.width <= 0); 3j only covers the top half.
test('3u. a video left of the viewport is not nudged', () => {
  const v = makeVideo({ id: 'left', paused: false, rect: { width: 640, height: 360, left: -2000 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([v], ctor);
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: makeConsole() });
  triggerVisibilityChange(doc);
  assert(v.playCalls.length === 0, 'video entirely left of the viewport must not be nudged');
});

// 3v. A large paused video must not shadow a smaller playing one: the paused
// candidate is skipped inside getVideo(), so the playing video still gets the
// nudge, and the paused one is never resumed.
test('3v. a paused larger video does not shadow a playing one', () => {
  const big = makeVideo({ id: 'bigPaused', paused: true, rect: { width: 1280, height: 720 } });
  const small = makeVideo({ id: 'smallPlaying', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([big, small], ctor);
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: makeConsole() });
  triggerVisibilityChange(doc);
  assert(small.playCalls.length === 1, 'the playing video must be nudged');
  assert(big.playCalls.length === 0, 'the paused video must never be resumed');
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

// 5. Exactly three nudges registered per script execution: visibilitychange,
// webkitvisibilitychange (Safari < 17) and Page Lifecycle 'resume', all on
// the capture phase. Nothing else - keeps the no-event-blocking guarantee.
test('5. exactly three listeners per script execution (capture)', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  assert(doc.listeners.length === 3, 'expected exactly 3 listeners, got ' + doc.listeners.length);
  const types = doc.listeners.map(x => x.type).sort();
  assert(types.join(',') === 'resume,visibilitychange,webkitvisibilitychange',
    'unexpected listener types: ' + types.join(','));
  assert(doc.listeners.every(x => x.capture === true), 'all listeners must be capture-phase');
});

// 5b. The legacy webkit and Page Lifecycle events also nudge playVideo().
test('5b. webkitvisibilitychange and resume events nudge playVideo()', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 } });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });

  const fire = (type) => {
    const l = doc.listeners.find(x => x.type === type);
    assert(l, type + ' listener must be registered');
    l.fn({});
  };
  fire('webkitvisibilitychange');
  assert(video.playCalls.length === 1, 'webkitvisibilitychange must nudge play()');
  fire('resume');
  assert(video.playCalls.length === 2, 'resume must nudge play()');
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
  assert(consoleMock.warns.length === 1, 'expected a warning, got: ' + consoleMock.warns);
  assert(/visibility freeze failed/.test(consoleMock.warns[0]), 'warning must say the freeze failed');
  assert(!/partially/.test(consoleMock.warns[0]), 'a total failure must not be reported as partial');
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
  const desc = Object.getOwnPropertyDescriptor(ctor.prototype, 'hidden');
  assert(desc && desc.enumerable === true, 'frozen property must be enumerable like the native one');
  assert(typeof desc.set === 'function', 'frozen property must expose a no-op setter');
  doc.hidden = true; // must not throw and must not change the value
  assert(doc.hidden === false, 'hidden must still read false after a write attempt');
  assert(consoleMock.warns.length === 0, 'no warning when prototype path succeeds');
});

// 6d. The read-back after defineProperty is what tells a silent no-op apart
// from a real freeze: the prototype define succeeds here, but an own
// non-configurable `hidden` on the instance shadows it, so document.hidden
// stays true. The script must notice, try the instance path, fail it too, and
// report a PARTIAL failure naming `hidden` - while the other three properties
// still get frozen.
test('6d. silent no-op define is caught by the read-back, partial failure logged', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  Object.defineProperty(doc, 'hidden', { value: true, configurable: false, enumerable: true, writable: false });
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  assert(doc.hidden === true, 'sanity: the own non-configurable hidden must survive the freeze attempt');
  assert(doc.visibilityState === 'visible', 'other properties must still end up frozen');
  assert(consoleMock.warns.length === 1, 'expected exactly one warning, got: ' + consoleMock.warns);
  assert(/partially failed/.test(consoleMock.warns[0]), 'warning must say partial failure');
  assert(/hidden/.test(consoleMock.warns[0]), 'warning must name the property that failed');
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

// 9. Zero videos on the page: the visibilitychange listener must not throw,
// and it must still query the DOM (a listener that returns early without
// looking would also "not throw", so the query itself is asserted).
test('9. no videos on page — listener does not throw', () => {
  const ctor = makeDocumentCtor();
  const doc = makeDocument([], ctor);
  let queries = 0;
  doc.getElementsByTagName = function (tag) { queries += 1; return []; };
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(queries === 1, 'listener must query the DOM once per event, got ' + queries);
});

// 10. Legacy engine: play() returns undefined, not a Promise - must not throw.
test('10. play() returning undefined does not throw', () => {
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 }, playResult: undefined });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 1, 'play() must be called on the playing video');
  assert(video.playReturns.length === 1 && video.playReturns[0] === undefined,
    'play() must genuinely return undefined (hasOwn path), got ' + String(video.playReturns[0]));
});

// 11b. play() returning a thenable: the rejection handler must actually be
// attached. A controlled thenable makes the assertion deterministic instead of
// hoping an unhandled rejection would surface.
test('11b. play() rejection handler is attached to the returned promise', () => {
  let handler = null;
  const thenable = { then() {}, catch(fn) { handler = fn; return this; } };
  const video = makeVideo({ id: 'main', paused: false, rect: { width: 640, height: 360 }, playResult: thenable });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 1, 'play() must be called');
  assert(video.playReturns[0] === thenable, 'mock must return the thenable');
  assert(typeof handler === 'function', 'a rejection handler must be attached to the returned promise');
  handler(new Error('autoplay blocked')); // must swallow, not rethrow
});

// 11c. End-to-end with a real rejected Promise: the runner must survive it.
// (The runner sets process.exitCode instead of calling process.exit(), so a
// missing .catch() would crash the run as an unhandled rejection.)
test('11c. real rejected Promise from play() is consumed', () => {
  const video = makeVideo({
    id: 'main', paused: false, rect: { width: 640, height: 360 },
    playResult: Promise.reject(new Error('autoplay blocked')),
  });
  const ctor = makeDocumentCtor();
  const doc = makeDocument([video], ctor);
  const consoleMock = makeConsole();
  runScript(BODY, { document: doc, window: makeWindow(makeStorage()), Document: ctor, console: consoleMock });
  triggerVisibilityChange(doc);
  assert(video.playCalls.length === 1, 'play() must be called');
  assert(video.playReturns[0] instanceof Promise, 'mock must return a Promise here');
});

// ---- summary -----------------------------------------------------------

console.log('\n' + pass + ' passed, ' + fail + ' failed');
// Set exitCode instead of calling process.exit(): an immediate exit can tear
// the loop down before an unhandled rejection is reported, which would let a
// missing .catch() in the script slip through. Node >= 15 turns an unhandled
// rejection into an uncaught exception, so the run fails loudly.
process.exitCode = fail === 0 ? 0 : 1;
