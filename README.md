# Twitch — Disable automatic video downscale

**v1.4.5** — Prevents Twitch from downscaling video when the tab is in the background.

**[Install](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

Source: [GitHub](https://github.com/SkeletonTM/twitch-no-downscale) · Original: [CommanderRoot/Taizun on GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## Replaces the original script

This fork keeps the original script's `@name` and `@namespace`, so userscript managers treat it as the same script. Installing it over the GreasyFork original **replaces it**, and updates are then served from this repository. Uninstall the original first if you want to keep both.

## How it works

The script freezes the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (`document.hidden`, `document.webkitHidden`, `document.visibilityState`, `document.webkitVisibilityState`) so Twitch always believes the tab is visible and never drops the stream quality in the background. Each property is frozen independently with a verified fallback to the `document` instance, so a partial failure never leaves the page half-frozen and is always logged.

It also writes a quality hint to `localStorage` once per page load.

## Changes

### v1.4.5
- **`checkVisibility()` fast path** — visibility is decided by the native `Element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` when available (Chrome 105+/Firefox 106+/Safari 17+); unlike `getComputedStyle` on the element, it also sees `display:none`/`visibility:hidden` on ancestors and honours `content-visibility:auto`. The `getComputedStyle` check remains as a guarded fallback
- **Opacity parsed numerically** — the fallback treats `opacity: 0.000` as hidden, not just the exact string `'0'`
- **Freeze descriptor** — frozen visibility properties are now `enumerable` (mirroring native DOM properties) and carry a no-op setter, so writes from other strict-mode scripts cannot throw
- **Tests: 27 → 30** — added cases for the `checkVisibility` fast path, `checkVisibility` throwing, and `opacity: 0.000`

### v1.4.4
- **`getComputedStyle()` guarded** — a patched or non-standard environment that throws on style reads can no longer break the `visibilitychange` listener
- **Single layout read per candidate** — `getBoundingClientRect()` is read once per video; the far-edge check derives `bottom`/`right` from `top`/`left` + size, so it works on any rect-shaped object
- **Tests: 24 → 27** — added cases for `getComputedStyle()` throwing, one-rect-read-per-candidate, and a rect without `bottom`/`right`

### v1.4.3
- **Zero-size viewport guard** — a minimized window reporting `0×0` no longer causes the player-selection heuristic to reject every video
- **`play()` fully guarded** — engines that throw synchronously (legacy) can no longer break the `visibilitychange` listener
- **Tests: 20 → 24** — added `display:none` and `opacity:0` computed-style cases, a zero-size viewport case, and a sync-throw `play()` case

### v1.4.2
- **Hardened player selection** — a video must intersect the viewport and have a non-hidden computed style (`visibility`, `opacity`, `display`) to be considered; CSS-hidden and off-viewport elements no longer win over the real stream
- **Frozen `document.webkitHidden`** (legacy Safari) in addition to the other visibility properties
- **`play()` guard** — handles engines where `play()` returns `undefined` instead of a Promise
- **Docs** — documented why `quality-bitrate: '0'` is written and why the frozen props stay `configurable: true`
- **Tests: 15 → 20** — the mock document now inherits from `Document.prototype`, so the tests exercise the production freeze path instead of the instance fallback; added cases for CSS-hidden/off-viewport selection, zero videos, and `play()` returning `undefined`

### v1.4.1
- **Docs** — toned down claims about player selection, `hasFocus()`, and legacy `localStorage` keys to match the actual evidence level (see Known limitations)

### v1.4.0
- **Manual pause is preserved** — `play()` is only called on videos that are *already playing*; a video the user paused is never resumed. (The public API cannot distinguish a manual pause from one caused by the browser/Twitch — both report `paused === true` — so the script takes the conservative route and never touches a paused video.)
- **Best-effort active player selection** — the active `<video>` is picked by visibility and playable state (`readyState > 0`, not `ended`), largest visible element wins; `videos[0]` is no longer trusted blindly (ads, stale elements, hidden previews). This is a heuristic, not a guarantee: when an ad and the stream are visible at the same time, the largest element wins and the main stream is not guaranteed to be chosen
- **No more `stopImmediatePropagation()`** — the global capture-phase event blocking is gone; other scripts and extensions receive `visibilitychange` normally (the freeze alone prevents downscale)
- **Removed `hasFocus()` override** — the override was removed because it affected the whole page and its necessity for downscale prevention was not established
- **Independent `defineProperty`** — each visibility property is applied and verified separately, so a failure in one does not leave a partially applied config; partial failure is logged
- **Optimizations** — `getVideo()` is queried once per event, `Math.floor(Date.now())` dropped (`Date.now()` is already an integer), no polling, one listener per script execution

### v1.3.3
- **Removed SPA re-apply** — quality is set once on page load only, so manual quality selection is never overwritten
- **Dropped dead `didInitialPlay` state** — `playVideo()` no longer tracks unused flags

### v1.3.2
- **Cleanup** — extracted `getVideo()` helper, simplified `playVideo()`, added `.catch()` on `play()`

### v1.3.1
- **Freeze on `Document.prototype`** with fallback to `document` instance — works in modern browsers where instance-level `defineProperty` is silently ignored
- **`source`/`best` → `chunked` remap** — Twitch's `localStorage` value for Source quality is `chunked`; writing `source` silently falls back to `auto`

### v1.3.0
- **try/catch around `Object.defineProperty`** — doesn't fail silently anymore
- **`document.hidden` is frozen** — Twitch can't poll it directly
- **First `hidden→visible` allowed through** — no more black screen on new tab open
- **Cross-browser** — works in Firefox/Safari, not just Chrome
- **Doesn't override manual quality selection** — `setQualitySettings` only called on page load

## Config

```js
const doOnlySetting = false;  // true = skip freezing, only set localStorage
const startupQuality = 'source';  // quality on page load; '' = don't touch quality
```

- `startupQuality: 'source' | 'best'` → stored as `chunked` (Twitch's internal name for Source/Best)
- any other value (e.g. `'1080p60'`, `'720p60'`) → stored as-is
- an invalid value is stored verbatim; the player falls back to `auto` — no error is raised

## Manual quality vs. `startupQuality`

- A manual in-player quality choice is **not** overwritten on SPA navigation (channel switches): `setQualitySettings()` runs once on page load only.
- On a **full page reload**, `startupQuality` is written again — this is expected behaviour of the current configuration and is required for the hint to survive a reload.
- There is no mechanism that would restore or preserve the user's last manual choice across full reloads; the configured `startupQuality` always wins on load.

## Known limitations

- **Video selection is a best-effort heuristic.** The active element is chosen by viewport intersection, computed style (`display`/`visibility`/`opacity`), readiness (`readyState > 0`, not `ended`), and largest visible area. This is better than `videos[0]` but does not guarantee the main stream is chosen when an ad and the stream are visible simultaneously.
- **Legacy `localStorage` keys are unvalidated on current Twitch.** The current desktop player may use separate Amazon IVS preference keys. The legacy keys (`video-quality`, `quality-bitrate`, `s-qs-ts`) have not been validated against a live player in this repository, so their effect may be a no-op on current Twitch builds. They are kept for compatibility with older player builds; the visibility freeze is the mechanism that actually prevents downscale.
- **Manual pause vs. browser pause cannot be distinguished** via the public API, so a video paused by the browser (not the user) is also never auto-resumed — conservative by design.
- **Firefox note (from upstream):** on Windows, Firefox users may additionally want `widget.windows.window_occlusion_tracking.enabled = false` in `about:config` if background tabs stutter — this is a browser-level occlusion optimisation, separate from Twitch's quality drop.

## Tests

Automated behaviour tests live in [`tests/run-tests.js`](tests/run-tests.js) (pure Node, no dependencies):

```sh
node tests/run-tests.js
```

Covers: manual-pause preservation, ended/uninitialized/hidden/off-viewport video skipping, CSS-hidden/`display:none`/`opacity:0` selection, zero-size viewport, multi-video selection (largest visible wins), no event blocking, single listener per script execution, `defineProperty` production path + failure fallback + partial-failure logging, all `startupQuality` cases, `doOnlySetting` mode, zero-video pages, `play()` returning `undefined`, `play()` throwing synchronously, `getComputedStyle()` throwing, single `getBoundingClientRect()` read per candidate, rects without `bottom`/`right`, the `checkVisibility` fast path, `checkVisibility` throwing, and `opacity: 0.000`.

> The userscript is designed to run once per document load (it is injected once at `document-start`). The listener test asserts one registration per script execution, not protection against double injection.

## License

[Unlicense](https://unlicense.org).
