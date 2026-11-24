<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
<a id="top"></a>

# Git Pilot — Development

Developer guide and architecture notes. User documentation is in [README.md](README.md).

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

Requirements: Node.js 18+, pnpm, and VS Code 1.85+.

```bash
pnpm install
pnpm run compile      # type-check + bundle to dist/extension.js
pnpm run watch        # esbuild watch mode
pnpm run package      # minified production bundle (cleans dist/ first)
```

Press **F5** ("Run Git Pilot") to launch an Extension Development Host. This starts the `watch` task (esbuild + `tsc --noEmit` in watch mode). Problem matchers are configured in `.vscode/tasks.json`, so no extra VS Code extensions are required. Use "Run Git Pilot (one-off build)" for a single `pnpm run compile` without watchers.

The extension has no runtime dependencies and uses Node's built-in `fetch` for all REST and GraphQL requests.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-architecture"></a>

### Architecture

Git Pilot consists of a shared core (`src/core/`) and independent feature modules (`src/modules/`).

```text
src/
├── extension.ts               Entry point: builds PilotContext, registers core commands, activates modules
├── core/
│   ├── types.ts               Domain models + PilotModule / GitPlatformProvider contracts
│   ├── eventBus.ts            Typed events: repoChanged, branchChanged, configChanged, authChanged, repoPinChanged, syncStateChanged
│   ├── logger.ts              "Git Pilot" log output channel
│   ├── commands.ts            Core commands (setToken, openInBrowser, openItem, selectRepository)
│   ├── format.ts              Shared text helpers (MR/PR terms, Markdown escaping, URL credential redaction)
│   ├── labels.ts              Label grouping (prefixes / masks) and group exclusivity
│   ├── ui/sectionView.ts      Sidebar section wrapper (TreeView + TreeNode)
│   ├── moduleRegistry.ts      Activates modules independently so a failure in one doesn't break the rest
│   ├── config/settings.ts     Typed, validated settings reader
│   ├── config/secrets.ts      Per-host PAT storage (SecretStorage)
│   ├── git/gitService.ts      vscode.git integration, SSH/HTTPS remote parsing, repository pinning
│   └── providers/
│       ├── baseProvider.ts    HTTP client, pagination, error handling, scoped-label logic
│       ├── gitlabProvider.ts  GitLab REST v4 client
│       ├── githubProvider.ts  GitHub REST v3 + GraphQL v4 client
│       └── providerManager.ts Resolves and caches the provider for the active repository
└── modules/
    ├── index.ts               Registered feature modules
    ├── labelSync/             Labels sidebar section, status bar item, and Issue <-> MR/PR sync
    └── comments/              Comments sidebar section, read-only comment viewer, and draft composer
```

- **Active repository & pinning:** `GitService` tracks the repository of the focused `file:` editor (falling back to the first open repository). `GitService.pinRepository()` pins a specific repository in `workspaceState` and emits `repoPinChanged`. Sidebar sections use `gitService.getRepoSummary()` to display the repository name when multiple repositories are open or one is pinned.
- **Module communication:** modules do not import each other. For example, `comments` subscribes to `syncStateChanged` (and reads `eventBus.currentSyncState`) published by `labelSync` to know the current Issue and open MRs/PRs.
- **Comments flow:** providers implement `getComments` (newest first, skipping system notes) and `addComment`. Opened comments are shown as plain text via the `gitpilot-comment:` virtual document provider (`CommentDocs`), and new comments are validated against the current host, project, and entity before posting.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-adding-a-module"></a>

### Adding a module

```ts
// src/modules/dailyIssues/index.ts
export class DailyIssuesModule implements PilotModule {
  readonly id = 'dailyIssues';
  activate(ctx: PilotContext) {
    ctx.eventBus.onDidChangeRepo(/* ... */);
  }
  dispose() {}
}

// src/modules/index.ts
export const MODULES = [() => new LabelSyncModule(), () => new CommentsModule(), () => new DailyIssuesModule()];
```

To add a sidebar section, declare the view under `contributes.views.gitPilot` in `package.json` and create a `new SectionView('<viewId>')` with `TreeNode` items from `core/ui/sectionView.ts`. Item command handlers receive the `TreeNode` instance; always check `node instanceof TreeNode` and keep tooltips plain text.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-internal-commands"></a>

### Internal commands

Tree item commands hidden from the Command Palette (`when: "false"`):
- `gitPilot.openItem`
- `gitPilot.labelSync.applyStatus`
- `gitPilot.labelSync.removeLabel`
- `gitPilot.labelSync.replaceLabel`
- `gitPilot.labelSync.copyLabelToOthers`
- `gitPilot.labelSync.copyLabelName`
- `gitPilot.comments.open`
- `gitPilot.comments.loadMore`

`gitPilot.comments.send` is shown in the Command Palette and editor title bar only when a comment draft is focused (`gitPilot.comments.composer`).

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-packaging"></a>

### Packaging

`.vscodeignore` uses an explicit allow-list (`dist/extension.js`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `package.json`). Build the `.vsix` archive with `vsce package --no-dependencies` and inspect its contents with `vsce ls --no-dependencies` before publishing.

