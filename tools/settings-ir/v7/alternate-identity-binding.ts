import { createHash } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync, statSync } from "node:fs";
import { mkdir, open } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { createImmutableJsonSnapshot } from "../immutable-json-snapshot.js";
import { HELPER_MODULES, HELPER_SOURCE_PATHS, serializeHelperConstantsResult, type HelperConstantsResult } from "../v6/helper-constants-result.js";
import { serializeNormalizedSettingsParserCensusManifest, type NormalizedSettingsParserCensusManifest } from "../../../src/catalog/normalized-settings-parser-census-manifest.js";
import type { SettingsSourceInventory } from "../../../src/catalog/settings-source-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../../../src/catalog/syntx-public-catalog.js";

/**
 * DEBT-041 (docs/проект/незакрыто.md): hailuo-minimax and luma-image fail
 * Gate C1b's generic adapter because their vendor root form has no literal
 * AI_NAME export — that convention-based compiler (tools/settings-ir/
 * static-settings-compiler.ts, hash-bound in the published v3/v4 artifacts,
 * NEVER edited here) genuinely proves AI_NAME absent for both forms; this
 * is not a parsing bug.
 *
 * The D-064 v6 static-constants slice (tools/settings-ir/v6/) independently
 * extracted declaration-initializer constants from each form's separate
 * PINNED HELPER bundle (not the root form file) and found two differently
 * named constants that hold the exact same string as each form's expected
 * ai_name (catalog/runtime/v2/normalized-settings-parser-census-manifest.json):
 * Hailuo's video.js exports MINIMAX_MODEL_NAME = "hailuo-minimax"; Luma's
 * useLuma.js exports LUMA_AI_NAME = "luma_image". Both match byte-for-byte.
 *
 * This module does not weaken or reinterpret the AI_NAME convention check,
 * insert AI_NAME into vendor source, or touch any existing artifact — it is
 * a NEW, narrower evidence tier (D-052 precedent: new generations live
 * alongside old ones) that proves a DIFFERENT, curated claim: "this vendor
 * constant, found by static analysis alone, holds the same value the
 * discovery catalog already expects for this form's ai_name." The curated
 * table below is the only place a human decides which constant stands in
 * for which form; resolution always re-derives the value from the cited v6
 * evidence and refuses on any mismatch (same pattern as
 * src/catalog/generation-ai-name-bridge.ts's GenerationAiNameResolver).
 *
 * runtime_usable stays false: this proves identity binding, not backend
 * acceptance, generation runtime, or that Gate C1b's own artifact shape
 * should change. Closing DEBT-041 itself is a product decision, not this
 * module's to make.
 */

export const ALTERNATE_IDENTITY_RESULT_MAX_BYTES = 64 * 1024;

const CURATED_ALTERNATE_IDENTITY_ENTRIES = [
  {
    form_id: "hailuo-minimax",
    module_name: "video.js",
    source_path: "/src/components/chat/forms/settings/data/hailuo/constants.js",
    constant_scope: "module",
    constant_name: "MINIMAX_MODEL_NAME"
  },
  {
    form_id: "luma-image",
    module_name: "useLuma.js",
    source_path: "/src/components/chat/forms/settings/composables/useLuma.js",
    constant_scope: "module",
    constant_name: "LUMA_AI_NAME"
  }
] as const satisfies readonly {
  form_id: string;
  module_name: (typeof HELPER_MODULES)[number];
  source_path: string;
  constant_scope: string;
  constant_name: string;
}[];

/**
 * Round-2 critic-code: the create-once gate originally keyed only on
 * (helper_result_version, census_manifest_sha256), so a curated-table or
 * schema change (exactly what happened once already, adding
 * value_collides_with_model_ids below) makes the OLD archive for that same
 * pair both ALREADY_EXISTS-block a new one and fail its own --inspect
 * against the new code — the only way out was deleting it, which D-052
 * exists to avoid. Folding this fingerprint into the gate key means a new
 * profile generation legitimately gets its own archive alongside the old
 * one, the same as a new (helper_result_version, census_manifest_sha256)
 * pair already does.
 */
