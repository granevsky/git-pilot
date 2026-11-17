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

**Git Pilot** connects your active Git branch in VS Code to its **Issue** and open **Merge Requests / Pull Requests** on **GitLab (CE/EE)** and **GitHub (including Enterprise)**.

Instead of switching to the browser to move a task across the board or fix mismatched labels between an Issue and its MR/PR, you can view and update them right from the sidebar or status bar:

- **Automatic branch linking** — detects the issue number from the current branch name (`142-fix-auth`, `feat/142-login` → `#142`) and finds related open MRs/PRs in the same project.
- **One-click status updates** — updates the `status:*` label on the Issue and all its open MRs/PRs at once.
- **Scoped labels on any platform** — enforces mutually exclusive label groups (`status:*`, `app:*`, etc.) on GitHub and GitLab Free just like GitLab Premium's `::` scoped labels.
- **Controlled sync from MR/PR** — highlights when an Issue and its MR/PR go out of sync and lets you preview and apply the exact label diff with confirmation.
- **Project label catalog** — browse all project labels grouped by prefix or custom masks, see where each label is applied, and attach or remove them in place.
- **Comments** — read the human comments of the Issue and its MRs/PRs (newest first, without automatic system notes) and post new ones without leaving the editor.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-quick-start"></a>

### Quick Start

1. **Open a repository on an issue branch**
   By default, Git Pilot looks for the issue number at the start of the branch name or after `/` or `-` (for example, `142-fix-auth` or `feat/142-login`). You can customize this pattern with `gitPilot.branchIssueRegex`.
2. **Add your Personal Access Token**
   Click `$(key) Git Pilot: Set Token` in the status bar (or run **Git Pilot: Set Personal Access Token** from the Command Palette). Paste a token for your GitLab or GitHub host — the input box has a button to open the token creation page in your browser.
3. **Manage status and labels**
   Use the status bar item or open the **Git Pilot** icon in the Activity Bar to change the status, edit labels on the Issue or MR/PR, or sync labels when they differ.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-sidebar"></a>

### Sidebar & Status Bar

#### Labels section

Shows the Issue for the current branch, its open MRs/PRs, their labels, and the whole label catalog of the project:

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

- **Summary row** — shows the current status when everything matches (*Status: doing — in sync*; click to pick another status). When labels differ between the Issue and the MR/PR, it turns into a collapsible warning showing the exact `+`/`−` diff per item; clicking it opens the **Sync from MR/PR…** confirmation dialog.
- **Inline label actions:**
  - `🏷` **Change Status…** — pick a new status for the Issue and all open MRs/PRs.
  - `+` **Add Labels…** — on an Issue/MR row, adds labels to that item; from the section toolbar, asks whether to apply them to the Issue, a specific MR/PR, or everywhere.
  - `→` **Add Label Where Missing** — copies the label to the other items on this branch that don't have it yet.
  - `⇄` **Replace Label…** — swaps a grouped label (e.g. `app:web`) for another label from the same group (`app:api`).
  - `✕` **Remove Label** — detaches the label from that Issue or MR/PR (with an **Undo** button in the notification).
  - `↗` **Open in Browser** — opens the Issue or MR/PR in your browser.
- **All labels** — a collapsed node with the catalog of all labels in the project (on GitLab, including labels inherited from parent groups). It is loaded the first time you expand it, and reloaded by the **Refresh** button.

##### All labels

- Labels are grouped automatically by the prefix before `:` or `::` (`status:*`, `app:*`), or by custom glob masks in `gitPilot.labels.groups`. Labels without a prefix go into **Other**.
- Labels currently applied to the branch's Issue or MRs/PRs are marked with `✓` and show where they are used (*Issue · MR !5*).
- Hover over any label to `+` add it, `✕` remove it (with **Undo**), apply a status with `✓`, or copy the label name from its context menu.
- Status labels live in the `status:*` group — click `✓` on one to apply it to the Issue and all open MRs/PRs.

#### Several repositories

When a window has several git repositories (multi-root workspace or nested repos), the sections follow the repository of the file you are editing, so opening a file of an unrelated repository switches them to that repository's branch. To stay on one repository whatever file is open, run **Git Pilot: Select Repository…** (also in the `…` menu of each section) and pin it; choose **Follow the active editor** to go back. The pin is remembered per workspace. With several repositories open (or one pinned), the section headers and empty-state messages name the repository, e.g. `#5 · NAS_back (pinned)`, and empty sections offer a **Select repository…** shortcut.

