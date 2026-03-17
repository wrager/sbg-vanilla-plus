# Соглашения о стиле кодирования SBG Vanilla+

| Что                | Формат           | Пример               |
| ------------------ | ---------------- | -------------------- |
| Файлы/папки        | camelCase        | `settingsStorage.ts` |
| Интерфейсы         | IPascalCase      | `IFeatureModule`     |
| Функции/переменные | camelCase        | `getModuleEnabled`   |
| Константы          | UPPER_SNAKE_CASE | `MODULE_ID`          |
| CSS-классы скрипта | `svp-` префикс   | `svp-settings-panel` |
| localStorage ключи | `svp_` префикс   | `svp_settings`       |

Избегать слов "util" и "manager" в названиях.

Не сокращать имена идентификаторов — `button`, не `btn`; `element`, не `el`; `property`, не `prop`. Полные имена читаются без контекста.

Аббревиатуры в camelCase/PascalCase считаются одним словом (первая буква заглавная, остальные строчные): `Ui`, `Api`, `Id`, `Url`.
