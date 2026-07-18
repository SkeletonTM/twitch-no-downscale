# Twitch — Disable automatic video downscale

**v1.3.0** — Предотвращает автоматическое понижение качества Twitch при сворачивании вкладки.

**[Установить](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)** — автообновление через @updateURL.

Оригинал: [CommanderRoot/Taizun на GreasyFork](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale).

---

## Что исправлено в v1.3.0

- **Обёрнут в try/catch** — если `Object.defineProperty` не срабатывает, не падает молча
- **`document.hidden` фризится** — Twitch не может читать его напрямую
- **Первый `hidden→visible` пропускается** — нет чёрного экрана при открытии в новой вкладке
- **Cross-browser** — работает в Firefox/Safari, не только Chrome
- **Не перезатирает ручной выбор качества** — `setQualitySettings` вызывается только при старте

## Настройка

```js
const doOnlySetting = false;  // true — отключить фризинг, только localStorage
const startupQuality = 'source';  // качество при старте; '' — не трогать
```

## Лицензия

Unlicense.
