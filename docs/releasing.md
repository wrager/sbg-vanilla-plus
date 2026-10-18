# Коммиты, preview и релизы

## Conventional Commits

PR title проверяет `amannn/action-semantic-pull-request`. Примеры:
`feat(map): добавить слой`, `fix(ui): исправить попап`, `feat!: изменить формат настроек`.
Допустимы scope и русское описание. При squash заголовок PR становится заголовком
коммита в main; промежуточные WIP-коммиты не проверяются.

semantic-release использует preset `conventionalcommits` и теги `vX.Y.Z`:

| Изменения после последнего тега                           | Результат из `0.15.1`               |
| --------------------------------------------------------- | ----------------------------------- |
| `fix`, `perf`                                             | `0.15.2` (patch)                    |
| `feat`                                                    | `0.16.0` (minor)                    |
| `!` или `BREAKING CHANGE:` в теле                         | `1.0.0` (major), в том числе до 1.0 |
| Только `docs`, `chore`, `ci`, `build`, `test`, `refactor` | Нет выпуска                         |

Берётся наибольший bump за весь диапазон. Стандартный `revert` обрабатывает готовый
анализатор; собственных правил поверх Conventional Commits нет.

### Настройка GitHub после слияния workflow

В Settings → General → Pull Requests оставить Squash merging, выключить merge/rebase.
Для squash выбрать **Pull request title and description**. Это важно и для PR с одним
коммитом: стандартная настройка GitHub может подставить его сообщение вместо PR title.
В защите main требовать PR и успешные `check` (CI) и `Conventional PR title`.
Проверки можно выбрать после их первого запуска. Эти настройки репозитория не
применяются изменением YAML и должны быть включены сопровождающим.

## Тестовая сборка в PR

CI проверяет merge commit PR с main. После всех проверок для внутренних веток
собирается `dist/debug/sbg-vanilla-plus.user.js`. `actions/upload-artifact` сохраняет
ровно этот файл в ZIP на 14 дней; отдельный job с `mshick/add-pr-comment` публикует
ссылку, SHA ветки, SHA сборки и ссылку на run.

Сборка имеет только `contents: read`. Право `pull-requests: write` есть у job комментария,
который не делает checkout и не исполняет код PR. Используется обычный GITHUB_TOKEN;
PAT, `pull_request_target`, сервер и техническая ветка не нужны.
Форки и Dependabot не публикуют preview. Ошибка проверки не создаёт ссылку на новую
сборку. ID artifact и комментария включают run/attempt, поэтому повторный запуск
не заменяет ссылку старого запуска. Старые комментарии сохраняются как история;
их ссылки перестают работать после удаления/истечения artifact.

Для установки нужно войти в GitHub, скачать и распаковать ZIP, импортировать `.user.js`
в менеджер. `[DEBUG]` работает без сервера и имеет inline source map. Вложение не
содержит `.local.user.js` с путём машины CI. Перед проверкой выключить stable, после
проверки выключить debug и вернуть stable. Автообновлений и отдельных имён на каждый
PR нет: новая debug-сборка заменяет предыдущую при импорте. Интерактивную проверку
в игре выполняет пользователь.

## Стабильный выпуск

1. Подготовить русские `RELEASE_NOTES.md` для всего диапазона после последнего
   стабильного тега по [сценарию релиза](agent/release.md). Заголовок — `# Изменения`;
   номер версии автоматически появится в GitHub Release. Файл сохраняет описание
   предыдущего релиза до следующей подготовки: его обязательно актуализировать.
2. Слить notes в main через PR. Перед выпуском проверить, не добавились ли изменения,
   которые тоже должны попасть в описание.
3. В Actions → Release → Run workflow выбрать main либо выполнить
   `gh workflow run release.yml --ref main`.
4. Дождаться успеха и проверить версию в теге, `.user.js` и `.meta.js`, содержимое
   Release и имена обоих assets. Stable URLs остаются прежними.

Release workflow выполняет проверки, затем semantic-release анализирует коммиты.
Если нужен выпуск, npm-плагин обновляет package/lockfile только в checkout CI,
exec-плагин читает notes, собирает и проверяет файлы, GitHub-плагин публикует релиз
с assets. При ошибке подготовки тег и релиз не создаются. Запуски сериализованы;
выбор другой ветки пропускает release job. Push тега сам по себе больше не выпускает релиз.

Публикация в npm отключена. Обратного коммита версии нет: теги — источник выпущенных
версий. `package.json` в main и даже в checkout тега содержит development-версию;
обычная локальная сборка использует именно её. Для воспроизведения release checkout
нужного тега и `npm version <версия-без-v> --no-git-tag-version --ignore-scripts`
перед сборкой, без коммита этих локальных изменений.

`npm run release -- --dry-run` предназначен для Linux runner/окружения с доступом
к GitHub. Он проверяет версию и notes, но **пропускает prepare и publish** и не
заменяет проверки готовых файлов. Обычные проверки проекта работают и в PowerShell.

## Частичный сбой

Сначала проверить лог semantic-release, теги и Releases, включая drafts.
Если тег ещё не создан, после устранения причины можно повторить workflow.
Если тег уже существует, повторный анализ может считать изменения выпущенными:
нельзя рассчитывать на повторный запуск как на восстановление assets.

Для существующего тега собрать **тот же SHA и ту же версию** в чистом checkout:
`npm ci`, `npm version <версия> --no-git-tag-version --ignore-scripts`, затем полный
набор проверок из AGENTS.md. Проверить metadata обоих файлов. Завершить тот же
GitHub Release через UI или `gh release upload <тег> <оба-файла>`; если Release не
создан, создать draft на существующем теге, загрузить файлы и только потом опубликовать.
Не перемещать опубликованный тег и не повышать версию ради повторной загрузки.
Перед заменой существующего asset проверить его содержимое; `--clobber` не применять
вслепую. Пользовательский запрос на подготовку PR не разрешает выпуск релиза.

## Используемые инструменты

- [semantic-release](https://github.com/semantic-release/semantic-release) и плагины
  [commit-analyzer](https://github.com/semantic-release/commit-analyzer),
  [npm](https://github.com/semantic-release/npm), [exec](https://github.com/semantic-release/exec),
  [github](https://github.com/semantic-release/github).
- [action-semantic-pull-request](https://github.com/amannn/action-semantic-pull-request).
- [upload-artifact](https://github.com/actions/upload-artifact) и
  [add-pr-comment](https://github.com/mshick/add-pr-comment).

Дополнительные actions закреплены SHA; npm-пакеты — lockfile. Собственных скриптов
для bump, загрузки, комментариев, хранения и очистки preview нет.
