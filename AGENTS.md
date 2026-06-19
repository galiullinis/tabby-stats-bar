# AGENTS.md — рабочий контекст проекта `tabby-server-stats`

> Файл для быстрого входа в проект. Держим кратким и актуальным. После каждого
> значимого изменения обновляем разделы «Журнал изменений», «Известные проблемы»
> и «Следующие задачи». Не дублируем сюда код и не превращаем в длинный лог.

## 1. Назначение
Плагин для **Tabby Terminal**: отображает нагрузку сервера (CPU, RAM, Disk, Network)
и произвольные пользовательские метрики для SSH-сессий и локальных терминалов
(Linux/macOS). Два режима отображения: **нижняя панель** (per-tab, привязка к
элементу `ssh-tab`) и **плавающая панель** (singleton, графики Chart.js).

## 2. Ключевые файлы и зоны ответственности
| Файл | Ответственность |
|------|-----------------|
| [src/index.ts](src/index.ts) | `ServerStatsModule` — оркестрация: обнаружение вкладок, инъекция bottom-bar в DOM `ssh-tab`, переключение режимов, lifecycle вкладок, polling per-tab. |
| [src/services/stats.service.ts](src/services/stats.service.ts) | Сбор метрик: shell-команда, выполнение по SSH-каналу или локально, parsing, guard от параллельных запросов. Делегирует чистую логику в модули ниже. |
| [src/services/stats-parser.ts](src/services/stats-parser.ts) | **Чистая логика** (тестируемая): `parseStatsOutput`, `buildCustomMetricsFragment`, `formatSpeed`, маркеры `MARKERS`. |
| [src/services/ssh-exec.ts](src/services/ssh-exec.ts) | **Чистая логика**: `execSshCommand` — выполнение по SSH-каналу с гарантированным cleanup (success/error/timeout). |
| [src/services/session-tracker.ts](src/services/session-tracker.ts) | **Чистая логика**: `resolveFocusedSession` (спуск по `focusedTab`) + `LastActiveSessionTracker` (мультиввод/last-active). |
| [src/services/poll-timing.ts](src/services/poll-timing.ts) | **Чистая логика**: `clampPollIntervalMs`, `adaptiveTimeoutMs`, `nextBackoffMs` (тайминги опроса). |
| [src/services/sparkline.ts](src/services/sparkline.ts) | **Чистая логика**: `pushSample` (ring buffer истории CPU), `clampSparklineBars`, `cpuColor`. Отрисовка на canvas — в bottom-bar. |
| [src/components/bottom-bar.component.ts](src/components/bottom-bar.component.ts) | UI нижней панели. Управляется извне (`useExternalController`) из `index.ts`. |
| [src/components/floating-panel.component.ts](src/components/floating-panel.component.ts) | UI плавающей панели с doughnut-графиками, drag&drop позиции. Singleton. |
| [src/components/settings.component.ts](src/components/settings.component.ts) | Настройки: режим, интервал, debug, цвет/прозрачность, кастомные метрики, **встроенные** пресеты (без сети). |
| [src/builtin-presets.ts](src/builtin-presets.ts) | **Встроенные пресеты** (в бандле, без удалённой загрузки). Типизированы, сгруппированы по категориям; есть `groupedBuiltinPresets()` и инструкция «HOW TO ADD» для расширения. |
| [src/config.ts](src/config.ts) | Дефолты конфига + интерфейс `CustomMetric`. |
| [src/toolbar-button.provider.ts](src/toolbar-button.provider.ts) | Кнопка тулбара (вкл/выкл плагина). |
| [src/translations.ts](src/translations.ts) | i18n строки. |
| [presets.json](presets.json) | Библиотека пресетов метрик (также тянется с GitHub). |

## 3. Архитектурные решения (текущие)
- **Bottom bar — per-tab**: на каждый элемент `ssh-tab` инъектируется отдельный
  компонент через `ComponentFactoryResolver`; опрос управляется из `index.ts`
  (`useExternalController = true`), внутренний таймер компонента при этом неактивен.
- **Floating panel — singleton**: показывает сессию активной/сфокусированной вкладки.
- **Обнаружение вкладок**: подписки Tabby (`tabOpened$`, `tabsChanged$`,
  `tabRemoved$`, `tabClosed$`) + резервный `scanTimer` (1.5s). **MutationObserver
  удалён** (см. решения ниже).
- **Polling**: **self-rescheduling loop** (`startPollTimer`/`scheduleNextPoll` на
  `setTimeout`, НЕ `setInterval`) — следующий опрос планируется только после
  завершения текущего ⇒ нет overlap даже на 1s. Интервал настраиваемый
  (`serverStats.pollInterval`, сек; clamp 1–60s в [poll-timing.ts](src/services/poll-timing.ts)).
  Опрашиваются **только бары активной верхней вкладки** (`isSshTabActive`). Backoff
  (экспоненциальный, до 30s) при ошибках/таймауте. Немедленный опрос на
  `activeTabChange`. Guard `fetchGuards` (WeakMap по session) — нет параллельных
  запросов к одной сессии.