<sub>[↑ Contents](#en) · [Русский](#ru) · [↑ Top](#top)</sub>

---

<a id="ru"></a>

## Русский

**Содержание:**
[Разработка](#ru-development) ·
[Архитектура](#ru-architecture) ·
[Добавление модуля](#ru-adding-a-module) ·
[Внутренние команды](#ru-internal-commands) ·
[Сборка пакета](#ru-packaging)

<a id="ru-development"></a>

### Разработка

Требования: Node.js 18+, pnpm и VS Code 1.85+.

```bash
pnpm install
pnpm run compile      # проверка типов + сборка в dist/extension.js
pnpm run watch        # esbuild в режиме watch
pnpm run package      # минифицированная production-сборка (с предварительной очисткой dist/)
```

Нажмите **F5** («Run Git Pilot») для запуска Extension Development Host. При этом запускается задача `watch` (esbuild + `tsc --noEmit`). Все problem matcher'ы настроены в `.vscode/tasks.json`, сторонние расширения не требуются. Конфигурация «Run Git Pilot (one-off build)» выполняет разовую сборку `pnpm run compile` без фонового отслеживания файлов.

У расширения нет runtime-зависимостей — все запросы к REST и GraphQL API выполняются через встроенный в Node.js `fetch`.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-architecture"></a>

### Архитектура

Проект разделён на общее ядро (`src/core/`) и независимые функциональные модули (`src/modules/`).

```text
src/
├── extension.ts               Точка входа: создаёт PilotContext, регистрирует команды ядра, запускает модули
├── core/
│   ├── types.ts               Доменные типы и интерфейсы PilotModule / GitPlatformProvider
│   ├── eventBus.ts            События: repoChanged, branchChanged, configChanged, authChanged, repoPinChanged, syncStateChanged
│   ├── logger.ts              Канал логов «Git Pilot»
│   ├── commands.ts            Общие команды (setToken, openInBrowser, openItem, selectRepository)
│   ├── format.ts              Форматирование текста, экранирование Markdown, маскирование секретов в URL
│   ├── labels.ts              Группировка меток по префиксам/маскам и логика взаимоисключения
│   ├── ui/sectionView.ts      Обёртка раздела боковой панели (TreeView + TreeNode)
│   ├── moduleRegistry.ts      Изолированная активация модулей
│   ├── config/settings.ts     Типизированное чтение и валидация настроек
│   ├── config/secrets.ts      Хранение токенов по хостам в SecretStorage
│   ├── git/gitService.ts      Интеграция с vscode.git, разбор SSH/HTTPS remote, закрепление репозитория
│   └── providers/
│       ├── baseProvider.ts    HTTP-клиент, пагинация, обработка ошибок, движок scoped labels
│       ├── gitlabProvider.ts  Клиент GitLab REST v4
│       ├── githubProvider.ts  Клиент GitHub REST v3 + GraphQL v4
│       └── providerManager.ts Выбор и кэширование провайдера для активного репозитория
└── modules/
    ├── index.ts               Список активных модулей
    ├── labelSync/             Раздел Labels, индикатор статус-бара и синхронизация Issue <-> MR/PR
    └── comments/              Раздел Comments, просмотр комментариев и черновики ответов
```

- **Активный репозиторий и закрепление:** `GitService` определяет репозиторий по текущему открытому `file:`-редактору (или берёт первый открытый репозиторий). Метод `GitService.pinRepository()` сохраняет выбранный репозиторий в `workspaceState` и генерирует событие `repoPinChanged`. Для отображения имени репозитория в заголовках разделов используется `gitService.getRepoSummary()`.
- **Взаимодействие модулей:** модули не импортируют друг друга напрямую. Например, модуль `comments` получает текущую задачу и список MR/PR через событие `syncStateChanged` (`eventBus.currentSyncState`), которое публикует `labelSync`.
- **Работа с комментариями:** провайдеры реализуют методы `getComments` (сортировка от новых к старым, фильтрация системных записей) и `addComment`. Полный текст комментария открывается через виртуальные документы `gitpilot-comment:` (`CommentDocs`), а перед отправкой нового комментария проверяется соответствие хоста, проекта и задачи текущему состоянию.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-adding-a-module"></a>

### Добавление модуля

```ts
// src/modules/dailyIssues/index.ts
export class DailyIssuesModule implements PilotModule {
  readonly id = 'dailyIssues';
  activate(ctx: PilotContext) {
    ctx.eventBus.onDidChangeRepo(/* ... */);
  }
  dispose() {}
}

// src/modules/index.ts
export const MODULES = [() => new LabelSyncModule(), () => new CommentsModule(), () => new DailyIssuesModule()];
```

Чтобы добавить свой раздел в боковую панель, опишите view в `contributes.views.gitPilot` внутри `package.json` и создайте `new SectionView('<viewId>')` с узлами `TreeNode` из `core/ui/sectionView.ts`. В обработчиках команд элементов дерева проверяйте `node instanceof TreeNode`, а для тултипов используйте обычный текст.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-internal-commands"></a>

### Внутренние команды

Команды для действий над элементами дерева (скрыты из палитры команд через `when: "false"`):
- `gitPilot.openItem`
- `gitPilot.labelSync.applyStatus`
- `gitPilot.labelSync.removeLabel`
- `gitPilot.labelSync.replaceLabel`
- `gitPilot.labelSync.copyLabelToOthers`
- `gitPilot.labelSync.copyLabelName`
- `gitPilot.comments.open`
- `gitPilot.comments.loadMore`

Команда `gitPilot.comments.send` отображается в палитре команд и в заголовке редактора только тогда, когда открыта вкладка с черновиком комментария (`gitPilot.comments.composer`).

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-packaging"></a>

### Сборка пакета

В `.vscodeignore` задан белый список файлов (`dist/extension.js`, `media/`, `README.md`, `CHANGELOG.md`, `LICENSE.md`, `package.json`). Упаковка выполняется командой `vsce package --no-dependencies`, проверить список файлов в пакете перед публикацией можно через `vsce ls --no-dependencies`.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
