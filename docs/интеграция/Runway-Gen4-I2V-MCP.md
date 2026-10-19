# Runway Gen-4 I2V через owner MCP

Статус группы — **экспериментальная**. Она предназначена для локального owner
stdio-контура и покрывает только `4genfirstframeimage` и
`turbo4genfirstframeimage`. 19 октября 2026 через MCP получено реальное MP4
для Turbo: один подготовленный PNG, `1:1`, 5 секунд, `seed: null`. Проверены
H.264, 960×960 и длительность 5,04 секунды. Это один наблюдённый сценарий,
не подтверждение всех вариантов, Gen-4 без Turbo или будущей доступности.

## Что поддерживается

На один запрос принимается одно собственное изображение, уже обрезанное до
выбранного соотношения сторон. Допустимы `21:9`, `16:9`, `4:3`, `1:1`, `3:4`
и `9:16`. MCP не выполняет crop или resize. Локальная начальная поддержка
форматов ограничена PNG, JPEG/JPG и WebP; AVIF сюда не входит.

Длительность задаётся явно как `5` или `10` секунд. Единственное поддерживаемое
значение `seed` — `null`. Выбирайте точный `model_id`: Turbo не подставляется
автоматически. Локальная граница prompt — 1000 UTF-16 code units.

Файл ограничен 10 MiB как локальный предел обработки. Публичная запись каталога
указывает `max_file_size: 0`; это неизвестное ограничение провайдера, а не
«безлимит». Проверка читает контейнерные метаданные и не декодирует все пиксели.

## Подготовка stdio

В репозитории требуется Node.js не ниже 22.13.0; проект рекомендует и проверял
Node.js 24.21.0. Из корня checkout соберите owner stdio entrypoint:

```sh
npm ci
npm run build
```

Флаг Runway I2V выключен по умолчанию. Для минимального owner stdio-конфига,
включающего только чтение account status и Runway I2V, задайте две независимые
переменные:

```json
{
  "mcpServers": {
    "syntx": {
      "command": "/absolute/path/to/node",
      "args": ["/absolute/path/to/checkout/dist/src/transports/stdio-owner.js"],
      "env": {
        "SYNTX_OWNER_ACCOUNT_STATUS": "1",
        "SYNTX_OWNER_RUNWAY_I2V": "1"
      }
    }
  }
}
```

Замените только два пути-заполнителя на свои абсолютные пути. Для Runway I2V
не нужны `ffprobe`, новые зависимости, аккаунтные данные в конфиге или
дополнительные operator-пути. Account-status — отдельный read-only инструмент;
до его включения оператор должен принять актуальные условия SYNTX через UI.

Можно попросить helper напечатать конфигурацию с флагом
`--confirm-enable-paid-tools` и `--include-runway-i2v`:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-runway-i2v
```

Helper печатает общий owner-media конфиг с другими включёнными группами и их
operator placeholders, например путями `ffprobe`. Это не настройка клиента и
не автоматический запуск. Перед использованием оставьте только нужные группы
и заполните placeholders остальных групп либо удалите их.

## Вход в аккаунт

Используйте обычный per-user Telegram-вход MCP. Вызовите
`syntx_begin_login`, подтвердите handoff в своём Telegram и проверьте попытку
через `syntx_check_login` с возвращённым `attempt_id`. Для
`syntx_get_account_status` передавайте этот `attempt_id` как
`link_attempt_id`. Во всех четырёх Runway инструментах используйте тот же
`link_attempt_id`; не передавайте токены, cookies, tenant или subject.
Минимальный конфиг не задаёт постоянный private auth profile, поэтому после
перезапуска процесса потребуется снова войти.

Account status может вернуть ошибку, если актуальные условия SYNTX ещё не
приняты через пользовательский интерфейс. Не используйте этот инструмент для
обхода ожидающего подтверждения.

## Инструменты

1. `syntx_owner_upload_runway_i2v_image` принимает
   `link_attempt_id`, `model_id`, `aspect_ratio`, `filename`, `mime_type` и
   канонический padded `content_base64`. Подходящие расширения — `.jpg`/`.jpeg`,
   `.png` и `.webp` согласно MIME. Ответ содержит непрозрачный
   `reference_handle` и проверенные локальные метаданные, но не URL загрузки.
2. `syntx_owner_generate_runway_i2v_video` принимает тот же `link_attempt_id`,
   `model_id`, `prompt`, `aspect_ratio`, `video_duration` (`5` или `10`),
   `seed: null` и `reference_handle`.
3. `syntx_owner_get_runway_i2v_result` принимает `link_attempt_id` и исходный
   `recovery_id`; это только чтение уже начатой операции и, если результат
   наблюдался, возвращает безопасную ссылку на видеоартефакт.
4. `syntx_owner_list_runway_i2v_recoveries` перечисляет recovery текущего
   `link_attempt_id` в работающем процессе.

Фрагмент входа для загрузки (замените строку base64 данными собственного
изображения):

```json
{
  "link_attempt_id": "<current linked attempt>",
  "model_id": "4genfirstframeimage",
  "aspect_ratio": "16:9",
  "filename": "first-frame.png",
  "mime_type": "image/png",
  "content_base64": "<standard padded base64 image bytes>"
}
```

Генерация использует текущие проверки подписки, доступа, цены и баланса.
Сравнение текущей оценки с балансом — проверка доступности, не жёсткий лимит
списания. Фактическая цена может отличаться; вызов генерации может повлечь
расходы.

## Неизвестный результат и пределы подтверждения

Не повторяйте загрузку или генерацию после `UPLOAD_OUTCOME_UNKNOWN` либо
`outcome_unknown`. Если выдан `recovery_id`, используйте `get_runway_i2v_result`
или список recovery; повторный POST не является способом ожидания. Reference
handles действуют 15 минут. Recovery и защита от повтора находятся только в
памяти процесса и теряются после его перезапуска.

Помимо локальных проверок подтверждён один описанный выше живой Turbo-сценарий.
Другие модели, AVIF, значения seed помимо `null` и другие сочетания настроек
не заявляются как проверенные вживую. Регистрация инструментов
сама по себе не подтверждает provider acceptance, terminal status или
списание.
