import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";

const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const expressionSchema: z.ZodType<unknown> = z.lazy(() => z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("identifier"), name: z.string() }).strict(),
  z.object({ kind: z.literal("setting_field"), field: z.string() }).strict(),
  z.object({ kind: z.literal("member"), base: expressionSchema, property: z.string() }).strict(),
  z.object({ kind: z.literal("indexed"), base: expressionSchema, key: expressionSchema }).strict(),
  z.object({ kind: z.literal("literal"), value: z.union([z.string(), z.number(), z.boolean(), z.null()]) }).strict(),
  z.object({ kind: z.literal("undefined") }).strict(),
  z.object({ kind: z.literal("omitted_string"), length: z.number().int().nonnegative() }).strict(),
  z.object({ kind: z.literal("binary"), operator: z.string(), left: expressionSchema, right: expressionSchema }).strict(),
  z.object({ kind: z.literal("prefix"), operator: z.string(), operand: expressionSchema }).strict(),
  z.object({ kind: z.literal("conditional"), condition: expressionSchema, when_true: expressionSchema, when_false: expressionSchema }).strict(),
  z.object({ kind: z.literal("call"), callee: expressionSchema, arguments: z.array(expressionSchema).max(8) }).strict(),
  z.object({ kind: z.literal("array"), items: z.array(expressionSchema).max(20) }).strict(),
  z.object({ kind: z.literal("object"), properties: z.array(z.object({ key: z.string(), value: expressionSchema }).strict()).max(32) }).strict(),
  z.object({ kind: z.literal("unknown"), syntax_kind: z.string() }).strict()
]));

const sourceSchema = z.object({
  module_name: z.string(),
  url: z.string().url(),
  bytes: z.number().int().positive(),
  sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
  ast_parse_diagnostics: z.literal(0)
}).strict();
const providerGraphNodeSchema = z.object({
  symbol: z.string(),
  location: locationSchema.nullable(),
  kind: z.string(),
  params: z.array(z.string()),
  return_expressions: z.array(expressionSchema),
  calls: z.array(z.object({ callee: z.string(), location: locationSchema }).strict()),
  conditions: z.array(z.object({ condition_ast: expressionSchema, location: locationSchema }).strict()),
  export_assignments: z.array(z.object({ target: z.string(), value_ast: expressionSchema, location: locationSchema }).strict())
}).strict();

const genericRuleSchema = z.object({
  id: z.string(),
  kind: z.enum(["DYNAMIC_DEFAULT_FALLBACK", "MODEL_SETTINGS_TO_GENERIC_CONTROLS", "SETTING_AVAILABILITY_GATE", "PAYLOAD_FIELD_TRANSFORM"]),
  source_module: z.string(),
  location: locationSchema,
  condition_ast: expressionSchema.nullable(),
  target: z.string(),
  source_expression: expressionSchema.nullable(),
  assignment_sources: z.array(z.object({ branch: z.enum(["CONDITION_TRUE", "CONDITION_FALSE", "UNCONDITIONAL"]), location: locationSchema, expression_ast: expressionSchema }).strict()),
  helper_dependency: z.object({ module: z.string(), imported_symbol: z.string(), local_symbol: z.string() }).strict().nullable(),
  falsy_input_policy: z.enum(["FALL_BACK_TO_DEFAULT_MAP", "NOT_APPLICABLE"]),
  related_fields: z.array(z.string()),
  status: z.enum(["AST_RULE_EXTRACTED_NOT_EVALUATED", "PARTIAL_STATIC_MAPPING"]),
  unresolved_reason: z.string().nullable()
}).strict();

const formControlSchema = z.object({
  field: z.string(),
  location: locationSchema,
  binding_ast: expressionSchema,
  literal_default: z.object({ value: z.union([z.string(), z.number(), z.boolean(), z.null()]), location: locationSchema }).strict().nullable(),
  default_status: z.enum(["STATIC_LITERAL", "DATA_DRIVEN_OR_UNRESOLVED"])
}).strict();

const formConditionSchema = z.object({
  location: locationSchema,
  condition_ast: expressionSchema,
  condition_field: z.string().nullable(),
  static_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).nullable(),
  affected_settings_fields: z.array(z.string()),
  status: z.literal("EXPRESSION_CAPTURED_NOT_EVALUATED")
}).strict();

const fallbackDefaultSchema = z.object({
  field: z.string(),
  location: locationSchema,
  factory_call_location: locationSchema,
  factory_export: z.literal("u"),
  factory_parameter: z.literal("n"),
  factory_argument_index: z.literal(2),
  expression_ast: expressionSchema,
  literal_value: z.union([z.string(), z.number(), z.boolean(), z.null()]).nullable(),
  value_status: z.enum(["STATIC_LITERAL", "OMITTED", "DYNAMIC_EXPRESSION"]),
  default_source: z.enum(["FORM_LITERAL", "SELECTED_MODEL_DEFAULT_VALUE", "DYNAMIC_SOURCE", "OMITTED"]),
  selector_function: z.string().nullable(),
  selector_location: locationSchema.nullable(),
  application_stage: z.literal("FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES")
}).strict();

const modelScopeSchema = z.object({
  model_id: z.string(),
  active: z.boolean(),
  preferred_model_variant: z.boolean(),
  form_id: z.string(),
  form_control_fields: z.array(z.string()),
  api_settings_keys: z.array(z.string()),
  controls_with_api_settings: z.array(z.string()),
  controls_without_api_settings: z.array(z.string()),
  form_fallback_defaults: z.array(fallbackDefaultSchema),
  setting_defaults_status: z.literal("DATA_DRIVEN_FALLBACK_MAP_WITH_DYNAMIC_OVERRIDES")
}).strict();

