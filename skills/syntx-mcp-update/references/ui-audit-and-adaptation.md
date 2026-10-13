# UI audit and source-to-code impact

Use a current, supported authenticated browser/account path only for the
current user. For an explicitly requested account-specific audit, discover the
available auth, balance, subscription, and model-access reads through
`tools/list`; do not hardcode tool names, account/profile paths, or hidden
defaults. Use the current user's normal link flow if needed, and let the user
complete any required Telegram confirmation. Do not transfer credentials or
session state between profiles. If the needed tools, link, or supported
browser surface are unavailable, continue public-only and mark account
availability and rendered UI `NOT_CHECKED`; never treat missing access or plan
coverage as catalog deletion. Do not purchase or renew a plan during an audit.

Enumerate the affected model IDs first, then inspect their shared form and each
variant branch: visible controls, defaults/reset behavior, conditional
visibility, selectors, uploads/references, buttons/actions, and the settings
helpers, stores, and senders that consume them. Mark each surface as visited,
blocked by plan/access, not visited, or unsupported. A partial walk must remain
partial; skill instructions do not guarantee discovery of every future page.

Build an incremental impact map from changed source/form/helper identifiers to
model IDs and then to existing validators, preparers, transports, result
readers, and MCP tools. Inspect all branches and controls on the affected
surfaces, while leaving unrelated source evidence untouched. Preserve prior
versioned evidence and record new safe IDs/hashes/coverage so later model
changes can be compared rather than rediscovered from private/raw data. Reuse
existing project code paths where they truly match, but do not
transfer another model family's alias, default, file limit, MIME policy,
reference count, cost parameters, result shape, or provider proof. Preserve
variant-specific controls and valid combinations rather than validating only
one successful tuple.

## Full census, incremental updates, and resume

Use a full census when there is no compatible saved audit state or when the
operator asks to establish coverage from scratch. Start from the complete
candidate set in the selected public snapshot; keep every candidate visible in
the census, and retain removed IDs in the report's separate removed-ID list.
Models whose modality is unknown remain visible. Order the work image-first,
then video/audio/other, while retaining existing text entries. The audit
checklist describes obligations to inspect; it is not a claim that controls or
buttons were found.

Use incremental mode only with a report bound to the exact selected public
snapshot and, when supplied, its paired settings snapshot. Queue changed and
newly affected models for inspection, but retain the full candidate census so
additions, removals, and unknowns cannot disappear from view. A source hash
change invalidates dependent observations even if normalized rows are equal.
Recheck stale observations before relying on them. Do not carry account access
or tariff observations forward as public-source facts.

For a resumed account-specific audit, rediscover supported read tools and
re-read current balance, subscription/expiry, and model access. Keep that
account-local overlay private to the current user; never put it in the portable
checkpoint or treat an earlier session's tariff as current.

To resume, inspect `checkpoint_resume` and the exact source identity before
continuing. The plan may resume an exact-current-source checkpoint, carry only
unaffected observations from its exact baseline source, or identify stale
affected models for recheck. A foreign source identity, malformed checkpoint,
or source mismatch outside those cases must be rejected; never merge foreign
state. Plan obligations use `NOT_VISITED`, `OBSERVED`, `BLOCKED_BY_PLAN`, and
`UNSUPPORTED`; `OBSERVED` is an operator's record that a surface was visited,
not proof of provider acceptance. Persisted checkpoints contain only
public/control observations with `OBSERVED` or `UNSUPPORTED`. They omit
`NOT_VISITED`, `BLOCKED_BY_PLAN`, and the `account_access` obligation so
account-local coverage is never transported. Unknown new models and unresolved
checklist items stay visible after resume. Save a reviewed checkpoint template
to the project's hidden update journal or another explicit private local output
location using normal local file tools; the CLI only reads it and returns a
template. Store only allowlisted IDs, hashes, versions, statuses, and sanitized
coverage metadata.

