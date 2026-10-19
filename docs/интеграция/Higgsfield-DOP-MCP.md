# Higgsfield DOP через owner MCP

Статус: узкий source-bound срез проверен на конкретных вызовах. Для `dop-lite`
MCP вернул один видеоартефакт после одного GEN HTTP 200; для `dop-turbo` свежий
вызов с выбранным движением получил один GEN HTTP 200, а GET-only MCP reader
вернул видео с `gaps: []`. Предыдущий отказ при пустом `motions` — отдельное
историческое состояние, не относится к этим вызовам. Это не доказывает все
настройки, стабильное качество, billing или жёсткий лимит списания.

## Включение

Группа owner stdio выключена по умолчанию. Отдельный opt-in:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-higgsfield-dop
```

К выводу добавляются:

```json
{
  "SYNTX_OWNER_HIGGSFIELD_DOP": "1",
  "SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION": "<uploaded|hidden>"
}
```

Замените placeholder на `uploaded` или `hidden`, выбрав доверенное значение для
локального owner runtime. Destination не передаётся в MCP-параметрах генерации
и не добавляется в `video/generate` body. Для этих двух image-входов `ffprobe`
не нужен. Сам генератор конфигурации ничего не устанавливает и не обращается к
сети. Сначала проверьте общий owner-конфиг и оставьте только нужные группы.

Без точного `--confirm-enable-paid-tools` конфигурация не печатается; он должен
стоять первым. Флаг DOP независим от других media opt-in.

## Начальный поддерживаемый срез

Поддерживаются только точные model ID `dop-lite` и `dop-turbo`; оба принадлежат
`ai_name: higgsfield`, `scope: video`. Один запуск принимает одну локально
проверенную картинку. Явные параметры:

- `model_id`: `dop-lite` или `dop-turbo`;
- непустой `prompt`, локально не длиннее 1 000 UTF-16 units;
- `enhance_prompt`: только явно переданное `false`;
- `motions`: от одного до двух точных объектов текущего каталога, каждый
  `{id,label,strength:1}`. Сохраняются исходный тип ID и title как label; ID
  должны быть уникальны с учётом типа.

Пустой `motions` невалиден в форме; прежний отказ с пустым массивом не является
результатом корректно выбранного движения. Используйте
`syntx_owner_get_higgsfield_dop_motions` для получения актуальных picker-объектов
перед генерацией. Одно фактически прочитанное меню содержало 117 движений;
число — наблюдение конкретного чтения, не гарантия постоянного размера. MCP
повторно читает каталог перед созданием чата и ещё раз
перед единственным GEN; каждое выбранное сочетание ID-типа, ID-значения, label
и `strength:1` должно совпасть с ответом свежего чтения. Не заменяйте ID
названиями, не конвертируйте числа в строки и не переносите сохранённый список
между попытками.

Предел prompt в локальном коде — консервативная защитная граница, не лимит
провайдера. Значение `max_prompt_length: 0` в сохранённом каталоге не
интерпретируется как отсутствие ограничения. Поддерживаемый локальный формат
картинки — JPEG, PNG или WebP; локальная граница 10 MiB, 8 400 пикселей на
сторону и 52,5 млн пикселей. Это ограничения ресурсов локального процесса, не
провайдерские пределы. Изображение не обрезается и не масштабируется; aspect
ratio не выводится из формы.

## Инструменты

- `syntx_owner_upload_higgsfield_dop_image` — принимает owner link attempt,
  model ID, filename, MIME и `content_base64`; возвращает непрозрачный handle,
  но не URL.
- `syntx_owner_import_higgsfield_dop_image` — read-only альтернатива для уже
  загруженного собственного файла. Передайте те же локальные байты и явный
  `file_id` из первой страницы uploaded-files, `destination:"uploaded"`.
  MCP читает запись аккаунта и объект с разрешённого R2-хоста без credentials,
  сравнивает байты по SHA-256 и выдаёт account-bound handle. Provider `hash`
  не интерпретируется. Нет повторной загрузки, поиска по другим страницам или
  fallback к upload. Если запись не найдена или байты отличаются — отказ.
- `syntx_owner_get_higgsfield_dop_motions` — read-only authenticated GET текущего
  каталога. Возвращает только нативные `id`, `label` (из `title`) и фиксированный
  `strength:1`, плюс безопасные source provenance. Поле `preview_uri` из API
  намеренно не возвращается.
- `syntx_owner_generate_higgsfield_dop_video` — принимает model ID, prompt,
  `enhance_prompt:false`, один или два picker-объекта и выданный image handle. Другие поля,
  включая aspect, duration, resolution, seed и destination, отклоняются.
- `syntx_owner_get_higgsfield_dop_result` — GET-only reconciliation.
- `syntx_owner_list_higgsfield_dop_recoveries` — ограниченные сводки текущего
  процесса.

Перед chat creation и перед единственным generation POST читаются текущие
подписка, баланс, quote с пустым набором дополнительных cost-параметров и
свежий каталог motions. Каталог привязан к текущей owner link attempt.
Сопоставление quote с балансом — проверка affordability на момент чтения, не
жёсткий лимит списания. При неизвестном исходе upload или generation не
повторяйте ту же операцию; generation восстанавливается только GET-запросами.
Reference handles привязаны к владельцу и истекают через 15 минут. Recoveries
привязаны к владельцу и текущему процессу и исчезают при его перезапуске.

В успешном вызове `dop-lite` использовано одно уже загруженное собственное PNG:
MCP импортировал его read-only с точной сверкой байтов, без upload POST. Один
GEN POST получил HTTP 200; GET-only MCP reader вернул видео с `gaps: []`.
Измеренный файл: H.264 1280×1280, 30 fps, 5.366667 с, без аудио, 26 918 160 B.
Успешный tuple использовал корректный picker-объект `Dolly In` с
`strength:1`.

Для `dop-turbo` отдельный свежий вызов также импортировал то же собственное PNG
read-only, без upload POST, и использовал `Dolly In`. После одного GEN HTTP 200
GET-only MCP reader выполнил три GET и вернул видео с `gaps: []`. Измеренный
файл: H.264 960×960, 30 fps, 5.366667 с, без аудио, 11 736 778 B. Это и Lite
подтверждают только эти два конкретных tuple, не все настройки, качество на
других входах, billing или жёсткий лимит списания.

Ранее полученная ошибка для попытки с пустым `motions` остаётся отдельным
историческим состоянием. В другой закрытой попытке owned API вернула error
object с `completed: true`, но без видео; это не ready result и не подтверждение
причины или billing. Эти случаи нельзя смешивать с новым Lite-артефактом или
считать основанием для повтора. Последующий read-only reader выполнял только
index/history/detail GETs, без upload и generation; ошибки наружу передаются
типизированно и без сырого provider error text. Не повторяйте неизвестный upload
или POST.

## Источник и границы

Статический профиль связан с source build `1792363638`, формой `higgsfield.js`
SHA-256 `507dff986465c97c051c7081a6152acfadf51436c3419018b65dd69b2910873a` и
сохранённым public catalog
`sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json`.
Обе записи каталога содержат `get_cost_params: []`; это не означает нулевую
стоимость. Дополнительная форма `app.js` (2 450 053 bytes, SHA-256
`e32c91600ed5d82cac8ecad6fe7261cfaab7e43a8da3344b73c60600379f15e9`) задаёт
API base `https://api.syntx.ai/api/v1/` и вызывает
`GET /higgsfield/motions` без query. Ответ — массив `{id,title,preview_uri}`.
Source offsets: Axios-base initializer `1 874 869–1 874 906`, factory
`1 870 927–1 874 863`, export `2 447 249`.
Передача `settings.motions` в `video.js` сохраняет выбранные объекты без
преобразования. Picker допускает 1–2 выбора и отправляет ровно
`{id,title-as-label,strength:1}`; `enhance_prompt` инициализируется значением
`true`, но явный выбор `false` допустим. Текущий конкретный Lite-вызов вернул
видео, а Turbo получил acknowledgement, но ожидает результат. Эти единичные
наблюдения не доказывают остальные настройки или жёсткий лимит расхода;
исторический `completed: true` у error object не является видео-результатом.