export const maplessSettingsDefaultsAnalysisSchema = z.object({
  schema_version: z.literal("1.0.0"),
  analysis_kind: z.literal("MAPLESS_SETTINGS_DEFAULTS_AND_CONDITIONS"),
  evidence_level: z.literal("PINNED_COMPILED_JS_AST"),
  build_id: z.string().regex(/^\d{6,20}$/u),
  public_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  runtime_usable: z.literal(false),
  sources: z.array(sourceSchema).length(5),
  normalizer_chain: z.object({
    settings3_local_symbol: z.string(),
    imported_symbol: z.string(),
    app_export_local_symbol: z.string().nullable(),
    app_initializer_callee: z.string().nullable(),
    app_initializer_argument_callee: z.string().nullable(),
    factory_location: locationSchema.nullable(),
    factory_semantics: z.enum(["ES_MODULE_DEFAULT_UNWRAP", "UNKNOWN"]),
    provider_location: locationSchema.nullable(),
    provider_kind: z.string().nullable(),
    provider_next_callee: z.string().nullable(),
    provider_status: z.enum(["LOCAL_PROVIDER_GRAPH_CAPTURED", "LOCAL_FACTORY_CALL_NOT_RESOLVED", "PROVIDER_DECLARATION_NOT_FOUND"]),
    provider_graph: z.array(providerGraphNodeSchema).max(12)
  }).strict(),
  generic_setting_fields: z.array(z.string()),
  payload_helper_field_candidates: z.array(z.string()),
  generic_rules: z.array(genericRuleSchema),
  form_controls: z.object({ banana: z.array(formControlSchema), seedance: z.array(formControlSchema) }).strict(),
  form_fallback_defaults: z.object({ banana: z.array(fallbackDefaultSchema), seedance: z.array(fallbackDefaultSchema) }).strict(),
  form_conditions: z.object({ banana: z.array(formConditionSchema), seedance: z.array(formConditionSchema) }).strict(),
  model_scopes: z.array(modelScopeSchema),
  literal_default_values: z.array(z.object({ form_id: z.string(), field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), location: locationSchema }).strict()),
  limitations: z.array(z.string())
}).strict();

export type MaplessSettingsDefaultsAnalysis = z.infer<typeof maplessSettingsDefaultsAnalysisSchema>;

export interface PinnedModuleText {
  moduleName: "app.js" | "settings3.js" | "useSettingsParams.js" | "banana.js" | "seedance2.js";
  text: string;
}

interface SourceUnit {
  moduleName: PinnedModuleText["moduleName"];
  url: string;
  text: string;
  file: ts.SourceFile;
}

type Literal = string | number | boolean | null;