export const CURATED_TABLE_FINGERPRINT = createHash("sha256")
  .update(JSON.stringify(CURATED_ALTERNATE_IDENTITY_ENTRIES))
  .digest("hex");

const versionSchema = z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u);
const sha = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const formId = z.enum(
  CURATED_ALTERNATE_IDENTITY_ENTRIES.map((entry) => entry.form_id) as [
    string,
    ...string[]
  ]
);

const entrySchema = z
  .object({
    form_id: formId,
    ai_name: z.string().min(1).max(200),
    identity_source: z.literal("CURATED_ALTERNATE_CONSTANT_NAME"),
    // hailuo-minimax's ai_name also happens to be one of its own model_ids
    // (round-1 critic-code: MINIMAX_MODEL_NAME is named MODEL, not AI, and
    // this coincidence is exactly why) — this entry's evidence is weaker
    // than luma-image's (whose value does not collide with any of its
    // model_ids) even though both currently pass the same check. Recorded
    // explicitly so a reader deciding whether this evidence is sufficient
    // sees the difference in the artifact itself, not only by re-deriving
    // it by hand.
    value_collides_with_model_ids: z.boolean(),
    evidence: z
      .object({
        helper_module_name: z.enum(HELPER_MODULES),
        source_path: z.string().min(1).max(2000),
        source_content_sha256: sha,
        constant_scope: z.string().min(1).max(100),
        constant_name: z.string().min(1).max(200),
        locator: z
          .object({
            line: z.number().int().positive(),
            column: z.number().int().positive()
          })
          .strict()
      })
      .strict()
  })
  .strict();

const resultSchema = z
  .object({
    schema_version: z.literal(1),
    kind: z.literal("ALTERNATE_IDENTITY_BINDING"),
    // Fingerprints the exact curated table this result was produced against
    // (see CURATED_TABLE_FINGERPRINT) — part of the create-once key, not
    // just informational, so a future table/schema change never collides
    // with an older archive for the same (helper_result_version,
    // census_manifest_sha256) pair.
    profile_fingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    helper_result_version: versionSchema,
    census_manifest_sha256: sha,
    observed_at: z.iso.datetime(),
    runtime_usable: z.literal(false),
    entries: z
      .array(entrySchema)
      .length(CURATED_ALTERNATE_IDENTITY_ENTRIES.length)
  })
  .strict();

export type AlternateIdentityBindingResult = z.infer<typeof resultSchema>;

