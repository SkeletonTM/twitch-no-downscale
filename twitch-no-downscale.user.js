// ==UserScript==
// @name         Twitch - Disable automatic video downscale
// @namespace    CommanderRoot
// @version      1.4.5
// @description  Disables the automatic downscaling of Twitch streams while tabbed away
// @author       Taizun, CommanderRoot, SkeletonTM
// @match        https://www.twitch.tv/*
// @match        https://m.twitch.tv/*
// @match        https://player.twitch.tv/*
// @grant        none
// @run-at       document-start
// @homepageURL  https://github.com/SkeletonTM/twitch-no-downscale
// @supportURL   https://github.com/SkeletonTM/twitch-no-downscale/issues
// @updateURL    https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js
// @downloadURL  https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js
// @license      Unlicense
// ==/UserScript==

"use strict";

// CONFIG start ------
const doOnlySetting = false; // false = do some trickery with document hidden state / true = only set the localStorage option
const startupQuality = 'source'; // Quality to set on page load: 'source' | 'best' | '1080p60' | '720p60' | etc.
                               // Set to '' to not touch quality at all.
// CONFIG end --------

// Freeze the Page Visibility API so Twitch believes the tab is always visible.
// This is the core downscale-prevention mechanism: Twitch's background
// quality-drop logic keys off document.hidden / document.visibilityState.
//
// Each property is applied independently so a failure in one does not leave
// the rest partially applied, and the applied value is verified before the
// property is considered frozen. No events are blocked and no focus APIs are
// touched, so other scripts and extensions are unaffected.
function freezeVisibility() {
  const props = [
    ['visibilityState', 'visible'],
    ['webkitVisibilityState', 'visible'],
    ['webkitHidden', false],
    ['hidden', false],
  ];
  const applied = [];
  const failed = [];

  for (const [name, value] of props) {
    // configurable: true is deliberate: it lets a re-run of this script (or
    // another userscript) redefine the property without throwing. Hardening
    // to configurable: false would make double injection throw instead.
    // enumerable: true mirrors the native DOM properties; the no-op setter
    // keeps writes (e.g. by other strict-mode scripts) from throwing.
    const desc = { get: () => value, set: () => {}, enumerable: true, configurable: true };
    let ok = false;
    try {
      Object.defineProperty(Document.prototype, name, desc);
      ok = (document[name] === value);
    } catch (e) { /* try instance fallback below */ }
    if (ok) { applied.push(name); continue; }
    try {
      Object.defineProperty(document, name, desc);
      ok = (document[name] === value);
    } catch (e) { /* nothing else to try */ }
    if (ok) { applied.push(name + ' (instance)'); } else { failed.push(name); }
  }

  if (failed.length) {
    console.warn('[twitch-no-downscale] visibility freeze partially failed for: ' + failed.join(', '));
  }
}

// An element with a non-zero layout rect is not necessarily visible: CSS
// visibility:hidden / opacity:0 / display:none keep layout, and an element
// positioned off-viewport still reports its full size. Only a rect that
// actually intersects the viewport and has a non-hidden computed style
// counts as visible.
function isActuallyVisible(v, rect) {
  if (rect.width <= 0 || rect.height <= 0) return false;
  const vw = typeof window.innerWidth === 'number' ? window.innerWidth : Infinity;
  const vh = typeof window.innerHeight === 'number' ? window.innerHeight : Infinity;
  // Derive the far edges from top/left + size instead of reading rect.bottom /
  // rect.right, so the check works on any rect-shaped object (DOMRect included).
  if (rect.top + rect.height <= 0 || rect.left + rect.width <= 0) return false;
  // A zero-size viewport (reported by some platforms for minimized windows)
  // must not reject every video: only apply the far-edge check when the
  // viewport actually has a size.
  if (vh > 0 && rect.top >= vh) return false;
  if (vw > 0 && rect.left >= vw) return false;
  // Native fast path (Chrome 105+/Firefox 106+/Safari 17+): checkVisibility
  // also sees display:none / visibility:hidden on ancestors and accounts for
  // content-visibility:auto, which getComputedStyle on the element cannot.
  // Fall back to getComputedStyle when the method is absent or throws.
  if (typeof v.checkVisibility === 'function') {
    try {
      return v.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
    } catch (e) { /* non-standard environment: fall through */ }
  }
  // getComputedStyle is guarded: a patched or non-standard environment may
  // throw, and a failed style read must not break the visibility listener.
  let style = null;
  try {
    style = window.getComputedStyle ? window.getComputedStyle(v) : null;
  } catch (e) { /* non-standard environment */ }
  if (style) {
    if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) return false;
  }
  return true;
}