export function analyzeMaplessSettingsDefaults(
  inventory: MaplessSettingsInventory,
  sourceTexts: readonly PinnedModuleText[]
): MaplessSettingsDefaultsAnalysis {
  const sourceUnits = loadAndVerifySources(inventory, sourceTexts);
  const byName = new Map(sourceUnits.map((source) => [source.moduleName, source]));
  const settings3 = requiredSource(byName, "settings3.js");
  const payloadModule = requiredSource(byName, "useSettingsParams.js");
  const banana = requiredSource(byName, "banana.js");
  const seedance = requiredSource(byName, "seedance2.js");
  const app = requiredSource(byName, "app.js");
  const genericFields = inventory.framework.settings3.generic_setting_keys;
  const payloadCandidates = inventory.framework.useSettingsParams.payload_field_keys;
  const defaultFunction = findMethod(settings3.file, "setDefault");
  const setByModelFunction = findMethod(settings3.file, "setSettingsByModel");
  const availabilityFunction = findMethod(settings3.file, "checkSettingAvailability");
  const normalizerImport = findLocalImport(settings3.file, "d");
  const normalizerChain = resolveDefaultNormalizer(settings3.file, app.file, normalizerImport);
  const defaultAssignments = defaultFunction === null ? [] : assignmentsToSettings(defaultFunction);
  const defaultConditional = defaultFunction === null ? null : firstIfCondition(defaultFunction);
  const mappedSetterCalls = setByModelFunction === null ? [] : collectSetterCalls(setByModelFunction);
  const availabilityAssignment = availabilityFunction === null ? null : assignmentsToSettings(availabilityFunction)[0] ?? null;

  const genericRules: z.infer<typeof genericRuleSchema>[] = [];
  if (defaultFunction !== null) {
    genericRules.push({
      id: "settings3.setDefault",
      kind: "DYNAMIC_DEFAULT_FALLBACK",
      source_module: "settings3.js",
      location: sourceLocation(settings3.file, defaultFunction),
      condition_ast: defaultConditional === null ? null : expressionToIR(settings3.file, defaultConditional),
      target: "reactive_settings[iterated_key]",
      source_expression: defaultAssignments.length > 0 ? expressionToIR(settings3.file, defaultAssignments[0]!.right) : null,
      assignment_sources: defaultAssignments.map((assignment) => ({ branch: assignment.branch, location: sourceLocation(settings3.file, assignment.node), expression_ast: expressionToIR(settings3.file, assignment.right) })),
      helper_dependency: normalizerImport === null ? null : { module: normalizerImport.from, imported_symbol: normalizerImport.imported, local_symbol: "d" },
      falsy_input_policy: "FALL_BACK_TO_DEFAULT_MAP",
      related_fields: [...new Set(defaultAssignments.map((assignment) => assignment.field).filter((field): field is string => field !== null))].sort(),
      status: "AST_RULE_EXTRACTED_NOT_EVALUATED",
      unresolved_reason: normalizerImport === null
        ? "Normalizer import binding was not resolved."
        : `Both branches call imported helper ${normalizerImport.imported} from ${normalizerImport.from}; its local provider call chain is recorded separately and not evaluated.`
    });
  }
  if (setByModelFunction !== null) {
    genericRules.push({
      id: "settings3.setSettingsByModel",
      kind: "MODEL_SETTINGS_TO_GENERIC_CONTROLS",
      source_module: "settings3.js",
      location: sourceLocation(settings3.file, setByModelFunction),
      condition_ast: firstIfCondition(setByModelFunction) === null ? null : expressionToIR(settings3.file, firstIfCondition(setByModelFunction)!),
      target: "generic_control_setters",
      source_expression: mappedSetterCalls[0]?.argument ?? null,
      assignment_sources: [],
      helper_dependency: null,
      falsy_input_policy: "NOT_APPLICABLE",
      related_fields: genericFields,
      status: "PARTIAL_STATIC_MAPPING",
      unresolved_reason: "Selected model is looked up and model settings are enumerated, but every generic field-to-setter branch is not resolved in this slice."
    });
  }
  if (availabilityFunction !== null) {
    genericRules.push({
      id: "settings3.checkSettingAvailability",
      kind: "SETTING_AVAILABILITY_GATE",
      source_module: "settings3.js",
      location: sourceLocation(settings3.file, availabilityFunction),
      condition_ast: firstCallPredicate(availabilityFunction, "some"),
      target: availabilityAssignment?.field === null || availabilityAssignment === null ? "reactive_settings[iterated_key]" : `reactive_settings.${availabilityAssignment.field}`,
      source_expression: availabilityAssignment === null ? null : expressionToIR(settings3.file, availabilityAssignment.right),
      assignment_sources: availabilityAssignment === null ? [] : [{ branch: availabilityAssignment.branch, location: sourceLocation(settings3.file, availabilityAssignment.node), expression_ast: expressionToIR(settings3.file, availabilityAssignment.right) }],
      helper_dependency: null,
      falsy_input_policy: "NOT_APPLICABLE",
      related_fields: genericFields,
      status: "AST_RULE_EXTRACTED_NOT_EVALUATED",
      unresolved_reason: "The Array.some callback is dynamic and was not evaluated."
    });
  }

  const payloadArrays = staticFieldArrays(payloadModule.file, new Set(payloadCandidates));
  if (payloadArrays.length > 0) {
    genericRules.push({
      id: "useSettingsParams.static-field-arrays",
      kind: "PAYLOAD_FIELD_TRANSFORM",
      source_module: "useSettingsParams.js",
      location: payloadArrays[0]!.location,
      condition_ast: firstRelevantCondition(payloadModule.file, new Set(payloadCandidates)),
      target: "payload_field_candidates",
      source_expression: { kind: "array", items: payloadArrays.flatMap((entry) => entry.fields).map((field) => ({ kind: "literal", value: field })) },
      assignment_sources: [],
      helper_dependency: null,
      falsy_input_policy: "NOT_APPLICABLE",
      related_fields: [...new Set(payloadArrays.flatMap((entry) => entry.fields))].sort(),
      status: "PARTIAL_STATIC_MAPPING",
      unresolved_reason: "Static helper field names and conditions are evidence only; final payload construction is not runtime-verified."
    });
  }

  const bananaControls = extractFormControls(banana.file, "banana");
  const seedanceControls = extractFormControls(seedance.file, "seedance");
  const bananaFallbackDefaults = extractFormFallbackDefaults(banana.file, settings3.file);
  const seedanceFallbackDefaults = extractFormFallbackDefaults(seedance.file, settings3.file);
  const bananaConditions = extractFormConditions(banana.file, new Set(bananaControls.map((control) => control.field)));
  const seedanceConditions = extractFormConditions(seedance.file, new Set(seedanceControls.map((control) => control.field)));
  const modelScopes = [
    ...buildModelScopes(inventory, "banana", "banana", bananaControls, bananaFallbackDefaults),
    ...buildModelScopes(inventory, "seedance", "seedance", seedanceControls, seedanceFallbackDefaults)
  ];
  const literalDefaultValues = [
    ...bananaFallbackDefaults.filter((entry) => entry.value_status === "STATIC_LITERAL").map((entry) => ({ form_id: "banana", field: entry.field, value: entry.literal_value, location: entry.location })),
    ...seedanceFallbackDefaults.filter((entry) => entry.value_status === "STATIC_LITERAL").map((entry) => ({ form_id: "seedance", field: entry.field, value: entry.literal_value, location: entry.location })),
    ...bananaControls.filter((control) => control.literal_default !== null).map((control) => ({ form_id: "banana", field: control.field, value: control.literal_default!.value, location: control.literal_default!.location })),
    ...seedanceControls.filter((control) => control.literal_default !== null).map((control) => ({ form_id: "seedance", field: control.field, value: control.literal_default!.value, location: control.literal_default!.location }))
  ];

  return maplessSettingsDefaultsAnalysisSchema.parse({
    schema_version: "1.0.0",
    analysis_kind: "MAPLESS_SETTINGS_DEFAULTS_AND_CONDITIONS",
    evidence_level: "PINNED_COMPILED_JS_AST",
    build_id: inventory.build.id,
    public_version: inventory.public_catalog.version,
    runtime_usable: false,
    sources: sourceUnits.map((source) => ({
      module_name: source.moduleName,
      url: source.url,
      bytes: Buffer.byteLength(source.text, "utf8"),
      sha256: `sha256:${createHash("sha256").update(source.text, "utf8").digest("hex")}`,
      ast_parse_diagnostics: 0 as const
    })),
    normalizer_chain: normalizerChain,
    generic_setting_fields: genericFields,
    payload_helper_field_candidates: payloadCandidates,
    generic_rules: genericRules,
    form_controls: { banana: bananaControls, seedance: seedanceControls },
    form_fallback_defaults: { banana: bananaFallbackDefaults, seedance: seedanceFallbackDefaults },
    form_conditions: { banana: bananaConditions, seedance: seedanceConditions },
    model_scopes: modelScopes,
    literal_default_values: literalDefaultValues,
    limitations: [
      "Vendor JavaScript is parsed as AST only and never evaluated.",
      "Form-factory fallback maps contain static fields, but effective selected defaults remain data-driven and may be overridden by incoming settings, model selection, or later watchers.",
      "Rules and conditions are serialized as safe AST summaries and are not executed against model values.",
      "Payload helper keys are candidate mappings only; no server acceptance or runtime generation is proven."
    ]
  });
}

