import { createHash, randomUUID } from "node:crypto";
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync } from "node:fs";
import { link, mkdir, open, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod/v4";
import { getPublicCatalogDirectory } from "./public-catalog-history.js";
import type { SyntxPublicCatalogSnapshot } from "./syntx-public-catalog.js";

const sha256Schema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const utcTimestampSchema = z.string().datetime({ offset: true });
const sourceSchema = z.object({
  url: z.string().url().regex(/^https:\/\/syntx\.ai\/assets\/\d{6,20}\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u),
  bytes: z.number().int().positive(),
  sha256: sha256Schema
}).strict();
const formSchema = z.object({
  form_id: z.string().min(1),
  module_name: z.string().min(1),
  javascript: sourceSchema.extend({
    parse_diagnostics: z.number().int().nonnegative(),
    model_value_settings_keys: z.array(z.string()),
    static_setting_defaults: z.record(z.string(), z.unknown())
  }).strict()
}).strict();
const modelSchema = z.object({
  model_id: z.string().min(1),
  ai_name: z.string().min(1),
  active: z.boolean(),
  default: z.boolean(),
  public_type_label: z.string().nullable(),
  form_id: z.string().nullable(),
  form_binding_status: z.enum(["STRUCTURAL_MATCH", "UNKNOWN"]),
  settings_status: z.enum(["PUBLIC_SETTINGS_KNOWN", "UNKNOWN"]),
  settings: z.record(z.string(), z.unknown()).nullable(),
  model_value_settings_keys: z.array(z.string()),
  generic_setting_keys: z.array(z.string()),
  payload_field_keys: z.array(z.string()),
  enum_constraints: z.record(z.string(), z.unknown()),
  defaults_status: z.enum(["PARTIAL_STATIC", "UNKNOWN"]),
  static_setting_defaults: z.record(z.string(), z.unknown()),
  unknown_reasons: z.array(z.string()),
  runtime_usable: z.literal(false)
}).strict();

const legacyModelSchema = z.object({
  model_id: z.string().min(1),
  ai_name: z.string().min(1),
  active: z.boolean(),
  default: z.boolean(),
  model_type: z.string().nullable(),
  form_id: z.string().nullable(),
  form_binding_status: z.enum(["BOUND", "UNKNOWN"]),
  settings_status: z.enum(["PUBLIC_SETTINGS_KNOWN", "UNKNOWN"]),
  settings: z.record(z.string(), z.unknown()).nullable(),
  model_value_settings_keys: z.array(z.string()),
  generic_setting_keys: z.array(z.string()),
  payload_field_keys: z.array(z.string()),
  enum_constraints: z.record(z.string(), z.unknown()),
  defaults_status: z.enum(["PARTIAL_STATIC", "UNKNOWN"]),
  static_setting_defaults: z.record(z.string(), z.unknown()),
  unknown_reasons: z.array(z.string()),
  runtime_usable: z.literal(false)
}).strict();

export const maplessSettingsInventorySchema = z.object({
  schema_version: z.literal("2.1.0"),
  migrated_from_schema_version: z.literal("2.0.0").optional(),
  catalog_kind: z.literal("MAPLESS_FRONTEND_SETTINGS_INVENTORY"),
  evidence_level: z.literal("STATIC_PUBLIC_API_AND_COMPILED_JS"),
  runtime_usable: z.literal(false),
  generated_at: utcTimestampSchema,
  build: z.object({ id: z.string().regex(/^\d{6,20}$/u), base_url: z.string().url() }).strict(),
  public_catalog: z.object({ version: z.string(), fetched_at: utcTimestampSchema, models_sha256: sha256Schema }).strict(),
  homepage_sha256: sha256Schema,
  app_sha256: sha256Schema,
  registry: sourceSchema,
  framework: z.object({ settings3: sourceSchema.extend({ generic_setting_keys: z.array(z.string()) }).strict(), useSettingsParams: sourceSchema.extend({ payload_field_keys: z.array(z.string()) }).strict() }).strict(),
  forms: z.array(formSchema).min(1).max(100),
  models: z.array(modelSchema).min(1).max(10_000),
  summary: z.object({ total_models: z.number().int().nonnegative(), structurally_mapped_models: z.number().int().nonnegative(), unknown_form_models: z.number().int().nonnegative(), models_with_public_settings: z.number().int().nonnegative(), models_without_public_settings: z.number().int().nonnegative() }).strict(),
  limitations: z.array(z.string())
}).strict();

const legacyMaplessSettingsInventorySchema = maplessSettingsInventorySchema.extend({
  schema_version: z.literal("2.0.0"),
  migrated_from_schema_version: z.never().optional(),
  models: z.array(legacyModelSchema).min(1).max(10_000),
  summary: z.object({ total_models: z.number().int().nonnegative(), bound_models: z.number().int().nonnegative(), unknown_form_models: z.number().int().nonnegative(), models_with_public_settings: z.number().int().nonnegative(), models_without_public_settings: z.number().int().nonnegative() }).strict()
}).strict();

export type MaplessSettingsInventory = z.infer<typeof maplessSettingsInventorySchema>;

const VERSION_PATTERN = /^sha256-([a-f0-9]{64})\.json$/u;
const MAX_INVENTORY_BYTES = 15 * 1024 * 1024;

export function serializeMaplessSettingsInventory(inventory: MaplessSettingsInventory): string {
  const validated = maplessSettingsInventorySchema.parse(inventory);
  if (validated.schema_version !== "2.1.0" || validated.migrated_from_schema_version !== undefined) throw new Error("MAPLESS_SETTINGS_WRITE_SCHEMA_INVALID");
  return `${JSON.stringify(validated)}\n`;
}

export async function archiveMaplessSettingsInventory(inventory: MaplessSettingsInventory, catalogDirectory?: string): Promise<{ version: string; path: string; status: "created" | "existing" }> {
  const bytes = Buffer.from(serializeMaplessSettingsInventory(inventory), "utf8");
  assertByteLimit(bytes.length);
  const version = `sha256-${digest(bytes)}.json`;
  const root = resolveCatalogDirectory(catalogDirectory);
  const settingsRoot = join(root, "settings");
  const historyDirectory = join(settingsRoot, "v2");
  await ensureDirectory(settingsRoot);
  await ensureDirectory(historyDirectory);
  const path = join(historyDirectory, version);
  const temporaryPath = join(historyDirectory, `.pending-${randomUUID()}.tmp`);
  let temporaryCreated = false;
  try {
    const temporary = await open(temporaryPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    temporaryCreated = true;
    try { await temporary.writeFile(bytes); await temporary.sync(); } finally { await temporary.close(); }
    assertDirectory(historyDirectory);
    let status: "created" | "existing";
    try { await link(temporaryPath, path); status = "created"; }
    catch (error) { if (!hasCode(error, "EEXIST")) throw error; status = "existing"; }
    if (!readBoundedRegularFile(path).equals(bytes)) throw new Error("MAPLESS_SETTINGS_VERSION_COLLISION");
    await syncDirectory(historyDirectory);
    return { version, path, status };
  } finally {
    if (temporaryCreated) { await unlink(temporaryPath); await syncDirectory(historyDirectory); }
  }
}

export function loadMaplessSettingsInventoryVersion(version: string, catalogDirectory?: string): MaplessSettingsInventory {
  const match = VERSION_PATTERN.exec(version);
  if (!match || match[0] !== version) throw new Error("MAPLESS_SETTINGS_VERSION_INVALID");
  const historyDirectory = join(resolveCatalogDirectory(catalogDirectory), "settings", "v2");
  assertDirectory(historyDirectory);
  const bytes = readBoundedRegularFile(join(historyDirectory, version));
  if (digest(bytes) !== match[1]) throw new Error("MAPLESS_SETTINGS_VERSION_HASH_MISMATCH");
  const raw: unknown = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (typeof raw === "object" && raw !== null && "schema_version" in raw && raw.schema_version === "2.0.0") {
    const legacy = legacyMaplessSettingsInventorySchema.parse(raw);
    return maplessSettingsInventorySchema.parse({
      ...legacy,
      schema_version: "2.1.0",
      migrated_from_schema_version: "2.0.0",
      models: legacy.models.map((model) => ({
        ...model,
        public_type_label: model.model_type,
        model_type: undefined,
        form_binding_status: model.form_binding_status === "BOUND" ? "STRUCTURAL_MATCH" : "UNKNOWN",
        unknown_reasons: model.form_binding_status === "BOUND" && !model.unknown_reasons.includes("STRUCTURAL_MATCH_NOT_RUNTIME_ROUTE_PROOF")
          ? [...model.unknown_reasons, "STRUCTURAL_MATCH_NOT_RUNTIME_ROUTE_PROOF"]
          : model.unknown_reasons
      })).map(({ model_type: _oldModelType, ...model }) => model),
      summary: {
        total_models: legacy.summary.total_models,
        structurally_mapped_models: legacy.summary.bound_models,
        unknown_form_models: legacy.summary.unknown_form_models,
        models_with_public_settings: legacy.summary.models_with_public_settings,
        models_without_public_settings: legacy.summary.models_without_public_settings
      },
      limitations: [...legacy.limitations, "Legacy 2.0.0 read migrated its form binding label to STRUCTURAL_MATCH; it remains static evidence, not live route proof."]
    });
  }
  return maplessSettingsInventorySchema.parse(raw);
}

function resolveCatalogDirectory(directory?: string): string {
  const resolved = directory === undefined ? getPublicCatalogDirectory() : resolve(directory);
  assertDirectory(resolved);
  return resolved;
}

async function ensureDirectory(path: string): Promise<void> {
  try { await mkdir(path, { mode: 0o755 }); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  assertDirectory(path);
}

function assertDirectory(path: string): void {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isDirectory()) throw new Error("MAPLESS_SETTINGS_DIRECTORY_UNSAFE");
}

function readBoundedRegularFile(path: string): Buffer {
  const stats = lstatSync(path);
  if (stats.isSymbolicLink() || !stats.isFile()) throw new Error("MAPLESS_SETTINGS_FILE_UNSAFE");
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile()) throw new Error("MAPLESS_SETTINGS_FILE_UNSAFE");
    assertByteLimit(before.size);
    const buffer = Buffer.alloc(before.size + 1);
    let size = 0;
    while (size < buffer.length) { const count = readSync(descriptor, buffer, size, buffer.length - size, null); if (count === 0) break; size += count; }
    const after = fstatSync(descriptor);
    if (size !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs) throw new Error("MAPLESS_SETTINGS_FILE_CHANGED_DURING_READ");
    return buffer.subarray(0, size);
  } finally { closeSync(descriptor); }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { if (!(await handle.stat()).isDirectory()) throw new Error("MAPLESS_SETTINGS_DIRECTORY_UNSAFE"); await handle.sync(); }
  finally { await handle.close(); }
}