For source-level resume at individual inventory fields, the optional
`--control-walk` artifact projects safe control keys and their source origins
from paired public/settings snapshots. Use its separate control checkpoint to
track `OBSERVED` or `UNSUPPORTED` per key; do not mark an inventory key as a
rendered control unless you actually saw it in the supported UI. Unknown form
joins, unsafe field names, and unresolved static mappings remain counted gaps.
Conditional visibility and dynamic branches are not derived by this helper;
discover and record them only through the normal UI audit, outside this
closed-schema artifact. Plan/account access remains `NOT_CHECKED`, and
`BLOCKED_BY_PLAN` or tariff observations are not saved in the portable
checkpoint or carried to another audit.

## Navigation discovery and bounded UI pass

At the start of every requested rendered-UI pass, take one safe navigation
overview of the supported current-user surface, even when public JSON is
unchanged. Enumerate the tabs, tools, sections, forms, and visible conditional
branches you find. A public-source census does not discover these surfaces.

Keep a separate redacted local engineering map, not an extension of the closed
portable checkpoint and not a serialized schema. For each discovered surface,
record only:

- safe surface label/key;
- proven model IDs, or `UNRESOLVED` when no safe source join exists;
- known source/build/hash identity, or `UNRESOLVED`;
- observed control and action labels;
- sanitized branch predicate, without entered values;
- coverage layer/status (`OBSERVED`, `NOT_VISITED`, `BLOCKED_BY_PLAN`, or
  `UNSUPPORTED`);
- impacted repository-relative paths and the next concrete step.

Do not create model IDs or source joins to fill a map row. Do not retain raw
DOM, screenshots, account IDs, input values, private prompts, bookmarks, profile
paths, or credentials. Discovering a button is not permission to activate it:
describe unknown, external, paid, training, delete, publish, or account-save
actions and leave them untouched. Explore a conditional branch only by a local
state change after establishing that it cannot submit, autosave, or otherwise
change server state. If that cannot be established, inspect source and mark the
branch `NOT_VISITED` and its predicate `UNRESOLVED`.

For tariff-specific branches, record only what is observed for the current user;
mark surfaces hidden by that user's current plan `BLOCKED_BY_PLAN`. Do not buy or
switch plans, or use another account/profile to fill coverage. Keep any
account-specific coverage in the private local overlay, never the portable
checkpoint.

Record the pass start identity and end identity using available safe build/hash
fingerprints. If identity changes during the pass, stop that pass as `PARTIAL`,
preserve its map separately, and build a new affected queue from the new
identity; do not keep rewalking until the page stops changing. Without a usable
start or end fingerprint, freshness is `UNVERIFIED`. Close a bounded pass when
every surface already discovered is visited, unsupported, or explicitly left as
a gap, and report current-account inaccessibility separately. This records
coverage of the discovered surface at that identity; it does not claim complete
coverage of arbitrary future UI.

Preserve safe dependency hashes and joins so unchanged evidence can be reused
only while its dependencies match. Do not refresh an unchanged source or UI
surface merely to repeat the same evidence. A new or changed identity queues
only its affected surfaces, while unresolved model IDs and newly found tabs,
tools, or form branches stay visible in the separate map.

## Changed-source reuse and handoff

Before another source GET, search the existing redacted notes for the exact
source SHA-256 and byte count. Reuse a finding only when its source identity and
the imports/helpers it depends on still match. A changed hash invalidates the
dependent join even if normalized rows are unchanged; identify affected model
IDs before opening a source.

For a changed form or helper, trace exact import/export aliases through lexical
scope and the relevant control predicates. Do not infer a join from a minified
variable name, a token, or two facts appearing in one bundle. Follow one
targeted path from defaults/reset and settings cache through the custom-payload
replacement decision to the actual sender. Keep cost-query inputs separate
from generation wire fields: a price lookup is not evidence of what the sender
serializes. If an edge is missing, name that exact join and the next consumer
to inspect; do not fetch a large unrelated bundle to fill the gap.

