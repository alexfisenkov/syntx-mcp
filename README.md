# MCP для SYNTX AI

Расширяемый MCP для каталога, per-user Telegram linking, account-scoped
проверок доступа/стоимости и медиагенерации SYNTX AI в явно указанном покрытии.

## Текущий статус

`ACTIVE_DEVELOPMENT_MEDIA_PRIORITY` — актуальное продолжение 2026-10-17.

### CURRENT2216 — нативный контракт Seedance 2.5 Editor

Добавлены отдельный профиль редактора, строгая проверка параметров и внутренняя
сборка запроса с одним исходным видео, без кадров-референсов. Команда
`syntx_get_seedance_editor_source` доступна без входа и сети: показывает
закреплённые источники, разрешения `480p`/`720p`/`1080p` и ограничения.
Локальный ключ `seedance-2.5-editor` не является строкой публичного каталога;
реальный upstream использует `seedance-2.5`, `mode=edit`, `ai_name=seedance`
и scope `tool_video_inpaint`.

Это ещё не работающая генерация Editor: цена/доступ, проверенная загрузка,
отправка и получение результата требуют дальнейшей интеграции. Профиль явно
возвращает `dispatch_allowed=false`, `runtime_usable=false` и
`backend_acceptance=UNPROVEN`. Неизвестные ограничения не заменяются значениями
из обычного Seedance T2V. Старые платные запросы не повторялись.

### Исторический CURRENT2210-FINAL — реальный WAN MP4 и обновлённый public main

Public main/dev: `0c951d3`, source `48286af`, ONECI38991922103 SUCCESS:
2 security PASS; неизменённые build/media и полная OS-матрица не запускались.
WAN2.7 Video Edit дал один MP4 через MCP: H.264,1280×720,2s,312655B,
полное декодирование PASS;1upload/1chat/1GEN, только GET-recovery, сеанс закрыт.
Новый Suno Extend на ownV6 после успешных guards дал UPSTREAM_OPERATION_ERROR
без аудио; закрыт/NO_REPLAY, причина и billing неизвестны. Cover/STS прежние
MP3-кейсы не повторялись. Все private receipts и актуальные долги — в
[точке продолжения](docs/проект/текущий-handoff.md).

Открыты Seedance Editor, остальные model/settings сочетания, hosts/OS,
HTTPS/durable recovery и billing. Накопленные статусы ниже — история, не
основание повторять закрытые платные intents. Полная цель остаётся ACTIVE.

### Исторический CURRENT2118-FINAL — опубликована Veo Omni reference-ветка

Последний закрытый публичный выпуск — `63fb1f6`, финальная CI38949162723:
84 PASS/0 FAIL/1 SKIP. Соединены собственные image/video references Omni: проверка
файла, загрузка, пользовательские handles, явные настройки, две проверки
цены/баланса/подписки, единственная генерация и GET-only результаты. Новые
MCP-команды, общая сборка, основной runtime и сквозной SDK-сценарий проверены
локально с синтетическими HTTP-ответами. Код уже в public main; реальный
результат Omni пока не подтверждён.
Точка продолжения: [handoff](docs/проект/текущий-handoff.md).

### Исторический CURRENT1996 — опубликован отдельный Topaz Enhance MCP

Актуальная рабочая точка: [release1996](.autopilot/2026-10-08-syntx-completion--wip/release1996-topaz-enhance.md).
В public main/dev находится `6b94bf16`; финальная CI38889947194 прошла 40
проверок. Шесть новых default-off Enhance-команд дали один реальный локальный
MCP-результат: upload1/generate1/GET-reconcile1/page/download/fullFFmpegdecode.
Сессия закрыта, manifest consumed, приватные медиа/доступы не опубликованы.
Ниже сохранён накопленный обзор; его старые counts не заменяют текущие
release/handoff/debt. Общая цель ACTIVE: Extend producer, Flux3 I2V/V2V,
полная матрица настроек/клиентов/OS/HTTPS/restart/billing ещё не закрыты.

### Подтверждённые кейсы и ограничения

Seedream Editor получил по одному реальному live owner-run для каждого из пяти
вариантов. Всего выполнено ровно пять generation POST — по одному на модель;
две неопределённые операции (`seedream-5` и `seedream-5.0-pro`) восстановлены
тем же MCP-клиентом только через GET, без повторного POST. У `seedream-4`
ответ остался `partial_results`; во всех случаях наблюдалось по одному файлу,
но provider terminal status и полный count не доказаны. Это пять отдельных
настроек, не live-проверка всех 104 сочетаний или drawing. [Подробности и локальные примеры](docs/интеграция/Seedream-Editor-MCP.md).

В коде появилась новая необязательная группа из пяти WAN T2V MCP-команд; она
выключена по умолчанию и включается owner-local флагом
`SYNTX_OWNER_WAN_T2V_VIDEOS=1`. Изолированные SDK fixtures проверили обе
модельные ветки и локальную выдачу 80 результатов страницами 64+16. Root1033
прошёл полный локальный набор и packed gate; более поздние изменения проверяются
отдельно. Реальный WAN26 дал скачанный и декодированный MP4, но его первая MCP
recovery потребовала исправить текстовый ACK. Поздний WAN27 Root1041 получен
fresh owned GET Root1075 без нового generation POST. Файл скачан и декодирован;
семантика native_audio=false остаётся непроверенной: в файле есть ненулевая
AAC-дорожка (DEBT-080). Это не полное
provider-покрытие видео и не подтверждение restart recovery.
Параметры WAN 2.6/2.7 T2V остаются source-only: `runtime_usable=false`,
`dispatch_allowed=false`, `backend_acceptance=UNPROVEN`.

WAN 3.0 Text to Video (`wan_30_t2v`) добавлен отдельной веткой в существующую
группу из пяти owner-stdio команд под default-off флагом
`SYNTX_OWNER_WAN_T2V_VIDEOS=1`; она отправляет максимум один POST, затем читает
результаты через GET. Команда параметров принимает необязательный
`model_id`; generation требует явно передать семь controls: `resolution`,
`aspect_ratio`, `video_duration`, `prompt_extend`, `seed`, `native_audio` и
`rendering_speed`: разрешения `480P`/`720P`/`1080P`, пять обычных ratio
(`16:9`, `9:16`, `1:1`, `4:3`, `3:4`), целая длительность 2–30 секунд,
boolean для prompt extension и native audio, nullable seed 0–2147483647 и
скорость `basic`/`prime`. Проверки account/access используют закреплённый
19C-каталог.
В cost preflight передаются `resolution`, `video_duration`, `duration` и
`rendering_speed`; `duration=0` — отдельное поле wire, не синоним
`video_duration`. Global E551 не изменён. Adaptive ratio исключён из локального
профиля, поскольку его wire value не связан с источником. Video Edit,
First & Last Frame, Reference и image-only Omni имеют отдельные
default-off owner-stdio группы.

Отдельный обычный UI-пилот дал HTTP 200 и декодированный результат 854×480,
2 секунды; это не MCP-кейс. В другом реальном MCP-пилоте `wan_30_t2v` через
официальный SDK и InMemory transport единственный вызов генерации вернул
`OUTCOME_UNKNOWN`; два GET-only reconcile того же
recovery привели к `COMPLETED` с одним артефактом. Его страница результата была
прочитана, файл скачан по HTTP 200 и полностью декодирован FFmpeg: H.264,
854×480, 2 секунды, 933 315 байт. В этом одном MCP-кейсе были явно переданы
`480P`, `16:9`, 2 секунды, `basic`, prompt extension включён, `seed=null` и
`native_audio=false`; входных загрузок не было. Биллинг и provider terminal
status не подтверждены; жёсткого cost cap нет. Это не доказательство всех
controls, MCP-хостов, установленного stdio-пакета или HTTPS. Профиль параметров
прошёл focused 5/5, coherent build и два новых MCP-flow теста прошли; synthetic
проверки остаются отдельным доказательством. Непроверенные настройки и другие
входные варианты WAN 3.0 не считаются покрытыми.

WAN 3.0 Reference и image-only Omni имеют по шесть команд загрузки, генерации,
GET-only восстановления и результата под флагами
`SYNTX_OWNER_WAN30_REFERENCE_VIDEOS=1` и `SYNTX_OWNER_WAN30_OMNI_VIDEOS=1`.
Каждый отдельный реальный SDK/InMemory MCP-кейс загрузил один собственный PNG,
отправил одну генерацию Basic/480P/2s/16:9, восстановил тот же recovery через
GET, прочитал MCP-страницу и скачал полностью декодируемый MP4. Reference:
1 074 168 байт; Omni: 912 463 байта. Сеансы и временные ресурсы закрыты.
Подтверждения owner-сообщения теперь сопоставляются по типам text/image,
независимо от порядка, с сохранением точного model/owner/ID/prompt/URL binding.
Omni-пилот и изменения опубликованы в `c125a02`; одна финальная CI прошла 45
проверок. Это отдельные настройки/входы, не полная матрица, установленный stdio,
HTTPS, все MCP-хосты или доказательство биллинга/terminal status. Recovery
процессный; неопределённую генерацию повторять нельзя. Детали текущего выпуска:
`.autopilot/2026-10-08-syntx-completion--wip/release1915-wan30-omni.md`.

WAN 3.0 First & Last Frame (`wan_30_first_last_frame`) теперь имеет отдельные
шесть owner-stdio tools под `SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS=1`; helper
конфигурации включает группу только после подтверждения платных tools.
Загрузка по ролям `first_frame`/`last_frame` выдаёт opaque handles без URL;
generate требует два handles и явный локальный tuple Basic/480P/2s/16:9,
prompt_extend=true/seed=null/native_audio=false. PNG/JPEG до 7 MiB — локальный
ресурсный предел, не provider maximum; один кадр/прочие controls не включены.
В одном фактическом SDK/InMemory MCP-пилоте два собственных синтетических
PNG загрузились успешно, ONE GEN→UNKNOWN→два same-GET recovery→COMPLETED1.
MCP-страница результата, HTTPS200 download и полное FFmpeg-декодирование дали
896400B/H264/854x480/2s; повторная генерация не выполнялась. Все ресурсы
закрыты, PID/socket/tempdir отсутствуют, файл private600 сохранён. Это
LOCAL_MCP_REQUEST_RECOVERY_ARTIFACT_MATCHED для одного кейса, не подтверждение
provider source-pair/terminal/billing, полной матрицы, installed stdio/HTTPS/
всех MCP-хостов. Recovery процессный. Трасса: root1836-first-last-mcp-pilot.md.

WAN 2.6 R2V и R2V Flash опубликованы как восемь default-off owner-stdio
команд. В одном live-пилоте Flash генерация осталась `OUTCOME_UNKNOWN`, артефакт
не получен; причина неизвестна. Регулярная модель live не проверялась. Выпуск и
synthetic SDK/CI проверки не доказывают успешную генерацию у провайдера.

Четыре точные модели ElevenLabs TTS получили отдельную private owner-цепочку:
голос → явные настройки → два свежих preflight → один POST → owned audio GET.
Root1054 независимо проверил 72 теста на Node24.21, включая шесть MCP tools,
owner-stdio, auth-cache isolation и cleanup. Затем все четыре модели дали
настоящие MP3 через MCP: четыре POST, четыре GET-only восстановления, четыре
скачанных и декодированных файла. Это одна настройка/один доступный голос на
модель. Installed synthetic checker отдельно проверил 884 сочетания controls
и обнаружил исправленную ошибку дробного шага .05; финальный npm-packed gate
фиксируется в PROGRESS. [Инструкция](docs/интеграция/ElevenLabs-TTS-MCP.md).

Suno Generate получил отдельный opt-in для точных `V6` и `V6_wild`, с явными
параметрами и GET-only восстановлением. Дополнительный read-only tool
`syntx_owner_list_suno_track_inputs` показывает только ограниченные opaque
handles из уже просмотренных собственных результатов. Handles process-local и
по умолчанию действуют до 15 минут (жёсткий предел — 30 минут); этот read-only tool не выполняет HTTP,
генерацию или Cover/Extend. Root1079 strict Node24.21/58 focused, full3425/MJS319
PASS. Оба варианта дали реальные MP3 через MCP без повторного POST; gap-enum и
zero-ready pending исправлены. Загрузка в Cover/Extend, публичные права и
durability после перезапуска не обещаются.
[Инструкция и ограничения](docs/интеграция/Suno-Generate-MCP.md).

Для Cover/Extend над собственным актуальным Suno track handle добавлена
отдельная группа из шести owner-команд; она использует тот же default-off
флаг `SYNTX_OWNER_SUNO_GENERATION=1`. Новая цепочка имеет точные режимы `V6`
и `V6_wild`, process-local handles/recovery и запрет повторной отправки при
`outcome_unknown`. SDK и установленный synthetic checker подтверждают только
локальный контракт. Два реальных Cover-пилота — `V6` и `V6_wild` — дали по два
MP3 после GET-only recovery; файлы полностью декодированы. Это подтверждает
только эти два случая, не всю матрицу настроек или качество результата. Extend
не дал подтверждённого аудио в текущих пилотах. Это не общий знак готовности
provider. Ошибка операции возвращается типизированно; если
ответ неизвестен, запрос нельзя отправлять повторно. [Инструкция Cover/Extend](docs/интеграция/Suno-Cover-Extend-MCP.md).

