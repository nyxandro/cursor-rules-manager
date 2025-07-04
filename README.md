# Cursor Rules Manager

Расширение для Cursor AI, которое управляет синхронизацией правил с GitHub репозиторием.

[![CI/CD](https://github.com/nyxandro/cursor-rules-manager/workflows/CI/CD/badge.svg)](https://github.com/nyxandro/cursor-rules-manager/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Version](https://img.shields.io/badge/version-1.0.2-blue.svg)](https://github.com/nyxandro/cursor-rules-manager/releases)

## Возможности

- **Синхронизация правил**: Автоматическая синхронизация правил между локальным проектом и GitHub репозиторием
- **Разделение правил**: Локальные правила (например, `my-project`) остаются только в проекте, глобальные правила синхронизируются
- **Управление через команды**: Простые команды для загрузки, отправки и синхронизации правил
- **Статус правил**: Просмотр текущего состояния правил в проекте
- **Автоматическое управление .gitignore**: Расширение автоматически обновляет `.gitignore` файл для правильного исключения правил
- **Защита от потери данных**: Защита от случайного удаления всего репозитория при отсутствии локальных правил
- **Настраиваемые уведомления**: Контроль над уведомлениями автосинхронизации и временем их отображения
- **Улучшенные коммиты**: Коммиты с датой и временем для лучшего отслеживания изменений

## Архитектура правил

- **Глобальные правила** — все папки внутри `.cursor/rules`, кроме тех, что указаны в `Exclude Patterns`. Они синхронизируются между проектами через GitHub.
- **Локальные правила** — папки, указанные в `Exclude Patterns` (например, `my-project`). Они не синхронизируются и остаются только в текущем проекте.

```
.cursor/
└── rules/
    ├── my-project/          # Локальные правила (не синхронизируются)
    ├── core/                # Глобальные правила (синхронизируются)
    ├── database/            # Глобальные правила (синхронизируются)
    └── testing/             # Глобальные правила (синхронизируются)
```

## Автоматическое управление .gitignore

Расширение автоматически создает и обновляет `.gitignore` файл в корне проекта для правильного исключения правил Cursor AI:

```gitignore
# Cursor Rules
# Исключаем все правила Cursor из основного репозитория
.cursor/rules/*

# Разрешаем синхронизацию указанных папок с основным проектом
!.cursor/rules/my-project/
!.cursor/rules/my-project/**
```

Это обеспечивает:

- Исключение всех правил Cursor из основного репозитория проекта
- Разрешение синхронизации указанных папок (например, `my-project`) с основным проектом
- Автоматическое обновление при изменении настроек исключений

## Защита от потери данных

Расширение включает защиту от случайного удаления всего репозитория правил:

- **Проверка локальных файлов**: Перед удалением файлов из репозитория проверяется наличие локальных правил
- **Блокировка удаления**: Если локальная папка `.cursor/rules` пуста или отсутствует, удаление файлов из репозитория блокируется
- **Логирование**: Все действия защиты записываются в лог для отслеживания

## Настройки

### Основные настройки

- **Rules Repo Url** — URL репозитория с правилами Cursor
- **Global Rules Path** — путь к папке с глобальными правилами (по умолчанию: `.cursor/rules`)
- **Exclude Patterns** — список папок, которые считаются локальными и не синхронизируются (по умолчанию: `my-project`)

### Настройки автосинхронизации

- **Auto Sync Interval** — Интервал автосинхронизации правил (в минутах, по умолчанию 60)
- **Show Auto Sync Notifications** — Показывать уведомления при автосинхронизации (по умолчанию отключено)
- **Notification Timeout** — Время отображения уведомлений в миллисекундах (1000-10000, по умолчанию 3000)

> **Нет настройки Local Rules Path!** Локальные правила определяются только через Exclude Patterns.

## Команды

- **Синхронизировать правила Cursor** — полная синхронизация: загружает правила из GitHub и отправляет локальные изменения.
- **Загрузить правила из GitHub** — загружает последние версии правил из GitHub репозитория.
- **Отправить правила в GitHub** — отправляет локальные изменения правил в GitHub репозиторий.
- **Показать статус правил** — отображает текущее состояние правил в проекте.

## Установка

### Из .vsix файла

1. Скачайте последний релиз с [GitHub Releases](https://github.com/nyxandro/cursor-rules-manager/releases)
2. Установите .vsix файл в Cursor/VSCode:
   - Откройте Cursor/VSCode
   - Перейдите в Extensions (Ctrl+Shift+X)
   - Нажмите "..." → "Install from VSIX..."
   - Выберите скачанный .vsix файл

### Из исходного кода

1. Клонируйте репозиторий: `git clone https://github.com/nyxandro/cursor-rules-manager.git`
2. Установите зависимости: `npm install`
3. Скомпилируйте: `npm run compile`
4. Запустите тесты: `npm test`
5. Упакуйте расширение: `npm run package`
6. Установите .vsix файл в Cursor

## Разработка

```bash
# Установка зависимостей
npm install

# Компиляция
npm run compile

# Запуск тестов
npm test

# Линтинг
npm run lint

# Сборка расширения
npm run package

# Очистка
npm run clean

# Разработка с автопересборкой
npm run dev

# Обновление версии и сборка
npm run version:patch  # для patch версии
npm run version:minor  # для minor версии
npm run version:major  # для major версии
```

### Отладка

1. Откройте проект в Cursor/VSCode
2. Нажмите F5 для запуска в режиме отладки
3. Откроется новое окно Cursor/VSCode с расширением
4. Используйте команды в палитре команд (Ctrl+Shift+P)

### Структура проекта

```
src/
├── extension.ts          # Основной файл расширения
├── rulesManager.ts       # Логика управления правилами
├── gitignoreManager.ts   # Управление .gitignore файлом
└── test/
    ├── extension.test.ts # Тесты расширения
    ├── gitignore.test.ts # Тесты GitignoreManager
    ├── runTest.ts        # Запуск тестов
    └── suite/
        └── index.ts      # Конфигурация тестов
```

## Требования

- Cursor AI или Visual Studio Code
- Git
- Node.js 18+
- Доступ к GitHub репозиторию с правилами

## Автоматизация

Проект включает:

- **GitHub Actions**: Автоматическая сборка, тестирование и релизы
- **ESLint**: Проверка качества кода
- **TypeScript**: Типизированный JavaScript
- **Mocha**: Тестирование
- **VSCE**: Упаковка расширений

## Вклад в проект

1. Форкните репозиторий
2. Создайте ветку для новой функции: `git checkout -b feature/amazing-feature`
3. Внесите изменения и закоммитьте: `git commit -m 'Add amazing feature'`
4. Отправьте в ветку: `git push origin feature/amazing-feature`
5. Откройте Pull Request

## Лицензия

Этот проект лицензирован под MIT License - см. файл [LICENSE](LICENSE) для деталей.

## Поддержка

Если у вас есть вопросы или проблемы:

1. Проверьте [Issues](https://github.com/nyxandro/cursor-rules-manager/issues)
2. Создайте новое Issue с описанием проблемы
3. Укажите версию Cursor/VSCode и расширения

### Автоматическая синхронизация

Расширение поддерживает автоматическую синхронизацию правил с GitHub. Интервал автосинхронизации можно задать в настройках (`autoSyncInterval`). По умолчанию синхронизация происходит раз в час.

**Уведомления автосинхронизации по умолчанию отключены** для избежания спама. Их можно включить в настройках (`showAutoSyncNotifications`).

Сообщения о запуске и завершении автосинхронизации выводятся в Output канал "Cursor Rules Manager".

### Формат коммитов

Коммиты теперь включают дату и время:

```
Обновление правил Cursor AI от 2025-01-15 14:30:25
```

Это обеспечивает лучшее отслеживание изменений и истории синхронизации.

## Механизм сохранения пользовательских настроек режима правил

### Как работает синхронизация

- **При синхронизации (push/pull/sync):**
  - **Сохраняется состояние пользовательских настроек режима правила** (например, `alwaysApply: true`).
  - Обновляется только содержимое самих правил (контент внутри файла), но строка с настройкой режима, которую вы указали вручную, не изменяется.
  - Это гарантирует, что ваши индивидуальные настройки режима для каждого правила не будут случайно перезаписаны при синхронизации с GitHub.

**Пример:**

```yaml
---
alwaysApply: true
---
# Здесь содержимое правила
Описание, инструкции и т.д.
```

- При синхронизации будет обновлено только содержимое после блока настроек, а строка `alwaysApply: true` останется такой, как вы её установили.

---

- **При загрузке (pull) из GitHub:**
  - **Файл правила полностью перезаписывается** вместе с настройками, как они были в репозитории.
  - Это сделано намеренно: если вы хотите сбросить настройки к состоянию из репозитория, используйте загрузку (pull).

---

### Итог

- **Синхронизация** — сохраняет ваши локальные настройки режима правила (например, `alwaysApply: true`).
- **Загрузка из GitHub** — полностью перезаписывает файл, включая настройки режима, как задумано для сброса к эталону из репозитория.

---

**Это позволяет гибко управлять своими настройками:**

- Локальные изменения настроек не будут случайно потеряны при обычной синхронизации.
- Если нужно сбросить настройки к состоянию из репозитория — используйте загрузку (pull).

---

**Пример файла правила:**

```yaml
---
alwaysApply: true
---
# Описание правила
Это правило всегда применяется для всех задач...
```

---

**Важно:**

- Синхронизация не изменяет блок настроек (`--- ... ---`), если вы его редактировали вручную.
- Загрузка из GitHub всегда перезаписывает файл полностью, включая блок настроек.
