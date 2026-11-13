<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
<a id="top"></a>

# Git Pilot

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

**Contents:**
[Overview](#en-overview) ·
[Status Sync](#en-status-sync) ·
[Configuration](#en-configuration) ·
[Authentication](#en-authentication) ([token permissions](#en-token-permissions)) ·
[Security](#en-security) ·
[Commands & Logs](#en-commands) ·
[Architecture](#en-architecture) ·
[Development](#en-development)

<a id="en-overview"></a>

### Overview

**Git Pilot** is an extensible developer cockpit for **GitLab (CE/EE)** and **GitHub** inside VS Code.

It's built as a small core platform (API clients, git integration, auth, event bus) with feature modules plugged in on top. Phase 1 ships the core and the first module, **Status Sync**. Future modules such as `dailyIssues`, `reviewRadar`, `pipelineWatcher` and sidebar tree views plug into the same core without changing existing code.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-status-sync"></a>

### Status Sync

Status Sync keeps **status labels** (e.g. `status: todo`, `status::qa-passed`) the same on an **Issue** and its open **Merge Requests** (GitLab) or **Pull Requests** (GitHub). It syncs automatically, and you can also change the status by hand.

#### How it works

1. Git Pilot reads the current branch and extracts the issue number with `gitPilot.branchIssueRegex`
   (`142-fix-auth`, `feat/142-login` → issue **#142**).
2. It fetches the issue, its open MRs/PRs, and the project's status labels:
   - **GitLab:** related merge requests **plus** open MRs whose source branch is the current branch.
   - **GitHub:** open PRs whose head is the current branch **plus** PRs linked as "closing" the issue (GraphQL `closedByPullRequestsReferences`).
3. If the statuses differ, it reconciles them according to `gitPilot.statusSync.sourceOfTruth`.
4. The status bar shows the result:

| State | Status bar |
| --- | --- |
| No token | `$(key) Git Pilot: Set Token` |
| Syncing | `$(sync~spin) Git Pilot: #142...` |
| Synced | `$(tag) #142: status: qa-passed (MR !89)` |
| Conflict (`prompt` mode) | `$(warning) #142: todo ≠ MR: qa-passed` (warning background) |

Click the status bar item to pick a status. The QuickPick lists every project label that starts with your prefix (the current one is marked with `$(check)`). It also has quick actions: **Force Sync Now**, **Open Issue/MR in Browser** and **Update API Token**. To create a new status label, type its name in the box.

#### Sync triggers

- Extension activation
- Branch or repository switch
- The VS Code window regaining focus (at most once every 30 s)
- Polling every `autoSyncInterval` seconds (paused while the window is in the background)
- **Git Pilot: Status Sync: Sync Now**

#### Mutually exclusive statuses everywhere

GitLab Premium has native *scoped labels* (`status::x`), which allow only one status label at a time. GitHub and GitLab Free don't have them, so Git Pilot does the same thing on the client side. When it sets a status, it first removes every existing label matching the prefix (`status:`, `status::` and spacing variants are treated as equivalent), keeps all other labels (`bug`, `frontend`, …), and then adds the new status. Behavior is identical on GitHub, GitLab CE and GitLab EE.

On GitLab, updates are sent as `add_labels` / `remove_labels` diffs, so other labels that someone else changes at the same moment are not overwritten.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-configuration"></a>

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `auto` \| `gitlab` \| `github`. `auto` detects the platform from the remote host. Set it explicitly for self-hosted hosts whose name doesn't contain "gitlab"/"github". |
| `gitPilot.instanceUrl` | `""` | Base URL override for self-hosted GitLab / GitHub Enterprise, e.g. `https://gitlab.company.com`. Instances served under a sub-path (e.g. `https://host/gitlab`) are supported. |
| `gitPilot.allowInsecureHttp` | `false` | User-level only. Allows sending tokens over plain `http://` (only with an explicit `http://` `instanceUrl`). Not recommended. |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Regex whose **first capturing group** is the issue IID/number. |
| `gitPilot.statusSync.enabled` | `true` | Turns the module on or off (takes effect immediately). |
| `gitPilot.statusSync.labelPrefix` | `"status:"` | Use `status:` for regular labels or `status::` for GitLab scoped labels. |
| `gitPilot.statusSync.sourceOfTruth` | `"mr"` | Which side wins when statuses differ (see below). |
| `gitPilot.statusSync.autoSyncInterval` | `120` | Polling interval in seconds. `0` turns polling off; the minimum is 10. |

#### Source of truth

| Value | Behavior when the issue and the latest open MR/PR differ |
| --- | --- |
| `mr` | The MR/PR status silently overwrites the issue (and any other open MRs). |
| `issue` | The issue status silently overwrites all open MRs/PRs. |
| `prompt` | The status bar turns yellow and Git Pilot asks you which status to apply. You're asked once per distinct conflict. |

*"The latest MR"* means the most recently updated open MR/PR that has a status label.

In every mode, a side with **no status** is simply filled in from the side that has one. For example, a new MR with no status label gets the issue's status. This is never treated as a conflict.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-authentication"></a>

### Authentication

Run **Git Pilot: Set Personal Access Token** (or click `$(key) Git Pilot: Set Token`). Git Pilot stores one token per host in VS Code's `SecretStorage`, which is backed by the OS keychain. The token is never written to settings. Once it's stored, Git Pilot checks it against the API and shows the account it authenticated as.

The input box has a button that opens the token-creation page with the right scopes already selected: the GitLab personal token page with `api`, or the GitHub **classic** token page with `repo`. To remove a stored token, submit the input box empty.

**Summary**

| Platform | Token | Grant exactly this | Your role in the project |
| --- | --- | --- | --- |
| GitLab | Personal / project / group access token | Scope **`api`** | **Developer** (Reporter is enough for issues only) |
| GitHub | Fine-grained PAT *(recommended)* | **Issues: Read and write**, **Pull requests: Read and write** (Metadata: Read-only is added automatically) | **Triage** or higher |
| GitHub | Classic PAT | **`repo`** (or only **`public_repo`** for public repositories) | **Triage** or higher |

<a id="en-token-permissions"></a>

#### Token permissions in detail

**What the token is used for.** These are all the requests Git Pilot makes, so you can check that nothing more is granted than needed:

| Operation | GitLab API | GitHub API |
| --- | --- | --- |
| Verify the token, show the account | `GET /user` | `GET /user` |
| Read the issue | `GET /projects/:id/issues/:iid` | `GET /repos/:owner/:repo/issues/:n` |
| Find linked MRs/PRs | `GET …/issues/:iid/related_merge_requests`, `GET …/merge_requests?source_branch=` | `GET /repos/…/pulls?head=`, GraphQL `closedByPullRequestsReferences` |
| List status labels | `GET /projects/:id/labels` | `GET /repos/…/labels` |
| **Change the status** | `PUT /projects/:id/issues/:iid`, `PUT /projects/:id/merge_requests/:iid` | `PUT /repos/…/issues/:n/labels` (also used for PRs) |

Git Pilot never reads repository code, pushes, deletes anything, or touches CI, settings or members. GitLab tokens and classic GitHub tokens have no narrower scope that still allows editing labels, which is why `api` / `repo` are needed.

**GitLab**

1. Open **Avatar → Edit profile → Access tokens → Add new token**, or use the button in the Git Pilot input box.
2. Enter a name (e.g. `Git Pilot`) and an expiration date. GitLab requires an expiration date, so you'll need to enter a new token when it expires.
3. Under **Scopes**, select only **`api`**.
   - `read_api` is **not enough**: statuses are shown, but every change fails with *Access denied*.
   - Don't select `write_repository`, `sudo`, `admin_mode` or other scopes. They aren't needed.
4. Check your role in the project. You need at least **Reporter** to change labels on issues, and **Developer** to change labels on merge requests. The *Planner* role can edit issues, but not MRs.
5. A **project or group access token** also works: scope `api`, role **Developer**.

**GitHub: fine-grained token (recommended)**

1. Open **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** the account or organization that owns the repository. An organization may require an admin to approve the token. Until it's approved, the API returns 403/404.
3. **Repository access:** *Only select repositories*. Choose the repositories you work in.
4. **Repository permissions**, and nothing else:
   - **Issues:** Read and write
   - **Pull requests:** Read and write
   - **Metadata:** Read-only (GitHub adds this automatically)
5. **Account permissions:** none needed.

**GitHub: classic token**

1. Open **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)**, or use the button in the Git Pilot input box.
2. Select **`repo`**. If you only work with public repositories, **`public_repo`** is enough. Don't select `workflow`, `admin:*`, `delete_repo` or other scopes.
3. If the organization uses **SAML SSO**, click **Configure SSO → Authorize** next to the token after creating it. Otherwise, the organization's repositories return 403/404.

**In the repository** you need at least the **Triage** role, which is the minimum role that can apply labels. GitHub Enterprise Server works the same way. Use a classic token if your GitHub Enterprise Server version doesn't support fine-grained tokens.

**Creating new labels.** If you type a new status in the picker, the platform creates the label. That requires permission to manage labels in the project: Reporter/Planner or higher on GitLab, **Write** on GitHub.

**Checking the token.** After you save it, Git Pilot shows *"authenticated as @user"*. This only confirms the token is **valid** (`GET /user`). It doesn't check write access. Write access is checked the first time the status changes. If something is missing, the status bar tells you:

| Symptom in the status bar / tooltip | Likely cause | What to do |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | The token expired, was revoked, or was pasted incorrectly | Create a new token |
| `$(error) Git Pilot: #142`, *Access denied … (token scope?)* | GitLab `read_api` instead of `api`; Issues/Pull requests set to *Read-only*; project role too low; SSO not authorized | Create the token again with the permissions above, check your role, authorize SSO |
| `$(circle-slash) #142: not found` | The issue doesn't exist, **or** the token can't see the repository (the fine-grained token doesn't include this repository; GitHub returns 404 for private repositories without access) | Add the repository to the token's *Repository access* |
| The issue is shown, but no PR is found | The fine-grained token is missing **Pull requests: Read** | Add the Pull requests permission |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-security"></a>

### Security model

A cloned repository is untrusted input: it controls its remote URL, its branch names and its `.vscode/settings.json`. Git Pilot protects your tokens as follows:

- **Workspace Trust:** the extension does not run in Restricted Mode (`untrustedWorkspaces.supported: false`).
- **Origin pinning:** a token is only ever sent to the API origin of the host it was stored for. Absolute URLs from the server (pagination `Link` headers, redirects) pointing anywhere else are refused.
- **Manual redirects:** redirects are followed only within that same origin. This matters because `fetch` would otherwise forward GitLab's `PRIVATE-TOKEN` header to any host.
- **HTTPS only:** an `http://` remote never downgrades the API to plain HTTP. Sending a token over HTTP requires `gitPilot.allowInsecureHttp`. That setting is machine-scoped and read only from your user settings, so a workspace cannot enable it.
- **Untrusted server data:** links from the API are opened or rendered only if they are `http(s)` links on the instance's own host. `openExternal` refuses any other scheme. Titles and labels are escaped in tooltips, and IDs and project references are validated before they are used in API paths.
- **Limits:** the branch regex is limited to 300 characters and branch names to 255 (ReDoS). Responses are limited to 10 MB, requests time out after 20 s, and there are at most 10 pages per listing.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-commands"></a>

### Commands & Logs

| Command | ID |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |
| Git Pilot: Status Sync: Select Status | `gitPilot.statusSync.selectStatus` |
| Git Pilot: Status Sync: Sync Now | `gitPilot.statusSync.syncNow` |

Diagnostics are written to **Output → Git Pilot**. On startup, the log records the extension and VS Code versions, the environment, the effective settings (never tokens), the activation time and which modules started. Set the log level to *Trace* to see every API request; tokens are never logged.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-architecture"></a>

### Architecture

```text
src/
├── extension.ts               Entry point: builds PilotContext, registers core commands, activates modules
├── core/
│   ├── types.ts               Domain models + PilotModule / GitPlatformProvider contracts
│   ├── eventBus.ts            Typed events: repoChanged, branchChanged, configChanged, authChanged
│   ├── logger.ts              "Git Pilot" log output channel
│   ├── commands.ts            Core commands (setToken, openInBrowser)
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
    └── statusSync/            index.ts · syncEngine.ts · statusBarUi.ts
```

#### Adding a module

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
export const MODULES = [() => new StatusSyncModule(), () => new DailyIssuesModule()];
```

Modules don't call each other. They communicate only through the `EventBus` and the shared core services in `PilotContext`.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-development"></a>

### Development

Requirements: Node.js 18+, pnpm, and VS Code 1.85 or later.

```bash
pnpm install
pnpm run compile      # type-check + bundle to dist/extension.js
pnpm run watch        # esbuild watch mode
pnpm run package      # minified production bundle
```

Press **F5** ("Run Git Pilot") to launch an Extension Development Host. This runs the `watch` task: esbuild plus `tsc --noEmit` in watch mode. Both problem matchers are built in (an inline esbuild matcher in `.vscode/tasks.json` and the standard `$tsc-watch`), so no extra extensions are needed. "Run Git Pilot (one-off build)" does a single `pnpm run compile` instead of starting watchers.

The runtime has **zero dependencies**. All REST and GraphQL calls use Node's built-in `fetch`.

<sub>[↑ Contents](#en) · [Русский](#ru) · [↑ Top](#top)</sub>

---

<a id="ru"></a>

## Русский

**Содержание:**
[Обзор](#ru-overview) ·
[Status Sync](#ru-status-sync) ·
[Настройки](#ru-configuration) ·
[Аутентификация](#ru-authentication) ([права токена](#ru-token-permissions)) ·
[Безопасность](#ru-security) ·
[Команды и логи](#ru-commands) ·
[Архитектура](#ru-architecture) ·
[Разработка](#ru-development)

<a id="ru-overview"></a>

### Обзор

**Git Pilot** — расширяемая «панель управления» разработчика для **GitLab (CE/EE)** и **GitHub** прямо в VS Code.

Расширение состоит из небольшого ядра (API-клиенты, интеграция с git, аутентификация, шина событий) и подключаемых к нему функциональных модулей. В первую версию входят ядро и первый модуль — **Status Sync**. Будущие модули, например `dailyIssues`, `reviewRadar`, `pipelineWatcher` и панели в боковой панели, подключаются к тому же ядру без изменения существующего кода.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-status-sync"></a>

### Status Sync

Status Sync поддерживает одинаковые **метки статуса** (например, `status: todo`, `status::qa-passed`) у **задачи (Issue)** и её открытых **Merge Request** (GitLab) или **Pull Request** (GitHub). Синхронизация идёт автоматически, а статус можно сменить и вручную.

#### Как это работает

1. Git Pilot берёт текущую ветку и извлекает из неё номер задачи с помощью `gitPilot.branchIssueRegex`
   (`142-fix-auth`, `feat/142-login` → задача **#142**).
2. Загружает задачу, её открытые MR/PR и метки статуса проекта:
   - **GitLab:** связанные merge request'ы **плюс** открытые MR, у которых исходная ветка — текущая.
   - **GitHub:** открытые PR из текущей ветки **плюс** PR, которые «закрывают» задачу (GraphQL `closedByPullRequestsReferences`).
3. Если статусы различаются, согласует их по правилу из `gitPilot.statusSync.sourceOfTruth`.
4. Показывает результат в строке состояния:

| Состояние | Строка состояния |
| --- | --- |
| Нет токена | `$(key) Git Pilot: Set Token` |
| Синхронизация | `$(sync~spin) Git Pilot: #142...` |
| Синхронизировано | `$(tag) #142: status: qa-passed (MR !89)` |
| Конфликт (режим `prompt`) | `$(warning) #142: todo ≠ MR: qa-passed` (жёлтый фон) |

Нажмите на элемент в строке состояния, чтобы выбрать статус. В списке (QuickPick) есть все метки проекта, начинающиеся с вашего префикса, текущая отмечена `$(check)`. Там же быстрые действия: **Force Sync Now** (синхронизировать сейчас), **Open Issue/MR in Browser** (открыть в браузере) и **Update API Token** (обновить токен). Чтобы создать новую метку статуса, просто введите её название в поле.

#### Когда запускается синхронизация

- При активации расширения
- При переключении ветки или репозитория
- Когда окно VS Code снова получает фокус (не чаще раза в 30 с)
- По таймеру каждые `autoSyncInterval` секунд (пока окно в фоне, опрос приостановлен)
- Командой **Git Pilot: Status Sync: Sync Now**

#### Взаимоисключающие статусы на любой платформе

В GitLab Premium есть встроенные *scoped labels* (`status::x`): у задачи может быть только одна метка с таким префиксом. В GitHub и GitLab Free их нет, поэтому Git Pilot делает то же самое на стороне клиента. При установке статуса он сначала удаляет все метки с этим префиксом (`status:`, `status::` и варианты с пробелами считаются одним и тем же), сохраняет остальные метки (`bug`, `frontend`, …) и только потом добавляет новый статус. Поведение одинаково в GitHub, GitLab CE и GitLab EE.

В GitLab изменения отправляются как разница (`add_labels` / `remove_labels`), поэтому метки, которые кто-то меняет в тот же момент, не перезаписываются.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-configuration"></a>

### Настройки

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `auto` \| `gitlab` \| `github`. В режиме `auto` платформа определяется по хосту remote. Для собственных серверов, в имени которых нет «gitlab»/«github», укажите явно. |
| `gitPilot.instanceUrl` | `""` | Базовый URL собственного GitLab / GitHub Enterprise, например `https://gitlab.company.com`. Поддерживаются инстансы по подпути (например, `https://host/gitlab`). |
| `gitPilot.allowInsecureHttp` | `false` | Только на уровне пользователя. Разрешает отправлять токены по открытому `http://` (только вместе с явным `http://` в `instanceUrl`). Не рекомендуется. |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Регулярное выражение, **первая группа захвата** которого — номер (IID) задачи. |
| `gitPilot.statusSync.enabled` | `true` | Включает или выключает модуль (применяется сразу). |
| `gitPilot.statusSync.labelPrefix` | `"status:"` | `status:` — для обычных меток, `status::` — для scoped labels в GitLab. |
| `gitPilot.statusSync.sourceOfTruth` | `"mr"` | Какая сторона побеждает при расхождении статусов (см. ниже). |
| `gitPilot.statusSync.autoSyncInterval` | `120` | Интервал опроса в секундах. `0` отключает опрос; минимум — 10. |

#### Источник истины (`sourceOfTruth`)

| Значение | Что происходит, если статусы задачи и последнего открытого MR/PR различаются |
| --- | --- |
| `mr` | Статус MR/PR молча перезаписывает статус задачи (и остальных открытых MR). |
| `issue` | Статус задачи молча перезаписывает статусы всех открытых MR/PR. |
| `prompt` | Строка состояния становится жёлтой, и Git Pilot спрашивает, какой статус применить. Вопрос задаётся один раз для каждого нового конфликта. |

*«Последний MR»* — это открытый MR/PR с меткой статуса, который обновлялся позже остальных.

В любом режиме сторона **без статуса** просто получает статус другой стороны. Например, новый MR без метки получит статус задачи. Конфликтом это не считается.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-authentication"></a>

### Аутентификация

Выполните **Git Pilot: Set Personal Access Token** (или нажмите `$(key) Git Pilot: Set Token`). Git Pilot хранит по одному токену на хост в `SecretStorage` VS Code, то есть в связке ключей ОС. В настройки токен никогда не записывается. Сразу после сохранения Git Pilot проверяет токен через API и показывает, под каким аккаунтом выполнен вход.

В поле ввода есть кнопка, которая открывает страницу создания токена с уже выбранными правами: страницу персональных токенов GitLab со scope `api` или страницу **классического** токена GitHub с `repo`. Чтобы удалить сохранённый токен, отправьте поле пустым.

**Кратко**

| Платформа | Токен | Что разрешить | Ваша роль в проекте |
| --- | --- | --- | --- |
| GitLab | Personal / project / group access token | Scope **`api`** | **Developer** (для меток только на задачах хватит Reporter) |
| GitHub | Fine-grained PAT *(рекомендуется)* | **Issues: Read and write**, **Pull requests: Read and write** (Metadata: Read-only добавляется автоматически) | **Triage** или выше |
| GitHub | Classic PAT | **`repo`** (или только **`public_repo`** для публичных репозиториев) | **Triage** или выше |

<a id="ru-token-permissions"></a>

#### Права токена подробно

**Для чего используется токен.** Ниже все запросы, которые делает Git Pilot. По ним можно убедиться, что лишних прав не выдаётся:

| Операция | GitLab API | GitHub API |
| --- | --- | --- |
| Проверить токен, показать аккаунт | `GET /user` | `GET /user` |
| Прочитать задачу | `GET /projects/:id/issues/:iid` | `GET /repos/:owner/:repo/issues/:n` |
| Найти связанные MR/PR | `GET …/issues/:iid/related_merge_requests`, `GET …/merge_requests?source_branch=` | `GET /repos/…/pulls?head=`, GraphQL `closedByPullRequestsReferences` |
| Получить список меток статуса | `GET /projects/:id/labels` | `GET /repos/…/labels` |
| **Изменить статус** | `PUT /projects/:id/issues/:iid`, `PUT /projects/:id/merge_requests/:iid` | `PUT /repos/…/issues/:n/labels` (так же и для PR) |

Git Pilot не читает код репозитория, не делает push, ничего не удаляет и не трогает CI, настройки и участников. У токенов GitLab и классических токенов GitHub нет более узкого scope, который всё ещё позволяет менять метки, поэтому и нужны `api` / `repo`.

**GitLab**

1. Откройте **Аватар → Edit profile → Access tokens → Add new token** или нажмите кнопку в поле ввода Git Pilot.
2. Укажите имя (например, `Git Pilot`) и срок действия. GitLab требует срок действия, поэтому после его окончания нужно будет ввести новый токен.
3. В разделе **Scopes** отметьте только **`api`**.
   - `read_api` **недостаточно**: статусы будут отображаться, но любое изменение завершится ошибкой *Access denied*.
   - `write_repository`, `sudo`, `admin_mode` и остальные scope не нужны, не отмечайте их.
4. Проверьте свою роль в проекте. Чтобы менять метки на задачах, нужна роль не ниже **Reporter**, а на merge request'ах — не ниже **Developer**. Роль *Planner* позволяет редактировать задачи, но не MR.
5. Подойдёт и **токен проекта или группы** (project / group access token): scope `api`, роль **Developer**.

**GitHub: fine-grained токен (рекомендуется)**

1. Откройте **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. **Resource owner:** аккаунт или организация, которой принадлежит репозиторий. Организация может требовать одобрения токена администратором. Пока токен не одобрен, API отвечает 403/404.
3. **Repository access:** *Only select repositories*. Выберите репозитории, в которых работаете.
4. **Repository permissions**, и больше ничего:
   - **Issues:** Read and write
   - **Pull requests:** Read and write
   - **Metadata:** Read-only (GitHub добавляет автоматически)
5. **Account permissions:** не нужны.

**GitHub: классический токен**

1. Откройте **Settings → Developer settings → Personal access tokens → Tokens (classic) → Generate new token (classic)** или нажмите кнопку в поле ввода Git Pilot.
2. Отметьте **`repo`**. Если вы работаете только с публичными репозиториями, достаточно **`public_repo`**. `workflow`, `admin:*`, `delete_repo` и остальные scope не отмечайте.
3. Если в организации включён **SAML SSO**, после создания токена нажмите рядом с ним **Configure SSO → Authorize**. Иначе репозитории организации будут отвечать 403/404.

**В репозитории** нужна роль не ниже **Triage**: это минимальная роль, которой разрешено ставить метки. GitHub Enterprise Server работает так же. Если ваша версия GitHub Enterprise Server не поддерживает fine-grained токены, используйте классический.

**Создание новых меток.** Если ввести в списке новый статус, платформа создаст метку. Для этого нужно право управлять метками в проекте: в GitLab — Reporter/Planner или выше, в GitHub — **Write**.

**Проверка токена.** После сохранения Git Pilot показывает *«authenticated as @user»*. Это подтверждает только, что токен **действителен** (`GET /user`), но не проверяет права на запись. Они проверяются при первой смене статуса. Если каких-то прав не хватает, это видно в строке состояния:

| Что видно в строке состояния / подсказке | Вероятная причина | Что сделать |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | Токен истёк, отозван или вставлен с ошибкой | Создать новый токен |
| `$(error) Git Pilot: #142`, *Access denied … (token scope?)* | В GitLab выбран `read_api` вместо `api`; Issues/Pull requests выставлены в *Read-only*; роль в проекте ниже нужной; SSO не авторизован | Пересоздать токен с правами выше, проверить роль, авторизовать SSO |
| `$(circle-slash) #142: not found` | Задачи нет, **или** токен не видит репозиторий (fine-grained токен не включает этот репозиторий; для приватных репозиториев без доступа GitHub отвечает 404) | Добавить репозиторий в *Repository access* токена |
| Задача показана, но PR не находится | У fine-grained токена нет **Pull requests: Read** | Добавить право Pull requests |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-security"></a>

### Модель безопасности

Склонированный репозиторий — недоверенные данные: он сам задаёт свой remote URL, имена веток и `.vscode/settings.json`. Git Pilot защищает ваши токены так:

- **Workspace Trust:** в ограниченном режиме (Restricted Mode) расширение не запускается (`untrustedWorkspaces.supported: false`).
- **Привязка к origin:** токен отправляется только на API-origin того хоста, для которого он сохранён. Абсолютные URL от сервера (заголовки пагинации `Link`, редиректы), ведущие куда-либо ещё, отклоняются.
- **Ручная обработка редиректов:** переход по редиректу выполняется только в пределах того же origin. Это важно, потому что иначе `fetch` передал бы GitLab-заголовок `PRIVATE-TOKEN` на любой хост.
- **Только HTTPS:** remote вида `http://` не переводит запросы к API на открытый HTTP. Чтобы отправлять токен по HTTP, нужен `gitPilot.allowInsecureHttp`. Эта настройка имеет область `machine` и читается только из пользовательских настроек, поэтому репозиторий не может её включить.
- **Недоверенные данные сервера:** ссылки из API открываются и отображаются, только если это `http(s)`-ссылки на хост самого инстанса. `openExternal` отказывается открывать любые другие схемы. Заголовки и метки в подсказках экранируются, а идентификаторы и ссылки на проекты проверяются перед подстановкой в пути API.
- **Ограничения:** regex ветки — не длиннее 300 символов, имя ветки — не длиннее 255 (защита от ReDoS). Ответ сервера — не больше 10 МБ, таймаут запроса — 20 с, не больше 10 страниц на один список.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-commands"></a>

### Команды и логи

| Команда | ID |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |
| Git Pilot: Status Sync: Select Status | `gitPilot.statusSync.selectStatus` |
| Git Pilot: Status Sync: Sync Now | `gitPilot.statusSync.syncNow` |

Диагностика пишется в **Output → Git Pilot**. При запуске в лог попадают версии расширения и VS Code, окружение, действующие настройки (без токенов), время активации и список запущенных модулей. Чтобы видеть каждый запрос к API, выберите уровень логирования *Trace*. Токены в лог не пишутся никогда.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-architecture"></a>

### Архитектура

```text
src/
├── extension.ts               Точка входа: собирает PilotContext, регистрирует команды ядра, запускает модули
├── core/
│   ├── types.ts               Доменные модели и контракты PilotModule / GitPlatformProvider
│   ├── eventBus.ts            Типизированные события: repoChanged, branchChanged, configChanged, authChanged
│   ├── logger.ts              Канал вывода «Git Pilot»
│   ├── commands.ts            Команды ядра (setToken, openInBrowser)
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
    └── statusSync/            index.ts · syncEngine.ts · statusBarUi.ts
```

#### Как добавить модуль

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
export const MODULES = [() => new StatusSyncModule(), () => new DailyIssuesModule()];
```

Модули не вызывают друг друга напрямую. Они общаются только через `EventBus` и общие сервисы ядра из `PilotContext`.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-development"></a>

### Разработка

Требования: Node.js 18+, pnpm и VS Code 1.85 или новее.

```bash
pnpm install
pnpm run compile      # проверка типов + сборка в dist/extension.js
pnpm run watch        # сборка esbuild в режиме наблюдения
pnpm run package      # минифицированная production-сборка
```

Нажмите **F5** («Run Git Pilot»), чтобы запустить Extension Development Host. Будет запущена задача `watch`: esbuild и `tsc --noEmit` в режиме наблюдения. Оба problem matcher'а встроены (собственный matcher для esbuild в `.vscode/tasks.json` и стандартный `$tsc-watch`), так что дополнительные расширения не нужны. Конфигурация «Run Git Pilot (one-off build)» вместо наблюдения один раз выполняет `pnpm run compile`.

Во время работы у расширения **нет ни одной зависимости**. Все REST- и GraphQL-запросы идут через встроенный в Node `fetch`.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
