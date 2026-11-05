# SYNTX MCP — публичный checkout

Проект заведён 2026-10-13.

<!-- Глобальные правила, агенты и цикл критики уже приходят из ~/.codex.
     Здесь хранится только специфика этого проекта. -->

## Назначение и критерий готовности

Переносимый source snapshot SYNTX MCP под MIT. Image/video/audio flows доступны
только в явно реализованных opt-in группах. HTTPS entry запускает отдельный
private-owner OAuth gateway и канонический owner-stdio того же выпуска.
Не заявлять полную provider matrix, действующий deployment, restart durability
или совместимость конкретного облачного клиента без отдельного proof.

<!-- Для кого проект, какой результат считается готовым, что не входит в scope. -->

## Источники истины

- README, SECURITY.md, package.json/lock и текущий Git commit.
- publication-manifest.json: SHA каждого распространяемого source/static файла.
- src и immutable catalog — канон поведения; source статус не равен live доступу.

<!-- README, ADR, master plan, schema, API contract, data dictionary и т. п.
     Если документов нет, укажи фактический канон по коду и конфигурации. -->

## Карта проекта

```text
src/          runtime/auth/domain/MCP
tests/        синтетические проверки, без приватных provider receipts
scripts/      maintenance/config/package/publication
catalog/      проверяемые versioned источники
skills/       переносимый updater
deploy/       private-owner HTTPS helper, templates и инструкция
.журналы/     локальные логи, не публиковать
```

<!-- Добавляй только реально существующие зоны и их ответственность. -->

## Команды проверки

- npm ci; npm run typecheck; npm run build; npm test.
- npm run package:smoke:public — отдельный clean-installed SDK gate.
- npm run test:media:update — согласованный целевой медиа-срез.
- Gitleaks8.30.1 нужен developer secret tests, не обычному runtime.
- CI: manual `workflow_dispatch`, default `changed-media` (Linux/Node24.21,
  targeted media command plus public manifest/read-safety and Gitleaks); choose
  `full` for the existing three-OS × Node22.13/24.21 portability matrix and
  full suite/Linux24. Neither scope uses provider credentials or paid media.
- `media-cloud-final` — целевой Linux-срез и отдельный windows-2025 запуск
  scripts/check-windows-media-acceptance.mjs с настоящими codec executables;
  macOS preflight не является Windows OS proof.

<!-- Реальные команды build/test/lint/validate и изменённый runtime-сценарий.
     Не выдумывай команды, которых в проекте нет. -->

## Ограничения и внешние контуры

- Стандартные GitHub runners, CI только synthetic: без Telegram/SYNTX credentials
  и платных загрузок/генераций. Не подменять ошибки OS compatibility пропуском.
- Paid media defaultOFF в базовом stdio, включается явным профилем.
  Старый loopback HTTP не открывать в интернет. Облачный доступ — только через
  private-owner HTTPS gateway с отдельным OAuth и обычным SYNTX Telegram login;
  инструкция deploy/README.md. Один owner runtime не является общим SaaS.
- Каждый связывает свой аккаунт; Telegram companion отдельный/необязательный.
- Не публиковать .env/session/DB/user media/личные логи/исходную private историю.
- UNKNOWN платный запрос не повторять: только предусмотренный GET/recovery.

<!-- Доступы, интеграции, публикация, данные, совместимость, protected areas. -->

## Незавершённое и debt

- Каталог/code bindings и source-backed настройки не являются доказательством
  каждого provider tuple. Фактический Windows CI, deployment и cloud client
  проверяются для выбранного commit отдельно. Legacy refs/recovery и mutation
  circuit process-local, не restart-durable. Неизвестный POST после сбоя
  восстанавливать через поддерживаемое чтение/историю, не повторять.
- Исторический README C07 сохранён отдельно; актуальные инструкции — README,
  deploy/README.md и фактические схемы tools/list. Private historical evidence
  не публикуется и не заменяется синтетическим provider proof.
- Обновление каталога не означает автоматическое исполнение нового кода.

<!-- Любой placeholder, заглушка, непроверенный flow или отложенный риск. -->

## Локальный приоритет

Эти правила уточняют глобальный Codex-контур для данного проекта. При конфликте
более узкий `AGENTS.md` ближе к изменяемому файлу имеет приоритет, если не
ослабляет системные требования и безопасность.
