Создать новый модуль `$ARGUMENTS` (например: `/new-module keepScreenOn`).

## Структура файлов

1. `src/modules/<name>/<name>.ts` — модуль
2. `src/modules/<name>/<name>.test.ts` — тесты
3. `src/modules/<name>/styles.css` — стили (если нужны)

## Интерфейс модуля

Экспортировать объект `IFeatureModule` из `../../core/moduleRegistry`:

```typescript
import type { IFeatureModule } from '../../core/moduleRegistry';

const MODULE_ID = '<name>';

export const <name>: IFeatureModule = {
  id: MODULE_ID,
  name: { en: 'English Name', ru: 'Русское название' },
  description: {
    en: 'English description',
    ru: 'Русское описание',
  },
  defaultEnabled: true,
  category: '<ui|map|feature|utility|fix>',
  init() {},
  enable() {},
  disable() {},
};
```

## Правила

- Без side effects при импорте — вся логика в `init`/`enable`/`disable`
- `defaultEnabled: true` если пользователь не попросил иначе
- Все три метода (`init`, `enable`, `disable`) обязательны
- `enable`/`disable` должны быть симметричны: всё что `enable` подключает — `disable` отключает
- CSS: `import styles from './styles.css?inline'` → `injectStyles(css, MODULE_ID)`

## Регистрация

Добавить импорт и модуль в `bootstrap([...])` в `src/entry.ts`.

## Документация

Обновить таблицу модулей в README.md:

- Найти секцию нужной категории (Интерфейс / Карта / Фичи / Утилиты / Багфиксы)
- Добавить строку: `| name.ru | id | description.ru |`
- Порядок строк = порядок в `bootstrap()`

## Чеклист

- [ ] Модуль экспортирует `IFeatureModule`
- [ ] Тесты написаны (рядом с исходником)
- [ ] Добавлен в `bootstrap()` в `entry.ts`
- [ ] README.md обновлён (`name.ru`, `description.ru`, правильная категория, правильный порядок)
- [ ] CI проходит
