import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";
import { maplessSettingsInventorySchema, type MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";

const shaSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/u);
const locationSchema = z.object({ line: z.number().int().positive(), column: z.number().int().positive() }).strict();
const sourceSchema = z.object({
  module_name: z.string().min(1).max(128),
  url: z.string().url(),
  bytes: z.number().int().positive().max(5_000_000),
  sha256: shaSchema,
  capture_status: z.enum(["NEWLY_PINNED_BOUNDED_GET", "REUSED_HASH_PINNED_PRIOR_REFERENCE", "REUSED_HASH_PINNED_INVENTORY"]).optional(),
  first_fetched_at: z.string().datetime({ offset: true }).nullable().optional()
}).strict();
const settingMappingSchema = z.object({
  setting_key: z.string().min(1).max(128),
  setter: z.string().min(1).max(128),
  key_case: locationSchema,
  setter_call: locationSchema
}).strict();
const factoryCallSchema = z.object({
  form_id: z.string().min(1),
  module_name: z.string().min(1),
  active_model_ids: z.array(z.string().min(1)).max(10_000),
  status: z.enum(["EXACTLY_ONE_FACTORY_CALL", "NO_GENERIC_FACTORY_CALL", "MULTIPLE_FACTORY_CALLS", "CALLER_DOES_NOT_MATCH_INVENTORY_FORM"]),
  imported_symbol: z.literal("u").nullable(),
  local_symbol: z.string().nullable(),
  call_location: locationSchema.nullable(),
  call_kind: z.string().nullable(),
  call_ai_name: z.string().nullable()
}).strict();
const operationSchema = z.object({
  method: z.literal("POST"),
  route: z.enum(["design/generate", "video/generate"]),
  modality: z.enum(["IMAGE", "VIDEO"]),
  body_fields: z.array(z.string().min(1).max(128)).max(16),
  settings_source: z.enum(["FIFTH_ARGUMENT_REPLACES_INITIAL_STORE_SPREAD", "FIFTH_ARGUMENT_OBJECT_SPREAD", "UNKNOWN"]),
  settings_overwrite_guard: z.enum(["UNCONDITIONAL", "CONDITIONAL", "NOT_APPLICABLE", "UNKNOWN"]),
  settings_input_parameter_index: z.number().int().nonnegative().nullable(),
  settings_replacement_location: locationSchema.nullable(),
  settings_expression: z.string().min(1).max(256),
  route_argument_source: z.enum(["APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED", "CUSTOM_PAYLOAD_ELSE_APP_SETTINGS", "NOT_RESOLVED"]),
  route_argument_index: z.number().int().nonnegative().nullable(),
  route_argument_location: locationSchema.nullable(),
  file_urls_overwritten_after_settings: z.boolean(),
  constructor_location: locationSchema,
  dispatch_location: locationSchema,
  unresolved_reasons: z.array(z.enum([
    "IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN",
    "DYNAMIC_SETTINGS_FIELDS_NOT_ENUMERATED",
    "WATCHER_AND_RUNTIME_OVERRIDES_NOT_EVALUATED",
    "BACKEND_ACCEPTANCE_NOT_PROVEN"
  ])).max(8)
}).strict();
const payloadSetterCallSchema = z.object({
  module_name: z.string().min(1).max(128),
  location: locationSchema,
  argument_kind: z.enum(["NULL_LITERAL", "IDENTIFIER", "OBJECT_LITERAL", "CONDITIONAL", "OTHER"]),
  argument_is_null: z.boolean()
}).strict();

export const maplessMediaRequestClosureSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("MAPLESS_MEDIA_REQUEST_CLOSURE"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST"),
  runtime_usable: z.literal(false),
  backend_accepted: z.literal(false),
  vendor_code_executed: z.literal(false),
  source_persisted: z.literal(false),
  public_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  settings_version: z.string().regex(/^sha256-[a-f0-9]{64}\.json$/u),
  build_id: z.string().regex(/^\d{6,20}$/u),
  sources: z.array(sourceSchema).min(4).max(64),
  default_semantics: z.object({
    policy: z.enum(["TRUTHY_FALLBACK", "NULLISH_FALLBACK", "UNKNOWN"]),
    location: locationSchema.nullable()
  }).strict(),
  setter_mappings: z.array(settingMappingSchema).max(128),
  form_factory_calls: z.array(factoryCallSchema).max(100),
  custom_payload_setter_calls: z.array(payloadSetterCallSchema).max(256),
  custom_payload_producer_status: z.enum(["NON_NULL_CALLS_NOT_LINKED_TO_TARGET_FORM_SCOPE", "NULL_CLEANUP_ONLY", "NO_CALLS_OBSERVED"]),
  operations: z.array(operationSchema).length(2),
  blockers: z.array(z.enum([
    "SETTER_KEY_TO_CALL_MAPPING_NOT_PROVEN",
    "IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN",
    "CUSTOM_PAYLOAD_SETTER_CALLS_NOT_LINKED_TO_MODEL_SCOPE",
    "DYNAMIC_SETTINGS_FIELDS_NOT_ENUMERATED",
    "WATCHER_AND_RUNTIME_OVERRIDES_NOT_EVALUATED",
    "BACKEND_ACCEPTANCE_NOT_PROVEN",
    "FORM_FACTORY_CALLER_COVERAGE_INCOMPLETE"
  ])).max(16),
  limitations: z.array(z.string().min(1).max(512)).max(16)
}).strict();

export type MaplessMediaRequestClosure = z.infer<typeof maplessMediaRequestClosureSchema>;
export interface PinnedMediaRequestSource {
  module_name: string;
  url: string;
  bytes: number;
  sha256: string;
  text: string;
  capture_status?: "NEWLY_PINNED_BOUNDED_GET" | "REUSED_HASH_PINNED_PRIOR_REFERENCE" | "REUSED_HASH_PINNED_INVENTORY";
  first_fetched_at?: string | null;
}
export interface MaplessMediaRequestClosureInput {
  inventory: MaplessSettingsInventory;
  settings_version: string;
  sources: readonly PinnedMediaRequestSource[];
}

export class MaplessMediaRequestClosureError extends Error {
  constructor(readonly code: "SOURCE_BINDING_INVALID" | "SOURCE_SIZE_MISMATCH" | "SOURCE_HASH_MISMATCH" | "SOURCE_MISSING" | "AST_PARSE_FAILED" | "INVENTORY_INVALID" | "REQUEST_CONSTRUCTOR_UNRESOLVED") {
    super(code);
    this.name = "MaplessMediaRequestClosureError";
  }
}

interface ParsedSource {
  source: PinnedMediaRequestSource;
  file: ts.SourceFile;
}

/**
 * Extracts only source-backed media request construction and generic factory
 * call applicability. It never evaluates vendor code and is not a runtime contract.
 */
