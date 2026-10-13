import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";
import {
  maplessMediaRequestClosureSchema,
  type MaplessMediaRequestClosure,
  type PinnedMediaRequestSource
} from "./mapless-media-request-closure.js";

const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const sourceRefSchema = z.object({
  module_name: z.string(), url: z.string().url(), bytes: z.number().int().positive().max(5_000_000), sha256: shaSchema,
  capture_status: z.enum(["NEWLY_PINNED_BOUNDED_GET", "REUSED_HASH_PINNED_PRIOR_REFERENCE", "REUSED_HASH_PINNED_INVENTORY"]).optional(),
  first_fetched_at: z.string().datetime({ offset: true }).nullable().optional()
}).strict();
const scalarSchema = z.union([z.string().max(2_000), z.number().finite(), z.boolean(), z.null()]);
const formControlInputSchema = z.object({
  field: z.string().min(1).max(128),
  value_type: z.enum(["string", "number", "integer", "boolean"]).nullable(),
  options_status: z.enum(["STATIC_LITERAL_ARRAY", "STATIC_LOCAL_CONSTANT", "STATIC_VNODE_CHILDREN", "UNRESOLVED_LOCAL_IMPORT", "DYNAMIC", "NOT_PRESENT"]),
  option_values: z.array(z.object({ label: z.string().max(500).nullable(), value: scalarSchema }).strict()).max(256),
  options_nullable: z.boolean(),
  conditions: z.array(z.object({
    field: z.string().nullable(), operator: z.enum(["===", "==", "!==", "!=", "SWITCH_CASE", "UNRESOLVED"]),
    value: scalarSchema, branch: z.enum(["THEN", "ELSE", "CASE"]), source_location: locationSchema, evaluated: z.literal(false)
  }).strict()).max(64),
  location: locationSchema
}).strict();
const fallbackInputSchema = z.object({
  model_id: z.string().min(1).max(160), field: z.string().min(1).max(128), value: scalarSchema,
  status: z.enum(["STATIC_FALLBACK_CANDIDATE", "DYNAMIC_FALLBACK_CANDIDATE", "OMITTED_FALLBACK"]),
  application_stage: z.literal("FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES"),
  location: locationSchema
}).strict();
const ownerObservationInputSchema = z.object({
  artifact_ref: z.string().regex(/^catalog\/runtime\/v12\/[A-Za-z0-9._-]+\.json$/u),
  artifact_sha256: shaSchema,
  model_id: z.string().min(1).max(160),
  public_catalog_sha256: shaSchema,
  settings_inventory_sha256: shaSchema,
  build_id: z.string().regex(/^\d{6,20}$/u),
  settings: z.object({
    n: z.number().int().nonnegative(), model_type: z.string().min(1).max(160),
    aspect_ratio: z.string().min(1).max(64), image_size: z.string().min(1).max(64),
    thinking_level: z.string().min(1).max(64), file_urls: z.array(z.string().max(512)).max(32)
  }).strict()
}).strict();

const producerCallSchema = z.object({
  module_name: z.string().min(1).max(128), location: locationSchema,
  argument_kind: z.enum(["NULL_LITERAL", "IDENTIFIER", "OBJECT_LITERAL", "CONDITIONAL", "OTHER"])
}).strict();
const stateWriteSchema = z.object({ module_name: z.string().min(1).max(128), location: locationSchema }).strict();
const patchWriterSchema = z.object({ module_name: z.string().min(1).max(128), location: locationSchema, argument_kind: z.enum(["OBJECT_LITERAL", "CALLBACK", "OTHER"]) }).strict();
const helperLinkSchema = z.object({ symbol: z.string().min(1).max(80), role: z.enum(["REF_FACTORY", "REF_PASSTHROUGH_OR_CONSTRUCTOR", "REF_MARKER_GUARD", "MUTABLE_REF_CLASS"]), location: locationSchema }).strict();

export const maplessImageEffectiveSettingsSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("MAPLESS_IMAGE_EFFECTIVE_SETTINGS"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST_PLUS_OWNER_OBSERVATION"),
  runtime_usable: z.literal(false),
  backend_acceptance_generalized: z.literal(false),
  source_persisted: z.literal(false),
  supersedes_inference: z.object({
    artifact_ref: z.literal("catalog/runtime/v14/sha256-a5f18c33ee45b4b97d8c8a1193d3d9b179cfd8e649f8b9d2b50995ce5c2a1f47.json"),
    artifact_sha256: z.literal("sha256:a5f18c33ee45b4b97d8c8a1193d3d9b179cfd8e649f8b9d2b50995ce5c2a1f47"),
    correction: z.literal("V14_MISCLASSIFIED_LOGICAL_AND_SETTINGS_REPLACEMENT_AS_UNCONDITIONAL")
  }).strict(),
  public_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  settings_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  build_id: z.string().regex(/^\d{6,20}$/u),
  source_refs: z.array(sourceRefSchema).min(4).max(64),
  target_form: z.object({ form_id: z.literal("banana"), source_sha256: shaSchema, model_ids: z.array(z.string().min(1).max(160)).min(1).max(256), factory_call_status: z.literal("EXACTLY_ONE_FACTORY_CALL") }).strict(),
  form_control_artifact: z.object({ path: z.string().regex(/^catalog\/runtime\/v11\/[A-Za-z0-9._-]+\.json$/u), sha256: shaSchema, form_id: z.literal("banana"), form_source_sha256: shaSchema }).strict(),
  form_control_binding: z.object({ control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE"]), settings_root_status: z.enum(["LEXICAL_BINDING_FOUND", "UNRESOLVED_GLOBAL_IDENTIFIER", "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED", "NO_SETTINGS_REFERENCE", "NOT_CHECKED"]) }).strict(),
  store_chain: z.object({
    status: z.enum(["LOCATED_MUTABLE_REF", "PARTIAL", "UNRESOLVED"]),
    state_field: z.literal("customSettingPayload"),
    initial_value: z.enum(["NULL", "OTHER", "UNRESOLVED"]),
    state_ref_alias: z.string().nullable(),
    state_setter_alias: z.string().nullable(),
    state_setter_parameter: z.string().nullable(),
    state_write_target: z.string().nullable(),
    helper_chain: z.array(helperLinkSchema).max(8),
    locations: z.object({ initial_value: locationSchema.nullable(), ref_creation: locationSchema.nullable(), exposed_property: locationSchema.nullable(), exposed_setter: locationSchema.nullable(), setter_assignment: locationSchema.nullable() }).strict()
  }).strict(),
  route_handoff: z.object({
    route: z.literal("design/generate"), route_argument_source: z.enum(["APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED", "NOT_RESOLVED"]),
    route_argument_index: z.number().int().nonnegative().nullable(), settings_source: z.enum(["APP_STORE_SETTINGS_WITH_TRUTHY_CUSTOM_PAYLOAD_OVERRIDE", "UNKNOWN"]),
    settings_overwrite_guard: z.enum(["UNCONDITIONAL", "CONDITIONAL", "CONDITIONAL_LOGICAL_AND_TRUTHY", "UNKNOWN"]), settings_input_parameter_index: z.number().int().nonnegative().nullable(),
    base_settings_source: z.enum(["APP_STORE_SETTINGS", "UNKNOWN"]), base_settings_seed_n: z.number().int().nullable(),
    falsy_override_behavior: z.enum(["RETAIN_BASE_SETTINGS", "REPLACE_WITH_CUSTOM_COPY", "UNKNOWN"]),
    file_urls_overwritten_after_settings: z.boolean()
  }).strict(),
  setter_calls: z.array(producerCallSchema).max(256),
  state_mutation_scan: z.object({
    scanned_source_count: z.number().int().nonnegative(),
    patch_calls_scanned: z.number().int().nonnegative(),
    payload_patch_calls: z.array(patchWriterSchema).max(256),
    direct_member_writes: z.array(stateWriteSchema).max(256),
    browser_storage_inspected: z.literal(false)
  }).strict(),
  target_form_producer_status: z.enum(["SOURCE_CALLER_FOUND", "NO_NON_NULL_SETTER_CALL_IN_TARGET_FORM", "CALLER_SCOPE_UNRESOLVED"]),
  form_controls: z.array(z.object({
    field: z.string(), value_type: z.enum(["string", "number", "integer", "boolean"]).nullable(),
    options_status: z.enum(["STATIC_LITERAL_ARRAY", "STATIC_LOCAL_CONSTANT", "STATIC_VNODE_CHILDREN", "UNRESOLVED_LOCAL_IMPORT", "DYNAMIC", "NOT_PRESENT"]),
    option_count: z.number().int().nonnegative(), options_nullable: z.boolean(),
    conditions: z.array(z.object({ field: z.string().nullable(), operator: z.string(), value: scalarSchema, branch: z.string(), source_location: locationSchema, evaluated: z.literal(false) }).strict()).max(64),
    location: locationSchema
  }).strict()).max(128),
  fallback_candidates: z.array(z.object({ model_id: z.string(), field: z.string(), value: scalarSchema, status: z.enum(["STATIC_FALLBACK_CANDIDATE", "DYNAMIC_FALLBACK_CANDIDATE", "OMITTED_FALLBACK"]), application_stage: z.literal("FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES"), location: locationSchema }).strict()).max(256),
  owner_observation: ownerObservationInputSchema,
  effective_settings_status: z.enum(["OWNER_OBSERVED_PROFILE_ONLY", "SOURCE_WRITER_PRESENT_EFFECTIVE_PAYLOAD_UNVERIFIED"]),
  blockers: z.array(z.enum(["TARGET_FORM_SETTER_PRODUCER_NOT_FOUND", "OWNER_OBSERVATION_NOT_GENERALIZED", "FALLBACKS_ARE_NOT_EFFECTIVE_WIRE_DEFAULTS", "DYNAMIC_CONDITIONS_NOT_EVALUATED", "FORM_CONTROL_SETTINGS_ROOT_NOT_CHECKED"])).max(8),
  limitations: z.array(z.string().min(1).max(512)).max(16)
}).strict();

export type MaplessImageEffectiveSettings = z.infer<typeof maplessImageEffectiveSettingsSchema>;
export interface MaplessImageEffectiveSettingsInput {
  closure: MaplessMediaRequestClosure;
  sources: readonly PinnedMediaRequestSource[];
  form: {
    form_id: "banana";
    module_name: string;
    source_sha256: string;
    control_artifact_ref: string;
    control_artifact_sha256: string;
    control_structure_status: "CONTROLS_FOUND" | "UNRESOLVED_STRUCTURE";
    settings_root_status: "LEXICAL_BINDING_FOUND" | "UNRESOLVED_GLOBAL_IDENTIFIER" | "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED" | "NO_SETTINGS_REFERENCE" | "NOT_CHECKED";
    model_ids: readonly string[];
    controls: readonly z.input<typeof formControlInputSchema>[];
  };
  fallback_candidates: readonly z.input<typeof fallbackInputSchema>[];
  owner_observation: z.input<typeof ownerObservationInputSchema>;
}

export class MaplessImageEffectiveSettingsError extends Error {
  constructor(readonly code: "INPUT_BINDING_INVALID" | "SOURCE_MISMATCH" | "SOURCE_SIZE_MISMATCH" | "SOURCE_HASH_MISMATCH" | "AST_PARSE_FAILED" | "PRODUCER_PATH_UNRESOLVED" | "TARGET_FORM_BINDING_INVALID") {
    super(code);
    this.name = "MaplessImageEffectiveSettingsError";
  }
}

/** Builds a source-bound evidence projection; it never promotes UI defaults into the request DTO. */
export function analyzeMaplessImageEffectiveSettings(input: MaplessImageEffectiveSettingsInput): MaplessImageEffectiveSettings {
  let closure: MaplessMediaRequestClosure;
  try { closure = maplessMediaRequestClosureSchema.parse(input.closure); } catch { throw new MaplessImageEffectiveSettingsError("INPUT_BINDING_INVALID"); }
  const forms = z.object({ form_id: z.literal("banana"), module_name: z.string(), source_sha256: shaSchema, control_artifact_ref: z.string().regex(/^catalog\/runtime\/v11\/[A-Za-z0-9._-]+\.json$/u), control_artifact_sha256: shaSchema, control_structure_status: z.enum(["CONTROLS_FOUND", "UNRESOLVED_STRUCTURE"]), settings_root_status: z.enum(["LEXICAL_BINDING_FOUND", "UNRESOLVED_GLOBAL_IDENTIFIER", "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED", "NO_SETTINGS_REFERENCE", "NOT_CHECKED"]), model_ids: z.array(z.string()).min(1), controls: z.array(formControlInputSchema).max(128) }).strict().safeParse(input.form);
  const fallbackCandidates = z.array(fallbackInputSchema).max(256).safeParse(input.fallback_candidates);
  const ownerObservation = ownerObservationInputSchema.safeParse(input.owner_observation);
  if (!forms.success || !fallbackCandidates.success || !ownerObservation.success) throw new MaplessImageEffectiveSettingsError("INPUT_BINDING_INVALID");

  const pinnedByName = new Map(closure.sources.map((source) => [source.module_name, source]));
  const supplied = new Map<string, PinnedMediaRequestSource>();
  for (const source of input.sources) {
    if (supplied.has(source.module_name)) throw new MaplessImageEffectiveSettingsError("SOURCE_MISMATCH");
    verifySource(source, closure.build_id);
    const expected = pinnedByName.get(source.module_name);
    if (!expected || expected.url !== source.url || expected.bytes !== source.bytes || expected.sha256 !== source.sha256) throw new MaplessImageEffectiveSettingsError("SOURCE_MISMATCH");
    supplied.set(source.module_name, source);
  }
  if (supplied.size !== closure.sources.length || closure.sources.some((source) => !supplied.has(source.module_name))) throw new MaplessImageEffectiveSettingsError("SOURCE_MISMATCH");
  const formSource = supplied.get(forms.data.module_name);
  const appSource = required(supplied, "app.js");
  const routeSource = required(supplied, "index6.js");
  const senderSource = required(supplied, "video.js");
  if (!formSource || formSource.sha256 !== forms.data.source_sha256 || !forms.data.model_ids.every((modelId) => closure.form_factory_calls.find((form) => form.form_id === "banana")?.active_model_ids.includes(modelId))) {
    throw new MaplessImageEffectiveSettingsError("TARGET_FORM_BINDING_INVALID");
  }
  const operation = closure.operations.find((candidate) => candidate.route === "design/generate");
  const factory = closure.form_factory_calls.find((candidate) => candidate.form_id === "banana");
  if (!operation || !factory || factory.status !== "EXACTLY_ONE_FACTORY_CALL" || operation.route_argument_source !== "APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED" || operation.settings_source !== "FIFTH_ARGUMENT_REPLACES_INITIAL_STORE_SPREAD") {
    throw new MaplessImageEffectiveSettingsError("PRODUCER_PATH_UNRESOLVED");
  }

  const appFile = parse(appSource);
  const routeFile = parse(routeSource);
  const senderFile = parse(senderSource);
  const stateChain = extractAppStoreChain(appFile);
  const setterCalls = extractSetterCalls(supplied);
  const mutationScan = extractStateMutationScan(supplied);
  const senderSemantics = extractImageSenderSemantics(senderFile);
  const targetCalls = setterCalls.filter((call) => call.module_name === forms.data.module_name && call.argument_kind !== "NULL_LITERAL");
  const targetPatches = mutationScan.payload_patch_calls.filter((call) => call.module_name === forms.data.module_name);
  const targetWrites = mutationScan.direct_member_writes.filter((write) => write.module_name === forms.data.module_name);
  const targetProducerStatus = targetCalls.length + targetPatches.length + targetWrites.length > 0 ? "SOURCE_CALLER_FOUND" as const : "NO_NON_NULL_SETTER_CALL_IN_TARGET_FORM" as const;
  const routeArgumentVerified = verifyImageRouteArgument(routeFile);
  const moduleSourceRefs = closure.sources;
  const fallbackFields = new Set(fallbackCandidates.data.map((candidate) => candidate.field));
  const controls = forms.data.controls.filter((control) => control.conditions.length > 0 || (control.field !== "model_type" && fallbackFields.has(control.field))).map((control) => ({
    field: control.field,
    value_type: control.value_type,
    options_status: control.options_status,
    option_count: control.option_values.length,
    options_nullable: control.options_nullable,
    conditions: control.conditions,
    location: control.location
  }));
  const blockers = new Set<MaplessImageEffectiveSettings["blockers"][number]>([
    "OWNER_OBSERVATION_NOT_GENERALIZED",
    "FALLBACKS_ARE_NOT_EFFECTIVE_WIRE_DEFAULTS"
  ]);
  if (targetProducerStatus !== "SOURCE_CALLER_FOUND") blockers.add("TARGET_FORM_SETTER_PRODUCER_NOT_FOUND");
  if (controls.some((control) => control.conditions.length > 0 || control.options_status === "DYNAMIC" || control.options_status === "UNRESOLVED_LOCAL_IMPORT")) blockers.add("DYNAMIC_CONDITIONS_NOT_EVALUATED");
  if (forms.data.settings_root_status === "NOT_CHECKED" || forms.data.settings_root_status === "UNRESOLVED_GLOBAL_IDENTIFIER" || forms.data.settings_root_status === "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED") blockers.add("FORM_CONTROL_SETTINGS_ROOT_NOT_CHECKED");
  return maplessImageEffectiveSettingsSchema.parse({
    schema_version: "1.0.0",
    catalog_kind: "MAPLESS_IMAGE_EFFECTIVE_SETTINGS",
    evidence_level: "HASH_PINNED_COMPILED_JS_AST_PLUS_OWNER_OBSERVATION",
    runtime_usable: false,
    backend_acceptance_generalized: false,
    source_persisted: false,
    supersedes_inference: {
      artifact_ref: "catalog/runtime/v14/sha256-a5f18c33ee45b4b97d8c8a1193d3d9b179cfd8e649f8b9d2b50995ce5c2a1f47.json",
      artifact_sha256: "sha256:a5f18c33ee45b4b97d8c8a1193d3d9b179cfd8e649f8b9d2b50995ce5c2a1f47",
      correction: "V14_MISCLASSIFIED_LOGICAL_AND_SETTINGS_REPLACEMENT_AS_UNCONDITIONAL"
    },
    public_version: closure.public_version,
    settings_version: closure.settings_version,
    build_id: closure.build_id,
    source_refs: moduleSourceRefs,
    target_form: { form_id: "banana", source_sha256: formSource.sha256, model_ids: forms.data.model_ids, factory_call_status: "EXACTLY_ONE_FACTORY_CALL" },
    form_control_artifact: { path: forms.data.control_artifact_ref, sha256: forms.data.control_artifact_sha256, form_id: "banana", form_source_sha256: formSource.sha256 },
    form_control_binding: { control_structure_status: forms.data.control_structure_status, settings_root_status: forms.data.settings_root_status },
    store_chain: stateChain,
    route_handoff: {
      route: "design/generate",
      route_argument_source: routeArgumentVerified ? operation.route_argument_source : "NOT_RESOLVED",
      route_argument_index: routeArgumentVerified ? operation.route_argument_index : null,
      settings_source: senderSemantics.status,
      settings_overwrite_guard: senderSemantics.guard,
      settings_input_parameter_index: senderSemantics.parameterIndex,
      base_settings_source: senderSemantics.baseSource,
      base_settings_seed_n: senderSemantics.seedN,
      falsy_override_behavior: senderSemantics.falsyBehavior,
      file_urls_overwritten_after_settings: operation.file_urls_overwritten_after_settings
    },
    setter_calls: setterCalls,
    state_mutation_scan: mutationScan,
    target_form_producer_status: targetProducerStatus,
    form_controls: controls,
    fallback_candidates: fallbackCandidates.data,
    owner_observation: ownerObservation.data,
    effective_settings_status: targetProducerStatus === "SOURCE_CALLER_FOUND" ? "SOURCE_WRITER_PRESENT_EFFECTIVE_PAYLOAD_UNVERIFIED" : "OWNER_OBSERVED_PROFILE_ONLY",
    blockers: [...blockers].sort(),
    limitations: [
      "The owner-observed Banana 2.1 request is one successful native-browser sample and is kept separate from source-derived default candidates.",
      "The app store exposes a mutable custom-setting ref, but the cached Banana form does not call its non-null setter; source evidence does not explain how the observed settings enter that state.",
      "UI option values and fallback defaults are not generalized into accepted wire values for other models."
    ]
  });
}

function verifySource(source: PinnedMediaRequestSource, buildId: string): void {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname !== "syntx.ai" || url.pathname.split("/")[2] !== buildId) throw new Error();
    if (source.bytes !== Buffer.byteLength(source.text, "utf8")) throw new MaplessImageEffectiveSettingsError("SOURCE_SIZE_MISMATCH");
    if (`sha256:${createHash("sha256").update(Buffer.from(source.text, "utf8")).digest("hex")}` !== source.sha256) throw new MaplessImageEffectiveSettingsError("SOURCE_HASH_MISMATCH");
  } catch (error) {
    if (error instanceof MaplessImageEffectiveSettingsError) throw error;
    throw new MaplessImageEffectiveSettingsError("SOURCE_MISMATCH");
  }
}