- **Метрики без `sleep`**: команда возвращает сырые счётчики (`/proc/stat`,
  `/proc/net/dev`, `/proc/meminfo`) — режим `D` (delta); CPU%/сеть считаются
  client-side по дельте между опросами (`finalizeSample`/`computeDeltaStats`, prev
  хранится в `prevSamples` WeakMap по session). macOS — режим `V` (готовые
  значения, `ps` + `sysctl hw.memsize`). Timeout адаптивный (`adaptiveTimeoutMs`).
- **Формат вывода** (после маркера START):
  - `D cpuTotal cpuIdle rx tx mem% memUsedBytes memTotalBytes disk%`
  - `V cpu% rx tx mem% memUsedBytes memTotalBytes disk%`
  Парсер — `parseBaseSample`; маппинг полей — `finalizeSample`.
- **Выполнение команд**: SSH — через `openSessionChannel`/`requestExec`; локально —
  `child_process.exec` с таймаутом 5s.

## 4. Принятые решения (decisions log)
- **[Polling/UI] Убран глобальный `MutationObserver`** с `subtree:true` над `.content`.
  Причина: реагировал на DOM-churn xterm.js при выводе → main-thread hot path →
  фриз UI. Обнаружение вкладок полностью покрывается lifecycle-подписками Tabby +
  `scanTimer`. (Stage 1)
- **[SSH cleanup] Гарантированный `cleanup()`** канала и RxJS-подписки на таймаут и
  на ошибку стрима в `StatsService.exec`. Причина: на таймауте/ошибке канал и
  подписка протекали → накопительная утечка → постепенный фриз. (Stage 1)
- **[Логирование] Выключено по умолчанию**, включается флагом `debug` в настройках
  плагина. Причина: синхронный `appendFileSync` в renderer + рост файла без ротации. (Stage 1)
- **[Мультиввод/last-active] Трекинг последней активной сессии**: при мультивводе/
  сплитах показываем ресурсы последнего сфокусированного окна. (Stage 1)
- **[Polling, Stage 2] Один центральный планировщик вместо per-tab интервалов**;
  опрос только активной вкладки; интервал 3s→5s. Причина: N фоновых SSH-вкладок
  открывали N каналов каждые 3s.
- **[Perf, Stage 2] `rebuildTabElementMap` кэширует набор вкладок** (skip, если
  набор не изменился и все элементы уже разрешены); убран избыточный per-attach
  rebuild (было O(tabs²) в `attachExistingTabs`).
- **[macOS, Stage 2] Команда метрик — один проход `ps`** (`ps -A -o %cpu= -o %mem=`
  + один awk) вместо двух полных сканов таблицы процессов.
- **[Polling, Stage 3] Команда без `sleep`, дельты client-side.** Linux отдаёт сырые
  счётчики /proc (режим D), CPU%/сеть считаются по дельте между опросами. Это и
  делает возможным быстрый (1s) опрос. macOS — режим V (`ps`). Причина: `sleep 1`
  внутри команды делал интервал <1s недостижимым.
- **[Polling, Stage 3] Self-rescheduling loop + backoff + адаптивный timeout +
  настраиваемый интервал (1–60s).** Гарантия no-overlap структурная (следующий
  опрос только после завершения текущего), не зависит от timeout.
- **[Security, Stage 3] Импорт пресета требует подтверждения** (показывает точную
  команду + предупреждение, что она исполнится на серверах). `fetch` пресетов — с
  `AbortController` timeout 10s.
- **[Arch, Stage 3] Убраны `window.serverStatsFloating/BottomBar` и `forceUpdate`.**
  Рефреш на toolbar-toggle идёт через `config.changed$` (оба компонента подписаны;
  floating теперь делает `checkAndFetch` сразу).

## 5. Известные проблемы / риски
**Закрыто (Stage 1):** фриз из-за MutationObserver; утечка SSH-каналов на таймауте;
синхронное логирование по умолчанию.

**Открыто:**
- **Supply-chain (S1) — ЗАКРЫТО (Stage 3.1):** удалён удалённый импорт пресетов
  целиком (нет `fetch` к `raw.githubusercontent.com`, нет one-click из интернета).
  Остались только встроенные пресеты ([builtin-presets.ts](src/builtin-presets.ts)) +
  ручные custom metrics. Добавление любого пресета требует подтверждения с показом
  команды; рядом с метриками — предупреждение о выполнении на локальном/SSH-хосте.