If the current environment provides a RAM-only source session, reuse it only
for its pinned sources and owning handle. Retain allowlisted hashes, versions,
safe IDs, offsets, and proven edge relationships—not vendor bodies or raw
payloads. Clear and close the same handle, then read back its empty/closed
status. If that session is unavailable, say so and use the supported workflow
that exists; do not invent a CLI or assume every MCP client has this runtime.

Keep the handoff as a separate redacted local engineering note, not an
extension of the closed portable checkpoint. Record exact source identities,
affected IDs, proven joins and boundaries, decisions and rejected leads, real
commands/results and terminal status, and the next concrete question/consumer.
Do not carry account-private observations into it. Static source evidence or a
visited-control status is not rendered-UI observation, provider acceptance, or
proof of a generated result.

## Continuous learning and run closure

Keep run-specific learning in the project's redacted facts, impact map, and
handoff: exact changed settings/helper/sender/result evidence, affected
consumers and tests, the command actually run and its result, unresolved gaps,
and one next concrete step. Update this reusable skill only after a demonstrated
repeatable procedure gap; do not promote model lists, source pins, private
account findings, or one-off conclusions into general instructions.

Whether a run finishes or is interrupted, leave a resumable closure with the
exact baseline and candidate public identities and paired settings identities,
page totals/completion state, remaining gaps, affected models/consumers/tests,
actual result, and next action. Reuse evidence only while its dependency
identities match; changed dependencies make their observations stale. Report
public/source, rendered UI, current-account/tariff, provider/result, and
client/host layers separately. Keep account/tariff observations private and
per-user; they neither transfer to another audit nor remove a model from the
shared public catalog.

Maintain separate evidence layers in every report: public catalog/source,
static settings/UI source, rendered UI observation, current-account access and
tariff, provider acceptance/results, and client/host behavior. A result in one
layer does not fill another. If account tools or the supported current-user
browser path are unavailable, mark that layer `NOT_CHECKED` and continue the
public/source work that remains available.

## Project source-to-code map

Resolve the repository root before using these paths. Public catalog and
settings history live under `src/catalog/` (notably
`public-catalog-history.ts`, `settings-source-history.ts`,
`settings-source-inventory.ts`, and source/profile modules). Search the current
model ID, source key, helper, form component, or setting name to locate its
consumers; do not maintain a hand-written list of every model:

```bash
rg -n 'MODEL_ID|source_key|helperName|setting_name' src tests scripts
```

Then trace the actual matches through the existing layers. Catalog and source
history include `src/catalog/syntx-public-catalog.ts`,
`public-catalog-history.ts`, `mapless-settings-inventory.ts`,
`settings-source-inventory.ts`, and `normalized-settings-*`. Local validation,
request preparation, and generation services live under
`src/application/owner-*parameters`, `owner-*request-preparer`, and
`owner-*generation-service`. Wire and result/history reads include
`src/adapter/syntx/chat-http-client.ts`; MCP schemas/tools and composition are
in `src/mcp/owner-*tools` and `src/mcp/server.ts`; lifecycle composition is in
`src/runtime/observed-owner-runtime.ts` and
`src/transports/stdio-owner.ts`. Related versioned source records may also be
under `catalog/`. Confirm each join by reading the matched call sites and tests.
Names and locations evolve, and families do not all use identical paths. Search
results and current source are the map; this orientation is not an exhaustive
registry or evidence that every consumer has been found.

Keep evidence minimal and sanitized: allowlisted labels and setting keys, safe
model IDs, hashes, versions, coverage statuses, and impacted filenames. Do not
save raw API responses, rendered DOM/screenshots, private prompts/palettes,
chat contents, auth state, cookies, tokens, or account identifiers into public
history.

Make the smallest source-bound change, add independent literal fixtures for
changed branches and negative cases, run focused tests plus the project's
package checks when authorized, and read back changed artifacts. Do not
automatically promote runtime/default selectors. Public source and static UI
analysis are not backend acceptance, billing, result, or client-host proof.
