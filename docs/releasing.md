# Коммиты, preview и релизы

## Conventional Commits

PR title проверяет `amannn/action-semantic-pull-request` со стандартными типами.
Примеры: `feat(map): добавить слой`, `fix(ui): исправить попап`,
`feat!: изменить формат настроек`. Scope и русское описание допустимы.
В main попадает squash с заголовком и описанием PR; соавторов в описание добавляет агент по AGENTS.md.

Release Please анализирует изменения после последнего стабильного тега:

| Изменения                                                         | Результат из 0.15.1                  |
| ----------------------------------------------------------------- | ------------------------------------ |
| fix, perf                                                         | 0.15.2 (patch)                       |
| feat                                                              | 0.16.0 (minor)                       |
| ! в заголовке или BREAKING CHANGE в теле коммита                  | 1.0.0 (major), включая версии до 1.0 |
| Только docs, chore, ci, build, test, refactor, style без breaking | Нет выпуска                          |

Выбирается максимальный bump диапазона. Обе настройки уменьшения bump до 1.0
отключены. Описание PR переносится в squash-коммит вместе с trailers. Breaking change обозначать `!` в PR title; явный `BREAKING CHANGE` в описании также сохраняется.

## Тестовая сборка в PR

После успешного `check` для внутренних PR, кроме Dependabot, CI собирает
`dist/debug/sbg-vanilla-plus.user.js`. `actions/upload-artifact` сохраняет ровно
этот файл в ZIP на 14 дней. Отдельный job `preview-comment` с
`mshick/add-pr-comment` добавляет ссылку, SHA ветки, SHA merge commit и ссылку на run.

Сборка имеет только `contents: read`. Job комментария имеет
`pull-requests: write`, не делает checkout, не скачивает и не исполняет код PR.
ID artifact и комментария включают run/attempt: один комментарий на попытку.
Ошибка новой сборки не добавляет комментарий; старые комментарии остаются историей.
Rerun старого запуска сохраняет собственный SHA и не заменяет ссылку нового.

Для установки войти в GitHub, скачать и распаковать ZIP, импортировать
`.user.js` в менеджер юзерскриптов. Выключить stable на время проверки,
после неё выключить debug и вернуть stable. Debug работает без сервера,
содержит inline source map и не обновляется автоматически.
Ссылка действует 14 дней, если artifact или run не удалены раньше.
Интерактивные проверки игры выполняет пользователь.

## Подготовка и публикация

1. Обычные PR проходят проверки и squash merge в main. На push main workflow
   Release создаёт или обновляет один release PR через Release Please.
   Стратегия node обновляет `package.json`, `package-lock.json` (включая
   `packages[""].version`) и `.release-please-manifest.json`.
   `skip-changelog: true`: автоматический черновик остаётся в теле PR.
2. Вызвать `$sbg-release` (Claude Code: `/sbg-release`) для существующего PR.
   Агент проверяет все изменения после предыдущего опубликованного стабильного
   релиза и готовит русские `RELEASE_NOTES.md` с первой строкой `# vX.Y.Z`.
   Notes коммитятся в ту же ветку; служебное тело, заголовок и метки бота сохраняются.
   Если бот обновил PR, повторно проверить диапазон и notes даже при прежней версии.
3. Выполнить полный CI и review. `npm run release:check` сравнивает заголовок notes,
   версии package/lockfile и manifest. Проверка заголовка не доказывает полноту
   текста: её проверяет агент по diff, затем пользователь в PR.
   Для PR от GITHUB_TOKEN может потребоваться **Approve workflows to run**,
   в том числе после обновления ботом. Убедиться в наличии всех required checks.
4. При отдельном запросе на выпуск squash merge подготовленного release PR
   сохраняет версию и notes в main одной транзакцией. Release Please создаёт
   `vX.Y.Z` и draft GitHub Release. Job publish получает SHA и тег из outputs,
   делает checkout точного SHA, проверяет notes, собирает оба userscript-файла.
   Проверяются версия тега, metadata обоих файлов и наличие исполняемого JS.
   Полный lint/unit CI для тех же исходников в publish не повторяется.
5. Softprops v3 загружает оба точных файла, затем публикует draft с
   `RELEASE_NOTES.md`. `fail_on_unmatched_files: true`,
   `overwrite_files: false`. Stable assets: `sbg-vanilla-plus.user.js` и
   `sbg-vanilla-plus.meta.js`; прежние download/update URLs сохраняются.

Push тега и ручной workflow_dispatch выпуск не запускают.
Ручной bump, локальный тег, отдельный PR notes и обратный version commit не нужны.
Версия хранится в Git: например, после выпуска 0.16.0 main, тег v0.16.0,
локальная сборка этого SHA и опубликованные файлы содержат 0.16.0.
Между выпусками локальная сборка использует последнюю сохранённую версию.

## Настройки GitHub и миграция

- Разрешить только squash merge, squash title = **PR title**, тело = **PR description**.
- Защитить main: PR обязателен, enforce admins включён, required checks:
  `check` и `pr-title`. Боту не нужен обход защиты main.
- В Actions → General оставить default token permissions = read и разрешить
  **Allow GitHub Actions to create and approve pull requests**.
  Workflows выдают write только соответствующим jobs.

Эти настройки меняются через GitHub Settings/API, а не YAML.
GITHUB_TOKEN достаточно для release PR; App token/PAT для первого этапа не обязателен.
Ожидающее разрешения CI нельзя считать успешным.

Manifest начинается с 0.15.1; bootstrap SHA тега v0.15.1:
`31400e9ce1542b51506d39fb36ea6d711c268525`.
История до bootstrap не входит в новый выпуск. При подготовке первых notes
проверить также все non-conventional изменения после этого тега:
автоматический черновик может их пропустить.
При необходимости иной первой версии одноразовый `Release-As: X.Y.Z`
явно указать в описании миграционного PR перед squash. После миграции вернуться к автоматическому расчёту; перенос описания и соавторства сохраняется.

## Частичный сбой

Ошибка build/проверки/upload оставляет draft. После устранения причины выбрать
**Re-run failed jobs** или повторить только publish исходного run: он использует
сохранённые SHA и тег. Повтор всего workflow не равнозначен восстановлению:
Release Please может уже не вернуть `release_created`.

Перед ручным завершением проверить состав draft и уже загруженные assets.
Не перезаписывать их вслепую и не применять `--clobber`. При необходимости
собрать тот же SHA и ту же версию, проверить оба файла и завершить тот же draft.
Не перемещать тег и не повышать версию ради восстановления.

Создание release PR ботом, разрешение CI, фактическую публикацию и восстановление
publish проверять на GitHub при отдельно запрошенном выпуске.
Локальная проверка конфигурации и файлов не подтверждает эти внешние переходы.

## Инструменты

- [Release Please](https://github.com/googleapis/release-please) и
  [Release Please Action](https://github.com/googleapis/release-please-action).
- [Softprops v3](https://github.com/softprops/action-gh-release/tree/v3.0.3).
- [PR title](https://github.com/amannn/action-semantic-pull-request),
  [upload-artifact](https://github.com/actions/upload-artifact),
  [add-pr-comment](https://github.com/mshick/add-pr-comment).

Процесс, роли jobs и правила notes совпадают с SBG Scout.
Android-специфичные version.txt, Gradle, подпись APK и README-скриншоты остаются в Scout.