function assertByteLimit(size: number): void { if (!Number.isSafeInteger(size) || size < 1 || size > MAX_INVENTORY_BYTES) throw new Error("MAPLESS_SETTINGS_SIZE_INVALID"); }
function digest(bytes: Buffer): string { return createHash("sha256").update(bytes).digest("hex"); }
function hasCode(error: unknown, code: string): boolean { return error instanceof Error && "code" in error && error.code === code; }

export interface MaplessSettingsInventoryInput {
  publicCatalog: SyntxPublicCatalogSnapshot;
  publicVersion: string;
  generatedAt: string;
  buildId: string;
  homepageSha256: string;
  appSha256: string;
  registry: z.infer<typeof sourceSchema>;
  framework: {
    settings3: z.infer<typeof sourceSchema> & { generic_setting_keys: string[] };
    useSettingsParams: z.infer<typeof sourceSchema> & { payload_field_keys: string[] };
  };
  forms: z.infer<typeof formSchema>[];
}

export function normalizePublicAiNameToFormId(aiName: string): string {
  return aiName.replace(/([a-z])([0-9])/gu, "$1-$2").replace(/([0-9])([a-z])/gu, "$1-$2").replace(/_/gu, "-").toLowerCase();
}

export function buildMaplessSettingsInventory(input: MaplessSettingsInventoryInput): MaplessSettingsInventory {
  const familyNames = new Set(input.publicCatalog.ai.map((entry) => entry.value));
  const formsById = new Map(input.forms.map((form) => [form.form_id, form]));
  if (formsById.size !== input.forms.length) throw new Error("MAPLESS_FORM_DUPLICATE");
  const models = input.publicCatalog.models.map((model) => {
    const normalizedFormId = normalizePublicAiNameToFormId(model.ai_name);
    const familyIsCurrent = familyNames.has(model.ai_name);
    const form = familyIsCurrent ? formsById.get(normalizedFormId) : undefined;
    const settings = model.settings === null ? null : model.settings;
    const modelSettingKeys = new Set(settings === null ? [] : Object.keys(settings));
    const genericSettingKeys = input.framework.settings3.generic_setting_keys.filter((key) => modelSettingKeys.has(key));
    const modelValueSettingsKeys = form?.javascript.model_value_settings_keys ?? [];
    const payloadFieldKeys = input.framework.useSettingsParams.payload_field_keys.filter((key) => modelSettingKeys.has(key) || modelValueSettingsKeys.includes(key));
    const enumConstraints = settings === null
      ? {}
      : Object.fromEntries(Object.entries(settings).filter(([, value]) => Array.isArray(value)));
    const staticSettingDefaults = Object.fromEntries(
      Object.entries(form?.javascript.static_setting_defaults ?? {}).filter(([key]) => modelSettingKeys.has(key))
    );
    const unknownReasons: string[] = [];
    if (!familyIsCurrent) unknownReasons.push("NO_CURRENT_AI_FAMILY");
    else if (form === undefined) unknownReasons.push("NO_EXACT_REGISTERED_FORM");
    if (settings === null) unknownReasons.push("NO_PUBLIC_SETTINGS_OBJECT");
    if (modelValueSettingsKeys.some((key) => !modelSettingKeys.has(key))) unknownReasons.push("CONTROL_CONSTRAINTS_NOT_IN_PUBLIC_SETTINGS");
    if (Object.keys(staticSettingDefaults).length === 0) unknownReasons.push("SETTING_DEFAULTS_NOT_STATICALLY_RESOLVED");
    unknownReasons.push("CONDITIONAL_VISIBILITY_NOT_FULLY_EVALUATED");
    unknownReasons.push("GENERATION_PAYLOAD_NOT_RUNTIME_VERIFIED");
    return {
      model_id: model.value,
      ai_name: model.ai_name,
      active: model.active,
      default: model.default,
      public_type_label: model.type,
      form_id: form?.form_id ?? null,
      form_binding_status: form === undefined ? "UNKNOWN" as const : "STRUCTURAL_MATCH" as const,
      settings_status: settings === null ? "UNKNOWN" as const : "PUBLIC_SETTINGS_KNOWN" as const,
      settings,
      model_value_settings_keys: modelValueSettingsKeys,
      generic_setting_keys: genericSettingKeys,
      payload_field_keys: payloadFieldKeys,
      enum_constraints: enumConstraints,
      defaults_status: Object.keys(staticSettingDefaults).length > 0 ? "PARTIAL_STATIC" as const : "UNKNOWN" as const,
      static_setting_defaults: staticSettingDefaults,
      unknown_reasons: unknownReasons,
      runtime_usable: false as const
    };
  }).sort((left, right) => left.model_id.localeCompare(right.model_id));
  const structurallyMappedModels = models.filter((model) => model.form_binding_status === "STRUCTURAL_MATCH").length;
  const withSettings = models.filter((model) => model.settings_status === "PUBLIC_SETTINGS_KNOWN").length;
  return maplessSettingsInventorySchema.parse({
    schema_version: "2.1.0",
    catalog_kind: "MAPLESS_FRONTEND_SETTINGS_INVENTORY",
    evidence_level: "STATIC_PUBLIC_API_AND_COMPILED_JS",
    runtime_usable: false,
    generated_at: input.generatedAt,
    build: { id: input.buildId, base_url: `https://syntx.ai/assets/${input.buildId}/` },
    public_catalog: { version: input.publicVersion, fetched_at: input.publicCatalog.fetched_at, models_sha256: input.publicCatalog.sources.models.canonical_sha256 },
    homepage_sha256: input.homepageSha256,
    app_sha256: input.appSha256,
    registry: input.registry,
    framework: input.framework,
    forms: input.forms,
    models,
    summary: { total_models: models.length, structurally_mapped_models: structurallyMappedModels, unknown_form_models: models.length - structurallyMappedModels, models_with_public_settings: withSettings, models_without_public_settings: models.length - withSettings },
    limitations: [
      "This inventory uses the current public model API and static compiled JavaScript; it does not execute vendor code.",
      "No source maps are required or fetched; structural form matches use current public AI family identity, the existing canonical family-ID rule, and exact Settings2 registry entries; this is not runtime route proof.",
      "A model default flag identifies the preferred model variant, not the default values of its settings.",
      "Dynamic UI conditions and generation payload acceptance are not proven by static field references."
    ]
  });
}
