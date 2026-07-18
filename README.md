# Twitch — Disable automatic video downscale

**v1.3.0** — Улучшенная версия скрипта, который предотвращает автоматическое понижение качества стримов Twitch при сворачивании вкладки.

**Оригинал:** [CommanderRoot/Taizun](https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale)

---

## Что делает

Когда ты сворачиваешь вкладку с Twitch — браузер сообщает сайту, что страница не видна. Twitch в ответ снижает качество видео (часто до 480p или ниже). Этот скрипт обманывает Twitch: сайт думает, что вкладка всегда активна, и не дропает качество.

Работает без потери производительности — только перехват событий, без polling'ов и таймеров.

---

## Установка

### Быстрая (рекомендуется)

Перейти по ссылке — Tampermonkey / Violentmonkey сам предложит установить:

**[Установить v1.3.0](https://raw.githubusercontent.com/SkeletonTM/twitch-no-downscale/main/twitch-no-downscale.user.js)**

### GreasyFork

Оригинал на GreasyFork: https://greasyfork.org/en/scripts/383093-twitch-disable-automatic-video-downscale

---

## Настройка

В начале файла две переменные:

| Переменная | По умолчанию | Описание |
|---|---|---|
| `doOnlySetting` | `false` | `false` — фризинг visibilityState + перехват событий (режим по умолчанию). `true` — только запись качества в localStorage (если фризинг мешает) |
| `startupQuality` | `'source'` | Качество при старте: `'source'`, `'best'`, `'1080p60'`, `'720p60'` и т.д. Можно оставить пустым (`''`), чтобы скрипт вообще не трогал качество — только блокировал downscale |

---

## Чем отличается от оригинала (v1.3.0 vs v1.2.8)

Оригинал содержал несколько багов, которые делали его ненадёжным на современных браузерах.

### Исправленные баги

| Проблема | В оригинале | В v1.3.0 |
|---|---|---|
| **`Object.defineProperty` падает молча** | Без try/catch. Если не срабатывает — весь блок тихо сгорает | Обёрнут в try/catch — graceful degradation с warning в консоль |
| **`document.hidden` не заморожен** | `visibilityState` замокирован, но `hidden` возвращал реальное значение → Twitch мог читать его напрямую | `hidden` тоже фризится |
| **Первый visibilitychange — чёрный экран** | Мёртвый guard (`initialHidden` всегда false) → `stopImmediatePropagation` на каждый чих, включая самый первый | `firstActivation` — первый `hidden→visible` пропускается (чёрного экрана нет), все последующие блокируются |
| **Не работает в Firefox/Safari** | Проверка `typeof chrome` → playVideo() запускался только на Chromium | `canPlayVideo` — проверка `HTMLVideoElement.prototype.play`, работает везде |
| **`popstate` не ловит смену канала** | `window.addEventListener('popstate')` — срабатывает только на back/forward, не на channel switch | `setQualitySettings` вызывается только при старте, чтобы не перезатирать ручной выбор качества |
| **Хардкод 1440p60** | `{"default":"1440p60"}` + `bitrate 9840720` — не соответствовало мониторам 1080p | `startupQuality` с дефолтом `'source'` — Twitch сам выбирает максимальное доступное |

### Что не изменилось

- `@run-at document-start` — перехват до инициализации Twitch
- `capture phase` listener — перехват `visibilitychange` до того, как его увидит Twitch
- `@grant none` — никаких лишних разрешений
- `doOnlySetting` — опция отключить фризинг, оставив только запись качества

---

## Как работает внутри

1. **При загрузке страницы:** устанавливает `startupQuality` в localStorage (один раз). Дальше не трогает качество — твой ручной выбор остаётся.
2. **DefineProperty:** переопределяет `document.visibilityState`, `document.webkitVisibilityState`, `document.hidden` и `document.hasFocus` на константные значения.
3. **Capture phase listener:** перехватывает `visibilitychange` на фазе захвата. Первый `hidden→visible` (если стрим открыт в фоновой вкладке) пропускает, остальные блокирует вызовом `stopImmediatePropagation()`.
4. **Play recovery:** если при возврате на вкладку видео оказалось на паузе (Chrome), принудительно запускает его через `video.play()`.

---

## Совместимость

| Браузер | Статус |
|---|---|
| Chrome ✅ | Полная поддержка |
| Edge ✅ | Поддержка (Chromium) |
| Firefox ✅ | Поддержка (canPlayVideo вместо typeof chrome) |
| Brave ✅ | Должен работать (не тестировался) |
| Opera / Opera GX ✅ | Должен работать (Chromium) |
| Safari ✅ | Должен работать (canPlayVideo + webkitVisibilityState) |
| Supermium ✅ | Подтверждено пользователями |

---

## Репозиторий

https://github.com/SkeletonTM/twitch-no-downscale

Лицензия: **Unlicense** — общественное достояние.
