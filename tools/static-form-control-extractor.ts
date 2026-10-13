import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";
import {
  buildStaticGenerationParameterSchemas,
  staticFormControlAnalysisSchema,
  staticFormControlEvidenceSchema,
  type StaticFormControlAnalysis,
  type StaticFormControlEvidence
} from "../src/catalog/static-generation-parameter-schema.js";
import {
  maplessSettingsInventorySchema,
  type MaplessSettingsInventory
} from "../src/catalog/mapless-settings-inventory.js";
import {
  syntxPublicCatalogSnapshotSchema,
  type SyntxPublicCatalogSnapshot
} from "../src/catalog/syntx-public-catalog.js";

const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const MAX_FORM_BYTES = 128 * 1024;
const MAX_BATCH_BYTES = 2 * 1024 * 1024;
const MAX_FORMS = 32;

export interface PinnedStaticFormSourceReference {
  readonly form_id: string;
  readonly module_name: string;
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly model_value_settings_keys?: readonly string[] | undefined;
}

interface SourceUnit {
  readonly ref: PinnedStaticFormSourceReference;
  readonly text: string;
  readonly file: ts.SourceFile;
  readonly imports: readonly StaticFormControlAnalysis["forms"][number]["local_imports"][number][];
  readonly importsByLocal: ReadonlyMap<string, StaticFormControlAnalysis["forms"][number]["local_imports"][number]>;
  readonly consts: ReadonlyMap<string, readonly { initializer: ts.Expression; scope: ts.Node; position: number }[]>;
  readonly settings3StoreBinding: StaticFormControlAnalysis["forms"][number]["settings3_store_binding"];
}

type Literal = string | number | boolean | null;
type StaticValue = Literal | StaticValue[] | { [key: string]: StaticValue };
type EvalResult =
  | { status: "STATIC_LITERAL" | "STATIC_LOCAL_CONSTANT"; value: StaticValue }
  | { status: "UNRESOLVED_LOCAL_IMPORT"; importRef: string }
  | { status: "DYNAMIC" }
  | { status: "NOT_PRESENT" };

export interface FetchStaticFormControlEvidenceInput {
  readonly publicCatalog: SyntxPublicCatalogSnapshot;
  readonly publicCatalogVersion: string;
  readonly settingsInventory: MaplessSettingsInventory;
  readonly settingsInventoryVersion: string;
  readonly fetchImpl?: typeof fetch | undefined;
  readonly signal?: AbortSignal | undefined;
  readonly concurrency?: number | undefined;
  readonly requestTimeoutMs?: number | undefined;
}

export interface FetchStaticFormControlEvidenceResult {
  readonly analysis: StaticFormControlAnalysis;
  readonly artifact_version: string;
}

export type StaticFormControlExtractorErrorCode =
  | "FORM_SOURCE_BINDING_INVALID"
  | "FORM_SOURCE_BYTE_LIMIT_EXCEEDED"
  | "FORM_SOURCE_FETCH_FAILED"
  | "FORM_SOURCE_HASH_MISMATCH"
  | "FORM_SOURCE_SET_INVALID"
  | "FORM_SOURCE_URL_INVALID"
  | "FORM_AST_PARSE_FAILED"
  | "FORM_EVIDENCE_INVALID";

export class StaticFormControlExtractorError extends Error {
  constructor(readonly code: StaticFormControlExtractorErrorCode) {
    super("Pinned form-control evidence could not be analyzed safely.");
    this.name = "StaticFormControlExtractorError";
  }
}

/** Fetch every selected form URL once, bound each body, hash-check before AST parsing, and retain no bodies in the result. */
export async function fetchStaticFormControlEvidence(
  input: FetchStaticFormControlEvidenceInput
): Promise<StaticFormControlAnalysis> {
  const catalog = syntxPublicCatalogSnapshotSchema.parse(input.publicCatalog);
  const inventory = maplessSettingsInventorySchema.parse(input.settingsInventory);
  const projection = buildStaticGenerationParameterSchemas({
    publicCatalog: catalog,
    publicCatalogVersion: input.publicCatalogVersion,
    settingsInventory: inventory,
    settingsInventoryVersion: input.settingsInventoryVersion
  });
  const modelIdsByForm = new Map<string, string[]>();
  const unboundModelIds: string[] = [];
  for (const model of projection.models) {
    const form = model.settings_form_binding;
    if (form.status !== "STRUCTURAL_MATCH" || form.form_id === null) {
      unboundModelIds.push(model.model_id);
      continue;
    }
    const group = modelIdsByForm.get(form.form_id) ?? [];
    group.push(model.model_id);
    modelIdsByForm.set(form.form_id, group);
  }
  const refs = [...modelIdsByForm.entries()].map(([formId, modelIds]) => {
    const form = inventory.forms.find((candidate) => candidate.form_id === formId);
    if (!form) throw extractorError("FORM_SOURCE_BINDING_INVALID");
    return {
      form_id: form.form_id,
      module_name: form.module_name,
      url: form.javascript.url,
      bytes: form.javascript.bytes,
      sha256: form.javascript.sha256,
      model_value_settings_keys: form.javascript.model_value_settings_keys,
      model_ids: modelIds.sort()
    };
  }).sort((left, right) => left.form_id.localeCompare(right.form_id));
  validateSourceBatch(refs, input.concurrency ?? 4, input.requestTimeoutMs ?? 10_000);
  const totalExpectedBytes = refs.reduce((sum, ref) => sum + ref.bytes, 0);
  if (totalExpectedBytes > MAX_BATCH_BYTES) throw extractorError("FORM_SOURCE_BYTE_LIMIT_EXCEEDED");

  const fetchImpl = input.fetchImpl ?? fetch;
  const cache = new Map<string, Promise<{ text: string; bytes: Buffer }>>();
  const fetchOnce = (ref: (typeof refs)[number]) => {
    const existing = cache.get(ref.url);
    if (existing) return existing;
    const pending = fetchPinnedBody(ref, fetchImpl, input.signal, input.requestTimeoutMs ?? 10_000);
    cache.set(ref.url, pending);
    return pending;
  };
  const forms: StaticFormControlAnalysis["forms"][number][] = new Array(refs.length);
  let cursor = 0;
  const concurrency = Math.min(input.concurrency ?? 4, refs.length);
  await Promise.all(Array.from({ length: concurrency }, async () => {
    for (;;) {
      const index = cursor++;
      if (index >= refs.length) return;
      const ref = refs[index]!;
      const body = await fetchOnce(ref);
      if (body.bytes.length !== ref.bytes || digest(body.bytes) !== ref.sha256) throw extractorError("FORM_SOURCE_HASH_MISMATCH");
      const analyzed = analyzePinnedStaticFormControlSource(ref, body.text);
      forms[index] = { ...analyzed, model_ids: ref.model_ids };
    }
  }));

  const analysis = staticFormControlAnalysisSchema.parse({
    schema_version: "1.6.0",
    catalog_kind: "STATIC_FORM_CONTROL_AST_EVIDENCE",
    evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    public_catalog_version: input.publicCatalogVersion,
    settings_inventory_version: input.settingsInventoryVersion,
    build_id: inventory.build.id,
    runtime_usable: false,
    forms,
    unbound_model_ids: unboundModelIds.sort(),
    limitations: [
      "Compiled vendor JavaScript is parsed as AST only and never executed.",
      "Static literal options/defaults are source candidates, not backend-accepted wire values or effective runtime defaults.",
      "Conditional guards and watch transformations are captured but not evaluated.",
      "Imported option modules outside these hash-pinned form files remain unresolved."
    ]
  });
  return analysis;
}