Для подключения уже реализованных медиа-групп есть явный config helper:
`node scripts/print-media-mcp-config.mjs --confirm-enable-paid-tools`.
Он печатает локальный JSON, не меняет настройки, не выполняет вход/генерацию
и не читает секреты. [Краткая инструкция](docs/интеграция/Быстрое-подключение-медиа.md).

WAN 2.5 I2V preview подключена отдельной default-off группой только для
owner-stdio: `SYNTX_OWNER_WAN25_I2V_PREVIEW=1`. Это image-only слой для точной
модели `wan_25_i2v_preview`; optional input-audio ветка UI не подключена к
native-контексту, а `native_audio` фиксирован в `false`. Локальные SDK/stdio
synthetic checks не подтверждают провайдера, тариф или terminal status.
[Ограничения и инструкция WAN25 Preview](docs/интеграция/WAN-2.5-Preview-MCP.md).
Editor и Clarity сохраняют GET-only recovery дольше входного 15-минутного TTL;
лимиты памяти, связь с владельцем и запрет replay остаются. Перезапуск всё
ещё не сохраняет эти задачи автоматически.

Owner Editor flow подключает загрузку оригинала/рисунка, генерацию, GET-only
recovery и страницы результатов к семи MCP-командам и owner-stdio. Изолированные
native/service/SDK/runtime проверки используют synthetic fetch; установленный
пакет и реальный provider — отдельные gates.
Точная текущая точка продолжения и незавершённые video/audio gates —
[PROGRESS](.autopilot/PROGRESS.md); исторические checkpoints ниже её не заменяют.
Локальная source-документация read-only диагностики recovery видео: [инструкция](docs/интеграция/Диагностика-видео-MCP.md).
Она описывает текущий исходный код и не означает включение инструмента в опубликованный пакет.

Ближайший приоритет владельца: изображения и связанные настройки, результаты,
reference/edit и upscale; затем видео, аудио и другие медиа. Уже сделанные
текстовые компоненты сохраняются, но новые задачи по text-generation и
расширению LLM-покрытия сейчас не ставятся впереди медиа. Это порядок работ,
а не заявление о полноте или готовности генерации.

Полная цель MCP остаётся активной и незавершённой. Точка продолжения и открытые
ограничения: [текущий handoff](docs/проект/текущий-handoff.md).

### Ideogram: owner image + Precise Edit mask chain — Tasks708/716/717/724–733/737, 2026-10-11

Локально связаны generation/recovery service, 5 MCP tools и отдельный
owner-stdio composition; без mask service регистрация сохраняет обычный набор
из 4. Все девять source contexts сохранены; восемь принимают ordinary image
references. Generate принимает точный `context: {model_id, mode}`, явные
controls, упорядоченные opaque handles и `num_images` 1–8; Reframe требует
`prompt: null` и сериализует пустую строку только локально. Строгий флаг
`SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES=1` по умолчанию выключен; default и HTTP
поверхности не расширялись.

Отдельный `syntx_upload_ideogram_mask` принимает точную попытку, первый ordinary
handle и painted RGBA PNG Base64. Локально alpha>0 трактуется как painted;
сервер формирует две обратные opaque polarity PNG и выдаёт один непрозрачный
mask handle только после подтверждения обеих hidden uploads. Для `precise_edit`
при маске допускаются 1–4 ordinary handles, без неё — 1–5; маска не добавляется
к source cost `ref_count`. Это local byte/role chain, не proof provider effect.

Generation проверяет linked principal/source binding, делает два свежих
account/model-access preflight по точным cost inputs, затем использует максимум
один native POST. Recovery остаётся GET-only/process-local, unknown не вытесняется;
исходные 15 минут не продлеваются. Результат и recovery показывают
`mask_present` и `mask_acceptance`; для маски acceptance остаётся `UNPROVEN`,
поскольку это контекст частного запроса, а не provider echo или подтверждение
эффекта. Task708 также устранил исчерпание кэша от истёкших завершённых intents.
Это не durable recovery или exactly-once гарантия.

Локальные PNG/resource ceilings, TTL по минимуму исходного expiry base и
15-минутному максимуму, а также cache/D131 guards не меняют provider limits и
не подтверждают browser/runtime geometry. Mode и namespace остаются
source-shaped/unverified, backend acceptance — `UNPROVEN`. Сверяйте
поля `root_tests`, `final_package` и `whole_completion` в [Root727 QA](.autopilot/2026-10-08-syntx-completion--wip/root-727-owned-mask-upload-qa.json):
это динамические source of truth; root tests и финальный package пока могут быть
pending. Не переносите worker/focused PASS в root-level claim. Реальный
provider/account/tariff/billing, host, durable recovery и общие media gates не
закрыты.
Практический контракт: [Ideogram MCP](docs/интеграция/Ideogram-MCP.md),
[D-140](docs/проект/решения.md), [DEBT-076](docs/проект/незакрыто.md) и
[handoff735](.autopilot/2026-10-08-syntx-completion--wip/handoff-735-owned-ideogram-masks-and-next-images.md).

### Flux: actual public LoRA assets + full owner MCP — Tasks653/659/661/662, 2026-10-11

Для Flux-1, Pro 1.1 и Ultra реализован локальный generation path с 18 source
resolutions, явными numeric controls и process-local GET recovery. Flux-1
поддерживает одну owned image reference и 0–3 выбранных LoRA; веса остаются
упорядоченными, `strength_clip` должен совпадать с `strength_model`. Pro/Ultra
не принимают references. Источник параметров — локальная source policy, а не
доказательство фактического UI default или provider acceptance.

Five owner MCP tools: `syntx_upload_flux_image_reference`,
`syntx_register_flux_public_lora`, `syntx_owner_generate_flux_image`,
`syntx_owner_reconcile_flux_image`, `syntx_owner_list_flux_image_recoveries`.
Они появляются только при точном owner-stdio флаге
`SYNTX_OWNER_FLUX_IMAGE_REFERENCES=1`; default и HTTP surfaces остаются без
них. Generation закрывает asset service, тот — upload service; EOF и revoke
должны дренировать generation до освобождения auth-контекста.

Public LoRA registry принимает только выбранные version/file IDs и создаёт
opaque handle после actual streamed SHA-256 + SafeTensor structure attestation.
Это не license approval, entitlement, backend acceptance или разрешение на
dispatch. Private R2 LoRA writer/receipt остаётся `OPEN`; считать закрытыми
можно только public Civitai файлы, прошедшие этот verifier. MCP не принимает
URL, доступы провайдера, provenance/witness flags или storage-origin
approval. Default transport одобряет Civitai origin; recorded 401 и
неподтверждённый storage/CDN origin означают, что текущая live LoRA readiness
не доказана.

Неизвестный результат не запускается повторно: reconciliation и recovery list
— bounded, GET-only и process-local; нет restart durability, upstream cancel
или global exactly-once гарантии. Reference TTL — исходные 15 минут, без
renewal. Ограничение 128 состояний с отказом при переполнении не вытесняет
неразрешённые intents. Upload image ceiling 32 MiB и LoRA stream ceiling 1 GiB
— локальные resource caps, не provider limits. MIME — только по URL extension,
geometry остаётся `false`; cost inputs `{}` не означают бесплатную операцию.
Backend/provider/account/tariff/billing и реальный host UI не подтверждены.

Сверяйте текущие `source_gate` и `installed_package` в [Root658 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-658-flux-concrete-assets-qa.json),
не переносите старый package PASS на новый source tree. Замороженные источники:
[Task653 asset service](src/application/owner-flux-image-asset-service.ts),
[Task659 generation](src/application/owner-flux-image-generation-service.ts),
[Task661 MCP schemas/tools](src/mcp/owner-flux-image-tools.ts),
[cold handoff663](.autopilot/2026-10-08-syntx-completion--wip/handoff-663-flux-full-generation-next.md)
и [Flux guide](docs/интеграция/Flux-изображения.md). Точные тестовые метрики и
zero-external-action counts остаются в receipt.

### Runway / Flux / Seedream image work — Tasks603–618, Root618

Root618 подтвердил общий source gate для замороженных Tasks611/612/615:
typecheck и build прошли, полный suite — 2 200/2 200, combined focus — 34/34,
форматный focus 615 — 12/12. Runway SDK runtime проверяет fresh preflight и
отказывает до chat POST; drain проверен перед revoke/EOF. Это синтетические
локальные проверки. Checker 616 заморожен и прошёл 5/5 compiled SDK/schema
regressions; installed-package checker и финальный package smoke ещё pending.
Runway инструменты доступны только при явном owner-stdio флаге
`SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES=1` и выключены по умолчанию; HTTP и общая
конфигурация не расширялись. Это не доказательство provider acceptance,
аккаунта, тарифа или billing.

Seedream Flash/Pro source admission теперь включает корректные ограниченные
GIF-анимации и TIFF page chains на уровне метаданных: локальные caps — 256
кадров и 32 IFD, не provider limits и не decoded-pixel/browser proof. BMP
композиции, HEIF grid и другие неподдержанные варианты остаются ограничениями.
Текущие статусы и доступные метрики — в соответствующих полях
[Root618 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-618-runway-native-integrated-qa.json);
финальный installed-package результат будет внесён после package run и
документационного freeze. См. [guide](docs/интеграция/Параметры-Flux-Seedream-Runway.md),
[D-134](docs/проект/решения.md) и [DEBT-072](docs/проект/незакрыто.md).

### Previous checkpoint — Seedream full source/native owner flow; early Flux metadata boundary — Tasks621–641

Этот раздел фиксирует более ранний snapshot до Tasks653/659/661. Его
Root642/package assertions относятся только к тогдашнему Seedream surface;
для сегодняшнего общего source/install/package статуса авторитетен Root658 и
его динамическое поле `installed_package`. Упоминание ниже, что Flux byte
attestor и full generation отсутствовали, историческое и не описывает текущий
source tree.

Замороженные Tasks634/635 добавили process-local owned upload и полную локальную
generation orchestration для всех пяти Seedream вариантов; 639/640 подключили
четыре owner MCP tools и owner-stdio composition. Root637 содержит source QA,
а Root642 — актуальные поля final source/install/package gate; установочный
статус читать по его `new_seedream_native_surface` и `final_package`, не
подменять предыдущим source-only результатом. Локальные focused suites:
634 — 12/12, 635 — 11/11, 639 SDK — 7/7, 640 runtime — 6/6; это не provider
acceptance и не установленный-клиент proof.

MCP names: `syntx_upload_seedream_image_reference`,
`syntx_owner_generate_seedream_image`, `syntx_owner_reconcile_seedream_image`,
`syntx_owner_list_seedream_image_recoveries`. Все пять вариантов сохраняют
104 source ratio/resolution сочетания и четыре явных параметра; у четырёх
не-Flash вариантов `output_format` и `background` обязательны как `null`.
Flash поддерживает явные JPEG/PNG и opaque/transparent ветви, но transparency
проходит только через private owned-PNG witness. Pro cost inputs — число
references, включая ноль, плюс `resolution`; это не wire `batch_size`, цена,
тариф или списание. Source image ceilings остаются локальными parser/resource
ограничениями, а не provider upload limits.

Owner tools доступны только при `SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES=1` в
owner-stdio; по умолчанию они выключены, default catalog, HTTP и общая
конфигурация не менялись. Upload/reference TTL ограничен 15 минутами;
recovery — process-local с lifetime scope D-131, без restart durability,
отмены upstream или production multi-user гарантии. Root637/642 фиксируют
нулевые новые реальные SYNTX auth/account/upload/generation вызовы; account,
тариф, provider acceptance и billing не доказаны.

Task638 проверил пять публичных Civitai metadata-запросов без загрузки весов.
Model ID, model-version ID и file ID различаются; для текущего среза
version availability не сообщалась. Метаданные SHA-256 и `size_kb` не являются
attestation скачанных байтов: content оставался `NOT_CHECKED`, а динамический
download redirect не был подтверждён **на этом прежнем checkpoint**. Tasks648/649
и 653 позже добавили pinned transport, streamed byte/SHA/SafeTensor attestor и
attempt-bound public Civitai LoRA registry; Tasks659/661 добавили full Flux
generation и пять MCP tools. Private R2 ownership/writer остаётся открытым.
Публичные metadata, URL и license flags сами по себе не дают asset ownership
или разрешения использовать вес.
Проверяйте точные текущие поля в [Root637](.autopilot/2026-10-08-syntx-completion--wip/root-637-seedream-services-qa.json),
[Root642](.autopilot/2026-10-08-syntx-completion--wip/root-642-seedream-final-installed-package.json)
и [handoff643](.autopilot/2026-10-08-syntx-completion--wip/handoff-643-seedream-native-and-flux-next.md).
Параметры и ограничения: [guide](docs/интеграция/Параметры-Flux-Seedream-Runway.md),
[D-136](docs/проект/решения.md), [DEBT-074](docs/проект/незакрыто.md); исходный
чекпоинт сохранён в [D-135](docs/проект/решения.md) / [DEBT-073](docs/проект/незакрыто.md).