#### Comments section

Shows the comments of the Issue for the current branch and of each of its open MRs/PRs, **newest first**:

```text
COMMENTS · #3                                              [💬] [⟳]
 ▾ Issue #3   Add a sidebar                                  [💬] [↗]
     💬 Add comment…
     @alice   2 h ago · Checked on staging, works
     @bob     yesterday · [media] reproduces on Safari          [↗]
     ⌄ Show more…                                       10 older
 ▸ MR !5   Draft: sidebar                                    [💬] [↗]
```

- **Only real comments** — automatic entries (label, weight, assignee or milestone changes, "mentioned in commit", …) are filtered out. On GitHub only the PR conversation is shown, not code-review comments.
- **Lazy and paged** — comments of an Issue/MR/PR are loaded when you expand its node; **Show more…** loads the next, older page (`gitPilot.comments.pageSize`, default 10). The **Refresh** button reloads the expanded nodes. The list of Issue/MRs itself follows the **Labels** section.
- **Reading** — click a comment to open its full text in a read-only editor tab (plain text, never rendered as HTML).
- **Images and videos** are not displayed in VS Code. A comment that embeds media gets a `🖼` icon; use `↗` **Open in Browser** on the comment to jump straight to it (`#note_…` / `#issuecomment-…`) on the web page, where attachments open with your normal browser session.
- **Writing** — `💬` **Add comment…** (first row under every Issue/MR/PR) opens a one-line input box: type and press **Enter** to post. The `✎` button in the box moves your text into a Markdown draft in an editor for longer, multi-line comments; there, press **Ctrl+Enter** (⌘+Enter on macOS) or the **Send** button in the editor title. If posting fails, the error offers **Continue in Draft** so nothing you typed is lost. Set `gitPilot.comments.compose` to `"editor"` to always start with a draft. Nothing is ever posted without you pressing Enter / Send. Posting needs write access (see [Authentication & Permissions](#en-authentication)).

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

1. **Finding linked MRs/PRs (same project only):**
   - **GitLab:** open MRs linked to the issue (`related_merge_requests`) plus open MRs whose source branch is the current branch.
   - **GitHub:** open PRs from the current branch plus open PRs linked as closing the issue (`closedByPullRequestsReferences`).
2. **Source of truth:** the most recently updated open MR/PR that has a status label (or, if none has a status label, the most recently updated open MR/PR).
3. **Confirmed sync (`Sync Labels from MR / PR…`):**
   Git Pilot never overwrites labels silently in the background. When you trigger a sync, it fetches fresh state and shows a confirmation dialog listing every addition and removal with two choices:
   - **Sync Statuses** — copies only the MR/PR's status label to the Issue and any other open MRs/PRs.
   - **Sync All Labels** — makes the full label set on the Issue and other open MRs/PRs match the source MR/PR (including removing labels not present on that MR/PR).

#### Scoped / mutually exclusive label groups

GitLab Premium supports scoped labels (`status::doing`), where applying a new label with the same prefix automatically removes the old one. Git Pilot brings this behavior to **GitHub**, **GitLab CE**, and regular `prefix:value` labels:

- **Statuses:** applying `status: review` removes any existing `status:*` / `status::*` label while leaving unrelated labels untouched.
- **Label groups:** labels sharing a prefix (`app:web`, `app:api`) or matching the same mask in `gitPilot.labels.groups` are mutually exclusive on an Issue/MR. Unprefixed labels in **Other** (`bug`, `urgent`) can be combined freely.
- **Safe concurrent edits:** before every write, Git Pilot re-reads the current labels and sends only the minimal add/remove diff (`add_labels` / `remove_labels` on GitLab, `POST` / `DELETE` on GitHub), so changes made by teammates at the same time aren't lost. Only existing project labels are offered and applied.

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-authentication"></a>

### Authentication & Permissions

Run **Git Pilot: Set Personal Access Token** to save a token for your GitLab or GitHub host. Tokens are stored per host in VS Code's `SecretStorage` (backed by the macOS Keychain, Windows Credential Manager, or Linux Secret Service keyring) and are never written to settings files. To delete a saved token, run the command and submit an empty value.

| Platform | Token type | Required permissions / scopes | Minimum project role |
| --- | --- | --- | --- |
| **GitLab** | Personal, Project, or Group Access Token | Scope: **`api`** *(`read_api` is read-only and cannot update labels)* | **Developer** *(Reporter can edit issue labels, but not MRs)* |
| **GitHub** | Fine-grained PAT *(recommended)* | Repository permissions: **Issues: Read and write**, **Pull requests: Read and write** | **Triage** or higher |
| **GitHub** | Classic PAT | Scope: **`repo`** *(or **`public_repo`** for public repos only)* | **Triage** or higher |

> **Note for GitHub Organizations:** If your organization uses SAML SSO with a classic token, click **Configure SSO → Authorize** next to the token on GitHub after generating it. For fine-grained tokens, an organization admin may need to approve the token before API calls succeed.

#### Troubleshooting

| Status bar / error | Cause | Fix |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | Token expired, was revoked, or was pasted incorrectly | Generate and save a new token |
| `Access denied … (token scope?)` | Token is read-only (`read_api` on GitLab, or *Read-only* Issues/PRs on GitHub), role is below Developer/Triage, or SSO is not authorized | Recreate the token with write scopes, check your project role, or authorize SSO |
| `$(circle-slash) #142: not found` | Issue `#142` does not exist, or a fine-grained GitHub token does not have access to this private repository | Verify the issue number or add the repository under the token's *Repository access* |
| Issue loads, but open PRs are missing | Fine-grained GitHub token is missing **Pull requests: Read** | Enable *Pull requests: Read and write* on the token |

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-configuration"></a>

### Configuration

| Setting | Default | Description |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `"auto"` \| `"gitlab"` \| `"github"`. `"auto"` detects the platform from the remote hostname. Set explicitly for custom self-hosted domains. |
| `gitPilot.instanceUrl` | `""` | User-level setting. Base URL override for self-hosted GitLab or GitHub Enterprise (e.g. `https://gitlab.company.com`, subpath instances like `https://host/gitlab` are supported). |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Regular expression used to extract the issue number from the branch name (uses the **first capturing group**). |
| `gitPilot.labelSync.showStatusBar` | `true` | Show the Issue / MR status item in the VS Code status bar. |
| `gitPilot.labelSync.labelPrefix` | `"status:"` | Prefix for status labels (`"status:"` or `"status::"`). Both `:` and `::` variants are matched when replacing a status. |
| `gitPilot.labelSync.refreshInterval` | `120` | Background read-only refresh interval in seconds while the window is focused (`0` disables polling; minimum `10`). |
| `gitPilot.labels.groups` | `[]` | Glob masks for grouping labels in display order, e.g. `["status:*", "app:*"]` (`*` matches any characters, `?` matches one, `:` also matches `::`). Leave empty to group automatically by prefix before `:` / `::`. |
| `gitPilot.comments.compose` | `"quick"` | `"quick"`: **Add comment…** opens a one-line input box (Enter posts; a button moves the text to an editor). `"editor"`: always start with a Markdown draft. |
| `gitPilot.comments.pageSize` | `10` | Comments loaded per page in the **Comments** section (1–50). On GitLab the number is approximate, because system notes are skipped after loading. |
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
| Git Pilot: Comments: Send Comment *(while a draft is open)* | `gitPilot.comments.send` |
| Git Pilot: Comments: Refresh | `gitPilot.comments.refresh` |
| Git Pilot: Select Repository… | `gitPilot.selectRepository` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |

Logs are written to **Output → Git Pilot**. Switch the log level to **Trace** to inspect API requests (tokens are never logged).

For build instructions and architecture overview, see [CONTRIBUTING.md](CONTRIBUTING.md).

<sub>[↑ Contents](#en) · [Русский](#ru)</sub>

<a id="en-security"></a>

### Security

Because a cloned repository controls its own remote URLs, branch names, and `.vscode/settings.json`, Git Pilot enforces strict boundaries around your token and API calls:

- **Workspace Trust required** — the extension is disabled in Restricted Mode (`untrustedWorkspaces.supported: false`).
- **Host-pinned tokens & HTTPS by default** — a token is kept in an isolated private field in memory and sent only to the exact API origin it was saved for; cross-origin redirects are blocked, and `github.com` / `gitlab.com` are pinned to their canonical platforms and API origins. Both `gitPilot.instanceUrl` and `gitPilot.allowInsecureHttp` are user-scoped (`machine`) settings, so a repository's `.vscode/settings.json` cannot redirect API requests or downgrade HTTPS.
- **No credential leaks in logs** — tokens and embedded URL credentials (`user:token@`) are automatically redacted before any URL reaches the Output channel.
- **Same-project scope** — MRs/PRs from external forks or other projects that mention your issue are ignored, and label writes target only the current repository.
- **Comments are untrusted text** — comment bodies are shown as plain text only (never rendered as HTML or trusted Markdown), links to comments must point to your instance's web host, and a comment is posted only when you press Send in a draft you opened yourself.

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

Расширение избавляет от необходимости переключаться в браузер, чтобы передвинуть задачу по доске, поправить метки или проверить, не разъехался ли статус между Issue и MR/PR:

- **Привязка к ветке** — автоматически достаёт номер задачи из имени ветки (`142-fix-auth`, `feat/142-login` → `#142`) и находит связанные открытые MR/PR в том же проекте.
- **Смена статуса в один клик** — обновляет статусную метку (`status:*`) сразу на задаче и всех её открытых MR/PR.
- **Взаимоисключающие метки (scoped labels) везде** — группы вроде `status:*` или `app:*` работают как scoped labels из GitLab Premium даже в GitHub и бесплатном GitLab CE.
- **Наглядная синхронизация с MR/PR** — подсвечивает расхождения меток между задачей и MR/PR и позволяет синхронизировать их после предпросмотра изменений.
- **Каталог меток проекта** — показывает все метки репозитория (с группировкой по префиксам или своим маскам), отмечает уже применённые к текущей ветке и позволяет быстро добавлять или снимать их.
- **Комментарии** — читайте комментарии людей к задаче и её MR/PR (сначала новые, без автоматических системных записей) и оставляйте свои, не выходя из редактора.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-quick-start"></a>

### Быстрый старт

1. **Переключитесь на ветку с номером задачи**
   По умолчанию номер ищется в начале имени ветки либо после `/` или `-` (например, `142-fix-auth` или `feat/142-login`). Шаблон можно поменять в настройке `gitPilot.branchIssueRegex`.
2. **Укажите токен доступа (PAT)**
   Нажмите `$(key) Git Pilot: Set Token` в строке состояния (или вызовите команду **Git Pilot: Set Personal Access Token**). В окне ввода есть кнопка, которая сразу откроет страницу создания токена в браузере с нужными правами.
3. **Управляйте статусом и метками**
   Кликните по индикатору в статус-баре или откройте иконку **Git Pilot** на боковой панели, чтобы сменить статус, добавить метки или синхронизировать задачу с MR/PR.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-sidebar"></a>

### Боковая панель и статус-бар

#### Раздел Labels

Показывает задачу текущей ветки, её открытые MR/PR, список меток на каждом элементе и весь каталог меток проекта:

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

- **Строка-сводка** — когда метки совпадают, показывает текущий статус (*Status: doing — in sync*), а по клику открывает выбор нового статуса. Если метки задачи и MR/PR отличаются, сводка превращается в раскрывающийся список с точным перечнем отличий (`+`/`−`), а клик по ней открывает окно подтверждения синхронизации **Sync from MR/PR…**.
- **Быстрые кнопки на строках:**
  - `🏷` **Change Status…** — выбрать новый статус сразу для задачи и всех открытых MR/PR.
  - `+` **Add Labels…** — на строке задачи или MR добавляет метки к этому элементу; при нажатии в заголовке панели сначала спрашивает, куда применить (к задаче, конкретному MR/PR или ко всем сразу).
  - `→` **Add Label Where Missing** — проставляет эту метку на остальные элементы текущей ветки, где её ещё нет.
  - `⇄` **Replace Label…** — заменяет групповую метку (например, `app:web`) на другую из той же группы (`app:api`).
  - `✕` **Remove Label** — снимает метку с выбранной задачи или MR/PR (в уведомлении появляется кнопка **Undo** для отмены).
  - `↗` **Open in Browser** — открывает задачу или MR/PR в браузере.
- **All labels** — свёрнутый узел с каталогом всех меток проекта (в GitLab — включая метки родительских групп). Загружается при первом раскрытии и обновляется кнопкой **Refresh**.

##### All labels

- Метки автоматически группируются по префиксу до `:` или `::` (`status:*`, `app:*`) либо по вашим маскам из `gitPilot.labels.groups`. Метки без префикса попадают в группу **Other**.
- Метки, которые уже стоят на текущей задаче или её MR/PR, отмечаются галочкой `✓` с подписью, где именно они применены (*Issue · MR !5*).
- Кнопками на строке можно добавить (`+`) или снять (`✕`) метку, применить статус (`✓`) или скопировать название метки через контекстное меню.
- Статусные метки находятся в группе `status:*` — кнопка `✓` применяет статус к задаче и всем открытым MR/PR.

#### Несколько репозиториев

Если в окне открыто несколько git-репозиториев (multi-root workspace или вложенные репозитории), разделы следуют за репозиторием файла, который вы редактируете: открыли файл из постороннего репозитория — разделы переключились на его ветку. Чтобы остаться на одном репозитории при любом открытом файле, вызовите **Git Pilot: Select Repository…** (команда есть и в меню `…` каждого раздела) и закрепите нужный; пункт **Follow the active editor** возвращает прежнее поведение. Закрепление запоминается для рабочей области. Когда открыто несколько репозиториев (или один закреплён), заголовки разделов и сообщения о пустом состоянии называют репозиторий, например `#5 · NAS_back (pinned)`, а в пустых разделах появляется быстрая ссылка **Select repository…**.

#### Раздел Comments

Показывает комментарии к задаче текущей ветки и к каждому её открытому MR/PR, **сначала новые**:

```text
COMMENTS · #3                                              [💬] [⟳]
 ▾ Issue #3   Add a sidebar                                  [💬] [↗]
     💬 Add comment…
     @alice   2 h ago · Checked on staging, works
     @bob     yesterday · [media] reproduces on Safari          [↗]
     ⌄ Show more…                                       10 older
 ▸ MR !5   Draft: sidebar                                    [💬] [↗]
```

- **Только настоящие комментарии** — автоматические записи (смена меток, веса, исполнителя или milestone, «mentioned in commit» и т. п.) отфильтровываются. В GitHub показывается только обсуждение PR, без комментариев код-ревью.
- **Лениво и постранично** — комментарии задачи или MR/PR загружаются при раскрытии узла; **Show more…** подгружает следующую, более старую порцию (`gitPilot.comments.pageSize`, по умолчанию 10). Кнопка **Refresh** перезагружает раскрытые узлы. Сам список задачи и MR/PR берётся из раздела **Labels**.
- **Чтение** — клик по комментарию открывает его полный текст в редакторе только для чтения (простой текст, никогда не рендерится как HTML).
- **Изображения и видео** в VS Code не отображаются. У комментария со вложениями значок `🖼`; кнопка `↗` **Open in Browser** на комментарии открывает его на странице в браузере (`#note_…` / `#issuecomment-…`), где вложения открываются с вашей обычной сессией.
- **Написание** — `💬` **Add comment…** (первая строка под каждой задачей/MR/PR) открывает однострочное поле ввода: наберите текст и нажмите **Enter**, чтобы отправить. Кнопка `✎` в поле переносит текст в черновик в редакторе для длинных многострочных комментариев в Markdown; там отправка — **Ctrl+Enter** (⌘+Enter на macOS) или кнопка **Send** в заголовке редактора. Если отправка не удалась, в сообщении об ошибке есть кнопка **Continue in Draft**, так что набранный текст не пропадёт. Чтобы всегда начинать с черновика, задайте `gitPilot.comments.compose` = `"editor"`. Без вашего нажатия Enter / Send ничего не публикуется. Для отправки нужны права на запись (см. [Токен и права доступа](#ru-authentication)).

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
   - **GitHub:** открытые PR из текущей ветки плюс открытые PR, привязанные к задаче как закрывающие её (`closedByPullRequestsReferences`).
2. **Эталон при сравнении (Source of truth):** самый свежий (по времени обновления) открытый MR/PR со статусной меткой, а если статуса нет ни на одном — просто последний обновлённый открытый MR/PR.
3. **Подтверждение синхронизации (`Sync Labels from MR / PR…`):**
   Расширение ничего не меняет в фоне без вашего ведома. При вызове синхронизации Git Pilot заново запрашивает актуальные данные и показывает диалог со списком изменений и двумя вариантами:
   - **Sync Statuses** — переносит со связанного MR/PR только метку статуса, не трогая остальные метки.
   - **Sync All Labels** — приводит весь набор меток задачи и остальных открытых MR/PR в точное соответствие с эталонным MR/PR (включая снятие лишних меток).

#### Взаимоисключающие группы меток

В GitLab Premium есть *scoped labels* (`status::doing`): при добавлении новой метки с тем же префиксом старая снимается автоматически. В Git Pilot это работает и в **GitHub**, и в **GitLab CE**, и с обычным одинарным двоеточием:

- **Статусы:** выбор `status: review` снимает прежнюю метку `status:*` / `status::*`, сохраняя все остальные метки.
- **Группы меток:** метки с общим префиксом (`app:web`, `app:api`) или попавшие под одну маску в `gitPilot.labels.groups` заменяют друг друга в пределах одной группы. Метки без префикса из категории **Other** (`bug`, `urgent`) можно комбинировать в любом количестве.
- **Безопасная запись без перезатирания чужих правок:** перед сохранением Git Pilot перечитывает текущее состояние и отправляет только минимальную разницу (`add_labels` / `remove_labels` в GitLab, `POST` / `DELETE` в GitHub), поэтому параллельные изменения коллег не теряются. Применяются только те метки, которые уже существуют в проекте.

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-authentication"></a>

### Токен и права доступа

Команда **Git Pilot: Set Personal Access Token** сохраняет отдельный токен для каждого хоста в системном хранилище секретов через `SecretStorage` VS Code (Keychain в macOS, Диспетчер учётных данных в Windows, GNOME Keyring / KWallet в Linux). В файлы настроек токен никогда не попадает. Чтобы удалить сохранённый токен, вызовите команду и отправьте пустую строку.

| Платформа | Тип токена | Нужные права (scopes) | Минимальная роль в проекте |
| --- | --- | --- | --- |
| **GitLab** | Personal, Project или Group Access Token | **`api`** *(`read_api` работает только на чтение и не даёт менять метки)* | **Developer** *(роль Reporter позволяет менять метки только у Issue, но не у MR)* |
| **GitHub** | Fine-grained PAT *(рекомендуется)* | Права на репозиторий: **Issues: Read and write**, **Pull requests: Read and write** | **Triage** или выше |
| **GitHub** | Classic PAT | **`repo`** *(или **`public_repo`**, если работаете только с публичными репозиториями)* | **Triage** или выше |

> **Для организаций на GitHub:** если в организации используется SAML SSO, после выпуска классического токена нажмите напротив него **Configure SSO → Authorize**. Для fine-grained токенов может потребоваться подтверждение от администратора организации.

#### Частые проблемы с доступом

| Сообщение в статус-баре | Причина | Решение |
| --- | --- | --- |
| `$(key) Git Pilot: Token rejected` | Срок действия токена истёк, токен отозван или скопирован с ошибкой | Выпустите и сохраните новый токен |
| `Access denied … (token scope?)` | Выдан токен только на чтение (`read_api` в GitLab или *Read-only* в GitHub), не хватает роли в проекте либо не авторизован SSO | Перевыпустите токен с правами на запись, проверьте свою роль или авторизуйте SSO |
| `$(circle-slash) #142: not found` | Задачи `#142` нет в проекте, либо fine-grained токену GitHub не выдан доступ к этому приватному репозиторию | Проверьте номер задачи или добавьте репозиторий в *Repository access* настроек токена |
| Задача видна, но открытый PR не отображается | У fine-grained токена GitHub не включено право **Pull requests: Read** | Включите *Pull requests: Read and write* в настройках токена |

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-configuration"></a>

### Настройки

| Параметр | По умолчанию | Описание |
| --- | --- | --- |
| `gitPilot.provider` | `"auto"` | `"auto"` \| `"gitlab"` \| `"github"`. В режиме `"auto"` платформа определяется по домену remote. Для корпоративных серверов с нестандартным доменом укажите явно. |
| `gitPilot.instanceUrl` | `""` | Только на уровне настроек пользователя. Базовый URL для собственного инстанса GitLab или GitHub Enterprise (например, `https://gitlab.company.com`; поддерживаются и подпути вроде `https://host/gitlab`). |
| `gitPilot.branchIssueRegex` | `(?:^\|/\|-)(\d+)(?:-\|_\|$)` | Регулярное выражение для извлечения номера задачи из имени ветки (используется **первая группа захвата**). |
| `gitPilot.labelSync.showStatusBar` | `true` | Показывать индикатор задачи и MR/PR в строке состояния VS Code. |
| `gitPilot.labelSync.labelPrefix` | `"status:"` | Префикс статусных меток (`"status:"` или `"status::"`). При замене статуса учитываются оба варианта (`:` и `::`). |
| `gitPilot.labelSync.refreshInterval` | `120` | Интервал фонового обновления данных в секундах, пока окно VS Code активно (`0` — выключить автообновление; минимум — `10`). |
| `gitPilot.labels.groups` | `[]` | Маски группировки меток в нужном порядке, например `["status:*", "app:*"]` (`*` — любые символы, `?` — один символ, `:` также совпадает с `::`). Если массив пуст, метки группируются автоматически по префиксу до `:` / `::`. |
| `gitPilot.comments.compose` | `"quick"` | `"quick"`: **Add comment…** открывает однострочное поле ввода (Enter отправляет; кнопка переносит текст в редактор). `"editor"`: всегда начинать с черновика в Markdown. |
| `gitPilot.comments.pageSize` | `10` | Сколько комментариев загружается за раз в разделе **Comments** (1–50). В GitLab число приблизительное: системные записи отбрасываются уже после загрузки. |
| `gitPilot.allowInsecureHttp` | `false` | Только на уровне настроек пользователя. Разрешает отправку запросов по незашифрованному `http://`, если в `instanceUrl` явно указан `http://`. |

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
| Git Pilot: Comments: Send Comment *(пока открыт черновик)* | `gitPilot.comments.send` |
| Git Pilot: Comments: Refresh | `gitPilot.comments.refresh` |
| Git Pilot: Select Repository… | `gitPilot.selectRepository` |
| Git Pilot: Open Issue / MR in Browser | `gitPilot.openInBrowser` |

Логи работы пишутся в панель **Output → Git Pilot**. Для отладки сетевых запросов переключите уровень логирования на **Trace** (токены в лог никогда не выводятся).

Сборка из исходников и архитектура проекта описаны в [CONTRIBUTING.md](CONTRIBUTING.md).

<sub>[↑ Содержание](#ru) · [English](#en)</sub>

<a id="ru-security"></a>

### Безопасность

Поскольку клонированный репозиторий может содержать произвольные remote URL, имена веток и локальный `.vscode/settings.json`, расширение изолирует работу с токенами и сетью:

- **Только доверенные рабочие области (Workspace Trust)** — в ограниченном режиме (Restricted Mode) расширение не активируется (`untrustedWorkspaces.supported: false`).
- **Привязка токена к хосту и обязательный HTTPS** — в памяти токен хранится в изолированном приватном поле и передаётся строго на тот API-хост, для которого он был сохранён; редиректы на другие домены блокируются, а для `github.com` и `gitlab.com` жёстко зафиксированы платформа и адрес API. Настройки `gitPilot.instanceUrl` и `gitPilot.allowInsecureHttp` задаются только на уровне пользователя (`machine`), поэтому `.vscode/settings.json` внутри репозитория не может перенаправить запросы или понизить протокол до HTTP.
- **Защита логов от утечки секретов** — токены и встроенные в URL учётные данные (`user:token@`) автоматически маскируются перед выводом в панель `Output`.
- **Изоляция в рамках текущего проекта** — чужие MR/PR из других репозиториев, упоминающие вашу задачу, отфильтровываются, а любые изменения меток отправляются только в текущий проект.
- **Комментарии — недоверенный текст** — тело комментария показывается только как простой текст (никогда не рендерится как HTML или доверенный Markdown), ссылки на комментарии обязаны вести на веб-хост вашего инстанса, а комментарий публикуется только когда вы сами нажали Send в черновике, который сами открыли.

<sub>[↑ Содержание](#ru) · [English](#en) · [↑ В начало](#top)</sub>
