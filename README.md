# Twitch — Disable automatic video downscale

**v1.3.0** — Prevents Twitch from downscaling video when the tab is in the background.

**[Install](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

Source: [GitHub](https://github.com/SkeletonTM/twitch-no-downscale) · Original: [CommanderRoot/Taizun on GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## Changes in v1.3.0

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

## License

[Unlicense](https://unlicense.org).
