<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
<a id="top"></a>

# Git Pilot

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

**Contents:**
[Overview](#en-overview) ·
[Sidebar](#en-sidebar) ·
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

It's built as a small core platform (API clients, git integration, auth, event bus) with feature modules plugged in on top. It ships the core, the **Git Pilot sidebar** (sections **Issue & MR** and **Labels**), and **Status Sync**. Future modules such as `dailyIssues`, `reviewRadar` and `pipelineWatcher` plug into the same core (and add their own sidebar sections) without changing existing code.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-sidebar"></a>

### Sidebar

The **Git Pilot** icon in the activity bar opens a sidebar made of sections. Each section belongs to a module; sections can be collapsed, reordered or hidden like any VS Code view. Every section has *Open Issue / MR in Browser* and *Set Personal Access Token* in its `…` menu.

#### Issue & MR

The main section — the current branch's Issue and its open MRs/PRs. It is always shown; `gitPilot.statusSync.showSection` can hide it only while another section (Labels) is enabled.

```text
ISSUE & MR · #3                 [🏷 Change Status] [+ Add Labels] [⇅ Sync] [⟳]
 ⚠ Labels differ — from MR !5          [⇅] [🏷]
 ▾ Issue #3  Add a sidebar             [+] [↗]
     status: doing    status           [🏷]
     app:web          not on MR !5     [→] [⇄] [✕]
     bug              not on MR !5     [→] [✕]
 ▾ MR !5  Draft: sidebar               [+] [↗]
     status: doing    status           [🏷]
     app:api          not on Issue     [→] [⇄] [✕]
 ▸ Statuses (4)                        ← ✓ applies a status
```

- **Status** stays one click away: the summary row, the status label rows, the toolbar and the status bar item all open *Change Status*. Status labels are changed only this way — on the Issue and all open MRs/PRs at once — or by a confirmed *Sync from MR/PR* (see [Status Sync](#en-status-sync)).
- **Summary row.** When the Issue's labels differ from the MR/PR, the summary turns into *Status differs* / *Labels differ*, lists what differs per item and offers **`⇅` Sync from MR/PR…**. When everything matches it shows *Status: … — in sync*.
- **`+` Add Labels** — on an Issue/MR row adds to that item; on the toolbar it first asks where (the Issue, one MR/PR, or everywhere). Only labels that already exist in the project are offered; Git Pilot never creates or deletes project labels.
- **Groups are exclusive.** Labels of one group (`app:*`, see [Labels](#en-labels)) are mutually exclusive on an Issue/MR, like scoped labels: picking `app:api` replaces `app:web`, and the picker allows one label per group. Labels without a group (**Other**) can be added several at a time.
- **`⇄` Replace** (group labels only) — swaps the label for another one of the same group.
- **`✕` Remove** — detaches the label from that Issue/MR only (the label stays in the project); a notification offers **Undo**.
- **`→` Add Where Missing** — adds the label to the Issue/MRs of the branch that lack it.

Every change re-reads the Issue/MRs first and is written as a minimal add/remove diff, so concurrent edits by others are kept.

<a id="en-labels"></a>

#### Labels

The project label catalog (`gitPilot.labels.enabled`; GitLab: including ancestor group labels), grouped by the prefix before `:` / `::` (`status:*`, `app:*`, …); labels without a prefix go to **Other**. Labels applied to the current Issue / MRs get a ✓ and show where they are (*Issue · MR !5*). Set `gitPilot.labels.groups` (e.g. `["status:*", "app:*"]`) to group by your own masks in your own order; everything else goes to **Other**. The same groups define which labels are mutually exclusive in *Issue & MR*.

Item actions: `+` *Add Labels…* while the label is missing on the Issue or an MR, `✕` *Remove Label* while it is applied (detaches it; asks from where if it is on several items, offers Undo), *Apply Status* on status labels, *Copy Label Name*. The catalog loads only while the section is visible, reloads on repository / token changes, when the window regains focus (at most once a minute) and with ⟳; applied marks come from the Issue & MR section without extra API calls.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-status-sync"></a>

### Status Sync

Status Sync shows whether the **labels** of an **Issue** match its open **Merge Requests** (GitLab) or **Pull Requests** (GitHub) and syncs them **only when you confirm**. Nothing is ever written automatically.

#### How it works

1. Git Pilot reads the current branch and extracts the issue number with `gitPilot.branchIssueRegex`
   (`142-fix-auth`, `feat/142-login` → issue **#142**).
2. It fetches the issue, its open MRs/PRs, and the project's status labels:
   - **GitLab:** related merge requests **plus** open MRs whose source branch is the current branch.
   - **GitHub:** open PRs whose head is the current branch **plus** PRs linked as "closing" the issue (GraphQL `closedByPullRequestsReferences`).
   - Only MRs/PRs of **the same project** are used. MRs/PRs in other projects that merely mention the issue are ignored: anyone can create those, so they must not influence your issue or receive writes made with your token.
3. **The MR/PR is the source of truth:** the most recently updated open MR/PR that has a status label (or, if none has one, the most recently updated open MR/PR).
4. If the Issue (or another open MR/PR) differs from it, the sidebar summary and the status bar show it. **Sync Labels from MR / PR…** (`⇅` in the section toolbar, the summary row, the status bar item or the status picker) re-reads everything and opens a confirmation that lists every change, with two options:
   - **Sync Statuses** — puts the MR/PR's status label on the Issue and the other open MRs/PRs; other labels stay.
   - **Sync All Labels** — makes the labels of the Issue and the other open MRs/PRs **exactly** match the MR/PR, including removing labels it doesn't have.

   Only the changes shown in the dialog are written, as minimal diffs. If the branch changed meanwhile, the sync is cancelled.

| State | Status bar |
| --- | --- |
| No token | `$(key) Git Pilot: Set Token` |
| Loading | `$(sync~spin) Git Pilot: #142...` |
| In sync | `$(tag) #142: qa-passed (MR !89)` (`$(diff)` appended when only non-status labels differ) |
| Status differs | `$(warning) #142: todo ≠ MR !89: qa-passed` (warning background; click to sync) |

Click the status bar item to pick a status (or, when the status differs, to sync). The QuickPick lists every project label that starts with your prefix (the current one is marked with `$(check)`). It also has quick actions: **Sync Labels from MR/PR…** (when something differs), **Refresh**, **Open Issue/MR in Browser** and **Update API Token**. Only status labels that exist in the project are listed or applied — create new ones on GitLab/GitHub.

#### Refresh triggers (read-only)

- Extension activation
- Branch or repository switch
- The VS Code window regaining focus (at most once every 30 s)
- Every `gitPilot.statusSync.refreshInterval` seconds (paused while the window is in the background)
- **Git Pilot: Issue & MR: Refresh**

#### Mutually exclusive statuses everywhere

GitLab Premium has native *scoped labels* (`status::x`), which allow only one status label at a time. GitHub and GitLab Free don't have them, so Git Pilot does the same thing on the client side. When it sets a status, it first removes every existing label matching the prefix (`status:`, `status::` and spacing variants are treated as equivalent), keeps all other labels (`bug`, `frontend`, …), and then adds the new status. Behavior is identical on GitHub, GitLab CE and GitLab EE.

Updates are sent as diffs (GitLab `add_labels` / `remove_labels`; GitHub add / remove label calls), so other labels that someone else changes at the same moment are not overwritten.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-configuration"></a>

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `auto` \| `gitlab` \| `github`. `auto` detects the platform from the remote host. Set it explicitly for self-hosted hosts whose name doesn't contain "gitlab"/"github". |
| `gitPilot.instanceUrl` | `""` | Base URL override for self-hosted GitLab / GitHub Enterprise, e.g. `https://gitlab.company.com`. Instances served under a sub-path (e.g. `https://host/gitlab`) are supported. |
| `gitPilot.allowInsecureHttp` | `false` | User-level only. Allows sending tokens over plain `http://` (only with an explicit `http://` `instanceUrl`). Not recommended. |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Regex whose **first capturing group** is the issue IID/number. |
| `gitPilot.statusSync.showSection` | `true` | Shows the *Issue & MR* sidebar section. Ignored (always shown) while it is the only section, i.e. `gitPilot.labels.enabled` is off. |
| `gitPilot.statusSync.showStatusBar` | `true` | Shows the Issue / MR status item in the status bar. |
| `gitPilot.statusSync.labelPrefix` | `"status:"` | Use `status:` for regular labels or `status::` for GitLab scoped labels. |
| `gitPilot.statusSync.refreshInterval` | `120` | Background refresh interval in seconds (read-only). `0` turns it off; the minimum is 10. |
| `gitPilot.labels.enabled` | `true` | Shows the Labels section (project label catalog) in the sidebar. |
| `gitPilot.labels.groups` | `[]` | Grouping masks for *All labels*, e.g. `["status:*", "app:*"]` (`*` any characters, `?` one; `:` also matches `::`). Empty = group by the prefix before `:` / `::`. Labels of one group are mutually exclusive on an Issue/MR; unmatched labels go to **Other** and can be combined. |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-authentication"></a>

### Authentication

Run **Git Pilot: Set Personal Access Token** (or click `$(key) Git Pilot: Set Token`). Git Pilot stores one token per host in VS Code's `SecretStorage`, which is backed by the OS keychain. The token is never written to settings. Once it's stored, Git Pilot checks it against the API and shows the account it authenticated as.

The keychain is the macOS Keychain, the Windows Credential Manager, or on Linux a Secret Service keyring (GNOME Keyring, KWallet). If VS Code cannot reach it — typically a Linux setup without an installed or unlocked keyring — Git Pilot says so instead of failing silently; fix the keyring (or start VS Code with a `--password-store` option, see *Troubleshooting keychain issues* in the VS Code docs). With Remote-SSH / WSL / Dev Containers the token stays in the keychain of your local machine.

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
| **Change the status / labels** | `PUT /projects/:id/issues/:iid`, `PUT /projects/:id/merge_requests/:iid` (`add_labels` / `remove_labels`) | `POST` / `DELETE /repos/…/issues/:n/labels` (also used for PRs) |

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

**No label creation.** Git Pilot only applies labels that already exist in the project and never creates or deletes project labels, so no label-management permission is needed.

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
- **Untrusted server data:** links from the API are opened or rendered only if they are `http(s)` links on the instance's own host. `openExternal` refuses any other scheme. Titles and labels are escaped in tooltips, IDs are validated before they are used in API paths, and remote URLs with malformed escapes or `.` / `..` path segments are ignored. GitHub labels named `.` / `..` are never put into a request path (URL parsing would turn them into a different request).
- **No automatic writes, same project only:** labels are written only on your explicit action; syncing from an MR/PR always asks for confirmation and lists the changes. MRs/PRs from other projects that mention your issue are ignored, and writes go only to the current project. Status labels that don't exist in the project are refused (the platforms would silently create them).
- **Limits:** the branch regex is limited to 300 characters and branch names to 255 (ReDoS). Responses are limited to 10 MB, requests time out after 20 s, and there are at most 10 pages per listing.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-commands"></a>

### Commands & Logs

| Command | ID |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |
| Git Pilot: Change Status… | `gitPilot.statusSync.selectStatus` |
| Git Pilot: Add Labels… | `gitPilot.statusSync.addLabel` |
| Git Pilot: Issue & MR: Sync Labels from MR / PR… | `gitPilot.statusSync.syncFromMr` |
| Git Pilot: Issue & MR: Refresh | `gitPilot.statusSync.refresh` |
| Git Pilot: Labels: Refresh | `gitPilot.labels.refresh` |

Sidebar item actions, hidden from the Command Palette: `gitPilot.openItem`, `gitPilot.statusSync.applyStatus`, `gitPilot.statusSync.removeLabel`, `gitPilot.statusSync.replaceLabel`, `gitPilot.statusSync.copyLabelToOthers`, `gitPilot.labels.copyName`. They act only on tree items created by Git Pilot.

Diagnostics are written to **Output → Git Pilot**. On startup, the log records the extension and VS Code versions, the environment, the effective settings (never tokens), the activation time and which modules started. Set the log level to *Trace* to see every API request; tokens are never logged.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-architecture"></a>

### Architecture

```text
src/
├── extension.ts               Entry point: builds PilotContext, registers core commands, activates modules
├── core/
│   ├── types.ts               Domain models + PilotModule / GitPlatformProvider contracts
│   ├── eventBus.ts            Typed events: repoChanged, branchChanged, configChanged, authChanged, syncStateChanged
│   ├── logger.ts              "Git Pilot" log output channel
│   ├── commands.ts            Core commands (setToken, openInBrowser, openItem)
│   ├── format.ts              Shared text helpers (MR/PR terms, Markdown escaping)
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
    ├── statusSync/            index.ts · syncEngine.ts · syncPlan.ts · statusBarUi.ts · statusTree.ts · labelPicker.ts
    └── labels/                index.ts · labelsTree.ts
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
export const MODULES = [() => new StatusSyncModule(), () => new LabelsModule(), () => new DailyIssuesModule()];
```

Modules don't call each other. They communicate only through the `EventBus` and the shared core services in `PilotContext`.

To add a sidebar section, declare a view in `contributes.views.gitPilot` of `package.json` with `"when": "config.gitPilot.<moduleId>.enabled"`, then render it with `new SectionView('<viewId>')` and `TreeNode`s from `core/ui/sectionView.ts`. Item commands receive the `TreeNode`; trust only nodes (`instanceof TreeNode`) and keep tooltips plain text.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

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

**Packaging.** `.vscodeignore` is an allow-list (`dist/extension.js`, `media/`, `README.md`, `LICENSE.md`, `package.json`). Package with `vsce package --no-dependencies` (pnpm layout, no runtime dependencies) and check the contents with `vsce ls --no-dependencies` before publishing.

<sub>[↑ Contents](#en) · [Русский](#ru) · [↑ Top](#top)</sub>

---

<a id="ru"></a>

## Русский

**Содержание:**
[Обзор](#ru-overview) ·
[Боковая панель](#ru-sidebar) ·
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

Расширение состоит из небольшого ядра (API-клиенты, интеграция с git, аутентификация, шина событий) и подключаемых к нему функциональных модулей. В состав входят ядро, **боковая панель Git Pilot** (разделы **Issue & MR** и **Labels**) и **Status Sync**. Будущие модули, например `dailyIssues`, `reviewRadar` и `pipelineWatcher`, подключаются к тому же ядру (и добавляют свои разделы в боковую панель) без изменения существующего кода.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-sidebar"></a>

### Боковая панель

Значок **Git Pilot** на панели действий (activity bar) открывает боковую панель из разделов. Каждый раздел принадлежит модулю; разделы можно сворачивать, переставлять и скрывать, как любые представления VS Code. В меню `…` каждого раздела есть *Open Issue / MR in Browser* и *Set Personal Access Token*.

#### Issue & MR

Главный раздел — задача текущей ветки и её открытые MR/PR. Показывается всегда; настройка `gitPilot.statusSync.showSection` может скрыть его, только пока включён другой раздел (Labels).

```text
ISSUE & MR · #3                 [🏷 Change Status] [+ Add Labels] [⇅ Sync] [⟳]
 ⚠ Labels differ — from MR !5          [⇅] [🏷]
 ▾ Issue #3  Add a sidebar             [+] [↗]
     status: doing    status           [🏷]
     app:web          not on MR !5     [→] [⇄] [✕]
     bug              not on MR !5     [→] [✕]
 ▾ MR !5  Draft: sidebar               [+] [↗]
     status: doing    status           [🏷]
     app:api          not on Issue     [→] [⇄] [✕]
 ▸ Statuses (4)                        ← ✓ применяет статус
```

- **Статус** всегда в один клик: строка-сводка, строки статусных меток, кнопка на панели раздела и элемент строки состояния открывают *Change Status*. Метки статуса меняются только так — сразу у задачи и всех открытых MR/PR — или подтверждённой синхронизацией *Sync from MR/PR* (см. [Status Sync](#ru-status-sync)).
- **Строка-сводка.** Если метки задачи расходятся с MR/PR, сводка превращается в *Status differs* / *Labels differ*, показывает расхождения по каждому элементу и предлагает **`⇅` Sync from MR/PR…**. Если всё совпадает — *Status: … — in sync*.
- **`+` Add Labels** — на строке задачи/MR добавляет метки ей; на панели раздела сначала спрашивает, куда (задача, один MR/PR или везде). Предлагаются только метки, которые уже есть в проекте; Git Pilot не создаёт и не удаляет метки проекта.
- **Группы взаимоисключающие.** Метки одной группы (`app:*`, см. [Labels](#ru-labels)) у задачи/MR могут быть только в одном экземпляре, как scoped labels: выбор `app:api` заменяет `app:web`, а в списке выбора можно отметить одну метку на группу. Метки без группы (**Other**) можно добавлять по несколько.
- **`⇄` Replace** (только для меток из группы) — заменяет метку другой из той же группы.
- **`✕` Remove** — снимает метку только с этой задачи/MR (сама метка в проекте остаётся); в уведомлении есть **Undo**.
- **`→` Add Where Missing** — добавляет метку тем задаче/MR ветки, где её нет.

Перед каждым изменением задача и MR перечитываются, а запись идёт минимальной разницей (добавить/снять), поэтому параллельные правки других людей не теряются.

<a id="ru-labels"></a>

#### Labels

Каталог меток проекта (`gitPilot.labels.enabled`; в GitLab — вместе с метками родительских групп), сгруппированный по префиксу до `:` / `::` (`status:*`, `app:*`, …); метки без префикса попадают в **Other**. Метки, применённые к текущей задаче/MR, отмечены ✓, и видно, где они стоят (*Issue · MR !5*). Чтобы группировать по своим маскам и в своём порядке, задайте `gitPilot.labels.groups` (например, `["status:*", "app:*"]`); всё остальное попадёт в **Other**. Эти же группы определяют, какие метки взаимоисключающие в разделе *Issue & MR*.

Действия с меткой: `+` *Add Labels…*, пока метки нет у задачи или какого-то MR; `✕` *Remove Label*, пока она где-то стоит (снимает её; если она на нескольких — спросит откуда, есть Undo); *Apply Status* для меток статуса; *Copy Label Name*. Каталог загружается, только когда раздел виден, перезагружается при смене репозитория или токена, при возврате фокуса в окно (не чаще раза в минуту) и по кнопке ⟳; отметки «где применена» приходят из раздела Issue & MR без лишних запросов к API.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-status-sync"></a>

### Status Sync

Status Sync показывает, совпадают ли **метки** **задачи (Issue)** и её открытых **Merge Request** (GitLab) или **Pull Request** (GitHub), и синхронизирует их **только после вашего подтверждения**. Автоматически ничего не записывается.

#### Как это работает

1. Git Pilot берёт текущую ветку и извлекает из неё номер задачи с помощью `gitPilot.branchIssueRegex`
   (`142-fix-auth`, `feat/142-login` → задача **#142**).
2. Загружает задачу, её открытые MR/PR и метки статуса проекта:
   - **GitLab:** связанные merge request'ы **плюс** открытые MR, у которых исходная ветка — текущая.
   - **GitHub:** открытые PR из текущей ветки **плюс** PR, которые «закрывают» задачу (GraphQL `closedByPullRequestsReferences`).
   - Учитываются только MR/PR **того же проекта**. MR/PR из других проектов, которые просто упоминают задачу, игнорируются: создать такой может кто угодно, поэтому они не должны влиять на вашу задачу или получать записи с вашим токеном.
3. **Источник истины — MR/PR:** открытый MR/PR с меткой статуса, обновлённый позже остальных (а если статуса нет ни у одного — просто последний обновлённый открытый MR/PR).
4. Если задача (или другой открытый MR/PR) с ним расходится, это видно в сводке боковой панели и в строке состояния. Команда **Sync Labels from MR / PR…** (`⇅` на панели раздела, в строке-сводке, клик по элементу строки состояния или пункт в списке статусов) перечитывает данные и открывает подтверждение со списком всех изменений и двумя вариантами:
   - **Sync Statuses** — ставит метку статуса MR/PR задаче и остальным открытым MR/PR; прочие метки не трогаются.
   - **Sync All Labels** — делает метки задачи и остальных открытых MR/PR **в точности** такими же, как у MR/PR, в том числе снимает метки, которых у него нет.

   Записываются только изменения, показанные в окне, минимальной разницей. Если за это время сменилась ветка, синхронизация отменяется.

| Состояние | Строка состояния |
| --- | --- |
| Нет токена | `$(key) Git Pilot: Set Token` |
| Загрузка | `$(sync~spin) Git Pilot: #142...` |
| Совпадает | `$(tag) #142: qa-passed (MR !89)` (если расходятся только нестатусные метки, добавляется `$(diff)`) |
| Статус расходится | `$(warning) #142: todo ≠ MR !89: qa-passed` (жёлтый фон; клик — синхронизация) |

Нажмите на элемент в строке состояния, чтобы выбрать статус (а если статус расходится — чтобы синхронизировать). В списке (QuickPick) есть все метки проекта, начинающиеся с вашего префикса, текущая отмечена `$(check)`. Там же быстрые действия: **Sync Labels from MR/PR…** (если что-то расходится), **Refresh** (обновить), **Open Issue/MR in Browser** (открыть в браузере) и **Update API Token** (обновить токен). Показываются и применяются только метки статуса, которые уже есть в проекте, — новые создавайте в GitLab/GitHub.

#### Когда обновляются данные (только чтение)

- При активации расширения
- При переключении ветки или репозитория
- Когда окно VS Code снова получает фокус (не чаще раза в 30 с)
- Каждые `gitPilot.statusSync.refreshInterval` секунд (пока окно в фоне, обновление приостановлено)
- Командой **Git Pilot: Issue & MR: Refresh**

#### Взаимоисключающие статусы на любой платформе

В GitLab Premium есть встроенные *scoped labels* (`status::x`): у задачи может быть только одна метка с таким префиксом. В GitHub и GitLab Free их нет, поэтому Git Pilot делает то же самое на стороне клиента. При установке статуса он сначала удаляет все метки с этим префиксом (`status:`, `status::` и варианты с пробелами считаются одним и тем же), сохраняет остальные метки (`bug`, `frontend`, …) и только потом добавляет новый статус. Поведение одинаково в GitHub, GitLab CE и GitLab EE.

Изменения отправляются как разница (в GitLab — `add_labels` / `remove_labels`, в GitHub — отдельные запросы на добавление и снятие меток), поэтому метки, которые кто-то меняет в тот же момент, не перезаписываются.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-configuration"></a>

### Настройки

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `auto` \| `gitlab` \| `github`. В режиме `auto` платформа определяется по хосту remote. Для собственных серверов, в имени которых нет «gitlab»/«github», укажите явно. |
| `gitPilot.instanceUrl` | `""` | Базовый URL собственного GitLab / GitHub Enterprise, например `https://gitlab.company.com`. Поддерживаются инстансы по подпути (например, `https://host/gitlab`). |
| `gitPilot.allowInsecureHttp` | `false` | Только на уровне пользователя. Разрешает отправлять токены по открытому `http://` (только вместе с явным `http://` в `instanceUrl`). Не рекомендуется. |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Регулярное выражение, **первая группа захвата** которого — номер (IID) задачи. |
| `gitPilot.statusSync.showSection` | `true` | Показывает раздел *Issue & MR* в боковой панели. Не действует (раздел показан всегда), пока он единственный, то есть `gitPilot.labels.enabled` выключена. |
| `gitPilot.statusSync.showStatusBar` | `true` | Показывает элемент задачи / MR в строке состояния. |
| `gitPilot.statusSync.labelPrefix` | `"status:"` | `status:` — для обычных меток, `status::` — для scoped labels в GitLab. |
| `gitPilot.statusSync.refreshInterval` | `120` | Интервал фонового обновления данных в секундах (только чтение). `0` отключает его; минимум — 10. |
| `gitPilot.labels.enabled` | `true` | Показывает раздел Labels (каталог меток проекта) в боковой панели. |
| `gitPilot.labels.groups` | `[]` | Маски группировки для *All labels*, например `["status:*", "app:*"]` (`*` — любые символы, `?` — один символ; `:` совпадает и с `::`). Пусто — группировка по префиксу до `:` / `::`. Метки одной группы взаимоисключающие у задачи/MR; не подошедшие ни под одну маску попадают в **Other** и могут сочетаться. |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-authentication"></a>

### Аутентификация

Выполните **Git Pilot: Set Personal Access Token** (или нажмите `$(key) Git Pilot: Set Token`). Git Pilot хранит по одному токену на хост в `SecretStorage` VS Code, то есть в связке ключей ОС. В настройки токен никогда не записывается. Сразу после сохранения Git Pilot проверяет токен через API и показывает, под каким аккаунтом выполнен вход.

Связка ключей — это Keychain в macOS, диспетчер учётных данных Windows, а в Linux — keyring Secret Service (GNOME Keyring, KWallet). Если VS Code не может к ней обратиться (обычно это Linux без установленного или разблокированного keyring), Git Pilot сообщает об этом, а не молча не работает; настройте keyring (или запустите VS Code с параметром `--password-store`, см. *Troubleshooting keychain issues* в документации VS Code). При работе через Remote-SSH / WSL / Dev Containers токен хранится в связке ключей вашей локальной машины.

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
| **Изменить статус / метки** | `PUT /projects/:id/issues/:iid`, `PUT /projects/:id/merge_requests/:iid` (`add_labels` / `remove_labels`) | `POST` / `DELETE /repos/…/issues/:n/labels` (так же и для PR) |

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

**Метки не создаются.** Git Pilot применяет только метки, которые уже есть в проекте, и никогда не создаёт и не удаляет метки проекта, поэтому право управлять метками не нужно.

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
- **Недоверенные данные сервера:** ссылки из API открываются и отображаются, только если это `http(s)`-ссылки на хост самого инстанса. `openExternal` отказывается открывать любые другие схемы. Заголовки и метки в подсказках экранируются, идентификаторы проверяются перед подстановкой в пути API, а remote URL с некорректным экранированием или сегментами `.` / `..` игнорируются. Метки GitHub с именами `.` / `..` никогда не подставляются в путь запроса (разбор URL превратил бы его в другой запрос).
- **Никаких автоматических записей, только свой проект:** метки записываются только по вашему явному действию; синхронизация из MR/PR всегда спрашивает подтверждение и показывает список изменений. MR/PR из других проектов, упоминающие вашу задачу, игнорируются, а запись идёт только в текущий проект. Метки статуса, которых нет в проекте, отклоняются (платформы молча создали бы их).
- **Ограничения:** regex ветки — не длиннее 300 символов, имя ветки — не длиннее 255 (защита от ReDoS). Ответ сервера — не больше 10 МБ, таймаут запроса — 20 с, не больше 10 страниц на один список.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-commands"></a>

### Команды и логи

| Команда | ID |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |
| Git Pilot: Change Status… | `gitPilot.statusSync.selectStatus` |
| Git Pilot: Add Labels… | `gitPilot.statusSync.addLabel` |
| Git Pilot: Issue & MR: Sync Labels from MR / PR… | `gitPilot.statusSync.syncFromMr` |
| Git Pilot: Issue & MR: Refresh | `gitPilot.statusSync.refresh` |
| Git Pilot: Labels: Refresh | `gitPilot.labels.refresh` |

Действия элементов боковой панели, скрытые из палитры команд: `gitPilot.openItem`, `gitPilot.statusSync.applyStatus`, `gitPilot.statusSync.removeLabel`, `gitPilot.statusSync.replaceLabel`, `gitPilot.statusSync.copyLabelToOthers`, `gitPilot.labels.copyName`. Они работают только с элементами дерева, созданными самим Git Pilot.

Диагностика пишется в **Output → Git Pilot**. При запуске в лог попадают версии расширения и VS Code, окружение, действующие настройки (без токенов), время активации и список запущенных модулей. Чтобы видеть каждый запрос к API, выберите уровень логирования *Trace*. Токены в лог не пишутся никогда.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-architecture"></a>

### Архитектура

```text
src/
├── extension.ts               Точка входа: собирает PilotContext, регистрирует команды ядра, запускает модули
├── core/
│   ├── types.ts               Доменные модели и контракты PilotModule / GitPlatformProvider
│   ├── eventBus.ts            Типизированные события: repoChanged, branchChanged, configChanged, authChanged, syncStateChanged
│   ├── logger.ts              Канал вывода «Git Pilot»
│   ├── commands.ts            Команды ядра (setToken, openInBrowser, openItem)
│   ├── format.ts              Общие текстовые хелперы (термины MR/PR, экранирование Markdown)
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
    ├── statusSync/            index.ts · syncEngine.ts · syncPlan.ts · statusBarUi.ts · statusTree.ts · labelPicker.ts
    └── labels/                index.ts · labelsTree.ts
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
export const MODULES = [() => new StatusSyncModule(), () => new LabelsModule(), () => new DailyIssuesModule()];
```

Модули не вызывают друг друга напрямую. Они общаются только через `EventBus` и общие сервисы ядра из `PilotContext`.

Чтобы добавить раздел в боковую панель, объявите представление в `contributes.views.gitPilot` файла `package.json` с `"when": "config.gitPilot.<moduleId>.enabled"` и отрисуйте его через `new SectionView('<viewId>')` и узлы `TreeNode` из `core/ui/sectionView.ts`. Команды элементов получают сам `TreeNode`; доверяйте только таким узлам (`instanceof TreeNode`) и оставляйте подсказки простым текстом.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

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

**Упаковка.** `.vscodeignore` — белый список (`dist/extension.js`, `media/`, `README.md`, `LICENSE.md`, `package.json`). Собирайте пакет командой `vsce package --no-dependencies` (раскладка pnpm, зависимостей во время работы нет) и перед публикацией проверьте состав через `vsce ls --no-dependencies`.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
