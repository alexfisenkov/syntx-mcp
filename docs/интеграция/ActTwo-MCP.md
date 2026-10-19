# ActTwo через owner MCP

Статус: один ActTwo artifact получен через read-only MCP result reader. Это
подтверждает возврат одного существующего результата, но не поддержку всех
настроек или UI-паритет. Начальный wire содержит пустой prompt `""`: это
инженерный кандидат; поле prompt в интерфейсе выглядит отключённым, и
соответствие между UI и этим wire остаётся открытым gap.

## Подключение

Используйте обычную per-user Telegram-авторизацию (`syntx_begin_login`, подтверждение в своём Telegram, `syntx_check_login`) и передавайте текущий `link_attempt_id`.

Группа выключена по умолчанию. Для owner stdio включите `SYNTX_OWNER_ACTTWO=1`, задайте `SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION` как `uploaded` или `hidden` и абсолютный `SYNTX_OWNER_ACTTWO_FFPROBE_PATH` к доверенному исполняемому `ffprobe`. Путь и destination — локальная операторская конфигурация; не вставляйте приватные пути в публикуемые примеры.

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-acttwo
```

Проверьте и сократите выведенный конфиг до нужных групп; helper только печатает его.

## Импорт и вызовы

- `syntx_owner_upload_acttwo_performance_video`: `link_attempt_id`, `filename`, `mime_type: "video/mp4"`, `content_base64`. Принимается MP4 до локальных 20 MiB; `ffprobe` должен подтвердить ровно 5 секунд. Ответ включает `reference_handle`, `sha256`, `width`, `height`, `measured_duration_seconds: 5`, `probe_confidence`, `upload_authority: false`, `generation_permit: false`.
- `syntx_owner_upload_acttwo_character_image`: `link_attempt_id`, `filename`, `mime_type` (`image/jpeg` или `image/png`), `content_base64`. Ответ включает handle, SHA-256, размеры и локальные метаданные; пиксели полностью не декодируются.
- `syntx_owner_generate_acttwo_video`: `link_attempt_id`, `model_id: "acttwo"`, `aspect_ratio: "1:1"`, `seed: null`, `expression: 3`, `character_image_handle`, `performance_video_handle`. Prompt не принимается как аргумент; wire отправляет `prompt: ""` согласно текущему engineering candidate.
- `syntx_owner_get_acttwo_result`: `link_attempt_id`, `recovery_id`; только GET reconciliation.
- `syntx_owner_list_acttwo_recoveries`: только `link_attempt_id`; список recovery текущего процесса.

В wire первым передаётся performance video, затем character image. История API может возвращать их в другом порядке: результат связывается по роли и точному reference, а не позиции в истории. Вызов генерации — ровно один POST; неизвестный исход не повторять. Для проверки используйте выданный `recovery_id` через GET или list. Локальная оценка доступности/стоимости не является пределом списания.

Начальный wire фиксирует ratio `1:1` на входе и native значение `"11"`, `seed: null`, `expression: 3`, длительность performance video 5 секунд. Жесты опущены, потому что локальный тип не задаёт их значение; не придумывайте параметр для gestures. Один результат для этого начального среза получен; остальные комбинации не проверены.

## Наблюдённый результат

Read-only MCP result reader вернул один существующий ActTwo video artifact с `gaps: []`;
сам reader не выполнял upload или generation. ffprobe измерил H.264 960×960,
24 fps, 5.000 секунд, 560 975 байт. Это один возвращённый artifact, не
доказательство полной матрицы настроек или провайдерного terminal status.
Исправление привязки истории сопоставляет медиа по роли и reference независимо
от порядка; оно не меняет неопределённые результаты других операций.