function required(sources: Map<string, PinnedMediaRequestSource>, name: string): PinnedMediaRequestSource {
  const source = sources.get(name);
  if (!source) throw new MaplessImageEffectiveSettingsError("SOURCE_MISMATCH");
  return source;
}

function parse(source: PinnedMediaRequestSource): ts.SourceFile {
  const file = ts.createSourceFile(source.module_name, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) throw new MaplessImageEffectiveSettingsError("AST_PARSE_FAILED");
  return file;
}

function extractAppStoreChain(file: ts.SourceFile): MaplessImageEffectiveSettings["store_chain"] {
  for (const declaration of findNodes(file, ts.isVariableDeclaration)) {
    if (!ts.isIdentifier(declaration.name) || declaration.name.text !== "h" || !declaration.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) continue;
    const initial = property(declaration.initializer, "customSettingPayload");
    if (!initial || !ts.isPropertyAssignment(initial) || initial.initializer.kind !== ts.SyntaxKind.NullKeyword) continue;
    const scope = nearestFunction(declaration);
    if (!scope?.body || !ts.isBlock(scope.body)) continue;
    const refDecl = findNodes(scope.body, ts.isVariableDeclaration).find((item) => ts.isIdentifier(item.name) && item.initializer && ts.isCallExpression(item.initializer) && item.initializer.arguments.some((arg) => ts.isPropertyAccessExpression(arg) && ts.isIdentifier(arg.expression) && arg.expression.text === "h" && arg.name.text === "customSettingPayload"));
    if (!refDecl || !ts.isIdentifier(refDecl.name) || !refDecl.initializer || !ts.isCallExpression(refDecl.initializer) || !ts.isIdentifier(refDecl.initializer.expression)) continue;
    const refAlias = refDecl.name.text;
    const refFactory = refDecl.initializer.expression.text;
    const exposedObject = findNodes(scope.body, ts.isObjectLiteralExpression).find((object) => {
      const stateProperty = property(object, "customSettingPayload");
      const setterProperty = property(object, "setCustomSettingPayload");
      return Boolean(stateProperty && ts.isPropertyAssignment(stateProperty) && ts.isIdentifier(stateProperty.initializer) && stateProperty.initializer.text === refAlias && setterProperty && ts.isPropertyAssignment(setterProperty) && ts.isIdentifier(setterProperty.initializer));
    });
    if (!exposedObject) continue;
    const exposedSetter = property(exposedObject, "setCustomSettingPayload");
    if (!exposedSetter || !ts.isPropertyAssignment(exposedSetter) || !ts.isIdentifier(exposedSetter.initializer)) continue;
    const setterAlias = exposedSetter.initializer.text;
    const setterDeclaration = findNodes(scope.body, ts.isVariableDeclaration).find((item) => ts.isIdentifier(item.name) && item.name.text === setterAlias && item.initializer && (ts.isArrowFunction(item.initializer) || ts.isFunctionExpression(item.initializer)));
    if (!setterDeclaration?.initializer || !ts.isArrowFunction(setterDeclaration.initializer) && !ts.isFunctionExpression(setterDeclaration.initializer)) continue;
    const setterParam = setterDeclaration.initializer.parameters[0];
    const assignment = setterDeclaration.initializer.body && findNodes(setterDeclaration.initializer.body, ts.isBinaryExpression).find((item) => item.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(item.left) && ts.isIdentifier(item.left.expression) && item.left.expression.text === refAlias && item.left.name.text === "value" && ts.isIdentifier(item.right) && item.right.text === setterParam?.name.getText(file));
    if (!assignment) continue;
    const factoryDeclaration = findNodes(file, ts.isFunctionDeclaration).find((item) => item.name?.text === refFactory);
    const wrapperCall = factoryDeclaration?.body && findNodes(factoryDeclaration.body, ts.isCallExpression).find((item) => ts.isIdentifier(item.expression));
    const wrapperName = wrapperCall && ts.isIdentifier(wrapperCall.expression) ? wrapperCall.expression.text : null;
    const wrapperDeclaration = wrapperName ? findNodes(file, ts.isFunctionDeclaration).find((item) => item.name?.text === wrapperName) : undefined;
    const wrapperReturn = wrapperDeclaration?.body && findNodes(wrapperDeclaration.body, ts.isReturnStatement).map((item) => item.expression).find((item): item is ts.Expression => item !== undefined);
    const markerGuard = wrapperReturn && ts.isConditionalExpression(wrapperReturn) && ts.isCallExpression(wrapperReturn.condition) && ts.isIdentifier(wrapperReturn.condition.expression) ? wrapperReturn.condition.expression.text : null;
    const markerDeclaration = markerGuard ? findNodes(file, ts.isFunctionDeclaration).find((item) => item.name?.text === markerGuard) : undefined;
    const mutableClassName = wrapperReturn && ts.isConditionalExpression(wrapperReturn) && ts.isNewExpression(wrapperReturn.whenFalse) && ts.isIdentifier(wrapperReturn.whenFalse.expression) ? wrapperReturn.whenFalse.expression.text : null;
    const mutableClass = mutableClassName ? findNodes(file, ts.isClassDeclaration).find((item) => item.name?.text === mutableClassName) : undefined;
    const helperChain: MaplessImageEffectiveSettings["store_chain"]["helper_chain"] = [];
    if (factoryDeclaration) helperChain.push({ symbol: refFactory, role: "REF_FACTORY", location: locator(file, factoryDeclaration) });
    if (wrapperDeclaration) helperChain.push({ symbol: wrapperName!, role: "REF_PASSTHROUGH_OR_CONSTRUCTOR", location: locator(file, wrapperDeclaration) });
    if (markerDeclaration) helperChain.push({ symbol: markerGuard!, role: "REF_MARKER_GUARD", location: locator(file, markerDeclaration) });
    if (mutableClass) helperChain.push({ symbol: mutableClassName!, role: "MUTABLE_REF_CLASS", location: locator(file, mutableClass) });
    const stateProp = property(exposedObject, "customSettingPayload");
    return {
      status: "LOCATED_MUTABLE_REF",
      state_field: "customSettingPayload",
      initial_value: "NULL",
      state_ref_alias: refAlias,
      state_setter_alias: setterAlias,
      state_setter_parameter: setterParam ? setterParam.name.getText(file) : null,
      state_write_target: `${refAlias}.value`,
      helper_chain: helperChain,
      locations: {
        initial_value: locator(file, initial.initializer),
        ref_creation: locator(file, refDecl.initializer),
        exposed_property: stateProp ? locator(file, stateProp) : null,
        exposed_setter: locator(file, exposedSetter),
        setter_assignment: locator(file, assignment)
      }
    };
  }
  return { status: "UNRESOLVED", state_field: "customSettingPayload", initial_value: "UNRESOLVED", state_ref_alias: null, state_setter_alias: null, state_setter_parameter: null, state_write_target: null, helper_chain: [], locations: { initial_value: null, ref_creation: null, exposed_property: null, exposed_setter: null, setter_assignment: null } };
}

