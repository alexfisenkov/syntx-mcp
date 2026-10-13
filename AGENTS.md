# SYNTX MCP — публичный checkout

Проект заведён 2026-10-13.

<!-- Глобальные правила, агенты и цикл критики уже приходят из ~/.codex.
     Здесь хранится только специфика этого проекта. -->

## Назначение и критерий готовности

Переносимый source snapshot SYNTX MCP под MIT. Image/video/audio flows доступны
только в явно реализованных opt-in группах. Не заявлять всё покрытие, HTTP media
deployment, restart durability или provider acceptance без отдельного proof.

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
.журналы/     локальные логи, не публиковать
```

<!-- Добавляй только реально существующие зоны и их ответственность. -->

## Команды проверки

- npm ci; npm run typecheck; npm run build; npm test.
- npm run package:smoke:public — отдельный clean-installed SDK gate.
- Gitleaks8.30.1 нужен developer secret tests, не обычному runtime.
- CI: workflow_dispatch, три ОС × Node22.13/24.21; full suite/Linux24 отдельно.

<!-- Реальные команды build/test/lint/validate и изменённый runtime-сценарий.
     Не выдумывай команды, которых в проекте нет. -->

## Ограничения и внешние контуры

- Стандартные GitHub runners, CI только synthetic: без Telegram/SYNTX credentials
  и платных загрузок/генераций. Не подменять ошибки OS compatibility пропуском.
- Paid media только stdio/defaultOFF. Loopback HTTP не открывать в интернет.
- Каждый связывает свой аккаунт; Telegram companion отдельный/необязательный.
- Не публиковать .env/session/DB/user media/личные логи/исходную private историю.
- UNKNOWN платный запрос не повторять: только предусмотренный GET/recovery.

<!-- Доступы, интеграции, публикация, данные, совместимость, protected areas. -->

## Незавершённое и debt

- Полное model/settings покрытие, HTTPS, durable restart и все host проверки
  остаются открыты. Private historical evidence не распространяется и не
  заменяется синтетическим provider proof. Публичный suite != весь private suite.
- Обновление каталога не означает автоматическое исполнение нового кода.

<!-- Любой placeholder, заглушка, непроверенный flow или отложенный риск. -->

## Локальный приоритет

Эти правила уточняют глобальный Codex-контур для данного проекта. При конфликте
более узкий `AGENTS.md` ближе к изменяемому файлу имеет приоритет, если не
ослабляет системные требования и безопасность.