export function analyzePinnedStaticFormControlSource(
  ref: PinnedStaticFormSourceReference,
  text: string
): StaticFormControlAnalysis["forms"][number] {
  const source = loadAndVerifySource(ref, text);
  const controlNodes = findModelValueControls(source, ref.model_value_settings_keys);
  const conditionsByNode = new Map(controlNodes.map((node) => [node, conditionsFor(node, source)] as const));
  const controls = controlNodes.map((node) => analyzeControl(source, node, conditionsByNode.get(node) ?? []));
  const unresolvedControls = findUnresolvedModelValueControls(source, controlNodes, ref.model_value_settings_keys);
  const watchEffects = collectWatchEffects(source.file);
  const blockers = new Set<string>();
  if (controls.length === 0 && unresolvedControls.length === 0) blockers.add("NO_STATIC_MODEL_VALUE_CONTROL_FOUND");
  if (unresolvedControls.length > 0) blockers.add("UNRESOLVED_MODEL_VALUE_ROOTS_PRESENT");
  if (controls.some((control) => control.options_status === "UNRESOLVED_LOCAL_IMPORT")) blockers.add("LOCAL_OPTION_IMPORT_UNRESOLVED");
  if (controls.some((control) => control.conditions.length > 0)) blockers.add("CONDITIONAL_CONTROLS_NOT_EVALUATED");
  if (watchEffects.length > 0) blockers.add("WATCH_TRANSFORMS_NOT_EXECUTED");
  if (controls.some((control) => control.value_type === null)) blockers.add("CONTROL_VALUE_TYPE_UNKNOWN");
  return staticFormControlAnalysisSchema.shape.forms.element.parse({
    form_id: ref.form_id,
    module_name: ref.module_name,
    url: ref.url,
    bytes: ref.bytes,
    source_sha256: ref.sha256,
    parse_diagnostics: 0,
    control_structure_status: controls.length > 0 || unresolvedControls.length > 0 ? "CONTROLS_FOUND" : "UNRESOLVED_STRUCTURE",
    control_binding_key_source: ref.model_value_settings_keys && ref.model_value_settings_keys.length > 0
      ? "MAPLESS_MODEL_VALUE_KEY_LIST"
      : controls.length > 0 || unresolvedControls.length > 0 ? "DIRECT_SETTINGS_MODEL_VALUE_AST" : "NO_CONTROL_BINDINGS",
    settings3_store_binding: source.settings3StoreBinding,
    unresolved_model_value_controls: unresolvedControls,
    model_ids: [],
    local_imports: [...source.imports],
    controls,
    watch_effects: watchEffects,
    blockers: [...blockers].sort()
  });
}

function analyzeControl(
  source: SourceUnit,
  modelValue: ts.PropertyAssignment,
  conditions: StaticFormControlEvidence["conditions"]
): StaticFormControlEvidence {
  const binding = modelValueSettingBinding(source, modelValue.initializer);
  const field = binding.field;
  const propObject = ts.isObjectLiteralExpression(modelValue.parent) ? modelValue.parent : null;
  const props = propObject === null ? [] : propObject.properties.filter(ts.isPropertyAssignment);
  const getProp = (...names: string[]) => props.find((prop) => names.includes(propertyName(prop.name) ?? ""));
  const optionProp = getProp("options", "optionList", "option_list");
  const ratiosProp = getProp("ratios");
  const optionListProp = optionProp ?? ratiosProp;
  const optionChildren = readVNodeOptionChildren(source, modelValue);
  const optionValue: EvalResult = optionListProp === undefined ? { status: "NOT_PRESENT" } : evaluateOptionArray(optionListProp.initializer, source);
  const optionData = optionListProp === undefined
    ? extractVNodeOptions(optionChildren)
    : extractOptions(optionValue);
  const typeProp = getProp("type", "inputType", "input-type", "valueType");
  const declaredInputType = typeProp === undefined ? null : staticString(evaluateStatic(typeProp.initializer, source));
  const widgetProp = getProp("component", "componentName", "tag", "widget");
  const widget = widgetProp === undefined ? resolvedComponentName(source, modelValue) : staticString(evaluateStatic(widgetProp.initializer, source));
  const valueType = deriveValueType(declaredInputType, widget, optionData.valueType);
  const numericPropFacts = readNumericPropFacts(source, props, valueType);
  const numericConstraints = readNumericConstraints(source, props, valueType);
  const stringConstraints = readStringConstraints(source, props);
  const defaultProp = getProp("defaultValue", "default-value", "default");
  const defaultValue: EvalResult = defaultProp === undefined ? { status: "NOT_PRESENT" } : evaluateStatic(defaultProp.initializer, source);
  const literalDefault = projectDefault(defaultValue, defaultProp === undefined ? null : sourceLocation(source.file, defaultProp), field);
  const importRefs = optionValue.status === "UNRESOLVED_LOCAL_IMPORT" ? [optionValue.importRef] : [];
  const bindingKind = binding.kind === "DIRECT_SETTINGS_PROPERTY" &&
    source.settings3StoreBinding.status === "SETTINGS3_U_STORE_BOUND" &&
    settingsContextEvidence(source, modelValue).status === "IMPORTED_COMPONENT_HELPER_CHAIN"
      ? "DIRECT_COMPONENT_CONTEXT_SETTINGS_PROPERTY"
      : binding.kind;
  const context = controlSourceContext(source, modelValue, propObject, bindingKind);
  const unknownReasons: string[] = [];
  if (field === null) unknownReasons.push("MODEL_VALUE_NOT_BOUND_TO_SETTINGS_FIELD");
  if (optionData.status === "DYNAMIC") unknownReasons.push("OPTION_VALUES_DYNAMIC_OR_UNRESOLVED");
  if (importRefs.length > 0) unknownReasons.push("OPTION_VALUES_FROM_UNRESOLVED_LOCAL_IMPORT");
  if (valueType === null) unknownReasons.push("CONTROL_VALUE_TYPE_NOT_PROVEN");
  if (literalDefault.status === "UNRESOLVED") unknownReasons.push("CONTROL_DEFAULT_NOT_STATIC");
  return staticFormControlEvidenceSchema.parse({
    field: field ?? "unknown-control",
    binding_location: sourceLocation(source.file, modelValue),
    source_context: context,
    component_name: widget,
    declared_input_type: declaredInputType,
    value_type: valueType,
    options_status: optionData.status,
    option_values: optionData.values,
    option_children: optionChildren,
    options_nullable: optionData.values.some((option) => option.value === null),
    option_source_location: optionListProp === undefined ? null : sourceLocation(source.file, optionListProp),
    option_source_binding: optionListProp === undefined
      ? { property_name: null, expression_kind: null, identifier: null, property_path: [], import_ref: null }
      : optionSourceBinding(source, optionListProp),
    option_import_refs: importRefs,
    numeric_constraints: numericConstraints,
    numeric_prop_facts: numericPropFacts,
    string_constraints: stringConstraints,
    literal_default: literalDefault,
    conditions,
    unknown_reasons: unknownReasons
  });
}

function loadAndVerifySource(ref: PinnedStaticFormSourceReference, text: string): SourceUnit {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(ref.form_id) || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(ref.module_name) ||
      !Number.isSafeInteger(ref.bytes) || ref.bytes < 1 || ref.bytes > MAX_FORM_BYTES ||
      !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) throw extractorError("FORM_SOURCE_BINDING_INVALID");
  let url: URL;
  try { url = new URL(ref.url); } catch { throw extractorError("FORM_SOURCE_BINDING_INVALID"); }
  if (url.protocol !== "https:" || url.hostname !== "syntx.ai" || url.username || url.password || url.search || url.hash ||
      !new RegExp(`^/assets/[0-9]{6,20}/${escapeRegex(ref.module_name)}$`, "u").test(url.pathname)) {
    throw extractorError("FORM_SOURCE_BINDING_INVALID");
  }
  const bytes = Buffer.from(text, "utf8");
  if (bytes.length !== ref.bytes || digest(bytes) !== ref.sha256) throw extractorError("FORM_SOURCE_HASH_MISMATCH");
  const file = ts.createSourceFile(ref.module_name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics ?? [];
  if (diagnostics.length > 0) throw extractorError("FORM_AST_PARSE_FAILED");
  const consts = new Map<string, { initializer: ts.Expression; scope: ts.Node; position: number }[]>();
  const imports = new Map<string, StaticFormControlAnalysis["forms"][number]["local_imports"][number]>();
  const importRows: StaticFormControlAnalysis["forms"][number]["local_imports"][number][] = [];
  function lexicalScope(node: ts.Node): ts.Node {
    for (let parent = node.parent; parent !== undefined; parent = parent.parent) {
      if (ts.isSourceFile(parent) || ts.isBlock(parent) || ts.isFunctionLike(parent) ||
          ts.isForStatement(parent) || ts.isForInStatement(parent) || ts.isForOfStatement(parent) ||
          ts.isCatchClause(parent) || ts.isModuleBlock(parent)) return parent;
    }
    return file;
  }
  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      const rows = consts.get(node.name.text) ?? [];
      rows.push({ initializer: node.initializer, scope: lexicalScope(node), position: node.getStart(file) });
      consts.set(node.name.text, rows);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  for (const statement of file.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteralLike(statement.moduleSpecifier)) {
      const specifier = safeImportSpecifier(statement.moduleSpecifier.text);
      if (specifier === null) continue;
      const clause = statement.importClause;
      if (clause?.name) {
        const row = { specifier, imported_name: "default", local_name: clause.name.text, location: sourceLocation(file, statement) };
        imports.set(clause.name.text, row);
        importRows.push(row);
      }
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const element of clause.namedBindings.elements) {
          const local = element.name.text;
          const imported = element.propertyName?.text ?? local;
          const row = { specifier, imported_name: imported, local_name: local, location: sourceLocation(file, element) };
          imports.set(local, row);
          importRows.push(row);
        }
      }
      if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) {
        const local = clause.namedBindings.name.text;
        const row = { specifier, imported_name: "*", local_name: local, location: sourceLocation(file, statement) };
        imports.set(local, row);
        importRows.push(row);
      }
    }
  }
  const sourceBase = {
    ref, text, file, imports: importRows, importsByLocal: imports, consts,
    settings3StoreBinding: emptySettings3StoreBinding()
  };
  const provisional: SourceUnit = sourceBase;
  return { ...sourceBase, settings3StoreBinding: analyzeSettings3StoreBinding(provisional) };
}