function extractSetterCalls(sources: Map<string, PinnedMediaRequestSource>): MaplessImageEffectiveSettings["setter_calls"] {
  const calls: MaplessImageEffectiveSettings["setter_calls"] = [];
  for (const [moduleName, source] of sources) {
    const file = parse(source);
    const aliases = new Set<string>();
    for (const binding of findNodes(file, ts.isBindingElement)) {
      const propertyName = binding.propertyName && (ts.isIdentifier(binding.propertyName) || ts.isStringLiteral(binding.propertyName)) ? binding.propertyName.text : null;
      if (propertyName === "setCustomSettingPayload" && ts.isIdentifier(binding.name)) aliases.add(binding.name.text);
    }
    for (const declaration of findNodes(file, ts.isVariableDeclaration)) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer && ts.isPropertyAccessExpression(declaration.initializer) && declaration.initializer.name.text === "setCustomSettingPayload") aliases.add(declaration.name.text);
    }
    for (const call of findNodes(file, ts.isCallExpression)) {
      const directCall = ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "setCustomSettingPayload";
      const aliasedCall = ts.isIdentifier(call.expression) && aliases.has(call.expression.text);
      if (!directCall && !aliasedCall) continue;
      const arg = call.arguments[0];
      const argumentKind = !arg ? "OTHER" : arg.kind === ts.SyntaxKind.NullKeyword ? "NULL_LITERAL" : ts.isIdentifier(arg) ? "IDENTIFIER" : ts.isObjectLiteralExpression(arg) ? "OBJECT_LITERAL" : ts.isConditionalExpression(arg) ? "CONDITIONAL" : "OTHER";
      calls.push({ module_name: moduleName, location: locator(file, call), argument_kind: argumentKind });
    }
  }
  return calls.sort((a, b) => a.module_name.localeCompare(b.module_name) || a.location.line - b.location.line || a.location.column - b.location.column);
}

