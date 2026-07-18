// ==UserScript==
// @name         Twitch - Disable automatic video downscale
// @namespace    CommanderRoot
// @version      1.3.0
// @description  Disables the automatic downscaling of Twitch streams while tabbed away
// @author       Taizun, CommanderRoot
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
  try {
    Object.defineProperty(document, 'visibilityState', { value: 'visible', writable: false });
    Object.defineProperty(document, 'webkitVisibilityState', { value: 'visible', writable: false });
    Object.defineProperty(document, 'hidden', { value: false, writable: false });
    document.hasFocus = function () { return true; };
  } catch (e) {
    console.warn('[twitch-no-downscale] visibilityState freeze failed:', e.message);
  }

  let didInitialPlay = false;
  let lastVideoPlaying = false;
  let firstActivation = true;

  document.addEventListener('visibilitychange', function (e) {
    if (document.hidden === false && firstActivation) {
      firstActivation = false;
    } else {
      e.stopImmediatePropagation();
    }
    if (document.hidden) {
      didInitialPlay = true;
    }

    const canPlayVideo = typeof HTMLVideoElement !== 'undefined' && typeof HTMLVideoElement.prototype.play === 'function';
    if (canPlayVideo) {
      if (document.hidden === true) {
        const videos = document.getElementsByTagName('video');
        if (videos.length > 0) {
          lastVideoPlaying = !videos[0].paused && !videos[0].ended;
        } else {
          lastVideoPlaying = false;
        }
      } else {
        playVideo();
      }
    }
  }, true);

  function playVideo() {
    const videos = document.getElementsByTagName('video');
    if (videos.length > 0) {
      if ((didInitialPlay === false || lastVideoPlaying === true) && !videos[0].ended) {
        videos[0].play();
        didInitialPlay = true;
      }
    }
  }
}

function setQualitySettings() {
  if (!startupQuality) return;
  try {
    const now = Math.floor(Date.now());
    window.localStorage.setItem('s-qs-ts', now);
    window.localStorage.setItem('quality-bitrate', '0');
    window.localStorage.setItem('video-quality', JSON.stringify({ default: startupQuality }));
  } catch (e) {
    console.log('[twitch-no-downscale] setQualitySettings:', e);
  }
}

setQualitySettings();
