# Обновление SYNTX MCP

## Установка и обновление кода (2026-10-29)

Для исходной установки нужны Git и Node.js 22.13 или новее; рекомендуем Node.js
24. Команда `npm` поставляется с Node.js:

```sh
git clone https://github.com/alexfisenkov/syntx-mcp.git
cd syntx-mcp
npm ci
npm run build
```

Сборка source-проекта и typecheck могут использовать до 4 GiB heap TypeScript
компилятора. Ограничение действует только во время сборки/проверки и не меняет
память работающего MCP-сервера.

В MCP-клиенте используйте owner-stdio entrypoint этой установки. В примере
настройки замените путь к `dist/src/transports/stdio-owner.js` на свой. Git
checkout должен сохранять origin `https://github.com/alexfisenkov/syntx-mcp.git`
и оставаться чистым; форки и локально изменённые копии self-update не принимает.

## ChatGPT: загрузка reference image и получение результата

В текущем source release официальный MCP file-input контракт подключён только к
`syntx_upload_standard_image_reference`, для standard Banana/GPT Image variants.
В ChatGPT приложите одно изображение к сообщению, которое просит использовать его
как reference, и вызовите этот инструмент. Если этот MCP host не передал вложение
как file object, используйте существующий Base64-вход этого инструмента. Для других
image-family tools пока используйте их существующие поля, включая `content_base64`,
где оно предусмотрено; официальное описание file parameters — в
[OpenAI Plugins reference](https://developers.openai.com/plugins/reference).

File object содержит `download_url` и `file_id`; `mime_type` и `file_name` могут
отсутствовать. `download_url` временный: обработайте файл сразу, не сохраняйте и
не публикуйте ссылку. Текущая локальная политика разрешает только HTTPS на точном
origin `files.oaiusercontent.com`, не следует redirect и не отправляет cookies или
Authorization headers. Это консервативное ограничение реализации, а не гарантия
OpenAI, что все допустимые файлы будут приходить с этого хоста; официальная
спецификация не подтверждает этот hostname или полное поведение download URL.
Никакие реальные ChatGPT-вложения и скачивания этим source-level тестом не
подтверждены.

После image generation MCP-ответ может содержать preview и `resource_link` для
image artifact URL, если соответствующий tool вернул такой URL. Это подключено к
общей генерации, Banana inpaint, Flux, Grok, Ideogram, Kontext, Magnific/Clarity
upscale, Runway, Seedream, Soul, Uni и WAN image results. Хост может отобразить
эти ссылки по-разному, а доступность исходного URL со временем может измениться.
При неизвестном результате используйте предусмотренный для той же операции
GET-only reconcile/recovery инструмент. Не повторяйте generation POST вслепую:
это может создать второй платный запуск.

Поправка 2026-11-02: сравнение результата приводит безопасные числовые upstream
ID к строковому виду уже связанного context; guards владельца, модели и чата
сохранены. В одном свежем live запуске локального owner MCP через MCP SDK
InMemory transport выполнили одну
генерацию Banana 2.1 с собственной PNG-референс-картинкой и параметрами
1K/minimal/1:1. Результат содержал один
`image/jpeg` artifact `resource_link`; тот же файл скачан и полностью декодирован.
ChatGPT fileParams download, другие модели, tunnel и ChatGPT cloud-inline delivery
этим кейсом не проверены.

Эта поддержка реализована и описана для локального owner-stdio процесса. Текущий
owner HTTP transport остаётся локальным и read-only; generation deployment,
OAuth и готовое подключение из облачного ChatGPT не подтверждены. Официальная
документация ChatGPT предлагает для custom MCP server публичный HTTPS endpoint
или [Secure MCP Tunnel](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels),
который связывает private/local stdio или HTTP MCP через customer-run
[OpenAI tunnel-client](https://github.com/openai/tunnel-client). Это внешний
компонент, не зависимость проекта; tunnel-client и connector для SYNTX здесь не
установлены и не проверены. Альтернатива — отдельный HTTPS endpoint. Для обоих
путей нужны настройка ChatGPT connection, разрешения аккаунта/workspace и
read-back списка tools. Документация OpenAI предупреждает, что аккаунтные и
workspace policies применяются к custom MCP connections.

Owner runtime привязан к одному владельцу и не рассчитан на совместное
использование разными workspace users. Для каждого пользователя подготовьте
собственные SYNTX installation, tunnel и private owner-only ChatGPT MCP
app/connection; не направляйте несколько пользователей в один owner process или
tunnel и не делитесь owner credentials. Публичный GitHub repository — это
исходный код, не общий multitenant service.

### Сгенерировать локальный tunnel profile

Установите OpenAI `tunnel-client` отдельно от SYNTX MCP и зафиксируйте версию
`v0.0.19` с [release commit `01d67bb4da0d8359b808b4761f8db171ab682cd7`](https://github.com/openai/tunnel-client/commit/01d67bb4da0d8359b808b4761f8db171ab682cd7).
Контракт команды профиля сверялся с этой версией. Она не входит в зависимости
SYNTX MCP. В чистом checkout проекта выполните команду с вашим `tunnel_id`
(пример ниже нужно заменить):

```sh
umask 077
node scripts/print-chatgpt-tunnel-config.mjs \
  --tunnel-id tunnel_0123456789abcdef0123456789abcdef \
  --api-key-env OPENAI_API_KEY > /absolute/private/path/syntx-tunnel.yaml
```

Команда только печатает конфигурацию JSON, совместимую с YAML. Она не создаёт
tunnel, не читает credentials, файлы или настройки клиента и не проверяет
соединение. Создайте или выберите tunnel в [Platform tunnel settings](https://platform.openai.com/settings/organization/tunnels).
Используйте отдельный runtime API key с необходимыми правами Tunnel Read + Use,
не admin key. Значение секрета задайте только в защищённом окружении
процесса `tunnel-client` как `OPENAI_API_KEY` (или выберите другое имя через
`--api-key-env`); не помещайте значение ключа в профиль или аргументы команды.
Этот ключ нужен для control plane туннеля и не является учётными данными SYNTX
или OAuth пользователя.
Профиль запускает существующий `dist/src/transports/stdio-owner.js` напрямую через
Node, без shell. Он сохраняет owner media settings, принудительно устанавливает
`SYNTX_SELF_UPDATE=0` и отказывается импортировать MCP, пока все operator
placeholders не заменены валидными одноимёнными environment variables. Среди
проверяемых значений — абсолютные `ffprobe`/`ffmpeg` пути и `uploaded` либо
`hidden` upload destination. Вывод ошибки показывает имена отсутствующих ключей,
но не их значения. Профиль открывает all-supported owner media tools, включая
инструменты платной генерации; перед подключением проверьте список и workspace,
где он будет доступен.

Проверьте профиль, затем запустите tunnel-client в foreground; оставьте его
работать, пока ChatGPT открывает connection:

```sh
tunnel-client --version
tunnel-client doctor --profile-file /absolute/private/path/syntx-tunnel.yaml --explain
tunnel-client run --profile-file /absolute/private/path/syntx-tunnel.yaml
```

Проверьте, что версия — `v0.0.19`; для одного tunnel ID не запускайте параллельно
второй stdio tunnel-client. Для ChatGPT создайте custom MCP connection с методом
Tunnel, выберите тот же `tunnel_id`, выполните требуемую account/workspace
авторизацию, затем прочитайте список tools и сделайте безопасный read-only smoke.
После изменения схемы перезапустите MCP/tunnel-client, обновите connection и
откройте новый чат. Это документированный setup path, не результат установки или
приёмки: tunnel, ChatGPT connection, fileParams upload и cloud-inline delivery не
проверены.

У Secure MCP Tunnel есть общий deadline 120 секунд от очереди до ответа и лимит
10 MiB на весь сериализованный request или response envelope (полезная нагрузка
меньше). Эти пределы не доказывают, что долгий SYNTX generation завершится в
окне. Если MCP-ответ не подтвердил конечный результат, используйте соответствующий
GET-only reconcile/recovery инструмент для чтения той же операции; не повторяйте
generation POST вслепую. Ограничения приведены в
[официальном описании туннеля](https://developers.openai.com/api/docs/guides/secure-mcp-tunnels).

Для удалённого агента можно запустить owner-stdio процесс на VPS; это отдельный
способ размещения самого агента и не является готовым ChatGPT connector. После
изменения схемы остановите/перезапустите MCP, затем в ChatGPT обновите connection
или tools и откройте новый чат для read-back. Инструкция OpenAI для
[подключения и проверки в ChatGPT](https://developers.openai.com/plugins/deploy/connect-chatgpt)
описывает setup, account/workspace access, Refresh и проверку в новом чате.

После обновления проекта выполните `syntx-mcp-update apply` либо
`node scripts/update-mcp.mjs apply`, остановите и перезапустите MCP, затем
перезапустите MCP-клиент. Для ChatGPT обновите или переподключите connector/tool
catalog и откройте новый чат, чтобы прочитать актуальную схему инструментов.

Чтобы получить настройки текущих проверенных групп, выполните в source checkout:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-all-supported-media --include-self-update
```

Команда только печатает JSON для ручного добавления в MCP-клиент. Она не меняет
конфиг клиента, не читает учётные данные, не входит в аккаунт и не запускает
платные операции. Подтверждающий флаг обязателен, потому что полученная
конфигурация включает инструменты, которые вызываются явно и могут стоить денег.
Все текущие проверенные группы и self-update не включаются по умолчанию.

Укажите абсолютные пути к доверенным локальным `ffprobe` и `ffmpeg` через
`SYNTX_MEDIA_FFPROBE_PATH` и `SYNTX_MEDIA_FFMPEG_PATH`. Сгенерированные значения
— примеры для вашей ОС; путь отдельной группы можно задать отдельно, и он будет
иметь приоритет. `SYNTX_OWNER_MEDIA_PROFILE=all-supported` выбирает только
группы текущего проверенного набора, а явные значения группы `0`/`1` имеют
приоритет. Неизвестные будущие модели не включаются.
Перед запуском замените каждое значение назначения `<uploaded|hidden>` в JSON
ровно на `uploaded` или `hidden`. Например, укажите `uploaded`; допустимая
альтернатива — `hidden`.

### Self-update

При `SYNTX_SELF_UPDATE=1` MCP регистрирует opt-in обновление. Инструмент
`syntx_update_check` доступен только для чтения. `syntx_update_apply` и
`syntx_update_rollback` доступны на owner-stdio; HTTP-транспорт не получает
мутирующие update-инструменты. Если у установленной сборки npm bin находится
в `PATH`, используйте:

```sh
syntx-mcp-update check
syntx-mcp-update apply
```

В source checkout выполните те же операции через `node scripts/update-mcp.mjs`.
В MCP-чате с включённым self-update можно попросить: «Проверь обновление SYNTX
MCP и установи доступную версию». Check только читает статус; после успешного
apply со статусом `STAGED` остановите текущий MCP и перезапустите клиент вручную.

Apply получает точный текущий commit фиксированного публичного GitHub-репозитория,
включая код и уже bundled каталоги. Он готовит их отдельно, устанавливает зависимости
без lifecycle scripts, собирает код и выбирает подготовленную версию при следующем
старте. Новый live каталог SYNTX он не запрашивает. При ошибке новая версия не
переключается, прежняя остаётся выбранной.
После restart проверить номер версии можно обычным `syntx-mcp-update check`.

Откат выполняется так:

```sh
syntx-mcp-update rollback
```

Затем снова перезапустите MCP-клиент. Подготовленные версии сохраняются; не
удаляйте их вручную. Обновление кода не меняет пользовательский профиль и не
использует аккаунт SYNTX. При новом старте применяются штатные правила account
link; повторный вход может зависеть от сохранённого состояния вашей установки.

Установленная сборка без Git-метаданных поддерживает self-update только после
появления управляемой версии в её указателе. Свежие `npx`, ZIP-архив, fork,
изменённая рабочая копия или старая установка без updater-команды не подходят
для самостоятельного apply. Для такого варианта сохраните настройки MCP-клиента,
создайте новый чистый source checkout командами выше и вручную переключите клиент
на его entrypoint. Старую копию оставьте до успешного запуска новой.

Статус `BUSY` означает, что другой update/rollback удерживает общий lock.
Если после сбоя остался `~/.syntx-mcp-updates/apply.lock`, сначала убедитесь, что
MCP-процесс и updater CLI уже остановлены; проверьте PID внутри lock-файла и
удаляйте его только если указанный процесс не работает. Не удаляйте lock, пока
операция ещё может выполняться. `UNSUPPORTED_INSTALLATION` требует чистого
официального Git checkout или ручной bootstrap-установки. `UPDATE_FAILED` не
меняет рабочий pointer; причину можно разбирать после безопасной проверки
локального места, Git и Node/npm.

Self-update приносит опубликованный код вместе со встроенным public catalog
этого commit. Он не запрашивает свежий каталог SYNTX, не обновляет inventory
источников сайта и не превращает неизвестные элементы управления в поддерживаемый
wire-format. Получение актуального каталога, проверка новых элементов UI и
адаптация кода — отдельные задачи. Сохраняйте версии и явно отмечайте неизвестные
ветви. Карта `syntx_get_media_coverage` связывает текущие model ID с группами
инструментов; она не доказывает полное покрытие настроек или успешную генерацию.

Текущий реестр `owner-tool-routes-v3.json` сохраняет предыдущие v1/v2 snapshots и
добавляет общий reader существующих результатов для `kling_4_keyframes` и
`kling_4_omni`. Его `NO_REFERENCE_ONLY` маршрут использует
`syntx_owner_get_existing_video_recovery` под `SYNTX_OWNER_EXISTING_VIDEO_RECOVERY`;
он читает существующую задачу и не разрешает upload или generation. Реестр не
хранит общее число stdio-инструментов (`owner_tool_count=null`); спрашивайте
`tools/list` у работающего сервера, чтобы узнать текущий состав инструментов.

Kling 4 Keyframes/Omni используют process-local media handles: после перезапуска
они не восстанавливаются. Отдельная no-reference GET-recovery ветка читает уже
существующий результат без нового generation POST; она не принимает reference
handles и не создаёт новую задачу. `provider_terminal_status` остаётся
`UNPROVEN`, а проверка статического профиля не доказывает успешную MCP result-page
доставку клиенту. Для Suno Extend и новых editor-срезов получение текущей формы,
успешная загрузка или HTTP acknowledgement тоже не доказывают появление конечного
аудио/видео. Пока окончательный артефакт не прочитан через точный owner-bound
recovery path, результат остаётся `UNKNOWN`; не повторяйте generation POST.

### Ручной release check

В maintainers repo GitHub Actions запускается вручную через `Actions → Verify`.
Для этого patch выберите `image-file-fix`: он собирает проект, запускает тесты
fileParams/resolver/upload и result links по затронутым image families, а также
export/manifest scope checks. Общая проверка публичного manifest и секретов
запускается как отдельный обязательный шаг workflow. Scope пропускает прежние
FFmpeg media suites и clean package consumer; он не запускает generation.
Для широкого набора изменений выберите `media-update`: он запускает текущие изменённые синтетические тесты,
проверку public manifest и секретов, а также clean package consumer check.
Это один целевой hosted workflow, не матрица полного тестового набора и не
провайдерская приёмка. Выполняйте его только на замороженном точном source SHA.

Каталог, настройки сайта, доступ аккаунта и версия программы — разные вещи.
Новая запись в каталоге не означает готовую генерацию для всех её настроек.
Тариф одного пользователя не определяет общий каталог.

В reviewed V2-контракте могут быть `cost_parameter_bindings`: ограниченные
сопоставления scalar-параметра или literal для preflight. Они входят в хеши
контракта и схемы; caller не может их менять. Это не цена и не лимит списания.
Cost-only поля не добавляются в generation settings. При обновлении проверяйте
вызов cost-helper вместе с переданными ему getter-функциями, а не только список
видимых полей формы: например, Seedance передаёт `duration=0` и `size=aspect_ratio`.


## Снимок каталога от 2026-10-28

Свежий публичный snapshot содержит 211 моделей (173 активных, 38 неактивных)
и отдельный список из 46 LLM-записей. Добавлены `kimi`/`kimi-k3`, а в список
LLM — `gpt-6.1-terra`, `kimi-k3` и `kimi-k3.1-pro`. Новых media model ID
относительно снимка 17 октября не обнаружено. Публичный каталог не подтверждает
доступность в конкретном аккаунте или готовность генерации.

Изменились метаданные Banana 2.1 (лимиты изображений, видео и документов,
включая общий и агрегированный лимиты), список форматов Seedance 2.5 и запрет
кодеков Topaz; `gpt-image-1` стал неактивным. Локальные ограничения загрузки
могут оставаться ниже опубликованных лимитов: передача больших файлов требует
отдельной проверки ресурсов. Эти изменения каталога сами по себе не означают,
что все настройки или ветви UI поддерживаются MCP.

В этом выпуске обычные поиск, карточки и чтение доступа используют новый снимок,
а источники native-профилей остаются привязаны к прежним версиям. Для двух
затронутых Topaz-моделей проверка исходного видео учитывает запрещённые имена
кодеков и FourCC-теги до загрузки. Неизвестные поля API по-прежнему отклоняются;
два подтверждённых новых поля добавлены совместимо со старыми архивами.

Парный Settings2 snapshot охватывает 211 моделей: 124 сопоставлены формам,
87 остаются неизвестными. Снимок использовал ограниченные GET-запросы, но не
пригоден как runtime; UI аккаунта, тариф и приёмка провайдера не проверялись.
Платные операции не запускались. Сравнивайте точные даты и хеши public/settings,
сохраняйте unknowns и исторические source-bound доказательства.

## Проверка изменений

GitHub Actions запускается вручную. Обычный scope `changed-media` собирает
проект на Linux/Node 24.21.0 и выполняет только целевые media synthetic tests,
проверку public manifest/read-safety и Gitleaks. Выберите `full` для прежней
матрицы Ubuntu/macOS/Windows × Node 22.13.0/24.21.0 и полного Linux suite.
Оба scope остаются synthetic: они не подтверждают приём запросов провайдером,
не используют аккаунты и не запускают платную генерацию.

В комплект входит [syntx-mcp-update](../../skills/syntx-mcp-update/SKILL.md).
Его инструкции доступны также через read-only MCP resources:

- `syntx://maintenance/skill`
- `syntx://maintenance/cli-guide`
- `syntx://maintenance/ui-guide`

Попросите агента найти актуальные maintenance tools через `tools/list`.
`syntx_list_update_versions` показывает архивные public/settings версии;
`syntx_plan_mcp_update` сравнивает выбранные версии и строит постраничный план.
Сверяйте парность settings/public, дату источника, неизвестные поля и сохранённый
checkpoint. Public-only проверка не читает Telegram или приватный аккаунт.

В исходном checkout после сборки можно получить точный CLI справочник:

```sh
node scripts/syntx-maintenance.mjs --help
```

Офлайн-сравнение не обращается к сети. `--probe-public` требует отдельного
`--confirm-source-fetch`, делает ограниченные публичные GET и не сохраняет
новые архивы либо selector автоматически. Не подставляйте произвольные URL.

## Адаптация и выпуск

Скилл работает через вашего агента. Для изменения кода нужен writable checkout,
проверки и проверяемый Git diff. Self-update выше готовит точный Git commit и
переключает версию только при следующем старте; он не заменяет работающий процесс
на ходу. Сохраняйте предыдущие версии и возможность отката; не обновляйте процесс
с незавершённой платной генерацией без безопасного сохранения её состояния.

Отдельный UI-аудит может потребоваться для conditional controls. Используйте
только собственный аккаунт и обычную авторизацию; аккаунтные сведения не
помещайте в общий каталог или публичный issue. Просмотр каталога, ресурсов и
плана не разрешает платные запуски, покупку тарифа или публикацию.

Полный автоматический обход будущих интерфейсов, адаптация всех новых моделей
и восстановление оплаченных задач после перезапуска пока не гарантируются.
После UNKNOWN результата повторный POST запрещён: используйте предусмотренный
GET/recovery путь той же операции.

## Локальный файл для standard image reference — 2026-11-05

Source owner-stdio включает отдельный инструмент
`syntx_upload_standard_image_reference_file`. Он принимает `link_attempt_id`,
`variant`, абсолютный `absolute_path` и необязательный `auto_compress` (по
умолчанию `true`). Путь передаётся в вызов MCP как обычная строка; файл читает
локальный MCP-процесс и Base64 не добавляется в аргументы модели.

Для включения добавьте к команде генератора конфигурации повторяемый параметр
`--local-image-root <absolute-directory>`:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-all-supported-media --local-image-root "/absolute/trusted/images"
```

Генератор печатает owner-stdio конфигурацию с
`SYNTX_OWNER_LOCAL_IMAGE_FILES=1` и JSON-массивом абсолютных путей
`SYNTX_LOCAL_IMAGE_ROOTS`. Без `--local-image-root` импорт выключен; Tunnel
профиль также принудительно оставляет его выключенным. Генератор проверяет
абсолютность, но не открывает каталоги. После сохранения обновлённой конфигурации
перезапустите MCP-сервер.

Этот способ рассчитан на owner stdio на компьютере, где доступна папка с
изображениями. Путь к каталогу на Mac не становится доступен процессу на VPS:
там файл должен лежать на самом VPS и находиться внутри его разрешённого root.
Локальный импорт не меняет ограничения ChatGPT на передачу вложений и не
обходит host-side ошибки или allowlists. Работа внешнего ChatGPT fileParams
download через Secure MCP Tunnel остаётся непроверенной.

Порог подготовки определяется для выбранного варианта по закреплённому снимку
публичного каталога `sha256-5f3ae4812d79c993a4162f3289cc9083c04268112f3eac74322d89c6b122b3b0.json`.
Он используется только для локальной подготовки и не меняет общий read-only
выбор каталога MCP.

| Варианты | Предел исходника по каталогу | Цель подготовки | Существующий upload guard |
| --- | ---: | ---: | ---: |
| Banana 2.1 | 20 MiB | 5 MiB | 7 MiB |
| Остальные 9 standard image variants | 32 MiB | 26,25 MiB | 32 MiB |

Это разные этапы, а не подтверждённые provider limits. Исходный файл не
перезаписывается; результат включает policy выбранного варианта с
`provider_acceptance: "NOT_PROVEN"`. Текущие проверки охватывают синтетические
файлы и локальную подготовку. Это общая policy-метаинформация, а не запись
результата двух отдельных запусков ниже. Подтверждены только эти два случая
Banana 2.1, а не все image-модели или настройки.

В двух отдельных реальных owner-stdio процессах подтверждена загрузка по пяти
синтетическим JPEG-референсам в каждом. В каждом запуске синтетический исходник
10 MiB был подготовлен до 4 527 659 байт; оригиналы и их SHA-256 не
изменились. В каждом процессе сделан один generation POST Banana 2.1 с запросом
2K/3:4. Оба ответа содержали JPEG 1792 × 2400 пикселей (2 360 226 и 1 716 986
байт соответственно), строго декодированные ffmpeg. Запрошенные 2K/3:4 — входные
настройки; это не заявление о точном совпадении размеров результата с ними.
Визуальная сверка подтвердила цвета четырёх референсов и текстуру; SHA-256 двух
результатов различаются. Использовались только синтетические изображения, без
данных аккаунта и пользовательских фотографий. Это проверка реального локального
stdio/upload/generation пути, но не ChatGPT cloud connector.

После добавления `--local-image-root` сохраните новую конфигурацию и
перезапустите MCP; затем через `tools/list` проверьте, что зарегистрирован
`syntx_upload_standard_image_reference_file`. ChatGPT fileParams download и
Secure MCP Tunnel по-прежнему не проверялись.

Исправление 2026-11-05 заменило повторяющийся Base64 regex, который переполнял
стек на JPEG около 4 MiB (5 261 296 символов), на линейную проверку. Это
устраняет указанную ошибку локальной валидации, но само по себе не подтверждает
загрузку, не увеличивает upload guards и не исправляет клиентские отказы при
передаче вложения.