### Исторический срез — Banana/GPT Image local admission, Tasks546–551

Для пяти Banana и пяти GPT Image вариантов добавлен source-bound локальный
профиль явных параметров и metadata: 198 и 396 settings-комбинаций, отдельно
65 и 62 image reference-count контекста. Это admission, не десять нативных
генераторов: upload/reference binding, generation, history/result и MCP/runtime
capabilities не следуют из этого слоя. Профили остаются `dispatch_allowed=false`,
runtime не активируется, backend acceptance не доказан. Каталожные cost keys
не дают сумму/валюту/hard cap; `max_file_size=0` и `max_prompt_length=0` не
означают неограниченные серверные значения. Подробности и source pins:
[параметры Banana и GPT Image](docs/интеграция/Параметры-Banana-и-GPT-Image.md),
[D-130](docs/проект/решения.md), [DEBT-068](docs/проект/незакрыто.md).
Root552 actual Node24.21 QA: compiled+CLI 1 996/1 996, focused 16/16,
typecheck/build/audit/diff exit 0. Initial fixture-prototype failure was fixed
in test data only; production guard did not change. Final all-source MJS after
checker repair: 191/191 (fail/cancel/skip 0); actual Node24 helper 4/4. The
first installed-package wrapper exposed a checker expectation bug for GPT
Image 2.5 at zero references: it expected `{}` and dropped quality fields.
Checker only was fixed; production code remains unchanged. A compiled regression
now covers 594 settings plus 127 reference-count cases, including GPT 2.5
zero/nonzero cost inputs. Root554 сделал три свежих
анонимных public GET: 41 AI / 200 models / 44 LLM, без добавлений, удалений или
изменений нормализованных строк; raw hashes `ai`/`models` изменились, поэтому
зависимые source proofs требуют перепроверки. Это не UI, account/plan или
provider acceptance. Second final installed-package wrapper ещё ожидается;
авторитетный статус будет в `Root552.final_package` / Root553 receipt.
См. [Root554 scope](.autopilot/2026-10-08-syntx-completion--wip/root-554-public-catalog-probe-intent.json).

### Banana/GPT Image native flow — Tasks562–573, Root580

Для всех десяти вариантов локально реализованы image validation/upload,
private owned references, полный source-bound request, one-shot generation,
exact history/result binding и process-local GET recovery. Только Banana 2.1
принимает поддерживаемые video/PDF inputs. Root577 earlier service-only QA:
2 084/2 084 compiled, focused 88/88, source MJS 191/191,
typecheck/build/audit/diff exit 0.

Root580 прошёл actual Node24.21 integrated source/SDK QA: 2 099/2 099
compiled, standard focus 103/103, typecheck/build/audit/diff exit 0. Четыре MCP
tools и default-off owner-stdio composition локально реализованы и SDK-verified.
На момент docs-freeze поля `Root580.source_mjs` и `Root580.final_package` были
`PENDING_579_FULL_JS_FREEZE` и `PENDING_ALL_SOURCE_DOCS_CHECKER_FREEZE`;
актуальный статус — в этих полях [Root580 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-580-standard-native-integrated-qa.json).
Live provider acceptance is unproven.
См. [native guide](docs/интеграция/Генерация-Banana-и-GPT-Image.md),
[parameters](docs/интеграция/Параметры-Banana-и-GPT-Image.md),
[D-131](docs/проект/решения.md), [DEBT-069](docs/проект/незакрыто.md) и
[Root580 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-580-standard-native-integrated-qa.json).
Public/default/V2 catalog selectors, existing MCP resources and the canonical
update skill remain unchanged; default, HTTP and global activation are not added.

### WAN image source/native flow — Tasks507–530, Root531 integrated QA

Для четырёх точных WAN-вариантов теперь есть source-bound параметры и профиль,
проверка локального входного файла, private owned-reference upload, точная
батчевая history/result-связка, generation service и четыре owner MCP tools.
Отдельный owner-stdio opt-in — `SYNTX_OWNER_WAN_IMAGE_REFERENCES=1`; по
умолчанию tools выключены, HTTP и общий runtime не расширены.

Source/native flow прошёл интегрированную локальную QA Root531 на actual
Node24.21: compiled+CLI 1 973/1 973, WAN all-layers 115/115, source MJS после
Task534 184/184, installed-checker focus 10/10; typecheck/build/audit/diff exit
0. Шесть runtime cases реально исполнены, без source-only skip. Checker focus —
локальная проверка, не tarball package verification. Это не подтверждает
provider acceptance, billing, browser geometry, client-host UX или production
readiness. Root533 проверит installed package после docs freeze. Подробности:
[WAN параметры](docs/модели/WAN-image-источники-и-параметры.md),
[native integration](docs/интеграция/WAN-source-and-native-integration.md),
[DEBT-067](docs/проект/незакрыто.md), [D-127/D-128](docs/проект/решения.md) и
[текущий handoff](docs/проект/текущий-handoff.md), [Root531 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-531-full-wan-mcp-runtime-qa.json).

### G02 — maintenance kit / Root500–502, 2026-10-10

Добавлены локальный report-only compare/probe CLI, portable `syntx-mcp-update`
skill и три default read-only MCP resources. Root501 выполнил scoped install в
пять совместимых локальных targets и проверил точные SHA четырёх файлов; копии
навыка для Краба и облачных клиентов не менялись. Root500 сделал три анонимных bounded GET
только к public catalog: строки моделей не изменились (41 AI / 200 models /
44 LLM), но hashes источников `ai` и `models` изменились, поэтому зависимые
доказательства требуют пересмотра. Архивы и селектор по умолчанию не менялись.

Root502: Node24.21 full/CLI 1,858/1,858, source MJS 174/174, focused
engine/resources/CLI 30/30, typecheck/build/audit 0. Первый installed-package
smoke на 984 entries подтвердил bin, offline compare, packaged skill/resources
и сохранённые архивы; это **предварительный** пакет до этой документационной
правки. На момент этого docs-freeze `Root502.final_package=PENDING`; актуальный
результат сверять с полем `final_package` в [Root502 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-502-update-kit-integrated-qa.json).

G02 — `PARTIAL`, не полная поддержка обновлений: реальный обход всех UI-кнопок
и conditional branches, own-account тариф/доступ, новые неизвестные UI/model
ветви, автоматическая end-to-end адаптация к будущему source drift и
client-host UI не проверены. CLI/resources дают сравнение и инструкции, но не
выполняют UI audit или source adaptation сами. [Гайд](docs/интеграция/Обновление-MCP.md),
[Root500](.autopilot/2026-10-08-syntx-completion--wip/root-500-live-maintenance-public-probe.json),
[Root501](.autopilot/2026-10-08-syntx-completion--wip/root-501-local-update-skill-install.json),
[Root502](.autopilot/2026-10-08-syntx-completion--wip/root-502-update-kit-integrated-qa.json),
[DEBT-066](docs/проект/незакрыто.md), [D-126](docs/проект/решения.md).

### Текущая точка — Tasks470/472/473/480/481, 2026-10-10

G01 остаётся `ACTIVE`: images/settings/results/references/edit/upscale прежде видео, аудио и других media. Уже существующие text-компоненты сохраняются; новая text-generation не является gate. Полная цель не выполнена.

Для трёх точных e551-вариантов (`flux-kontext-pro`, `flux-kontext-max`, `flux-kontext-multi`) реализован полный owner-local flow: private reference upload, fresh account/model-access checks с empty cost inputs `{}`, source-bound request candidate, one-shot native POST, exact history/result binding, process-local GET-only recovery, четыре MCP-инструмента и отдельный owner-stdio opt-in `SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES=1`. По умолчанию инструменты выключены; HTTP/default/global surfaces не расширялись.

Все четыре controls и prompt обязательны; только controls caller-controlled, остальные пять wire settings server-derived/private. Reference count: Pro/Max 0–1, Multi 1–4; пустой Pro/Max set кэшируется per principal/attempt/variant в пределах original TTL, без renewal. Known pre-dispatch denial может быть исправлен на unspent handles; возможный/unknown GEN не replay-ится. Output MIME — только по URL extension; `input_images` несёт шесть source-owned metadata полей с confidence `CONTAINER_METADATA_ONLY`; output geometry false/unknown. Provider acceptance, cost units/hard cap/billing и получение результата конкретным host-клиентом не доказаны.

Root482 свежая source/native QA: typecheck/build exit 0, compiled Node24.21 suite 1,828/1,828, Kontext focus 97/97, source MJS 163/163, audit 0 vulnerabilities, diff-check 0. Все новые тесты synthetic/fake-fetch; новых реальных auth/upload/generation calls — 0. На момент этого docs-freeze установленный package smoke ещё не запускался; authoritative статус — поле `installed_package` в [Root482 QA receipt](.autopilot/2026-10-08-syntx-completion--wip/root-482-full-kontext-qa-result.json), которое Root обновит после package run. Это отдельная граница от provider, billing и client-host acceptance. Полный обзор и открытые границы: [Kontext guide](docs/интеграция/Kontext-source-and-native-integration.md), [текущий handoff](docs/проект/текущий-handoff.md), [матрица покрытия](docs/проект/матрица-покрытия.md), [DEBT-065](docs/проект/незакрыто.md), [D-125](docs/проект/решения.md).

### Исторический checkpoint — Tasks456–475 / Root474, 2026-10-10

На предыдущем checkpoint был готов только native foundation; full service, MCP и runtime/stdio ещё не были подключены. Root474: typecheck/build/audit/diff exit 0; 1,799/1,799 compiled tests; actual Node24.21 Kontext focus 68/68; source MJS 158/158; без новых реальных auth/upload/generation calls. Root476 package receipt и Root452 Magnific package относятся к более ранним snapshot-ам и не являются proof текущего полного Kontext пакета. См. [Root474 QA](.autopilot/2026-10-08-syntx-completion--wip/root-474-kontext-foundation-qa-result.json) и [Root476 receipt](.autopilot/2026-10-08-syntx-completion--wip/root-476-final-kontext-foundation-package.json).

### Исторический checkpoint — Task448 / Root450–452, 2026-10-10

Magnific имел отдельный default-off owner-stdio flow для трёх вариантов; полный receipt и тогдашние границы сохранены в [Task448 report](docs/проект/отчёт-2026-10-10-task448.md) и [Root452 package receipt](.autopilot/2026-10-08-syntx-completion--wip/root-452-final-installed-package.json). Его проверки и упаковка являются историческим доказательством только для того code/package snapshot, а не для нынешнего Kontext foundation.

### Исторический checkpoint — Task286, 2026-10-10

Root283's older upload/gen/reconcile case remains `GENERATION_OUTCOME_UNKNOWN`, exact rejected predicate and provider/job/result/billing unknown; no replay. Task285 separates requested chat UUID from provider chat IDs, without retroactive attribution. Task282's Soul shape diagnostic was separately default-off/read-only. Historical counts and QA remain historical, not the current package receipt. See [D-115](docs/проект/решения.md), [Root287](.autopilot/2026-10-08-syntx-completion--wip/root-287-chat-binding-soul-shape-verification.json).

### Исторический checkpoint — Task210, 2026-10-09

Последний explicit V2 child — `sha256-8a24f8adbcd3505d310495dcb64b39fcc059fb943d8cea29c3d3b99bbb5d4b9c.json`: 53 rows, 14 `live_verified`, 39 `reviewed`; 29 image IDs (9 с live tuple, 20 reviewed-only) и 11 video IDs (2 live). Остаются 12 из 41 active image IDs без generation contracts и все 4 upscalers без `upscale-image` contracts. Child сохраняет точные 52 corrected parent rows `28ec6392…`. 19 legacy fixed direct-owner image profiles — отдельный набор. Public e551/default selector не менялся.

Task185 добавил один exact Seedream Flash JPEG profile: `1K / 1:1 / opaque`, `n=1`, `stream=false`, references пусты. Root182 подтверждает один isolated source-probe результат: JPEG 324 481 байт, 1024×1024, один dispatch, один Telegram receipt/ACK, без retries/recovery; unlink прочитан как `REVOKED`, parent завершился с exit 0, private handoff очищен. Это не обычный promoted runtime, клиентский host, visual/full-pixel или billing proof. [Root182 proof](.autopilot/2026-10-08-syntx-completion--wip/root-182-flash-proof.json), [Task185](.autopilot/2026-10-08-syntx-completion--wip/result-185-seedream-flash-exact-live-curation.md).