function extractStateMutationScan(sources: Map<string, PinnedMediaRequestSource>): MaplessImageEffectiveSettings["state_mutation_scan"] {
  const payloadPatchCalls: MaplessImageEffectiveSettings["state_mutation_scan"]["payload_patch_calls"] = [];
  const directMemberWrites: MaplessImageEffectiveSettings["state_mutation_scan"]["direct_member_writes"] = [];
  let patchCallsScanned = 0;
  for (const [moduleName, source] of sources) {
    const file = parse(source);
    for (const assignment of findNodes(file, ts.isBinaryExpression)) {
      if (assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(assignment.left) && assignment.left.name.text === "customSettingPayload") {
        directMemberWrites.push({ module_name: moduleName, location: locator(file, assignment) });
      }
    }
    for (const call of findNodes(file, ts.isCallExpression)) {
      if (!ts.isPropertyAccessExpression(call.expression) || call.expression.name.text !== "$patch") continue;
      patchCallsScanned += 1;
      const argument = call.arguments[0];
      if (!argument) continue;
      const objectFieldWrite = findNodes(argument, (node): node is ts.PropertyAssignment => ts.isPropertyAssignment(node) && propertyText(node.name) === "customSettingPayload").length > 0;
      const memberWrite = findNodes(argument, ts.isBinaryExpression).some((assignment) => assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(assignment.left) && assignment.left.name.text === "customSettingPayload");
      if (!objectFieldWrite && !memberWrite) continue;
      payloadPatchCalls.push({ module_name: moduleName, location: locator(file, call), argument_kind: ts.isObjectLiteralExpression(argument) ? "OBJECT_LITERAL" : ts.isArrowFunction(argument) || ts.isFunctionExpression(argument) ? "CALLBACK" : "OTHER" });
    }
  }
  return {
    scanned_source_count: sources.size,
    patch_calls_scanned: patchCallsScanned,
    payload_patch_calls: payloadPatchCalls.sort((a, b) => a.module_name.localeCompare(b.module_name) || a.location.line - b.location.line),
    direct_member_writes: directMemberWrites.sort((a, b) => a.module_name.localeCompare(b.module_name) || a.location.line - b.location.line),
    browser_storage_inspected: false
  };
}