/** Re-derives every entry from the cited v6/census evidence; never trusts a caller-supplied value. */
export function resolveAlternateIdentityBindings(
  helperResult: HelperConstantsResult,
  censusManifest: NormalizedSettingsParserCensusManifest
): AlternateIdentityBindingResult["entries"] {
  return CURATED_ALTERNATE_IDENTITY_ENTRIES.map((curated) => {
    const censusForm = censusManifest.forms.find(
      (form) => form.form_id === curated.form_id
    );
    if (censusForm === undefined || !censusForm.ai_active) {
      throw new Error(
        `ALTERNATE_IDENTITY_FORM_NOT_ACTIVE: ${curated.form_id}`
      );
    }
    const module = helperResult.modules.find(
      (candidate) => candidate.module_name === curated.module_name
    );
    if (module === undefined) {
      throw new Error(
        `ALTERNATE_IDENTITY_MODULE_MISSING: ${curated.module_name}`
      );
    }
    const knownSourcePaths: readonly string[] = HELPER_SOURCE_PATHS[curated.module_name];
    if (!knownSourcePaths.includes(curated.source_path)) {
      // Defense in depth: the curated table itself must only ever name a
      // source path the v6 schema already recognizes for this module —
      // catches a typo in this file before it ever reaches source lookup.
      throw new Error(
        `ALTERNATE_IDENTITY_CURATED_SOURCE_PATH_INVALID: ${curated.source_path}`
      );
    }
    const source = module.sources.find(
      (candidate) => candidate.source_path === curated.source_path
    );
    if (source === undefined) {
      throw new Error(
        `ALTERNATE_IDENTITY_SOURCE_MISSING: ${curated.source_path}`
      );
    }
    const record = source.constants.records.find(
      (candidate) =>
        candidate.scope === curated.constant_scope &&
        candidate.name === curated.constant_name
    );
    if (record === undefined) {
      throw new Error(
        `ALTERNATE_IDENTITY_CONSTANT_MISSING: ${curated.constant_name}`
      );
    }
    if (record.status !== "STATIC_VALUE" || typeof record.value !== "string") {
      throw new Error(
        `ALTERNATE_IDENTITY_CONSTANT_NOT_STATIC_STRING: ${curated.constant_name}`
      );
    }
    if (record.value !== censusForm.ai_name) {
      throw new Error(
        `ALTERNATE_IDENTITY_VALUE_MISMATCH: ${curated.form_id} expected "${censusForm.ai_name}", constant held "${record.value}"`
      );
    }
    return {
      form_id: curated.form_id,
      ai_name: record.value,
      identity_source: "CURATED_ALTERNATE_CONSTANT_NAME",
      value_collides_with_model_ids: censusForm.model_ids.includes(record.value),
      evidence: {
        helper_module_name: curated.module_name,
        source_path: source.source_path,
        source_content_sha256: source.source_content_sha256,
        constant_scope: curated.constant_scope,
        constant_name: curated.constant_name,
        locator: record.locator
      }
    };
  }) as AlternateIdentityBindingResult["entries"];
}

/**
 * helperResult is required (not optional) precisely because --inspect must
 * catch the same class of tampering --archive already refuses to produce:
 * a stored ai_name/evidence that no longer matches what static analysis of
 * the cited v6 bundle actually proves (round-1 critic-code BLOCK — an
 * earlier version loaded helperResult in the CLI's inspect branch and never
 * used it, so a hand-edited or stale ai_name value passed offline
 * verification silently).
 */
export function validateAlternateIdentityBindingResult(
  value: unknown,
  helperResultVersion: string,
  helperResult: HelperConstantsResult,
  censusManifest: NormalizedSettingsParserCensusManifest,
  censusPublicCatalog: SyntxPublicCatalogSnapshot,
  censusInventory: SettingsSourceInventory
): AlternateIdentityBindingResult {
  const result = resultSchema.parse(value);
  if (result.helper_result_version !== helperResultVersion) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH");
  }
  if (result.profile_fingerprint !== CURATED_TABLE_FINGERPRINT) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH");
  }
  // Round-2 critic-code: helperResultVersion alone only proves the CALLER's
  // claim about which archive it loaded — it does not prove helperResult
  // itself actually IS that archive's content, which matters because
  // resolveAlternateIdentityBindings below re-derives evidence from
  // whatever helperResult was actually passed in.
  if (
    `sha256-${digest(Buffer.from(serializeHelperConstantsResult(helperResult)))}.json` !==
    helperResultVersion
  ) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH");
  }
  const censusText = serializeNormalizedSettingsParserCensusManifest(
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  if (result.census_manifest_sha256 !== `sha256:${digest(Buffer.from(censusText))}`) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_BINDING_MISMATCH");
  }
  const formIds = result.entries.map((entry) => entry.form_id);
  if (new Set(formIds).size !== formIds.length) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_DUPLICATE_FORM");
  }
  for (const curated of CURATED_ALTERNATE_IDENTITY_ENTRIES) {
    const entry = result.entries.find((candidate) => candidate.form_id === curated.form_id);
    if (
      entry === undefined ||
      entry.evidence.helper_module_name !== curated.module_name ||
      entry.evidence.source_path !== curated.source_path ||
      entry.evidence.constant_scope !== curated.constant_scope ||
      entry.evidence.constant_name !== curated.constant_name
    ) {
      throw new Error("ALTERNATE_IDENTITY_RESULT_ENTRY_INVALID");
    }
  }
  // Re-derive from the cited evidence and require the stored entries to
  // match exactly — this is the actual tamper/drift check, not just
  // structural shape. A stored ai_name or evidence field that no longer
  // agrees with what static analysis of helperResult proves is refused
  // here, not silently accepted because the schema happened to parse.
  const recomputed = resolveAlternateIdentityBindings(helperResult, censusManifest);
  if (canonical(recomputed) !== canonical(result.entries)) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_EVIDENCE_DRIFT");
  }
  return result;
}