export function analyzeMaplessMediaRequestClosure(input: MaplessMediaRequestClosureInput): MaplessMediaRequestClosure {
  let inventory: MaplessSettingsInventory;
  try { inventory = maplessSettingsInventorySchema.parse(input.inventory); }
  catch { throw new MaplessMediaRequestClosureError("INVENTORY_INVALID"); }
  const parsed = new Map<string, ParsedSource>();
  for (const source of input.sources) {
    if (parsed.has(source.module_name)) throw new MaplessMediaRequestClosureError("SOURCE_BINDING_INVALID");
    const verified = validateSource(source, inventory.build.id);
    const file = ts.createSourceFile(source.module_name, source.text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
    if (diagnostics && diagnostics.length > 0) throw new MaplessMediaRequestClosureError("AST_PARSE_FAILED");
    parsed.set(source.module_name, { source: verified, file });
  }
  const settings3 = required(parsed, "settings3.js");
  if (settings3.source.url !== inventory.framework.settings3.url || settings3.source.bytes !== inventory.framework.settings3.bytes || settings3.source.sha256 !== inventory.framework.settings3.sha256) {
    throw new MaplessMediaRequestClosureError("SOURCE_BINDING_INVALID");
  }
  const imageRoute = required(parsed, "index6.js");
  const videoRoute = required(parsed, "index7.js");
  const sender = required(parsed, "video.js");
  const operations = [
    analyzeOperation(sender.file, "design/generate", imageRoute.file),
    analyzeOperation(sender.file, "video/generate", videoRoute.file)
  ].sort((a, b) => a.route.localeCompare(b.route));
  const callerInputs = new Map<string, ParsedSource>();
  for (const form of inventory.forms) {
    const source = parsed.get(form.module_name);
    if (source && source.source.url === form.javascript.url && source.source.bytes === form.javascript.bytes && source.source.sha256 === form.javascript.sha256) {
      callerInputs.set(form.form_id, source);
    }
  }
  const formFactoryCalls = inventory.forms.filter((form) => callerInputs.has(form.form_id)).map((form) => analyzeFormFactoryCall(
    form.form_id,
    form.module_name,
    inventory.models.filter((model) => model.active && model.form_id === form.form_id),
    callerInputs.get(form.form_id)
  ));
  const setterMappings = extractSetterMappings(settings3.file);
  const defaultSemantics = extractDefaultPolicy(settings3.file);
  const payloadSetterCalls = extractCustomPayloadSetterCalls(parsed);
  const customPayloadProducerStatus = payloadSetterCalls.some((call) => !call.argument_is_null)
    ? "NON_NULL_CALLS_NOT_LINKED_TO_TARGET_FORM_SCOPE" as const
    : payloadSetterCalls.length > 0 ? "NULL_CLEANUP_ONLY" as const : "NO_CALLS_OBSERVED" as const;
  const blockers = new Set<MaplessMediaRequestClosure["blockers"][number]>([
    "DYNAMIC_SETTINGS_FIELDS_NOT_ENUMERATED",
    "WATCHER_AND_RUNTIME_OVERRIDES_NOT_EVALUATED",
    "BACKEND_ACCEPTANCE_NOT_PROVEN"
  ]);
  if (setterMappings.length === 0) blockers.add("SETTER_KEY_TO_CALL_MAPPING_NOT_PROVEN");
  if (operations.some((operation) => operation.unresolved_reasons.includes("IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN"))) blockers.add("IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN");
  if (customPayloadProducerStatus === "NON_NULL_CALLS_NOT_LINKED_TO_TARGET_FORM_SCOPE") blockers.add("CUSTOM_PAYLOAD_SETTER_CALLS_NOT_LINKED_TO_MODEL_SCOPE");
  if (formFactoryCalls.some((form) => form.status !== "EXACTLY_ONE_FACTORY_CALL")) blockers.add("FORM_FACTORY_CALLER_COVERAGE_INCOMPLETE");
  const sources = [...parsed.values()].map(({ source }) => ({
    module_name: source.module_name,
    url: source.url,
    bytes: source.bytes,
    sha256: source.sha256,
    capture_status: source.capture_status ?? "REUSED_HASH_PINNED_PRIOR_REFERENCE",
    first_fetched_at: source.first_fetched_at ?? null
  })).sort((a, b) => a.module_name.localeCompare(b.module_name));
  return maplessMediaRequestClosureSchema.parse({
    schema_version: "1.0.0",
    catalog_kind: "MAPLESS_MEDIA_REQUEST_CLOSURE",
    evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    runtime_usable: false,
    backend_accepted: false,
    vendor_code_executed: false,
    source_persisted: false,
    public_version: inventory.public_catalog.version,
    settings_version: input.settings_version,
    build_id: inventory.build.id,
    sources,
    default_semantics: defaultSemantics,
    setter_mappings: setterMappings,
    form_factory_calls: formFactoryCalls,
    custom_payload_setter_calls: payloadSetterCalls,
    custom_payload_producer_status: customPayloadProducerStatus,
    operations,
    blockers: [...blockers].sort(),
    limitations: [
      "Form factory applicability links verified current form modules to active inventory model ids; it does not prove effective settings or HTTP acceptance for each model.",
      "Only the observed source branches and literal object-spread/replacement behavior are recorded; custom payload contents, watcher effects, and backend semantics remain unresolved.",
      "This static source closure is evidence only and is not executable runtime coverage."
    ]
  });
}

function validateSource(source: PinnedMediaRequestSource, buildId: string): PinnedMediaRequestSource {
  try {
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname !== "syntx.ai" || url.pathname.split("/")[2] !== buildId || !/^\/assets\/\d{6,20}\/[A-Za-z0-9][A-Za-z0-9._-]*\.js$/u.test(url.pathname)) throw new Error();
    if (source.bytes !== Buffer.byteLength(source.text, "utf8")) throw new MaplessMediaRequestClosureError("SOURCE_SIZE_MISMATCH");
    if (`sha256:${createHash("sha256").update(Buffer.from(source.text, "utf8")).digest("hex")}` !== source.sha256) throw new MaplessMediaRequestClosureError("SOURCE_HASH_MISMATCH");
    if (source.capture_status === "NEWLY_PINNED_BOUNDED_GET" && !source.first_fetched_at) throw new Error();
    if (source.bytes <= 0 || source.bytes > 5_000_000) throw new Error();
    return source;
  } catch (error) {
    if (error instanceof MaplessMediaRequestClosureError) throw error;
    throw new MaplessMediaRequestClosureError("SOURCE_BINDING_INVALID");
  }
}