- **macOS-метрики неточны:** CPU% — сумма lifetime-average по процессам (может быть
  >100%), сеть = 0. Для мгновенного CPU нужен `top -l 2`/`iostat` (отложено). На
  Linux/SSH — точные дельты (Stage 3).
- **Хрупкая привязка к DOM Tabby:** селекторы `app-root > div > .content`, тег `ssh-tab`.
- **Устаревший API:** `ComponentFactoryResolver`/`entryComponents` (deprecated в ng14).
  Осознанно НЕ заменено: функционально работает, замена механизма DI-инъекции
  компонентов рискованна без возможности прогнать реальное приложение Tabby.
- **Дублирование логики опроса** между двумя компонентами (частично смягчено
  вынесением чистой логики в сервисы).
- **Delta «прогрев»:** первый опрос новой сессии в режиме D даёт cpu/net=0 (нет
  предыдущего сэмпла); реальные значения со второго. Смягчено initial-fetch на attach.

## 6. Ограничения
- Поддержка ОС для локального режима: только Linux/macOS (`process.platform`).
- Bottom bar привязывается только к `ssh-tab` (локальные `terminal-tab` — только floating).
- Angular 14, RxJS 7, Chart.js 4, ng2-charts 4. Сборка через webpack (target node, UMD).
- `node_modules` не закоммичены — нужен `npm install` перед сборкой/тестами.

## 7. Команды
```bash
npm install            # установка зависимостей (нужно для build и test)
npm run build          # webpack production build -> dist/
npm run watch          # webpack watch
npm test               # jest (45 юнит-тестов чистой логики)
npm run typecheck      # tsc --noEmit (быстрый typecheck без сборки)
```
Линтера в проекте нет.

## 8. Следующие задачи
- **Stage 1/2/3 — ГОТОВО.**
- **Roadmap (отложено / на будущее):**
  - Заменить `ComponentFactoryResolver` → `ViewContainerRef.createComponent`/
    `createComponent()` (ng14) — только с возможностью прогнать Tabby вживую.
  - Мгновенный CPU на macOS (`top -l 2`/`iostat`); сеть на macOS (`netstat -ib` дельта).
  - Полностью вынести polling per-tab в общий сервис (убрать дублирование с floating).
  - Интеграционные тесты планировщика (jsdom): active-only, no-overlap, backoff.
  - Кэш скомпилированной shell-команды; необязательный `loadavg` как встроенная метрика.
  - Расширение встроенных пресетов через [builtin-presets.ts](src/builtin-presets.ts)
    (скелет готов). **Удалённую загрузку пресетов НЕ возвращать** (осознанное решение).

