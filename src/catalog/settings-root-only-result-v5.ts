import { isProxy } from "node:util/types";
import { z } from "zod/v4";
import { sha256CanonicalPayload } from "./syntx-public-catalog.js";
import { sha256Schema } from "./normalized-settings-parser-generic-form-vocabulary.js";

/** Persistence DTO only. No compiler, loader, source content, or vendor execution. */
export const ROOT_ONLY_V5_BINDINGS = [
  "SCOPE", "AI_NAME", "settingsGroups", "defaultSettings", "controls", "conditionalRules"
] as const;
export const ROOT_ONLY_V5_BLOCKER_CODES = [
  "IMPORT_NOT_INTERPRETED", "CALL_EXPRESSION_NOT_INTERPRETED",
  "COMPUTED_RULE_NOT_INTERPRETED", "WATCH_RULE_NOT_INTERPRETED",
  "NEW_EXPRESSION_NOT_INTERPRETED", "FUNCTION_NOT_INTERPRETED",
  "SPREAD_NOT_INTERPRETED", "COMPUTED_KEY_NOT_INTERPRETED",
  "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED", "MUTATION_NOT_INTERPRETED",
  "LOOP_NOT_INTERPRETED", "TEMPLATE_CONTROL_FLOW_NOT_COMPILED",
  "UNKNOWN_IDENTIFIER_NOT_INTERPRETED", "STATIC_MEMBER_NOT_FOUND",
  "MODEL_CONDITION_NOT_INTERPRETED", "NON_CONST_BINDING_NOT_INTERPRETED",
  "DESTRUCTURED_BINDING_NOT_INTERPRETED", "BINDING_INITIALIZER_MISSING",
  "BINDING_ABSENCE_UNPROVEN", "MODEL_ID_SHADOWED",
  "UNSUPPORTED_SYNTAX_NOT_INTERPRETED"
] as const;

const MAX_RESULT_BYTES = 512 * 1024;
const sourceRef = z.string().regex(/^settings-source-[a-f0-9]{64}$/u);
const timestamp = z.iso.datetime().refine((value) =>
  Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value
);
const boundedBytes = z.number().int().min(1).max(32 * 1024 * 1024);
const digestBinding = z.object({ bytes: boundedBytes, sha256: sha256Schema });
const jsUrl = "https://syntx.ai/assets/1788368942/beeble.js";
const rootPath = "/src/components/chat/forms/settings/beeble.vue";
const auxPath = "/src/components/chat/forms/settings/components/beeble/MaskEditor.vue";
const sourceDescriptor = z.object({
  source_ref_id: sourceRef,
  role: z.enum(["ROOT", "AUXILIARY"]),
  source_index: z.number().int().min(0).max(1),
  source_path: z.enum([rootPath, auxPath]),
  source_content_sha256: sha256Schema
}).strict();

const scopeShape = z.object({
  form_id: z.literal("beeble"),
  ai_name: z.literal("beeble"),
  model_ids: z.tuple([z.literal("switchx")]),
  root_source_ref_id: sourceRef,
  auxiliary_source_ref_ids: z.tuple([sourceRef]),
  source_observed_at: timestamp,
  bindings: z.tuple([
    digestBinding.extend({ name: z.literal("public_catalog") }).strict(),
    digestBinding.extend({ name: z.literal("inventory") }).strict(),
    digestBinding.extend({ name: z.literal("census") }).strict()
  ]),
  javascript: digestBinding.extend({ url: z.literal(jsUrl) }).strict(),
  source_map: digestBinding.extend({ url: z.literal(`${jsUrl}.map`) }).strict(),
  sources: z.tuple([
    sourceDescriptor.extend({ role: z.literal("AUXILIARY"), source_index: z.literal(0), source_path: z.literal(auxPath) }),
    sourceDescriptor.extend({ role: z.literal("ROOT"), source_index: z.literal(1), source_path: z.literal(rootPath) })
  ])
}).strict().superRefine((scope, context) => {
  if (scope.root_source_ref_id !== scope.sources[1].source_ref_id ||
      scope.auxiliary_source_ref_ids[0] !== scope.sources[0].source_ref_id ||
      scope.root_source_ref_id === scope.auxiliary_source_ref_ids[0]) issue(context);
  for (const source of scope.sources) {
    const expected = `settings-source-${sha256CanonicalPayload({
      role: "PROVIDER_FORM", module_name: "beeble.js", form_id: "beeble",
      module_javascript_sha256: scope.javascript.sha256,
      module_source_map_sha256: scope.source_map.sha256,
      source_index: source.source_index, source_path: source.source_path,
      source_content_sha256: source.source_content_sha256
    }).slice(7)}`;
    if (source.source_ref_id !== expected) issue(context);
  }
});
export const rootOnlyScopeV5Schema = z.custom<unknown>((value) => safeJson(value, false)).pipe(scopeShape);