function required(sources: Map<string, ParsedSource>, moduleName: string): ParsedSource {
  const source = sources.get(moduleName);
  if (!source) throw new MaplessMediaRequestClosureError("SOURCE_MISSING");
  return source;
}

function analyzeFormFactoryCall(formId: string, moduleName: string, models: MaplessSettingsInventory["models"], parsed: ParsedSource | undefined): MaplessMediaRequestClosure["form_factory_calls"][number] {
  const modelIds = models.map((model) => model.model_id);
  if (!parsed) return { form_id: formId, module_name: moduleName, active_model_ids: modelIds, status: "NO_GENERIC_FACTORY_CALL", imported_symbol: null, local_symbol: null, call_location: null, call_kind: null, call_ai_name: null };
  const importedLocals = new Map<string, string>();
  for (const statement of parsed.file.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier) || !statement.moduleSpecifier.text.endsWith("settings3.js")) continue;
    const bindings = statement.importClause?.namedBindings;
    if (!bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) if ((element.propertyName?.text ?? element.name.text) === "u") importedLocals.set(element.name.text, "u");
  }
  const calls: Array<{ local: string; node: ts.CallExpression }> = [];
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && importedLocals.has(node.expression.text)) calls.push({ local: node.expression.text, node });
    ts.forEachChild(node, visit);
  };
  visit(parsed.file);
  if (calls.length === 0) return { form_id: formId, module_name: moduleName, active_model_ids: modelIds, status: "NO_GENERIC_FACTORY_CALL", imported_symbol: "u", local_symbol: [...importedLocals.keys()][0] ?? null, call_location: null, call_kind: null, call_ai_name: null };
  const selected = calls[0]!;
  const callKind = literalText(selected.node.arguments[0]);
  const callAiName = literalText(selected.node.arguments[1]);
  const modelsMatch = models.length === 0 || models.every((model) => {
    const modalityMatches = model.public_type_label === null || callKind === null || model.public_type_label.toLowerCase() === callKind.toLowerCase();
    const aiNameMatches = callAiName === null || model.ai_name.toLowerCase() === callAiName.toLowerCase();
    return modalityMatches && aiNameMatches;
  });
  const status = calls.length !== 1 ? "MULTIPLE_FACTORY_CALLS" : !modelsMatch ? "CALLER_DOES_NOT_MATCH_INVENTORY_FORM" : "EXACTLY_ONE_FACTORY_CALL";
  return {
    form_id: formId,
    module_name: moduleName,
    active_model_ids: modelIds,
    status,
    imported_symbol: "u",
    local_symbol: selected.local,
    call_location: locator(parsed.file, selected.node),
    call_kind: callKind,
    call_ai_name: callAiName
  };
}

