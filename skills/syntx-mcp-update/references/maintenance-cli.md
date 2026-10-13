# Maintenance CLI

The CLI compares exact archived source versions. `VERSION` means an exact
`sha256-<64 lowercase hex>.json` identifier. Use the installed
`syntx-mcp-maintenance` executable or, from a source checkout with current
compiled `dist/` artifacts, `node scripts/syntx-maintenance.mjs`. The source
script imports `dist/src/...`; it does not build on invocation. The package's
`files` allowlist includes `dist/src`, the CLI script, catalog, docs, and skill.

## Offline MCP tools

When the connected server exposes maintenance tools, discover their exact input
and output schemas with `tools/list` before use. The confirmed version reader is
`syntx_list_update_versions`:

```json
{"source_kind":"public","offset":0,"limit":100}
```

`source_kind` is `public` or `settings`; `offset` is nonnegative and `limit` is
1–100. Follow `next_offset` until it is `null` (and check `has_more`); `total`
is the full archive count, not the current page length. Settings entries include
`paired_public_version` and `paired_public_archive_available`; select only a
settings archive whose exact public pair matches the corresponding public
snapshot and is available.

Archive names are sorted lexicographically by SHA, not by source date. The
listing exposes no `latest` or active-selector marker; the first or last row
cannot identify an update. Take baseline from a confirmed previous run or
checkpoint and candidate from a confirmed current source/run identity or the
operator's explicit selection. If either is missing, say that version
selection is unresolved rather than choosing by hash order. To inventory one
explicitly selected archive without asserting an update, use it as both
baseline and candidate; this remains an offline census, not live freshness.

The confirmed offline planner is `syntx_plan_mcp_update`. Both page arguments
are required, even when no rows are expected:

```json
{
  "baseline_public_version":"VERSION",
  "candidate_public_version":"VERSION",
  "model_page":{"offset":0,"limit":100},
  "removed_page":{"offset":0,"limit":100}
}
```

Settings snapshots are optional but must be supplied as the baseline/candidate
pair and match those public versions. `control_page` is optional and requires
that settings pair; it has `offset`, `limit` (1–100), and optional unique
`model_ids` (at most 100). `model_checkpoint` and `control_checkpoint` are
separate optional closed schemas. The result carries global summary/census and
diff counts alongside the requested `model_page`, `removed_model_page`, and,
when requested, `control_walk.page`. Read subsequent offsets until each page's
`next_offset` is `null`; do not infer full completion from a short slice.

MCP plan calls are offline and report-only: they do not fetch, write archives,
authenticate, inspect the current account or rendered UI, or perform paid
operations. The combined model/control checkpoint input and returned templates
are capped at 4,000 observations and 1 MiB. This observation limit is distinct
from the complete static control census limit of 250,000 rows. A successful
plan is not a rendered-UI, account, provider, or code-adaptation result.

An installed MCP package can list its packaged archives and produce this
read-only plan, but the tool does not rewrite itself or update a managed skill
copy. Source/profile/parser adaptation requires a writable project source
checkout plus its focused tests and checks; if only the installed package is
available, stop at the report and state that source adaptation remains pending.

## Offline comparison

```bash
syntx-mcp-maintenance --compare --baseline-public VERSION --candidate-public VERSION
```

Settings comparison is optional, but must be paired and bound to the respective
public snapshots:

```bash
syntx-mcp-maintenance --compare \
  --baseline-public VERSION --candidate-public VERSION \
  --baseline-settings VERSION --candidate-settings VERSION
```

For a trusted local archive outside the default catalog directory, add
`--catalog-directory PATH`. The CLI rejects unsafe versions/paths and symlinks.
Comparison is offline and read-only; it prints a redacted deterministic report.

## Offline audit plan and resume

Build a source-bound incremental audit plan from the exact archived public
snapshots; settings snapshots are optional but must be paired:

```bash
syntx-mcp-maintenance --plan-audit \
  --baseline-public VERSION --candidate-public VERSION
```

```bash
syntx-mcp-maintenance --plan-audit \
  --baseline-public VERSION --candidate-public VERSION \
  --baseline-settings VERSION --candidate-settings VERSION \
  --checkpoint .журналы/обновления/audit-checkpoint.json
```

