# Kling Media через owner MCP

Статус: по одному результату для `kling_elements`,
`kling_o1_image2video` и `kling_o1_video2video` возвращено через MCP. Один
прежний `kling_o1_video2video` POST получил HTTP 429 без owner acknowledgement;
этот запрос не повторялся, а позднее результат пришёл по отдельной операции.
Эти данные не доказывают поддержку всех настроек, UI-паритет или provider
terminal status.

## Подключение

Используйте обычный per-user Telegram-вход: `syntx_begin_login`, затем подтвердите вход в своём Telegram и проверьте попытку через `syntx_check_login`. Во все Kling-вызовы передавайте полученный `link_attempt_id`. Не копируйте токены, cookies, идентификаторы аккаунтов или приватные URL в конфиг.

Группа выключена по умолчанию. В конфиге owner stdio включите `SYNTX_OWNER_KLING_MEDIA=1`, задайте `SYNTX_OWNER_KLING_MEDIA_UPLOAD_DESTINATION` как `uploaded` или `hidden` и укажите `SYNTX_OWNER_KLING_MEDIA_FFPROBE_PATH` — абсолютный путь к доверенному `ffprobe`. Получатель загрузки — операторская настройка, не поле вызова. Путь указывайте локально; не публикуйте личные пути.

Текущая команда генератора конфигурации:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-kling-media
```

Оставьте только нужную группу и замените placeholders локальными значениями. Команда печатает конфигурацию, но не включает её в MCP-клиент.

## Инструменты и поля

- `syntx_owner_upload_kling_media_reference`: `link_attempt_id`, `model_id`, `filename`, `mime_type`, `content_base64`. Для `kling_elements` и `kling_o1_image2video` передайте изображение; для `kling_o1_video2video` — исходное видео. Ответ содержит `reference_handle`, `media_type`, `mime_type`, `size`, `sha256`, `width`, `height`, `measured_duration_seconds`, `expires_in_seconds`, `provider_acceptance`, `generation_permit`.
- `syntx_owner_generate_kling_media_video`: `link_attempt_id`, `model_id`, `prompt`, `version`, `mode`, `video_duration`, `native_audio`, `reference_handle`; для image-вариантов также `aspect_ratio`.
- `syntx_owner_get_kling_media_result`: `link_attempt_id`, `recovery_id`; только reconciliation.
- `syntx_owner_list_kling_media_recoveries`: `link_attempt_id`; список только в текущем процессе.

Начальные source-bound tuples: `kling_elements` и `kling_o1_image2video` принимают `version: "1.6"`, `mode: "hd"`, `aspect_ratio: "16:9"`, `video_duration: 5`, `native_audio: false`; `kling_o1_video2video` принимает те же поля без `aspect_ratio`. Для первого варианта локальная схема допускает до четырёх исходных изображений в профиле, но текущий upload-инструмент импортирует один reference за вызов. Это ограничение контракта, а не подтверждение provider поведения. Локальная граница prompt — 1000 UTF-16 code units, не заявленный лимит провайдера.

Пример с заполнителями:

```json
{
  "link_attempt_id": "<current linked attempt>",
  "model_id": "kling_o1_image2video",
  "prompt": "<your prompt>",
  "version": "1.6",
  "mode": "hd",
  "aspect_ratio": "16:9",
  "video_duration": 5,
  "native_audio": false,
  "reference_handle": "<handle returned by upload tool>"
}
```

Вызов generation — один неидемпотентный POST; оценка стоимости не ограничивает фактическое списание. При `UPLOAD_OUTCOME_UNKNOWN` или `outcome_unknown` не повторяйте upload/generation: используйте выданный `recovery_id` только через result GET или list. Recovery и handles хранятся в памяти процесса; после перезапуска они недоступны.

## Наблюдённые начальные результаты

`kling_elements` и `kling_o1_image2video` каждый получили по одному
generation POST с HTTP 200. Для обоих GET-only reconciliation вернул по одному
artifact с `gaps: []`. Запрошенный tuple для каждого:
version `1.6`, mode `hd`, aspect `16:9`, 5 секунд, `native_audio:false` и один
image reference. Для `kling_elements` получен H.264 1920×1080, 5.100000 с,
2 557 303 байта; для O1 image-to-video — H.264 1920×1080, 5.041667 с,
6 332 954 байта. Это два отдельных начальных результата, не доказательство
всей матрицы настроек или provider terminal status.

Для `kling_o1_video2video` один generation POST вернул HTTP 429 без owner
acknowledgement и без возвращённого результата. Не повторяйте его и не считайте
неотвеченный POST успешным.

Отдельная более поздняя операция `kling_o1_video2video` вернула один artifact
для initial tuple `version: "1.6"`, `mode: "hd"`, 5 секунд,
`native_audio:false`; `aspect_ratio` для video-to-video не передавался.
ffprobe измерил H.264 1440×1440 при 24 fps, 5.041667 секунды и 6 994 445 байт.
Это не переигрывание HTTP 429 запроса и не подтверждение других настроек.

## Пределы подтверждения

Результаты подтверждают доступность трёх конкретных output artifacts.
`status_semantics: "LOCAL_OBSERVED_AVAILABILITY_ONLY"`,
`provider_terminal_status: "UNPROVEN"` и `backend_acceptance: "UNPROVEN"` не
подтверждают завершение задания у провайдера, остальные варианты, полноту UI
или E2E на Windows/macOS/Linux.