function loadAndVerifySources(inventory: MaplessSettingsInventory, inputs: readonly PinnedModuleText[]): SourceUnit[] {
  const refs = new Map<PinnedModuleText["moduleName"], { url: string; sha256: string; bytes: number | null }>([
    ["app.js", { url: `https://syntx.ai/assets/${inventory.build.id}/app.js`, sha256: inventory.app_sha256, bytes: null }],
    ["settings3.js", { ...inventory.framework.settings3, bytes: inventory.framework.settings3.bytes }],
    ["useSettingsParams.js", { ...inventory.framework.useSettingsParams, bytes: inventory.framework.useSettingsParams.bytes }],
    ...inventory.forms.filter((form) => form.form_id === "banana" || form.form_id === "seedance").map((form) => [form.module_name as PinnedModuleText["moduleName"], { ...form.javascript, bytes: form.javascript.bytes }] as const)
  ]);
  const byName = new Map<PinnedModuleText["moduleName"], PinnedModuleText>(inputs.map((input) => [input.moduleName, input]));
  if (byName.size !== 5 || inputs.length !== 5 || [...refs.keys()].some((name) => !byName.has(name))) throw new Error("MAPLESS_DEFAULTS_SOURCE_SET_INVALID");
  return [...refs.entries()].map(([moduleName, ref]) => {
    const input = byName.get(moduleName)!;
    const actualBytes = Buffer.byteLength(input.text, "utf8");
    const actualHash = `sha256:${createHash("sha256").update(input.text, "utf8").digest("hex")}`;
    if ((ref.bytes !== null && actualBytes !== ref.bytes) || actualHash !== ref.sha256) throw new Error("MAPLESS_DEFAULTS_SOURCE_HASH_MISMATCH");
    const file = ts.createSourceFile(moduleName, input.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
    if (file.parseDiagnostics.length > 0) throw new Error("MAPLESS_DEFAULTS_AST_PARSE_FAILED");
    return { moduleName: moduleName as PinnedModuleText["moduleName"], url: ref.url, text: input.text, file };
  });
}

function requiredSource(sources: ReadonlyMap<string, SourceUnit>, moduleName: PinnedModuleText["moduleName"]): SourceUnit {
  const source = sources.get(moduleName);
  if (source === undefined) throw new Error("MAPLESS_DEFAULTS_SOURCE_MISSING");
  return source;
}

function sourceLocation(file: ts.SourceFile, node: ts.Node): z.infer<typeof locationSchema> {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: position.line + 1, column: position.character + 1 };
}

function findMethod(file: ts.SourceFile, methodName: string): ts.FunctionLikeDeclaration | null {
  let found: ts.FunctionLikeDeclaration | null = null;
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === methodName && (ts.isFunctionExpression(node.initializer) || ts.isArrowFunction(node.initializer))) found = node.initializer;
    if (ts.isMethodDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === methodName) found = node;
    if (found === null) ts.forEachChild(node, visit);
  }
  visit(file);
  return found;
}

function findLocalImport(file: ts.SourceFile, localName: string): { from: string; imported: string } | null {
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const named = statement.importClause?.namedBindings;
    if (!named || !ts.isNamedImports(named)) continue;
    const found = named.elements.find((element) => element.name.text === localName);
    if (found !== undefined) return { from: statement.moduleSpecifier.text, imported: found.propertyName?.text ?? found.name.text };
  }
  return null;
}

function resolveDefaultNormalizer(
  settings3File: ts.SourceFile,
  appFile: ts.SourceFile,
  importedBinding: { from: string; imported: string } | null
): z.infer<typeof maplessSettingsDefaultsAnalysisSchema>["normalizer_chain"] {
  const fallback = {
    settings3_local_symbol: "d",
    imported_symbol: importedBinding?.imported ?? "UNRESOLVED",
    app_export_local_symbol: null,
    app_initializer_callee: null,
    app_initializer_argument_callee: null,
    factory_location: null,
    factory_semantics: "UNKNOWN" as const,
    provider_location: null,
    provider_kind: null,
    provider_next_callee: null,
    provider_status: "PROVIDER_DECLARATION_NOT_FOUND" as const,
    provider_graph: []
  };
  const observedImport = findLocalImport(settings3File, "d");
  if (importedBinding === null || observedImport?.from !== "./app.js" || importedBinding.from !== observedImport.from || importedBinding.imported !== observedImport.imported) return fallback;
  const exportedLocals = new Map<string, string>();
  for (const statement of appFile.statements) {
    if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) {
        exportedLocals.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
      }
    }
  }
  const appLocal = exportedLocals.get(importedBinding.imported);
  if (appLocal === undefined) return fallback;
  let exportDeclaration: ts.VariableDeclaration | undefined;
  const declarations = new Map<string, ts.VariableDeclaration | ts.FunctionDeclaration>();
  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node);
    if (ts.isFunctionDeclaration(node) && node.name) declarations.set(node.name.text, node);
    ts.forEachChild(node, collect);
  }
  collect(appFile);
  const declaration = declarations.get(appLocal);
  if (!declaration || !ts.isVariableDeclaration(declaration) || !declaration.initializer) return { ...fallback, app_export_local_symbol: appLocal };
  exportDeclaration = declaration;
  const initializer = exportDeclaration.initializer;
  if (initializer === undefined || !ts.isCallExpression(initializer) || !ts.isIdentifier(initializer.expression)) return { ...fallback, app_export_local_symbol: appLocal };
  const factoryName = initializer.expression.text;
  const factoryDeclaration = declarations.get(factoryName);
  if (!factoryDeclaration || !ts.isFunctionDeclaration(factoryDeclaration) || factoryDeclaration.body === undefined) {
    return { ...fallback, app_export_local_symbol: appLocal, app_initializer_callee: factoryName };
  }
  const functionBody = factoryDeclaration.body;
  const returnExpression = functionBody.statements.find(ts.isReturnStatement)?.expression;
  const semantics = returnExpression !== undefined && isEsModuleDefaultUnwrap(returnExpression) ? "ES_MODULE_DEFAULT_UNWRAP" as const : "UNKNOWN" as const;
  const arg = initializer.arguments[0];
  const providerCallee = arg === undefined ? null : resolveProviderCallName(arg, declarations);
  const providerDeclaration = providerCallee === null ? undefined : declarations.get(providerCallee);
  const providerInitializer = providerDeclaration && ts.isVariableDeclaration(providerDeclaration) ? providerDeclaration.initializer : undefined;
  const providerNode = providerDeclaration ?? null;
  const providerNextCallee = providerInitializer !== undefined && ts.isCallExpression(providerInitializer) && ts.isIdentifier(providerInitializer.expression)
    ? providerInitializer.expression.text
    : null;
  const providerKind = providerDeclaration === undefined
    ? null
    : ts.isFunctionDeclaration(providerDeclaration)
      ? "FunctionDeclaration"
      : providerInitializer === undefined
        ? "NoInitializer"
        : ts.SyntaxKind[providerInitializer.kind];
  const providerGraph = providerCallee === null ? [] : traceLocalProviderGraph(appFile, declarations, providerCallee);
  return {
    settings3_local_symbol: "d",
    imported_symbol: importedBinding.imported,
    app_export_local_symbol: appLocal,
    app_initializer_callee: factoryName,
    app_initializer_argument_callee: providerCallee,
    factory_location: sourceLocation(appFile, factoryDeclaration),
    factory_semantics: semantics,
    provider_location: providerNode === null ? null : sourceLocation(appFile, providerNode),
    provider_kind: providerKind,
    provider_next_callee: providerNextCallee,
    provider_status: providerDeclaration === undefined
      ? "PROVIDER_DECLARATION_NOT_FOUND"
      : providerInitializer !== undefined && ts.isCallExpression(providerInitializer)
        ? "LOCAL_FACTORY_CALL_NOT_RESOLVED"
        : "LOCAL_PROVIDER_GRAPH_CAPTURED",
    provider_graph: providerGraph
  };
}