Root202 Pro 1.1 exact case запросил `1152x896`, получил JPEG 217,220 bytes `1024x768` (byte SHA `3b9af451…d9d951ed`) и остался `reviewed`, не promoted; причина mismatch неизвестна (DEBT-059). Root204 наблюдал один Ultra JPEG 621,299 bytes `2048x2048` (byte SHA `897f05ce…b4b1561f5e`); Task205 добавил только этот tuple как live-verified. Это isolated evidence, не ordinary runtime/client-host acceptance и не гарантия других settings. Root186 watch/cache ordering gap остаётся открытым, Root187 фиксирует выбранную no-LoRA client policy. См. [Root202](.autopilot/2026-10-08-syntx-completion--wip/root-202-flux-pro-proof.json), [Root204](.autopilot/2026-10-08-syntx-completion--wip/root-204-flux-ultra-proof.json) и [Task205](.autopilot/2026-10-08-syntx-completion--wip/result-205-flux-ultra-exact-live-profile.md).

Task203 добавил один reviewed client-intent WAN 2.5 T2I profile; это не UI defaults/provider acceptance. Root207/208 описывают следующий Grok I2I reference source plan, но reference admission ещё не реализована.

G01 остаётся ACTIVE: image-first, затем video/audio; существующие текстовые компоненты сохраняются, новая text-generation не становится gate. Root209 reports build/typecheck PASS, suite 1 417/1 417, 19 focused tests, source MJS 56/56 and audit 0. Root211 post-doc `package:smoke` PASS на code checkpoint `036f19e`: 800 entries, 8 public-catalog и 21 V2 contract versions, tarball clean-install/offline guards PASS; auth/upload/generation=0. Stock SDK read-only validation remained schema-only (`runtime_usable=false`, `pid=null`), не обычная generation acceptance. Final package rerun after the latest docs receipt edits is still pending Root. См. [Root209](.autopilot/2026-10-08-syntx-completion--wip/root-209-image-wave-verification.json), [Root211](.autopilot/2026-10-08-syntx-completion--wip/root-211-post-doc-package-proof.json) и [handoff](docs/проект/текущий-handoff.md).

### Root154 — один exact normal reference acceptance

В коде owner-stdio есть отдельный default-off флаг
`SYNTX_OWNER_IMAGE_REFERENCES=1`, который включает четыре штатных инструмента:
`syntx_upload_image_reference`, `syntx_owner_generate_reference_image`,
`syntx_owner_reconcile_reference_image`,
`syntx_owner_list_reference_recovery`. Upload принимает portable base64 одного
PNG/JPEG/WebP изображения, проверяет сигнатуру и размеры и возвращает только
opaque 15-минутный handle, связанный с точным owner principal, attempt и model, без upstream URL. Generation возвращает результат
с result artifact URL вызвавшему owner MCP-клиенту и использует фиксированный
Banana 2.1 профиль
`1K / minimal / 1:1 / n=1`. Произвольные URL и пути не принимаются. Recovery
работает только GET в текущем процессе; после рестарта handle недоступен.
Durable generation с reference tools запрещён. JPEG/WebP прошли локальную
проверку формата, но reference upload живьём пока был только на PNG: один
isolated Root126 experiment и один exact normal Root154 case.

Root154 прошёл штатный owner stdio/SDK путь через четыре обычных tools после
одного Telegram receipt/ACK и `ACTIVE_READBACK`. Один синтетический PNG
512×512 (2 386 байт, `sha256:4a84ffadf1ba454f11ed10e15a12a637f55cbb81bb8535161ed5d90fceb7bc84`)
использовался в одном Banana 2.1 generation: `1K / minimal / 1:1`, одна
reference, одна копия. Наблюдён один JPEG 1024×1024, 690 122 байта,
`sha256:24cf14a0ac54c5d556afdc4505a07931cbed76fed16405b304efa7e9d05f6363`.
Upload=1, generation=1, recovery=0, retries=0; unlink read-back `REVOKED`,
SDK transport закрыт, parent exit 0 и private BEGIN очищен. Статус
`PASS_EXACT_RESULT_ONLY`: не заявлены visual similarity/causal strength,
full pixel decode, другие input MIME, multiple references, retention,
restart recovery, hard cost cap или hosted/client coverage.
[Root154 proof](.autopilot/2026-10-08-syntx-completion--wip/root-154-normal-reference-proof.json).

Root154 использовал новый case152. Он не повторяет Root145 handoff timeout,
Root117 unknown или изолированный Root126 experiment.

### Historical Root145 и Root148 read-only check

Root145 остановился на private handoff ACK до linked auth/account/upload/gen
(upload/gen/recovery=0); локальный unlink был подтверждён. Root148 отдельно
подтвердил только stock SDK tool registration/cleanup: 21 tool, четыре
reference tools, auth/upload/generation=0, `transport.pid=null`. Эти записи
сохраняются в [Root145 outcome](.autopilot/2026-10-08-syntx-completion--wip/root-145-stock-reference-outcome.json)
и [Root148 proof](.autopilot/2026-10-08-syntx-completion--wip/root-148-stock-sdk-readonly-proof.json).

Root160 records the preceding 23ed checkpoint only: build/typecheck, source
MJS 48/48 and suite 1 390/1 390. Current 7243 verification is summarized above;
post-doc package smoke remains pending. The earlier default `npm test` run with
one launcher-timeout cancellation remains historical.
[Root160 verification](.autopilot/2026-10-08-syntx-completion--wip/root-160-local-and-sdk-verification.json).

### Текущие source-reviewed и exact-live image profiles

Current V2 child `sha256-8a24f8adbcd3505d310495dcb64b39fcc059fb943d8cea29c3d3b99bbb5d4b9c.json` содержит 53 rows (14 `live_verified`, 39 `reviewed`), 29 image IDs (9 live, 20 reviewed-only) и 11 video IDs (2 live). Он сохраняет все 52 corrected parent rows `28ec6392…` точно. Остаются 12 из 41 active image IDs без generation contract и 4 upscalers без upscale contract; 19 legacy direct-owner profiles — отдельный счёт.

GPT Image 2 остаётся `reviewed` с `details_quality` и `quality`, не с Banana `thinking_level`/`image_size`; backend acceptance не доказан. Широкие Ideogram40/45 settings rows остаются `reviewed`; Task173 добавил только square `1:1 / 1K / TURBO / AUTO` variants, по одному PNG source-probe результату на модель. Task185 добавил один JPEG-only live profile для Seedream Flash; это один isolated source-probe tuple, не обычный runtime и не расширение широкого JPEG/PNG reviewed allowlist на другие случаи. См. [Task173](.autopilot/2026-10-08-syntx-completion--wip/result-173-ideogram-40-45-exact-live-curation.md), [Task185](.autopilot/2026-10-08-syntx-completion--wip/result-185-seedream-flash-exact-live-curation.md) и [Root182 proof](.autopilot/2026-10-08-syntx-completion--wip/root-182-flash-proof.json).

Task188 добавил два reviewed Flux client-intent profiles. Root202 Pro geometry mismatch остаётся DEBT-059; Task205 promote-ил только точный Ultra 2048-square JPEG tuple. Ни один случай не доказывает весь model family, canonical UI/defaults или обычный host acceptance. Root186 watcher/cache ordering gap остаётся открытым, Root187 — client-policy choice. См. [Task188](.autopilot/2026-10-08-syntx-completion--wip/result-188-flux-pro-ultra-client-intent-profiles.md), [Task205](.autopilot/2026-10-08-syntx-completion--wip/result-205-flux-ultra-exact-live-profile.md), [Root186](.autopilot/2026-10-08-syntx-completion--wip/root-186-flux-wire-closure-audit.json) и [Root187](.autopilot/2026-10-08-syntx-completion--wip/root-187-flux-no-lora-policy-decision.md).

e551 остаётся global default. Root209 подтверждает build/typecheck PASS, compiled suite 1 417/1 417, 19 focused tests, source MJS 56/56 и audit 0. Root211 packaging PASS на `036f19e`: 800 entries, 8 public-catalog versions, 21 V2 contract versions; clean install/offline loaders/guards PASS, auth/upload/generation=0. Эти 800 entries относятся к package, собранному до последних edits этой документационной строки; Root повторит final package check после текущих docs. См. [Root209 proof](.autopilot/2026-10-08-syntx-completion--wip/root-209-image-wave-verification.json) и [Root211 proof](.autopilot/2026-10-08-syntx-completion--wip/root-211-post-doc-package-proof.json). Public settings defaults по непроверенным полям остаются UNKNOWN.

### Historical Root126 — isolated source-only image-reference success, 2026-10-09

Root126 сообщает об одном отдельном Banana 2.1 reference v2 опыте через
source-only harness: upload одного нового синтетического PNG 512×512,
один image-generation вызов, без retry и recovery; результат — один JPEG
756 187 байт, 1024×1024, с наблюдённым SHA-256. Свежие subscription, model
access и cost preflight были отмечены Root как пройденные; локальный unlink
подтверждён read-back, parent завершился с exit 0, приватный BEGIN очищен.
Подробности и exact fingerprints — в [Root126 proof](.autopilot/2026-10-08-syntx-completion--wip/root-126-reference-v2-proof.json)
и [отчёте Task128](docs/проект/отчёт-2026-10-09-task128.md).

Это один exact source-only путь через внутренний HTTP bridge. Candidate
остаётся `blocked` / `dispatch_allowed=false`; обычный MCP admission или
default/runtime activation не включались. Не проверены другие MIME и размеры,
semantic similarity, retention, restart safety и общий reference lifecycle.
Не переносить этот результат на другие модели, файлы или параметры.

Root117 — отдельный предыдущий intent, не повторявшийся: его ordinary
`startImage` остановил локальный guard до image POST; результат остался
`OUTCOME_UNKNOWN`, Root сообщает об одном GET-only reconcile и подтверждённом
локальном unlink. Не считать, что удалённый hidden upload очищен.

В том историческом checkpoint contract pin был immutable V2 child
`sha256-2dbdeed0c7390430e37bbfc20486d0116943418cc37ec53a875ae49d41a2ba52.json`:
42 contracts, 10 `live_verified`, 32 `reviewed`. Профиль
`ideogram-image-generate-two-ratios-live` ограничен `1:1` и `16:9`; исходный
13-ratio variant остаётся `reviewed`. Root сообщает о read-only stock SDK
проверке нового pin. Это не расширяет reference acceptance. Image-first
приоритет сохраняется, новая text-generation не становится gate; полная цель
остаётся активной.

### Photo-family checkpoint — 2026-10-09

Root93 подтвердил по одному точному image probe для GPT Image 1.5, Grok Imagine
Quality и Ideogram; task96 promoted три уже существующие строки в immutable V2
child `0e5b7a6a…`, не увеличивая число строк. Тот промежуточный snapshot
содержал 40 contract records: 9
`live_verified`, 31 `reviewed`; живые tuple покрывают 5 image и 2 video model
IDs. Штатный MCP SDK с новым явным pin подтвердил всем трём
`schema_status=live_verified` и `validation=VALID` для prompt-only inputs.
Генерация через promoted profiles не выполнялась. Проверялись только байты,
MIME и JPEG/PNG frame headers; визуальный контент, текст на изображениях и
качество не оценивались. Это ограниченное подтверждение, не покрытие всех
моделей или настроек. Подробности:
[current handoff](docs/проект/текущий-handoff.md) и
[отчёт task97](docs/проект/отчёт-2026-10-09-task97.md).

Текущий V2 child
`sha256-2dbdeed0c7390430e37bbfc20486d0116943418cc37ec53a875ae49d41a2ba52.json`
содержит 42 generation-contract records: 10 `live_verified`, 32 `reviewed`.
Текущие contract IDs охватывают 22 image model IDs и 11 video model IDs;
live acceptance остаётся для 5 image и 2 video IDs. Source-публичный каталог
содержит 41 image record и 4 upscaler IDs; 19 image IDs и все 4 upscalers ещё
без contract, см. [Root110 gaps](.autopilot/2026-10-08-syntx-completion--wip/root-110-image-contract-gaps.json).
Parent snapshot `a4d42d4b…` и прежний `0e5b7a6a…` сохранены.

Новый V2 pin не выбран по умолчанию и не меняет operator config или paid flags.
Явный выбор требует существующих
`SYNTX_GENERATION_CONTRACT_VERSION` и
`SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION=2.0.0`.

Текущий критерий не требует завершить новую text-generation до image/media
flows. Уже существующие текстовые компоненты сохраняются; далее приоритет у
image settings/results/references/edit/upscale, затем у video/audio/media.

### Исторический photo 1K профиль — snapshot 3abbb0f2, 2026-10-09