`--plan-audit` is offline, report-only, and mutually exclusive with
`--compare` and `--probe-public`. It reads an optional explicit checkpoint but
never writes one. `--catalog-directory PATH` may be added for a trusted local
archive outside the default catalog directory. The nested `plan` value contains the
comparison report, the complete candidate census, removed IDs, an affected
queue, per-model checklist obligations, checkpoint resume status, and a
checkpoint template. Models are ordered by source metadata as image, video,
audio, other, text, then unknown; unknown modality remains visible. The
checklist represents work to inspect, not controls discovered in the UI.
Modality comes from the candidate snapshot's AI row joined by `ai_name`:
recognized image/video/audio/text scopes map directly; the image/video inpaint
and upscaler tool scopes map to their respective modality. Missing or unknown
scope stays `unknown`; do not infer modality from accepted input-media types or
the model's display name.

The checkpoint template uses schema version `1.0.0` and binds its observations
to `source_identity` (`public_version`, `public_hash`, and paired nullable
`settings_version`/`settings_hash`). It records only public/control observations
with statuses `OBSERVED` or `UNSUPPORTED`; it does not persist the
`NOT_VISITED` default, account-access status, or `BLOCKED_BY_PLAN`. Those
account-local statuses must not be exported or carried between audits. Use
normal local file tools to save an edited allowlisted checkpoint under the
hidden project journal or another private local output path. The CLI neither
creates directories nor mutates checkpoints. Do not save account IDs, freeform
notes, prompts, palettes, DOM, screenshots, tokens, or raw payloads.

The checkpoint input must be an explicit regular local file, at most 1 MiB,
with strict UTF-8 and the closed schema; symlinks and unsafe paths are rejected.
Validation errors do not echo checkpoint contents or private paths.

### CLI result envelope

The audit-plan object is nested under the CLI result's `plan` field. The
serialized CLI output and `main()` return an outer envelope with
`schema_version`, `operation`, the selected public/settings version fields,
`plan`, and optional sibling `control_walk`. The shape described below is the
`plan` value, not the outer CLI result. With the programmatic CLI entry point,
read `result.plan.census.total_models` and
`result.plan.checkpoint_resume.status`; `result.census` is undefined. The
optional `control_walk` is at `result.control_walk`, not inside `plan`.

For example, a programmatic caller reads:

```js
const result = await main(argumentsList, { writeStdout: () => {} });
const totalModels = result.plan.census.total_models;
const resumeStatus = result.plan.checkpoint_resume.status;
```

In `--compare` mode the outer result contains `report`, not `plan`; there is no
audit-plan `census` on that result. Do not share an accessor between the two
operations without checking `operation` and the corresponding field.

The `plan` value's top-level shape is `schema_version`, `operation`,
`source_identity`, `report`, `census`, `affected_queue`, `impact`,
`checkpoint_resume`, `checkpoint_template`, `coverage`,
`automatic_runtime_promotion`, and `paid_operations`. Each model's obligations use `controls`,
`conditional_branches`, `actions`, `references`, `settings`,
`helper_store_sender`, `results`, `mcp_consumers`, and `account_access`.
Resume status is `NONE`, `EXACT_SOURCE`, `CARRIED_UNAFFECTED`, or
`SOURCE_CHANGED_RESET`.

Resume from the exact current source identity. A checkpoint matching the
baseline can carry forward only unaffected observations; source changes mark
affected observations stale for recheck. A foreign source identity is rejected.
Inspect `checkpoint_resume.status`, `carried_observation_count`, and
`stale_model_ids`; never treat carried state as fresh evidence. The plan always
reports rendered UI, account access, and provider acceptance as `NOT_CHECKED`.

## Source-derived per-control walk

Opt into a separate per-control artifact only when both exact settings
snapshots are paired with the public versions:

```bash
syntx-mcp-maintenance --plan-audit \
  --baseline-public VERSION --candidate-public VERSION \
  --baseline-settings VERSION --candidate-settings VERSION \
  --control-walk
```

To resume its per-control observations, add an explicit separate file:

```bash
syntx-mcp-maintenance --plan-audit \
  --baseline-public VERSION --candidate-public VERSION \
  --baseline-settings VERSION --candidate-settings VERSION \
  --control-walk --control-checkpoint .журналы/обновления/control-walk.json
```

The optional result is a top-level `control_walk` object; the existing coarse
model-obligation plan and `--checkpoint` schema remain unchanged. The control
checkpoint is its own closed `1.0.0` schema, bound to the exact public and
settings source identity. The complete static candidate control census is
independently bounded to 250,000 rows. A portable checkpoint accepts at most
4,000 observations and 1 MiB; oversized checkpoints are rejected, never
truncated. For larger walks, keep operator-managed partial checkpoints for
separate work slices: each invocation reads one file and does not merge files,
so statuses absent from the supplied checkpoint remain `NOT_VISITED`. It stores
only deterministic safe `control_id`, source fingerprint, and
`OBSERVED`/`UNSUPPORTED` status. Current inventory keys
and origin enums are projected without public setting values; unsafe keys and
unknown model/form joins remain counted gaps without echoing their contents.
Controls start `NOT_VISITED`. Exact-source resume restores individual
observations; baseline carry keeps only IDs with unchanged fingerprints and
reports stale, added, changed, and removed IDs. Public, form, helper, registry,
app, or homepage hash drift invalidates controls according to their available
source dependencies; do not infer a narrower dependency than the artifact
proves.