type SafeStaticJson = null | boolean | number | string | SafeStaticJson[] | { [key: string]: SafeStaticJson };
const staticValue = z.custom<SafeStaticJson>((value) => safeJson(value, true));
const locator = z.object({
  node_kind: z.string().regex(/^[A-Za-z][A-Za-z0-9]{0,79}$/u),
  line: z.number().int().min(1).max(1_048_576),
  column: z.number().int().min(1).max(1_048_576)
}).strict();
const blockerCode = z.enum(ROOT_ONLY_V5_BLOCKER_CODES);
const blockedBase = z.object({
  status: z.literal("BLOCKED"),
  blocker_codes: z.array(blockerCode).min(1).max(ROOT_ONLY_V5_BLOCKER_CODES.length)
    .refine((codes) => new Set(codes).size === codes.length),
  locator
});
const binding = z.union([
  z.object({ status: z.literal("PROVEN"), value: staticValue, locator }).strict(),
  z.object({ status: z.literal("ABSENT_PROVEN") }).strict(),
  blockedBase.strict(),
  blockedBase.extend({ candidates: staticValue, candidates_locator: locator }).strict()
]);
const rootBindings = z.object({
  SCOPE: binding, AI_NAME: binding, settingsGroups: binding,
  defaultSettings: binding, controls: binding, conditionalRules: binding
}).strict();
const blocker = locator.extend({
  code: blockerCode,
  projection: z.enum([...ROOT_ONLY_V5_BINDINGS, "computed_rules", "watch_rules", "template_control_flow", "source"])
}).strict();
const rootResult = z.object({
  model_id: z.literal("switchx"),
  source_ref_id: sourceRef,
  proof_scope: z.literal("ROOT_FILE_MODEL_CONTEXT_ONLY"),
  compiler_status: z.enum(["COMPLETE", "PARTIAL"]),
  bindings: rootBindings,
  blockers: z.array(blocker).max(2048)
}).strict().superRefine((result, context) => {
  const ai = result.bindings.AI_NAME;
  if (ai.status !== "PROVEN" || ai.value !== "beeble") issue(context);
  const complete = result.blockers.length === 0 &&
    ROOT_ONLY_V5_BINDINGS.every((name) => result.bindings[name].status !== "BLOCKED");
  if ((result.compiler_status === "COMPLETE") !== complete) issue(context);
  if (new Set(result.blockers.map((entry) => sha256CanonicalPayload(entry))).size !== result.blockers.length) issue(context);
  for (const name of ROOT_ONLY_V5_BINDINGS) {
    const observed = result.bindings[name];
    if (observed.status !== "BLOCKED") continue;
    for (const code of observed.blocker_codes) {
      if (!result.blockers.some((entry) => entry.code === code && entry.projection === name &&
          entry.line === observed.locator.line && entry.column === observed.locator.column &&
          entry.node_kind === observed.locator.node_kind)) issue(context);
    }
  }
});