Следующий профиль и snapshot описывают прежний срез. Его variant proof остаётся
точечным; snapshot `3abbb0f2…` и отдельный metadata-labeled snapshot `13f720…`
сохранены как история и superseded, без активации. Текущий V2 pin —
`sha256-2dbdeed0c7390430e37bbfc20486d0116943418cc37ec53a875ae49d41a2ba52.json`.
Snapshot `a4d42d4b…` — его исторический parent; актуальная сводка приведена в
Root126/reference v2 checkpoint выше.

Один новый Banana 2.1 вариант `banana21-image-1k-minimal-ratio-flex`
прошёл exact owner source-CLI probe для `1K/minimal/16:9`: получен один JPEG, 852 295
байт; заголовки кадра показывают 1376×768. Ошибка отношения сторон — 0,78125%
при допуске 2%; пиксельное отношение не ровно 16:9, а метка `1K` не обещает
ширину ровно 1024 px. Подтверждены один dispatch, отсутствие повтора и
локальная очистка `REVOKED`. Это одно точное наблюдение, не проверка всех
настроек или моделей.

Добавлен отдельный immutable V2 snapshot на 40 вариантов (6 `live_verified`,
34 `reviewed`); исходные 39 записей сохранены без изменения. Новый pin
дополнительно прошёл read-only проверку штатным MCP SDK: схема с двумя
обязательными параметрами (`prompt`, `aspect_ratio`), допустимы `1:1` и
`16:9`, а `9:16` и отсутствие ratio отклоняются. Snapshot не выбран по
умолчанию и не меняет конфигурацию платных флагов. Оператор может явно выбрать
его существующими `SYNTX_GENERATION_CONTRACT_VERSION` и
`SYNTX_GENERATION_CONTRACT_SCHEMA_VERSION=2.0.0`; подробности и pin — в [текущем handoff](docs/проект/текущий-handoff.md).

### Каталог и границы подтверждений на 2026-10-09

В текущем selected public snapshot
`sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json`
— 41 семейство, 200 model records (167 active / 33 inactive) и 44 отдельные
LLM records. Read-only discovery объединяет их в 205 уникальных identities;
активны 172, включая пять LLM-only IDs. Два LLM ID совпадают с inactive
main-model rows. Снимки `sha256-549e361e…` и `sha256-3c1ceb7c…` сохранены
additive; у 3c1 allowlisted AI/model projections равны e551, но raw canonical
hashes отличаются, и расхождение вне allowlisted projection не классифицировано.
В промежуточном RAM observation временные inactive-состояния `magnific`,
`creative`, `precision_v1`, `precision_v2` были восстановлены в следующем
снимке. Поэтому нельзя заявлять, что весь live public payload не изменился.
Default selector не переключался, runtime proofs не переносятся автоматически.
MCP search/get_model возвращают
дату, source hashes, counts и полные сохранённые allowlisted public settings.
Это справочное покрытие, не подтверждение генерации всех моделей.

Task91 добавил blocked Banana 2.1 reference preparer; task101 — owner upload
boundary и opaque receipt. Root117 и Root126 описаны выше и в handoff: Root126
подтверждает только один isolated source-only internal-bridge intent и не
заменяет acceptance обычных owner-stdio tools; статус Root145 приведён выше.
URL lifetime, remote hidden-file cleanup и restart-safe retention не доказаны.
Task114 добавил узкий
live Ideogram профиль для двух exact ratios; 13-ratio source variant остаётся
`reviewed`, и это не подтверждает все 13 backend вариантов.

Root сообщает о последнем локальном QA после Tasks120/121: 1 354 теста,
typecheck, package smoke на 739 entries, 37 source-probe MJS, audit 0 и diff
check PASS. Это локальная проверка дерева, не production release, hosted
isolation или клиентская матрица.

Работа текущего этапа: mapless settings inventory для всех вариантов,
общий строгий generation contract/validator, read-only schema tools и
надёжное хранение авторизации. На 2026-10-09 локально подтверждены свежий
owner login/account read, один MCP image result Banana 2.1 (JPEG) и один
MCP video result Seedance Pro Fast (MP4). В обоих тестах — один dispatch
без повторной отправки. Подписка вновь активна по свежему чтению; агент
её не приобретал и не продлевал. Финансовые значения в репозитории не хранятся.

Runtime registry содержит 32 узких профиля с историческими terminal proofs,
30 доступны в текущем snapshot. Это не полное покрытие настроек: static UI
projection для 99 image/video вариантов остаётся `STATIC_PARTIAL`. Общий
executor подключён к отдельному opt-in owner-stdio пути только для двух
exact контрактов; fresh real stdio tests подтвердили JPEG и MP4,
каждый по одному dispatch,local unlink REVOKED.
[Включение и ограничения](docs/интеграция/owner-contract-media-mcp.md).
Подробности — в handoff.

Живая точка продолжения для нового агента: [текущий handoff](docs/проект/текущий-handoff.md).

Обновление каталога без перезаписи истории: [версионирование и выбор в MCP](docs/проект/версии-публичного-каталога.md).
Новые snapshots остаются discovery-only; подтверждения генерации автоматически не переносятся.

### Исторические этапы до 2026-10-08

Для прежнего build 1788524349 сохранён отдельный [inventory источников настроек](docs/проект/версии-источников-настроек.md)
для 193 вариантов. История не перезаписана; это ещё не исполнимая схема настроек.

Исторический additive snapshot build 1789134564 сохранён рядом с историей:
197 model records, 42 families и 45 registry forms. Последний архивный файл —
`sha256-5feda2da608592455f38f8cfea6b9e85580fd7a1e327378bf36bbbe790bf4f78.json`.
Для него также сохранён
version-bound settings inventory на 140 first-party artifacts. Оба артефакта
остаются discovery/evidence-only и не активируют платную генерацию
автоматически; точные hashes и границы см. в [текущем handoff](docs/проект/текущий-handoff.md).

Следующий этап без изменения v1–v4: [settings v5 Beeble](docs/проект/settings-v5-beeble.md).
Реализован root-only разбор с проверкой обоих source refs и сохранением
неразобранного auxiliary. Это partial evidence, не включение генерации;
v1–v4 сохраняются побайтово. Фактический статус probe/sync — в handoff.

Отдельный срез по DEBT-041 (`hailuo-minimax`/`luma-image`): статические
declaration-initializer константы двух Hailuo/Luma helper-бандлов, без
исполнения вендорского кода, `catalog/runtime/v6/`. Не новый identity-профиль
generic-адаптера и не закрытие DEBT-041 — отдельная evidence-база. Детали и
решение по allowlist — D-064 в `docs/проект/решения.md`.

Следующий шаг по тому же DEBT-041 — `catalog/runtime/v7/`: curated
alternate-identity binding. Реальная альтернативная identity convention
найдена в уже сохранённом v6-архиве (`MINIMAX_MODEL_NAME`/`LUMA_AI_NAME`)
и сверена с Gate C0 census manifest, оба значения совпали. Курируемая
hash-pinned таблица, резолвер каждый раз заново проверяет значение — не
доверяет таблице напрямую. Полностью офлайн, `static-settings-compiler.ts`
и v3/v4-артефакты не тронуты. Тоже не закрывает DEBT-041 — closure
остаётся за владельцем. Детали — D-072 в `docs/проект/решения.md`.

Владелец проекта сообщил, что во время прямого звонка получил от SYNTX
разрешение на разработку и тестирование полноценного MCP. В реальном
owner-account контуре подтверждены:

- вход `SYNTX -> Telegram -> SYNTX` в штатном Chrome;
- server-side challenge/token flow без browser cookie и общей Telegram-сессии;
- полный публичный snapshot из трёх first-party endpoint;
- account-scoped read `get_model_info` после входа;
- полный MCP smoke `begin_login -> check_login -> get_model_access -> unlink`;
- живой цикл одного пустого чата `create -> delete` без генерации.

Отдельный public-production scope для hosting, source distribution, branding и
support всё ещё фиксируется как самостоятельный релизный шлюз. Наличие live
read не превращает наблюдаемые endpoint в опубликованный OpenAPI.

Gate C1a добавил отдельный source-backed result schema 3.0.0 для ровно одной
Banana-form: 4/192 model records, 1/42 forms и 1/123 source identities.
Результат привязан к заново полученным byte-pinned Banana JS/map и exact
полной Gate B canary-проверке, но оставляет все шесть projections `BLOCKED`;
`runtime_usable=false`. Это не доказательство current active build, backend
contract, payload equivalence или runtime. Точные bytes, проверки и границы —
в [отчёте Gate C1a](docs/контроль/проверки/проверка-settings-parser-source-backed-c1a-2026-09-03.md).

Предыдущий Gate C0 добавил только offline inventory/cohort manifest
для будущего source-backed парсинга. Он не перезагружал source,
не запускал settings AST compiler и не расширил runtime или paid tool
surface. Local-режимы при этом явно пересобирают ignored `dist`.
Точные bytes, проверки и недоказанные границы собраны в
[отчёте Gate C0](docs/контроль/проверки/проверка-settings-parser-census-c0-2026-09-03.md).

## Что реализовано

- TypeScript ESM и официальный `@modelcontextprotocol/sdk`;
- основной Streamable HTTP transport и локальный `stdio`;
- переносимые catalog/generation и settings-evidence tools, включая read-only
  `syntx_get_runtime_coverage`;
- `syntx_get_runtime_coverage` возвращает versioned redacted inventory ровно
  19 image и 13 video owner profiles: exact `ai_name`/settings, MIME, one-copy
  limit, opt-in flag, redacted output shape и `cancel_mode: "OPEN"`. `OPEN`
  означает, что live cancel contract для профиля не заявлен; tool не делает
  cancel POST и не использует auth/network/paid operations;
  catalog-only и unsupported boundaries выдаются явно.
  Для Sunburst и Flare также доступны отдельные live-verified
  `settings_variant` профили `sunburst-2k-high-16x9` и
  `sunburst-4k-max-21x9` (`21:9`, `max`, `4K`) и `flare-2k-high-16x9`
  (`16:9`, `high`, `2K`).
- три opt-in auth tools: `syntx_begin_login`, `syntx_check_login`,
  `syntx_unlink`;
- opt-in `syntx_get_model_access` для текущих access/cost/limit полей;
- отдельно включаемый read-only `syntx_list_uploaded_files` для bounded
  metadata уже сохранённых файлов (`scope`, `page`, `page_size`); URL, signed
  links, upload/delete/download и неизвестные поля не возвращаются;
- отдельно включаемый read-only `syntx_reconcile_uploaded_file` принимает
  bounded opaque `file_id`, проверяет подтверждённую первую страницу
  `scope=all` с `page_size=10` и возвращает `FOUND`, `NOT_FOUND` или `SEARCH_INCOMPLETE`
  с безопасной metadata projection; upload/delete/download не выполняются.
  Включается только `SYNTX_OWNER_RECONCILE_UPLOADED_FILE=1`;
- отдельно включаемый mutation `syntx_upload_file` принимает один base64-файл
  до 10 MiB с allowlisted MIME и active public-catalog `model_id`; всегда
  отправляет hidden multipart upload с duplicate checking и возвращает только
  `{status,file_id,mime_type,size}`. Default server его не публикует;
- отдельно включаемый в owner-stdio [syntx_get_account_status](docs/интеграция/account-status-mcp.md) для
  баланса, активности и срока подписки; форма ответа и безопасная очистка
  живьём подтверждены owner smoke, но числовые значения намеренно не
  сохраняются и не публикуются;
- исторический default snapshot v1: 42 AI entries, 192 model variants, 32 LLM records;
- пагинация его 155 active либо всех 192 записей без пропусков;
- новый архив D-062: 193 variants (157 active), 33 LLM records; подключается явным выбором версии;
- сохранение inactive history, settings, features и LLM capabilities;
- canonical SHA-256, строгий allowlist, sensitive-key scan и drift-check;
- tenant+subject-bound login attempts, TTL, безопасные URL, bounded polling;
- credential только внутри callback, без возврата в MCP output и без записи на
  диск;
- opt-in `SqliteAuthLinkStore` с lease/unknown-outcome states и обязательным
  injected `NodeAeadAuthLinkSecretVault`; owner default намеренно остаётся
  process-local до подтверждения upstream idempotency/readback и hosted
  principal resolver;
- fixed-route read-only SYNTX client с timeout, size/content guards и безопасным
  error mapping;
- fixed-route chat/generation gateway для text, image, video и audio,
  пока отключённый от paid tool surface; external reference URL и
  result URL decoding fail closed до подтверждённого upload/output contract;
- постоянный SQLite operation journal schema v4 с monotonic state machine,
  stage-specific crash recovery, append-only event ledger и tenant/subject
  isolation;
- отдельный журнал попыток отмены: запись до POST, защита от повторной
  отправки после сбоя и поздний ACK без ложного завершения генерации;
- process-local observation-only service: principal constructor-injected и
  отсутствует в tool-shaped input, cost inputs берутся из reviewed
  codec, а prompt и значения параметров не попадают в публичный результат;
