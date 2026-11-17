<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
<a id="top"></a>

# Git Pilot — Development

Technical notes for working on the extension source. User documentation is in [README.md](README.md).

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

**Contents:**
[Development](#en-development) ·
[Architecture](#en-architecture) ·
[Adding a module](#en-adding-a-module) ·
[Internal commands](#en-internal-commands) ·
[Packaging](#en-packaging)

<a id="en-development"></a>

### Development

Requirements: Node.js 18+, pnpm, and VS Code 1.85 or later.

```bash
pnpm install
pnpm run compile      # type-check + bundle to dist/extension.js
pnpm run watch        # esbuild watch mode
pnpm run package      # minified production bundle (clears dist/ first)
```

Press **F5** ("Run Git Pilot") to launch an Extension Development Host. This runs the `watch` task: esbuild plus `tsc --noEmit` in watch mode. Both problem matchers are built in (an inline esbuild matcher in `.vscode/tasks.json` and the standard `$tsc-watch`), so no extra extensions are needed. "Run Git Pilot (one-off build)" does a single `pnpm run compile` instead of starting watchers.

The runtime has **zero dependencies**. All REST and GraphQL calls use Node's built-in `fetch`.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-architecture"></a>

### Architecture

Git Pilot is a small core platform (API clients, git integration, auth, event bus) with feature modules plugged in on top. Each module may contribute its own sidebar section.

```text
src/
├── extension.ts               Entry point: builds PilotContext, registers core commands, activates modules
├── core/
│   ├── types.ts               Domain models + PilotModule / GitPlatformProvider contracts
│   ├── eventBus.ts            Typed events: repoChanged, branchChanged, configChanged, authChanged, syncStateChanged
│   ├── logger.ts              "Git Pilot" log output channel
│   ├── commands.ts            Core commands (setToken, openInBrowser, openItem)
│   ├── format.ts              Shared text helpers (MR/PR terms, Markdown escaping, URL credential redaction)
│   ├── labels.ts              Label groups (prefix / masks) and group exclusivity
│   ├── ui/sectionView.ts      Sidebar section = TreeView over TreeNode roots
│   ├── moduleRegistry.ts      Activates modules separately so one failing module can't break the others
│   ├── config/settings.ts     Typed, validated access to settings
│   ├── config/secrets.ts      Per-host PAT storage (SecretStorage)
│   ├── git/gitService.ts      vscode.git integration, SSH/HTTPS remote parsing (nested subgroups)
│   └── providers/
│       ├── baseProvider.ts    fetch-based HTTP client, pagination, errors, scoped-label engine
│       ├── gitlabProvider.ts  GitLab REST v4
│       ├── githubProvider.ts  GitHub REST v3 + GraphQL v4
│       └── providerManager.ts Resolves and caches the provider for the active repository
└── modules/
    ├── index.ts               Module list (add new modules here)
    └── labelSync/            index.ts · syncEngine.ts · syncPlan.ts · statusBarUi.ts · labelsTree.ts · catalogTree.ts · labelPicker.ts
```

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-adding-a-module"></a>

### Adding a module

```ts
// src/modules/dailyIssues/index.ts
export class DailyIssuesModule implements PilotModule {
  readonly id = 'dailyIssues';
  activate(ctx: PilotContext) {
    ctx.eventBus.onDidChangeRepo(/* … */);
    // const res = await ctx.providerManager.resolve();
    // if (res.status === 'ready') await res.provider.getAssignedIssues?.(['status: todo']);
  }
  dispose() {}
}

// src/modules/index.ts
export const MODULES = [() => new LabelSyncModule(), () => new DailyIssuesModule()];
```

Modules don't call each other. They communicate only through the `EventBus` and the shared core services in `PilotContext`.

To add a sidebar section, declare a view in `contributes.views.gitPilot` of `package.json` with `"when": "config.gitPilot.<moduleId>.enabled"`, then render it with `new SectionView('<viewId>')` and `TreeNode`s from `core/ui/sectionView.ts`. Item commands receive the `TreeNode`; trust only nodes (`instanceof TreeNode`) and keep tooltips plain text.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-internal-commands"></a>

### Internal commands

Sidebar item actions, hidden from the Command Palette: `gitPilot.openItem`, `gitPilot.labelSync.applyStatus`, `gitPilot.labelSync.removeLabel`, `gitPilot.labelSync.replaceLabel`, `gitPilot.labelSync.copyLabelToOthers`, `gitPilot.labelSync.copyLabelName`. They act only on tree items created by Git Pilot.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-packaging"></a>

### Packaging

`.vscodeignore` is an allow-list (`dist/extension.js`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `package.json`). Package with `vsce package --no-dependencies` (pnpm layout, no runtime dependencies) and check the contents with `vsce ls --no-dependencies` before publishing.

`README.md` is shown on the Marketplace, so keep it user-facing; technical notes belong in this file.

<sub>[↑ Contents](#en) · [Русский](#ru) · [↑ Top](#top)</sub>

---

<a id="ru"></a>

## Русский

**Содержание:**
[Разработка](#ru-development) ·
[Архитектура](#ru-architecture) ·
[Как добавить модуль](#ru-adding-a-module) ·
[Служебные команды](#ru-internal-commands) ·
[Упаковка](#ru-packaging)

<a id="ru-development"></a>

### Разработка

Требования: Node.js 18+, pnpm и VS Code 1.85 или новее.

```bash
pnpm install
pnpm run compile      # проверка типов + сборка в dist/extension.js
pnpm run watch        # сборка esbuild в режиме наблюдения
pnpm run package      # минифицированная production-сборка (сначала очищает dist/)
```

Нажмите **F5** («Run Git Pilot»), чтобы запустить Extension Development Host. Будет запущена задача `watch`: esbuild и `tsc --noEmit` в режиме наблюдения. Оба problem matcher'а встроены (собственный matcher для esbuild в `.vscode/tasks.json` и стандартный `$tsc-watch`), так что дополнительные расширения не нужны. Конфигурация «Run Git Pilot (one-off build)» вместо наблюдения один раз выполняет `pnpm run compile`.

Во время работы у расширения **нет ни одной зависимости**. Все REST- и GraphQL-запросы идут через встроенный в Node `fetch`.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-architecture"></a>

### Архитектура

Git Pilot состоит из небольшого ядра (API-клиенты, интеграция с git, аутентификация, шина событий) и подключаемых к нему функциональных модулей. Каждый модуль может добавить свой раздел в боковую панель.

```text
src/
├── extension.ts               Точка входа: собирает PilotContext, регистрирует команды ядра, запускает модули
├── core/
│   ├── types.ts               Доменные модели и контракты PilotModule / GitPlatformProvider
│   ├── eventBus.ts            Типизированные события: repoChanged, branchChanged, configChanged, authChanged, syncStateChanged
│   ├── logger.ts              Канал вывода «Git Pilot»
│   ├── commands.ts            Команды ядра (setToken, openInBrowser, openItem)
│   ├── format.ts              Общие текстовые хелперы (термины MR/PR, экранирование Markdown, маскирование секретов в URL)
│   ├── labels.ts              Группы меток (префикс / маски) и их взаимоисключение
│   ├── ui/sectionView.ts      Раздел боковой панели = TreeView над корнями TreeNode
│   ├── moduleRegistry.ts      Запускает модули изолированно: сбой одного не ломает остальные
│   ├── config/settings.ts     Типизированный доступ к настройкам с проверкой значений
│   ├── config/secrets.ts      Хранение PAT по хостам (SecretStorage)
│   ├── git/gitService.ts      Интеграция с vscode.git, разбор SSH/HTTPS remote (вложенные подгруппы)
│   └── providers/
│       ├── baseProvider.ts    HTTP-клиент на fetch, пагинация, ошибки, логика scoped labels
│       ├── gitlabProvider.ts  GitLab REST v4
│       ├── githubProvider.ts  GitHub REST v3 + GraphQL v4
│       └── providerManager.ts Выбирает и кэширует провайдер для активного репозитория
└── modules/
    ├── index.ts               Список модулей (новые модули добавляются здесь)
    └── labelSync/            index.ts · syncEngine.ts · syncPlan.ts · statusBarUi.ts · labelsTree.ts · catalogTree.ts · labelPicker.ts
```

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-adding-a-module"></a>

### Как добавить модуль

```ts
// src/modules/dailyIssues/index.ts
export class DailyIssuesModule implements PilotModule {
  readonly id = 'dailyIssues';
  activate(ctx: PilotContext) {
    ctx.eventBus.onDidChangeRepo(/* … */);
    // const res = await ctx.providerManager.resolve();
    // if (res.status === 'ready') await res.provider.getAssignedIssues?.(['status: todo']);
  }
  dispose() {}
}

// src/modules/index.ts
export const MODULES = [() => new LabelSyncModule(), () => new DailyIssuesModule()];
```

Модули не вызывают друг друга напрямую. Они общаются только через `EventBus` и общие сервисы ядра из `PilotContext`.

Чтобы добавить раздел в боковую панель, объявите представление в `contributes.views.gitPilot` файла `package.json` с `"when": "config.gitPilot.<moduleId>.enabled"` и отрисуйте его через `new SectionView('<viewId>')` и узлы `TreeNode` из `core/ui/sectionView.ts`. Команды элементов получают сам `TreeNode`; доверяйте только таким узлам (`instanceof TreeNode`) и оставляйте подсказки простым текстом.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-internal-commands"></a>

### Служебные команды

Действия элементов боковой панели, скрытые из палитры команд: `gitPilot.openItem`, `gitPilot.labelSync.applyStatus`, `gitPilot.labelSync.removeLabel`, `gitPilot.labelSync.replaceLabel`, `gitPilot.labelSync.copyLabelToOthers`, `gitPilot.labelSync.copyLabelName`. Они работают только с элементами дерева, созданными самим Git Pilot.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-packaging"></a>

### Упаковка

`.vscodeignore` — белый список (`dist/extension.js`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `package.json`). Собирайте пакет командой `vsce package --no-dependencies` (раскладка pnpm, зависимостей во время работы нет) и перед публикацией проверьте состав через `vsce ls --no-dependencies`.

`README.md` показывается в Marketplace, поэтому в нём только пользовательская документация; техническая информация — в этом файле.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
