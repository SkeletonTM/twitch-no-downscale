// ==UserScript==
// @name         Twitch - Disable automatic video downscale
// @namespace    CommanderRoot
// @version      1.3.1
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

// Code
if (doOnlySetting === false) {
  const forceVisible = { get: () => 'visible', configurable: true };
  const forceNotHidden = { get: () => false, configurable: true };

  try {
    Object.defineProperty(Document.prototype, 'visibilityState', forceVisible);
    Object.defineProperty(Document.prototype, 'webkitVisibilityState', forceVisible);
    Object.defineProperty(Document.prototype, 'hidden', forceNotHidden);
    Document.prototype.hasFocus = function () { return true; };
  } catch (e) {
    try {
      Object.defineProperty(document, 'visibilityState', forceVisible);
      Object.defineProperty(document, 'webkitVisibilityState', forceVisible);
      Object.defineProperty(document, 'hidden', forceNotHidden);
      document.hasFocus = function () { return true; };
    } catch (err) {
      console.warn('[twitch-no-downscale] visibilityState freeze failed:', err.message);
    }
  }

  let didInitialPlay = false;
  let lastVideoPlaying = false;
  let firstActivation = true;

  document.addEventListener('visibilitychange', function (e) {
    if (firstActivation) {
      firstActivation = false;
    } else {
      e.stopImmediatePropagation();
    }

    const canPlayVideo = typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.play === 'function';
    if (canPlayVideo) {
      const videos = document.getElementsByTagName('video');
      if (videos.length > 0) {
        lastVideoPlaying = !videos[0].paused && !videos[0].ended;
        if (!videos[0].ended) {
          playVideo();
        }
      }
    }
  }, true);

  function playVideo() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
      if ((didInitialPlay === false || lastVideoPlaying === true) && !videos[0].ended) {
        videos[0].play().catch(() => {});
        didInitialPlay = true;
      }
    }
  }
}

function setQualitySettings() {
  if (!startupQuality) return;
  try {
    // Twitch uses 'chunked' for Source / Best quality in localStorage
    const targetQuality = (startupQuality === 'source' || startupQuality === 'best') ? 'chunked' : startupQuality;
    const now = Math.floor(Date.now());
    window.localStorage.setItem('s-qs-ts', now);
    window.localStorage.setItem('quality-bitrate', '0');
    window.localStorage.setItem('video-quality', JSON.stringify({ default: targetQuality }));
  } catch (e) {
    console.warn('[twitch-no-downscale] setQualitySettings failed:', e);
  }
}

// Re-apply quality settings on SPA channel navigation
function onNavigate() {
  setTimeout(setQualitySettings, 500);
}

if (typeof window !== 'undefined') {
  if (window.navigation) {
    window.navigation.addEventListener('navigatesuccess', onNavigate);
  }
  const origPushState = history.pushState;
  if (typeof origPushState === 'function') {
    history.pushState = function (...args) {
      origPushState.apply(this, args);
      onNavigate();
    };
  }
  window.addEventListener('popstate', onNavigate);
}

setQualitySettings();