/**
 * observed_at makes every archive content-address to a DIFFERENT file even
 * for identical inputs, so a name collision alone can never catch a repeat
 * (same reason tools/settings-ir/v6/helper-constants-result.ts keys its own
 * existence check on the (public_version, settings_version) pair, not on
 * the archive directory being non-empty). This is the analogous per-pair
 * gate here: create-once per (helper_result_version, census_manifest_sha256),
 * not per whole catalog/runtime/v7 directory — a later v6 or census
 * generation still gets its own archive alongside older ones (D-052).
 */
export function existingAlternateIdentityBindingVersions(
  projectRoot: string,
  helperResultVersion: string,
  censusManifestSha256: string,
  profileFingerprint: string = CURATED_TABLE_FINGERPRINT
): string[] {
  const directory = join(resolve(projectRoot), "catalog", "runtime", "v7");
  let entries;
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  const matches: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !versionSchema.safeParse(entry.name).success) continue;
    const entryPath = join(directory, entry.name);
    let raw: string;
    try {
      // A file with our versioned name pattern IS one of ours — too large
      // to be a legitimate v7 result means it cannot be trusted, not that
      // it silently isn't ours (round-2 critic-code: the earlier `continue`
      // here let the gate report "no existing archive" for a pair whose
      // archive genuinely exists but is oversized, which is exactly the
      // false-negative this function exists to prevent).
      if (statSync(entryPath).size > ALTERNATE_IDENTITY_RESULT_MAX_BYTES) {
        throw new Error("ALTERNATE_IDENTITY_RESULT_FILE_INVALID");
      }
      raw = readFileSync(entryPath, "utf8");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") continue;
      throw error;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      continue;
    }
    if (
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { helper_result_version?: unknown }).helper_result_version === helperResultVersion &&
      (parsed as { census_manifest_sha256?: unknown }).census_manifest_sha256 === censusManifestSha256 &&
      (parsed as { profile_fingerprint?: unknown }).profile_fingerprint === profileFingerprint
    ) {
      matches.push(entry.name);
    }
  }
  return matches;
}

export function serializeAlternateIdentityBindingResult(
  result: AlternateIdentityBindingResult
): string {
  return `${JSON.stringify(result, null, 2)}\n`;
}

