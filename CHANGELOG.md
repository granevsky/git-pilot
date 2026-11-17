<!-- cspell:ignoreRegExp /[Ѐ-ӿ]+/g -->
# Change Log

**Language / Язык:** [English](#en) · [Русский](#ru)

---

<a id="en"></a>

## English

### [1.0.4] — 2026-11-17

- Security hardening:
  - Isolated in-memory Personal Access Tokens in ECMAScript private fields (`#token`) and removed plaintext tokens from provider cache keys.
  - Changed `gitPilot.instanceUrl` to `machine` scope, pinned `github.com` and `gitlab.com` to their canonical platforms, and stripped subpath overrides on cloud hosts.
  - Restricted PAT input validation to visible ASCII characters (`0x21–0x7E`) to prevent invisible Unicode characters from breaking HTTP headers.
  - Redacted embedded URL credentials (`user:token@`) and token query parameters across remote metadata and logs.
  - Enforced the `10 MB` response size limit before reading HTTP error bodies, sanitized server error details, and rejected `?`/`#` in repository path segments.

### [1.0.3] — 2026-11-15

- Changed the extension identifier (`name`) to `git-pilot-ext` for publishing on the VS Code Marketplace.

### [1.0.2] — 2026-11-15

- Updated the extension icon.
- Rewrote `README.md` with a Quick Start guide and clearer documentation.
- Added `CONTRIBUTING.md` and `CHANGELOG.md`.

### [1.0.1] — 2026-11-15

- Updated the extension icon.

### [1.0.0] — 2026-11-15

- Initial release of **Git Pilot** for **GitLab (CE/EE)** and **GitHub (including Enterprise)**:
  - **Issue & MR** sidebar section and status bar indicator for the current Git branch.
  - One-click status changes and mutually exclusive label groups (`scoped labels`) across GitHub and GitLab.
  - Controlled label synchronization from open MRs/PRs with diff preview and confirmation.
  - **Labels** sidebar section with the project label catalog and custom grouping masks (`gitPilot.labels.groups`).
  - Per-host Personal Access Token storage in the OS keychain (`SecretStorage`).

---

<a id="ru"></a>

## Русский

### [1.0.4] — 2026-11-17

- Усиление безопасности и защиты секретов:
  - Токены доступа в памяти изолированы в приватных полях ECMAScript (`#token`) и исключены из строковых ключей кэша провайдера.
  - Настройка `gitPilot.instanceUrl` переведена на уровень пользователя (`scope: machine`), а для `github.com` и `gitlab.com` зафиксирована платформа и запрещено переопределение подпутей (`pathname`).
  - Валидация ввода токена ограничена печатными ASCII-символами (`0x21–0x7E`), чтобы исключить попадание невидимых Unicode-символов в HTTP-заголовки.
  - Добавлено маскирование учётных данных (`user:token@`) и токен-параметров во всех URL перед сохранением метаданных remote и записью в лог.
  - Проверка лимита размера ответа (`10 МБ`) теперь выполняется до чтения тела HTTP-ошибок, текст ошибок сервера очищается от управляющих символов, а в сегментах пути репозитория запрещены `?` и `#`.

### [1.0.3] — 2026-11-15

- Изменено техническое имя пакета (`name`) на `git-pilot-ext` для публикации в магазине расширений VS Code Marketplace.

### [1.0.2] — 2026-11-15

- Обновлена иконка приложения.
- Обновлён `README.md`: добавлен «Быстрый старт», улучшена структура и читаемость документации.
- Добавлены `CONTRIBUTING.md` и `CHANGELOG.md`.

### [1.0.1] — 2026-11-15

- Обновлена иконка приложения.

### [1.0.0] — 2026-11-15

- Первый релиз **Git Pilot** для **GitLab (CE/EE)** и **GitHub (включая Enterprise)**:
  - Раздел боковой панели **Issue & MR** и индикатор в строке состояния для текущей git-ветки.
  - Смена статуса в один клик и взаимоисключающие группы меток (`scoped labels`) в GitHub и GitLab.
  - Синхронизация меток из открытых MR/PR с предпросмотром изменений и подтверждением.
  - Раздел **Labels** с каталогом меток проекта и поддержкой пользовательских масок группировки (`gitPilot.labels.groups`).
  - Безопасное хранение токенов доступа по хостам в системной связке ключей (`SecretStorage`).