function emptySettings3StoreBinding(): SourceUnit["settings3StoreBinding"] {
  return {
    status: "NO_SETTINGS3_U_STORE",
    module_specifier: null,
    imported_name: null,
    local_name: null,
    call_location: null,
    operation_modality: null,
    ai_name: null,
    returned_methods: [],
    settings_root_status: "NO_SETTINGS_REFERENCE",
    initial_factory_fallbacks: [],
    blockers: ["SETTINGS3_U_STORE_NOT_FOUND"]
  };
}

function analyzeSettings3StoreBinding(source: SourceUnit): SourceUnit["settings3StoreBinding"] {
  const importBinding = source.imports.find((row) => row.specifier === "./settings3.js" && row.imported_name === "u");
  if (!importBinding) return emptySettings3StoreBinding();
  const storeLocalName = importBinding.local_name;
  const calls: ts.CallExpression[] = [];
  function findCalls(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === storeLocalName) calls.push(node);
    ts.forEachChild(node, findCalls);
  }
  findCalls(source.file);
  if (calls.length !== 1) {
    return {
      ...emptySettings3StoreBinding(),
      status: "UNRESOLVED_SETTINGS3_STORE_CALL",
      module_specifier: importBinding.specifier,
      imported_name: importBinding.imported_name,
      local_name: importBinding.local_name,
      settings_root_status: settingsRootStatus(source),
      blockers: ["SETTINGS3_U_STORE_CALL_NOT_UNIQUE"]
    };
  }
  const call = calls[0]!;
  const modalityValue = call.arguments[0] ? evaluateStatic(call.arguments[0], source) : { status: "DYNAMIC" as const };
  const aiNameValue = call.arguments[1] ? evaluateStatic(call.arguments[1], source) : { status: "DYNAMIC" as const };
  const modality = (modalityValue.status === "STATIC_LITERAL" || modalityValue.status === "STATIC_LOCAL_CONSTANT") &&
    (modalityValue.value === "image" || modalityValue.value === "video") ? modalityValue.value : null;
  const aiName = (aiNameValue.status === "STATIC_LITERAL" || aiNameValue.status === "STATIC_LOCAL_CONSTANT") &&
    typeof aiNameValue.value === "string" ? aiNameValue.value : null;
  const defaultsArgument = call.arguments[2];
  const defaultsExpression = defaultsArgument && ts.isIdentifier(defaultsArgument)
    ? resolveConstantInitializer(source, defaultsArgument.text, call)
    : defaultsArgument;
  const fallbackRows: SourceUnit["settings3StoreBinding"]["initial_factory_fallbacks"][number][] = [];
  if (defaultsExpression && ts.isObjectLiteralExpression(defaultsExpression)) {
    for (const property of defaultsExpression.properties) {
      if (!ts.isPropertyAssignment(property)) continue;
      const field = propertyName(property.name);
      if (field === null || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field)) continue;
      const result = evaluateStatic(property.initializer, source);
      const staticResult = result.status === "STATIC_LITERAL" || result.status === "STATIC_LOCAL_CONSTANT";
      const isEmptyArray = ts.isArrayLiteralExpression(property.initializer) && property.initializer.elements.length === 0;
      const kind = ts.isConditionalExpression(property.initializer) ? "CONDITIONAL"
        : isEmptyArray ? "EMPTY_ARRAY"
        : staticResult && isScalar(result.value) ? "SCALAR"
        : staticResult ? "COMPLEX"
        : "DYNAMIC";
      fallbackRows.push({
        field,
        value_status: ts.isConditionalExpression(property.initializer) || !staticResult
          ? "CONDITIONAL_OR_DYNAMIC"
          : result.status,
        value_kind: kind,
        value: staticResult && isScalar(result.value) ? result.value : null,
        source_location: sourceLocation(source.file, property)
      });
    }
  }
  const returnedMethods: SourceUnit["settings3StoreBinding"]["returned_methods"][number][] = [];
  function findDestructuredMethods(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isObjectBindingPattern(node.name) && node.initializer === call) {
      for (const element of node.name.elements) {
        if (!ts.isBindingElement(element)) continue;
        const method = element.propertyName && (ts.isIdentifier(element.propertyName) || ts.isStringLiteralLike(element.propertyName))
          ? element.propertyName.text
          : ts.isIdentifier(element.name) ? element.name.text : null;
        if (method && ts.isIdentifier(element.name) && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(method)) {
          returnedMethods.push({ method_name: method, local_name: element.name.text });
        }
      }
    }
    ts.forEachChild(node, findDestructuredMethods);
  }
  findDestructuredMethods(source.file);
  const rootStatus = settingsRootStatus(source);
  return {
    status: modality !== null && aiName !== null && defaultsExpression && ts.isObjectLiteralExpression(defaultsExpression)
      ? "SETTINGS3_U_STORE_BOUND"
      : "UNRESOLVED_SETTINGS3_STORE_CALL",
    module_specifier: importBinding.specifier,
    imported_name: importBinding.imported_name,
    local_name: importBinding.local_name,
    call_location: sourceLocation(source.file, call),
    operation_modality: modality,
    ai_name: aiName,
    returned_methods: returnedMethods.sort((left, right) => left.method_name.localeCompare(right.method_name)),
    settings_root_status: rootStatus,
    initial_factory_fallbacks: fallbackRows,
    blockers: [
      ...(modality === null ? ["SETTINGS3_OPERATION_MODALITY_UNRESOLVED"] : []),
      ...(aiName === null ? ["SETTINGS3_AI_NAME_UNRESOLVED"] : []),
      ...(!defaultsExpression || !ts.isObjectLiteralExpression(defaultsExpression) ? ["SETTINGS3_INITIAL_FALLBACK_MAP_UNRESOLVED"] : []),
      ...(rootStatus === "UNRESOLVED_GLOBAL_IDENTIFIER" ? ["SETTINGS_ROOT_GLOBAL_IDENTIFIER_UNRESOLVED"] : [])
    ]
  };
}

function settingsRootStatus(source: SourceUnit): SourceUnit["settings3StoreBinding"]["settings_root_status"] {
  let references = 0;
  let lexicalBinding = source.importsByLocal.has("settings");
  let componentContext = false;
  function visit(node: ts.Node): void {
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "settings") {
      references += 1;
    }
    if (ts.isPropertyAccessExpression(node) && node.name.text === "settings") {
      if (ts.isCallExpression(node.expression) && ts.isIdentifier(node.expression.expression)) {
        const helper = source.importsByLocal.get(node.expression.expression.text);
        if (helper?.specifier === "./app.js") componentContext = true;
      }
    }
    if (ts.isVariableDeclaration(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === "settings") lexicalBinding = true;
      if (ts.isObjectBindingPattern(node.name) && node.name.elements.some((element) =>
        ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === "settings"
      )) lexicalBinding = true;
    }
    if (ts.isParameter(node)) {
      if (ts.isIdentifier(node.name) && node.name.text === "settings") lexicalBinding = true;
      if (ts.isObjectBindingPattern(node.name) && node.name.elements.some((element) =>
        ts.isBindingElement(element) && ts.isIdentifier(element.name) && element.name.text === "settings"
      )) lexicalBinding = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(source.file);
  return lexicalBinding ? "LEXICAL_BINDING_FOUND"
    : componentContext ? "COMPONENT_CONTEXT_HELPER_CHAIN_UNRESOLVED"
    : references > 0 ? "UNRESOLVED_GLOBAL_IDENTIFIER"
    : "NO_SETTINGS_REFERENCE";
}

function settingsContextEvidence(
  source: SourceUnit,
  modelValue: ts.PropertyAssignment
): StaticFormControlEvidence["source_context"]["settings_context_evidence"] {
  const expression = modelValue.initializer;
  const settingsAccess = ts.isPropertyAccessExpression(expression) ? expression.expression : null;
  if (!settingsAccess || !ts.isPropertyAccessExpression(settingsAccess) || settingsAccess.name.text !== "settings" ||
      !ts.isCallExpression(settingsAccess.expression) || !ts.isIdentifier(settingsAccess.expression.expression)) {
    return {
      status: "NOT_OBSERVED",
      helper_import: null,
      helper_call_location: null,
      context_argument_identifier: null,
      context_argument_origin_import: null
    };
  }
  const call = settingsAccess.expression;
  const helperName = ts.isIdentifier(call.expression) ? call.expression.text : null;
  const helperBinding = helperName === null ? undefined : source.importsByLocal.get(helperName);
  const contextArg = call.arguments[0];
  const contextName = contextArg && ts.isIdentifier(contextArg) ? contextArg.text : null;
  const contextInitializer = contextName === null ? null : resolveConstantInitializer(source, contextName, call);
  const originCall = contextInitializer && ts.isCallExpression(contextInitializer) && ts.isIdentifier(contextInitializer.expression)
    ? contextInitializer
    : null;
  const originName = originCall && ts.isIdentifier(originCall.expression) ? originCall.expression.text : null;
  const originBinding = originName === null ? undefined : source.importsByLocal.get(originName);
  return {
    status: helperBinding?.specifier === "./app.js" ? "IMPORTED_COMPONENT_HELPER_CHAIN" : "DIRECT_OR_OTHER_SETTINGS_REFERENCE",
    helper_import: helperBinding === undefined ? null : publicImportBinding(helperBinding),
    helper_call_location: sourceLocation(source.file, call),
    context_argument_identifier: contextName,
    context_argument_origin_import: originBinding === undefined ? null : publicImportBinding(originBinding)
  };
}

function findModelValueControls(source: SourceUnit, allowedSettingsKeys?: readonly string[]): ts.PropertyAssignment[] {
  const controls: ts.PropertyAssignment[] = [];
  const allowed = allowedSettingsKeys === undefined || allowedSettingsKeys.length === 0 ? null : new Set(allowedSettingsKeys);
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ["modelValue", "model-value"].includes(propertyName(node.name) ?? "")) {
      const field = modelValueSettingBinding(source, node.initializer).field;
      if (field !== null && (allowed === null || allowed.has(field))) controls.push(node);
    }
    ts.forEachChild(node, visit);
  }
  visit(source.file);
  return controls;
}