- воспроизводимый evidence-only inventory настроек: 42/42 current family forms,
  45 registry forms, 192 variants и 142 хешированных first-party artifacts;
- хеш-привязанная normalized-settings IR canary оболочка для
  `banana`, `banana2`, `banana3` и `banana3_light`: 4 `PARTIAL` records,
  11 source locators, `NOT_COMPILED`, без runtime wiring и schema hashes;
- отдельный parser-canary для тех же четырёх моделей: bounded TypeScript AST
  без выполнения vendor code, 3 безопасных static candidates, 17 точных
  form blockers, `PARTIAL_COMPILED` и `runtime_usable=false`;
- Gate C0 manifest schema 2.0.0 с полным exact cohort: 42 current
  forms (39 model-bearing + 3 zero-model), 192 model records (182 current +
  10 legacy), 123 source identities и 351 inventory locators;
- шесть C0 source dispositions: 39 model-bearing roots, 3 zero-model
  roots, 34 current auxiliaries, 4 unbound-provider refs, 39 direct-helper
  refs и 4 registry refs; compile boundary равна 76, а 47 refs явно
  deferred;
- три unbound provider forms — `imagen-4`, `midjourney` и
  `midjourney-video`; они не получили ложной привязки к current
  model cohort;
- runtime capability read-model для всех 192 variants и четыре
  хешированных canary codecs, пока остающихся non-runtime;
- source-backed result schema 3.0.0 для 1 Banana-form / 4 exact моделей:
  0 `PROVEN`, 0 `ABSENT_PROVEN`, 6 `BLOCKED`, 2 blocker groups с static
  candidates, 17 form blockers и 4 model blockers; 41 forms, 188 models и
  122 source identities остаются вне scope, все 47 deferred refs не тронуты;
- mock generation core с estimate binding, confirmations, idempotency и
  reconciliation;
- unit, contract, transport, installed-bin и redaction tests;
- отдельно включаемый в owner-stdio `syntx_owner_generate_image` (D-074,
  2026-09-06): реальная, платная генерация canonical `banana` (Nano Banana)
  картинок; исторический `nano-banana-pro` сохранён только как явный legacy
  alias. Живьём
  проверен HTTP-контракт SYNTX и сам инструмент как единый путь —
  реальный вызов именно через `syntx_owner_generate_image` (не в обход
  него) прошёл целиком 2026-09-06. Сознательно в обход основной
  транзакционной архитектуры ниже — без idempotency key, без durable
  saga, без отдельного шага подтверждения; подробности — README ниже и
  `docs/проект/незакрыто.md` (DEBT-055).
- отдельно включаемые в owner-stdio `syntx_owner_generate_video` и
  read-only `syntx_owner_reconcile_video`: узкие
  owner-only Seedance 2.0, Seedance 1.5 Pro, Kling 3.0-turbo, Luma Ray 3.14, Sora 1, Wan 2.6 T2V, Wan 2.7 T2V, Flux 3 T2V, Happy Horse T2V, Runway text2video и Runway text2video-4.5 профили с exact settings
  `{model_type:"seedance-2.0", resolution:"720p", mode:"mini",
  aspect_ratio:"16:9", video_duration:5, generate_audio:true}` либо
  `{model_type:"seedance-1.5-pro", resolution:"720p", aspect_ratio:"16:9",
  video_duration:5, generate_audio:false}` либо Kling
  `{model_type:"kling_text2video", temperature:0.5, aspect_ratio:"16:9",
  mode:"standart", version:"3.0-turbo", native_audio:false, video_duration:5}` либо
  Luma `{model_type:"ray-3.14", video_duration:5, quality:"720p",
  aspect_ratio:"16:9", gen_type:"text2video"}` либо Sora
  `{model_type:"sora_1", video_duration:10, quality:720,
  aspect_ratio:"16:9", gen_type:"text2video"}` либо Wan Video
  `{model_type:"wan_26_t2v", file_urls:[], aspect_ratio:"1:1",
  resolution:"720P", video_duration:5, prompt_extend:true,
  shot_type:"single", audio_setting:"auto", seed:null, native_audio:false}`
  либо `{model_type:"wan_27_t2v", file_urls:[], aspect_ratio:"1:1",
  resolution:"1080P", video_duration:5, prompt_extend:true,
  shot_type:"single", audio_setting:"auto", seed:null,
  native_audio:false}` либо `{model_type:"flux3_t2v", aspect_ratio:"auto",
  resolution:"hd", video_duration:5, generate_audio:true}` либо
  `{model_type:"happy_horse_t2v", aspect_ratio:"16:9", resolution:"720P",
  video_duration:5, native_audio:false, seed:null}` либо
  `{model_type:"text2video", video_duration:"5.0", seed:null,
  aspect_ratio:"1"}` либо `{model_type:"text2video-4.5", video_duration:"5.0",
  seed:null, aspect_ratio:"169"}`;
  один text-only prompt, одна копия,
  bounded polling до 180 секунд, после dispatch chat не удаляется. Terminal
  result принимается только при `object_type=video`, exact `model_type` и
  `mime_type=video/mp4`; перед отказом выполняются две короткие read-only
  reconciliation reads. Любой post-dispatch timeout/unknown возвращает
  фиксированный `OUTCOME_UNKNOWN` без chat identifier и не допускает
  автоматический повтор. Включается независимо через
  `SYNTX_OWNER_GENERATE_VIDEO=1`.
- отдельный smoke `live:owner:generate-video-smoke` вызывает именно shipped
  `syntx_owner_generate_video` после Telegram linking с фиксированным
  Seedance-профилем/промптом. Это один реальный платный dispatch только при
  exact confirmation flag; stdout содержит только `status`,
  `tool_result_present` и `video_mime`. После dispatch smoke не повторяет вызов
  и не удаляет chat; в `finally` удаляется только локальная credential link.

Платные `syntx_start_generation` и реальные `get_job/cancel/result` (основная
транзакционная архитектура — `ApplicationCore`/`SyntxUpstreamAdapter`)
по-прежнему fail closed. Их включение требует точных mutation schemas,
durable idempotency, stage-specific unknown-outcome reconciliation, hard cost
cap и redacted smoke для каждой modality, а также решения по operation
pricing (DEBT-005) — это незавершённая часть полного MCP, а не скрытая
готовность. `syntx_owner_generate_image` — отдельный, более узкий, но уже
живьём подтверждённый путь к реальной генерации (код прошёл критик-цикл
и один реальный сквозной вызов через сам инструмент, 2026-09-06 — см.
DEBT-055), не решающий эту архитектуру.

Продолжение 2026-09-04: D-051 добавляет durable cancellation и исправляет
совместимость job IDs между adapter и MCP; финальная проверка этого diff
отмечается в [handoff](docs/проект/текущий-handoff.md). По прямому решению
владельца D-052 новые версии каталога создаются рядом с сохранённой историей,
без перезаписи существующих snapshots.
Отдельная offline-команда D-053 проверяет их implementation hashes;
текущее историческое расхождение `wan-video` не скрывается и не исправляется
перезаписью исходного снимка.
Идентификаторы модели и операции теперь проверяются в одном активном
каталоге (D-054). Наличие модели в поиске не означает готовность запуска:
если executable contract ещё отсутствует, код не подбирает похожую
sample-модель. Default/owner paid gate остаётся закрыт.

## Быстрый локальный запуск

Весь пакет требует Node `>=22.13.0`. Эта единая граница включает
встроенный `node:sqlite`, используемый durable operation journal.

```bash
npm ci
npm test
npm run start:owner:stdio
```

Проверка самого video MCP tool в owner-контуре (реальный платный вызов,
запускать только при отдельном решении владельца):

```bash
npm run live:owner:generate-video-smoke
```

Для MCP-клиента предпочтительнее запускать собранный файл напрямую:

```text
command: node
args: [<project-root>/dist/src/transports/stdio-owner.js]
```

Owner profile по умолчанию показывает 12 tools (8 базовых + 3 auth + 1
account-scoped model access). Read-only file metadata можно явно добавить в
owner composition через `uploadedFilesEnabled`; после отдельного принятия условий SYNTX новый
account status можно включить только для stdio:

```bash
SYNTX_OWNER_ACCOUNT_STATUS=1 npm run start:owner:stdio
```

Флаг references добавляет четыре штатных tools. Публичный account-status tool
можно включить отдельно вторым флагом:

```bash
SYNTX_OWNER_IMAGE_REFERENCES=1 SYNTX_OWNER_ACCOUNT_STATUS=1 npm run start:owner:stdio
```

`SYNTX_OWNER_IMAGE_REFERENCES=1` включает references; account-status tool
остаётся optional. Reference service всё равно выполняет свои fresh
subscription, model-access и cost checks до generation, независимо от
регистрации публичного account-status tool.

Профиль default-off. Upload отправляет выбранные оператором байты в hidden
SYNTX storage; вызов generation может списать средства. Перед ним читаются
аккаунт, доступ и текущая стоимость, но отдельного подтверждения и spending
cap нет. Вызов ограничен одним Banana 2.1 image; recovery — GET-only и только
в течение 15 минут текущего процесса. JPEG/WebP валидируются локально, но
live reference input был PNG в Root126 и в отдельном normal Root154 case. JPEG/WebP остаются локально валидированными.
точный normal owner case; не переносить его на иные модели/параметры.

Для read-only списка уже сохранённых файлов используйте отдельный операторский
флаг:

```bash
SYNTX_OWNER_UPLOADED_FILES=1 npm run start:owner:stdio
```

Флаг не разрешает upload/delete/download и не публикует ссылки.

Для owner upload используйте отдельный флаг (он разрешает одну mutation
поверх фиксированного multipart route):

```bash
SYNTX_OWNER_UPLOAD_FILE=1 npm run start:owner:stdio
```

Upload не удаляет и не скачивает файлы; live mutation требует отдельного
явного smoke и не выполняется при обычном запуске. Последний owner smoke
завершился `OUTCOME_UNKNOWN` без receipt; повторять его нельзя до read-only
reconciliation.

Redacted owner smoke этого read-only GET (без upload/delete/download) запускается
только явно:

```bash
npm run live:owner:uploaded-files-smoke
```

При прямом запуске stdio-owner.js задайте этот env в конфигурации MCP-клиента.
С ним будет 13 tools. Это операторский флаг, не проверка принятия условий
на стороне SYNTX. В текущем owner HTTP новый инструмент отсутствует.

**Реальная, платная генерация картинок** включается отдельным флагом,
тоже только для stdio. Соберите проект (`npm run build`) прежде чем
подключать — конфиг ниже указывает на `dist/`. Пример конфигурации
MCP-клиента (замените путь на свой, если проект лежит не здесь; значение
флага — строго `"1"`, любое другое нерабочее значение не отключает один
инструмент, а роняет весь сервер целиком — см. ниже):

```json
{
  "mcpServers": {
    "syntx-owner": {
      "command": "node",
      "args": ["/Users/AlexFisenkov/⚙️ НАСТРОЙКИ/MCP для SYNTX AI/dist/src/transports/stdio-owner.js"],
      "env": {
        "SYNTX_OWNER_ACCOUNT_STATUS": "1",
        "SYNTX_OWNER_GENERATE_IMAGE": "1",
        "SYNTX_OWNER_GENERATE_VIDEO": "1"
      }
    }
  }
}
```

Куда класть этот блок и как проверить, что сервер поднялся: для Claude
Code — `claude mcp add-json syntx-owner '<этот JSON без внешних скобок mcpServers>'`;
для Claude Desktop — в `claude_desktop_config.json` (macOS: `~/Library/Application
Support/Claude/claude_desktop_config.json`) под ключом `mcpServers`. После
правки клиент нужно перезапустить. Успешное подключение проверяется
списком инструментов: должны появиться `syntx_get_account_status` и
`syntx_owner_generate_image`, `syntx_owner_generate_video` и
`syntx_owner_reconcile_video` (16 tools вместе; 14 только с одним generation
flag; 13 без generation tools). Recovery tool принимает только opaque
`recovery_id`, выполняет list/get reads и не повторяет генерацию.
флагов). Если после перезапуска клиента сервера в списке нет вообще,
скорее всего опечатка в значении флага (см. предупреждение выше).

### Что реально исполняется сейчас

Документированные source-параметры девяти вариантов Flux, Seedream и Runway
Frames: [полный справочник](docs/интеграция/Параметры-Flux-Seedream-Runway.md).
Это локальные профили параметров, не native MCP-генераторы.
Root595 повторный source gate: Node24 полный 2124/2124, focus 123/123;
installed package gate ещё ожидает exports/helper checker и полный freeze.
Текущий статус — в полях `final_full` и `final_package` [receipt](.autopilot/2026-10-08-syntx-completion--wip/root-595-nine-image-admission-qa.json).

