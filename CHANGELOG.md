<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
# Change Log

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

### [1.2.0] — 2026-11-18

- Added the **Comments** sidebar section (`gitPilot.comments`):
  - Browse Issue and MR/PR comments newest-first (system activity notes are skipped) with on-demand pagination (`gitPilot.comments.pageSize`).
  - Open full comment bodies in read-only editor tabs, or jump directly to the comment permalink in your browser when media is attached.
  - Post new comments via a quick input box or a multi-line Markdown draft tab (`gitPilot.comments.compose`, `Ctrl+Enter` / `Cmd+Enter` to send).
- Added **Git Pilot: Select Repository…** (`gitPilot.selectRepository`) to pin a specific repository in multi-root workspaces instead of following the active editor.

### [1.1.0] — 2026-11-17

- Merged the **Issue & MR** and **Labels** sidebar sections into a single **Labels** section:
  - The project label catalog now lives under the collapsible **All labels** node (loaded on first expansion and available even when the current branch has no linked issue).
  - Removed the standalone catalog view, the `gitPilot.labels.enabled` and `gitPilot.statusSync.showSection` settings, and the `gitPilot.labels.refresh` / `gitPilot.labels.copyName` commands.
- **Breaking:** renamed the `statusSync` namespace to `labelSync`. Settings under `gitPilot.statusSync.*` are now `gitPilot.labelSync.*` (`showStatusBar`, `labelPrefix`, `refreshInterval`), and commands under `gitPilot.statusSync.*` are now `gitPilot.labelSync.*`.

### [1.0.4] — 2026-11-17

- Security updates:
  - Stored in-memory tokens in private class fields (`#token`) and removed tokens from provider cache keys.
  - Changed `gitPilot.instanceUrl` to `machine` scope, pinned `github.com` and `gitlab.com` to their canonical platforms, and ignored subpath overrides on cloud hosts.
  - Restricted token input to printable ASCII (`0x21–0x7E`).
  - Redacted embedded URL credentials (`user:token@`) and token query parameters in logs and remote metadata.
  - Checked the `10 MB` response size limit before reading HTTP error bodies, stripped control characters from server error messages, and rejected `?`/`#` in repository path segments.

### [1.0.3] — 2026-11-15

- Changed the package `name` to `git-pilot-ext` for the VS Code Marketplace.

### [1.0.2] — 2026-11-15

- Updated the extension icon.
- Added a Quick Start guide to `README.md`, plus `CONTRIBUTING.md` and `CHANGELOG.md`.

### [1.0.1] — 2026-11-15

- Updated the extension icon.

### [1.0.0] — 2026-11-15

- Initial release for **GitLab (CE/EE)** and **GitHub (including Enterprise)**:
  - Sidebar view and status bar indicator for the current branch's Issue and open MRs/PRs.
  - One-click status updates and mutually exclusive label groups (`scoped labels`) on both GitHub and GitLab.
  - Confirmed label sync from open MRs/PRs with diff preview.
  - Project label catalog with custom grouping masks (`gitPilot.labels.groups`).
  - Per-host Personal Access Token storage via `SecretStorage`.

---

<a id="ru"></a>

## Русский

### [1.2.0] — 2026-11-18

- Добавлен раздел **Comments** (`gitPilot.comments`) на боковой панели:
  - Просмотр комментариев к задаче и открытым MR/PR (от новых к старым, без автоматических системных записей) с постраничной подгрузкой (`gitPilot.comments.pageSize`).
  - Открытие полного текста комментария во вкладке только для чтения и быстрый переход к комментарию в браузере, если к нему прикреплены медиафайлы.
  - Отправка новых комментариев через быстрое поле ввода или черновик в Markdown (`gitPilot.comments.compose`, отправка по `Ctrl+Enter` / `Cmd+Enter`).
- Добавлена команда **Git Pilot: Select Repository…** (`gitPilot.selectRepository`), позволяющая закрепить нужный репозиторий при работе с несколькими репозиториями в одном окне.

### [1.1.0] — 2026-11-17

- Разделы **Issue & MR** и **Labels** объединены в общий раздел **Labels**:
  - Каталог меток проекта перенесён в раскрывающийся узел **All labels** (загружается при первом раскрытии и доступен даже на ветках без номера задачи).
  - Удалены отдельный раздел каталога, настройки `gitPilot.labels.enabled` и `gitPilot.statusSync.showSection`, а также команды `gitPilot.labels.refresh` и `gitPilot.labels.copyName`.
- **Несовместимое изменение:** пространство имён `statusSync` переименовано в `labelSync`. Настройки `gitPilot.statusSync.*` перенесены в `gitPilot.labelSync.*` (`showStatusBar`, `labelPrefix`, `refreshInterval`), а команды `gitPilot.statusSync.*` — в `gitPilot.labelSync.*`.

### [1.0.4] — 2026-11-17

- Безопасность:
  - Токены в памяти перенесены в приватные поля класса (`#token`) и убраны из ключей кэша провайдера.
  - Настройка `gitPilot.instanceUrl` переведена на уровень пользователя (`scope: machine`), а для `github.com` и `gitlab.com` зафиксированы платформа и базовый путь API.
  - Ввод токена ограничен печатными ASCII-символами (`0x21–0x7E`).
  - Добавлено маскирование учётных данных (`user:token@`) и токен-параметров в URL перед записью в лог.
  - Лимит размера ответа (`10 МБ`) теперь проверяется и при чтении тела HTTP-ошибок, сообщения об ошибках очищаются от управляющих символов, а в путях репозитория запрещены `?` и `#`.

### [1.0.3] — 2026-11-15

- Имя пакета (`name`) изменено на `git-pilot-ext` для публикации в VS Code Marketplace.

### [1.0.2] — 2026-11-15

- Обновлена иконка расширения.
- В `README.md` добавлен раздел «Быстрый старт», добавлены файлы `CONTRIBUTING.md` и `CHANGELOG.md`.

### [1.0.1] — 2026-11-15

- Обновлена иконка расширения.

### [1.0.0] — 2026-11-15

- Первый релиз для **GitLab (CE/EE)** и **GitHub (включая Enterprise)**:
  - Панель задачи и MR/PR для текущей ветки и индикатор в статус-баре.
  - Смена статуса в один клик и поддержка взаимоисключающих групп меток (`scoped labels`) в GitHub и GitLab.
  - Синхронизация меток с открытыми MR/PR с предпросмотром изменений.
  - Каталог меток проекта с поддержкой пользовательских масок (`gitPilot.labels.groups`).
  - Хранение токенов доступа по хостам в системной связке ключей (`SecretStorage`).