function resolveProviderCallName(expression: ts.Expression, declarations: ReadonlyMap<string, ts.VariableDeclaration | ts.FunctionDeclaration>, seen = new Set<string>()): string | null {
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) return expression.expression.text;
  if (!ts.isIdentifier(expression) || seen.has(expression.text)) return null;
  seen.add(expression.text);
  const declaration = declarations.get(expression.text);
  if (declaration === undefined) return null;
  const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
  if (initializer === undefined) return ts.isFunctionDeclaration(declaration) ? declaration.name?.text ?? null : null;
  if (ts.isCallExpression(initializer)) return resolveProviderCallName(initializer, declarations, seen);
  if (ts.isIdentifier(initializer)) return resolveProviderCallName(initializer, declarations, seen);
  return null;
}

function isEsModuleDefaultUnwrap(expression: ts.Expression): boolean {
  if (!ts.isConditionalExpression(expression)) return false;
  const whenTrue = memberPath(expression.whenTrue);
  const whenFalse = memberPath(expression.whenFalse);
  const conditions: ts.Expression[] = [];
  function flatten(node: ts.Expression): void {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      flatten(node.left);
      flatten(node.right);
    } else conditions.push(node);
  }
  flatten(expression.condition);
  const hasModuleMarker = conditions.some((condition) => memberPath(condition).at(-1) === "__esModule");
  const hasDefaultOwnProperty = conditions.some((condition) => {
    if (!ts.isCallExpression(condition)) return false;
    const path = memberPath(condition.expression);
    return path.slice(-4).join(".") === "Object.prototype.hasOwnProperty.call" && condition.arguments.some((argument) => ts.isStringLiteralLike(argument) && argument.text === "default");
  });
  return hasModuleMarker && hasDefaultOwnProperty && whenTrue.at(-1) === "default" && whenFalse.length === 1 && ts.isIdentifier(expression.whenFalse);
}

function traceLocalProviderGraph(
  file: ts.SourceFile,
  declarations: ReadonlyMap<string, ts.VariableDeclaration | ts.FunctionDeclaration>,
  entry: string
): z.infer<typeof providerGraphNodeSchema>[] {
  const result: z.infer<typeof providerGraphNodeSchema>[] = [];
  const queue = [entry];
  const visited = new Set<string>();
  while (queue.length > 0 && result.length < 12) {
    const symbol = queue.shift()!;
    if (visited.has(symbol)) continue;
    visited.add(symbol);
    const declaration = declarations.get(symbol);
    if (declaration === undefined) continue;
    const initializer = ts.isVariableDeclaration(declaration) ? declaration.initializer : undefined;
    const functionNode = ts.isFunctionDeclaration(declaration)
      ? declaration
      : initializer && (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer))
        ? initializer
        : null;
    const calls: Array<{ callee: string; location: z.infer<typeof locationSchema> }> = [];
    const returns: unknown[] = [];
    const conditions: Array<{ condition_ast: unknown; location: z.infer<typeof locationSchema> }> = [];
    const exportAssignments: Array<{ target: string; value_ast: unknown; location: z.infer<typeof locationSchema> }> = [];
    const root = functionNode?.body ?? initializer;
    if (root !== undefined && root !== null) {
      if (functionNode && ts.isArrowFunction(functionNode) && !ts.isBlock(functionNode.body)) returns.push(expressionToIR(file, functionNode.body));
      function visit(node: ts.Node): void {
        if (ts.isReturnStatement(node) && node.expression) returns.push(expressionToIR(file, node.expression));
        if (ts.isCallExpression(node)) {
          const calleeName = ts.isIdentifier(node.expression)
            ? node.expression.text
            : ts.isPropertyAccessExpression(node.expression)
              ? node.expression.name.text
              : null;
          if (calleeName !== null) {
            calls.push({ callee: calleeName, location: sourceLocation(file, node) });
            if (declarations.has(calleeName) && !visited.has(calleeName)) queue.push(calleeName);
          }
        }
        if (ts.isIfStatement(node)) conditions.push({ condition_ast: expressionToIR(file, node.expression), location: sourceLocation(file, node.expression) });
        if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken) {
          const targetPath = memberPath(node.left);
          if (targetPath.some((part) => part === "exports" || part === "module")) exportAssignments.push({ target: targetPath.join("."), value_ast: expressionToIR(file, node.right), location: sourceLocation(file, node) });
        }
        ts.forEachChild(node, visit);
      }
      visit(root);
    } else if (initializer && ts.isCallExpression(initializer)) {
      const calleeName = ts.isIdentifier(initializer.expression) ? initializer.expression.text : null;
      if (calleeName !== null) {
        calls.push({ callee: calleeName, location: sourceLocation(file, initializer) });
        if (declarations.has(calleeName) && !visited.has(calleeName)) queue.push(calleeName);
      }
    }
    const params = functionNode?.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : "pattern") ?? [];
    result.push({
      symbol,
      location: sourceLocation(file, declaration),
      kind: functionNode === null ? initializer === undefined ? "NO_INITIALIZER" : ts.SyntaxKind[initializer.kind] : ts.isFunctionDeclaration(functionNode) ? "FunctionDeclaration" : ts.isArrowFunction(functionNode) ? "ArrowFunction" : "FunctionExpression",
      params,
      return_expressions: returns.slice(0, 24) as z.infer<typeof expressionSchema>[],
      calls: calls.slice(0, 32),
      conditions: conditions.slice(0, 24) as z.infer<typeof providerGraphNodeSchema>["conditions"],
      export_assignments: exportAssignments.slice(0, 24) as z.infer<typeof providerGraphNodeSchema>["export_assignments"]
    });
  }
  return result;
}