function extractSetterMappings(file: ts.SourceFile): MaplessMediaRequestClosure["setter_mappings"] {
  const out: MaplessMediaRequestClosure["setter_mappings"] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isSwitchStatement(node)) {
      const keyName = ts.isIdentifier(node.expression) ? node.expression.text : null;
      for (const clause of node.caseBlock.clauses) {
        if (!ts.isCaseClause(clause) || !ts.isStringLiteral(clause.expression)) continue;
        const call = clause.statements.flatMap((statement) => findNodes(statement, ts.isCallExpression)).find((candidate) => {
          const callee = ts.isIdentifier(candidate.expression) ? candidate.expression.text : ts.isPropertyAccessExpression(candidate.expression) ? candidate.expression.name.text : null;
          const args = candidate.arguments[0];
          return callee !== null && args !== undefined && ts.isElementAccessExpression(args) && ts.isIdentifier(args.argumentExpression) && args.argumentExpression.text === keyName;
        });
        const setter = call ? calleeName(call.expression) : null;
        if (call && setter) out.push({ setting_key: clause.expression.text, setter, key_case: locator(file, clause), setter_call: locator(file, call) });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return out.sort((a, b) => a.setting_key.localeCompare(b.setting_key));
}

function extractCustomPayloadSetterCalls(sources: Map<string, ParsedSource>): MaplessMediaRequestClosure["custom_payload_setter_calls"] {
  const calls: MaplessMediaRequestClosure["custom_payload_setter_calls"] = [];
  for (const [moduleName, parsed] of sources) {
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "setCustomSettingPayload") {
        const argument = node.arguments[0];
        const argumentKind = !argument ? "OTHER" : argument.kind === ts.SyntaxKind.NullKeyword ? "NULL_LITERAL" : ts.isIdentifier(argument) ? "IDENTIFIER" : ts.isObjectLiteralExpression(argument) ? "OBJECT_LITERAL" : ts.isConditionalExpression(argument) ? "CONDITIONAL" : "OTHER";
        calls.push({ module_name: moduleName, location: locator(parsed.file, node), argument_kind: argumentKind, argument_is_null: argumentKind === "NULL_LITERAL" });
      }
      ts.forEachChild(node, visit);
    };
    visit(parsed.file);
  }
  return calls.sort((a, b) => a.module_name.localeCompare(b.module_name) || a.location.line - b.location.line || a.location.column - b.location.column);
}

