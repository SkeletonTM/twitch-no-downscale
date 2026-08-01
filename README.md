# Twitch — Disable automatic video downscale

**v1.4.0** — Prevents Twitch from downscaling video when the tab is in the background.

**[Install](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

Source: [GitHub](https://github.com/SkeletonTM/twitch-no-downscale) · Original: [CommanderRoot/Taizun on GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## How it works

The script freezes the [Page Visibility API](https://developer.mozilla.org/en-US/docs/Web/API/Page_Visibility_API) (`document.hidden`, `document.visibilityState`, `document.webkitVisibilityState`) so Twitch always believes the tab is visible and never drops the stream quality in the background. Each property is frozen independently with a verified fallback to the `document` instance, so a partial failure never leaves the page half-frozen and is always logged.

It also writes a one-time quality hint to `localStorage` on page load.

## Changes

### v1.4.0
- **Manual pause is preserved** — `play()` is only called on videos that are *already playing*; a video the user paused is never resumed. (The public API cannot distinguish a manual pause from one caused by the browser/Twitch — both report `paused === true` — so the script takes the conservative route and never touches a paused video.)
- **Reliable player selection** — the active `<video>` is picked by visibility (non-zero area) and playable state (`readyState > 0`, not `ended`), largest visible element wins; `videos[0]` is no longer trusted blindly (ads, stale elements, hidden previews)
- **No more `stopImmediatePropagation()`** — the global capture-phase event blocking is gone; other scripts and extensions receive `visibilitychange` normally (the freeze alone prevents downscale)
- **Removed `hasFocus()` override** — no evidence the current Twitch player uses it for downscale; overriding it affected the whole page
- **Independent `defineProperty`** — each visibility property is applied and verified separately, so a failure in one does not leave a partially applied config; partial failure is logged
- **Optimizations** — `getVideo()` is queried once per event, `Math.floor(Date.now())` dropped (`Date.now()` is already an integer), no polling, no listener duplication

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

## Known limitations

- **`startupQuality` is written on every page load.** This is by design: without it the hint would be lost after a full reload. It does *not* overwrite a manual in-player choice made *during* the session (Twitch persists that itself between channel switches); only a page reload re-applies the configured value.
- **As of 2026 the desktop Twitch player (Amazon IVS) does not ship the legacy `localStorage` keys** (`video-quality`, `quality-bitrate`, `s-qs-ts`) — it stores its own preference keys (`amazon_ivs_device_config_*`). Writing the legacy keys is harmless (Twitch leaves them untouched) and they are still honoured by older player builds, but the one-time quality hint may be a no-op on the current player; the visibility freeze is the mechanism that actually prevents downscale.
- **Manual pause vs. browser pause cannot be distinguished** via the public API, so a video paused by the browser (not the user) is also never auto-resumed — conservative by design.

## Tests

Automated behaviour tests live in [`tests/run-tests.js`](tests/run-tests.js) (pure Node, no dependencies):

```sh
node tests/run-tests.js
```

Covers: manual-pause preservation, ended/uninitialized/hidden video skipping, multi-video selection (largest visible wins), no event blocking, single listener registration, `defineProperty` failure fallback + partial-failure logging, all `startupQuality` cases, and `doOnlySetting` mode.

## License

[Unlicense](https://unlicense.org).