function findUnresolvedModelValueControls(
  source: SourceUnit,
  recognized: readonly ts.PropertyAssignment[],
  allowedSettingsKeys?: readonly string[]
): StaticFormControlAnalysis["forms"][number]["unresolved_model_value_controls"] {
  const recognizedNodes = new Set(recognized);
  const allowlist = allowedSettingsKeys && allowedSettingsKeys.length > 0 ? new Set(allowedSettingsKeys) : null;
  const rows: StaticFormControlAnalysis["forms"][number]["unresolved_model_value_controls"] = [];
  function visit(node: ts.Node): void {
    if (!ts.isPropertyAssignment(node) || !["modelValue", "model-value"].includes(propertyName(node.name) ?? "") ||
        recognizedNodes.has(node) || findRenderingCall(node) === null) {
      ts.forEachChild(node, visit);
      return;
    }
    const binding = modelValueSettingBinding(source, node.initializer);
    const expression = expressionPath(node.initializer);
    const rootIdentifier = expression[0] ?? null;
    const props = ts.isObjectLiteralExpression(node.parent) ? node.parent.properties.filter(ts.isPropertyAssignment) : [];
    const literalName = props.find((property) => propertyName(property.name) === "name");
    const nameResult = literalName ? evaluateStatic(literalName.initializer, source) : { status: "NOT_PRESENT" as const };
    const literalNameValue = (nameResult.status === "STATIC_LITERAL" || nameResult.status === "STATIC_LOCAL_CONSTANT") &&
      typeof nameResult.value === "string" ? nameResult.value : null;
    const context = controlSourceContext(source, node, ts.isObjectLiteralExpression(node.parent) ? node.parent : null, binding.kind);
    const numericProps = props.flatMap((property) => {
      const name = propertyName(property.name);
      if (!["min", "max", "step"].includes(name ?? "")) return [];
      const value = evaluateStatic(property.initializer, source);
      return (value.status === "STATIC_LITERAL" || value.status === "STATIC_LOCAL_CONSTANT") && isScalar(value.value)
        ? [{ name: name!, value: value.value, source_location: sourceLocation(source.file, property) }]
        : [];
    });
    const collectionSource = rootIdentifier === null ? null : callbackCollectionSource(node, rootIdentifier);
    rows.push({
      location: sourceLocation(source.file, node),
      expression_kind: ts.SyntaxKind[node.initializer.kind],
      expression_path: expression,
      root_identifier: rootIdentifier,
      collection_source_path: collectionSource?.path ?? [],
      collection_source_settings_field: collectionSource?.settings_field ?? null,
      nested_property_path: collectionSource?.nested_path ?? [],
      component_name: resolvedComponentName(source, node),
      component_import: context.component_import,
      component_resolver_import: context.component_resolver_import,
      property_names: props.map((property) => propertyName(property.name)).filter((name): name is string => name !== null),
      literal_name_property: literalNameValue,
      numeric_props: numericProps,
      conditions: conditionsFor(node, source),
      reason: binding.field !== null && allowlist !== null && !allowlist.has(binding.field)
        ? "SETTINGS_FIELD_NOT_IN_MAPLESS_ALLOWLIST"
        : rootIdentifier === "settings" ? "MODEL_VALUE_ROOT_ORIGIN_UNRESOLVED" : "NON_SETTINGS_UI_CONTROL"
    });
    ts.forEachChild(node, visit);
  }
  visit(source.file);
  return rows;
}

function callbackCollectionSource(
  modelValue: ts.PropertyAssignment,
  parameterName: string
): { path: string[]; settings_field: string | null; nested_path: string[] } | null {
  let callback: ts.FunctionLikeDeclaration | null = null;
  for (let current: ts.Node | undefined = modelValue; current !== undefined; current = current.parent) {
    if (isFunctionLikeWithBody(current) && current.parameters.some((parameter) =>
      ts.isIdentifier(parameter.name) && parameter.name.text === parameterName
    )) {
      callback = current;
      break;
    }
  }
  if (callback === null) return null;
  for (let parent: ts.Node | undefined = callback.parent; parent !== undefined; parent = parent.parent) {
    if (!ts.isCallExpression(parent)) continue;
    const index = parent.arguments.findIndex((argument) => argument === callback);
    const collection = index > 0
      ? parent.arguments[0]
      : index === 0 && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === "map"
        ? parent.expression.expression
        : undefined;
    if (index < 0 || !collection) continue;
    return {
      path: expressionPath(collection),
      settings_field: directSettingsField(collection),
      nested_path: expressionPath(modelValue.initializer).slice(1)
    };
  }
  return null;
}

function controlSourceContext(
  source: SourceUnit,
  modelValue: ts.PropertyAssignment,
  propObject: ts.ObjectLiteralExpression | null,
  bindingKind: StaticFormControlEvidence["source_context"]["setting_binding_kind"]
): StaticFormControlEvidence["source_context"] {
  let renderCall: ts.CallExpression | null = null;
  if (propObject !== null) {
    for (let current: ts.Node | undefined = propObject.parent; current !== undefined; current = current.parent) {
      if (ts.isCallExpression(current) && current.arguments.some((argument) => argument === propObject)) {
        renderCall = current;
        break;
      }
    }
  }
  const component = renderCall?.arguments[0];
  const nestedComponent = component && ts.isCallExpression(component) ? component.arguments[0] : undefined;
  const componentLocal = component && ts.isIdentifier(component) ? component
    : nestedComponent && ts.isIdentifier(nestedComponent) ? nestedComponent
    : undefined;
  const componentLocalName = componentLocal?.text ?? null;
  const binding = componentLocalName === null ? undefined : source.importsByLocal.get(componentLocalName);
  const helperLocalName = renderCall && ts.isIdentifier(renderCall.expression) ? renderCall.expression.text : null;
  const helperBinding = helperLocalName === null ? undefined : source.importsByLocal.get(helperLocalName);
  const resolverCallee = component && ts.isCallExpression(component) && ts.isIdentifier(component.expression)
    ? source.importsByLocal.get(component.expression.text)
    : undefined;
  const modelValuePath = expressionPath(modelValue.initializer);
  const settingsIndex = modelValuePath.lastIndexOf("settings");
  const rootIdentifier = settingsIndex >= 0
    ? modelValuePath[settingsIndex] ?? null
    : ts.isPropertyAccessExpression(modelValue.initializer) && modelValue.initializer.name.text === "value" && ts.isIdentifier(modelValue.initializer.expression)
      ? modelValue.initializer.expression.text
      : modelValuePath[0] ?? null;
  const rootStatus = settingsIndex >= 0
    ? source.settings3StoreBinding.settings_root_status === "NO_SETTINGS_REFERENCE"
      ? "NOT_SETTINGS_REFERENCE"
      : source.settings3StoreBinding.settings_root_status === "NOT_CHECKED"
        ? "UNRESOLVED_GLOBAL_IDENTIFIER"
      : source.settings3StoreBinding.settings_root_status
    : bindingKind === "COMPUTED_GETTER" || bindingKind === "COMPUTED_GETTER_TRANSFORMED"
      ? "LEXICAL_BINDING_FOUND"
      : "UNRESOLVED_GLOBAL_IDENTIFIER";
  return {
    setting_binding_kind: bindingKind,
    settings_root_status: rootStatus,
    setting_root_identifier: rootIdentifier,
    render_call_location: renderCall === null ? null : sourceLocation(source.file, renderCall),
    render_helper: renderCall === null ? null : expressionName(renderCall.expression),
    render_helper_import: helperBinding === undefined ? null : publicImportBinding(helperBinding),
    component_local_name: componentLocalName,
    component_import: binding === undefined ? null : publicImportBinding(binding),
    component_resolver_import: resolverCallee === undefined
      ? component === undefined || renderCall === null ? null : componentResolverImport(source, component, renderCall)
      : publicImportBinding(resolverCallee),
    props_argument_index: renderCall === null || propObject === null
      ? null
      : (() => {
          const index = renderCall.arguments.findIndex((argument) => argument === propObject);
          return index < 0 ? null : index;
        })(),
    sibling_property_names: propObject === null
      ? []
      : propObject.properties.filter(ts.isPropertyAssignment).map((property) => propertyName(property.name)).filter((name): name is string => name !== null),
    settings_context_evidence: settingsContextEvidence(source, modelValue)
  };
}

