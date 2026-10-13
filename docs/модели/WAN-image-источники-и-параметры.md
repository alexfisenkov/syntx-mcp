# WAN Image — параметры и ограничения MCP

Это описание source-bound реализации, не гарантия текущего доступа,
provider acceptance, стоимости или полноты настроек сайта.

Точные варианты: `wan_25_i2i_preview`, `wan_26_image`, `wan_27_image`,
`wan_27_image_pro`; семейство `wan_image`. Настройки задаются явно:
`aspect_ratio`, `resolution`, `batch_size`, `prompt_extend`, `seed`,
`color_palette`, `bbox_list`. Реальные enum и conditional ограничения
определяются нормализатором и схемами MCP-инструментов текущей версии.

- WAN 2.5: 720P, 1–3 references; WAN 2.6: 720P/1080P, 1–4 references.
- WAN 2.7: 1K/2K, 0–9 references; Pro: 1K/2K/4K, 0–9 references.
  Pro 4K с reference отклоняется, а не незаметно меняется на 2K.
- batch_size: целое 1–4; prompt_extend: boolean; seed: null либо целое
  0–2147483647. Palette/bbox разрешаются только в соответствующих ветках.
- Вход проверяется структурно; размеры контейнера не доказывают декодированные
  пиксели или естественные размеры изображения в браузере.

Группа выключена по умолчанию; stdio opt-in —
`SYNTX_OWNER_WAN_IMAGE_REFERENCES=1`. Инструменты:

- `syntx_upload_wan_reference_image`
- `syntx_owner_generate_wan_image`
- `syntx_owner_reconcile_wan_image`
- `syntx_owner_list_wan_recoveries`

Используются собственный linked account и непрозрачные reference handles,
не переданные пользователем storage URL. До генерации проверяются свежие
сведения аккаунта/точной модели; cost inputs не являются quote или hard cap.
Генерация не повторяется после UNKNOWN. Получение результата и восстановление
используют предусмотренный GET-путь; file MIME по расширению — локальная
инференция, не подтверждение декодера. Число и готовность выходных объектов
не следует выводить только из настроек запроса.

Восстановление зависит от конкретной версии и остаётся process-local.
Restart-safe recovery, upstream cancel, текущий тариф и полноценная HTTPS
multi-user установка здесь не заявлены. Не включайте платные команды без
понимания их стоимости и не помещайте account/session/media данные в GitHub.