| Возможность | Статус |
| --- | --- |
| Telegram linking, model access | Доступно в owner-stdio |
| Balance/subscription read | Доступно только с `SYNTX_OWNER_ACCOUNT_STATUS=1`; read-only, observed frontend contract |
| Banana / Nano Banana image (`model_id=banana`; `nano-banana-pro` — legacy alias) | Реально проверено; `syntx_owner_generate_image`, одна копия |
| GPT Image 1 / 1.5 (`model_id=gpt-image-1`, `gpt-image-1.5`) | Реально проверено; provider scope `sora-images`, exact matching `model_type`, одна копия |
| Ideogram (`model_id=ideogram`) | Реально проверен только default generate profile с exact UI-derived settings, одна копия |
| Flux-1 (`model_id=flux-1`) | Реально проверен только exact profile `ai_name=flux`, `model_type=flux-1`, `steps=28`, `cfg=3.5`, `resolution=1024x1024`, `civitai_loras=[]`, `workflow_type=default`, `image_strength=0.5`; только `aspect_ratio=1:1`, одна копия |
| Seedream-5 (`model_id=seedream-5`) | Реально проверен только exact profile `ai_name=seedream`, `model_type=seedream-5`, `resolution=2K`, `stream=false`, `aspect_ratio=1:1`; одна копия |
| Seedream-5.0 Pro (`model_id=seedream-5.0-pro`) | Реально проверен только exact profile `ai_name=seedream`, `model_type=seedream-5.0-pro`, `resolution=2K`, `stream=false`, `aspect_ratio=1:1`; одна копия |
| Grok T2I (`model_id=grok_t2i`) | Реально проверен только exact default profile `ai_name=grok_image`, `model_type=grok_t2i`, `aspect_ratio=1:1`, `resolution=1k`, `batch_size=1`; одна копия |
| Runway Frames (`model_id=runway_frames`) | Реально проверен только exact default profile `ai_name=runway-frames`, `model_type=runway_frames`, `temperature=3`, `resolution=1088x1088`; только `aspect_ratio=1:1`, одна копия |
| Wan 2.6 T2I (`model_id=wan_26_t2i`) | Реально проверен только exact default profile `ai_name=wan_image`, `model_type=wan_26_t2i`, `aspect_ratio=1:1`, `resolution=720P`, `seed=null`, `batch_size=1`, `prompt_extend=false`, `bbox_list=[]`; одна копия |
| Luma Uni 1.1 (`model_id=uni-1`) | Реально проверен только exact text-to-image profile `ai_name=luma_image`, `model_type=uni-1`; одна копия |
| GPT Image 2.5 Sunburst (`model_id=gpt-image-2.5-sunburst`) | Реально проверен exact default `1:1 / medium / 1K` и отдельно `settings_variant=sunburst-2k-high-16x9` (`16:9 / high / 2K`) и `sunburst-4k-max-21x9` (`21:9 / max / 4K`); одна копия |
| GPT Image 2.5 Flare (`model_id=gpt-image-2.5-flare`) | Реально проверен только exact profile `ai_name=sora-images`, `model_type=gpt-image-2.5-flare`, `aspect_ratio=1:1`, `details_quality=medium`, `quality=1K`; одна копия |
| Остальные image models | Catalog/evidence only; paid runtime не включён |
| Seedance 2.0 / 1.5 Pro / Kling 3.0-turbo / Luma Ray 3.14 / Sora 1 / Wan 2.6 T2V / Wan 2.7 T2V / Flux 3 T2V / Happy Horse T2V / Runway text2video / Runway text2video-4.5 (`syntx_owner_generate_video`) | 11 owner-only, отдельно opt-in exact text-only profiles live-verified; одна копия, strict video/model/MP4 output contract |
| Video (VEO и другие) | Evidence/reconciliation only; result contract не подтверждён, paid runtime fail-closed |
| Remote multi-user hosting | Не поддерживается; текущий owner runtime process-local |

Для первого безопасного image-проуба предусмотрен отдельный owner-only observer:
`npm run live:owner:image-contract -- <ai_name> <prompt> '<settings_json>'`.
Он требует exact `--confirm-live-image-contract`, выполняет один `startImage`,
опрашивает только redacted result surface не более 180 секунд, оставляет chat
живым после dispatch и unlink-ит локальный credential. Это диагностический
контур, не allowlist и не включение остальных image models в платный MCP runtime;
при неопределённом результате повторный запуск запрещён до read-back.

### Compatibility and deployment matrix

| Host/deployment | Current status |
| --- | --- |
| Claude Code / Claude Desktop | Local stdio configuration documented; package/runtime checks pass. Live host UI smoke is not claimed. |
| Codex / Gemini / other local MCP hosts | Expected to work through standard stdio, but no host-specific live smoke has been run. |
| ChatGPT remote connector | Not supported yet: no hosted OAuth/principal resolver or public HTTPS deployment. |
| Owner HTTP launcher | Loopback-only and read surfaces only; it is not a multi-user service. |
| Shared/hosted multi-user MCP | Not supported: credentials and recovery handles are process-local and owner-bound. |

The repository is currently a private local owner distribution. For a local
host, run `npm ci && npm run build`, then point the MCP client at
`dist/src/transports/stdio-owner.js` with only the exact opt-in flags needed.
Do not expose the owner stdio/loopback process to a network or share its
credentials; hosted distribution requires a separate tenant-bound auth and
encrypted credential-storage design.

### Evidence-only launcher

Если нужны только version-bound настройки и source provenance видео без
авторизации, сети и расходов, подключайте отдельный launcher:

```json
{
  "mcpServers": {
    "syntx-owner-evidence": {
      "command": "node",
      "args": ["/Users/AlexFisenkov/⚙️ НАСТРОЙКИ/MCP для SYNTX AI/dist/src/transports/stdio-owner-evidence.js"]
    }
  }
}
```

Он предоставляет только `syntx_get_video_evidence`. Ответы помечены
`runtime_usable=false` и содержат VEO/Seedance evidence, blockers и source
hashes; paid generation, login и upstream HTTP этот launcher не выполняет.

Для image-owner surface из терминала:

```bash
SYNTX_OWNER_GENERATE_IMAGE=1 npm run start:owner:stdio
```

Для отдельно включаемой video-owner surface (она не включается image-флагом):

```bash
SYNTX_OWNER_GENERATE_VIDEO=1 npm run start:owner:stdio
```

Каждый вызов — это реальная, немедленно оплачиваемая генерация:
отдельного шага подтверждения внутри MCP нет, сам факт вызова инструмента
и есть авторизация траты (осознанное решение владельца, D-074,
решения.md). **Живьём проверен и HTTP-контракт SYNTX, и сам инструмент как единый
путь**: 2026-09-06 сделан реальный, платный вызов именно через
`syntx_owner_generate_image` (не в обход него) — картинка получена
целиком через этот код. Подтверждено живьём только `ai_name=banana` (без
цифры) и одна копия за раз: `aspect_ratio` подтверждён для `"1:1"` (по
умолчанию) и `"16:9"`;
поведение при нескольких одновременных копиях (действительно ли SYNTX
считает их параллельно, не начнёт ли ограничивать частоту) живьём не
проверялось. `copies` (1–4) запускает независимые генерации
**одновременно**, не по очереди — единый параметр количества у самого
SYNTX не работает (проверено), а последовательные вызовы рисковали
превысить типовой таймаут MCP-клиента (60 с). Одна копия занимает обычно
15–30 секунд, инструмент ждёт **до ~3 минут** прежде чем считать её
сорвавшейся (если ваш MCP-клиент рвёт вызов раньше — поднимите его
собственный таймаут инструментов минимум до 3–4 минут). Каждая копия
оплачивается независимо от исхода, включая отказ по таймауту.

**Обязательный порядок вызовов**: `syntx_begin_login` → открыть присланную
Telegram-ссылку → `syntx_check_login` до `linked: true` →
`syntx_owner_generate_image` с этим же `attempt_id` в `link_attempt_id`.
Вход не сохраняется между перезапусками сервера (in-memory linking) —
после каждого перезапуска повторяйте эти три шага заново. Забытый вход
не даёт код `AUTH_REQUIRED` напрямую — инструмент вернёт `isError: true` с
кодом `GENERATION_FAILED` и текстом «A linked SYNTX account is required»
внутри `notes`/`message`; это и есть сигнал повторить вход.

Пример успешного ответа:

```json
{
  "images": [{ "url": "https://r2.syntx.ai/user_.../generated/....png", "mime_type": "image/png" }],
  "requested_copies": 1,
  "succeeded_copies": 1,
  "notes": []
}
```

Чего инструмент **не** делает: не сохраняет картинку на диск (только
CDN-ссылка в ответе — сохраните её сразу, например `curl -o
картинка-1.png "<url>"`; живучесть подтверждена в течение часов после
удаления чата, не на более долгий срок), не даёт управлять разрешением
(только `aspect_ratio`; управление разрешением было прямо запрошено, но
`image_size` живьём проверен как нерабочий — см. DEBT-055), не
отображает картинку прямо в чате (текстовый JSON с URL, не image-контент).
Временный чат `owner-generate-…` **никогда не удаляется автоматически**
(ни при успехе, ни при сбое) — заберите результат и удалите чат вручную в
веб-интерфейсе SYNTX, иначе они будут накапливаться.

Подробности и таблица находок —
`docs/интеграция/наблюдение-banana-generation-2026-09-06.md`. Как и account
status, `http-owner.ts` этот флаг не поддерживает.

Рабочий read-only поток:

1. `syntx_search_models` — найдите вариант; используйте `next_cursor` для
   продолжения и `include_inactive=true` для истории.
2. `syntx_get_model` — получите все allowlisted public settings выбранного
   варианта.
3. `syntx_begin_login` — откройте единственный Telegram `resource_link`.
4. `syntx_check_login` — вызывайте до `linked=true`; один вызов делает ровно
   один bounded poll.
5. `syntx_get_model_access` — передайте `link_attempt_id`, `model_id` и только
   перечисленные у модели `settings.get_cost_params`, кроме
   транспортных `ai_name` и `model_type`: они всегда выводятся из
   выбранного `model_id` и не могут быть переопределены вызовом.
6. Если инструмент включён отдельно, вызовите `syntx_get_account_status`.
   Передайте полученный при входе `attempt_id` в аргумент `link_attempt_id`;
   получите баланс, активность и дату окончания подписки.
   Unknown-поля останутся null. Совместимость новых полей с живым аккаунтом
   пока не проверена, это ограниченный frontend-based decoder.
7. `syntx_unlink` — удалите credential из локального процесса.

In-memory linking теряется при перезапуске — это осознанный owner-MVP. Не
используйте owner HTTP launcher как публичный multi-user server.

SQLite journal доступен явным package subpath `syntx-mcp/sqlite`.

### Локальный HTTP

```bash
OWNER_PORT=3030 npm run start:owner:http
```

Owner HTTP launcher всегда слушает только `127.0.0.1`. Базовый
`npm run start:http` остаётся fail-closed и не регистрирует auth/account tools.

## Каталог и обновление

Для переносимого обслуживания public catalog и settings/source coverage см.
[гайд обновления](docs/интеграция/Обновление-MCP.md) и встроенный
[skill `syntx-mcp-update`](skills/syntx-mcp-update/SKILL.md). Offline compare
работает по точным архивным версиям; public probe — отдельный bounded GET с
явным `--confirm-source-fetch`. Account availability, rendered UI и provider
acceptance остаются отдельными поверхностями и не выводятся из catalog diff.
Те же безопасные материалы доступны MCP-клиентам как read-only resources:
`syntx://maintenance/skill`, `syntx://maintenance/cli-guide` и
`syntx://maintenance/ui-guide`; локальная установка skill не требуется.

Команды ниже разделены по воздействию. Не весь пакет является offline: только
явно названные offline-проверки не делают сетевых запросов.

### Offline

```bash
npm run build
npm run settings:parser:check
npm run settings:ir:check:source
npm run settings:census:check
npm run settings:census:check:local
npm run settings:source-backed:check
npm run settings:implementations:check
```

`settings:implementations:check` доступна только из source checkout после
отдельного `npm run build`. Сама она не собирает код, не обращается к сети
и не пишет файлы. Она сверяет сохранённые C1a/v3 и **существующие** C1b/v4
результаты с текущими compiled bytes. Exit 0 означает MATCH всех прочитанных
артефактов, 2 — DRIFT, 1 — ошибочный/недоступный вход. На срезе 2026-09-04:
25 артефактов, 24 MATCH, `wan-video` DRIFT (DEBT-042), exit 2 — ожидаемое
выявленное расхождение, не успешная сверка. Проверка не доказывает свежесть
TypeScript или upstream-источников, полноту опубликованного каталога,
полный граф зависимостей и runtime. В установленном npm-пакете нет compiler
tools, поэтому команда явно отказывает до их импорта. Старые `--check`
сохраняют свои прежние schema/relationship-only границы.

В свежем checkout перед самостоятельным `npm run settings:parser:check`
обязателен `npm run build`: сама команда пока не самодостаточна и читает
собранные локальные артефакты `dist`.

