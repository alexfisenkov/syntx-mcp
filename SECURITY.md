# Security Policy

This repository is an alpha source project, not a security-reviewed hosted
service. There are no stable release branches or response-time guarantees yet.

## Reporting a vulnerability

Do not publish credentials, Telegram handoff links, account identifiers, private
logs, user media, or exploit details in a public issue. First check whether
GitHub private vulnerability reporting or a private Security Advisory is enabled
for `alexfisenkov/syntx-mcp`; use it if available. If it is not available, open
a minimal public issue asking the maintainers for a private reporting channel,
without including technical details.

Please include the affected commit/version, a minimal reproduction, impact, and
any relevant sanitized logs. Never attach real tokens, cookies, Telegram
sessions, account data, or provider media.

## Scope and expectations

Reports about this repository's code, packaging, or CI are in scope. Provider
account security, upstream service behavior, and third-party Telegram tooling
are outside this repository's control. There is no bug-bounty program or
guaranteed response SLA. Do not test against real accounts or perform paid
uploads/generations while investigating.
