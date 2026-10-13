---
name: syntx-mcp-update
description: Maintain this SYNTX MCP's versioned public catalog and source-backed settings coverage; use for catalog updates, source/UI audits, and impact mapping—not for running paid generation.
---

# SYNTX MCP maintenance

Use this skill when updating the MCP's public model catalog, static settings/source evidence, or the map of affected models and code. The repository's `skills/syntx-mcp-update/` is the distribution source. This skill and its references are self-contained when installed globally. If working from the project checkout/package and project-specific status is needed, resolve the actual project root first, then read `docs/интеграция/Обновление-MCP.md` relative to that root; do not resolve it relative to the installed skill directory.

If the MCP client provides resources but no local skill installation, call `resources/list` and read `syntx://maintenance/skill`, `syntx://maintenance/cli-guide`, and `syntx://maintenance/ui-guide`. In the skill resource, those last two URIs are the MCP equivalents of its relative CLI/UI reference links; do not resolve those relative paths against an arbitrary client working directory. These resources supply instructions only; reading them does not run a compare/probe, authenticate an account, or test the host's UI.

When the connected MCP server exposes maintenance tools, discover their current
schemas with `tools/list` before calling them. Use
`syntx_list_update_versions` and `syntx_plan_mcp_update` for exact
packaged-archive selection and a paged offline plan; do not treat one returned
page as the complete census. The [MCP maintenance route](references/maintenance-cli.md)
documents the confirmed paging and settings-pair rules. If these tools are
absent, keep using the packaged resources and source-checkout/installed CLI
paths below.

Archive discovery is not a latest-version selector: its SHA-name ordering does
not establish chronology or the live build. Bind baseline and candidate to
confirmed run/source identities before comparing; read the CLI reference's
version-selection guidance when those identities are missing.

For exact offline/probe/audit-plan CLI forms, read [the CLI reference](references/maintenance-cli.md). When inspecting authenticated UI or tracing changed settings into code, read [the UI audit and impact reference](references/ui-audit-and-adaptation.md), including its navigation discovery and bounded UI pass, full-census, incremental-update, resume, project-map, and “Changed-source reuse and handoff” guidance. The maintenance probe covers public catalog JSON only; it does not refresh frontend/settings source inventory. If that refresh is needed, resolve the project root and follow that checkout's current documented workflow. Local agent installs are managed copies; do not edit them independently or upload cloud Skills as part of this workflow.

When both exact public and paired settings archives are available, `--plan-audit --control-walk` adds a source-derived per-control queue and a separate closed-schema control checkpoint. It helps resume known inventory keys after source changes; it does not discover rendered controls, buttons, or conditional branches. Keep rendered UI and account/tariff coverage `NOT_CHECKED` until separately observed.

Treat complete control-walk CLI output as data: summarize census, deltas, gaps, and resume status first, then inspect rows only for affected or explicitly selected model IDs. Preserve the full artifact and checkpoint locally; do not paste the full walk into chat or truncate its coverage.

Keep public catalog identity separate from the current user's account access or tariff. An account-level unavailable model is not removed from the shared catalog. For an explicitly requested account-specific audit, discover the currently supported auth and account-read tools through `tools/list`; do not assume tool names or reuse another person's browser profile, cookies, token, Telegram session, private conversations, or account details. If the current user's normal link flow requires a Telegram confirmation, the user completes that confirmation. Then read only the available balance, subscription, and model-access status needed for the audit. If the tools or link are unavailable, continue public-only and report account availability as `NOT_CHECKED`; never buy or renew a plan.

On every continuation of an explicitly requested account audit, rediscover supported reads and re-read current balance, subscription/expiry, and model access; do not carry a prior session's tariff observation as current or place account-local state in a portable checkpoint.

Default to offline comparison of exact archived versions. Public source probing is a separate bounded GET mode and requires an explicit request to fetch plus `--confirm-source-fetch`; it does not archive or switch selectors. Compare/probe modes are report-only. When the user's update request includes implementation, use verified changed-source evidence to make the smallest scoped parser/profile/code adaptation, preserve history, and add focused tests. Do not blind-promote unsupported behavior, switch runtime selectors, or perform paid/external actions automatically. A source hash change can invalidate dependent evidence even when normalized model rows are unchanged.

During implementation, preserve confirmed settings/helper/sender/result
changes as redacted project facts, an impact map, and a resumable handoff. Add
a reusable procedure here only for an evidence-backed repeatable gap; model
IDs, version facts, and source pins stay in the run record. For identity,
paging, freshness, gaps, consumers/tests/results, and closure, see “Continuous
learning and run closure” in [the UI audit reference](references/ui-audit-and-adaptation.md).

For source/UI coverage, enumerate the affected model IDs, form branches, settings, conditional visibility, actions, helper/store/sender joins, and code consumers. Keep unknown, blocked-by-plan, not-visited, and unsupported coverage distinct. A partial audit is useful; do not call it a full UI inventory. Use only the current user's supported browser/account surface when available. Without it, continue public-only and report account availability and rendered UI as `NOT_CHECKED`.

Observe controls without activating paid generation, deletion, training, publication, deployment, purchase/renewal, or changing account settings/ownership. These operations are outside maintenance and require a separately authorized task. The only account-link flow in scope is the normal current-user link needed for an explicitly requested account-specific audit, with any required user confirmation; never unlink or relink another identity. Store only allowlisted labels, control names, hashes, version metadata, safe model IDs, and impact summaries. Do not retain raw API payloads, DOM/screenshots, private prompts, palettes, chat contents, tokens, or account identifiers.

After a code or parser change, run the checks that actually cover it, inspect the redacted report, and read back any changed local source/version artifacts. Separate source comparison, UI/account observation, provider acceptance, package installation, and client-host compatibility in the final status. Skill instructions and public source alone do not prove arbitrary future UI coverage or backend acceptance.