function extractDefaultPolicy(file: ts.SourceFile): MaplessMediaRequestClosure["default_semantics"] {
  let policy: MaplessMediaRequestClosure["default_semantics"]["policy"] = "UNKNOWN";
  let location: MaplessMediaRequestClosure["default_semantics"]["location"] = null;
  const visit = (node: ts.Node): void => {
    if ((ts.isArrowFunction(node) || ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node)) && node.body) {
      const returned = findNodes(node.body, ts.isReturnStatement).map((item) => item.expression).find((item): item is ts.Expression => item !== undefined);
      const expression = !ts.isBlock(node.body) ? node.body : returned;
      if (expression && ts.isConditionalExpression(expression)) {
        const condition = expression.condition;
        if (ts.isBinaryExpression(condition) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(condition.operatorToken.kind)) {
          policy = condition.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "NULLISH_FALLBACK" : "TRUTHY_FALLBACK";
          location = locator(file, expression);
        } else if (ts.isIdentifier(condition)) {
          policy = "TRUTHY_FALLBACK";
          location = locator(file, expression);
        }
      } else if (expression && ts.isBinaryExpression(expression) && [ts.SyntaxKind.QuestionQuestionToken, ts.SyntaxKind.BarBarToken].includes(expression.operatorToken.kind)) {
        policy = expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ? "NULLISH_FALLBACK" : "TRUTHY_FALLBACK";
        location = locator(file, expression);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return { policy, location };
}

function analyzeOperation(sender: ts.SourceFile, route: "design/generate" | "video/generate", routeSource: ts.SourceFile): MaplessMediaRequestClosure["operations"][number] {
  let found: ts.CallExpression | null = null;
  const scan = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "post" && node.arguments[0] && literalText(node.arguments[0]) === route) found = node;
    ts.forEachChild(node, scan);
  };
  scan(sender);
  if (!found) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  const call = found as ts.CallExpression;
  const bodyArg = call.arguments[1];
  if (!bodyArg || !ts.isIdentifier(bodyArg)) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  const fn = nearestFunction(call);
  if (!fn) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  const bodyDecl = findVariable(fn.body!, bodyArg.text);
  if (!bodyDecl?.initializer || !ts.isObjectLiteralExpression(bodyDecl.initializer)) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  const bodyFields = bodyDecl.initializer.properties.flatMap((p) => {
    if (ts.isPropertyAssignment(p)) return [propertyName(p.name)].filter((x): x is string => x !== null);
    return ts.isShorthandPropertyAssignment(p) ? [p.name.text] : [];
  });
  const settings = bodyDecl.initializer.properties.find((p) => (ts.isPropertyAssignment(p) && propertyName(p.name) === "settings") || (ts.isShorthandPropertyAssignment(p) && p.name.text === "settings"));
  if (!settings) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  let settingsExpression: ts.Expression | undefined;
  if (ts.isPropertyAssignment(settings)) settingsExpression = settings.initializer;
  else if (ts.isShorthandPropertyAssignment(settings)) settingsExpression = settings.name;
  if (!settingsExpression) throw new MaplessMediaRequestClosureError("REQUEST_CONSTRUCTOR_UNRESOLVED");
  const settingsTrace = traceSettingsExpression(fn, settingsExpression, route);
  const routeArgument = traceRouteSettingsArgument(routeSource, route === "design/generate" ? "IMAGE" : "VIDEO");
  const fileUrlsOverwritten = findNodes(fn.body!, ts.isBinaryExpression).some((assignment) => assignment.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isPropertyAccessExpression(assignment.left) && assignment.left.name.text === "file_urls");
  const isImage = route === "design/generate";
  const unresolved = ["DYNAMIC_SETTINGS_FIELDS_NOT_ENUMERATED", "WATCHER_AND_RUNTIME_OVERRIDES_NOT_EVALUATED", "BACKEND_ACCEPTANCE_NOT_PROVEN"] as const;
  return {
    method: "POST",
    route,
    modality: isImage ? "IMAGE" : "VIDEO",
    body_fields: bodyFields,
    settings_source: settingsTrace.status,
    settings_overwrite_guard: settingsTrace.guard,
    settings_input_parameter_index: settingsTrace.parameterIndex,
    settings_replacement_location: settingsTrace.location,
    settings_expression: settingsTrace.description,
    route_argument_source: routeArgument.source,
    route_argument_index: routeArgument.index,
    route_argument_location: routeArgument.location,
    file_urls_overwritten_after_settings: fileUrlsOverwritten,
    constructor_location: locator(sender, bodyDecl.initializer),
    dispatch_location: locator(sender, call),
    unresolved_reasons: isImage && routeArgument.source === "APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED" ? [...unresolved, "IMAGE_CUSTOM_PAYLOAD_PRODUCER_NOT_PROVEN"] : [...unresolved]
  };
}