## 9. Журнал изменений
- **Stage 1 (готово):**
  - Удалён глобальный `MutationObserver` + вся burst-логика в [index.ts](src/index.ts);
    обнаружение вкладок только через lifecycle-подписки Tabby + `scanTimer`.
  - SSH-exec вынесен в [ssh-exec.ts](src/services/ssh-exec.ts) с **гарантированным
    cleanup канала и подписки** на success/error/**timeout** (закрыта утечка).
  - Логирование выключено по умолчанию; флаг `serverStats.debug` в конфиге +
    тумблер в настройках; `logDebug` — no-op пока флаг выключен.
  - Мультиввод: [session-tracker.ts](src/services/session-tracker.ts) +
    интеграция в floating-panel — показывает последнее активное окно.
  - Парсинг/`formatSpeed` вынесены в [stats-parser.ts](src/services/stats-parser.ts),
    дедуплицирован баг `formatSpeed(0)` в обоих компонентах.
  - Добавлены юнит-тесты ([test/](test/)): **29 тестов, все проходят** (jest + ts-jest).
  - В tsconfig добавлен `skipLibCheck` (убирает шум типов из node_modules) и
    `exclude: test`. Верификация: `npm test` ✓, `npx webpack` ✓ (exit 0),
    `npx tsc --noEmit` ✓ (exit 0).
  - **Не трогали** (осознанно, вне scope Stage 1): per-tab polling 3s/таб (Stage 2),
    точность macOS-метрик, supply-chain пресетов (Stage 3).
- **Stage 2 (готово):**
  - Единый центральный планировщик (`startPollTimer`/`pollActiveTabs`/`isSshTabActive`)
    вместо per-tab `setInterval`; опрос **только активной вкладки** (сплиты — все
    видимые панели); интервал 3s→5s (`POLL_INTERVAL_MS` в [config.ts](src/config.ts),
    применён и в обоих компонентах). Немедленный опрос на `activeTabChange`.
  - `rebuildTabElementMap` кэширует набор вкладок; убран избыточный per-attach rebuild.
  - macOS-команда: один проход `ps -A -o %cpu= -o %mem=` вместо двух (проверено на
    реальном macOS — формат вывода корректен).
  - Верификация: `npm test` ✓ (29), `npx webpack` ✓ (exit 0), `npx tsc --noEmit` ✓.
- **Stage 3 (готово) — готовность к 1s-мониторингу + безопасность + архитектура:**
  - **Команда без `sleep`**: режим D (Linux, сырые /proc-счётчики) + client-side
    дельты ([stats-parser.ts](src/services/stats-parser.ts): `parseBaseSample`/
    `computeDeltaStats`/`finalizeSample`; `prevSamples` WeakMap в
    [stats.service.ts](src/services/stats.service.ts)); режим V (macOS).
  - **Self-rescheduling poll loop** (`scheduleNextPoll`) в index.ts и floating-panel:
    no-overlap структурно + экспоненциальный backoff ([poll-timing.ts](src/services/poll-timing.ts)).
  - **Настраиваемый интервал** `serverStats.pollInterval` (1–60s) + UI в настройках;
    **адаптивный timeout** (`adaptiveTimeoutMs`, 2.5–8s).
  - **Безопасность**: подтверждение импорта пресета с показом команды; `fetch` с
    `AbortController` (10s). README дополнен разделами Settings/Security, скриншот удалён.
  - **Архитектура**: удалены `window.serverStatsFloating/BottomBar` и `forceUpdate`
    (рефреш через `config.changed$`).
  - Тесты: +16 (poll-timing, новый parser) → **45 всего**. Команды валидированы на
    реальном macOS + синтетических /proc. Верификация: `npm test` ✓ (45),
    `npx webpack` ✓ (exit 0), `npx tsc --noEmit` ✓ (exit 0).
  - **Отложено** (см. §8 Roadmap): `ComponentFactoryResolver` (риск без live-Tabby),
    мгновенный CPU/сеть на macOS, полный вынос polling в общий сервис.
- **Stage 3.1 (готово) — удаление remote-пресетов:**
  - Полностью удалён удалённый импорт: `PRESETS_URL`, `fetchPresets()`, `fetch(...)`,
    `openGitHubLink()`, кнопка «Fetch from GitHub», ссылка «submit your own preset»,
    поля `loadingPresets`/`fetchError`, импорт `PlatformService`. Удалён корневой
    `presets.json` (бывший remote-источник, в пакет не входил).
  - Встроенные пресеты вынесены в [builtin-presets.ts](src/builtin-presets.ts)
    (масштабируемый скелет: тип `BuiltinPreset`, категории, `groupedBuiltinPresets()`,
    инструкция по добавлению). UI рендерит их по категориям.
  - Добавлено предупреждение о доверии командам (alert рядом с пресетами/метриками).
  - Верификация: `npm test` ✓ (45), `npx webpack` ✓ (exit 0), `npx tsc --noEmit` ✓.
    Проверено: в `src/` нет `fetch(`, нет ссылок на githubusercontent.
- **Stage 3.2 (готово) — CPU sparkline (MobaXterm-like):**
  - Опциональный мини-график истории CPU в bottom-bar на `<canvas>` (один элемент,
    DPR-aware, без per-bar DOM-diff). Новый сэмпл справа, старые сдвигаются влево,
    высота = CPU 0–100%, цвет по порогам, текущее значение % справа.
  - **Не замена, а выбор**: `serverStats.cpuStyle` = `'bar'` (как раньше, дефолт) |
    `'sparkline'`. Кол-во столбиков `serverStats.sparklineBars` (clamp 20–60).
    UI-переключатель + число столбиков в настройках.
  - Чистая логика в [sparkline.ts](src/services/sparkline.ts) (`pushSample`/
    `clampSparklineBars`/`cpuColor`), история per-tab в компоненте. Тесты: +10 → **55**.
  - Верификация: `npm test` ✓ (55), `npx webpack` ✓ (exit 0), `npx tsc --noEmit` ✓.
- **Stage 3.3 (готово) — выбор отображения RAM:**
  - `serverStats.ramStyle` = `'bar'` (как сейчас: прогресс-бар/пончик + %, **дефолт**) |
    `'text'` (числовой `used/total`, напр. `3.2G/8G`, без мини-графика). Подкраска по
    занятости (`getMemColor`) сохранена в обоих режимах. Доступно в bottom-bar и floating.
  - Протокол расширен: добавлены `memUsedBytes`/`memTotalBytes` (Linux `/proc/meminfo`,
    macOS `sysctl hw.memsize` + производное used). Добавлен `formatBytes` в
    [stats-parser.ts](src/services/stats-parser.ts). Изменён порядок полей `D`/`V`
    (см. §3) — парсер и тесты обновлены.
  - UI-переключатель «RAM Display» (Percentage / Used / Total) в настройках.
  - Команды проверены на реальном macOS + синтетическом /proc. Тесты: +3 → **58**.
    Верификация: `npm test` ✓ (58), `npx webpack` ✓ (exit 0), `npx tsc --noEmit` ✓.