// Pick the main player <video>. A Twitch page can contain several video
// elements (ad player, stale element left over from a channel switch, hidden
// preview), and document order is not a reliable signal, so the element that
// is actually visible on screen and has a playable stream wins. No fragile
// CSS classes are used: Twitch does not expose a stable selector for the
// main player. Compromise: in the rare case where an ad and the stream are
// both visible at once, the larger element (the stream) wins.
function getVideo() {
  const videos = document.getElementsByTagName('video');
  let best = null;
  let bestArea = -1;
  for (let i = 0; i < videos.length; i++) {
    const v = videos[i];
    if (v.ended || v.readyState === 0) continue;
    const rect = v.getBoundingClientRect();
    if (!isActuallyVisible(v, rect)) continue;
    const area = rect.width * rect.height;
    if (area > bestArea) {
      bestArea = area;
      best = v;
    }
  }
  return best;
}

// Keep the stream playing when visibility events fire. The script never
// resumes a paused video because the public API cannot distinguish a manual
// pause from a browser- or Twitch-induced pause — both report paused === true.
// Taking the conservative route (only nudging already-playing videos) means a
// manual pause is always preserved; the cost is that a browser-induced pause
// is not auto-resumed either.
function playVideo() {
  const video = getVideo();
  if (!video || video.paused || video.ended) return;
  // play() on an already-playing video is a no-op for the media pipeline;
  // the call exists to reset the browser's internal autoplay timers so that
  // aggressive background optimizations (e.g. Battery Saver) do not throttle
  // the player while the tab is hidden. .catch() guards against an unhandled
  // rejection if the browser's autoplay policy intervenes.
  // Legacy engines may return undefined instead of a Promise — guard for it.
  try {
    const p = video.play();
    if (p && typeof p.catch === 'function') p.catch(() => {});
  } catch (e) { /* legacy engines may throw synchronously */ }
}

// The script is designed to run once per document load (injected once at
// document-start by the userscript manager), so exactly one listener is
// registered per execution.
if (doOnlySetting === false) {
  freezeVisibility();

  document.addEventListener('visibilitychange', function () {
    playVideo();
  }, true);
}

// Set quality once on page load. NOTE: as of 2026 the desktop Twitch player
// (Amazon IVS) stores its quality preference under its own keys
// (amazon_ivs_device_config_*, *_amazon_ivs_dc_player-web-v1_*) and does not
// ship these legacy keys at all; writing them is harmless (Twitch leaves them
// untouched) and older player builds still honour them. They are deliberately
// NOT re-applied on navigation: re-applying would overwrite the user's manual
// quality choice.
function setQualitySettings() {
  if (!startupQuality) return;
  try {
    // Twitch uses 'chunked' for Source / Best quality in localStorage
    const targetQuality = (startupQuality === 'source' || startupQuality === 'best') ? 'chunked' : startupQuality;
    const now = Date.now();
    window.localStorage.setItem('s-qs-ts', now);
    // quality-bitrate is a legacy key kept for compatibility; '0' is written
    // as a no-bitrate-cap hint. Like the other legacy keys its effect on
    // current players is unvalidated (see README "Known limitations").
    window.localStorage.setItem('quality-bitrate', '0');
    window.localStorage.setItem('video-quality', JSON.stringify({ default: targetQuality }));
  } catch (e) {
    console.warn('[twitch-no-downscale] setQualitySettings failed:', e);
  }
}

setQualitySettings();
