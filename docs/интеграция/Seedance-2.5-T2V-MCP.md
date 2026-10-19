# Seedance 2.5: начальный T2V через MCP

Обычная модель `seedance-2.5`, не Seedance Editor. Группа выключена по умолчанию.
Независимый opt-in `SYNTX_OWNER_SEEDANCE25_T2V=1` либо печать шаблона:

```sh
node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools --include-seedance25-t2v
```

Шаблон содержит другие owner-группы; оставьте необходимые и заполните их
operator placeholders. Печать ничего не устанавливает, не входит в аккаунт
и не генерирует. Для этой T2V-группы нет upload destination или ffprobe.

После обычного per-user Telegram-входа вызовите
`syntx_owner_generate_seedance25_t2v_video` с `link_attempt_id`, явным prompt
до локальных 5000 UTF-16 units, `resolution:"720p"`, `aspect_ratio:"16:9"`,
`video_duration:5`, `generate_audio:true`. Режим фиксирован профилем как
`omni-references`; отдельный аргумент mode не принимается. Это явный кандидат
для пути выбора Seedance 2.5 из другого режима, а не заявление о полном
post-watcher состоянии интерфейса. Источник связывает модель `seedance-2.5` с
режимом `omni-references` в model watcher (`seedance2.js` helper `O`, offsets
4295–4341, watcher 5328–6937, присваивание 6694–6711; helper export join
`S as w`, `M as B`, `o as q` → `seedance-2.5`, `omni-references`,
`seedance-2.0`). Предыдущий профильный кандидат `mini` совпадал с начальным
initializer, но для запроса с HTTP 400 после выбора модели он снят; это не
доказывает, что режим был единственной причиной отказа. Отдельная исходная
ветка для Seedance 2.0 действительно назначает `mini`.

Узкий срез сохраняет `720p`, `16:9`, 5 секунд, audio on и пустой список файлов.
Один live-вызов именно с этим начальным tuple получил HTTP 200/acknowledgement,
а GET-only reader вернул видеоартефакт. Это подтверждение конкретного пути, не
покрытие других ветвей `frames`/`extend`/`edit` или всех состояний интерфейса.
Отсутствующий в source initializer `camera_fixed` не отправляется. Файлы, seed,
mode от вызывающего и дополнительные настройки не принимаются.

Для этого явного кандидата quote-проекция содержит пять ключей:
`video_duration:5`, `duration:0`, `mode:"omni-references"`, `size:"16:9"`,
`resolution:"720p"`. Режим следует model watcher; `duration:0` сохраняет
источником подтверждённый fallback и не означает бесплатную генерацию.
Наблюдавшийся HTTP 400 остаётся результатом конкретного quote-запроса; он не
доказывает сбой backend. Перед POST проверяются подписка и доступ к модели.
Жёсткого ограничения фактической стоимости нет.

Результат возвращает ссылки на проверенные видеоартефакты. После неизвестного
исхода не повторяйте GEN: используйте исходный `recovery_id` с
`syntx_owner_get_seedance25_t2v_result`; список текущего процесса доступен в
`syntx_owner_list_seedance25_t2v_recoveries`. Recovery не переживает перезапуск.
`syntx_owner_get_seedance25_t2v_source` раскрывает срез и его источники без сети.

Для одного вызова этого среза owner получил HTTP 200 и acknowledgement; затем
GET-only reader вернул связанный с текущим индексом, историей и detail видео
(`gaps: []`). Повторный GEN не выполнялся. Измеренный файл: H.264 1280×720,
24 fps, видео 5.041667 с; AAC 32 кГц stereo, контейнер 5.056 с, 3 229 754 B.
Это подтверждает только данный начальный вызов и возвращённый артефакт, а не
все настройки, состояние всего интерфейса, другие тарифы или универсальное
поведение провайдера.
