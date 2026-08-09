# Twitch - Disable automatic video downscale

**v1.4.6** - Prevents Twitch from downscaling video when the tab is in the background.

**[Install](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

Source: [GitHub](https://github.com/SkeletonTM/twitch-no-downscale) · Original: [CommanderRoot/Taizun on GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## Replaces the original script

This fork keeps the original script's `@name` and `@namespace`, so userscript managers treat it as the same script. Installing it over the GreasyFork original **replaces it**, and updates are then served from this repository. Uninstall the original first if you want to keep both.

## How it works

The script freezes the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (`document.hidden`, `document.webkitHidden`, `document.visibilityState`, `document.webkitVisibilityState`) so Twitch always believes the tab is visible and never drops the stream quality in the background. Each property is frozen independently with a verified fallback to the `document` instance, so a partial failure never leaves the page half-frozen and is always logged.

It also writes a quality hint to `localStorage` once per page load.

## Changelog

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

- **Video selection is a best-effort heuristic:** the active element is chosen by viewport intersection, computed style (`display`/`visibility`/`opacity`), readiness (`readyState > 0`, not `ended`), and largest visible area. This is better than `videos[0]` but does not guarantee the main stream is chosen when an ad and the stream are visible simultaneously.
- **Legacy `localStorage` keys are unvalidated on current Twitch:** the current desktop player may use separate Amazon IVS preference keys. The legacy keys (`video-quality`, `quality-bitrate`, `s-qs-ts`) have not been validated against a live player in this repository, so their effect may be a no-op on current Twitch builds. They are kept for compatibility with older player builds; the visibility freeze is the mechanism that actually prevents downscale.
- **Manual pause vs. browser pause cannot be distinguished** via the public API, so a video paused by the browser (not the user) is also never auto-resumed; conservative by design.
- **Firefox note (from upstream):** on Windows, Firefox users may additionally want `widget.windows.window_occlusion_tracking.enabled = false` in `about:config` if background tabs stutter; this is a browser-level occlusion optimisation, separate from Twitch's quality drop.

## Tests

Automated behaviour tests live in [`tests/run-tests.js`](tests/run-tests.js) (pure Node, no dependencies):

```sh
node tests/run-tests.js
```

Covers: top-frame guard, manual-pause preservation, ended/uninitialized/hidden/off-viewport video skipping, CSS-hidden/`display:none`/`opacity:0` selection, zero-size viewport, multi-video selection (largest visible wins), no event blocking, single listener per script execution, `defineProperty` production path + failure fallback + partial-failure logging, all `startupQuality` cases, `doOnlySetting` mode, zero-video pages, `play()` returning `undefined`, `play()` throwing synchronously, `getComputedStyle()` throwing, single `getBoundingClientRect()` read per candidate, rects without `bottom`/`right`, the `checkVisibility` fast path, `checkVisibility` throwing, and `opacity: 0.000`.

> The userscript is designed to run once per document load (it is injected once at `document-start`). The listener test asserts one registration per script execution, not protection against double injection.

## License

[Unlicense](https://unlicense.org).
