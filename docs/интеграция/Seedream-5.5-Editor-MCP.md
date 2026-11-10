# Seedream 5.5 Editor через MCP

Это отдельная текущая ветка Editor для `seedream-5.5`. Прежние Editor инструменты и профили сохранены. Группа включается существующим `SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES=1` или профилем `all-supported`. Источник: публичная пара49f41bb1…/0a03f8d2…, build1794311734; точные hashes и роли в `catalog/seedream55/editor-source-v1.json` и `src/application/owner-seedream55-editor-source-profile.ts`.

1. Прочитать `syntx_get_seedream55_editor_parameters`. Это статические controls/limits, без проверки аккаунта.
2. Выполнить обычный вход текущего пользователя через `syntx_begin_login` и Telegram, затем `syntx_check_login`. Проверить свежий баланс/подписку через `syntx_get_account_status`.
3. Загрузить исходное изображение `syntx_upload_seedream55_editor_original`: `link_attempt_id`, `content_base64`, переносимое `filename`, `mime_type`. Не более27 525 120 байт. Возвращается приватный opaque `reference_handle`, действующий15минут; URL входного файла не выдаётся.
4. При необходимости загрузить `syntx_upload_seedream55_editor_drawing` с тем же link, `original_handle`, PNG base64/filename/mime. Drawing должен иметь размеры исходного изображения, его локальный предел32MiB. Это рисунок холста без базового изображения, а не бинарная маска. Он связан именно с этим original.
5. Вызвать `syntx_owner_generate_seedream55_editor_image`, явно указав nullable `drawing_handle`:

```json
{
  "link_attempt_id": "<current linked attempt>",
  "variant": "seedream-5.5",
  "prompt": "Измените цвет объекта, сохранив его форму и композицию.",
  "original_handle": "<original reference_handle>",
  "drawing_handle": null,
  "parameters": {
    "aspect_ratio": "1:1",
    "resolution": "1K",
    "output_format": "png",
    "background": "transparent"
  }
}
```

Доступны8 ratios,1K/1.5K/2K,`jpeg`/`png`,фон`auto`/`opaque`/`transparent`. Прозрачность требуетPNG; alpha у original не обязательна. Вызов расходует SYNTX credits после двух свежих account/access проверок. Quote использует `batch_size:1` без drawing или2 с drawing и `resolution`; batch_size не задаёт число выходных файлов. Числовой cap биллинга не обеспечивается upstream-контрактом.

При `OUTCOME_UNKNOWN` не повторять GEN. Сохранить тот же процесс/attempt и `error.recovery_id`, затем вызвать **GET-only** `syntx_owner_reconcile_seedream55_editor_image` с `link_attempt_id` и `recovery_id`. Результат может ещё не быть готов; повторять только bounded GET. `syntx_owner_list_seedream55_editor_recoveries` перечисляет handles этого attempt. `syntx_owner_get_seedream55_editor_result_page` читает уже наблюдённый cache по `result_id`, `offset`, `limit`; учитывать `has_more`/`next_offset`.

Готовый result содержит owned artifact links. Ширина, высота, прозрачность и декодирование выходного файла проверяются отдельно после скачивания: параметры запроса сами по себе не подтверждают свойства результата. Локальная реализация/source/fake tests не означают проверку всех тарифов и сочетаний настроек. Recovery process-local; после потери процесса восстановление этими handles не обещается. Не обновлять/перезапускать runtime, пока платный intent остаётся неопределённым.
