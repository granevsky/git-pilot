<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
<a id="top"></a>

# Git Pilot

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

**Contents:**
[Overview](#en-overview) ·
[Quick Start](#en-quick-start) ·
[Sidebar & Status Bar](#en-sidebar) ·
[Status Sync & Scoped Labels](#en-status-sync) ·
[Authentication & Permissions](#en-authentication) ·
[Configuration](#en-configuration) ·
[Commands & Logs](#en-commands) ·
[Security](#en-security)

<a id="en-overview"></a>

### Overview

**Git Pilot** links your current Git branch in VS Code to its **Issue** and open **Merge Requests / Pull Requests** on **GitLab (CE/EE)** and **GitHub (including Enterprise)**.

Instead of jumping to the browser to move an issue across the board, check discussion threads, or fix mismatched labels between an Issue and its MR/PR, you can do it from the sidebar or status bar:

- **Branch-to-issue linking** — extracts the issue number from the current branch name (`142-fix-auth`, `feat/142-login` → `#142`) and locates related open MRs/PRs in the same project.
- **One-click status updates** — sets the `status:*` label on the Issue and all its open MRs/PRs at once.
- **Scoped labels on any platform** — treats label groups (`status:*`, `app:*`, etc.) as mutually exclusive on GitHub and GitLab Free, just like GitLab Premium's `::` scoped labels.
- **Confirmed sync from MR/PR** — shows when labels on an Issue and its MR/PR diverge and lets you preview and apply the exact diff.
- **Project label catalog** — lists all repository labels grouped by prefix or custom masks, shows where each label is applied, and lets you attach or remove them in place.
- **Issue & MR/PR comments** — shows conversation comments (newest first, without system activity notes) and lets you post new ones from VS Code.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-quick-start"></a>

### Quick Start

1. **Checkout a branch with an issue number**
   By default, Git Pilot looks for the number at the start of the branch name or after `/` or `-` (for example, `142-fix-auth` or `feat/142-login`). You can change this pattern in `gitPilot.branchIssueRegex`.
2. **Add a Personal Access Token**
   Click `$(key) Git Pilot: Set Token` in the status bar (or run **Git Pilot: Set Personal Access Token** from the Command Palette). The prompt includes a button that opens the token creation page on your GitLab or GitHub instance.
3. **Work from the sidebar or status bar**
   Use the status bar item or the **Git Pilot** view in the Activity Bar to switch statuses, edit labels, sync changes from an MR/PR, or read and post comments.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-sidebar"></a>

### Sidebar & Status Bar

#### Labels section

Shows the Issue for the current branch, its open MRs/PRs, their labels, and the project's label catalog:

```text
LABELS · #3                                         [🏷] [+] [⇅] [⟳]
 ▸ ⚠ Labels differ   from MR !5 · 14:30:00               [⇅] [🏷]
 ▾ Issue #3   Add a sidebar                              [+] [↗]
     status: doing   status                              [🏷]
     app:web         not on MR !5                    [→] [⇄] [✕]
     bug             not on MR !5                    [→]     [✕]
 ▾ MR !5   Draft: sidebar                                [+] [↗]
     status: doing   status                              [🏷]
     app:api         not on Issue                    [→] [⇄] [✕]
 ▸ All labels (12)
```

- **Summary row** — shows the current status when everything matches (*Status: doing — in sync*; click to pick another status). If labels on the Issue and the MR/PR differ, the row expands to show the exact `+`/`−` diff per item, and clicking it opens the **Sync from MR/PR…** confirmation dialog.
- **Row actions:**
  - `🏷` **Change Status…** — set a new status on the Issue and all open MRs/PRs.
  - `+` **Add Labels…** — on an Issue/MR row, adds labels to that item; from the section header, asks whether to apply them to the Issue, a specific MR/PR, or everywhere.
  - `→` **Add Label Where Missing** — copies the label to the other items on this branch that don't have it yet.
  - `⇄` **Replace Label…** — swaps a grouped label (e.g. `app:web`) for another label from the same group (`app:api`).
  - `✕` **Remove Label** — removes the label from that Issue or MR/PR (the notification includes an **Undo** button).
  - `↗` **Open in Browser** — opens the Issue or MR/PR in your browser.
- **All labels** — the full label catalog of the project (on GitLab, including labels inherited from parent groups). Loaded when you first expand the node and refreshed with the **Refresh** button:
  - Grouped automatically by the prefix before `:` or `::` (`status:*`, `app:*`), or by custom glob masks in `gitPilot.labels.groups`. Labels without a prefix are placed under **Other**.
  - Labels applied to the current Issue or MRs/PRs are marked with `✓` and list where they are used (*Issue · MR !5*).
  - Use the inline buttons to `+` add or `✕` remove a label, `✓` apply a status from the `status:*` group, or copy the label name via the context menu.

#### Comments section

Lists comments on the current Issue and each of its open MRs/PRs, **newest first**:

```text
COMMENTS · #3                                              [💬] [⟳]
 ▾ Issue #3   Add a sidebar                                  [💬] [↗]
     💬 Add comment…
     @alice   2 h ago · Checked on staging, works
     @bob     yesterday · [media] reproduces on Safari          [↗]
     ⌄ Show more…                                       10 older
 ▸ MR !5   Draft: sidebar                                    [💬] [↗]
```

- **Conversation comments only** — system activity notes (label, weight, assignee, or milestone changes, commit mentions, etc.) are skipped. On GitHub, this shows the PR conversation thread rather than inline diff review comments.
- **On-demand pagination** — comments load when you expand an Issue or MR/PR node; **Show more…** fetches the next page of older comments (`gitPilot.comments.pageSize`, default `10`).
- **Reading & media** — clicking a comment opens its full text in a read-only editor tab. Embedded images, videos, and attachments aren't loaded inside VS Code; comments with media are marked with a `🖼` icon so you can jump straight to the permalink (`#note_…` / `#issuecomment-…`) via `↗` **Open in Browser**.
- **Writing** — `💬` **Add comment…** opens a quick input box where pressing **Enter** posts the comment right away. For multi-line Markdown, click the `✎` button in the input box (or set `gitPilot.comments.compose` to `"editor"`) to write in an editor tab and send with **Ctrl+Enter** (`⌘+Enter` on macOS) or the **Send** button in the tab bar. If sending fails, **Continue in Draft** keeps your text in an editor tab so nothing is lost.

#### Working with multiple repositories

When several Git repositories are open in the same window (multi-root workspaces or nested repositories), Git Pilot follows the repository of the active file editor. If you want to lock the sidebar to a specific repository regardless of which file is focused, run **Git Pilot: Select Repository…** (also available in the `…` menu of each section) and pin it. Select **Follow the active editor** to unpin.

When multiple repositories are open or one is pinned, section headers show the active repository name (for example, `#3 · backend (pinned)`).

#### Status bar

| State | Status bar display | Click action |
| --- | --- | --- |
| No token stored | `$(key) Git Pilot: Set Token` | Open token prompt |
| Loading | `$(sync~spin) Git Pilot: #142...` | — |
| In sync | `$(tag) #142: qa-passed (MR !89)` *(adds `$(diff)` if non-status labels differ)* | Open status picker & quick actions |
| Status differs | `$(warning) #142: todo ≠ MR !89: qa-passed` | Open **Sync Labels from MR / PR…** |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-status-sync"></a>

### Status Sync & Scoped Labels

#### How MR/PR discovery and sync work

1. **Finding linked MRs/PRs (within the same project):**
   - **GitLab:** open MRs linked to the issue (`related_merge_requests`) plus open MRs whose source branch matches the current branch.
   - **GitHub:** open PRs from the current branch plus open PRs linked as closing the issue (`closedByPullRequestsReferences`).
2. **Source of truth:** the most recently updated open MR/PR that carries a status label (or simply the most recently updated open MR/PR if none has a status).
3. **Confirmed sync (`Sync Labels from MR / PR…`):**
   Git Pilot never changes labels in the background. When you run a sync, it fetches fresh state and shows a confirmation dialog with two options:
   - **Sync Statuses** — copies only the status label from the source MR/PR to the Issue and any other open MRs/PRs.
   - **Sync All Labels** — makes the full label set on the Issue and other open MRs/PRs match the source MR/PR (removing labels that aren't on that MR/PR).

#### Scoped / mutually exclusive label groups

GitLab Premium supports scoped labels (`status::doing`), where applying a new label with the same prefix automatically removes the previous one. Git Pilot brings the same behavior to **GitHub**, **GitLab CE**, and regular `prefix:value` labels:

- **Statuses:** applying `status: review` strips any existing `status:*` / `status::*` label while keeping unrelated labels intact.
- **Label groups:** labels sharing a prefix (`app:web`, `app:api`) or matching the same mask in `gitPilot.labels.groups` replace each other on an Issue/MR. Unprefixed labels in **Other** (`bug`, `urgent`) can be combined freely.
- **Minimal diff writes:** before saving, Git Pilot re-fetches current labels and sends only the added/removed diff (`add_labels` / `remove_labels` on GitLab, `POST` / `DELETE` on GitHub), preserving concurrent edits made by teammates. Only existing project labels are applied.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-authentication"></a>

### Authentication & Permissions

Run **Git Pilot: Set Personal Access Token** to store a token for your GitLab or GitHub host. Tokens are saved per host in VS Code's `SecretStorage` (macOS Keychain, Windows Credential Manager, or Linux Secret Service keyring) and are never written to settings files. To remove a saved token, run the command and submit an empty value.

| Platform | Token type | Required permissions / scopes | Minimum project role |
| --- | --- | --- | --- |
| **GitLab** | Personal, Project, or Group Access Token | Scope: **`api`** *(`read_api` is read-only and cannot update labels or post comments)* | **Developer** *(Reporter can edit issue labels, but not MRs)* |
| **GitHub** | Fine-grained PAT *(recommended)* | Repository permissions: **Issues: Read and write**, **Pull requests: Read and write** | **Triage** or higher |
| **GitHub** | Classic PAT | Scope: **`repo`** *(or **`public_repo`** for public repos only)* | **Triage** or higher |

> **GitHub Organizations:** If your organization enforces SAML SSO with a classic token, click **Configure SSO → Authorize** next to the token on GitHub after generating it. For fine-grained tokens, an organization admin may need to approve the token before it works.

#### Troubleshooting

| Status bar / error | Cause | Fix |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | Token expired, was revoked, or was pasted incorrectly | Generate and save a new token |
| `Access denied … (token scope?)` | Token is read-only (`read_api` on GitLab, or *Read-only* Issues/PRs on GitHub), project role is below Developer/Triage, or SSO is not authorized | Recreate the token with write permissions, check your project role, or authorize SSO |
| `$(circle-slash) #142: not found` | Issue `#142` does not exist, or a fine-grained GitHub token has no access to this private repository | Check the issue number or add the repository under the token's *Repository access* |
| Issue loads, but open PRs are missing | Fine-grained GitHub token is missing **Pull requests: Read** | Enable *Pull requests: Read and write* on the token |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-configuration"></a>

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `"auto"` \| `"gitlab"` \| `"github"`. `"auto"` detects the platform from the remote hostname. Set explicitly for custom self-hosted domains. |
| `gitPilot.instanceUrl` | `""` | User-level setting. Base URL override for self-hosted GitLab or GitHub Enterprise (e.g. `https://gitlab.company.com`; subpath installs like `https://host/gitlab` are supported). |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Regular expression used to extract the issue number from the branch name (uses the **first capturing group**). |
| `gitPilot.labelSync.showStatusBar` | `true` | Show the Issue / MR status item in the VS Code status bar. |
| `gitPilot.labelSync.labelPrefix` | `"status:"` | Prefix for status labels (`"status:"` or `"status::"`). Both `:` and `::` variants are matched when replacing a status. |
| `gitPilot.labelSync.refreshInterval` | `120` | Background read-only refresh interval in seconds while the window is focused (`0` disables polling; minimum `10`). |
| `gitPilot.labels.groups` | `[]` | Glob masks for grouping labels in display order, e.g. `["status:*", "app:*"]` (`*` matches any characters, `?` matches one, `:` also matches `::`). Leave empty to group automatically by prefix before `:` / `::`. |
| `gitPilot.comments.compose` | `"quick"` | `"quick"`: **Add comment…** opens a one-line input box (Enter posts; a button moves the text to an editor). `"editor"`: always open a Markdown draft tab. |
| `gitPilot.comments.pageSize` | `10` | Number of comments loaded per page in the **Comments** section (`1–50`). On GitLab this count is approximate because system notes are filtered out after fetching. |
| `gitPilot.allowInsecureHttp` | `false` | User-level setting only. Allows sending API requests over plain `http://` when `instanceUrl` explicitly uses `http://`. |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-commands"></a>

### Commands & Logs

| Command | Command ID |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Change Status… | `gitPilot.labelSync.selectStatus` |
| Git Pilot: Add Labels… | `gitPilot.labelSync.addLabel` |
| Git Pilot: Labels: Sync from MR / PR… | `gitPilot.labelSync.syncFromMr` |
| Git Pilot: Labels: Refresh | `gitPilot.labelSync.refresh` |
| Git Pilot: Comments: Add Comment… | `gitPilot.comments.add` |
| Git Pilot: Comments: Send Comment *(active draft editor)* | `gitPilot.comments.send` |
| Git Pilot: Comments: Refresh | `gitPilot.comments.refresh` |
| Git Pilot: Select Repository… | `gitPilot.selectRepository` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |

Logs are written to **Output → Git Pilot**. Switch the log level to **Trace** to inspect HTTP requests (tokens are never logged).

For build instructions and architecture details, see [CONTRIBUTING.md](CONTRIBUTING.md).

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-security"></a>

### Security

Because a cloned repository controls its own remote URLs, branch names, and `.vscode/settings.json`, Git Pilot enforces strict boundaries around tokens and network calls:

- **Workspace Trust required** — the extension does not activate in Restricted Mode (`untrustedWorkspaces.supported: false`).
- **Host-pinned tokens & HTTPS by default** — tokens are kept in private class fields in memory and sent only to the API origin they were stored for. Cross-origin redirects are rejected, and `github.com` / `gitlab.com` are pinned to their canonical platforms and API hosts. Both `gitPilot.instanceUrl` and `gitPilot.allowInsecureHttp` are `machine`-scoped, so workspace settings cannot redirect API traffic or downgrade HTTPS.
- **Redacted logs** — tokens and embedded URL credentials (`user:token@`) are stripped before any URL is written to the Output channel.
- **Same-project boundary** — MRs/PRs from external forks or other projects that reference your issue are ignored, and all writes target only the active project.
- **Untrusted server content** — comment bodies are opened as read-only plain text rather than rendered HTML, external links are validated against your instance host, and comments or label changes are sent only on explicit user actions.

<sub>[↑ Contents](#en) · [Русский](#ru) · [↑ Top](#top)</sub>

---

<a id="ru"></a>

## Русский

**Содержание:**
[О расширении](#ru-overview) ·
[Быстрый старт](#ru-quick-start) ·
[Боковая панель и статус-бар](#ru-sidebar) ·
[Синхронизация и группы меток](#ru-status-sync) ·
[Токен и права доступа](#ru-authentication) ·
[Настройки](#ru-configuration) ·
[Команды и логи](#ru-commands) ·
[Безопасность](#ru-security)

<a id="ru-overview"></a>

### О расширении

**Git Pilot** связывает текущую git-ветку в VS Code с задачей (**Issue**) и открытыми **Merge Request / Pull Request** в **GitLab (CE/EE)** и **GitHub (включая Enterprise)**.

Не нужно лишний раз переключаться в браузер, чтобы передвинуть задачу по доске, прочитать обсуждение или сверить метки между Issue и MR/PR:

- **Привязка к ветке** — определяет номер задачи из имени ветки (`142-fix-auth`, `feat/142-login` → `#142`) и находит связанные открытые MR/PR в том же проекте.
- **Смена статуса в один клик** — обновляет статусную метку (`status:*`) сразу на задаче и всех её открытых MR/PR.
- **Взаимоисключающие группы меток (scoped labels)** — группы вроде `status:*` или `app:*` работают по принципу scoped labels из GitLab Premium в том числе на GitHub и в бесплатном GitLab CE.
- **Синхронизация с MR/PR по подтверждению** — подсвечивает расхождения меток между задачей и MR/PR и показывает точный список изменений перед применением.
- **Каталог меток проекта** — отображает все метки репозитория с группировкой по префиксам или маскам, показывает, где они уже стоят, и позволяет добавлять или снимать их на месте.
- **Комментарии к задаче и MR/PR** — показывает переписку по задаче и MR/PR (сначала новые, без системных уведомлений о смене меток и коммитах) и позволяет отвечать прямо из VS Code.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-quick-start"></a>

### Быстрый старт

1. **Переключитесь на ветку с номером задачи**
   По умолчанию номер ищется в начале имени ветки либо после `/` или `-` (например, `142-fix-auth` или `feat/142-login`). Свой формат можно задать в `gitPilot.branchIssueRegex`.
2. **Добавьте токен доступа (PAT)**
   Нажмите `$(key) Git Pilot: Set Token` в статус-баре (или вызовите команду **Git Pilot: Set Personal Access Token**). В поле ввода есть кнопка, открывающая страницу выпуска токена в браузере с нужными правами.
3. **Работайте со статусом, метками и комментариями**
   Используйте индикатор в статус-баре или панель **Git Pilot** в Activity Bar, чтобы менять статус, править метки, синхронизировать задачу с MR/PR и читать или писать комментарии.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-sidebar"></a>

### Боковая панель и статус-бар

#### Раздел Labels

Показывает задачу текущей ветки, её открытые MR/PR, их метки и общий каталог меток проекта:

```text
LABELS · #3                                         [🏷] [+] [⇅] [⟳]
 ▸ ⚠ Labels differ   from MR !5 · 14:30:00               [⇅] [🏷]
 ▾ Issue #3   Add a sidebar                              [+] [↗]
     status: doing   status                              [🏷]
     app:web         not on MR !5                    [→] [⇄] [✕]
     bug             not on MR !5                    [→]     [✕]
 ▾ MR !5   Draft: sidebar                                [+] [↗]
     status: doing   status                              [🏷]
     app:api         not on Issue                    [→] [⇄] [✕]
 ▸ All labels (12)
```

- **Строка-сводка** — когда метки совпадают, отображает текущий статус (*Status: doing — in sync*), а по клику открывает выбор нового статуса. Если метки задачи и MR/PR разошлись, сводка разворачивается в список отличий (`+`/`−`), а клик по ней открывает диалог **Sync from MR/PR…**.
- **Действия на строках:**
  - `🏷` **Change Status…** — сменить статус задачи и всех её открытых MR/PR.
  - `+` **Add Labels…** — на строке задачи или MR добавляет метки к этому элементу; из заголовка раздела предлагает выбрать, куда их добавить (на задачу, конкретный MR/PR или везде сразу).
  - `→` **Add Label Where Missing** — копирует метку на остальные элементы текущей ветки, где её ещё нет.
  - `⇄` **Replace Label…** — меняет групповую метку (например, `app:web`) на другую из той же группы (`app:api`).
  - `✕` **Remove Label** — снимает метку с задачи или MR/PR (в уведомлении есть кнопка **Undo**).
  - `↗` **Open in Browser** — открывает задачу или MR/PR в браузере.
- **All labels** — каталог всех меток проекта (в GitLab — включая метки родительских групп). Подгружается при первом раскрытии и обновляется кнопкой **Refresh**:
  - Метки группируются по префиксу до `:` / `::` (`status:*`, `app:*`) либо по маскам из `gitPilot.labels.groups`. Метки без префикса попадают в **Other**.
  - Уже применённые к текущей ветке метки отмечены галочкой `✓` с подписью, где они стоят (*Issue · MR !5*).
  - Кнопками на строке можно добавить (`+`) или снять (`✕`) метку, применить статус (`✓`) из группы `status:*`, а через контекстное меню — скопировать имя метки.

#### Раздел Comments

Показывает комментарии к задаче текущей ветки и её открытым MR/PR, **начиная с новых**:

```text
COMMENTS · #3                                              [💬] [⟳]
 ▾ Issue #3   Add a sidebar                                  [💬] [↗]
     💬 Add comment…
     @alice   2 h ago · Checked on staging, works
     @bob     yesterday · [media] reproduces on Safari          [↗]
     ⌄ Show more…                                       10 older
 ▸ MR !5   Draft: sidebar                                    [💬] [↗]
```

- **Без системного шума** — автоматические записи (смена меток, веса, исполнителя, упоминания в коммитах и т. п.) скрыты. В GitHub показывается общая лента PR без построчных комментариев к коду.
- **Постраничная подгрузка** — комментарии загружаются при раскрытии узла задачи или MR/PR; **Show more…** догружает более старые записи (`gitPilot.comments.pageSize`, по умолчанию `10`).
- **Чтение и вложения** — по клику комментарий открывается целиком в отдельной вкладке только для чтения. Картинки и видео внутри VS Code не подгружаются: такие комментарии помечаются значком `🖼`, а по кнопке `↗` **Open in Browser** можно сразу перейти к нужному комментарию (`#note_…` / `#issuecomment-…`) в браузере.
- **Отправка комментариев** — `💬` **Add comment…** открывает строку быстрого ввода (отправка по **Enter**). Если нужно написать развёрнутый комментарий в Markdown, нажмите кнопку `✎` в поле ввода (или переключите `gitPilot.comments.compose` в `"editor"`): откроется вкладка-черновик, откуда комментарий отправляется по **Ctrl+Enter** (`⌘+Enter` на macOS) или кнопкой **Send** в заголовке вкладки. При ошибке отправки кнопка **Continue in Draft** сохранит набранный текст в черновике.

#### Работа с несколькими репозиториями

Если в окне открыто несколько git-репозиториев (multi-root workspace или вложенные репозитории), боковая панель переключается вслед за файлом в активном редакторе. Чтобы зафиксировать один репозиторий независимо от того, какой файл сейчас открыт, вызовите **Git Pilot: Select Repository…** (также доступно в меню `…` каждого раздела) и закрепите его. Пункт **Follow the active editor** возвращает автоматическое переключение.

Когда открыто несколько репозиториев или один из них закреплён, его имя отображается в заголовках разделов (например, `#3 · backend (pinned)`).

#### Строка состояния (Status Bar)

| Состояние | Вид в статус-баре | Действие по клику |
| --- | --- | --- |
| Не задан токен | `$(key) Git Pilot: Set Token` | Ввод токена |
| Загрузка | `$(sync~spin) Git Pilot: #142...` | — |
| Статусы совпадают | `$(tag) #142: qa-passed (MR !89)` *(значок `$(diff)`, если отличаются обычные метки)* | Выбор статуса и быстрые действия |
| Статусы расходятся | `$(warning) #142: todo ≠ MR !89: qa-passed` | Диалог синхронизации **Sync Labels from MR / PR…** |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-status-sync"></a>

### Синхронизация и группы меток

#### Поиск MR/PR и синхронизация

1. **Как находятся связанные MR/PR (только внутри текущего проекта):**
   - **GitLab:** связанные с задачей открытые MR (`related_merge_requests`) плюс открытые MR, созданные из текущей ветки.
   - **GitHub:** открытые PR из текущей ветки плюс открытые PR, закрывающие задачу (`closedByPullRequestsReferences`).
2. **Источник при сравнении:** самый свежий по времени обновления открытый MR/PR со статусной меткой (если статуса нет ни на одном — последний обновлённый открытый MR/PR).
3. **Синхронизация по подтверждению (`Sync Labels from MR / PR…`):**
   В фоне метки никогда не перезаписываются. При запуске синхронизации расширение запрашивает актуальное состояние и показывает диалог с перечнем изменений:
   - **Sync Statuses** — переносит с эталонного MR/PR только метку статуса.
   - **Sync All Labels** — приводит все метки задачи и остальных открытых MR/PR в точное соответствие с эталонным MR/PR (лишние метки снимаются).

#### Взаимоисключающие группы меток

В GitLab Premium есть *scoped labels* (`status::doing`): при добавлении новой метки с тем же префиксом старая снимается автоматически. Git Pilot реализует такое же поведение для **GitHub**, **GitLab CE** и обычных меток с одинарным двоеточием:

- **Статусы:** выбор `status: review` снимает прежнюю метку `status:*` / `status::*`, не затрагивая остальные.
- **Группы меток:** метки с общим префиксом (`app:web`, `app:api`) или совпадающие с одной маской в `gitPilot.labels.groups` заменяют друг друга. Метки без префикса из группы **Other** (`bug`, `urgent`) можно сочетать свободно.
- **Точечная запись изменений:** перед сохранением Git Pilot заново читает текущие метки и отправляет только разницу (`add_labels` / `remove_labels` в GitLab, `POST` / `DELETE` в GitHub), чтобы не затереть одновременные правки коллег.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-authentication"></a>

### Токен и права доступа

Команда **Git Pilot: Set Personal Access Token** сохраняет токен для выбранного хоста в системном хранилище через `SecretStorage` VS Code (Keychain в macOS, Credential Manager в Windows, GNOME Keyring / KWallet в Linux). В файлы настроек токен не записывается. Чтобы удалить токен, вызовите команду и отправьте пустое значение.

| Платформа | Тип токена | Нужные права (scopes) | Минимальная роль в проекте |
| --- | --- | --- | --- |
| **GitLab** | Personal, Project или Group Access Token | **`api`** *(`read_api` даёт доступ только на чтение)* | **Developer** *(Reporter может менять метки у Issue, но не у MR)* |
| **GitHub** | Fine-grained PAT *(рекомендуется)* | Права на репозиторий: **Issues: Read and write**, **Pull requests: Read and write** | **Triage** или выше |
| **GitHub** | Classic PAT | **`repo`** *(или **`public_repo`** только для публичных репозиториев)* | **Triage** или выше |

> **Для организаций на GitHub:** если в организации включён SAML SSO, после создания классического токена нажмите рядом с ним **Configure SSO → Authorize**. Для fine-grained токенов может потребоваться одобрение администратора организации.

#### Частые проблемы с доступом

| Сообщение в статус-баре | Причина | Решение |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | Срок действия токена истёк, токен отозван или скопирован с ошибкой | Выпустите и сохраните новый токен |
| `Access denied … (token scope?)` | Выдан токен только на чтение (`read_api` в GitLab или *Read-only* в GitHub), недостаточная роль в проекте либо не авторизован SSO | Перевыпустите токен с правами на запись, проверьте роль в проекте или авторизуйте SSO |
| `$(circle-slash) #142: not found` | Задачи `#142` нет в проекте, либо fine-grained токену GitHub не выдан доступ к этому приватному репозиторию | Проверьте номер задачи или добавьте репозиторий в *Repository access* настроек токена |
| Задача видна, но открытый PR не отображается | У fine-grained токена GitHub не включено право **Pull requests: Read** | Включите *Pull requests: Read and write* в настройках токена |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-configuration"></a>

### Настройки

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `"auto"` \| `"gitlab"` \| `"github"`. В режиме `"auto"` платформа определяется по домену remote. Для self-hosted серверов с нестандартным доменом укажите явно. |
| `gitPilot.instanceUrl` | `""` | Настройка уровня пользователя. Базовый URL для собственного инстанса GitLab или GitHub Enterprise (например, `https://gitlab.company.com`; поддерживаются подпути вроде `https://host/gitlab`). |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Регулярное выражение для извлечения номера задачи из имени ветки (берётся **первая группа захвата**). |
| `gitPilot.labelSync.showStatusBar` | `true` | Показывать индикатор задачи и MR/PR в строке состояния VS Code. |
| `gitPilot.labelSync.labelPrefix` | `"status:"` | Префикс статусных меток (`"status:"` или `"status::"`). При замене статуса учитываются оба варианта (`:` и `::`). |
| `gitPilot.labelSync.refreshInterval` | `120` | Интервал фонового обновления данных в секундах при активном окне VS Code (`0` отключает опрос; минимум `10`). |
| `gitPilot.labels.groups` | `[]` | Маски группировки меток в порядке отображения, например `["status:*", "app:*"]` (`*` — любые символы, `?` — один символ, `:` совпадает и с `::`). Если не задано, метки группируются по префиксу до `:` / `::`. |
| `gitPilot.comments.compose` | `"quick"` | `"quick"`: **Add comment…** открывает строку ввода (Enter отправляет; кнопка переносит текст в редактор). `"editor"`: сразу открывать вкладку-черновик в Markdown. |
| `gitPilot.comments.pageSize` | `10` | Количество комментариев, подгружаемых за раз в разделе **Comments** (`1–50`). В GitLab число приблизительное, так как системные записи отсеиваются после получения страницы. |
| `gitPilot.allowInsecureHttp` | `false` | Настройка уровня пользователя. Разрешает запросы по незашифрованному `http://`, если в `instanceUrl` явно указан `http://`. |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-commands"></a>

### Команды и логи

| Команда | ID команды |
| --- | --- |
| Git Pilot: Set Personal Access Token | `gitPilot.setToken` |
| Git Pilot: Change Status… | `gitPilot.labelSync.selectStatus` |
| Git Pilot: Add Labels… | `gitPilot.labelSync.addLabel` |
| Git Pilot: Labels: Sync from MR / PR… | `gitPilot.labelSync.syncFromMr` |
| Git Pilot: Labels: Refresh | `gitPilot.labelSync.refresh` |
| Git Pilot: Comments: Add Comment… | `gitPilot.comments.add` |
| Git Pilot: Comments: Send Comment *(при активном черновике)* | `gitPilot.comments.send` |
| Git Pilot: Comments: Refresh | `gitPilot.comments.refresh` |
| Git Pilot: Select Repository… | `gitPilot.selectRepository` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |

Логи пишутся в панель **Output → Git Pilot**. Для просмотра HTTP-запросов переключите уровень логирования на **Trace** (токены в лог не попадают).

Сборка из исходников и архитектура описаны в [CONTRIBUTING.md](CONTRIBUTING.md).

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-security"></a>

### Безопасность

Клонированный репозиторий может содержать произвольные remote URL, имена веток и локальный `.vscode/settings.json`, поэтому работа с токенами и сетью строго ограничена:

- **Только доверенные рабочие области (Workspace Trust)** — в ограниченном режиме (Restricted Mode) расширение не запускается (`untrustedWorkspaces.supported: false`).
- **Привязка токена к хосту и HTTPS по умолчанию** — в памяти токен хранится в приватном поле класса и отправляется только на тот API-хост, для которого был сохранён. Междоменные редиректы отклоняются, а для `github.com` и `gitlab.com` жёстко заданы платформа и адрес API. Настройки `gitPilot.instanceUrl` и `gitPilot.allowInsecureHttp` имеют область видимости `machine`, поэтому `.vscode/settings.json` внутри репозитория не может перенаправить запросы или включить HTTP.
- **Очистка логов** — токены и учётные данные в URL (`user:token@`) маскируются перед записью в канал `Output`.
- **Границы проекта** — чужие MR/PR из других проектов, просто упомянувшие вашу задачу, игнорируются, а любые изменения записываются только в текущий проект.
- **Недоверенные данные с сервера** — комментарии открываются как обычный текст только для чтения (без рендеринга HTML), внешние ссылки проверяются на принадлежность хосту инстанса, а отправка комментариев и изменение меток выполняются только по явному действию пользователя.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
