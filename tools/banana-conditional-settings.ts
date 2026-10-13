export interface PinnedBananaConditionalSource {
  readonly module_name: "banana.js";
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly text: string;
}

export interface BananaConditionalModelBinding {
  readonly model_id: string;
  readonly ai_name: string;
  readonly active: boolean;
  readonly form_id: string;
}

export interface AnalyzeBananaConditionalSettingsInput {
  readonly form_source: PinnedBananaConditionalSource;
  readonly expected_source: Omit<PinnedBananaConditionalSource, "text">;
  readonly public_catalog_version: string;
  readonly settings_inventory_version: string;
  readonly observed_homepage_build_id: string;
  readonly models: readonly BananaConditionalModelBinding[];
  readonly form_control_ref: string;
  readonly form_control_sha256: string;
  readonly existing_ratio_evidence_ref: string;
  readonly existing_ratio_evidence_sha256: string;
}

import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";
import {
  generationContractV2ParameterNodeSchema,
  type GenerationContractV2ParameterNode
} from "../src/domain/generation-contract-v2.js";

const MAX_SOURCE_BYTES = 5_000_000;
const MAX_AST_NODES = 250_000;
const PINNED_BUILD = "1791467421";
const PINNED_PUBLIC_CATALOG = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const PINNED_SETTINGS_INVENTORY = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const PINNED_FORM_CONTROL_REF = "catalog/runtime/v11/static-form-control-analysis-v1.6-e5517ee5-87e96b78-26627f87a943cc9a.json";
const PINNED_FORM_CONTROL_SHA = "sha256:26627f87a943cc9a2a40ca159217f3e2e7f26232d58a9d5d5b9469d05d43ec50";
const PINNED_RATIO_REF = `${PINNED_FORM_CONTROL_REF}#/forms/banana/controls/aspect_ratio`;
const MODEL_IDS = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light"] as const;
const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const sourceRefSchema = z.object({ module_name: z.literal("banana.js"), url: z.url(), bytes: z.number().int().positive().max(MAX_SOURCE_BYTES), sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u) }).strict();
const fieldEvidenceSchema = z.object({
  status: z.enum(["CONTROL_PRESENT", "CONTROL_NOT_RENDERED", "EXISTING_STATIC_EVIDENCE_REFERENCE"]),
  allowed_values: z.array(z.string().max(64)).max(64),
  default_candidate: z.string().max(64).nullable(),
  binding_location: locationSchema.nullable(),
  condition_location: locationSchema.nullable(),
  options_location: locationSchema.nullable(),
  default_location: locationSchema.nullable(),
  evidence_ref: z.string().max(500).nullable()
}).strict();
const scalarParameterSchema = z.record(z.string(), generationContractV2ParameterNodeSchema);
const parameterSchemaCandidate = z.object({
  type: z.literal("object"),
  additional_properties: z.literal(false),
  required: z.array(z.string().max(64)).max(64),
  properties: scalarParameterSchema,
  conditions: z.array(z.unknown()).max(64),
  conditional_enums: z.array(z.unknown()).max(64)
}).strict();
const modelCandidateSchema = z.object({
  model_id: z.string().min(1).max(160),
  ai_name: z.literal("banana"),
  operation_id: z.literal("generate-image"),
  parameter_schema_status: z.literal("STATIC_UI_CANDIDATE_NOT_WIRE_REVIEW"),
  parameter_schema: parameterSchemaCandidate,
  field_evidence: z.object({
    model_type: fieldEvidenceSchema,
    aspect_ratio: fieldEvidenceSchema,
    image_size: fieldEvidenceSchema,
    thinking_level: fieldEvidenceSchema
  }).strict()
}).strict();

export const bananaConditionalSettingsArtifactSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("BANANA_CONDITIONAL_SETTINGS_CANDIDATES"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST"),
  runtime_usable: z.literal(false),
  current_ui_status: z.literal("SOURCE_BUILD_MATCHES_HOME_BUILD_NOT_UI_VERIFIED"),
  public_catalog_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  settings_inventory_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  source_build_id: z.string().regex(/^\d{6,20}$/u),
  observed_homepage_build_id: z.string().regex(/^\d{6,20}$/u),
  source_refs: z.array(sourceRefSchema).min(1).max(4),
  form_binding: z.object({
    form_id: z.literal("banana"), module_name: z.literal("banana.js"), source_sha256: z.string().regex(/^sha256:[a-f0-9]{64}$/u),
    settings3_module: z.literal("./settings3.js"), factory_call_count: z.literal(1), operation_modality: z.literal("image"), ai_name: z.literal("banana"),
    model_ids: z.array(z.string().min(1).max(160)).length(5), model_type_binding_location: locationSchema,
    form_control_artifact_ref: z.literal(PINNED_FORM_CONTROL_REF), form_control_artifact_sha256: z.literal(PINNED_FORM_CONTROL_SHA)
  }).strict(),
  existing_ratio_evidence: z.object({ field: z.literal("aspect_ratio"), artifact_ref: z.literal(PINNED_RATIO_REF), sha256: z.literal(PINNED_FORM_CONTROL_SHA), reused_without_reenumeration: z.literal(true) }).strict(),
  image_size_source: z.object({
    field: z.literal("image_size"), guard_model_ids: z.array(z.string().min(1).max(160)).length(4),
    switch_options_by_model: z.record(z.string(), z.array(z.string().max(64))),
    default_rule: z.object({ model_type_equals: z.literal("banana3_light"), when_true: z.literal("1K"), otherwise: z.literal("2K"), status: z.literal("UI_DEFAULT_CANDIDATE_ONLY") }).strict(),
    binding_location: locationSchema, condition_location: locationSchema, switch_location: locationSchema, default_location: locationSchema
  }).strict(),
  thinking_level_source: z.object({
    field: z.literal("thinking_level"), options_by_model: z.record(z.string(), z.array(z.string().max(64))),
    default_by_model: z.record(z.string(), z.string().max(64)), guard_expression: z.literal("d.value"),
    binding_location: locationSchema, condition_location: locationSchema, options_location: locationSchema, default_location: locationSchema
  }).strict(),
  model_candidates: z.array(modelCandidateSchema).length(5),
  blockers: z.array(z.string().min(1).max(256)).max(32)
}).strict();

export type BananaConditionalSettingsArtifact = z.infer<typeof bananaConditionalSettingsArtifactSchema>;

export class BananaConditionalSettingsError extends Error {
  constructor(readonly code: "SOURCE_BINDING_INVALID" | "SOURCE_SIZE_MISMATCH" | "SOURCE_HASH_MISMATCH" | "AST_PARSE_FAILED" | "MODEL_BINDING_MISMATCH" | "FORM_FACTORY_UNRESOLVED" | "CONTROL_CONDITION_UNRESOLVED" | "STATIC_EXPRESSION_UNRESOLVED") {
    super(code);
    this.name = "BananaConditionalSettingsError";
  }
}

