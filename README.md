# Twitch - Disable automatic video downscale

**v1.4.9** - Prevents Twitch from downscaling video when the tab is in the background.

**[Install](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

Source: [GitHub](https://github.com/SkeletonTM/twitch-no-downscale) · Original: [CommanderRoot/Taizun on GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## Replaces the original script

This fork keeps the original script's `@name` and `@namespace`, so userscript managers treat it as the same script. Installing it over the GreasyFork original **replaces it**, and updates are then served from this repository. Uninstall the original first if you want to keep both.

## How it works

The script freezes the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (`document.hidden`, `document.webkitHidden`, `document.visibilityState`, `document.webkitVisibilityState`) so Twitch always believes the tab is visible and never drops the stream quality in the background. Each property is applied and read back independently, with a fallback to the `document` instance. "Independently" means one property can fail while the others stay frozen - the page is not rolled back - and that mixture is reported in the console (`visibility freeze failed` when nothing could be frozen, `partially failed` otherwise).

**This override is not private to the script.** The getters are installed on `Document.prototype`, so every script running in the same page realm reads the forced "visible" state too - `document.hidden` is `false` and `document.visibilityState` is `'visible'` for anyone who asks, including Twitch's own code and any other page script. Events are *not* blocked or suppressed: `visibilitychange` still fires normally and reaches all listeners. Whether *other extensions* see the override depends on the execution world the script ends up in, which is a property of the manager and its settings, not of the browser alone (see Known limitations).

It also writes a quality hint to `localStorage` once per page load.

## Changelog

### v1.4.9
- **Paused videos no longer shadow a playing one** - a large paused `<video>` could win the "largest visible" race and then be skipped by the "never resume a paused video" rule, silently disabling the nudge for a smaller playing stream. `getVideo()` now skips paused candidates; manual pause is still never overridden
- **Freeze warnings tell the truth** - `visibility freeze failed` when nothing was frozen, `partially failed` when only some properties failed (it always said "partially")
- **"Never leaves the page half-frozen" removed** - properties are applied independently, so a partial state is possible; README and the code comment now describe it that way
- **Tests: 37 → 43** - four single-candidate viewport/zero-size cases (each fails when its guard is deleted), a paused-shadowing case, and a read-back case that catches a `defineProperty` that silently does nothing; the vacuous `assert(true)` in the zero-video test replaced by a DOM-query count
- **Listener wording** - one nudge handler registered for three event types, not "one listener"

### v1.4.8
- **Support floors corrected and split** - `checkVisibility()` is Chrome 105 / Firefox 106 / Safari 17.4, the `contentVisibilityAuto` option is Chrome 121 / Firefox 122 / Safari 17.4; the code comment used to blur them into one claim with a wrong Safari version. Engines between the floors drop the unknown option silently, so the `catch`-retry is documented as a rescue for non-standard implementations, not as feature detection, and the missing `content-visibility: auto` filter is listed as a limitation
- **Isolation wording made manager-specific** - "Chrome/Tampermonkey default = isolated, Firefox `@grant none` = page context" was wrong: Tampermonkey documents `raw` (`MAIN_WORLD`) as the default when `@sandbox` is omitted, with fallbacks when injection is blocked. README now points at the manager's sandbox/injection setting instead of naming browsers
- **Rejected-Promise test now asserts the handler** - the old test only checked that a Promise came back. It now uses a controlled thenable and asserts `.catch()` was attached, and the runner sets `process.exitCode` instead of calling `process.exit()` so a genuinely unhandled rejection crashes the run
- **Tests: 35 → 37** - added "engines that silently ignore the option are not retried" and the handler-attachment assertion
- **Source comment and v1.4.5 history aligned** - the comment above `freezeVisibility()` no longer names browser-based world defaults and now matches the README; the v1.4.5 changelog entry keeps its original account, with an explicit correction that its option set did not request `contentVisibilityAuto` (and that the Safari floor is 17.4)

### v1.4.7
- **`contentVisibilityAuto: true`** - the `checkVisibility()` fast path now requests the option its comment always claimed, so elements inside skipped `content-visibility: auto` subtrees are treated as not visible. Engines that reject the wider option set are retried with the minimal set before falling back to `getComputedStyle`
- **Legacy `play()` test actually tested** - the mock used `opts.playResult !== undefined`, which turned an explicit `undefined` into a Promise; it now uses `Object.hasOwn`, and the test asserts the return value really is `undefined`
- **Docs: global API side effect** - README and code comments now state that the freeze overrides `document.hidden` / `document.visibilityState` for every script in the page realm, and that extension isolation worlds decide who else sees it (events stay unblocked)
- **Tests: 32 → 35** - added `contentVisibilityAuto` option assertion, wider-option-set retry, and a rejected-Promise case

### v1.4.6
- **Top-frame guard** — runs only in the top document; Twitch embeds/iframes are skipped (no duplicate listeners, no wasted `localStorage` writes)
- **Legacy Safari event** — also listens to `webkitvisibilitychange` (Safari < 17 dispatched only the prefixed event)
- **Page Lifecycle `resume` nudge** — Chrome's tab freeze/discard can throttle the player while `document.hidden` stays `false`; nudges on `resume` too (a no-op elsewhere)
- **Tests: 30 → 32**

Full history in [CHANGELOG.md](CHANGELOG.md).

## Config

```js
const doOnlySetting = false;  // true = skip freezing, only set localStorage
const startupQuality = 'source';  // quality on page load; '' = don't touch quality
```

- `startupQuality: 'source' | 'best'` → stored as `chunked` (Twitch's internal name for Source/Best)
- any other value (e.g. `'1080p60'`, `'720p60'`) → stored as-is
- an invalid value is stored verbatim; the player falls back to `auto`; no error is raised

### Manual quality vs. `startupQuality`

- A manual in-player quality choice is **not** overwritten on SPA navigation (channel switches): `setQualitySettings()` runs once on page load only.
- On a **full page reload**, `startupQuality` is written again; this is expected behaviour of the current configuration and is required for the hint to survive a reload.
- There is no mechanism that would restore or preserve the user's last manual choice across full reloads; the configured `startupQuality` always wins on load.

## Known limitations

- **Video selection is a best-effort heuristic:** the active element is chosen by viewport intersection, computed style (`display`/`visibility`/`opacity`), readiness (`readyState > 0`, not `ended`), and it must already be playing - a paused element never wins, so a large paused video cannot shadow a smaller playing one. Largest visible area decides between the survivors. This is better than `videos[0]` but does not guarantee the main stream is chosen when an ad and the stream are visible simultaneously.
- **The Page Visibility override is page-wide, by design:** `document.hidden` / `document.visibilityState` (and the `webkit` pairs) are redefined on `Document.prototype`, so *any* script in that page realm that reads them sees "visible" even when the tab is in the background. Event dispatch is untouched - `visibilitychange` still fires and no listener is blocked.
- **Who else sees the override depends on the manager, not the browser:** the script has no `@sandbox` directive, so the effective world is decided by the userscript manager, its version and settings, plus any CSP-driven injection fallback. Tampermonkey documents `raw` (page context, `MAIN_WORLD`) as the default when `@sandbox` is omitted and falls back to other enabled sandboxes when `MAIN_WORLD` injection is blocked; other managers and other settings may inject into an isolated world instead. Check your manager's sandbox/injection setting if you need to know whether page scripts observe the freeze.
- **`content-visibility: auto` filtering needs a newer engine than the rest of the check:** `Element.checkVisibility()` exists from Chrome 105 / Firefox 106 / Safari 17.4, but its `contentVisibilityAuto` option only from Chrome 121 / Firefox 122 / Safari 17.4 (MDN browser-compat-data). On engines between those floors the method silently drops the unknown option (Web IDL conversion does not throw), so a skipped `content-visibility: auto` subtree can still be mistaken for a visible player. The thrown-option retry in the code only helps non-standard implementations; it is not feature detection.
- **Legacy `localStorage` keys are unvalidated on current Twitch:** the current desktop player may use separate Amazon IVS preference keys. The legacy keys (`video-quality`, `quality-bitrate`, `s-qs-ts`) have not been validated against a live player in this repository, so their effect may be a no-op on current Twitch builds. They are kept for compatibility with older player builds; the visibility freeze is the mechanism that actually prevents downscale.
- **Manual pause vs. browser pause cannot be distinguished** via the public API, so a video paused by the browser (not the user) is also never auto-resumed; conservative by design.
- **Firefox note (from upstream):** on Windows, Firefox users may additionally want `widget.windows.window_occlusion_tracking.enabled = false` in `about:config` if background tabs stutter; this is a browser-level occlusion optimisation, separate from Twitch's quality drop.

## Tests

Automated behaviour tests live in [`tests/run-tests.js`](tests/run-tests.js) (pure Node, no dependencies):

```sh
node tests/run-tests.js
```

Covers: top-frame guard, manual-pause preservation, a large paused video not shadowing a playing one, ended/uninitialized/hidden/off-viewport video skipping (a single zero-size candidate, and candidates entirely above, below, left or right of the viewport), CSS-hidden/`display:none`/`opacity:0` selection, zero-size viewport, multi-video selection (largest visible wins), no event blocking, exactly one nudge handler per script execution (three listeners, one per event type), `defineProperty` production path + failure fallback + full and partial-failure logging + the read-back that catches a silently ignored define, all `startupQuality` cases, `doOnlySetting` mode, a DOM query on zero-video pages, `play()` returning `undefined`, an attached `play()` rejection handler, a real rejected `play()` Promise, `play()` throwing synchronously, `getComputedStyle()` throwing, single `getBoundingClientRect()` read per candidate, rects without `bottom`/`right`, the `checkVisibility` fast path, `checkVisibility` receiving `contentVisibilityAuto`, `checkVisibility` rejecting the wider option set and retrying minimally, `checkVisibility` silently ignoring the option (older engines, no retry), `checkVisibility` throwing, and `opacity: 0.000`.

> The userscript is designed to run once per document load (it is injected once at `document-start`). The listener test asserts three registrations - one per event type - per script execution, not protection against double injection.

## License

[Unlicense](https://unlicense.org).
