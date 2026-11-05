# Личный HTTPS MCP для ChatGPT и VPS

Этот режим позволяет подключить свой SYNTX MCP к облачному ChatGPT. На VPS
работает отдельный экземпляр с вашим профилем SYNTX. У каждого пользователя
свои установка, вход через Telegram и приватное подключение ChatGPT.
Публичный GitHub-репозиторий распространяет код; общий аккаунт SYNTX он не
предоставляет.

## Порядок подключения

1. Установите проверенный публичный выпуск из
   [alexfisenkov/syntx-mcp](https://github.com/alexfisenkov/syntx-mcp) на сервер
   с Node.js 24.21.x, FFmpeg и FFprobe. Используйте `npm ci` и `npm run build`
   в выбранном выпуске. У сервера должен быть собственный домен с действующим
   HTTPS. Закрепляйте конкретный commit и сверяйте результат его CI.
2. Разверните шлюз. Приведённый ниже Linux helper рассчитан на уже настроенные
   systemd/nginx и существующий TLS vhost с указанным `include`. Его первый
   запуск без `--apply` только проверяет окружение и выводит план. Он не
   настраивает DNS и не выпускает сертификат. Для другой инфраструктуры
   можно запускать `syntx-mcp-https serve` с приватной конфигурацией и своим
   HTTPS reverse proxy; структура конфигурации описана ниже.
3. В настройках ChatGPT включите доступный вашему аккаунту режим разработчика
   приложений и добавьте свой MCP по адресу
   `https://mcp.example.com/syntx-ai/mcp`. Выберите OAuth. Шлюз поддерживает
   динамическую регистрацию публичного клиента: заранее выдавать client secret
   не требуется. Порядок и доступность этих экранов определяет ChatGPT:
   [официальная инструкция](https://developers.openai.com/plugins/deploy/connect-chatgpt).
4. На странице авторизации появится идентификатор запроса. В доверенном
   терминале сервера выполните `pending`, сверьте client, redirect, scope и
   resource, затем `approve REQUEST_ID` командами ниже. После одобрения
   страница продолжит вход. Кнопка в публичном браузере и MCP-инструменты
   сами одобрить доступ не могут.
5. В подключённом MCP запустите обычный вход в SYNTX через Telegram и
   подтвердите его своим аккаунтом. Это отдельный шаг после OAuth. Затем
   запросите баланс, подписку и доступность нужной модели. На сервер не нужно
   переносить cookies, Telegram-сессию или профиль браузера с компьютера.
6. Приложите исходное изображение, видео или аудио к запросу в ChatGPT.
   Инструменты загрузки с `fileParams` принимают вложение и возвращают
   привязанный к профилю handle; передайте его соответствующему инструменту
   генерации. Число файлов, тип и настройки проверяет конкретная модель.
   Путь к файлу на вашем компьютере не является путём на VPS.

OAuth разрешает доступ к вашему MCP, а Telegram связывает ваш SYNTX-профиль.
Отзыв подключения ChatGPT и выход из SYNTX относятся к разным уровням.
Поддержка протокола, успешная CI, фактическое подключение ChatGPT и реальная
генерация проверяются отдельно; инструкция не заменяет такую проверку.

## Конфигурация своего reverse proxy

`SYNTX_HTTPS_CONFIG_FILE` указывает на приватный JSON вне любого Git-репозитория.
Файл должен иметь права `0600`, каталоги состояния — `0700`. В конфигурации:

- `publicOrigin` — HTTPS origin без завершающего `/`, например
  `https://mcp.example.com`; `basePath` — `/syntx-ai` или пустая строка.
- `stateDirectory` — отдельный абсолютный каталог OAuth, `ownerSubject` —
  постоянный идентификатор владельца этой установки.
- `redirectUris` — точный allowlist; для документированного подключения
  ChatGPT: `https://chatgpt.com/connector_platform_oauth_redirect`.
- `allowedOrigins` — допустимые browser origins, например
  `["https://chatgpt.com"]`; `port` — порт loopback, по умолчанию `3031`.
- `child.nodeExecutable` — канонический абсолютный путь к Node;
  `child.environment` — окружение owner-stdio из существующего
  `syntx-mcp-media-config --confirm-enable-paid-tools --include-all-supported-media`.
  Замените все заглушки доверенными абсолютными путями к FFmpeg/FFprobe,
  собственными приватными путями `SYNTX_OWNER_AUTH_PROFILE_DIRECTORY` и
  `SYNTX_OWNER_AUTH_KEY_FILE`, а upload destination — на разрешённый
  `uploaded` или `hidden`. Ключ создаётся для этой установки отдельно.

HTTPS CLI запускает канонический owner-stdio из того же установленного пакета.
Шлюз слушает только loopback; TLS обслуживает ваш reverse proxy. Для префикса
`/syntx-ai` нужно проксировать **все три** поверхности без изменения пути:

```text
/syntx-ai/
/.well-known/oauth-authorization-server/syntx-ai
/.well-known/oauth-protected-resource/syntx-ai/mcp
```

Сохраняйте заголовок `Authorization`, ответы `401` и `WWW-Authenticate`.
Не подменяйте их страницей другого входа. Отключите кеширование и buffering;
согласуйте ограничения тела и таймауты с конфигурацией шлюза. Готовый
[nginx template](templates/syntx-ai.nginx.conf.tpl) и helper ниже задают эти
параметры явно. Описание OAuth:
[OpenAI authentication](https://developers.openai.com/plugins/build/auth).

## Обновление HTTPS-установки

Сначала получите результаты незавершённых операций через GET-only recovery
или историю SYNTX. При неизвестном исходе не повторяйте платный запрос.
Установите новый проверенный commit в отдельный release-каталог, выполните
`npm ci`, сборку и предварительную проверку. Для обновления helper требует
точные хэши текущих файлов и явное подтверждение перезапуска; старый выпуск
и приватное состояние сохраняются для отката. Команды приведены ниже.

После перезапуска обновите список инструментов подключения ChatGPT и
проверьте новые схемы в новом чате. Наличие кода на GitHub само по себе не
обновляет работающий процесс или сохранённый клиентом список инструментов.
Удалённому агенту недоступны локальные self-update и произвольные команды
сервера: обновлением VPS управляет владелец через доверенный терминал.
Локальные stdio-установки используют
[инструкцию обновления MCP](../docs/интеграция/Обновление-MCP.md).

## Linux helper: preflight, apply, OAuth approval и rollback

This deployment serves one owner's SYNTX account. Every other user installs a separate instance and completes their own SYNTX Telegram login. No shared provider credentials, imported desktop profiles or public sign-up service are provided.

The helper installs an already built, clean, root-owned **public Git checkout** at an exact reviewed commit. It does not clone, download Node, install npm dependencies, modify DNS, create certificates, edit an existing nginx vhost, import credentials or generate paid work. Provision Node24.21.x, ffmpeg, ffprobe and the immutable public release first; require the final CI receipt for that exact public commit. The helper records the owner-supplied CI URL; it does not independently query GitHub or certify that run.

Run `node deploy/private-owner-install.mjs --help`. Default execution is a read-only Linux preflight and complete rendered plan. Supply canonical absolute paths and the SHA-256 of the reviewed existing TLS vhost:

```sh
/absolute/node24 deploy/private-owner-install.mjs \
  --release /opt/syntx/releases/public-EXACT_PUBLIC_SHA \
  --expected-commit EXACT_40_HEX_PUBLIC_SHA \
  --node /absolute/canonical/node24 \
  --ffmpeg /absolute/ffmpeg --ffprobe /absolute/ffprobe \
  --domain mcp.example.com --base-path /syntx-ai --port 8860 \
  --vhost /etc/nginx/sites-available/example \
  --expected-vhost-sha256 EXACT_64_HEX_VHOST_HASH
```

The existing TLS vhost must already contain `include /etc/nginx/masterskaya-mcp-cloud/*.conf;` in the intended server. Review the domain/server association yourself. The helper checks the pinned vhost source and `nginx -t`; it never inserts or rewrites the include. Only `/etc/nginx/masterskaya-mcp-cloud/syntx-ai.conf` is created/updated. It contains three locations: `/syntx-ai/`, exact `/.well-known/oauth-authorization-server/syntx-ai`, exact `/.well-known/oauth-protected-resource/syntx-ai/mcp`. Existing MCP namespaces stay outside this helper's write scope. `auth_request off` applies only in these locations because this gateway enforces its own OAuth.

On a new installation the three target CAS values default to `absent`. For an update, pass `--expected-unit-sha256`, `--expected-nginx-sha256`, `--expected-config-sha256` from the reviewed current files. A mismatch stops before writes. Once the plan and exact public CI are checked, run the same command as root with:

```text
--apply --ci-run-url https://github.com/alexfisenkov/syntx-mcp/actions/runs/EXACT_RUN_ID
```

An already active owner runtime additionally requires `--acknowledge-runtime-restart`. This is a deliberate operator acknowledgement: reconcile every unknown paid result before restarting. Restart clears the gateway mutation circuit and loses process-local references/recovery handles. The service never automatically retries or recreates generation work. Do not acknowledge just to retry an unknown generation.

The helper creates system user `syntx-mcp` with no login shell, private `/var/lib/syntx-mcp`0700, separate `oauth-state`/`owner-profile`0700, a **fresh**32-byte `auth.key`0600 and `launch.json`0600. The key is never printed or imported. Existing own key is checked by metadata without reading its contents and is retained. The canonical supported-media environment comes from this release's existing config generator; trusted absolute ffmpeg/ffprobe paths and the explicit `uploaded` destination replace placeholders. Use `--upload-destination hidden` if that deployment requires it. Self-update and local path access are forced off. Code and runtime binaries must be outside protected `/root`/`/home` paths and writable only by root; normal root-owned internal npm symlinks are allowed.

The systemd unit binds gateway to loopback8860, memory3GiB, CPU100%, private tmp/devices, strict system protection and writes only under its private state directory. Body and child-stdio bounds are192MiB, supporting bounded Base64 transport for eligible uploads up to the file facade's100MiB ceiling; this is not proof any particular provider accepts that size. At most two tool/file-preparation calls run concurrently. Proxy response deadline and graceful stop allowance are960s; individual child calls are bounded at15min. Plan the VPS resource budget before activation.

Activation backs up only this unit/nginx/config in a root-only directory under `/var/backups/syntx-mcp-https`, verifies CAS again, validates systemd/nginx syntax, starts only this service, reads loopback health and unauthenticated401 metadata, then reloads nginx. It prints a receipt path, not credentials. Public HTTPS, OAuth in ChatGPT, file injection/download and provider behavior still require separate read-back. The helper does not claim those are passed. The nginx namespace disables access logging, limits error logs to critical, disables response caching/buffering and drops spoofable identity/forwarding headers. OAuth client headers/cookie still reach the gateway for its own validation.

To authorize a ChatGPT connection, the browser displays a nonsecret request ID and waits. In the service's trusted terminal:

```sh
sudo -u syntx-mcp env SYNTX_HTTPS_CONFIG_FILE=/var/lib/syntx-mcp/launch.json \
  /absolute/canonical/node24 /opt/syntx/releases/EXACT/dist/src/transports/https-owner.js pending
sudo -u syntx-mcp env SYNTX_HTTPS_CONFIG_FILE=/var/lib/syntx-mcp/launch.json \
  /absolute/canonical/node24 /opt/syntx/releases/EXACT/dist/src/transports/https-owner.js approve REQUEST_ID
```

Review client, exact redirect, scope and resource before approving. Only `https://chatgpt.com/connector_platform_oauth_redirect` is allowlisted by the template. This terminal approval authorizes access to the private MCP; afterwards the normal MCP SYNTX login still requires that owner's Telegram approval. No web button or model tool can approve OAuth or reset an unknown-result circuit.

If HTTP delivery fails after a mutating dispatch, the child continues and read-only reconciliation can retrieve the old result; further mutations fail closed. The mutation circuit is process-local: any process restart, including automatic `Restart=on-failure`, clears it and loses legacy reference/recovery context. Automatic restart never dispatches or replays MCP calls, but startup does not reconstruct unknown legacy jobs or restore the old mutation circuit. After a crash/restart, reconcile prior jobs through provider history or supported read-only tools before submitting new mutations; missing local handles do not prove that no paid work occurred. An intentional restart requires reconciliation **before** restarting. There is no remote/model-callable reset or automatic generation.

`KillMode=mixed` sends the initial SIGTERM only to the main gateway so it can drain calls and close child stdin through its normal EOF lifecycle, with a960s stop allowance and systemd cleanup of remaining processes. This preserves graceful shutdown opportunity; it does not make legacy state durable.

Rollback is scoped and CAS guarded:

```sh
/absolute/node24 deploy/private-owner-install.mjs \
  --rollback /var/backups/syntx-mcp-https/EXACT_RECEIPT_DIRECTORY \
  --apply --acknowledge-runtime-restart
```

It restores/removes only the three recorded installed files after hash checks, revalidates nginx and restores previous service activation state. It deliberately retains the service user, private state, fresh key and release for recovery. If a file has changed outside this deployment, rollback stops with a CAS conflict. Failed apply attempts automatic rollback of its own files and reports an explicit incomplete status when recovery cannot be verified. The private receipt contains backup hashes/paths; never commit it to the public release.

Local inert checks: `node --test deploy/private-owner.test.mjs` and `node --check deploy/private-owner-install.mjs`. Linux systemd/nginx preflight, apply, rollback and production acceptance are separately verified by the operator on the intended server.