function verifyImageRouteArgument(file: ts.SourceFile): boolean {
  return findNodes(file, ts.isCallExpression).some((call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "sendMessage" && call.arguments[4] !== undefined);
}

function extractImageSenderSemantics(file: ts.SourceFile): {
  status: MaplessImageEffectiveSettings["route_handoff"]["settings_source"];
  guard: MaplessImageEffectiveSettings["route_handoff"]["settings_overwrite_guard"];
  parameterIndex: number | null;
  baseSource: MaplessImageEffectiveSettings["route_handoff"]["base_settings_source"];
  seedN: number | null;
  falsyBehavior: MaplessImageEffectiveSettings["route_handoff"]["falsy_override_behavior"];
} {
  const dispatch = findNodes(file, ts.isCallExpression).find((call) => ts.isPropertyAccessExpression(call.expression) && call.expression.name.text === "post" && call.arguments[0] && (ts.isStringLiteral(call.arguments[0]) || ts.isNoSubstitutionTemplateLiteral(call.arguments[0])) && call.arguments[0].text === "design/generate");
  const bodyArgument = dispatch?.arguments[1];
  const fn = dispatch ? nearestFunction(dispatch) : null;
  if (!fn?.body || !ts.isBlock(fn.body) || !bodyArgument || !ts.isIdentifier(bodyArgument)) return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, baseSource: "UNKNOWN", seedN: null, falsyBehavior: "UNKNOWN" };
  const bodyDeclaration = findNodes(fn.body, ts.isVariableDeclaration).find((item) => ts.isIdentifier(item.name) && item.name.text === bodyArgument.text && item.initializer && ts.isObjectLiteralExpression(item.initializer));
  if (!bodyDeclaration?.initializer || !ts.isObjectLiteralExpression(bodyDeclaration.initializer)) return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, baseSource: "UNKNOWN", seedN: null, falsyBehavior: "UNKNOWN" };
  const settingsProperty = property(bodyDeclaration.initializer, "settings");
  const settingsValue = settingsProperty && ts.isPropertyAssignment(settingsProperty) ? settingsProperty.initializer : settingsProperty && ts.isShorthandPropertyAssignment(settingsProperty) ? settingsProperty.name : undefined;
  if (!settingsValue || !ts.isIdentifier(settingsValue)) return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, baseSource: "UNKNOWN", seedN: null, falsyBehavior: "UNKNOWN" };
  const settingsName = settingsValue.text;
  const declarations = findNodes(fn.body, ts.isVariableDeclaration).filter((item) => ts.isIdentifier(item.name) && item.name.text === settingsName && item.initializer);
  const initial = declarations.find((item) => item.initializer && ts.isObjectLiteralExpression(unwrap(item.initializer)));
  const initialObject = initial?.initializer ? unwrap(initial.initializer) : null;
  if (!initialObject || !ts.isObjectLiteralExpression(initialObject)) return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, baseSource: "UNKNOWN", seedN: null, falsyBehavior: "UNKNOWN" };
  const seedProperty = property(initialObject, "n");
  const seedN = seedProperty && ts.isPropertyAssignment(seedProperty) && ts.isNumericLiteral(seedProperty.initializer) ? Number(seedProperty.initializer.text) : null;
  const storeSpread = initialObject.properties.find(ts.isSpreadAssignment);
  const baseSource = storeSpread && isAppStoreSettingsSpread(file, fn, storeSpread.expression) ? "APP_STORE_SETTINGS" as const : "UNKNOWN" as const;
  const replacement = findNodes(fn.body, ts.isBinaryExpression).find((assignment) => assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(assignment.left) && assignment.left.text === settingsName && objectHasSpread(assignment.right));
  const replacementObject = replacement ? unwrap(replacement.right) : null;
  const overrideSpread = replacementObject && ts.isObjectLiteralExpression(replacementObject) ? replacementObject.properties.find(ts.isSpreadAssignment) : undefined;
  const overrideInput = overrideSpread?.expression && ts.isIdentifier(overrideSpread.expression) ? overrideSpread.expression.text : null;
  const parameterIndex = overrideInput === null ? null : fn.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === overrideInput);
  const actualIndex = parameterIndex !== null && parameterIndex >= 0 ? parameterIndex : null;
  let guard: MaplessImageEffectiveSettings["route_handoff"]["settings_overwrite_guard"] = "UNKNOWN";
  let falsyBehavior: MaplessImageEffectiveSettings["route_handoff"]["falsy_override_behavior"] = "UNKNOWN";
  if (replacement) {
    const shortCircuit = logicalRightGuard(replacement);
    if (shortCircuit?.operator === ts.SyntaxKind.AmpersandAmpersandToken && ts.isIdentifier(shortCircuit.condition) && shortCircuit.condition.text === overrideInput && actualIndex === 4) {
      guard = "CONDITIONAL_LOGICAL_AND_TRUTHY";
      falsyBehavior = "RETAIN_BASE_SETTINGS";
    } else if (shortCircuit) {
      guard = "CONDITIONAL";
      falsyBehavior = "UNKNOWN";
    } else if (hasOtherConditionalGuard(replacement)) {
      guard = "CONDITIONAL";
      falsyBehavior = "UNKNOWN";
    } else {
      guard = "UNCONDITIONAL";
      falsyBehavior = "REPLACE_WITH_CUSTOM_COPY";
    }
  }
  const status = baseSource === "APP_STORE_SETTINGS" && seedN === 1 && actualIndex === 4 && guard === "CONDITIONAL_LOGICAL_AND_TRUTHY"
    ? "APP_STORE_SETTINGS_WITH_TRUTHY_CUSTOM_PAYLOAD_OVERRIDE" as const
    : "UNKNOWN" as const;
  return { status, guard, parameterIndex: actualIndex, baseSource, seedN, falsyBehavior };
}