export async function archiveAlternateIdentityBindingResult(
  result: AlternateIdentityBindingResult,
  helperResultVersion: string,
  helperResult: HelperConstantsResult,
  censusManifest: NormalizedSettingsParserCensusManifest,
  censusPublicCatalog: SyntxPublicCatalogSnapshot,
  censusInventory: SettingsSourceInventory,
  projectRoot: string
): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  const validated = validateAlternateIdentityBindingResult(
    result,
    helperResultVersion,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
  const bytes = Buffer.from(serializeAlternateIdentityBindingResult(validated));
  if (bytes.length > ALTERNATE_IDENTITY_RESULT_MAX_BYTES) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_TOO_LARGE");
  }
  const version = `sha256-${digest(bytes)}.json`;
  // Narrows, not eliminates, the create-once race a caller-side check
  // leaves open: two concurrent archive attempts for the same pair each
  // produce a different observed_at and therefore a different filename, so
  // createImmutableJsonSnapshot's own O_EXCL alone cannot catch the
  // duplicate (round-1 critic-code WARN). Re-checking immediately before
  // the write shrinks the window to between this line and the write call.
  const existingBeforeWrite = existingAlternateIdentityBindingVersions(
    projectRoot,
    helperResultVersion,
    validated.census_manifest_sha256
  );
  if (existingBeforeWrite.length > 0 && !existingBeforeWrite.includes(version)) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_ALREADY_EXISTS");
  }
  const directory = await resultDirectory(projectRoot, true);
  const path = join(directory, version);
  let status: "created" | "existing" = "created";
  try {
    await createImmutableJsonSnapshot(path, bytes.toString("utf8"), {
      maxBytes: ALTERNATE_IDENTITY_RESULT_MAX_BYTES
    });
  } catch (error) {
    if (
      !(
        error instanceof Error &&
        "code" in error &&
        error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS"
      )
    ) {
      throw error;
    }
    status = "existing";
  }
  if (!readRegular(path).equals(bytes)) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_COLLISION");
  }
  await syncDirectory(directory);
  return { version, path, status };
}

export async function loadAlternateIdentityBindingResult(
  version: string,
  helperResultVersion: string,
  helperResult: HelperConstantsResult,
  censusManifest: NormalizedSettingsParserCensusManifest,
  censusPublicCatalog: SyntxPublicCatalogSnapshot,
  censusInventory: SettingsSourceInventory,
  projectRoot: string
): Promise<AlternateIdentityBindingResult> {
  if (!versionSchema.safeParse(version).success) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_VERSION_INVALID");
  }
  const path = join(await resultDirectory(projectRoot, false), version);
  const bytes = readRegular(path);
  if (`sha256-${digest(bytes)}.json` !== version) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_HASH_MISMATCH");
  }
  return validateAlternateIdentityBindingResult(
    JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)),
    helperResultVersion,
    helperResult,
    censusManifest,
    censusPublicCatalog,
    censusInventory
  );
}

function digest(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Key-order-independent structural comparison — a JSON.stringify diff would
 * false-positive on a harmless field-order difference between a freshly
 * resolved value and one that round-tripped through Zod. */
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonical(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function readRegular(path: string): Buffer {
  let handle;
  try {
    handle = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("ALTERNATE_IDENTITY_RESULT_MISSING");
    }
    throw error;
  }
  try {
    const before = fstatSync(handle);
    if (!before.isFile() || before.size < 1 || before.size > ALTERNATE_IDENTITY_RESULT_MAX_BYTES) {
      throw new Error("ALTERNATE_IDENTITY_RESULT_FILE_INVALID");
    }
    const bytes = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < bytes.length) {
      const n = readSync(handle, bytes, size, bytes.length - size, null);
      if (n === 0) break;
      size += n;
    }
    const after = fstatSync(handle);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
      throw new Error("ALTERNATE_IDENTITY_RESULT_READ_CHANGED");
    }
    return bytes.subarray(0, size);
  } finally {
    closeSync(handle);
  }
}

async function resultDirectory(root: string, create: boolean): Promise<string> {
  let path = resolve(root);
  assertDirectory(path);
  for (const segment of ["catalog", "runtime", "v7"]) {
    const parent = path;
    path = join(path, segment);
    if (create) {
      try {
        await mkdir(path);
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) {
          throw error;
        }
      }
    }
    assertDirectory(path);
    if (create) await syncDirectory(parent);
  }
  return path;
}

function assertDirectory(path: string): void {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new Error("ALTERNATE_IDENTITY_RESULT_MISSING");
    }
    throw error;
  }
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("ALTERNATE_IDENTITY_RESULT_DIRECTORY_UNSAFE");
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_DIRECTORY);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