`settings:census:check` тоже читает собранный `dist`, поэтому в
свежем checkout перед ней нужен `npm run build`. Она проверяет
только сохранённые bytes и их связи с локальными validated
catalog/inventory. `settings:census:check:local` сама пересобирает
ignored `dist`, заново выводит manifest и сравнивает его побайтово,
но не пишет tracked artifact. Обе команды offline: source GET и
settings compiler в них отсутствуют. `settings:source-backed:check`
тоже читает собранный `dist`, поэтому в свежем checkout перед ней
нужен `npm run build`.

`settings:ir:sync` детерминированно строит из двух локальных
validated snapshots только evidence shell для четырёх точно
перечисленных Banana-вариантов. Команда `settings:ir:check:source`
сначала собирает checkout, затем сверяет байтовую каноничность
и все source relationships. Последовательность обновления:

```bash
npm run catalog:check
npm run settings:sources:check
npm run settings:ir:check:source
# settings:ir:sync запускается только после review предыдущих checks
```

IR-команды сами не делают сетевых запросов. Успешная проверка
явно выводит `models=4 partial=4 locators=11`,
`compilation=NOT_COMPILED` и `runtime_usable=false`. Canary не читает
vendor source заново, не компилирует defaults/controls/rules и не
разрешает generation.

Parser-canary — следующий независимый слой доказательств. Обычный
`settings:parser:check` только валидирует сохранённый JSON и его связи с
локальными catalog/inventory snapshots. `settings:parser:check:source`
получает ровно hash-pinned `banana.js` и `banana.js.map`, извлекает source
только в память, синтаксически компилирует четыре exact model branches и
сравнивает результат побайтово, не меняя snapshot. До import и bounded public
GET она пересобирает ignored `dist`; перед запуском нужны проверенный
`git status`, осознанное разрешение сети, а после — read-back `git status` и
hash snapshot. Raw-source loader находится только в `tools/settings-ir/` и
исключён из tarball.

### Network read-only

```bash
npm run catalog:check
npm run runtime:sources:check
npm run settings:sources:check
npm run settings:parser:check:source
npm run settings:source-backed:probe
npm run settings:source-backed:check:source
```

`settings:source-backed:check:source` делает два последовательных public GET
к pinned Banana JS/map и не пишет tracked artifact; запускается только после
отдельного intent. `settings:source-backed:probe` имеет смысл только до
создания v3 artifact — сейчас он существует
(`catalog/runtime/v3/normalized-settings-parser-source-backed-result.json`),
поэтому `probe` намеренно отказывает `SOURCE_RESULT_ALREADY_EXISTS` до любой
сети. Для повторной сетевой сверки уже опубликованного результата
используйте `check:source`, а не `probe`. Все три сетевых режима этого CLI
требуют явного `--confirm-source-fetch` вторым аргументом (npm scripts уже
несут его зашитым — как и `live:owner:smoke` несёт свой `--confirm-live-owner-smoke`,
это не отдельное подтверждение при каждом запуске `npm run`, а защита
именно от прямого вызова CLI без него); без флага CLI отказывает
`INVALID_ARGUMENT` до любого fetch, build или lock. Тот же gate стоит и на
`settings:parser:check:source`/`settings:parser:sync` (Gate B canary CLI,
ниже) — раньше один непреднамеренный `check-source` уже случился без
такого гейта на source-backed CLI (D-034, `docs/проект/решения.md`), после
чего тот же класс риска нашёлся и на canary CLI (D-035).

`catalog:check` валидирует live ответы и завершается ошибкой при drift, не
перезаписывая snapshot. `/settings` намеренно не сохраняется, потому что
текущий ответ содержит `client_ip`.

Неуточнённый `catalog:check` сверяет текущий selector: сначала
`SYNTX_PUBLIC_CATALOG_VERSION`, иначе application default e551. Аргумент
`--version` явно выбирает другую сохранённую версию. Новый catalog snapshot
не переключает default и не получает runtime proof от предыдущей версии.

Public snapshot помечен `runtime_usable=false`: он доказывает каталог и
ограничения интерфейса, но не entitlement или точную цену аккаунта.
`runtime:sources:check` скачивает только пять точно зафиксированных
first-party JavaScript URL, ограничивает размер и сверяет SHA-256,
не выводя само содержимое.

Исторический `settings:sources:check` заново получает registry, 45 provider forms и
прямые settings-helper dependencies, разбирает Source Map v3 только как данные
и сравнивает derived inventory с snapshot. Vendor bundles, maps и
`sourcesContent` в Git не сохраняются. Inventory v1 остаётся
`runtime_usable=false`: 97 literal, 85 dynamic и 10 legacy classifications —
это frontend evidence, а не доказательство backend acceptance.

### Authorized write

```bash
npm run catalog:sync -- --archive --confirm-source-fetch
node scripts/settings-source-history.mjs --archive --public-version sha256-75fa89113113cd83447e36064aa871f91dda43d9c3c16fc5c1e96364f974d7b8.json --build-id 1788524349 --confirm-source-fetch
npm run settings:ir:sync
npm run settings:parser:sync
npm run settings:census:sync:local
npm run settings:source-backed:sync
```

Для нового settings archive сначала выполните `npm run build`. Пример выше
использует входы D-063; выбор версии и восстановление описаны в
[руководстве](docs/проект/версии-источников-настроек.md).
Старый `npm run settings:sources:sync` теперь отказывает до сети и
перезаписи v1, хотя его npm wrapper сначала пересобирает ignored `dist`.

`settings:source-backed:sync` — create-once: пишет v3-artifact только
если он ещё не существует, никогда не перезаписывает существующий.

Команда `catalog:sync -- --archive --confirm-source-fetch` создаёт новую версию рядом со старой;
выбор в MCP и восстановление описаны в [D-062](docs/проект/версии-публичного-каталога.md).

Каждая `sync`-команда может изменить соответствующий snapshot и запускается
только после отдельного разрешения на запись и review предыдущих checks. В
текущем Gate C не запускать Gate B `settings:parser:sync`.
Эта команда требует рабочую
копию исходного кода; запись атомарна.

`settings:census:sync:local` — единственная C0-команда, меняющая
manifest. Она offline, пересобирает ignored `dist`, пишет через
source-only atomic writer и не запускает settings AST compiler. В этом
milestone она была запущена ровно один раз после записи intent.
Автоматический
sync или retry при drift, build или cleanup failure запрещён.

### Gate C1a: source-backed partial result

`catalog/runtime/v3/normalized-settings-parser-source-backed-result.json`
имеет schema 3.0.0 и narrow scope: 1/42 forms, 4/192 models, 1/123 source
identities. Artifact: 5,722 bytes, mode `0644`, SHA-256
`48d1ec27e31a60a55de4a58aaff2ca77c91fb6b6d5fdb9ff05ea96d573ca2146`.
Он связывает Gate B parser, C0 artifact/cohort, compiler aggregate и
seven-component implementation set; его результат — 0 proven, 0 absent и
6 blocked projections, `runtime_usable=false`.

В этой серии было шесть public GET: по два в одном probe, одном create-once
sync и одном непреднамеренном `check-source` из устаревшего test. Все exit 0;
последующий default suite исправлен и больше не вызывает source mode. Это
подтверждает pinned byte refetch и exact Gate B equality, но не current active
build, backend contract, payload equivalence, runtime или generation. Перед
любым будущим source mode нужен отдельный intent; cleanup uncertainty означает
reconcile target+lock и запрет retry.

Текущий source-backed результат честно остаётся частичным: все шесть form
projections `BLOCKED`; сохранены только static candidates
`aspect_ratio=9:16`, `image_size=2K` и группа `format=[aspect_ratio]` с
локаторами. Это не runtime defaults и не доказательство backend acceptance.
Шесть `computed`, три `watch`, один template `v-if`, динамический доступ к
model metadata и непроверенный payload дают 17 явных blockers. Ни parser, ни
его snapshot не импортируются generation runtime.

### Gate C0: census, а не parser result

Сохранённый
`catalog/runtime/v2/normalized-settings-parser-census-manifest.json` имеет:

```text
schema_version: 2.0.0
evidence_level: STATIC_INVENTORY_COHORT_PLAN
source_verification_status: PINNED_IN_INVENTORY_NOT_REFETCHED
compilation_status: NOT_COMPILED
runtime_usable: false
forms: 42 = 39 model-bearing + 3 zero-model
models: 192 = 182 current + 10 legacy
sources: 123 = 76 compile boundary + 47 deferred
locators: 351 = 324 provider + 27 helper, из 6 helper refs
```

Full-state cohort hash:
`sha256:8c8b4bc02272e3fddd3d11dcc24cb903b66a3ff13848c2ea4085b852d7b8e959`.
Artifact: 428390 bytes, SHA-256
`611196c4245adf1a4d7860cc1ad183192dc074ececd538bdbf99b65efe5bad06`.
Статусы буквальны: Gate C0 не перезагружал 123 source identities,
не компилировал их, не создавал defaults/candidates/blockers и не
доказывал backend/runtime support.

Gate C1b (generic canonicalizing adapter) построен и опубликовал 24 из
26 eligible-форм (первая — `wan-video`, D-045; батч остальных — D-046,
`docs/проект/решения.md`); 2 формы отказали структурно (DEBT-041).
Подробности и оставшийся объём — `AGENTS.md`. Он не переписывает C0
manifest как будто тот был source-verified или compiled.

Отдельная линия работы (не часть Gate C1b): `SyntxUpstreamAdapter`
(`src/adapter/syntx/upstream-adapter.ts`, D-048) — первая реализация
generation-mutation стороны `UpstreamAdapter`-порта, построена и
трижды прокритикована, но осознанно НЕ подключена к runtime. Мост
`model_id → ai_name` (DEBT-043, D-049) закрыт на уровне семейства
SYNTX, уровень конкретного варианта модели — открытый DEBT-048.
Подробности — `AGENTS.md`, `docs/проект/незакрыто.md`.

В установленном npm-пакете `syntx-settings-ir --check`,
`syntx-settings-parser --check`, `syntx-settings-census --check`,
`syntx-settings-source-backed --check` и
соответствующие npm scripts проверяют уже
сохранённые evidence artifacts offline. Parser source modes до project import
отклоняются без полной рабочей копии исходного кода; compiler и raw-source-returning loader
в package отсутствуют. Отдельный исторический maintenance API/скрипт settings
inventory намеренно остаётся в private package: он делает bounded GET
публичных JS/map и возвращает только derived evidence inventory без source
bodies. Это не parser refresh и не generation runtime; его состав повторно
решается перед любым public release.

## Проверка

```bash
npm ci
npm run typecheck
npm test
npm run catalog:check
npm run runtime:sources:check
npm run settings:sources:check
npm run settings:ir:check:source
npm run settings:census:check
npm run settings:census:check:local
npm run settings:source-backed:check
npm run package:smoke
npm audit --omit=dev --audit-level=high
npm pack --dry-run --json
```

`package:smoke` автоматически создаёт реальный tarball без lifecycle
scripts, ставит его offline в одноразовый consumer с `--ignore-scripts`,
проверяет IR/parser/census/source-backed bins, packaged npm scripts, запрет source/local sync в
`node_modules`, отсутствие offline compiler tools в tarball и оба public
imports, затем удаляет временный каталог. До запуска
требуется `npm ci`, чтобы exact dependencies из lockfile были в локальном
npm cache.

Состав опубликованного tarball определяет **только** `package.json`'s
`files` (плюс встроенные npm-правила вроде всегда включённого `package.json`)
— `npm pack` игнорирует `.gitignore` полностью. `.gitignore` защищает
только рабочее дерево и `git status`/коммиты от служебных файлов (temp
locks, pending-снапшоты); он не гарантирует и не может гарантировать, что
те же файлы не попадут в опубликованный пакет. Единственная реальная
защита состава tarball — `package:smoke` (реальная установка + code guard
`scripts/check-package-install.mjs`) и `npm pack --dry-run --json` (DEBT-020,
закрыто D-067).

Реальный owner smoke выполняется только по явному opt-in и не запускает
генерацию:

```bash
npm run live:owner:smoke
npm run live:owner:chat-smoke
```

Скрипты не выводят UUID, Telegram payload, credential, баланс,
стоимость или профиль; после проверки выполняется локальный
unlink. Chat-smoke дополнительно создаёт и сразу удаляет один пустой
технический чат; generation endpoint он не вызывает.

## Канон проекта

Начните с [индекса документации](docs/README.md), затем прочитайте
[мастер-план](docs/проект/мастер-план.md), [архитектуру](docs/проект/архитектура.md)
и [открытый debt](docs/проект/незакрыто.md). Для продолжения незавершённой
работы используйте [текущий handoff](docs/проект/текущий-handoff.md).

## Публикация

Локальный git-репозиторий готовится как source of truth. GitHub remote, hosting,
public release и branding не создаются автоматически: это отдельные внешние
действия после security/client проверки и фиксации production scope.
