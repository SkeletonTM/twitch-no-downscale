# Twitch — Disable automatic video downscale

**Version:** 1.3.0 (improved)  
**Upstream:** https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale

Disables the automatic downscaling of Twitch streams while tabbed away.

## Что исправлено в v1.3.0

- **try/catch** на `Object.defineProperty` — graceful degradation при падении
- **`document.hidden`** тоже фризится — Twitch не может polling'ить напрямую
- **`firstActivation` guard** — первый `hidden→visible` пропускается (чёрный экран), все последующие блокируются
- **Cross-browser** — `canPlayVideo` вместо `typeof chrome` (работает в Firefox/Safari)
- **`startupQuality`** — конфигурируется, по умолчанию `source`. Вызывается только при старте, не перезатирает ручной выбор
- **Убран popstate/pushState hook** — `setQualitySettings` не перезаписывает качество при навигации

## Установка

Установить через Tampermonkey / Violentmonkey / Greasemonkey:
- https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale

Либо вручную скопировать содержимое `twitch-no-downscale.user.js` в новый скрипт.

## Конфиг

В начале файла:

```js
const doOnlySetting = false;      // false = фризинг visibilityState; true = только localStorage
const startupQuality = 'source';   // quality при старте, '' — не трогать
```

## Лицензия

Unlicense (как и оригинал).