function isFunctionLikeWithBody(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) ||
    ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node);
}

function optionSourceBinding(
  source: SourceUnit,
  property: ts.PropertyAssignment
): StaticFormControlEvidence["option_source_binding"] {
  const initializer = property.initializer;
  const localImport = ts.isIdentifier(initializer) ? source.importsByLocal.get(initializer.text) : undefined;
  return {
    property_name: propertyName(property.name),
    expression_kind: ts.SyntaxKind[initializer.kind],
    identifier: ts.isIdentifier(initializer) ? initializer.text : null,
    property_path: expressionPath(initializer),
    import_ref: localImport?.specifier ?? null
  };
}

function publicImportBinding(
  binding: StaticFormControlAnalysis["forms"][number]["local_imports"][number]
): { specifier: string; imported_name: string; local_name: string } {
  return { specifier: binding.specifier, imported_name: binding.imported_name, local_name: binding.local_name };
}

function componentResolverImport(
  source: SourceUnit,
  component: ts.Expression,
  use: ts.Node
): { specifier: string; imported_name: string; local_name: string } | null {
  if (!ts.isIdentifier(component)) return null;
  const initializer = resolveConstantInitializer(source, component.text, use);
  if (!initializer || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) return null;
  const binding = source.importsByLocal.get(initializer.expression.text);
  return binding === undefined ? null : publicImportBinding(binding);
}

function modelValueSettingBinding(
  source: SourceUnit,
  expression: ts.Expression
): { field: string | null; kind: StaticFormControlEvidence["source_context"]["setting_binding_kind"] } {
  const directPath = expressionPath(expression);
  const settingsIndex = directPath.lastIndexOf("settings");
  const directField = directPath[settingsIndex + 1];
  if (settingsIndex >= 0 && settingsIndex === directPath.length - 2 &&
      directField !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(directField)) {
    return { field: directField, kind: "DIRECT_SETTINGS_PROPERTY" };
  }
  if (!ts.isPropertyAccessExpression(expression) || expression.name.text !== "value" ||
      !ts.isIdentifier(expression.expression)) return { field: null, kind: "UNRESOLVED" };
  const getter = getterExpression(source, expression.expression.text, expression);
  const direct = directSettingsField(getter);
  if (direct !== null) return { field: direct, kind: "COMPUTED_GETTER" };
  if (getter === null || !ts.isConditionalExpression(getter)) return { field: null, kind: "UNRESOLVED" };
  const fields = new Set<string>();
  function collectBranches(node: ts.Expression): void {
    if (ts.isConditionalExpression(node)) {
      collectBranches(node.whenTrue);
      collectBranches(node.whenFalse);
      return;
    }
    function collectAccess(current: ts.Node): void {
      if (ts.isExpression(current)) {
        const field = directSettingsField(current);
        if (field !== null) fields.add(field);
      }
      ts.forEachChild(current, collectAccess);
    }
    collectAccess(node);
  }
  collectBranches(getter);
  return fields.size === 1 ? { field: [...fields][0]!, kind: "COMPUTED_GETTER_TRANSFORMED" } : { field: null, kind: "UNRESOLVED" };
}

function getterExpression(source: SourceUnit, refName: string, use: ts.Node): ts.Expression | null {
  const initializer = resolveConstantInitializer(source, refName, use);
  const options = initializer && ts.isCallExpression(initializer) ? initializer.arguments[0] : undefined;
  if (!initializer || !ts.isCallExpression(initializer) || !options) return null;
  if (ts.isArrowFunction(options)) {
    if (ts.isExpression(options.body)) return options.body;
    const returns = options.body.statements.filter(ts.isReturnStatement);
    return returns.length === 1 && returns[0]?.expression ? returns[0].expression : null;
  }
  if (!ts.isObjectLiteralExpression(options)) return null;
  const getter = options.properties.find((property) => ts.isPropertyAssignment(property) && propertyName(property.name) === "get");
  if (!getter || !ts.isPropertyAssignment(getter) || !ts.isArrowFunction(getter.initializer)) return null;
  if (ts.isExpression(getter.initializer.body)) return getter.initializer.body;
  const returns = getter.initializer.body.statements.filter(ts.isReturnStatement);
  return returns.length === 1 && returns[0]?.expression ? returns[0].expression : null;
}

function directSettingsField(expression: ts.Expression | null): string | null {
  if (expression === null) return null;
  const path = expressionPath(expression);
  const index = path.lastIndexOf("settings");
  const field = path[index + 1];
  return index >= 0 && index === path.length - 2 && field !== undefined &&
    /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field) ? field : null;
}

function settingFieldFromExpression(source: SourceUnit, expression: ts.Expression): string | null {
  const direct = directSettingsField(expression);
  if (direct !== null) return direct;
  if (ts.isPropertyAccessExpression(expression) && expression.name.text === "value" && ts.isIdentifier(expression.expression)) {
    return directSettingsField(getterExpression(source, expression.expression.text, expression));
  }
  return null;
}

function resolveConstantInitializer(source: SourceUnit, name: string, use: ts.Node): ts.Expression | null {
  const rows = source.consts.get(name);
  if (!rows) return null;
  const scopes: ts.Node[] = [];
  for (let current: ts.Node | undefined = use; current !== undefined; current = current.parent) {
    if (ts.isSourceFile(current) || ts.isBlock(current) || ts.isFunctionLike(current) ||
        ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current) ||
        ts.isCatchClause(current) || ts.isModuleBlock(current)) scopes.push(current);
  }
  const candidates = rows.filter((row) => scopes.includes(row.scope) && row.position < use.getStart(source.file))
    .sort((left, right) => scopes.indexOf(left.scope) - scopes.indexOf(right.scope));
  return candidates[0]?.initializer ?? null;
}

function resolvedComponentName(source: SourceUnit, modelValue: ts.PropertyAssignment): string | null {
  const call = findRenderingCall(modelValue);
  return call === null ? null : resolvedComponentTag(source, call.arguments[0], call);
}

function resolvedComponentTag(source: SourceUnit, component: ts.Expression | undefined, use: ts.Node): string | null {
  if (!component) return null;
  const expression = ts.isIdentifier(component) ? resolveConstantInitializer(source, component.text, use) : component;
  if (!expression || !ts.isCallExpression(expression)) return null;
  const first = expression.arguments[0];
  if (first && ts.isStringLiteralLike(first)) return first.text;
  return ts.isIdentifier(component) ? source.importsByLocal.get(component.text)?.imported_name ?? null : null;
}