export function analyzeBananaConditionalSettings(input: AnalyzeBananaConditionalSettingsInput): BananaConditionalSettingsArtifact {
  validateInput(input);
  const file = ts.createSourceFile(input.form_source.module_name, input.form_source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length > 0 || countNodes(file) > MAX_AST_NODES) throw new BananaConditionalSettingsError("AST_PARSE_FAILED");
  const factory = findSettings3FactoryCall(file);
  const activeModels = validateModels(input.models);
  const modelTypeBinding = findControlBinding(file, "model_type");
  const imageBinding = findControlBinding(file, "image_size");
  const thinkingBinding = findControlBinding(file, "thinking_level");
  const imageCondition = findImageSizeCondition(imageBinding);
  const thinkingCondition = findThinkingLevelCondition(file, thinkingBinding);
  const switchOptions = extractImageSizeSwitch(file);
  const imageDefault = extractImageSizeDefault(file);
  const thinkingOptions = extractThinkingOptions(file);
  const thinkingDefault = extractThinkingDefault(file);
  if (!containsPath(imageCondition.branch, "k.value") || !containsPath(thinkingCondition.branch, "d.value")) throw new BananaConditionalSettingsError("CONTROL_CONDITION_UNRESOLVED");

  const imageIds = new Set(imageCondition.modelIds);
  const candidates = activeModels.map((model) => {
    const modelId = model.model_id;
    const hasImageSize = imageIds.has(modelId);
    const imageValues = hasImageSize ? switchOptions.byModel[modelId] ?? [] : [];
    if (hasImageSize && imageValues.length === 0) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
    const thinkingValues = thinkingOptions.byModel[modelId] ?? [];
    const imageDefaultValue = !hasImageSize ? null : modelId === imageDefault.modelId ? imageDefault.whenTrue : imageDefault.otherwise;
    const thinkingDefaultValue = thinkingValues.length === 0 ? null : thinkingDefault.value;
    const properties: Record<string, GenerationContractV2ParameterNode> = {
      model_type: generationContractV2ParameterNodeSchema.parse({ type: "string", enum: [modelId] }),
      aspect_ratio: generationContractV2ParameterNodeSchema.parse({ type: "string", nullable: true })
    };
    if (hasImageSize) properties.image_size = generationContractV2ParameterNodeSchema.parse({ type: "string", enum: imageValues });
    if (thinkingValues.length > 0) properties.thinking_level = generationContractV2ParameterNodeSchema.parse({ type: "string", enum: thinkingValues });
    const fieldEvidence = {
      model_type: makeFieldEvidence("CONTROL_PRESENT", [modelId], null, modelTypeBinding, null, null, null, null),
      aspect_ratio: makeFieldEvidence("EXISTING_STATIC_EVIDENCE_REFERENCE", [], null, null, null, null, null, PINNED_RATIO_REF),
      image_size: makeFieldEvidence(hasImageSize ? "CONTROL_PRESENT" : "CONTROL_NOT_RENDERED", imageValues, imageDefaultValue, imageBinding, imageCondition.location, switchOptions.location, imageDefault.location, null),
      thinking_level: makeFieldEvidence(thinkingValues.length > 0 ? "CONTROL_PRESENT" : "CONTROL_NOT_RENDERED", thinkingValues, thinkingDefaultValue, thinkingBinding, thinkingCondition.location, thinkingOptions.location, thinkingDefault.location, null)
    };
    return modelCandidateSchema.parse({
      model_id: modelId, ai_name: "banana", operation_id: "generate-image", parameter_schema_status: "STATIC_UI_CANDIDATE_NOT_WIRE_REVIEW",
      parameter_schema: { type: "object", additional_properties: false, required: ["model_type"], properties, conditions: [], conditional_enums: [] },
      field_evidence: fieldEvidence
    });
  });

  return bananaConditionalSettingsArtifactSchema.parse({
    schema_version: "1.0.0", catalog_kind: "BANANA_CONDITIONAL_SETTINGS_CANDIDATES", evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    runtime_usable: false, current_ui_status: "SOURCE_BUILD_MATCHES_HOME_BUILD_NOT_UI_VERIFIED",
    public_catalog_version: input.public_catalog_version, settings_inventory_version: input.settings_inventory_version,
    source_build_id: input.expected_source.url.match(/\/assets\/(\d+)\/banana\.js$/u)?.[1], observed_homepage_build_id: input.observed_homepage_build_id,
    source_refs: [{ module_name: "banana.js", url: input.form_source.url, bytes: input.form_source.bytes, sha256: input.form_source.sha256 }],
    form_binding: {
      form_id: "banana", module_name: "banana.js", source_sha256: input.form_source.sha256, settings3_module: "./settings3.js", factory_call_count: 1,
      operation_modality: factory.modality, ai_name: factory.aiName, model_ids: activeModels.map((model) => model.model_id), model_type_binding_location: location(modelTypeBinding),
      form_control_artifact_ref: input.form_control_ref, form_control_artifact_sha256: input.form_control_sha256
    },
    existing_ratio_evidence: { field: "aspect_ratio", artifact_ref: input.existing_ratio_evidence_ref, sha256: input.existing_ratio_evidence_sha256, reused_without_reenumeration: true },
    image_size_source: {
      field: "image_size", guard_model_ids: imageCondition.modelIds,
      switch_options_by_model: Object.fromEntries(activeModels.filter((model) => imageIds.has(model.model_id)).map((model) => [model.model_id, switchOptions.byModel[model.model_id] ?? []])),
      default_rule: { model_type_equals: imageDefault.modelId, when_true: imageDefault.whenTrue, otherwise: imageDefault.otherwise, status: "UI_DEFAULT_CANDIDATE_ONLY" },
      binding_location: location(imageBinding), condition_location: imageCondition.location, switch_location: switchOptions.location, default_location: imageDefault.location
    },
    thinking_level_source: {
      field: "thinking_level", options_by_model: thinkingOptions.byModel, default_by_model: Object.fromEntries(Object.keys(thinkingOptions.byModel).map((modelId) => [modelId, thinkingDefault.value])),
      guard_expression: "d.value", binding_location: location(thinkingBinding), condition_location: thinkingCondition.location, options_location: thinkingOptions.location, default_location: thinkingDefault.location
    },
    model_candidates: candidates,
    blockers: ["SOURCE_BUILD_NOT_CONFIRMED_CURRENT", "UI_CANDIDATE_NOT_WIRE_VERIFIED", "RATIO_ENUM_REUSED_FROM_PRIOR_ARTIFACT", "WATCHER_EFFECTIVE_DEFAULTS_NOT_PROVEN"]
  });
}