const component = digestBinding.extend({
  name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,159}$/u)
}).strict();
export type RootOnlyImplementationComponentV5 = z.infer<typeof component>;
export const rootOnlyImplementationComponentsV5Schema = z.custom<unknown>((value) => safeJson(value, false))
  .pipe(z.array(component).min(1).max(256).refine((entries) =>
    entries.every((entry, index) => index === 0 || entries[index - 1]!.name < entry.name)
  ));
const resultShape = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("OBSERVED_SETTINGS_ROOT_ONLY_WITH_AUXILIARIES"),
  runtime_usable: z.literal(false),
  compilation_status: z.literal("PARTIAL_COMPILED"),
  generated_at: timestamp,
  scope: rootOnlyScopeV5Schema,
  verification: z.object({
    status: z.literal("ALL_DECLARED_PINNED_BYTES_MATCHED"),
    fetched_artifacts: z.literal(2),
    verified_source_ref_ids: z.tuple([sourceRef, sourceRef])
  }).strict(),
  root_results: z.tuple([rootResult]),
  closure: z.object({
    status: z.literal("OPEN"),
    blockers: z.tuple([
      z.object({ code: z.literal("AUXILIARY_SOURCE_NOT_COMPILED"), source_ref_id: sourceRef, compilation_status: z.literal("NOT_COMPILED") }).strict(),
      z.object({ code: z.literal("DEPENDENCY_GRAPH_UNRESOLVED") }).strict(),
      z.object({ code: z.literal("PAYLOAD_PROJECTION_UNVERIFIED") }).strict(),
      z.object({ code: z.literal("BACKEND_RUNTIME_EQUIVALENCE_UNVERIFIED") }).strict()
    ])
  }).strict(),
  coverage: z.object({
    declared_source_refs: z.literal(2), verified_source_refs: z.literal(2),
    compiled_source_units: z.literal(1), uncompiled_auxiliary_source_refs: z.literal(1),
    compiled_model_contexts: z.literal(1)
  }).strict(),
  toolchain: z.object({
    implementation_components: rootOnlyImplementationComponentsV5Schema,
    implementation_set_sha256: sha256Schema
  }).strict()
}).strict().superRefine((result, context) => {
  if (result.generated_at < result.scope.source_observed_at ||
      result.root_results[0].source_ref_id !== result.scope.root_source_ref_id ||
      result.closure.blockers[0].source_ref_id !== result.scope.auxiliary_source_ref_ids[0] ||
      !same(result.verification.verified_source_ref_ids, result.scope.sources.map((source) => source.source_ref_id))) issue(context);
  const components = result.toolchain.implementation_components;
  if (components.some((entry, index) => index > 0 && components[index - 1]!.name >= entry.name) ||
      sha256CanonicalPayload(components) !== result.toolchain.implementation_set_sha256) issue(context);
});

// Guard before recursive schema traversal: cycles, proxies, accessors, deep
// objects and excessive bytes must not execute code or overflow the validator.
export const rootOnlyResultV5Schema = z.custom<unknown>((value) => safeJson(value, false)).pipe(resultShape);
export type RootOnlyResultV5 = z.infer<typeof rootOnlyResultV5Schema>;

export class RootOnlyResultV5Error extends Error {
  constructor(readonly code: "SETTINGS_V5_RESULT_INVALID" | "SETTINGS_V5_SCOPE_DRIFT") {
    super("The root-only v5 result could not be validated safely.");
    this.name = "RootOnlyResultV5Error";
  }
}

/** Reads bounded JSON text, not a file path. No source fetch or compile occurs. */
export function loadRootOnlyResultV5(text: string): RootOnlyResultV5 {
  try {
    if (typeof text !== "string" || Buffer.byteLength(text) > MAX_RESULT_BYTES) invalid();
    return rootOnlyResultV5Schema.parse(JSON.parse(text));
  } catch { return invalid(); }
}