function readVNodeOptionChildren(
  source: SourceUnit,
  modelValue: ts.PropertyAssignment
): StaticFormControlEvidence["option_children"] {
  const call = findRenderingCall(modelValue);
  const props = ts.isObjectLiteralExpression(modelValue.parent) ? modelValue.parent : null;
  if (call === null || props === null) return [];
  const propsIndex = call.arguments.findIndex((argument) => argument === props);
  if (propsIndex < 0) return [];
  const children: StaticFormControlEvidence["option_children"] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && node.arguments[1] && ts.isObjectLiteralExpression(node.arguments[1])) {
      const valueProp = node.arguments[1].properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "value"
      );
      if (valueProp && ts.isPropertyAssignment(valueProp)) {
        const component = node.arguments[0];
        const localName = component && ts.isIdentifier(component) ? component.text : null;
        const importBinding = localName === null ? undefined : source.importsByLocal.get(localName);
        const resolverBinding = component === undefined ? null : componentResolverImport(source, component, node);
        const evaluated = evaluateStatic(valueProp.initializer, source);
        const scalarValue = (evaluated.status === "STATIC_LITERAL" || evaluated.status === "STATIC_LOCAL_CONSTANT") &&
          isScalar(evaluated.value) ? evaluated.value : null;
        children.push({
          location: sourceLocation(source.file, node),
          component_local_name: localName,
          component_import: importBinding === undefined ? null : {
            ...publicImportBinding(importBinding)
          },
          component_resolver_import: resolverBinding,
          resolved_component_name: resolvedComponentTag(source, component, node),
          value_status: evaluated.status === "STATIC_LITERAL" || evaluated.status === "STATIC_LOCAL_CONSTANT"
            ? scalarValue === null && evaluated.value !== null ? "DYNAMIC" : evaluated.status
            : evaluated.status === "UNRESOLVED_LOCAL_IMPORT" ? "UNRESOLVED_LOCAL_IMPORT" : "DYNAMIC",
          value: scalarValue,
          value_expression_kind: ts.SyntaxKind[valueProp.initializer.kind],
          value_identifier: ts.isIdentifier(valueProp.initializer) ? valueProp.initializer.text : null,
          value_property_path: expressionPath(valueProp.initializer)
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  for (let index = propsIndex + 1; index < call.arguments.length; index += 1) {
    visit(call.arguments[index]!);
  }
  return children;
}

function extractVNodeOptions(children: StaticFormControlEvidence["option_children"]): {
  status: StaticFormControlEvidence["options_status"];
  values: StaticFormControlEvidence["option_values"];
  imports: string[];
  valueType: StaticFormControlEvidence["value_type"];
} {
  if (children.length === 0) return { status: "NOT_PRESENT", values: [], imports: [], valueType: null };
  if (children.some((child) => child.resolved_component_name !== "el-option" ||
      (child.value_status !== "STATIC_LITERAL" && child.value_status !== "STATIC_LOCAL_CONSTANT"))) {
    return { status: "DYNAMIC", values: [], imports: [], valueType: null };
  }
  const values = children.map((child) => ({ value: child.value, label: null }));
  if (values.some((option) => option.value === null)) {
    // Null is a real static UI choice; it is retained as evidence but not promoted to the non-null generation property schema.
  }
  return {
    status: "STATIC_VNODE_CHILDREN",
    values,
    imports: [],
    valueType: scalarType(values.map((option) => option.value).filter((value) => value !== null))
  };
}

function findRenderingCall(modelValue: ts.PropertyAssignment): ts.CallExpression | null {
  const object = ts.isObjectLiteralExpression(modelValue.parent) ? modelValue.parent : null;
  if (object === null) return null;
  for (let current: ts.Node | undefined = object.parent; current !== undefined; current = current.parent) {
    if (ts.isCallExpression(current) && current.arguments.some((argument) => argument === object)) return current;
  }
  return null;
}

function evaluateStatic(expression: ts.Expression, source: SourceUnit, active = new Set<string>(), depth = 0): EvalResult {
  if (depth > 8) return { status: "DYNAMIC" };
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    return evaluateStatic(expression.expression, source, active, depth + 1);
  }
  if (ts.isStringLiteralLike(expression)) return { status: "STATIC_LITERAL", value: expression.text };
  if (ts.isNumericLiteral(expression)) return { status: "STATIC_LITERAL", value: Number(expression.text) };
  if (expression.kind === ts.SyntaxKind.TrueKeyword) return { status: "STATIC_LITERAL", value: true };
  if (expression.kind === ts.SyntaxKind.FalseKeyword) return { status: "STATIC_LITERAL", value: false };
  if (expression.kind === ts.SyntaxKind.NullKeyword) return { status: "STATIC_LITERAL", value: null };
  if (ts.isPrefixUnaryExpression(expression) && [ts.SyntaxKind.MinusToken, ts.SyntaxKind.PlusToken].includes(expression.operator) && ts.isNumericLiteral(expression.operand)) {
    const number = Number(expression.operand.text) * (expression.operator === ts.SyntaxKind.MinusToken ? -1 : 1);
    return Number.isFinite(number) ? { status: "STATIC_LITERAL", value: number } : { status: "DYNAMIC" };
  }
  if (ts.isPrefixUnaryExpression(expression) && expression.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = evaluateStatic(expression.operand, source, active, depth + 1);
    if (operand.status === "STATIC_LITERAL" || operand.status === "STATIC_LOCAL_CONSTANT") {
      return { status: operand.status, value: !operand.value };
    }
    return operand;
  }
  if (ts.isIdentifier(expression)) {
    const imported = source.importsByLocal.get(expression.text);
    if (imported !== undefined) return { status: "UNRESOLVED_LOCAL_IMPORT", importRef: imported.specifier };
    const initializer = resolveConstantInitializer(source, expression.text, expression);
    const activeKey = expression.text + "@" + expression.getStart(source.file);
    if (!initializer || active.has(activeKey)) return { status: "DYNAMIC" };
    const next = new Set(active);
    next.add(activeKey);
    const value = evaluateStatic(initializer, source, next, depth + 1);
    return value.status === "STATIC_LITERAL" || value.status === "STATIC_LOCAL_CONSTANT"
      ? { status: "STATIC_LOCAL_CONSTANT", value: value.value }
      : value;
  }
  if (ts.isArrayLiteralExpression(expression) && expression.elements.length <= 256) {
    const items: StaticValue[] = [];
    let local = false;
    for (const element of expression.elements) {
      if (ts.isSpreadElement(element)) return { status: "DYNAMIC" };
      const result = evaluateStatic(element, source, active, depth + 1);
      if (result.status !== "STATIC_LITERAL" && result.status !== "STATIC_LOCAL_CONSTANT") return result;
      local ||= result.status === "STATIC_LOCAL_CONSTANT";
      items.push(result.value);
    }
    return { status: local ? "STATIC_LOCAL_CONSTANT" : "STATIC_LITERAL", value: items };
  }
  if (ts.isObjectLiteralExpression(expression) && expression.properties.length <= 64) {
    const object: Record<string, StaticValue> = {};
    let local = false;
    for (const property of expression.properties) {
      if (!ts.isPropertyAssignment(property)) return { status: "DYNAMIC" };
      const key = propertyName(property.name);
      if (key === null) return { status: "DYNAMIC" };
      const result = evaluateStatic(property.initializer, source, active, depth + 1);
      if (result.status !== "STATIC_LITERAL" && result.status !== "STATIC_LOCAL_CONSTANT") return result;
      local ||= result.status === "STATIC_LOCAL_CONSTANT";
      object[key] = result.value;
    }
    return { status: local ? "STATIC_LOCAL_CONSTANT" : "STATIC_LITERAL", value: object };
  }
  return { status: "DYNAMIC" };
}

function extractOptions(value: EvalResult): {
  status: StaticFormControlEvidence["options_status"];
  values: StaticFormControlEvidence["option_values"];
  imports: string[];
  valueType: StaticFormControlEvidence["value_type"];
} {
  if (value.status === "NOT_PRESENT") return { status: "NOT_PRESENT", values: [], imports: [], valueType: null };
  if (value.status === "UNRESOLVED_LOCAL_IMPORT") return { status: "UNRESOLVED_LOCAL_IMPORT", values: [], imports: [value.importRef], valueType: null };
  if (value.status === "DYNAMIC") return { status: "DYNAMIC", values: [], imports: [], valueType: null };
  if (!Array.isArray(value.value)) return { status: "DYNAMIC", values: [], imports: [], valueType: null };
  const options: StaticFormControlEvidence["option_values"] = [];
  for (const item of value.value) {
    if (isScalar(item)) options.push({ value: item, label: null });
    else if (isRecord(item) && isScalar(item.value)) {
      options.push({ value: item.value, label: typeof item.label === "string" ? item.label : null });
    } else return { status: "DYNAMIC", values: [], imports: [], valueType: null };
  }
  const valueType = scalarType(options.map((option) => option.value).filter((option) => option !== null));
  return {
    status: value.status === "STATIC_LOCAL_CONSTANT" ? "STATIC_LOCAL_CONSTANT" : "STATIC_LITERAL_ARRAY",
    values: options,
    imports: [],
    valueType
  };
}

function evaluateOptionArray(expression: ts.Expression, source: SourceUnit, active = new Set<string>(), depth = 0): EvalResult {
  if (depth > 8) return { status: "DYNAMIC" };
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) ||
      ts.isTypeAssertionExpression(expression) || ts.isSatisfiesExpression(expression) || ts.isNonNullExpression(expression)) {
    return evaluateOptionArray(expression.expression, source, active, depth + 1);
  }
  if (ts.isIdentifier(expression)) {
    const imported = source.importsByLocal.get(expression.text);
    if (imported) return { status: "UNRESOLVED_LOCAL_IMPORT", importRef: imported.specifier };
    const initializer = resolveConstantInitializer(source, expression.text, expression);
    const activeKey = expression.text + "@" + expression.getStart(source.file);
    if (!initializer || active.has(activeKey)) return { status: "DYNAMIC" };
    const nested = new Set(active);
    nested.add(activeKey);
    const result = evaluateOptionArray(initializer, source, nested, depth + 1);
    return result.status === "STATIC_LITERAL" || result.status === "STATIC_LOCAL_CONSTANT"
      ? { status: "STATIC_LOCAL_CONSTANT", value: result.value }
      : result;
  }
  if (!ts.isArrayLiteralExpression(expression) || expression.elements.length > 256) return { status: "DYNAMIC" };
  const items: StaticValue[] = [];
  let local = false;
  for (const element of expression.elements) {
    if (ts.isSpreadElement(element)) return { status: "DYNAMIC" };
    if (ts.isObjectLiteralExpression(element)) {
      const valueProp = element.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "value"
      );
      if (!valueProp || !ts.isPropertyAssignment(valueProp)) return { status: "DYNAMIC" };
      const value = evaluateStatic(valueProp.initializer, source, active, depth + 1);
      if (value.status !== "STATIC_LITERAL" && value.status !== "STATIC_LOCAL_CONSTANT") return value;
      const labelProp = element.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "label"
      ) ?? element.properties.find((property) =>
        ts.isPropertyAssignment(property) && propertyName(property.name) === "ratio"
      );
      const labelResult = labelProp && ts.isPropertyAssignment(labelProp)
        ? evaluateStatic(labelProp.initializer, source, active, depth + 1)
        : { status: "NOT_PRESENT" as const };
      const label = (labelResult.status === "STATIC_LITERAL" || labelResult.status === "STATIC_LOCAL_CONSTANT") &&
        typeof labelResult.value === "string" ? labelResult.value : null;
      local ||= value.status === "STATIC_LOCAL_CONSTANT";
      items.push({ value: value.value, label });
    } else {
      const value = evaluateStatic(element, source, active, depth + 1);
      if (value.status !== "STATIC_LITERAL" && value.status !== "STATIC_LOCAL_CONSTANT") return value;
      local ||= value.status === "STATIC_LOCAL_CONSTANT";
      items.push(value.value);
    }
  }
  return { status: local ? "STATIC_LOCAL_CONSTANT" : "STATIC_LITERAL", value: items };
}