function isAppStoreSettingsSpread(file: ts.SourceFile, fn: ts.FunctionLikeDeclaration, expression: ts.Expression): boolean {
  const value = unwrap(expression);
  if (!ts.isPropertyAccessExpression(value) || value.name.text !== "settings" || !ts.isIdentifier(value.expression) || !fn.body || !ts.isBlock(fn.body)) return false;
  const localStoreName = value.expression.text;
  const storeDeclaration = findVariableInEnclosingScopes(fn, localStoreName);
  if (!storeDeclaration?.initializer || !ts.isCallExpression(storeDeclaration.initializer) || !ts.isIdentifier(storeDeclaration.initializer.expression)) return false;
  const appStoreAlias = [...findNodes(file, ts.isImportDeclaration)].flatMap((declaration) => {
    if (!ts.isStringLiteral(declaration.moduleSpecifier) || declaration.moduleSpecifier.text !== "./app.js") return [];
    const bindings = declaration.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) return [];
    return bindings.elements.filter((element) => (element.propertyName?.text ?? element.name.text) === "b6").map((element) => element.name.text);
  });
  return appStoreAlias.includes(storeDeclaration.initializer.expression.text);
}

function findVariableInEnclosingScopes(fn: ts.FunctionLikeDeclaration, name: string): ts.VariableDeclaration | undefined {
  let scope: ts.FunctionLikeDeclaration | null = fn;
  while (scope) {
    if (scope.body && ts.isBlock(scope.body)) {
      let found: ts.VariableDeclaration | undefined;
      const visit = (node: ts.Node): void => {
        if (found) return;
        if (node !== scope && (ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node))) return;
        if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) { found = node; return; }
        ts.forEachChild(node, visit);
      };
      visit(scope.body);
      if (found) return found;
    }
    scope = nearestFunction(scope);
  }
  return undefined;
}

