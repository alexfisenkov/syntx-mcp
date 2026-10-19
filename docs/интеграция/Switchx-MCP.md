# Switchx через owner MCP

Статус: для одного начального вызова MCP вернул два видео, связанные с текущим
индексом, историей и detail (`gaps: []`); оба прошли ffprobe. Это не доказывает
полную поддержку настроек, provider acceptance за пределами этого вызова или
parity с сохранённым UI.

## Подключение

Выполните обычный per-user Telegram-вход (`syntx_begin_login` → подтверждение в своём Telegram → `syntx_check_login`) и используйте его `link_attempt_id`. Не помещайте данные аккаунта или приватные пути в публичные примеры.

По умолчанию группа отключена. Для локального owner stdio задайте `SYNTX_OWNER_SWITCHX_VIDEO=1`, `SYNTX_OWNER_SWITCHX_VIDEO_UPLOAD_DESTINATION=uploaded` или `hidden`, а также абсолютный `SYNTX_OWNER_SWITCHX_VIDEO_FFPROBE_PATH` к доверенному `ffprobe`. Destination — конфигурация оператора, не входное поле MCP.

Текущая команда генератора конфигурации:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-switchx-video
```

Замените placeholders локальными значениями и оставьте только нужные группы. Печать конфига сама по себе не меняет MCP-клиент.

## Инструменты и начальный срез

- `syntx_owner_get_switchx_video_source`: без аргументов; возвращает source pins, `model_id`, `ai_name`, `scope`, `selector`, `initial_tuple`, `settings`, `source_gaps` и статус provider acceptance.
- `syntx_owner_generate_switchx_video`: `link_attempt_id`, `prompt`, `filename`, `mime_type`, `content_base64`.
- `syntx_owner_reconcile_switchx_video`: `link_attempt_id`, `recovery_id`; GET-only.
- `syntx_owner_list_switchx_video_recoveries`: `link_attempt_id`, необязательный `limit` от 1 до 20.

Начальный source-bound срез: `model_id: "switchx"`, AI `beeble`, исходный MP4/MOV ровно `1280×720` до локальных 10 MiB, `720P`, `mask_mode: "auto"`, длительность ровно 5 секунд и 24 fps. Другие исходные размеры, длительности или частоты кадров пока не входят в разрешённый срез. Видео локально проверяется метаданными через `ffprobe`; это не декодирование/проверка каждого кадра. Prompt ограничен 1000 UTF-16 code units локально. Destination `uploaded|hidden` выбирает оператор.

До любого account/quote GET и upload инструмент возвращает типизированную ошибку для входа, который не проходит локальную проверку: `INPUT_VIDEO_NOT_IN_INITIAL_SLICE` для неподдержанной комбинации метаданных, `INVALID_VIDEO` для файла, который нельзя проверить или который не проходит текущие ограничения формата/размера, и `LOCAL_LIMIT_EXCEEDED` при превышении локального 10 MiB лимита. Для текущего кода политики размер кадра вне `1280×720` может классифицироваться как `INVALID_VIDEO`; сообщение ошибки указывает точный начальный срез. Эти ответы возникают до upstream-вызовов и не разрешают расширять его.

Начальная live-операция использовала один upload и один неидемпотентный GEN
POST; позднее исправление штатного collector-а для чтения двух результатов не
создавало новую оплачиваемую генерацию. GET-only MCP reader вернул два видео,
каждое совпало с отдельно проверенным файлом. Оба измерены как H.264
1280×720, 24 fps, 5.000 с, без аудиопотока; размеры — 1 230 874 B и 153 602 B.
Receipt не размечает их как main или mask, поэтому такая роль здесь не
приписывается. Если результат нового вызова неизвестен, не повторяйте POST;
передайте исходный `recovery_id` в reconcile или используйте list. Эти recovery
локальны процессу. Reconcile выполняет GET текущего индекса, ограниченной
истории и двух точных сообщений — owner ACK и ответа с обоими видео.
Quote не является лимитом расхода.

Ответ отделяет наблюдённую доступность от статуса провайдера: `status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"`, `backend_acceptance: "UNPROVEN"`, `provider_terminal_status: "UNPROVEN"`, `cost_cap_enforced: false`. Provider acceptance, parity UI-store, все настройки и E2E на Windows/macOS/Linux остаются непроверенными.