function deriveValueType(
  declared: string | null,
  widget: string | null,
  optionsType: StaticFormControlEvidence["value_type"]
): StaticFormControlEvidence["value_type"] {
  const normalized = declared?.toLowerCase();
  let explicit: StaticFormControlEvidence["value_type"] =
    normalized === "number" ? "number" :
    normalized === "integer" ? "integer" :
    normalized === "string" || normalized === "text" || normalized === "textarea" ? "string" :
    normalized === "boolean" || normalized === "checkbox" || normalized === "switch" ? "boolean" : null;
  const component = widget?.toLowerCase() ?? "";
  if (explicit === null) {
    if (component.includes("input-number") || component.includes("slider")) explicit = "number";
    else if (component.includes("checkbox") || component.includes("switch")) explicit = "boolean";
  }
  if (explicit !== null && optionsType !== null && explicit !== optionsType) return null;
  return explicit ?? optionsType;
}

function readNumericConstraints(
  source: SourceUnit,
  properties: readonly ts.PropertyAssignment[],
  valueType: StaticFormControlEvidence["value_type"]
): StaticFormControlEvidence["numeric_constraints"] {
  const minimum = readNumericProperty(source, properties, ["min", "minValue", "min-value"]);
  const maximum = readNumericProperty(source, properties, ["max", "maxValue", "max-value"]);
  const step = readNumericProperty(source, properties, ["step"]);
  if (minimum === undefined && maximum === undefined && step === undefined) return null;
  if (valueType !== "number" && valueType !== "integer") return null;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) return null;
  return {
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(step === undefined || step <= 0 ? {} : { step })
  };
}

function readNumericPropFacts(
  source: SourceUnit,
  properties: readonly ts.PropertyAssignment[],
  valueType: StaticFormControlEvidence["value_type"]
): StaticFormControlEvidence["numeric_prop_facts"] {
  const names = ["min", "max", "step"];
  if (!properties.some((property) => names.includes(propertyName(property.name) ?? ""))) return null;
  const minimum = readNumericProperty(source, properties, ["min", "minValue", "min-value"]);
  const maximum = readNumericProperty(source, properties, ["max", "maxValue", "max-value"]);
  const step = readNumericProperty(source, properties, ["step"]);
  return {
    ...(minimum === undefined ? {} : { minimum }),
    ...(maximum === undefined ? {} : { maximum }),
    ...(step === undefined ? {} : { step }),
    caller_value_type_proven: valueType === "number" || valueType === "integer"
  };
}

function readStringConstraints(
  source: SourceUnit,
  properties: readonly ts.PropertyAssignment[]
): StaticFormControlEvidence["string_constraints"] {
  const minimum = readNumericProperty(source, properties, ["minLength", "minlength", "min-length"]);
  const maximum = readNumericProperty(source, properties, ["maxLength", "maxlength", "max-length"]);
  if (minimum === undefined && maximum === undefined) return null;
  if (minimum !== undefined && maximum !== undefined && minimum > maximum) return null;
  return {
    ...(minimum === undefined ? {} : { min_length: minimum }),
    ...(maximum === undefined ? {} : { max_length: maximum })
  };
}

function readNumericProperty(source: SourceUnit, properties: readonly ts.PropertyAssignment[], names: readonly string[]): number | undefined {
  const property = properties.find((candidate) => names.includes(propertyName(candidate.name) ?? ""));
  if (!property) return undefined;
  const value = evaluateStatic(property.initializer, source);
  return (value.status === "STATIC_LITERAL" || value.status === "STATIC_LOCAL_CONSTANT") &&
    typeof value.value === "number" && Number.isFinite(value.value) ? value.value : undefined;
}

function projectDefault(
  value: EvalResult,
  location: StaticFormControlEvidence["literal_default"]["source_location"],
  field: string | null
): StaticFormControlEvidence["literal_default"] {
  if (value.status === "NOT_PRESENT") return { status: "NOT_PRESENT", value: null, value_type: null, string_length: null, source_location: null, redacted: false };
  if (value.status === "UNRESOLVED_LOCAL_IMPORT") return { status: "UNRESOLVED", value: null, value_type: null, string_length: null, source_location: location, redacted: false };
  if (value.status === "DYNAMIC") return { status: "UNRESOLVED", value: null, value_type: null, string_length: null, source_location: location, redacted: false };
  const candidate = value.value;
  const redactString = field === "prompt" && typeof candidate === "string";
  const scalar = isScalar(candidate) ? candidate : null;
  const type = scalar === null ? null : scalarType([scalar]);
  return {
    status: value.status,
    value: redactString ? null : scalar,
    value_type: type,
    string_length: redactString ? candidate.length : null,
    source_location: location,
    redacted: redactString
  };
}