function validateInput(input: AnalyzeBananaConditionalSettingsInput): void {
  const source = input.form_source;
  const pin = input.expected_source;
  let parsed: URL;
  try { parsed = new URL(source.url); } catch { throw new BananaConditionalSettingsError("SOURCE_BINDING_INVALID"); }
  const buildId = parsed.pathname.split("/")[2];
  if (source.module_name !== "banana.js" || pin.module_name !== source.module_name || parsed.protocol !== "https:" || parsed.hostname !== "syntx.ai" || parsed.pathname !== `/assets/${buildId}/banana.js` || buildId !== PINNED_BUILD || source.url !== pin.url) throw new BananaConditionalSettingsError("SOURCE_BINDING_INVALID");
  if (source.bytes > MAX_SOURCE_BYTES || source.bytes !== pin.bytes || source.bytes !== Buffer.byteLength(source.text, "utf8")) throw new BananaConditionalSettingsError("SOURCE_SIZE_MISMATCH");
  const actual = `sha256:${createHash("sha256").update(source.text, "utf8").digest("hex")}`;
  if (source.sha256 !== pin.sha256 || actual !== source.sha256) throw new BananaConditionalSettingsError("SOURCE_HASH_MISMATCH");
  if (input.observed_homepage_build_id !== PINNED_BUILD || input.public_catalog_version !== PINNED_PUBLIC_CATALOG || input.settings_inventory_version !== PINNED_SETTINGS_INVENTORY || input.form_control_ref !== PINNED_FORM_CONTROL_REF || input.form_control_sha256 !== PINNED_FORM_CONTROL_SHA || input.existing_ratio_evidence_ref !== PINNED_RATIO_REF || input.existing_ratio_evidence_sha256 !== PINNED_FORM_CONTROL_SHA) throw new BananaConditionalSettingsError("MODEL_BINDING_MISMATCH");
}