interface SettingsAssignment {
  field: string | null;
  right: ts.Expression;
  node: ts.BinaryExpression;
  branch: "CONDITION_TRUE" | "CONDITION_FALSE" | "UNCONDITIONAL";
}

function assignmentsToSettings(node: ts.FunctionLikeDeclaration): SettingsAssignment[] {
  const assignments: SettingsAssignment[] = [];
  if (node.body === undefined) return assignments;
  function visit(current: ts.Node, branch: SettingsAssignment["branch"] = "UNCONDITIONAL"): void {
    if (ts.isBinaryExpression(current) && current.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isElementAccessExpression(current.left)) {
      const target = memberPath(current.left.expression);
      if (target.at(-1) === "settings") {
        assignments.push({ field: null, right: current.right, node: current, branch });
      }
    }
    if (ts.isIfStatement(current)) {
      visit(current.thenStatement, "CONDITION_TRUE");
      if (current.elseStatement !== undefined) visit(current.elseStatement, "CONDITION_FALSE");
      return;
    }
    ts.forEachChild(current, (child) => visit(child, branch));
  }
  visit(node.body);
  return assignments;
}

function firstIfCondition(node: ts.Node): ts.Expression | null {
  let found: ts.Expression | null = null;
  function visit(current: ts.Node): void {
    if (found === null && ts.isIfStatement(current)) found = current.expression;
    if (found === null) ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function collectSetterCalls(node: ts.Node): Array<{ name: string; argument: unknown }> {
  const calls: Array<{ name: string; argument: unknown }> = [];
  function visit(current: ts.Node): void {
    if (ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text.startsWith("set")) {
      const arg = current.arguments[0];
      if (arg !== undefined && containsSettingsElementAccess(arg)) calls.push({ name: current.expression.name.text, argument: expressionToIR(current.getSourceFile(), arg) });
    }
    ts.forEachChild(current, visit);
  }
  visit(node);
  return calls;
}

function containsSettingsElementAccess(node: ts.Node): boolean {
  let found = false;
  function visit(current: ts.Node): void {
    if (ts.isElementAccessExpression(current) && memberPath(current.expression).at(-1) === "settings") found = true;
    if (!found) ts.forEachChild(current, visit);
  }
  visit(node);
  return found;
}

function firstCallPredicate(node: ts.Node, methodName: string): unknown | null {
  let found: ts.CallExpression | null = null;
  function visit(current: ts.Node): void {
    if (found === null && ts.isCallExpression(current) && ts.isPropertyAccessExpression(current.expression) && current.expression.name.text === methodName) found = current;
    if (found === null) ts.forEachChild(current, visit);
  }
  visit(node);
  if (found === null) return null;
  return {
    kind: "call",
    callee: { kind: "member", base: { kind: "identifier", name: "availability_list" }, property: methodName },
    arguments: [{ kind: "unknown", syntax_kind: "callback_predicate_not_evaluated" }]
  };
}

function staticFieldArrays(file: ts.SourceFile, fields: ReadonlySet<string>): Array<{ location: z.infer<typeof locationSchema>; fields: string[] }> {
  const arrays: Array<{ location: z.infer<typeof locationSchema>; fields: string[] }> = [];
  function visit(node: ts.Node): void {
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.filter(ts.isStringLiteralLike).map((entry) => entry.text).filter((value) => fields.has(value));
      if (values.length > 0) arrays.push({ location: sourceLocation(file, node), fields: [...new Set(values)].sort() });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return arrays;
}

function firstRelevantCondition(file: ts.SourceFile, fields: ReadonlySet<string>): unknown | null {
  let found: ts.Expression | null = null;
  function visit(node: ts.Node): void {
    if (found === null && ts.isIfStatement(node) && expressionUsesAnyField(node.expression, fields)) found = node.expression;
    if (found === null) ts.forEachChild(node, visit);
  }
  visit(file);
  return found === null ? null : expressionToIR(file, found);
}

function extractFormControls(file: ts.SourceFile, formId: string): z.infer<typeof formControlSchema>[] {
  const controls = new Map<string, z.infer<typeof formControlSchema>>();
  function visit(node: ts.Node): void {
    if (ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "modelValue") {
      const binding = memberPath(node.initializer);
      const settingsPosition = binding.lastIndexOf("settings");
      const field = settingsPosition >= 0 ? binding[settingsPosition + 1] : undefined;
      if (field !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field)) {
        const parent = node.parent;
        const defaultProperty = ts.isObjectLiteralExpression(parent)
          ? parent.properties.find((property) => ts.isPropertyAssignment(property) && ["defaultValue", "default-value"].includes(property.name.getText(file)))
          : undefined;
        const defaultValue = defaultProperty !== undefined && ts.isPropertyAssignment(defaultProperty) ? primitive(defaultProperty.initializer) : { found: false as const };
        controls.set(field, {
          field,
          location: sourceLocation(file, node),
          binding_ast: expressionToIR(file, node.initializer),
          literal_default: defaultValue.found ? { value: defaultValue.value, location: sourceLocation(file, defaultProperty!) } : null,
          default_status: defaultValue.found ? "STATIC_LITERAL" : "DATA_DRIVEN_OR_UNRESOLVED"
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  if (formId.length === 0) return [];
  return [...controls.values()].sort((left, right) => left.field.localeCompare(right.field));
}

function extractFormFallbackDefaults(
  formFile: ts.SourceFile,
  settings3File: ts.SourceFile
): z.infer<typeof fallbackDefaultSchema>[] {
  const exportLocal = exportedLocalName(settings3File, "u");
  const parameters = exportLocal === null ? [] : exportedFunctionParameters(settings3File, exportLocal);
  if (exportLocal === null || parameters.length === 0) return [];
  let importedFactory: string | null = null;
  for (const statement of formFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "./settings3.js") continue;
    const bindings = statement.importClause?.namedBindings;
    if (bindings && ts.isNamedImports(bindings)) {
      const found = bindings.elements.find((element) => (element.propertyName?.text ?? element.name.text) === "u");
      if (found) importedFactory = found.name.text;
    }
  }
  if (importedFactory === null) return [];
  const parameterIndex = parameters.indexOf("n");
  if (parameterIndex < 0) return [];
  const declarations = new Map<string, ts.Expression>();
  function collectDeclarations(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) declarations.set(node.name.text, node.initializer);
    ts.forEachChild(node, collectDeclarations);
  }
  collectDeclarations(formFile);
  const result: z.infer<typeof fallbackDefaultSchema>[] = [];
  function walk(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === importedFactory) {
      const fallbackArg = node.arguments[parameterIndex];
      const resolved = fallbackArg && ts.isIdentifier(fallbackArg) ? declarations.get(fallbackArg.text) : fallbackArg;
      if (resolved && ts.isObjectLiteralExpression(resolved)) {
        for (const property of resolved.properties) {
          if (!ts.isPropertyAssignment(property)) continue;
          const field = propertyName(property.name);
          if (field === undefined) continue;
          const primitiveValue = primitive(property.initializer);
          const modelSelector = selectedModelDefaultValue(property.initializer);
          const valueStatus = primitiveValue.found ? "STATIC_LITERAL" as const : isOmittedVoid(property.initializer) ? "OMITTED" as const : "DYNAMIC_EXPRESSION" as const;
          result.push({
            field,
            location: sourceLocation(formFile, property),
            factory_call_location: sourceLocation(formFile, node),
            factory_export: "u",
            factory_parameter: "n",
            factory_argument_index: 2,
            expression_ast: expressionToIR(formFile, property.initializer),
            literal_value: primitiveValue.found ? primitiveValue.value : null,
            value_status: valueStatus,
            default_source: primitiveValue.found ? "FORM_LITERAL" : valueStatus === "OMITTED" ? "OMITTED" : modelSelector === null ? "DYNAMIC_SOURCE" : "SELECTED_MODEL_DEFAULT_VALUE",
            selector_function: modelSelector?.function_name ?? null,
            selector_location: modelSelector?.location ?? null,
            application_stage: "FORM_FALLBACK_BEFORE_LATER_MODEL_OR_WATCHER_UPDATES"
          });
        }
      }
    }
    ts.forEachChild(node, walk);
  }
  walk(formFile);
  const unique = new Map(result.map((entry) => [`${entry.field}:${entry.factory_call_location.line}:${entry.factory_call_location.column}`, entry]));
  return [...unique.values()].sort((left, right) => left.field.localeCompare(right.field));
}

function selectedModelDefaultValue(expression: ts.Expression): { function_name: string; location: z.infer<typeof locationSchema> } | null {
  if (!ts.isConditionalExpression(expression)) return null;
  const whenFalse = memberPath(expression.whenFalse);
  if (whenFalse.at(-1) !== "value") return null;
  const selectedDefaultCall: { node: ts.CallExpression | null } = { node: null };
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = memberPath(node.expression);
      if (callee.at(-1) === "getDefaultModelByAiName") selectedDefaultCall.node = node;
    }
    ts.forEachChild(node, visit);
  }
  visit(expression.condition);
  const resolvedCall = selectedDefaultCall.node;
  if (resolvedCall === null) return null;
  const calleePath = memberPath(resolvedCall.expression);
  return { function_name: calleePath.at(-1)!, location: sourceLocation(expression.getSourceFile(), resolvedCall) };
}

function exportedLocalName(file: ts.SourceFile, exportedName: string): string | null {
  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause || !ts.isNamedExports(statement.exportClause)) continue;
    const specifier = statement.exportClause.elements.find((element) => element.name.text === exportedName);
    if (specifier) return specifier.propertyName?.text ?? specifier.name.text;
  }
  return null;
}

