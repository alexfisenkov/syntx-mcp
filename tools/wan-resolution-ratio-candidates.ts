import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { serializeSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { createImmutableJsonSnapshot } from "../tools/settings-ir/immutable-json-snapshot.js";

export const WAN_RATIO_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
export const WAN_RATIO_SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const WAN_SOURCE_SHA256 = "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119";
const WAN_SOURCE_BYTES = 19503;
const EXPECTED_MODELS = ["wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash", "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v", "wan_27_t2v", "wan_27_videoedit"];
const PREVIEW_MODELS = ["wan_25_i2v_preview", "wan_25_t2v_preview"];
const FACT_PREVIEW_ORDER = ["wan_25_t2v_preview", "wan_25_i2v_preview"];
const EXPECTED_FACTS = {
  sha256: "aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119",
  render_context: [
    { field: "aspect_ratio", callee: ["w"], props_argument_index: 1, target_kind: "CallExpression", target_path: [] },
    { field: "resolution", callee: ["g"], props_argument_index: 1, target_kind: "Identifier", target_path: ["I"] }
  ],
  ratio_prop: ["He", "value"],
  ratio_values_at_480P: ["16:9", "9:16", "1:1"],
  ratio_values_else: ["16:9", "9:16", "1:1", "4:3", "3:4"],
  resolution_480P_model_ids: FACT_PREVIEW_ORDER,
  resolution_preview_values: ["480P", "720P", "1080P"],
  resolution_other_values: ["720P", "1080P"],
  derivation: {
    sha256: "aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119",
    He: { call: { identifier: "r" }, args: [{ parameters: [], body: { call: { property: "map", object: { property: "value", object: { identifier: "ie" } } }, args: [{ parameters: ["a"], body: { object: [{ key: "ratio", value: { property: "value", object: { identifier: "a" } } }, { key: "value", value: { property: "value", object: { identifier: "a" } } }] } }] } }] },
    ie: { call: { identifier: "r" }, args: [{ parameters: [], body: { statements: [
      { declarations: [{ variable: "a", initializer: { array: ["16:9", "9:16", "1:1"] } }] },
      { return: { operator: ",", left: { operator: "&&", left: { operator: "!==", left: { property: "resolution", object: { property: "settings", object: { identifier: "e" } } }, right: "480P" }, right: { call: { property: "push", object: { identifier: "a" } }, args: ["4:3", "3:4"] } }, right: { call: { property: "map", object: { identifier: "a" } }, args: [{ parameters: ["o"], body: { object: [{ key: "label", value: { identifier: "o" } }, { key: "value", value: { identifier: "o" } }] } }] } } }
    ] } }] },
    ge: { call: { identifier: "r" }, args: [{ parameters: [], body: { call: { property: "map", object: { when: { call: { property: "includes", object: { identifier: "fe" } }, args: [{ property: "model_type", object: { property: "settings", object: { identifier: "e" } } }] }, then: { array: ["480P", "720P", "1080P"] }, otherwise: { array: ["720P", "1080P"] } } }, args: [{ parameters: ["o"], body: { object: [{ key: "label", value: { identifier: "o" } }, { key: "value", value: { identifier: "o" } }] } }] } }] },
    fe_binding_count: 1,
    fe: { array: FACT_PREVIEW_ORDER }
  },
  wrapper_semantics_not_verified: true,
  backend_acceptance: false,
  runtime_usable: false
} as const;

export interface WanResolutionRatioCandidateInput {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly publicVersion: string;
  readonly settingsInventory: MaplessSettingsInventory;
  readonly settingsVersion: string;
  readonly sourceFacts: unknown;
}

export interface WanResolutionRatioCandidatesArtifact {
  readonly schema_version: "1.0.0";
  readonly ticket: "48";
  readonly catalog_kind: "WAN_RESOLUTION_RATIO_CANDIDATES";
  readonly evidence_scope: "PARTIAL_STATIC_UI_CANDIDATE";
  readonly runtime_usable: false;
  readonly backend_acceptance: false;
  readonly source_persisted: false;
  readonly public_version: string;
  readonly settings_version: string;
  readonly build_id: "1791467421";
  readonly model_ids: string[];
  readonly target_fields: ["resolution", "aspect_ratio"];
  readonly source_identity: { module_name: "wan-video.js"; bytes: 19503; sha256: typeof WAN_SOURCE_SHA256 };
  readonly source_facts_sha256: string;
  readonly controls: [
    { field: "resolution"; model_options: Array<{ model_id: string; status: "FINITE_SOURCE_CANDIDATE"; values: readonly string[] }>; ui_default_candidate: { status: "UNKNOWN" }; backend_default: "UNKNOWN"; model_applicability: "UNKNOWN" },
    { field: "aspect_ratio"; ratio_prop: ["He", "value"]; branches: Array<{ when: { field: "resolution"; operator: "===" | "!=="; value: "480P" }; allowed_values: readonly string[] }>; ui_default_candidate: { status: "UNKNOWN" }; backend_default: "UNKNOWN"; model_applicability: "UNKNOWN" }
  ];
  readonly limitations: readonly string[];
}

const CREATED_ARTIFACTS = new WeakSet<object>();

export function curateWanResolutionRatioCandidates(input: WanResolutionRatioCandidateInput): WanResolutionRatioCandidatesArtifact {
  let serializedCatalog: string;
  try { serializedCatalog = serializeSyntxPublicCatalogSnapshot(input.publicCatalog); }
  catch { throw new Error("WAN_V25_CATALOG_BINDING_INVALID"); }
  if (input.publicVersion !== WAN_RATIO_PUBLIC_VERSION || input.settingsVersion !== WAN_RATIO_SETTINGS_VERSION || input.settingsInventory.public_catalog.version !== WAN_RATIO_PUBLIC_VERSION || input.settingsInventory.build.id !== "1791467421" || createHash("sha256").update(serializedCatalog, "utf8").digest("hex") !== WAN_RATIO_PUBLIC_VERSION.slice("sha256-".length, -".json".length)) throw new Error("WAN_V25_CATALOG_BINDING_INVALID");
  if (!isDeepStrictEqual(input.sourceFacts, EXPECTED_FACTS)) throw new Error("WAN_V25_FACT_TREE_INVALID");
  if (input.settingsInventory.app_sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf") throw new Error("WAN_V25_SOURCE_BINDING_INVALID");
  const form = input.settingsInventory.forms.find(candidate => candidate.form_id === "wan-video");
  if (!form || form.javascript.bytes !== WAN_SOURCE_BYTES || form.javascript.sha256 !== WAN_SOURCE_SHA256) throw new Error("WAN_V25_SOURCE_BINDING_INVALID");
  const inventoryIds = input.settingsInventory.models.filter(model => model.form_id === "wan-video" && model.active).map(model => model.model_id).sort();
  const publicIds = input.publicCatalog.models.filter(model => model.active && EXPECTED_MODELS.includes(model.value)).map(model => model.value).sort();
  if (!isDeepStrictEqual(inventoryIds, [...EXPECTED_MODELS].sort()) || !isDeepStrictEqual(publicIds, inventoryIds)) throw new Error("WAN_V25_MODEL_BINDING_INVALID");
  const facts = input.sourceFacts as typeof EXPECTED_FACTS;
  const controls: WanResolutionRatioCandidatesArtifact["controls"] = [
    {
      field: "resolution",
      model_options: inventoryIds.map(model_id => ({ model_id, status: "FINITE_SOURCE_CANDIDATE" as const, values: PREVIEW_MODELS.includes(model_id) ? facts.resolution_preview_values : facts.resolution_other_values })),
      ui_default_candidate: { status: "UNKNOWN" }, backend_default: "UNKNOWN", model_applicability: "UNKNOWN"
    },
    {
      field: "aspect_ratio", ratio_prop: ["He", "value"],
      branches: [
        { when: { field: "resolution", operator: "===" as const, value: "480P" as const }, allowed_values: facts.ratio_values_at_480P },
        { when: { field: "resolution", operator: "!==" as const, value: "480P" as const }, allowed_values: facts.ratio_values_else }
      ],
      ui_default_candidate: { status: "UNKNOWN" }, backend_default: "UNKNOWN", model_applicability: "UNKNOWN"
    }
  ];
  const artifact: WanResolutionRatioCandidatesArtifact = {
    schema_version: "1.0.0", ticket: "48", catalog_kind: "WAN_RESOLUTION_RATIO_CANDIDATES", evidence_scope: "PARTIAL_STATIC_UI_CANDIDATE",
    runtime_usable: false, backend_acceptance: false, source_persisted: false,
    public_version: input.publicVersion, settings_version: input.settingsVersion, build_id: "1791467421", model_ids: inventoryIds,
    target_fields: ["resolution", "aspect_ratio"], source_identity: { module_name: "wan-video.js", bytes: WAN_SOURCE_BYTES, sha256: WAN_SOURCE_SHA256 },
    source_facts_sha256: `sha256:${createHash("sha256").update(canonicalJson(facts)).digest("hex")}`,
    controls,
    limitations: ["The facts are exact normalized AST findings for the pinned WAN source; they do not prove Vue wrapper or exported-component semantics.", "Values are static UI candidates only; backend acceptance, defaults, visibility, dispatch, and runtime usability remain unverified.", "This bounded result covers resolution and aspect_ratio only; WAN settings coverage remains open."]
  };
  CREATED_ARTIFACTS.add(artifact);
  return artifact;
}

export async function archiveWanResolutionRatioCandidates(artifact: WanResolutionRatioCandidatesArtifact, projectRoot: string, now: () => Date = () => new Date()): Promise<{ path: string; sha256: string; status: "created" }> {
  if (!CREATED_ARTIFACTS.has(artifact)) throw new Error("WAN_V25_ARTIFACT_NOT_CURATED");
  const serialized = `${JSON.stringify({ ...artifact, observed_at: now().toISOString() }, null, 2)}\n`;
  const sha256 = createHash("sha256").update(serialized, "utf8").digest("hex");
  const path = join(resolve(projectRoot), "catalog", "runtime", "v25", `sha256-${sha256}.json`);
  try { await createImmutableJsonSnapshot(path, serialized, { maxBytes: 1024 * 1024 }); }
  catch (error) {
    if (error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS") throw new Error("WAN_V25_ARTIFACT_ALREADY_EXISTS");
    throw error;
  }
  if (await readFile(path, "utf8") !== serialized) throw new Error("WAN_V25_ARTIFACT_READBACK_MISMATCH");
  return { path, sha256, status: "created" };
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (typeof value === "object" && value !== null) return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`).join(",")}}`;
  return JSON.stringify(value);
}