export function serializeRootOnlyResultV5(value: unknown): string {
  try {
    const text = `${JSON.stringify(rootOnlyResultV5Schema.parse(value), null, 2)}\n`;
    if (Buffer.byteLength(text) > MAX_RESULT_BYTES) invalid();
    return text;
  }
  catch { return invalid(); }
}

export function assertRootOnlyResultMatchesScopeV5(value: unknown, scope: unknown): RootOnlyResultV5 {
  let result: RootOnlyResultV5;
  let expected: z.infer<typeof rootOnlyScopeV5Schema>;
  try {
    result = rootOnlyResultV5Schema.parse(value);
    expected = rootOnlyScopeV5Schema.parse(scope);
  } catch { return invalid(); }
  if (!same(result.scope, expected)) throw new RootOnlyResultV5Error("SETTINGS_V5_SCOPE_DRIFT");
  return result;
}

function same(left: unknown, right: unknown): boolean {
  return sha256CanonicalPayload(left) === sha256CanonicalPayload(right);
}
function invalid(): never { throw new RootOnlyResultV5Error("SETTINGS_V5_RESULT_INVALID"); }
function issue(context: z.RefinementCtx): void {
  context.addIssue({ code: "custom", message: "Root-only evidence relationships are inconsistent." });
}

const forbiddenKeys = new Set([
  "__proto__", "prototype", "constructor", "authorization", "api_key", "apikey",
  "access_token", "refresh_token", "password", "secret", "cookie", "session_string",
  "telegram_session", "otp", "private_key", "token", "code", "raw", "raw_source",
  "snippet", "source", "source_map", "sourcescontent", "map"
]);
const forbiddenValues = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret)\s*[:=]/iu,
  /\b(?:gh[pousr]|github_pat|sk|xox[baprs])[-_][A-Za-z0-9_-]{12,}/u,
  /\b\d{6,}:[A-Za-z0-9_-]{20,}\b/u,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u,
  /<(?:script|template)(?:\s|>)/iu,
  /(?:^|[;{}])\s*(?:import|export|const|let|var|function|class)\s/iu
];

function safeJson(value: unknown, staticOnly: boolean): boolean {
  const active = new Set<object>();
  let nodes = 0;
  let bytes = 0;
  function visit(current: unknown, depth: number): boolean {
    if (++nodes > 20000 || depth > 32 || bytes > MAX_RESULT_BYTES) return false;
    if (current === null || typeof current === "boolean") { bytes += 5; return true; }
    if (typeof current === "number") { bytes += 32; return Number.isFinite(current); }
    if (typeof current === "string") {
      bytes += Buffer.byteLength(current) + 2;
      return bytes <= MAX_RESULT_BYTES && Buffer.byteLength(current) <= 2048 &&
        !/[\u0000-\u001f\u007f]/u.test(current) && forbiddenValues.every((pattern) => !pattern.test(current));
    }
    if (typeof current !== "object" || isProxy(current) || active.has(current)) return false;
    const array = Array.isArray(current);
    if (!array && Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) return false;
    const keys = Reflect.ownKeys(current);
    if (keys.length > (array ? 2049 : 512)) return false;
    if (array && (current.length > 2048 || keys.length !== current.length + 1)) return false;
    active.add(current);
    for (const key of keys) {
      if (array && key === "length") continue;
      if (typeof key !== "string" || !/^[A-Za-z0-9._-]{1,160}$/u.test(key) ||
          (array && (!/^(?:0|[1-9][0-9]*)$/u.test(key) || Number(key) >= current.length)) ||
          (staticOnly && forbiddenKeys.has(key.toLowerCase()))) return false;
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || !visit(descriptor.value, depth + 1)) return false;
      bytes += key.length + 4;
    }
    active.delete(current);
    return bytes <= MAX_RESULT_BYTES;
  }
  try { return visit(value, 0); } catch { return false; }
}