function logicalRightGuard(node: ts.Node): { operator: ts.SyntaxKind; condition: ts.Expression } | null {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isFunctionLike(current)) {
    if (ts.isBinaryExpression(current) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind) && isWithin(node, current.right)) return { operator: current.operatorToken.kind, condition: current.left };
    current = current.parent;
  }
  return null;
}

function hasOtherConditionalGuard(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isFunctionLike(current)) {
    if (ts.isIfStatement(current) || ts.isConditionalExpression(current) || ts.isSwitchStatement(current)) return true;
    current = current.parent;
  }
  return false;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

function objectHasSpread(expression: ts.Expression): boolean {
  const value = unwrap(expression);
  return ts.isObjectLiteralExpression(value) && value.properties.some(ts.isSpreadAssignment);
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function property(object: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralElementLike | undefined {
  return object.properties.find((item) => (ts.isPropertyAssignment(item) || ts.isMethodDeclaration(item) || ts.isShorthandPropertyAssignment(item)) && propertyText(item.name) === name);
}

function propertyText(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null;
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current)) return current;
    current = current.parent;
  }
  return null;
}

function findNodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const nodes: T[] = [];
  const visit = (node: ts.Node): void => { if (predicate(node)) nodes.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return nodes;
}

function locator(file: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: position.line + 1, column: position.character + 1 };
}