function validateModels(models: readonly BananaConditionalModelBinding[]): BananaConditionalModelBinding[] {
  const found = models.filter((model) => model.active && model.ai_name === "banana" && model.form_id === "banana").map((model) => model.model_id).sort();
  const expected = [...MODEL_IDS].sort();
  if (found.length !== expected.length || found.some((modelId, index) => modelId !== expected[index]) || new Set(found).size !== found.length) throw new BananaConditionalSettingsError("MODEL_BINDING_MISMATCH");
  return [...models].filter((model) => model.active && model.ai_name === "banana" && model.form_id === "banana").sort((a, b) => a.model_id.localeCompare(b.model_id));
}

function findSettings3FactoryCall(file: ts.SourceFile): { modality: "image"; aiName: "banana" } {
  const importedLocals = new Set<string>();
  for (const statement of file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || statement.moduleSpecifier.text !== "./settings3.js") continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) if ((element.propertyName?.text ?? element.name.text) === "u") importedLocals.add(element.name.text);
  }
  const calls: ts.CallExpression[] = [];
  visit(file, (node) => { if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && importedLocals.has(node.expression.text)) calls.push(node); });
  if (calls.length !== 1 || literal(calls[0]!.arguments[0]!) !== "image" || literal(calls[0]!.arguments[1]!) !== "banana") throw new BananaConditionalSettingsError("FORM_FACTORY_UNRESOLVED");
  return { modality: "image", aiName: "banana" };
}

function findControlBinding(file: ts.SourceFile, field: string): ts.PropertyAssignment {
  const matches: ts.PropertyAssignment[] = [];
  visit(file, (node) => {
    if (ts.isPropertyAssignment(node) && propertyName(node.name) === "modelValue" && isSettingsField(node.initializer, field)) matches.push(node);
  });
  if (matches.length !== 1) throw new BananaConditionalSettingsError("CONTROL_CONDITION_UNRESOLVED");
  return matches[0]!;
}

function findImageSizeCondition(control: ts.Node): { modelIds: string[]; location: { line: number; column: number }; branch: ts.Expression } {
  const matches = ancestorConditionals(control).flatMap((node) => {
    const condition = node.condition;
    if (!ts.isCallExpression(condition) || !ts.isPropertyAccessExpression(condition.expression) || condition.expression.name.text !== "includes" || !ts.isArrayLiteralExpression(condition.expression.expression)) return [];
    if (condition.arguments.length !== 1 || !isSettingsField(condition.arguments[0]!, "model_type")) return [];
    const modelIds = condition.expression.expression.elements.map(literal).filter((value): value is string => typeof value === "string");
    if (!containsNode(node.whenTrue, control)) return [];
    return [{ modelIds, location: location(node), branch: node.whenTrue }];
  });
  if (matches.length !== 1 || matches[0]!.modelIds.join("|") !== "banana2|banana3|banana3_light|banana-2.1") throw new BananaConditionalSettingsError("CONTROL_CONDITION_UNRESOLVED");
  return matches[0]!;
}

function findThinkingLevelCondition(file: ts.SourceFile, control: ts.Node): { location: { line: number; column: number }; branch: ts.Expression } {
  const matches = ancestorConditionals(control).filter((node) => isIdentifierProperty(node.condition, "d", "value") && containsNode(node.whenTrue, control));
  if (matches.length !== 1) throw new BananaConditionalSettingsError("CONTROL_CONDITION_UNRESOLVED");
  const computed = findVariable(file, "d");
  if (!computed || !usesModelMapLookup(computed.initializer, "F")) throw new BananaConditionalSettingsError("CONTROL_CONDITION_UNRESOLVED");
  return { location: location(matches[0]!), branch: matches[0]!.whenTrue };
}