function exportedFunctionParameters(file: ts.SourceFile, localName: string): string[] {
  let parameters: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isFunctionDeclaration(node) && node.name?.text === localName) parameters = node.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : "pattern");
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === localName && node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) parameters = node.initializer.parameters.map((parameter) => ts.isIdentifier(parameter.name) ? parameter.name.text : "pattern");
    ts.forEachChild(node, visit);
  }
  visit(file);
  return parameters;
}

function propertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteralLike(name)) return name.text;
  if (ts.isComputedPropertyName(name) && ts.isStringLiteralLike(name.expression)) return name.expression.text;
  return undefined;
}

function extractFormConditions(file: ts.SourceFile, controlFields: ReadonlySet<string>): z.infer<typeof formConditionSchema>[] {
  const conditions: z.infer<typeof formConditionSchema>[] = [];
  function visit(node: ts.Node): void {
    if (ts.isIfStatement(node)) {
      const details = modelTypeComparison(node.expression);
      const fields = [...new Set([...settingsFieldsIn(node.thenStatement), ...(node.elseStatement ? settingsFieldsIn(node.elseStatement) : [])])].filter((field) => controlFields.has(field)).sort();
      if (details !== null || fields.length > 0) conditions.push({ location: sourceLocation(file, node.expression), condition_ast: expressionToIR(file, node.expression), condition_field: details?.field ?? null, static_value: details?.value ?? null, affected_settings_fields: fields, status: "EXPRESSION_CAPTURED_NOT_EVALUATED" });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return conditions.sort((left, right) => left.location.column - right.location.column);
}

function buildModelScopes(inventory: MaplessSettingsInventory, family: string, formId: string, controls: readonly z.infer<typeof formControlSchema>[], fallbackDefaults: readonly z.infer<typeof fallbackDefaultSchema>[]): z.infer<typeof modelScopeSchema>[] {
  return inventory.models.filter((model) => model.ai_name === family && model.active).map((model) => {
    const apiKeys = model.settings === null ? [] : Object.keys(model.settings).sort();
    const controlFields = controls.map((control) => control.field);
    return {
      model_id: model.model_id,
      active: model.active,
      preferred_model_variant: model.default,
      form_id: formId,
      form_control_fields: controlFields,
      api_settings_keys: apiKeys,
      controls_with_api_settings: controlFields.filter((field) => apiKeys.includes(field)).sort(),
      controls_without_api_settings: controlFields.filter((field) => !apiKeys.includes(field)).sort(),
      form_fallback_defaults: [...fallbackDefaults],
      setting_defaults_status: "DATA_DRIVEN_FALLBACK_MAP_WITH_DYNAMIC_OVERRIDES" as const
    };
  }).sort((left, right) => left.model_id.localeCompare(right.model_id));
}

function modelTypeComparison(expression: ts.Expression): { field: string; value: Literal } | null {
  if (!ts.isBinaryExpression(expression) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.EqualsEqualsToken].includes(expression.operatorToken.kind)) return null;
  const left = memberPath(expression.left);
  const right = primitive(expression.right);
  if (left.at(-2) === "settings" && left.at(-1) === "model_type" && right.found) return { field: "model_type", value: right.value };
  const reverseLeft = memberPath(expression.right);
  const reverseRight = primitive(expression.left);
  if (reverseLeft.at(-2) === "settings" && reverseLeft.at(-1) === "model_type" && reverseRight.found) return { field: "model_type", value: reverseRight.value };
  return null;
}

function settingsFieldsIn(node: ts.Node): string[] {
  const fields = new Set<string>();
  function visit(current: ts.Node): void {
    const path = memberPath(current);
    const index = path.lastIndexOf("settings");
    const field = index >= 0 ? path[index + 1] : undefined;
    if (field !== undefined && /^[A-Za-z][A-Za-z0-9_]{0,63}$/u.test(field)) fields.add(field);
    ts.forEachChild(current, visit);
  }
  visit(node);
  return [...fields];
}

function expressionUsesAnyField(expression: ts.Expression, fields: ReadonlySet<string>): boolean {
  return settingsFieldsIn(expression).some((field) => fields.has(field));
}

function memberPath(node: ts.Node): string[] {
  if (ts.isIdentifier(node)) return [node.text];
  if (ts.isPropertyAccessExpression(node)) return [...memberPath(node.expression), node.name.text];
  if (ts.isCallExpression(node)) return [...memberPath(node.expression), "()"];
  if (ts.isElementAccessExpression(node)) return [...memberPath(node.expression), "[]"];
  return [];
}

function expressionToIR(file: ts.SourceFile, node: ts.Node): unknown {
  if (ts.isParenthesizedExpression(node)) return expressionToIR(file, node.expression);
  if (ts.isStringLiteralLike(node)) return /^[A-Za-z0-9._:-]{1,80}$/u.test(node.text)
    ? { kind: "literal", value: node.text }
    : { kind: "omitted_string", length: node.text.length };
  if (ts.isNumericLiteral(node)) return { kind: "literal", value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { kind: "literal", value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { kind: "literal", value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { kind: "literal", value: null };
  if (ts.isIdentifier(node)) return { kind: "identifier", name: node.text };
  if (ts.isPropertyAccessExpression(node)) {
    const path = memberPath(node);
    const settingIndex = path.lastIndexOf("settings");
    if (settingIndex >= 0 && settingIndex + 1 < path.length) return { kind: "setting_field", field: path[settingIndex + 1] };
    return { kind: "member", base: expressionToIR(file, node.expression), property: node.name.text };
  }
  if (ts.isElementAccessExpression(node)) return { kind: "indexed", base: expressionToIR(file, node.expression), key: node.argumentExpression ? expressionToIR(file, node.argumentExpression) : { kind: "unknown", syntax_kind: "missing_key" } };
  if (ts.isBinaryExpression(node)) return { kind: "binary", operator: node.operatorToken.getText(file), left: expressionToIR(file, node.left), right: expressionToIR(file, node.right) };
  if (ts.isConditionalExpression(node)) return { kind: "conditional", condition: expressionToIR(file, node.condition), when_true: expressionToIR(file, node.whenTrue), when_false: expressionToIR(file, node.whenFalse) };
  if (ts.isCallExpression(node)) return { kind: "call", callee: expressionToIR(file, node.expression), arguments: node.arguments.slice(0, 8).map((arg) => expressionToIR(file, arg)) };
  if (ts.isArrayLiteralExpression(node)) return { kind: "array", items: node.elements.slice(0, 20).map((element) => expressionToIR(file, element)) };
  if (ts.isObjectLiteralExpression(node)) return { kind: "object", properties: node.properties.filter(ts.isPropertyAssignment).slice(0, 32).map((property) => ({ key: propertyName(property.name) ?? "computed", value: expressionToIR(file, property.initializer) })) };
  if (ts.isPrefixUnaryExpression(node)) {
    const evaluated = primitive(node);
    return evaluated.found ? { kind: "literal", value: evaluated.value } : { kind: "prefix", operator: ts.SyntaxKind[node.operator], operand: expressionToIR(file, node.operand) };
  }
  if (ts.isVoidExpression(node)) return isOmittedVoid(node) ? { kind: "undefined" } : { kind: "unknown", syntax_kind: "void_expression_not_resolved" };
  return { kind: "unknown", syntax_kind: ts.SyntaxKind[node.kind] };
}

function primitive(node: ts.Expression): { found: true; value: Literal } | { found: false } {
  if (ts.isStringLiteralLike(node) && /^[A-Za-z0-9._:-]{1,80}$/u.test(node.text)) return { found: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { found: true, value: Number(node.text) };
  if (node.kind === ts.SyntaxKind.TrueKeyword) return { found: true, value: true };
  if (node.kind === ts.SyntaxKind.FalseKeyword) return { found: true, value: false };
  if (node.kind === ts.SyntaxKind.NullKeyword) return { found: true, value: null };
  if (ts.isPrefixUnaryExpression(node) && node.operator === ts.SyntaxKind.ExclamationToken) {
    const operand = primitive(node.operand);
    if (operand.found) return { found: true, value: !Boolean(operand.value) };
  }
  return { found: false };
}

function isOmittedVoid(node: ts.Expression): boolean {
  return ts.isVoidExpression(node) && ts.isNumericLiteral(node.expression) && Number(node.expression.text) === 0;
}