function traceSettingsExpression(fn: ts.FunctionLikeDeclaration, expression: ts.Expression, route: string): { status: MaplessMediaRequestClosure["operations"][number]["settings_source"]; guard: MaplessMediaRequestClosure["operations"][number]["settings_overwrite_guard"]; parameterIndex: number | null; location: MaplessMediaRequestClosure["operations"][number]["settings_replacement_location"]; description: string } {
  const body = fn.body;
  if (ts.isObjectLiteralExpression(expression)) {
    const spread = expression.properties.find(ts.isSpreadAssignment);
    if (spread) return { status: "FIFTH_ARGUMENT_OBJECT_SPREAD", guard: "NOT_APPLICABLE", parameterIndex: parameterIndex(fn, spread.expression), location: locator(fn.getSourceFile(), expression), description: `settings:{...${expressionLabel(spread.expression)}}` };
  }
  if (ts.isIdentifier(expression)) {
    const writes = body ? findNodes(body, ts.isBinaryExpression).filter((item) => item.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(item.left) && item.left.text === expression.text && ts.isObjectLiteralExpression(unwrap(item.right))) : [];
    const last = writes.at(-1);
    if (last) {
      const assigned = unwrap(last.right);
      if (!ts.isObjectLiteralExpression(assigned)) return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, location: null, description: "unresolved settings construction" };
      const spread = assigned.properties.find(ts.isSpreadAssignment);
      if (spread) return { status: route === "design/generate" ? "FIFTH_ARGUMENT_REPLACES_INITIAL_STORE_SPREAD" : "FIFTH_ARGUMENT_OBJECT_SPREAD", guard: hasConditionalAncestor(last) ? "CONDITIONAL" : "UNCONDITIONAL", parameterIndex: parameterIndex(fn, spread.expression), location: locator(fn.getSourceFile(), last), description: `settings variable replaced with {...${expressionLabel(spread.expression)}}` };
    }
  }
  return { status: "UNKNOWN", guard: "UNKNOWN", parameterIndex: null, location: null, description: "unresolved settings construction" };
}

function traceRouteSettingsArgument(file: ts.SourceFile, modality: "IMAGE" | "VIDEO"): { source: MaplessMediaRequestClosure["operations"][number]["route_argument_source"]; index: number | null; location: MaplessMediaRequestClosure["operations"][number]["route_argument_location"] } {
  const calls = findNodes(file, ts.isCallExpression).filter((node) => ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "sendMessage");
  for (const call of calls) {
    const settingsArgument = call.arguments[4];
    if (!settingsArgument) continue;
    const scope = nearestFunction(call)?.body ?? file;
    const value = resolveValue(file, settingsArgument, new Set(), scope);
    if (value && ts.isConditionalExpression(value)) {
      const test = expressionLabel(resolveValue(file, value.condition, new Set(), scope) ?? value.condition);
      const testExpression = resolveValue(file, value.condition, new Set(), scope) ?? value.condition;
      const noExpr = resolveValue(file, value.whenFalse, new Set(), scope) ?? value.whenFalse;
      const no = expressionLabel(noExpr);
      if (test.includes("customSettingPayload") || containsProperty(testExpression, "customSettingPayload")) {
        if (modality === "IMAGE" && (no === "undefined" || no === "void 0")) return { source: "APP_STORE_CUSTOM_PAYLOAD_OR_UNDEFINED", index: 4, location: locator(file, settingsArgument) };
        if (modality === "VIDEO" && hasSpreadOfProperty(noExpr, "settings")) return { source: "CUSTOM_PAYLOAD_ELSE_APP_SETTINGS", index: 4, location: locator(file, settingsArgument) };
      }
    }
  }
  return { source: "NOT_RESOLVED", index: null, location: null };
}

function parameterIndex(fn: ts.FunctionLikeDeclaration, expression: ts.Expression): number | null {
  if (!ts.isIdentifier(expression)) return null;
  const index = fn.parameters.findIndex((parameter) => ts.isIdentifier(parameter.name) && parameter.name.text === expression.text);
  return index >= 0 ? index : null;
}