function extractImageSizeSwitch(file: ts.SourceFile): { location: { line: number; column: number }; byModel: Record<string, string[]> } {
  const switches: ts.SwitchStatement[] = [];
  visit(file, (node) => { if (ts.isSwitchStatement(node) && isSettingsField(node.expression, "model_type")) switches.push(node); });
  if (switches.length !== 1) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  const node = switches[0]!;
  const byModel: Record<string, string[]> = {};
  const clauses = node.caseBlock.clauses;
  for (let index = 0; index < clauses.length; index += 1) {
    const clause = clauses[index]!;
    const modelId = ts.isCaseClause(clause) ? literal(clause.expression) : "__default__";
    if (typeof modelId !== "string") throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
    let selected: string[] | null = null;
    for (let scan = index; scan < clauses.length && selected === null; scan += 1) {
      for (const statement of clauses[scan]!.statements) {
        if (!ts.isReturnStatement(statement) || statement.expression === undefined) continue;
        if (!ts.isArrayLiteralExpression(statement.expression)) break;
        const values = statement.expression.elements.map(literal);
        if (values.some((value) => typeof value !== "string")) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
        selected = values as string[];
        break;
      }
    }
    if (selected === null) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
    if (modelId !== "__default__") byModel[modelId] = selected;
  }
  const expected: Record<string, string[]> = { banana2: ["1K", "2K", "4K"], "banana-2.1": ["1K", "2K", "4K"], banana3: ["0.5K", "1K", "2K", "4K"], banana3_light: ["1K"] };
  if (JSON.stringify(byModel) !== JSON.stringify(expected)) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  return { location: location(node), byModel };
}

function extractImageSizeDefault(file: ts.SourceFile): { modelId: "banana3_light"; whenTrue: "1K"; otherwise: "2K"; location: { line: number; column: number } } {
  const declaration = findVariable(file, "p");
  const arrow = firstArrowArgument(declaration?.initializer);
  const expression = arrow && ts.isConditionalExpression(arrow.body) ? arrow.body : null;
  if (!expression || !isStrictModelTypeEquals(expression.condition, "banana3_light") || literal(expression.whenTrue) !== "1K" || literal(expression.whenFalse) !== "2K") throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  return { modelId: "banana3_light", whenTrue: "1K", otherwise: "2K", location: location(expression) };
}

function extractThinkingOptions(file: ts.SourceFile): { location: { line: number; column: number }; byModel: Record<string, string[]> } {
  const declaration = findVariable(file, "F");
  if (!declaration?.initializer || !ts.isObjectLiteralExpression(declaration.initializer)) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  const byModel: Record<string, string[]> = {};
  for (const property of declaration.initializer.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isArrayLiteralExpression(property.initializer)) continue;
    const modelId = propertyName(property.name);
    if (!modelId) continue;
    const values = property.initializer.elements.map(literal);
    if (values.some((value) => typeof value !== "string")) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
    byModel[modelId] = values as string[];
  }
  if (Object.keys(byModel).join("|") !== "banana-2.1" || byModel["banana-2.1"]!.join("|") !== "minimal|medium|high") throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  return { location: location(declaration), byModel };
}

function extractThinkingDefault(file: ts.SourceFile): { value: "medium"; location: { line: number; column: number } } {
  const declaration = findVariable(file, "St");
  if (!declaration || declaration.initializer === undefined || literal(declaration.initializer) !== "medium") throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  const candidates: ts.ConditionalExpression[] = [];
  visit(file, (node) => { if (ts.isConditionalExpression(node) && isIdentifierProperty(node.condition, "d", "value") && ts.isIdentifier(node.whenTrue) && node.whenTrue.text === "St" && node.whenFalse.kind === ts.SyntaxKind.VoidExpression) candidates.push(node); });
  if (candidates.length !== 1) throw new BananaConditionalSettingsError("STATIC_EXPRESSION_UNRESOLVED");
  return { value: "medium", location: location(candidates[0]!) };
}

