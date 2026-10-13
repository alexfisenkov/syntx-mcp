# Banana Inpaint: источники и границы

Это публичная памятка по реализованному owner-stdio потоку, а не журнал
личных генераций. `banana_inpaint` — форма, не отдельный model ID.
Исходная привязка формы и каталога проверяется кодом; source-only inventory
не разрешает генерацию и не подтверждает доступ текущего аккаунта.

## Поток

После связывания собственного аккаунта загрузите оригинал через
`syntx_upload_banana_inpaint_original`, затем PNG с нарисованными поверх
оригинала мазками через `syntx_upload_banana_inpaint_painted_composite`.
Вторая загрузка использует `original_handle` и тот же `variant`; это
композитное изображение, не произвольная чёрно-белая mask plane.
Дополнительное изображение, если требуется, загружается отдельным
`syntx_upload_banana_inpaint_auxiliary_reference`.

Генерация — `syntx_owner_generate_banana_inpaint_image`. Нужны связанные
handles, явные `variant`, `image_size`, `prompt` и `link_attempt_id`.
Отсутствующий auxiliary reference передаётся как `null`. Полную схему
конкретной версии читайте в `tools/list`; не передавайте upstream URL,
cookies или токены вместо handles. Группы платных инструментов выключены
по умолчанию; их включение не подтверждает тариф или доступ провайдера.

При неопределённом результате не повторяйте generate: используйте только
`syntx_owner_reconcile_banana_inpaint_image` и исходный `recovery_id`.
Список попыток — `syntx_owner_list_banana_inpaint_image_recoveries`, страницы
наблюдённых результатов — `syntx_owner_get_banana_inpaint_image_result_page`.
Конец страницы не означает provider DONE. Восстановление process-local:
сохранность handles и страниц после перезапуска здесь не заявлена.

## Проверяемые границы

The 50 MiB UI-derived file ceiling is not a provider limit. The local input
validator checks container metadata and resource bounds; it creates no
reference handle and grants no generation permission. Mask policy is separate
from original input validation: an original-only reference service does not
replace an owned painted-composite pair. Pixel decoding and provider limits
are not inferred from a successful local validator.

The synthetic installed-package check exercises the installed modules and
their owner, handle, route, cleanup and no-replay guards. It does not prove
provider acceptance or generation permission. A real account, current access
preflight and an explicitly authorised paid request are separate requirements.
No private credentials, account values, provider receipts or user media are
distributed with this guide.