function conditionsFor(node: ts.Node, source: SourceUnit): StaticFormControlEvidence["conditions"] {
  const result: StaticFormControlEvidence["conditions"] = [];
  let child: ts.Node = node;
  for (let parent = node.parent; parent !== undefined; child = parent, parent = parent.parent) {
    if (ts.isIfStatement(parent)) {
      const branch = isDescendant(child, parent.thenStatement) ? "THEN" : parent.elseStatement && isDescendant(child, parent.elseStatement) ? "ELSE" : null;
      if (branch) result.push(...guardFacts(parent.expression, branch, source));
    } else if (ts.isConditionalExpression(parent)) {
      const branch = isDescendant(child, parent.whenTrue) ? "THEN" : isDescendant(child, parent.whenFalse) ? "ELSE" : null;
      if (branch) result.push(...guardFacts(parent.condition, branch, source));
    } else if (ts.isBinaryExpression(parent) &&
        [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(parent.operatorToken.kind)) {
      const branch = parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ? "ELSE" : "THEN";
      result.push(...guardFacts(parent.left, branch, source));
    } else if (ts.isCaseClause(parent) && ts.isCaseBlock(parent.parent) && ts.isSwitchStatement(parent.parent.parent)) {
      const switchStatement = parent.parent.parent;
      result.push({
        field: settingFieldFromExpression(source, switchStatement.expression),
        operator: "SWITCH_CASE",
        value: parent.expression === undefined ? null : staticConditionValue(source, parent.expression) ?? null,
        branch: "CASE",
        source_location: sourceLocation(parent.getSourceFile(), parent),
        evaluated: false
      });
    }
  }
  return result.sort((left, right) => left.source_location.line - right.source_location.line || left.source_location.column - right.source_location.column);
}

function guardFacts(expression: ts.Expression, branch: "THEN" | "ELSE", source: SourceUnit): StaticFormControlEvidence["conditions"] {
  const file = source.file;
  if (branch === "THEN" && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
    return [...guardFacts(expression.left, branch, source), ...guardFacts(expression.right, branch, source)];
  }
  if (ts.isBinaryExpression(expression)) {
    const operator = expression.operatorToken.getText(file);
    const leftField = settingFieldFromExpression(source, expression.left);
    const rightField = settingFieldFromExpression(source, expression.right);
    const leftValue = staticConditionValue(source, expression.left);
    const rightValue = staticConditionValue(source, expression.right);
    if (leftField !== null && rightValue !== undefined && isComparisonOperator(operator)) return [{ field: leftField, operator, value: rightValue, branch, source_location: sourceLocation(file, expression), evaluated: false }];
    if (rightField !== null && leftValue !== undefined && isComparisonOperator(operator)) return [{ field: rightField, operator, value: leftValue, branch, source_location: sourceLocation(file, expression), evaluated: false }];
  }
  return [{
    field: settingFieldFromExpression(source, expression),
    operator: "UNRESOLVED",
    value: null,
    branch,
    source_location: sourceLocation(file, expression),
    evaluated: false
  }];
}

function staticConditionValue(source: SourceUnit, expression: ts.Expression): Literal | undefined {
  const result = evaluateStatic(expression, source);
  return (result.status === "STATIC_LITERAL" || result.status === "STATIC_LOCAL_CONSTANT") && isScalar(result.value)
    ? result.value
    : undefined;
}

function collectWatchEffects(file: ts.SourceFile): StaticFormControlAnalysis["forms"][number]["watch_effects"] {
  const effects: StaticFormControlAnalysis["forms"][number]["watch_effects"] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && isWatchCall(node.expression)) {
      const reads = new Set<string>();
      const writes = new Set<string>();
      for (const argument of node.arguments) {
        function inspect(current: ts.Node): void {
          if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
            const field = settingField(current.left);
            if (field !== null) writes.add(field);
          }
          const field = ts.isExpression(current) ? settingField(current) : null;
          if (field !== null) reads.add(field);
          ts.forEachChild(current, inspect);
        }
        inspect(argument);
      }
      effects.push({
        location: sourceLocation(file, node),
        read_fields: [...reads].sort(),
        written_fields: [...writes].sort(),
        transformation_status: "AST_CAPTURED_NOT_EXECUTED"
      });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return effects;
}

function settingField(expression: ts.Expression): string | null {
  const path = expressionPath(expression);
  const index = path.lastIndexOf("settings");
  const field = index >= 0 ? path[index + 1] : undefined;
  return field && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field) ? field : null;
}

function expressionPath(expression: ts.Expression): string[] {
  if (ts.isParenthesizedExpression(expression) || ts.isAsExpression(expression) || ts.isNonNullExpression(expression)) return expressionPath(expression.expression);
  if (ts.isIdentifier(expression)) return [expression.text];
  if (ts.isPropertyAccessExpression(expression)) return [...expressionPath(expression.expression), expression.name.text];
  if (ts.isElementAccessExpression(expression)) {
    const key = expression.argumentExpression && ts.isStringLiteralLike(expression.argumentExpression) ? expression.argumentExpression.text : "<dynamic>";
    return [...expressionPath(expression.expression), key];
  }
  return [];
}

function expressionName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${expressionName(expression.expression) ?? ""}.${expression.name.text}`.replace(/^\./u, "");
  return null;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function scalarType(values: readonly unknown[]): StaticFormControlEvidence["value_type"] {
  if (values.length === 0) return null;
  if (values.every((value) => typeof value === "string")) return "string";
  if (values.every((value) => typeof value === "boolean")) return "boolean";
  if (values.every((value) => typeof value === "number" && Number.isFinite(value))) {
    return values.every((value) => Number.isSafeInteger(value)) ? "integer" : "number";
  }
  return null;
}

function isScalar(value: unknown): value is Literal {
  return value === null || typeof value === "string" || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}

function isRecord(value: unknown): value is Record<string, StaticValue> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function staticString(value: EvalResult): string | null {
  return (value.status === "STATIC_LITERAL" || value.status === "STATIC_LOCAL_CONSTANT") && typeof value.value === "string" ? value.value : null;
}

function isComparisonOperator(operator: string): operator is "===" | "==" | "!==" | "!=" {
  return operator === "===" || operator === "==" || operator === "!==" || operator === "!=";
}

function isDescendant(node: ts.Node, ancestor: ts.Node): boolean {
  for (let current: ts.Node | undefined = node; current !== undefined; current = current.parent) if (current === ancestor) return true;
  return false;
}

function isWatchCall(expression: ts.Expression): boolean {
  return (ts.isIdentifier(expression) && ["watch", "watchEffect"].includes(expression.text)) ||
    (ts.isPropertyAccessExpression(expression) && ["watch", "watchEffect"].includes(expression.name.text));
}

function sourceLocation(file: ts.SourceFile, node: ts.Node): z.infer<typeof locationSchema> {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: position.line + 1, column: position.character + 1 };
}

function safeImportSpecifier(value: string): string | null {
  if (value.length > 500 || value.includes("\\") || /[\r\n\u0000]/u.test(value)) return null;
  if (/^\.{1,2}\/[A-Za-z0-9._/-]+$/u.test(value)) return value;
  if (/^[A-Za-z0-9@][A-Za-z0-9@._/-]*$/u.test(value)) return value;
  return null;
}

function validateSourceBatch(refs: readonly PinnedStaticFormSourceReference[], concurrency: number, timeoutMs: number): void {
  if (refs.length < 1 || refs.length > MAX_FORMS || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 4 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw extractorError("FORM_SOURCE_SET_INVALID");
  const urls = new Map<string, string>();
  for (const ref of refs) {
    const url = validatedSourceUrl(ref);
    const existing = urls.get(url.href);
    if (existing !== undefined && existing !== `${ref.sha256}:${ref.bytes}`) throw extractorError("FORM_SOURCE_BINDING_INVALID");
    urls.set(url.href, `${ref.sha256}:${ref.bytes}`);
  }
}

function validatedSourceUrl(ref: PinnedStaticFormSourceReference): URL {
  let url: URL;
  try { url = new URL(ref.url); } catch { throw extractorError("FORM_SOURCE_BINDING_INVALID"); }
  if (url.protocol !== "https:" || url.hostname !== "syntx.ai" || url.username !== "" || url.password !== "" ||
      url.search !== "" || url.hash !== "" || ref.bytes < 1 || ref.bytes > MAX_FORM_BYTES ||
      !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256) ||
      !/^\/assets\/[0-9]{6,20}\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(url.pathname) ||
      url.pathname.split("/").at(-1) !== ref.module_name) throw extractorError("FORM_SOURCE_URL_INVALID");
  return url;
}

async function fetchPinnedBody(
  ref: PinnedStaticFormSourceReference,
  fetchImpl: typeof fetch,
  signal: AbortSignal | undefined,
  timeoutMs: number
): Promise<{ text: string; bytes: Buffer }> {
  const url = validatedSourceUrl(ref);
  let response: Response;
  try {
    const timeout = AbortSignal.timeout(timeoutMs);
    response = await fetchImpl(url, {
      method: "GET",
      redirect: "error",
      headers: { accept: "application/javascript" },
      signal: signal === undefined ? timeout : AbortSignal.any([signal, timeout])
    });
  } catch { throw extractorError("FORM_SOURCE_FETCH_FAILED"); }
  if (!response.ok || response.status !== 200) throw extractorError("FORM_SOURCE_FETCH_FAILED");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FORM_BYTES) throw extractorError("FORM_SOURCE_BYTE_LIMIT_EXCEEDED");
  if (!response.body) throw extractorError("FORM_SOURCE_FETCH_FAILED");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > ref.bytes || total > MAX_FORM_BYTES) {
        await reader.cancel();
        throw extractorError("FORM_SOURCE_BYTE_LIMIT_EXCEEDED");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof StaticFormControlExtractorError) throw error;
    throw extractorError("FORM_SOURCE_FETCH_FAILED");
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  if (bytes.length !== ref.bytes || digest(bytes) !== ref.sha256) throw extractorError("FORM_SOURCE_HASH_MISMATCH");
  try { return { text: new TextDecoder("utf-8", { fatal: true }).decode(bytes), bytes }; }
  catch { throw extractorError("FORM_SOURCE_HASH_MISMATCH"); }
}

function extractorError(code: StaticFormControlExtractorErrorCode): StaticFormControlExtractorError {
  return new StaticFormControlExtractorError(code);
}

function digest(bytes: Buffer): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }

function escapeRegex(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
