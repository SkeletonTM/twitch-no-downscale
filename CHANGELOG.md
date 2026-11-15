# Changelog

### v1.4.9
- **Paused videos no longer shadow a playing one** - `getVideo()` kept paused candidates and `playVideo()` then bailed on `video.paused`, so a large paused `<video>` (ad player, stale element) suppressed the nudge for a smaller playing stream. Paused elements are now skipped during selection; a paused video is still never resumed, so manual pause stays preserved. Verified by a probe and test `3v`
- **Full vs partial freeze failure** - the warning said "partially failed" even when all four properties failed. It now says `visibility freeze failed` when nothing was frozen and `partially failed` otherwise
- **"Never leaves the page half-frozen" was false** - properties are applied independently, so one can fail while others stay frozen. README "How it works" and the `freezeVisibility()` comment now say exactly that
- **Read-back now has teeth** - replacing both `ok = (document[name] === value)` with `ok = true` used to keep the suite green. Test `6d` shadows the prototype getter with a non-configurable own `hidden`, so a silently ignored define is caught and reported
- **Single-candidate viewport tests** - deleting the `width/height`, `top >= innerHeight`, `left >= innerWidth` or `left + width <= 0` guards used to leave 37/37 green, because other fixtures masked them. Tests `3r`-`3u` each fail when their own guard is removed (the 0x0 case is offset from the origin, otherwise line 97 hides it)
- **Vacuous assertion removed** - test 9 asserted `true`; it now counts `getElementsByTagName` calls
- **Listener wording** - the script registers one nudge handler for three event types (three listeners); comments and README said "one listener per script execution"
- **Tests: 37 → 43**

### v1.4.8
- **Split the support floors** - `checkVisibility()`: Chrome 105 / Firefox 106 / Safari 17.4. `contentVisibilityAuto` option: Chrome 121 / Firefox 122 / Safari 17.4 (MDN browser-compat-data). The comment claimed "Chrome 105+/Firefox 106+/Safari 17+" for both and Safari 17 is not even the base-method floor
- **Retry is not feature detection** - engines between the floors keep the method and drop the unknown dictionary member silently (Web IDL conversion does not throw), so the `catch`-retry stays only as a rescue for non-standard throwers. The missing `content-visibility: auto` filter on those versions is documented as a limitation
- **Isolation wording corrected** - Tampermonkey documents `raw` (`MAIN_WORLD`) as the default when `@sandbox` is omitted, with fallbacks when `MAIN_WORLD` injection is blocked, so "Chrome/Tampermonkey default = isolated" and "Firefox + `@grant none` = page context" were wrong. README now defers to the manager's sandbox/injection setting
- **Test 11b made meaningful** - it now uses a controlled thenable and asserts that `.catch()` was attached to the returned promise; the runner sets `process.exitCode` instead of calling `process.exit()`, so a missing handler would surface as an unhandled rejection instead of being cut off by an immediate exit
- **Tests: 35 → 37** - added "engines that silently ignore the option are not retried" (3q) and the handler-attachment assertion (11b); the real rejected-Promise case moved to 11c
- **Last two places aligned** - the comment above `freezeVisibility()` no longer uses browser-based world defaults ("Chrome/Tampermonkey default", "`@grant none` on Firefox"); it now matches the README. The v1.4.5 entry keeps its original account of what shipped, with an explicit correction that its option set did not request `contentVisibilityAuto` and that the Safari floor is 17.4

### v1.4.7
- **`contentVisibilityAuto: true`** - the `checkVisibility()` fast path now passes the option its comment claimed. `contentVisibilityAuto` is a separate switch that defaults to `false`, so skipped `content-visibility: auto` subtrees were previously treated as visible. A throwing wider option set is retried with the minimal set before the `getComputedStyle` fallback
- **Legacy `play()` mock fixed** - `makeVideo()` used `opts.playResult !== undefined`, which converted an explicit `undefined` into `Promise.resolve()`, so the "play() returns undefined" case was never exercised. The mock now uses `Object.hasOwn` and records the return value; the test asserts it really is `undefined`
- **Docs: honest API side effect** - the freeze defines getters on `Document.prototype`, so every script in the page realm sees the forced visible state. README "How it works" / "Known limitations" and the code comment now say so, and note that event dispatch is not blocked while isolation worlds decide which scripts observe the override
- **Tests: 32 → 35** - added `contentVisibilityAuto` option assertion, wider-option-set retry, rejected `play()` Promise

### v1.4.6
- **Top-frame guard** — the script now exits immediately inside Twitch embeds/iframes (`window.top !== window.self`): no duplicate listeners, no wasted `localStorage` writes
- **Legacy Safari event** — listens to `webkitvisibilitychange` in addition to the standard `visibilitychange` (Safari < 17 dispatched only the prefixed event)
- **Page Lifecycle `resume` nudge** — Chrome's tab freeze/discard can throttle the player while `document.hidden` stays `false`; the player is nudged on `resume` too (a no-op on browsers that never dispatch it)
- **Tests: 30 → 32** — added the top-frame guard case, the three-listener registration assertion, and webkit/`resume` nudge checks; the harness now wraps the script body in a function like a real userscript manager

### v1.4.5
- **`checkVisibility()` fast path** — visibility is decided by the native `Element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })` when available (Chrome 105+/Firefox 106+/Safari 17+); unlike `getComputedStyle` on the element, it also sees `display:none`/`visibility:hidden` on ancestors and honours `content-visibility:auto`. The `getComputedStyle` check remains as a guarded fallback *(__Correction, v1.4.8: the option set above did **not** request `contentVisibilityAuto`, which is a separate option defaulting to `false`, so this call did not honour `content-visibility: auto`; that claim was wrong. The Safari floor is also 17.4, not 17. Since v1.4.7 the option is passed; see v1.4.7/v1.4.8 for the real support floors.__)*
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
- **Independent `defineProperty`** — each visibility property is applied and verified separately, so a failure in one does not leave a partially applied config; partial failure is logged *(__Correction, v1.4.9: a single failure does leave the other properties applied - the config **is** partially applied in that case, and is logged as `partially failed`. What the code does guarantee is a read-back of each applied value and a log line naming the properties that failed.__)*
- **Optimizations** — `getVideo()` is queried once per event, `Math.floor(Date.now())` dropped (`Date.now()` is already an integer), no polling, one listener per script execution *(__Correction, v1.4.9: one nudge handler, registered for three event types - `visibilitychange`, `webkitvisibilitychange`, `resume` - so three listeners per execution.__)*

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