function resolveValue(file: ts.SourceFile, expression: ts.Expression, seen: Set<string>, scope: ts.Node = file): ts.Expression | null {
  if (ts.isIdentifier(expression) && !seen.has(expression.text)) {
    seen.add(expression.text);
    const declaration = findVariable(scope, expression.text) ?? findVariable(file, expression.text);
    if (declaration?.initializer) return resolveValue(file, declaration.initializer, seen, scope) ?? declaration.initializer;
  }
  if (ts.isCallExpression(expression) && ts.isIdentifier(expression.expression) && !seen.has(expression.expression.text)) {
    seen.add(expression.expression.text);
    const declaration = findVariable(scope, expression.expression.text) ?? findVariable(file, expression.expression.text);
    if (declaration?.initializer && (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))) {
      const body = declaration.initializer.body;
      const ret = !ts.isBlock(body) ? body : findNodes(body, ts.isReturnStatement).map((item) => item.expression).find((item): item is ts.Expression => item !== undefined);
      if (ret) return resolveValue(file, ret, seen, scope) ?? ret;
    }
  }
  return expression;
}

function findVariable(root: ts.Node, name: string): ts.VariableDeclaration | null {
  let found: ts.VariableDeclaration | null = null;
  const visit = (node: ts.Node): void => {
    if (!found && ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(root);
  return found;
}

function nearestFunction(node: ts.Node): ts.FunctionLikeDeclaration | null {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (ts.isArrowFunction(current) || ts.isFunctionDeclaration(current) || ts.isFunctionExpression(current) || ts.isMethodDeclaration(current) || ts.isGetAccessorDeclaration(current) || ts.isSetAccessorDeclaration(current) || ts.isConstructorDeclaration(current)) return current;
    current = current.parent;
  }
  return null;
}

function hasConditionalAncestor(node: ts.Node): boolean {
  let current: ts.Node | undefined = node.parent;
  while (current && !ts.isFunctionLike(current)) {
    if (ts.isIfStatement(current) || ts.isConditionalExpression(current) || ts.isSwitchStatement(current)) return true;
    if (ts.isBinaryExpression(current) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken, ts.SyntaxKind.QuestionQuestionToken].includes(current.operatorToken.kind) && isWithin(node, current.right)) return true;
    current = current.parent;
  }
  return false;
}

function isWithin(node: ts.Node, ancestor: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current) {
    if (current === ancestor) return true;
    current = current.parent;
  }
  return false;
}

function findNodes<T extends ts.Node>(root: ts.Node, predicate: (node: ts.Node) => node is T): T[] {
  const out: T[] = [];
  const visit = (node: ts.Node): void => { if (predicate(node)) out.push(node); ts.forEachChild(node, visit); };
  visit(root);
  return out;
}

function literalText(expression: ts.Expression | undefined): string | null {
  if (!expression) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  return null;
}

function propertyName(name: ts.PropertyName): string | null {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name) ? name.text : null;
}

function calleeName(expression: ts.Expression): string | null {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  return null;
}

function hasSpreadOfProperty(expression: ts.Expression, property: string): boolean {
  const node = unwrap(expression);
  if (!ts.isObjectLiteralExpression(node)) return false;
  return node.properties.some((item) => {
    if (!ts.isSpreadAssignment(item)) return false;
    const value = unwrap(item.expression);
    return ts.isPropertyAccessExpression(value) && value.name.text === property;
  });
}

function containsProperty(expression: ts.Expression, property: string): boolean {
  return findNodes(expression, ts.isPropertyAccessExpression).some((node) => node.name.text === property);
}

function expressionLabel(expression: ts.Expression): string {
  if (ts.isIdentifier(expression)) return expression.text;
  if (ts.isPropertyAccessExpression(expression)) return `${expressionLabel(expression.expression)}.${expression.name.text}`;
  if (ts.isObjectLiteralExpression(expression)) return "object";
  if (ts.isVoidExpression(expression)) return "void 0";
  if (ts.isStringLiteral(expression)) return expression.text;
  if (ts.isSpreadElement(expression)) return `...${expressionLabel(expression.expression)}`;
  return ts.SyntaxKind[expression.kind];
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (ts.isParenthesizedExpression(current) || ts.isAsExpression(current) || ts.isTypeAssertionExpression(current) || ts.isSatisfiesExpression(current)) current = current.expression;
  return current;
}

function locator(file: ts.SourceFile, node: ts.Node): { line: number; column: number } {
  const position = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: position.line + 1, column: position.character + 1 };
}
