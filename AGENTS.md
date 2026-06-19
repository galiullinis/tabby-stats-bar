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
| [src/components/bottom-bar.component.ts](src/components/bottom-bar.component.ts) | UI нижней панели. Управляется извне (`useExternalController`) из `index.ts`. |
| [src/components/floating-panel.component.ts](src/components/floating-panel.component.ts) | UI плавающей панели с doughnut-графиками, drag&drop позиции. Singleton. |
| [src/components/settings.component.ts](src/components/settings.component.ts) | Настройки: режим, цвет/прозрачность, кастомные метрики, импорт пресетов с GitHub. |
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
- **Polling**: `setInterval` 3s. Guard `fetchGuards` (WeakMap по session) не даёт
  параллельных запросов к одной сессии.
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

## 5. Известные проблемы / риски
**Закрыто (Stage 1):** фриз из-за MutationObserver; утечка SSH-каналов на таймауте;
синхронное логирование по умолчанию.

**Открыто:**
- **Supply-chain (S1):** пресеты с GitHub содержат shell-команды, исполняемые на
  серверах пользователя. Нет подтверждения/проверки целостности. (Stage 3)
- **macOS-метрики неточны:** `ps -A -o %cpu` — усреднение за жизнь процесса; сеть = 0.
- **Хрупкая привязка к DOM Tabby:** селекторы `app-root > div > .content`, тег `ssh-tab`.
- **Устаревший API:** `ComponentFactoryResolver`/`entryComponents` (deprecated в ng14).
- **Дублирование логики опроса** между двумя компонентами.

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
npm test               # jest (юнит-тесты чистой логики)  [добавлено в Stage 1]
npx tsc --noEmit -p tsconfig.json   # быстрый typecheck (без сборки)
```
Линтера в проекте нет.

## 8. Следующие задачи
- **Stage 2 (нагрузка):** единый планировщик опроса (один интервал, только активная
  вкладка), интервал по умолчанию 5s, кэширование `rebuildTabElementMap`,
  облегчить macOS-команду.
- **Stage 3 (безопасность/архитектура):** предупреждение+подтверждение импорта
  пресетов, таймаут на `fetch`; вынести опрос в общий сервис, убрать `window.*`-связи
  и мёртвый код; заменить `ComponentFactoryResolver` на современный Angular API.

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