This is a static source-key queue, not a rendered UI census. It does not invent
branch IDs, buttons, defaults, valid UI combinations, or tariff outcomes.
Conditional visibility is `NOT_EVALUATED`; account access, current tariff,
rendered UI, and provider acceptance remain `NOT_CHECKED`. Account/tariff status
is not accepted in this portable checkpoint. The CLI reads a regular local
checkpoint bounded to 1 MiB using the same symlink/path/UTF-8 guard as the
coarse checkpoint and returns a new template; it never writes either file.

Treat complete CLI output as data: first summarize census, deltas, gaps, and
resume status, then inspect control rows only for affected or explicitly
selected model IDs. Preserve the full artifact and checkpoint locally; do not
dump the full walk into chat or truncate coverage.

## Explicit bounded public probe

```bash
syntx-mcp-maintenance --probe-public \
  --baseline-public VERSION --confirm-source-fetch
```

Use this mode only when the user requests a public source fetch. It performs
allowlisted bounded GET requests, compares in memory, and does not archive,
rewrite source, change a selector, authenticate, or invoke provider generation.
Help/default behavior is offline. A failed, changed, or unsupported response is
reported as a gap; do not silently discard unknown schema fields or replace the
baseline.

This probe fetches the public catalog endpoints only; it does not fetch or
refresh frontend settings/form/helper inventory. If that source inventory must
change, resolve the current project root and consult its documented workflow
before any separate source fetch or archival action. Do not infer settings
coverage from the public-only probe.

## Frontend settings refresh in a writable source checkout

The mapless frontend inventory is a separate source-fetch operation, not an
MCP maintenance tool and not part of the installed-package CLI. It requires the
writable project checkout: the script imports `dist/src` and `dist/tools`, and
`scripts/sync-mapless-settings-inventory.mjs` is not in the package `files`
allowlist. From that checkout, after dependencies are installed, run:

Before running, record the existing filenames in `catalog/settings/v2/`.

```bash
npm run build
node scripts/sync-mapless-settings-inventory.mjs --public-version VERSION --confirm-source-fetch
```

Replace `VERSION` with the exact `sha256-….json` filename already present in
`catalog/public`. The script validates that public archive (hash, schema and
source hashes) before network access. This operation does fetch public
frontend source, so run it only when that fetch is explicitly requested; there
is no dry-run mode. The script discovers one build from `https://syntx.ai/`
(the root page, not `/ru`), then reads its app, settings registry/framework
helpers, and registered form modules. It does not take a build ID, fetch source
maps, authenticate, or inspect the rendered UI.

The fetcher is bounded to 64 requests and 64 MiB total, with 2 MiB homepage,
5 MiB app, and 2 MiB per JavaScript response; four form workers; a 300-second
overall and 30-second per-request timeout. Requests are GET-only, same-origin,
non-redirecting, credential-free, and not repeated. A failed form fetch aborts
archive creation rather than silently publishing a partial inventory.

On success, the command prints the inventory version and summary. Read it back
with `loadMaplessSettingsInventoryVersion(version)` from
`dist/src/catalog/mapless-settings-inventory.js`; verify
`public_catalog.version` equals the selected public `VERSION`, the schema is
`2.1.0`, `runtime_usable` is `false`, and build/summary match the command
output. This is a library loader, not a CLI or MCP tool. The archive is
content-addressed under `catalog/settings/v2/`; earlier versions are retained.
It contains derived metadata and source hashes, not fetched JavaScript bodies.
Unknown form joins remain unknown; extracted display/helper keys are not proof
of sender fields. The inventory does not promote a selector or establish
rendered controls, account access/tariff, provider acceptance, or paid behavior.

If output is lost, the command times out, or publication reports an fsync error,
stop and inspect any newly created exact version with the loader and its public
pair; do not replay the archive automatically. A target may have been linked
before a later sync error. A `.pending-*.tmp` file is not a version; preserve it
for diagnosis rather than treating it as complete or removing it blindly.

## Reading the report

Treat model/configuration deltas separately from date/metadata changes and raw
source-hash drift. Hash-only drift still invalidates evidence that depends on
that source. The report's account availability, rendered UI, and provider
acceptance are `NOT_CHECKED`; do not infer them from a public catalog probe.
