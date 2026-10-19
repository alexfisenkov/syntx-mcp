# HeyGen 4 через owner MCP

Статус: source-bound локальный контракт и synthetic SDK-проверки; один
HeyGen4 video artifact получен в начальном image-plus-audio срезе. Это не
подтверждение остальных настроек или UI-паритета. В профиле
`new_uploadable: false`: инструменты не загружают произвольные файлы и не
создают/обучают аватары или голоса.

## Подключение

Пройдите обычный per-user Telegram-вход: `syntx_begin_login`, подтвердите его в своём Telegram, затем проверьте `syntx_check_login`. Дальше используйте полученный `link_attempt_id`.

Группа выключена по умолчанию. Для owner stdio включите `SYNTX_OWNER_HEYGEN4=1` и задайте `SYNTX_OWNER_HEYGEN4_FFPROBE_PATH` как абсолютный локальный путь к доверенному `ffprobe`. Destination для загрузки не задаётся: импортируются только уже принадлежащие аккаунту ассеты. Путь не публикуйте.

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-heygen4
```

Helper печатает конфиг; перед установкой оставьте только нужную группу.

## Инструменты и границы

- `syntx_owner_get_heygen4_source`: без аргументов; возвращает source pins, selector, `initial_tuple`, `settings`, `media`, `source_gaps`, `avatar_voice_training` и `provider_acceptance`.
- `syntx_owner_get_heygen4_parameters`: без аргументов; возвращает `model_id`, `ai_name`, допустимые `aspect_ratios`, MIME, лимит файла, длительность аудио и prompt constraints.
- `syntx_owner_import_heygen4_asset`: `link_attempt_id`, `file_id`, `media_type` (`image|audio`), `filename`, `mime_type`, `content_base64`. Это read-only импорт собственных существующих account assets: локальный файл должен побайтно совпасть с точными байтами выбранного account asset; provenance в ответе — `OWNED_EXISTING_ACCOUNT_ASSET`. Это не upload tool.
- `syntx_owner_generate_heygen4_video`: `link_attempt_id`, `prompt`, `image_handle`, `audio_handle`.
- `syntx_owner_reconcile_heygen4_video`: `link_attempt_id`, `recovery_id`; GET-only.
- `syntx_owner_list_heygen4_recoveries`: `link_attempt_id`.

Начальный срез — одно изображение и одна аудиодорожка, соотношение сторон `16:9` (также типом разрешён `9:16`), локально измеренная длительность аудио от 2 до 120 секунд. Выбор существующего ассета сейчас требует `file_id`; соответствие выбору в UI — открытый gap. У импортированного изображения ответ содержит размеры, у аудио — длительность; import не передаёт provider URL.

Одна генерация — один POST. При неизвестном исходе не повторяйте запрос: вызовите reconcile по исходному `recovery_id` или list. Recovery хранится только в памяти процесса. Quote не ограничивает фактическое списание. Один начальный результат измерен ниже; все UI-настройки и E2E на Windows/macOS/Linux не подтверждены. Обучение/создание голоса или аватара здесь не реализованы.

## Наблюдённый начальный результат

Для начального image-plus-audio среза возвращён один video artifact. ffprobe
измерил H.264 1920×1080 при 25 fps, видеопоток 8.000 секунд; AAC — 48 kHz,
стерео, 8.002 секунды. Контейнер длится 8.002 секунды и занимает 3 832 281
байт. Разница между длительностью видеопотока и контейнера относится к этому
файлу; это не доказательство точной длительности или полной поддержки других
настроек. Импорт остаётся read-only по точным байтам существующих account
assets, произвольная загрузка по-прежнему выключена.