function makeFieldEvidence(status: "CONTROL_PRESENT" | "CONTROL_NOT_RENDERED" | "EXISTING_STATIC_EVIDENCE_REFERENCE", allowed: string[], defaultCandidate: string | null, binding: ts.Node | null, condition: { line: number; column: number } | null, options: { line: number; column: number } | null, defaultLocation: { line: number; column: number } | null, evidenceRef: string | null) {
  return { status, allowed_values: allowed, default_candidate: defaultCandidate, binding_location: binding ? location(binding) : null, condition_location: condition, options_location: options, default_location: defaultLocation, evidence_ref: evidenceRef };
}

function location(node: ts.Node): { line: number; column: number } { const p = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart()); return { line: p.line + 1, column: p.character + 1 }; }
function propertyName(name: ts.PropertyName): string | null { return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : null; }
function literal(node: ts.Node): unknown { if (ts.isStringLiteral(node)) return node.text; if (ts.isNumericLiteral(node)) return Number(node.text); if (node.kind === ts.SyntaxKind.NullKeyword) return null; if (node.kind === ts.SyntaxKind.TrueKeyword) return true; if (node.kind === ts.SyntaxKind.FalseKeyword) return false; return undefined; }
function isSettingsField(node: ts.Node, field: string): boolean { return isPropertyPath(node, ["settings", field]); }
function isIdentifierProperty(node: ts.Node, root: string, property: string): boolean { return ts.isPropertyAccessExpression(node) && node.name.text === property && ts.isIdentifier(node.expression) && node.expression.text === root; }
function isPropertyPath(node: ts.Node, expected: readonly string[]): boolean { const result: string[] = []; let current = node; while (ts.isPropertyAccessExpression(current)) { result.unshift(current.name.text); current = current.expression; } return ts.isIdentifier(current) && result.length >= expected.length && result.slice(-expected.length).join(".") === expected.join("."); }
function isStrictModelTypeEquals(node: ts.Node, modelId: string): boolean { return ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ((isSettingsField(node.left, "model_type") && literal(node.right) === modelId) || (isSettingsField(node.right, "model_type") && literal(node.left) === modelId)); }
function findVariable(file: ts.SourceFile, name: string): ts.VariableDeclaration | null { const found: ts.VariableDeclaration[] = []; visit(file, (node) => { if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found.push(node); }); return found.length === 1 ? found[0]! : null; }
function firstArrowArgument(node: ts.Node | undefined): ts.ArrowFunction | null { return node && ts.isCallExpression(node) && node.arguments[0] && ts.isArrowFunction(node.arguments[0]) ? node.arguments[0] : null; }
function usesModelMapLookup(node: ts.Node | undefined, mapName: string): boolean { const arrow = firstArrowArgument(node); if (!arrow || !ts.isBinaryExpression(arrow.body) || arrow.body.operatorToken.kind !== ts.SyntaxKind.BarBarToken || arrow.body.right.kind !== ts.SyntaxKind.NullKeyword) return false; const left = arrow.body.left; return ts.isElementAccessExpression(left) && ts.isIdentifier(left.expression) && left.expression.text === mapName && isSettingsField(left.argumentExpression!, "model_type"); }
function ancestorConditionals(node: ts.Node): ts.ConditionalExpression[] { const found: ts.ConditionalExpression[] = []; for (let current: ts.Node | undefined = node.parent; current; current = current.parent) if (ts.isConditionalExpression(current)) found.push(current); return found; }
function containsNode(root: ts.Node, wanted: ts.Node): boolean { return root === wanted || (root.getStart() <= wanted.getStart() && root.end >= wanted.end); }
function containsPath(root: ts.Node, expected: string): boolean { let found = false; visit(root, (node) => { if (ts.isPropertyAccessExpression(node) && node.name.text === "value" && ts.isIdentifier(node.expression) && `${node.expression.text}.value` === expected) found = true; }); return found; }
function visit(root: ts.Node, callback: (node: ts.Node) => void): void { const traverse = (node: ts.Node): void => { callback(node); ts.forEachChild(node, traverse); }; traverse(root); }
function countNodes(root: ts.Node): number { let count = 0; visit(root, () => { count += 1; }); return count; }
