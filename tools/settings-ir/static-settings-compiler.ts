import ts from "typescript";

export interface StaticSettingsCompilerLimits {
  maxSourceBytes: number;
  maxAstNodes: number;
  maxAstDepth: number;
  maxObjectProperties: number;
  maxArrayElements: number;
  maxStringBytes: number;
  maxNormalizedBytes: number;
}

export const STATIC_SETTINGS_COMPILER_LIMITS: Readonly<StaticSettingsCompilerLimits> = Object.freeze({
  maxSourceBytes: 1_048_576,
  maxAstNodes: 25_000,
  maxAstDepth: 64,
  maxObjectProperties: 512,
  maxArrayElements: 2_048,
  maxStringBytes: 4_096,
  maxNormalizedBytes: 262_144
});

export type StaticSettingsCompilerFatalCode =
  | "OPTIONS_INVALID"
  | "LIMITS_INVALID"
  | "MODEL_ID_INVALID"
  | "SOURCE_TYPE_INVALID"
  | "SOURCE_TOO_LARGE"
  | "SOURCE_UTF8_INVALID"
  | "SFC_STRUCTURE_INVALID"
  | "SCRIPT_SETUP_MISSING"
  | "SCRIPT_SETUP_DUPLICATE"
  | "SCRIPT_SETUP_SRC_FORBIDDEN"
  | "SCRIPT_SETUP_ATTRIBUTES_INVALID"
  | "SCRIPT_BLOCK_FORBIDDEN"
  | "SCRIPT_SETUP_UNCLOSED"
  | "TEMPLATE_MISSING"
  | "TEMPLATE_DUPLICATE"
  | "TEMPLATE_SRC_FORBIDDEN"
  | "TEMPLATE_ATTRIBUTES_INVALID"
  | "TEMPLATE_UNBALANCED"
  | "TYPESCRIPT_PARSE_FAILED"
  | "AST_NODE_LIMIT_EXCEEDED"
  | "AST_DEPTH_LIMIT_EXCEEDED"
  | "OBJECT_PROPERTY_LIMIT_EXCEEDED"
  | "ARRAY_ELEMENT_LIMIT_EXCEEDED"
  | "STRING_BYTE_LIMIT_EXCEEDED"
  | "OBJECT_KEY_FORBIDDEN"
  | "OBJECT_KEY_DUPLICATE"
  | "SECRET_LIKE_LITERAL_FORBIDDEN"
  | "DUPLICATE_TOP_LEVEL_BINDING"
  | "DUPLICATE_CONVENTION_BINDING"
  | "NORMALIZED_OUTPUT_TOO_LARGE";

export class StaticSettingsCompilerError extends Error {
  constructor(readonly code: StaticSettingsCompilerFatalCode) {
    super("Static settings source could not be compiled safely.");
    this.name = "StaticSettingsCompilerError";
  }
}

export type StaticSettingsBlockerCode =
  | "IMPORT_NOT_INTERPRETED"
  | "CALL_EXPRESSION_NOT_INTERPRETED"
  | "COMPUTED_RULE_NOT_INTERPRETED"
  | "WATCH_RULE_NOT_INTERPRETED"
  | "NEW_EXPRESSION_NOT_INTERPRETED"
  | "FUNCTION_NOT_INTERPRETED"
  | "SPREAD_NOT_INTERPRETED"
  | "COMPUTED_KEY_NOT_INTERPRETED"
  | "DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED"
  | "MUTATION_NOT_INTERPRETED"
  | "LOOP_NOT_INTERPRETED"
  | "TEMPLATE_CONTROL_FLOW_NOT_COMPILED"
  | "UNKNOWN_IDENTIFIER_NOT_INTERPRETED"
  | "STATIC_MEMBER_NOT_FOUND"
  | "MODEL_CONDITION_NOT_INTERPRETED"
  | "NON_CONST_BINDING_NOT_INTERPRETED"
  | "DESTRUCTURED_BINDING_NOT_INTERPRETED"
  | "BINDING_INITIALIZER_MISSING"
  | "BINDING_ABSENCE_UNPROVEN"
  | "MODEL_ID_SHADOWED"
  | "UNSUPPORTED_SYNTAX_NOT_INTERPRETED";

export type StaticSettingsConventionBinding =
  | "SCOPE"
  | "AI_NAME"
  | "settingsGroups"
  | "defaultSettings"
  | "controls"
  | "conditionalRules";

export type StaticSettingsProjection =
  | StaticSettingsConventionBinding
  | "computed_rules"
  | "watch_rules"
  | "template_control_flow"
  | "source";

export type StaticSettingsJsonValue =
  | null
  | boolean
  | number
  | string
  | StaticSettingsJsonValue[]
  | { [key: string]: StaticSettingsJsonValue };

export interface StaticSettingsLocator {
  node_kind: string;
  line: number;
  column: number;
}

export interface StaticSettingsBlocker extends StaticSettingsLocator {
  code: StaticSettingsBlockerCode;
  projection: StaticSettingsProjection;
}

export type StaticSettingsBindingResult =
  | {
      status: "PROVEN";
      value: StaticSettingsJsonValue;
      locator: StaticSettingsLocator;
    }
  | { status: "ABSENT_PROVEN" }
  | ({
      status: "BLOCKED";
      blocker_codes: StaticSettingsBlockerCode[];
      locator: StaticSettingsLocator;
    } & (
      | { candidates?: never; candidates_locator?: never }
      | {
          candidates: StaticSettingsJsonValue;
          candidates_locator: StaticSettingsLocator;
        }
    ));

export interface StaticSettingsCompilerResult {
  schema_version: "1.0.0";
  parser_profile: "STATIC_SETTINGS_V1";
  model_id: string;
  compilation_status: "COMPLETE" | "PARTIAL";
  vendor_code_executed: false;
  source_persisted: false;
  metrics: {
    source_bytes: number;
    ast_nodes: number;
    max_ast_depth: number;
    node_kinds: Array<{ node_kind: string; count: number }>;
  };
  bindings: Record<
    StaticSettingsConventionBinding,
    StaticSettingsBindingResult
  >;
  detections: {
    computed_calls: StaticSettingsLocator[];
    watch_calls: StaticSettingsLocator[];
    template_v_if: StaticSettingsLocator[];
  };
  blockers: StaticSettingsBlocker[];
}

export interface StaticSettingsCompilerOptions {
  source: string | Uint8Array;
  modelId: string;
  /** Tests and stricter callers may lower, but never raise, parser budgets. */
  limits?: Partial<StaticSettingsCompilerLimits>;
}

type ResolvedLimits = StaticSettingsCompilerLimits;

interface ParsedAttribute {
  name: string;
  nameStart: number;
  value: string | null;
}

interface ParsedOpeningTag {
  name: string;
  attributes: ParsedAttribute[];
  end: number;
  selfClosing: boolean;
}

interface VueSfcParts {
  script: string;
  scriptOffset: number;
  templateVIfOffsets: number[];
}

interface AstMetrics {
  nodeCount: number;
  maxDepth: number;
  kindCounts: Map<string, number>;
}

interface BindingDeclaration {
  binding: StaticSettingsConventionBinding;
  declaration: ts.VariableDeclaration | ts.DeclarationStatement;
  initializer?: ts.Expression;
  isConst: boolean;
  destructured: boolean;
}

interface EvaluatedObject {
  [key: string]: EvaluatedValue;
}

type EvaluatedValue =
  | null
  | boolean
  | number
  | string
  | typeof MODEL_ID_SENTINEL
  | EvaluatedValue[]
  | EvaluatedObject;

type EvaluationOutcome =
  | { ok: true; value: EvaluatedValue }
  | EvaluationFailure;

interface EvaluationFailure {
  ok: false;
  code: StaticSettingsBlockerCode;
  node: ts.Node;
  candidates?: EvaluatedValue;
  candidatesNode?: ts.Node;
}

type ConditionOutcome = { ok: true; value: boolean } | EvaluationFailure;

interface EvaluationContext {
  environment: Map<string, EvaluationOutcome>;
  modelId: string;
  modelIdShadowed: boolean;
}

const CONVENTION_BINDINGS = [
  "SCOPE",
  "AI_NAME",
  "settingsGroups",
  "defaultSettings",
  "controls",
  "conditionalRules"
] as const satisfies readonly StaticSettingsConventionBinding[];
const CONVENTION_BINDING_SET = new Set<string>(CONVENTION_BINDINGS);
const MODEL_ID_PATTERN = /^[A-Za-z0-9._-]{1,160}$/u;
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor"
]);
const SECRET_LIKE_OBJECT_KEYS = new Set([
  "authorization",
  "api_key",
  "apikey",
  "access_token",
  "refresh_token",
  "password",
  "secret",
  "cookie",
  "session_string",
  "telegram_session",
  "otp"
]);
const SECRET_LIKE_VALUE_PATTERNS = [
  /(?:^|[^A-Za-z0-9])sk_(?:live|test)_[A-Za-z0-9_-]{8,}/u,
  /(?:^|[^A-Za-z0-9])sk-proj-[A-Za-z0-9_-]{12,}/u,
  /(?:^|[^A-Za-z0-9])(?:gh[pousr]_|xox[baprs]-)[A-Za-z0-9_-]{12,}/u,
  /(?:^|\s)Bearer\s+[A-Za-z0-9._~+/=-]{12,}/iu,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u,
  /eyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/u
] as const;
const MODEL_ID_SENTINEL = Symbol("model_id");
const textEncoder = new TextEncoder();
const fatalUtf8Decoder = new TextDecoder("utf-8", {
  fatal: true,
  ignoreBOM: true
});

export function compileStaticSettingsVueSfc(
  options: StaticSettingsCompilerOptions
): StaticSettingsCompilerResult {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new StaticSettingsCompilerError("OPTIONS_INVALID");
  }
  const limits = resolveLimits(options.limits);
  if (
    typeof options.modelId !== "string" ||
    !MODEL_ID_PATTERN.test(options.modelId)
  ) {
    throw new StaticSettingsCompilerError("MODEL_ID_INVALID");
  }
  const decoded = decodeSource(options.source, limits.maxSourceBytes);
  const sfc = splitVueSfc(decoded.text);
  let sourceFile: ts.SourceFile;
  try {
    sourceFile = ts.createSourceFile(
      "settings-component.ts",
      sfc.script,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS
    );
  } catch {
    throw new StaticSettingsCompilerError("TYPESCRIPT_PARSE_FAILED");
  }
  const parseDiagnostics = (
    sourceFile as ts.SourceFile & {
      parseDiagnostics?: readonly ts.Diagnostic[];
    }
  ).parseDiagnostics;
  if (parseDiagnostics !== undefined && parseDiagnostics.length > 0) {
    throw new StaticSettingsCompilerError("TYPESCRIPT_PARSE_FAILED");
  }

  const locatorAt = createLocatorFactory(decoded.text);
  const metrics = inspectAst(sourceFile, limits);
  const declarations = collectConventionDeclarations(sourceFile);
  assertUniqueTopLevelBindings(sourceFile);
  const declarationRanges = declarations
    .filter((entry) => entry.initializer !== undefined)
    .map((entry) => ({
      start: entry.initializer!.getStart(sourceFile),
      end: entry.initializer!.getEnd(),
      projection: entry.binding
    }));
  const blockers: StaticSettingsBlocker[] = [];
  const computedCalls: StaticSettingsLocator[] = [];
  const watchCalls: StaticSettingsLocator[] = [];

  inspectUnsupportedNodes({
    sourceFile,
    scriptOffset: sfc.scriptOffset,
    locatorAt,
    declarationRanges,
    blockers,
    computedCalls,
    watchCalls
  });

  const templateVIf = sfc.templateVIfOffsets.map((offset) =>
    locatorAt(offset, "VueVIfDirective")
  );
  for (const locator of templateVIf) {
    blockers.push({
      code: "TEMPLATE_CONTROL_FLOW_NOT_COMPILED",
      projection: "template_control_flow",
      ...locator
    });
  }

  const bindings = evaluateConventionBindings({
    sourceFile,
    scriptOffset: sfc.scriptOffset,
    locatorAt,
    declarations,
    modelId: options.modelId,
    absenceUnproven:
      blockers.length > 0 || hasNonConventionTopLevelDeclarations(sourceFile),
    blockers
  });
  const normalizedBlockers = sortAndDedupeBlockers(blockers);
  const result: StaticSettingsCompilerResult = {
    schema_version: "1.0.0",
    parser_profile: "STATIC_SETTINGS_V1",
    model_id: options.modelId,
    compilation_status:
      normalizedBlockers.length === 0 &&
      CONVENTION_BINDINGS.every(
        (binding) => bindings[binding].status !== "BLOCKED"
      )
        ? "COMPLETE"
        : "PARTIAL",
    vendor_code_executed: false,
    source_persisted: false,
    metrics: {
      source_bytes: decoded.bytes,
      ast_nodes: metrics.nodeCount,
      max_ast_depth: metrics.maxDepth,
      node_kinds: [...metrics.kindCounts.entries()]
        .map(([node_kind, count]) => ({ node_kind, count }))
        .sort((left, right) => compareText(left.node_kind, right.node_kind))
    },
    bindings,
    detections: {
      computed_calls: sortAndDedupeLocators(computedCalls),
      watch_calls: sortAndDedupeLocators(watchCalls),
      template_v_if: sortAndDedupeLocators(templateVIf)
    },
    blockers: normalizedBlockers
  };
  if (textEncoder.encode(JSON.stringify(result)).byteLength > limits.maxNormalizedBytes) {
    throw new StaticSettingsCompilerError("NORMALIZED_OUTPUT_TOO_LARGE");
  }
  return result;
}

function resolveLimits(
  overrides: StaticSettingsCompilerOptions["limits"]
): ResolvedLimits {
  const resolved = { ...STATIC_SETTINGS_COMPILER_LIMITS };
  if (overrides === undefined) return resolved;
  if (
    typeof overrides !== "object" ||
    overrides === null ||
    Array.isArray(overrides)
  ) {
    throw new StaticSettingsCompilerError("LIMITS_INVALID");
  }
  for (const key of Object.keys(overrides) as Array<
    keyof ResolvedLimits
  >) {
    if (!Object.prototype.hasOwnProperty.call(resolved, key)) {
      throw new StaticSettingsCompilerError("LIMITS_INVALID");
    }
    const value = overrides[key];
    const ceiling = STATIC_SETTINGS_COMPILER_LIMITS[key];
    if (
      value === undefined ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > ceiling
    ) {
      throw new StaticSettingsCompilerError("LIMITS_INVALID");
    }
    resolved[key] = value;
  }
  return resolved;
}

function decodeSource(
  input: string | Uint8Array,
  maxSourceBytes: number
): { text: string; bytes: number } {
  if (typeof input === "string") {
    if (input.length > maxSourceBytes) {
      throw new StaticSettingsCompilerError("SOURCE_TOO_LARGE");
    }
    const encoded = textEncoder.encode(input);
    if (encoded.byteLength > maxSourceBytes) {
      throw new StaticSettingsCompilerError("SOURCE_TOO_LARGE");
    }
    let decoded: string;
    try {
      decoded = fatalUtf8Decoder.decode(encoded);
    } catch {
      throw new StaticSettingsCompilerError("SOURCE_UTF8_INVALID");
    }
    if (decoded !== input) {
      throw new StaticSettingsCompilerError("SOURCE_UTF8_INVALID");
    }
    return { text: decoded, bytes: encoded.byteLength };
  }
  if (!(input instanceof Uint8Array)) {
    throw new StaticSettingsCompilerError("SOURCE_TYPE_INVALID");
  }
  if (input.byteLength > maxSourceBytes) {
    throw new StaticSettingsCompilerError("SOURCE_TOO_LARGE");
  }
  let decoded: string;
  try {
    decoded = fatalUtf8Decoder.decode(input);
  } catch {
    throw new StaticSettingsCompilerError("SOURCE_UTF8_INVALID");
  }
  const roundTrip = textEncoder.encode(decoded);
  if (!bytesEqual(input, roundTrip)) {
    throw new StaticSettingsCompilerError("SOURCE_UTF8_INVALID");
  }
  return { text: decoded, bytes: input.byteLength };
}

function bytesEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  for (let index = 0; index < left.byteLength; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function splitVueSfc(source: string): VueSfcParts {
  let cursor = source.charCodeAt(0) === 0xfeff ? 1 : 0;
  let script: { content: string; offset: number } | undefined;
  let templateSeen = false;
  const templateVIfOffsets: number[] = [];

  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (cursor >= source.length) break;
    if (source.startsWith("<!--", cursor)) {
      const commentEnd = source.indexOf("-->", cursor + 4);
      if (commentEnd < 0) {
        throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
      }
      cursor = commentEnd + 3;
      continue;
    }
    if (source[cursor] !== "<" || source[cursor + 1] === "/") {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    const opening = parseOpeningTag(source, cursor);
    const tagName = opening.name.toLowerCase();
    if (tagName === "template") {
      if (templateSeen) {
        throw new StaticSettingsCompilerError("TEMPLATE_DUPLICATE");
      }
      if (hasAttribute(opening, "src")) {
        throw new StaticSettingsCompilerError("TEMPLATE_SRC_FORBIDDEN");
      }
      if (opening.attributes.length > 0) {
        throw new StaticSettingsCompilerError("TEMPLATE_ATTRIBUTES_INVALID");
      }
      if (opening.selfClosing) {
        throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
      }
      templateSeen = true;
      for (const attribute of opening.attributes) {
        if (attribute.name.toLowerCase() === "v-if") {
          templateVIfOffsets.push(attribute.nameStart);
        }
      }
      const balanced = findBalancedTemplateEnd(
        source,
        opening.end,
        templateVIfOffsets
      );
      cursor = balanced;
      continue;
    }

    if (tagName === "script") {
      const isSetup = hasAttribute(opening, "setup");
      if (!isSetup) {
        throw new StaticSettingsCompilerError("SCRIPT_BLOCK_FORBIDDEN");
      }
      if (isSetup && script !== undefined) {
        throw new StaticSettingsCompilerError("SCRIPT_SETUP_DUPLICATE");
      }
      if (isSetup && hasAttribute(opening, "src")) {
        throw new StaticSettingsCompilerError("SCRIPT_SETUP_SRC_FORBIDDEN");
      }
      if (!hasStrictScriptSetupAttributes(opening)) {
        throw new StaticSettingsCompilerError(
          "SCRIPT_SETUP_ATTRIBUTES_INVALID"
        );
      }
      if (opening.selfClosing) {
        if (isSetup) {
          throw new StaticSettingsCompilerError("SCRIPT_SETUP_UNCLOSED");
        }
        cursor = opening.end;
        continue;
      }
      const closing = findScriptClosingTag(source, opening.end);
      if (closing === undefined) {
        throw new StaticSettingsCompilerError(
          isSetup ? "SCRIPT_SETUP_UNCLOSED" : "SFC_STRUCTURE_INVALID"
        );
      }
      if (isSetup) {
        script = {
          content: source.slice(opening.end, closing.start),
          offset: opening.end
        };
      }
      cursor = closing.end;
      continue;
    }

    if (tagName !== "style") {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    if (hasAttribute(opening, "src")) {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    if (opening.selfClosing) {
      cursor = opening.end;
      continue;
    }
    const closing = findRawClosingTag(source, tagName, opening.end);
    if (closing === undefined) {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    cursor = closing.end;
  }

  if (script === undefined) {
    throw new StaticSettingsCompilerError("SCRIPT_SETUP_MISSING");
  }
  if (!templateSeen) {
    throw new StaticSettingsCompilerError("TEMPLATE_MISSING");
  }
  return {
    script: script.content,
    scriptOffset: script.offset,
    templateVIfOffsets
  };
}

function parseOpeningTag(source: string, start: number): ParsedOpeningTag {
  if (source[start] !== "<" || !isTagNameStart(source[start + 1])) {
    throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
  }
  let cursor = start + 1;
  const nameStart = cursor;
  while (cursor < source.length && isTagNamePart(source[cursor])) cursor += 1;
  const name = source.slice(nameStart, cursor);
  const attributes: ParsedAttribute[] = [];
  while (cursor < source.length) {
    cursor = skipWhitespace(source, cursor);
    if (source.startsWith("/>", cursor)) {
      return { name, attributes, end: cursor + 2, selfClosing: true };
    }
    if (source[cursor] === ">") {
      return { name, attributes, end: cursor + 1, selfClosing: false };
    }
    const attributeStart = cursor;
    while (
      cursor < source.length &&
      !isWhitespace(source[cursor]) &&
      source[cursor] !== "=" &&
      source[cursor] !== ">" &&
      !source.startsWith("/>", cursor)
    ) {
      cursor += 1;
    }
    if (cursor === attributeStart) {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    const attributeName = source.slice(attributeStart, cursor);
    cursor = skipWhitespace(source, cursor);
    if (source[cursor] !== "=") {
      attributes.push({
        name: attributeName,
        nameStart: attributeStart,
        value: null
      });
      continue;
    }
    cursor = skipWhitespace(source, cursor + 1);
    const quote = source[cursor];
    if (quote === '"' || quote === "'") {
      const valueStart = cursor + 1;
      cursor = valueStart;
      while (cursor < source.length && source[cursor] !== quote) cursor += 1;
      if (cursor >= source.length) {
        throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
      }
      attributes.push({
        name: attributeName,
        nameStart: attributeStart,
        value: source.slice(valueStart, cursor)
      });
      cursor += 1;
      continue;
    }
    const valueStart = cursor;
    while (
      cursor < source.length &&
      !isWhitespace(source[cursor]) &&
      source[cursor] !== ">"
    ) {
      cursor += 1;
    }
    if (cursor === valueStart) {
      throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
    }
    attributes.push({
      name: attributeName,
      nameStart: attributeStart,
      value: source.slice(valueStart, cursor)
    });
  }
  throw new StaticSettingsCompilerError("SFC_STRUCTURE_INVALID");
}

function findBalancedTemplateEnd(
  source: string,
  contentStart: number,
  vIfOffsets: number[]
): number {
  let cursor = contentStart;
  let depth = 1;
  while (cursor < source.length) {
    if (source.startsWith("<!--", cursor)) {
      const end = source.indexOf("-->", cursor + 4);
      if (end < 0) {
        throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
      }
      cursor = end + 3;
      continue;
    }
    if (source.startsWith("{{", cursor)) {
      const end = findMustacheEnd(source, cursor + 2);
      if (end < 0) {
        throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
      }
      cursor = end;
      continue;
    }
    if (source[cursor] !== "<") {
      cursor += 1;
      continue;
    }
    if (source.startsWith("</", cursor)) {
      const closing = parseClosingTag(source, cursor);
      if (closing.name.toLowerCase() === "template") {
        depth -= 1;
        if (depth === 0) return closing.end;
        if (depth < 0) {
          throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
        }
      }
      cursor = closing.end;
      continue;
    }
    if (source.startsWith("<!", cursor) || source.startsWith("<?", cursor)) {
      const end = source.indexOf(">", cursor + 2);
      if (end < 0) {
        throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
      }
      cursor = end + 1;
      continue;
    }
    let opening: ParsedOpeningTag;
    try {
      opening = parseOpeningTag(source, cursor);
    } catch {
      throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
    }
    for (const attribute of opening.attributes) {
      if (attribute.name.toLowerCase() === "v-if") {
        vIfOffsets.push(attribute.nameStart);
      }
    }
    const lowerName = opening.name.toLowerCase();
    if (lowerName === "template" && !opening.selfClosing) depth += 1;
    if (
      (lowerName === "script" || lowerName === "style") &&
      !opening.selfClosing
    ) {
      const rawEnd = findRawClosingTag(source, lowerName, opening.end);
      if (rawEnd === undefined) {
        throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
      }
      cursor = rawEnd.end;
    } else {
      cursor = opening.end;
    }
  }
  throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
}

function parseClosingTag(
  source: string,
  start: number
): { name: string; end: number } {
  let cursor = start + 2;
  if (!isTagNameStart(source[cursor])) {
    throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
  }
  const nameStart = cursor;
  while (cursor < source.length && isTagNamePart(source[cursor])) cursor += 1;
  const name = source.slice(nameStart, cursor);
  cursor = skipWhitespace(source, cursor);
  if (source[cursor] !== ">") {
    throw new StaticSettingsCompilerError("TEMPLATE_UNBALANCED");
  }
  return { name, end: cursor + 1 };
}

function findRawClosingTag(
  source: string,
  tagName: string,
  from: number
): { start: number; end: number } | undefined {
  const needle = `</${tagName}`.toLowerCase();
  const lowerSource = source.toLowerCase();
  let cursor = from;
  while (cursor < source.length) {
    const candidate = lowerSource.indexOf(needle, cursor);
    if (candidate < 0) return undefined;
    const boundary = source[candidate + needle.length];
    if (boundary === ">" || isWhitespace(boundary)) {
      try {
        const closing = parseClosingTag(source, candidate);
        if (closing.name.toLowerCase() === tagName.toLowerCase()) {
          return { start: candidate, end: closing.end };
        }
      } catch {
        return undefined;
      }
    }
    cursor = candidate + needle.length;
  }
  return undefined;
}

function findScriptClosingTag(
  source: string,
  from: number
): { start: number; end: number } | undefined {
  type LexicalMode =
    | "NORMAL"
    | "SINGLE_QUOTE"
    | "DOUBLE_QUOTE"
    | "TEMPLATE"
    | "LINE_COMMENT"
    | "BLOCK_COMMENT";
  let mode: LexicalMode = "NORMAL";
  const templateExpressionDepths: number[] = [];
  let cursor = from;
  while (cursor < source.length) {
    const current = source[cursor]!;
    const next = source[cursor + 1];
    if (mode === "LINE_COMMENT") {
      if (current === "\n" || current === "\r") mode = "NORMAL";
      cursor += 1;
      continue;
    }
    if (mode === "BLOCK_COMMENT") {
      if (current === "*" && next === "/") {
        mode = "NORMAL";
        cursor += 2;
      } else {
        cursor += 1;
      }
      continue;
    }
    if (mode === "SINGLE_QUOTE" || mode === "DOUBLE_QUOTE") {
      const quote = mode === "SINGLE_QUOTE" ? "'" : '"';
      if (current === "\\") {
        cursor += 2;
      } else {
        if (current === quote) mode = "NORMAL";
        cursor += 1;
      }
      continue;
    }
    if (mode === "TEMPLATE") {
      if (current === "\\") {
        cursor += 2;
      } else if (current === "`") {
        mode = "NORMAL";
        cursor += 1;
      } else if (current === "$" && next === "{") {
        templateExpressionDepths.push(1);
        mode = "NORMAL";
        cursor += 2;
      } else {
        cursor += 1;
      }
      continue;
    }

    if (startsWithClosingTag(source, "script", cursor)) {
      try {
        const closing = parseClosingTag(source, cursor);
        return { start: cursor, end: closing.end };
      } catch {
        return undefined;
      }
    }
    if (current === "/" && next === "/") {
      mode = "LINE_COMMENT";
      cursor += 2;
      continue;
    }
    if (current === "/" && next === "*") {
      mode = "BLOCK_COMMENT";
      cursor += 2;
      continue;
    }
    if (current === "'") {
      mode = "SINGLE_QUOTE";
      cursor += 1;
      continue;
    }
    if (current === '"') {
      mode = "DOUBLE_QUOTE";
      cursor += 1;
      continue;
    }
    if (current === "`") {
      mode = "TEMPLATE";
      cursor += 1;
      continue;
    }
    if (templateExpressionDepths.length > 0) {
      const last = templateExpressionDepths.length - 1;
      if (current === "{") {
        templateExpressionDepths[last] = templateExpressionDepths[last]! + 1;
      } else if (current === "}") {
        templateExpressionDepths[last] = templateExpressionDepths[last]! - 1;
        if (templateExpressionDepths[last] === 0) {
          templateExpressionDepths.pop();
          mode = "TEMPLATE";
        }
      }
    }
    cursor += 1;
  }
  return undefined;
}

function startsWithClosingTag(
  source: string,
  tagName: string,
  offset: number
): boolean {
  const candidate = source.slice(offset, offset + tagName.length + 2);
  if (candidate.toLowerCase() !== `</${tagName}`) return false;
  const boundary = source[offset + tagName.length + 2];
  return boundary === ">" || isWhitespace(boundary);
}

function findMustacheEnd(source: string, from: number): number {
  let cursor = from;
  let quote: string | undefined;
  while (cursor < source.length - 1) {
    const current = source[cursor]!;
    if (quote !== undefined) {
      if (current === "\\") {
        cursor += 2;
        continue;
      }
      if (current === quote) quote = undefined;
      cursor += 1;
      continue;
    }
    if (current === '"' || current === "'" || current === "`") {
      quote = current;
      cursor += 1;
      continue;
    }
    if (source.startsWith("}}", cursor)) return cursor + 2;
    cursor += 1;
  }
  return -1;
}

function hasAttribute(tag: ParsedOpeningTag, name: string): boolean {
  return tag.attributes.some(
    (attribute) => attribute.name.toLowerCase() === name
  );
}

function hasStrictScriptSetupAttributes(tag: ParsedOpeningTag): boolean {
  const names = new Set<string>();
  for (const attribute of tag.attributes) {
    const name = attribute.name.toLowerCase();
    if (names.has(name)) return false;
    names.add(name);
    if (name === "setup") {
      if (attribute.value !== null) return false;
      continue;
    }
    if (name === "lang") {
      if (attribute.value?.toLowerCase() !== "ts") return false;
      continue;
    }
    return false;
  }
  return names.has("setup");
}

function inspectAst(
  sourceFile: ts.SourceFile,
  limits: ResolvedLimits
): AstMetrics {
  const stack: Array<{ node: ts.Node; depth: number }> = [
    { node: sourceFile, depth: 1 }
  ];
  let nodeCount = 0;
  let maxDepth = 0;
  const kindCounts = new Map<string, number>();
  while (stack.length > 0) {
    const current = stack.pop()!;
    nodeCount += 1;
    if (nodeCount > limits.maxAstNodes) {
      throw new StaticSettingsCompilerError("AST_NODE_LIMIT_EXCEEDED");
    }
    if (current.depth > limits.maxAstDepth) {
      throw new StaticSettingsCompilerError("AST_DEPTH_LIMIT_EXCEEDED");
    }
    maxDepth = Math.max(maxDepth, current.depth);
    const kind = syntaxKindName(current.node);
    kindCounts.set(kind, (kindCounts.get(kind) ?? 0) + 1);
    inspectBoundedLiteralNode(current.node, limits);
    const children: ts.Node[] = [];
    ts.forEachChild(current.node, (child) => {
      children.push(child);
    });
    for (let index = children.length - 1; index >= 0; index -= 1) {
      stack.push({ node: children[index]!, depth: current.depth + 1 });
    }
  }
  return { nodeCount, maxDepth, kindCounts };
}

function inspectBoundedLiteralNode(
  node: ts.Node,
  limits: ResolvedLimits
): void {
  if (
    (ts.isStringLiteralLike(node) || ts.isIdentifier(node)) &&
    textEncoder.encode(node.text).byteLength > limits.maxStringBytes
  ) {
    throw new StaticSettingsCompilerError("STRING_BYTE_LIMIT_EXCEEDED");
  }
  if (
    ts.isStringLiteralLike(node) &&
    SECRET_LIKE_VALUE_PATTERNS.some((pattern) => pattern.test(node.text))
  ) {
    throw new StaticSettingsCompilerError("SECRET_LIKE_LITERAL_FORBIDDEN");
  }
  if (ts.isArrayLiteralExpression(node)) {
    if (node.elements.length > limits.maxArrayElements) {
      throw new StaticSettingsCompilerError("ARRAY_ELEMENT_LIMIT_EXCEEDED");
    }
  }
  if (!ts.isObjectLiteralExpression(node)) return;
  if (node.properties.length > limits.maxObjectProperties) {
    throw new StaticSettingsCompilerError("OBJECT_PROPERTY_LIMIT_EXCEEDED");
  }
  const keys = new Set<string>();
  for (const property of node.properties) {
    const key =
      property.name === undefined
        ? undefined
        : staticPropertyName(property.name);
    if (key === undefined) continue;
    validateObjectKey(key, limits.maxStringBytes);
    if (SECRET_LIKE_OBJECT_KEYS.has(key.toLowerCase())) {
      throw new StaticSettingsCompilerError("SECRET_LIKE_LITERAL_FORBIDDEN");
    }
    if (keys.has(key)) {
      throw new StaticSettingsCompilerError("OBJECT_KEY_DUPLICATE");
    }
    keys.add(key);
  }
}

function collectConventionDeclarations(
  sourceFile: ts.SourceFile
): BindingDeclaration[] {
  const declarations: BindingDeclaration[] = [];
  const counts = new Map<StaticSettingsConventionBinding, number>();
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      const isConst =
        (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          const name = declaration.name.text;
          if (CONVENTION_BINDING_SET.has(name)) {
            const binding = name as StaticSettingsConventionBinding;
            counts.set(binding, (counts.get(binding) ?? 0) + 1);
            declarations.push({
              binding,
              declaration,
              ...(declaration.initializer === undefined
                ? {}
                : { initializer: declaration.initializer }),
              isConst,
              destructured: false
            });
          }
        } else {
          const names = collectBindingNames(declaration.name);
          for (const name of names) {
            if (!CONVENTION_BINDING_SET.has(name)) continue;
            const binding = name as StaticSettingsConventionBinding;
            counts.set(binding, (counts.get(binding) ?? 0) + 1);
            declarations.push({
              binding,
              declaration,
              ...(declaration.initializer === undefined
                ? {}
                : { initializer: declaration.initializer }),
              isConst,
              destructured: true
            });
          }
        }
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement)) &&
      statement.name !== undefined &&
      CONVENTION_BINDING_SET.has(statement.name.text)
    ) {
      const binding = statement.name.text as StaticSettingsConventionBinding;
      counts.set(binding, (counts.get(binding) ?? 0) + 1);
      declarations.push({
        binding,
        declaration: statement,
        isConst: false,
        destructured: false
      });
    }
  }
  if ([...counts.values()].some((count) => count > 1)) {
    throw new StaticSettingsCompilerError("DUPLICATE_CONVENTION_BINDING");
  }
  return declarations;
}

function assertUniqueTopLevelBindings(sourceFile: ts.SourceFile): void {
  const names = new Set<string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      for (const name of collectBindingNames(declaration.name)) {
        if (names.has(name)) {
          throw new StaticSettingsCompilerError(
            "DUPLICATE_TOP_LEVEL_BINDING"
          );
        }
        names.add(name);
      }
    }
  }
}

function hasNonConventionTopLevelDeclarations(
  sourceFile: ts.SourceFile
): boolean {
  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (
        !ts.isIdentifier(declaration.name) ||
        !CONVENTION_BINDING_SET.has(declaration.name.text)
      ) {
        return true;
      }
    }
  }
  return false;
}

function hasTopLevelBinding(sourceFile: ts.SourceFile, target: string): boolean {
  for (const statement of sourceFile.statements) {
    if (ts.isVariableStatement(statement)) {
      if (
        statement.declarationList.declarations.some((declaration) =>
          collectBindingNames(declaration.name).includes(target)
        )
      ) {
        return true;
      }
      continue;
    }
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isModuleDeclaration(statement)) &&
      statement.name?.text === target
    ) {
      return true;
    }
    if (ts.isImportDeclaration(statement) && statement.importClause !== undefined) {
      if (statement.importClause.name?.text === target) return true;
      const bindings = statement.importClause.namedBindings;
      if (bindings === undefined) continue;
      if (ts.isNamespaceImport(bindings)) {
        if (bindings.name.text === target) return true;
      } else if (
        bindings.elements.some((element) => element.name.text === target)
      ) {
        return true;
      }
    }
  }
  return false;
}

function collectBindingNames(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) =>
    ts.isOmittedExpression(element)
      ? []
      : collectBindingNames(element.name)
  );
}

function inspectUnsupportedNodes(input: {
  sourceFile: ts.SourceFile;
  scriptOffset: number;
  locatorAt: LocatorFactory;
  declarationRanges: Array<{
    start: number;
    end: number;
    projection: StaticSettingsConventionBinding;
  }>;
  blockers: StaticSettingsBlocker[];
  computedCalls: StaticSettingsLocator[];
  watchCalls: StaticSettingsLocator[];
}): void {
  const visit = (node: ts.Node): void => {
    const projection = projectionForNode(
      node,
      input.sourceFile,
      input.declarationRanges
    );
    const add = (
      code: StaticSettingsBlockerCode,
      selectedProjection: StaticSettingsProjection = projection
    ): StaticSettingsLocator => {
      const locator = locatorForNode(
        node,
        input.sourceFile,
        input.scriptOffset,
        input.locatorAt
      );
      input.blockers.push({ code, projection: selectedProjection, ...locator });
      return locator;
    };

    if (
      ts.isImportDeclaration(node) ||
      ts.isImportEqualsDeclaration(node) ||
      ts.isExportDeclaration(node) ||
      ts.isExportAssignment(node)
    ) {
      add("IMPORT_NOT_INTERPRETED", "source");
    } else if (
      ts.isVariableStatement(node) &&
      (node.declarationList.flags & ts.NodeFlags.Const) === 0
    ) {
      add("NON_CONST_BINDING_NOT_INTERPRETED", "source");
    } else if (
      ts.isVariableDeclaration(node) &&
      !ts.isIdentifier(node.name)
    ) {
      add("DESTRUCTURED_BINDING_NOT_INTERPRETED", "source");
    } else if (ts.isCallExpression(node)) {
      const directName = ts.isIdentifier(node.expression)
        ? node.expression.text
        : undefined;
      if (directName === "computed") {
        input.computedCalls.push(
          add("COMPUTED_RULE_NOT_INTERPRETED", "computed_rules")
        );
      } else if (directName === "watch") {
        input.watchCalls.push(
          add("WATCH_RULE_NOT_INTERPRETED", "watch_rules")
        );
      } else {
        add("CALL_EXPRESSION_NOT_INTERPRETED");
      }
    } else if (ts.isNewExpression(node)) {
      add("NEW_EXPRESSION_NOT_INTERPRETED");
    } else if (isFunctionLikeNode(node) && !isDirectReactiveCallback(node)) {
      add("FUNCTION_NOT_INTERPRETED");
    } else if (ts.isSpreadElement(node) || ts.isSpreadAssignment(node)) {
      add("SPREAD_NOT_INTERPRETED");
    } else if (ts.isComputedPropertyName(node)) {
      add("COMPUTED_KEY_NOT_INTERPRETED");
    } else if (
      ts.isElementAccessExpression(node) &&
      (node.questionDotToken !== undefined ||
        !isStaticElementKey(node.argumentExpression))
    ) {
      add("DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED");
    } else if (
      ts.isPropertyAccessExpression(node) &&
      node.questionDotToken !== undefined
    ) {
      add("DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED");
    } else if (isMutationNode(node)) {
      add("MUTATION_NOT_INTERPRETED");
    } else if (isLoopNode(node)) {
      add("LOOP_NOT_INTERPRETED");
    } else if (isClosedProfileUnsupportedNode(node)) {
      add("UNSUPPORTED_SYNTAX_NOT_INTERPRETED");
    }
    ts.forEachChild(node, visit);
  };
  visit(input.sourceFile);
}

function isClosedProfileUnsupportedNode(node: ts.Node): boolean {
  return (
    ts.isClassDeclaration(node) ||
    ts.isClassExpression(node) ||
    ts.isEnumDeclaration(node) ||
    ts.isModuleDeclaration(node) ||
    ts.isAwaitExpression(node) ||
    ts.isYieldExpression(node) ||
    ts.isTaggedTemplateExpression(node) ||
    ts.isTemplateExpression(node) ||
    ts.isNoSubstitutionTemplateLiteral(node) ||
    ts.isRegularExpressionLiteral(node) ||
    ts.isDeleteExpression(node) ||
    ts.isIfStatement(node) ||
    ts.isSwitchStatement(node) ||
    ts.isTryStatement(node) ||
    ts.isThrowStatement(node) ||
    ts.isWithStatement(node)
  );
}

function evaluateConventionBindings(input: {
  sourceFile: ts.SourceFile;
  scriptOffset: number;
  locatorAt: LocatorFactory;
  declarations: BindingDeclaration[];
  modelId: string;
  absenceUnproven: boolean;
  blockers: StaticSettingsBlocker[];
}): Record<StaticSettingsConventionBinding, StaticSettingsBindingResult> {
  const output = {
    SCOPE: { status: "ABSENT_PROVEN" },
    AI_NAME: { status: "ABSENT_PROVEN" },
    settingsGroups: { status: "ABSENT_PROVEN" },
    defaultSettings: { status: "ABSENT_PROVEN" },
    controls: { status: "ABSENT_PROVEN" },
    conditionalRules: { status: "ABSENT_PROVEN" }
  } as Record<StaticSettingsConventionBinding, StaticSettingsBindingResult>;
  const declarationsByNode = new Map<ts.Node, BindingDeclaration>();
  for (const declaration of input.declarations) {
    declarationsByNode.set(declaration.declaration, declaration);
  }
  const environment = new Map<string, EvaluationOutcome>();
  const context: EvaluationContext = {
    environment,
    modelId: input.modelId,
    modelIdShadowed: hasTopLevelBinding(input.sourceFile, "model_id")
  };

  for (const statement of input.sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    const isConst =
      (statement.declarationList.flags & ts.NodeFlags.Const) !== 0;
    for (const declaration of statement.declarationList.declarations) {
      const convention = declarationsByNode.get(declaration);
      if (!ts.isIdentifier(declaration.name)) {
        if (convention !== undefined) {
          const failure = blockedBinding(
            convention.binding,
            "DESTRUCTURED_BINDING_NOT_INTERPRETED",
            declaration,
            input
          );
          output[convention.binding] = failure;
        }
        if (collectBindingNames(declaration.name).includes("model_id")) {
          addEvaluationBlocker(
            "MODEL_ID_SHADOWED",
            "source",
            declaration,
            input
          );
        }
        continue;
      }
      const name = declaration.name.text;
      if (name === "model_id") {
        addEvaluationBlocker(
          "MODEL_ID_SHADOWED",
          "source",
          declaration.name,
          input
        );
        continue;
      }
      let outcome: EvaluationOutcome;
      if (!isConst) {
        outcome = {
          ok: false,
          code: "NON_CONST_BINDING_NOT_INTERPRETED",
          node: declaration
        };
      } else if (declaration.initializer === undefined) {
        outcome = {
          ok: false,
          code: "BINDING_INITIALIZER_MISSING",
          node: declaration
        };
      } else {
        outcome = evaluateExpression(declaration.initializer, context);
      }
      environment.set(name, outcome);
      if (convention === undefined) {
        if (!outcome.ok) {
          addEvaluationBlocker(
            outcome.code,
            "source",
            outcome.node,
            input
          );
        }
        continue;
      }
      if (!outcome.ok) {
        output[convention.binding] = blockedBinding(
          convention.binding,
          outcome.code,
          outcome.node,
          input,
          outcome.candidates,
          outcome.candidatesNode
        );
        continue;
      }
      output[convention.binding] = {
        status: "PROVEN",
        value: materializeValue(outcome.value, input.modelId),
        locator: locatorForNode(
          declaration,
          input.sourceFile,
          input.scriptOffset,
          input.locatorAt
        )
      };
    }
  }

  for (const declaration of input.declarations) {
    if (ts.isVariableDeclaration(declaration.declaration)) continue;
    output[declaration.binding] = blockedBinding(
      declaration.binding,
      "NON_CONST_BINDING_NOT_INTERPRETED",
      declaration.declaration,
      input
    );
  }
  const absenceUnproven =
    input.absenceUnproven ||
    CONVENTION_BINDINGS.some(
      (binding) => output[binding].status === "BLOCKED"
    );
  if (absenceUnproven) {
    for (const binding of CONVENTION_BINDINGS) {
      if (output[binding].status !== "ABSENT_PROVEN") continue;
      output[binding] = blockedBinding(
        binding,
        "BINDING_ABSENCE_UNPROVEN",
        input.sourceFile,
        input
      );
    }
  }
  return output;
}

function blockedBinding(
  binding: StaticSettingsConventionBinding,
  code: StaticSettingsBlockerCode,
  node: ts.Node,
  input: {
    sourceFile: ts.SourceFile;
    scriptOffset: number;
    locatorAt: LocatorFactory;
    blockers: StaticSettingsBlocker[];
    modelId: string;
  },
  candidates?: EvaluatedValue,
  candidatesNode?: ts.Node
): StaticSettingsBindingResult {
  const locator = locatorForNode(
    node,
    input.sourceFile,
    input.scriptOffset,
    input.locatorAt
  );
  input.blockers.push({ code, projection: binding, ...locator });
  const base: {
    status: "BLOCKED";
    blocker_codes: StaticSettingsBlockerCode[];
    locator: StaticSettingsLocator;
  } = {
    status: "BLOCKED",
    blocker_codes: [code],
    locator
  };
  if (candidates === undefined) return base;
  return {
    ...base,
    candidates: materializeValue(candidates, input.modelId),
    candidates_locator: locatorForNode(
      candidatesNode ?? node,
      input.sourceFile,
      input.scriptOffset,
      input.locatorAt
    )
  };
}

function addEvaluationBlocker(
  code: StaticSettingsBlockerCode,
  projection: StaticSettingsProjection,
  node: ts.Node,
  input: {
    sourceFile: ts.SourceFile;
    scriptOffset: number;
    locatorAt: LocatorFactory;
    blockers: StaticSettingsBlocker[];
  }
): void {
  input.blockers.push({
    code,
    projection,
    ...locatorForNode(
      node,
      input.sourceFile,
      input.scriptOffset,
      input.locatorAt
    )
  });
}

function evaluateExpression(
  expression: ts.Expression,
  context: EvaluationContext
): EvaluationOutcome {
  const unwrapped = unwrapExpression(expression);
  if (ts.isStringLiteral(unwrapped)) {
    return { ok: true, value: unwrapped.text };
  }
  if (ts.isNumericLiteral(unwrapped)) {
    const value = Number(unwrapped.text);
    return Number.isFinite(value)
      ? { ok: true, value: Object.is(value, -0) ? 0 : value }
      : unsupported(unwrapped);
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }
  if (unwrapped.kind === ts.SyntaxKind.NullKeyword) {
    return { ok: true, value: null };
  }
  if (ts.isIdentifier(unwrapped)) {
    if (unwrapped.text === "model_id") {
      return context.modelIdShadowed
        ? failure("MODEL_ID_SHADOWED", unwrapped)
        : { ok: true, value: MODEL_ID_SENTINEL };
    }
    return (
      context.environment.get(unwrapped.text) ?? {
        ok: false,
        code: "UNKNOWN_IDENTIFIER_NOT_INTERPRETED",
        node: unwrapped
      }
    );
  }
  if (ts.isPrefixUnaryExpression(unwrapped)) {
    if (unwrapped.operator === ts.SyntaxKind.MinusToken) {
      const operand = evaluateExpression(unwrapped.operand, context);
      if (operand.ok && typeof operand.value === "number") {
        const value = -operand.value;
        return Number.isFinite(value)
          ? { ok: true, value: Object.is(value, -0) ? 0 : value }
          : unsupported(unwrapped);
      }
      return operand.ok ? unsupported(unwrapped) : operand;
    }
    if (unwrapped.operator === ts.SyntaxKind.ExclamationToken) {
      const condition = evaluateCondition(unwrapped, context);
      return condition.ok
        ? { ok: true, value: condition.value }
        : condition;
    }
    return isMutationNode(unwrapped)
      ? failure("MUTATION_NOT_INTERPRETED", unwrapped)
      : unsupported(unwrapped);
  }
  if (ts.isArrayLiteralExpression(unwrapped)) {
    const values: EvaluatedValue[] = [];
    for (const element of unwrapped.elements) {
      if (ts.isSpreadElement(element)) {
        return failure("SPREAD_NOT_INTERPRETED", element);
      }
      if (ts.isOmittedExpression(element)) return unsupported(element);
      const outcome = evaluateExpression(element, context);
      if (!outcome.ok) return outcome;
      values.push(outcome.value);
    }
    return { ok: true, value: values };
  }
  if (ts.isObjectLiteralExpression(unwrapped)) {
    const entries = new Map<string, EvaluatedValue>();
    let firstFailure: EvaluationFailure | undefined;
    for (const property of unwrapped.properties) {
      if (ts.isSpreadAssignment(property)) {
        firstFailure ??= failure("SPREAD_NOT_INTERPRETED", property);
        continue;
      }
      if (ts.isMethodDeclaration(property) ||
          ts.isGetAccessorDeclaration(property) ||
          ts.isSetAccessorDeclaration(property)) {
        firstFailure ??= failure("FUNCTION_NOT_INTERPRETED", property);
        continue;
      }
      if (ts.isShorthandPropertyAssignment(property)) {
        const outcome = evaluateExpression(property.name, context);
        if (!outcome.ok) {
          firstFailure ??= outcome;
          if (outcome.candidates !== undefined) {
            entries.set(property.name.text, outcome.candidates);
          }
          continue;
        }
        entries.set(property.name.text, outcome.value);
        continue;
      }
      if (!ts.isPropertyAssignment(property)) {
        firstFailure ??= failure(
          "UNSUPPORTED_SYNTAX_NOT_INTERPRETED",
          property
        );
        continue;
      }
      if (ts.isComputedPropertyName(property.name)) {
        firstFailure ??= failure(
          "COMPUTED_KEY_NOT_INTERPRETED",
          property.name
        );
        continue;
      }
      const key = staticPropertyName(property.name);
      if (key === undefined) {
        firstFailure ??= failure(
          "UNSUPPORTED_SYNTAX_NOT_INTERPRETED",
          property.name
        );
        continue;
      }
      const outcome = evaluateExpression(property.initializer, context);
      if (!outcome.ok) {
        firstFailure ??= outcome;
        if (outcome.candidates !== undefined) {
          entries.set(key, outcome.candidates);
        }
        continue;
      }
      entries.set(key, outcome.value);
    }
    const object: EvaluatedObject = {};
    for (const key of [...entries.keys()].sort()) {
      Object.defineProperty(object, key, {
        value: entries.get(key)!,
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    if (firstFailure !== undefined) {
      return {
        ...firstFailure,
        ...(entries.size === 0
          ? {}
          : { candidates: object, candidatesNode: unwrapped })
      };
    }
    return { ok: true, value: object };
  }
  if (ts.isPropertyAccessExpression(unwrapped)) {
    if (unwrapped.questionDotToken !== undefined) {
      return failure("DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED", unwrapped);
    }
    return evaluateStaticMember(
      unwrapped.expression,
      unwrapped.name.text,
      unwrapped,
      context
    );
  }
  if (ts.isElementAccessExpression(unwrapped)) {
    if (
      unwrapped.questionDotToken !== undefined ||
      !isStaticElementKey(unwrapped.argumentExpression)
    ) {
      return failure("DYNAMIC_MEMBER_ACCESS_NOT_INTERPRETED", unwrapped);
    }
    return evaluateStaticMember(
      unwrapped.expression,
      staticElementKey(unwrapped.argumentExpression),
      unwrapped,
      context
    );
  }
  if (ts.isConditionalExpression(unwrapped)) {
    const condition = evaluateCondition(unwrapped.condition, context);
    if (!condition.ok) return condition;
    return evaluateExpression(
      condition.value ? unwrapped.whenTrue : unwrapped.whenFalse,
      context
    );
  }
  if (
    ts.isBinaryExpression(unwrapped) &&
    (unwrapped.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken ||
      unwrapped.operatorToken.kind === ts.SyntaxKind.BarBarToken)
  ) {
    const condition = evaluateCondition(unwrapped, context);
    return condition.ok
      ? { ok: true, value: condition.value }
      : condition;
  }
  if (ts.isCallExpression(unwrapped)) {
    if (ts.isIdentifier(unwrapped.expression)) {
      if (unwrapped.expression.text === "computed") {
        return failure("COMPUTED_RULE_NOT_INTERPRETED", unwrapped);
      }
      if (unwrapped.expression.text === "watch") {
        return failure("WATCH_RULE_NOT_INTERPRETED", unwrapped);
      }
    }
    return failure("CALL_EXPRESSION_NOT_INTERPRETED", unwrapped);
  }
  if (ts.isNewExpression(unwrapped)) {
    return failure("NEW_EXPRESSION_NOT_INTERPRETED", unwrapped);
  }
  if (ts.isArrowFunction(unwrapped) || ts.isFunctionExpression(unwrapped)) {
    return failure("FUNCTION_NOT_INTERPRETED", unwrapped);
  }
  if (ts.isBinaryExpression(unwrapped) && isAssignmentOperator(unwrapped.operatorToken.kind)) {
    return failure("MUTATION_NOT_INTERPRETED", unwrapped);
  }
  return unsupported(unwrapped);
}

function evaluateCondition(
  expression: ts.Expression,
  context: EvaluationContext
): ConditionOutcome {
  const unwrapped = unwrapExpression(expression);
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }
  if (
    ts.isPrefixUnaryExpression(unwrapped) &&
    unwrapped.operator === ts.SyntaxKind.ExclamationToken
  ) {
    const operand = evaluateCondition(unwrapped.operand, context);
    return operand.ok
      ? { ok: true, value: !operand.value }
      : operand;
  }
  if (ts.isBinaryExpression(unwrapped)) {
    const operator = unwrapped.operatorToken.kind;
    if (
      operator === ts.SyntaxKind.AmpersandAmpersandToken ||
      operator === ts.SyntaxKind.BarBarToken
    ) {
      const left = evaluateCondition(unwrapped.left, context);
      if (!left.ok) return left;
      const leftBoolean = left.value;
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken && !leftBoolean) {
        return { ok: true, value: false };
      }
      if (operator === ts.SyntaxKind.BarBarToken && leftBoolean) {
        return { ok: true, value: true };
      }
      const right = evaluateCondition(unwrapped.right, context);
      return right.ok
        ? { ok: true, value: right.value }
        : right;
    }
    if (
      operator === ts.SyntaxKind.EqualsEqualsEqualsToken ||
      operator === ts.SyntaxKind.ExclamationEqualsEqualsToken
    ) {
      const left = evaluateExpression(unwrapped.left, context);
      if (!left.ok) return left;
      const right = evaluateExpression(unwrapped.right, context);
      if (!right.ok) return right;
      const oneModelReference =
        (left.value === MODEL_ID_SENTINEL) !==
        (right.value === MODEL_ID_SENTINEL);
      const literal =
        left.value === MODEL_ID_SENTINEL ? right.value : left.value;
      if (!oneModelReference || typeof literal !== "string") {
        return failure("MODEL_CONDITION_NOT_INTERPRETED", unwrapped);
      }
      const equal = context.modelId === literal;
      return {
        ok: true,
        value:
          operator === ts.SyntaxKind.EqualsEqualsEqualsToken ? equal : !equal
      };
    }
  }
  const evaluated = evaluateExpressionWithoutCondition(unwrapped, context);
  if (evaluated.ok && typeof evaluated.value === "boolean") {
    return { ok: true, value: evaluated.value };
  }
  return evaluated.ok
    ? failure("MODEL_CONDITION_NOT_INTERPRETED", unwrapped)
    : evaluated;
}

function evaluateExpressionWithoutCondition(
  expression: ts.Expression,
  context: EvaluationContext
): EvaluationOutcome {
  const unwrapped = unwrapExpression(expression);
  if (ts.isIdentifier(unwrapped)) {
    if (unwrapped.text === "model_id") {
      return context.modelIdShadowed
        ? failure("MODEL_ID_SHADOWED", unwrapped)
        : { ok: true, value: MODEL_ID_SENTINEL };
    }
    return (
      context.environment.get(unwrapped.text) ??
      failure("UNKNOWN_IDENTIFIER_NOT_INTERPRETED", unwrapped)
    );
  }
  if (unwrapped.kind === ts.SyntaxKind.TrueKeyword) {
    return { ok: true, value: true };
  }
  if (unwrapped.kind === ts.SyntaxKind.FalseKeyword) {
    return { ok: true, value: false };
  }
  return failure("MODEL_CONDITION_NOT_INTERPRETED", unwrapped);
}

function evaluateStaticMember(
  baseExpression: ts.Expression,
  key: string,
  node: ts.Node,
  context: EvaluationContext
): EvaluationOutcome {
  const base = evaluateExpression(baseExpression, context);
  if (!base.ok) return base;
  if (base.value === MODEL_ID_SENTINEL || base.value === null) {
    return failure("STATIC_MEMBER_NOT_FOUND", node);
  }
  if (Array.isArray(base.value)) {
    if (!/^(?:0|[1-9]\d*)$/u.test(key)) {
      return failure("STATIC_MEMBER_NOT_FOUND", node);
    }
    const index = Number(key);
    const value = base.value[index];
    return value === undefined
      ? failure("STATIC_MEMBER_NOT_FOUND", node)
      : { ok: true, value };
  }
  if (typeof base.value !== "object") {
    return failure("STATIC_MEMBER_NOT_FOUND", node);
  }
  if (!Object.prototype.hasOwnProperty.call(base.value, key)) {
    return failure("STATIC_MEMBER_NOT_FOUND", node);
  }
  return { ok: true, value: base.value[key]! };
}

function unwrapExpression(expression: ts.Expression): ts.Expression {
  let current = expression;
  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isTypeAssertionExpression(current) ||
    ts.isSatisfiesExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }
  return current;
}

function materializeValue(
  value: EvaluatedValue,
  modelId: string
): StaticSettingsJsonValue {
  if (value === MODEL_ID_SENTINEL) return modelId;
  if (Array.isArray(value)) {
    return value.map((entry) => materializeValue(entry, modelId));
  }
  if (value !== null && typeof value === "object") {
    const output: { [key: string]: StaticSettingsJsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      Object.defineProperty(output, key, {
        value: materializeValue(value[key]!, modelId),
        enumerable: true,
        configurable: false,
        writable: false
      });
    }
    return output;
  }
  return value;
}

function unsupported(node: ts.Node): EvaluationOutcome {
  return failure("UNSUPPORTED_SYNTAX_NOT_INTERPRETED", node);
}

function failure(
  code: StaticSettingsBlockerCode,
  node: ts.Node
): EvaluationFailure {
  return { ok: false, code, node };
}

type LocatorFactory = (offset: number, nodeKind: string) => StaticSettingsLocator;

function createLocatorFactory(source: string): LocatorFactory {
  const lineStarts = [0];
  for (let index = 0; index < source.length; index += 1) {
    if (source.charCodeAt(index) === 10) lineStarts.push(index + 1);
  }
  return (offset, nodeKind) => {
    let lower = 0;
    let upper = lineStarts.length;
    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (lineStarts[middle]! <= offset) lower = middle;
      else upper = middle;
    }
    return {
      node_kind: nodeKind,
      line: lower + 1,
      column: offset - lineStarts[lower]! + 1
    };
  };
}

function locatorForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  scriptOffset: number,
  locatorAt: LocatorFactory
): StaticSettingsLocator {
  return locatorAt(
    scriptOffset + node.getStart(sourceFile),
    syntaxKindName(node)
  );
}

function syntaxKindName(node: ts.Node): string {
  return ts.SyntaxKind[node.kind] ?? "Unknown";
}

function projectionForNode(
  node: ts.Node,
  sourceFile: ts.SourceFile,
  ranges: Array<{
    start: number;
    end: number;
    projection: StaticSettingsConventionBinding;
  }>
): StaticSettingsProjection {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const match = ranges.find((range) => start >= range.start && end <= range.end);
  return match?.projection ?? "source";
}

function sortAndDedupeBlockers(
  blockers: StaticSettingsBlocker[]
): StaticSettingsBlocker[] {
  const byKey = new Map<string, StaticSettingsBlocker>();
  for (const blocker of blockers) {
    const key = [
      blocker.line,
      blocker.column,
      blocker.code,
      blocker.projection,
      blocker.node_kind
    ].join("\u0000");
    byKey.set(key, blocker);
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      compareText(left.code, right.code) ||
      compareText(left.projection, right.projection) ||
      compareText(left.node_kind, right.node_kind)
  );
}

function sortAndDedupeLocators(
  locators: StaticSettingsLocator[]
): StaticSettingsLocator[] {
  const byKey = new Map<string, StaticSettingsLocator>();
  for (const locator of locators) {
    byKey.set(
      `${locator.line}\u0000${locator.column}\u0000${locator.node_kind}`,
      locator
    );
  }
  return [...byKey.values()].sort(
    (left, right) =>
      left.line - right.line ||
      left.column - right.column ||
      compareText(left.node_kind, right.node_kind)
  );
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function staticPropertyName(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) {
    return name.text;
  }
  return undefined;
}

function validateObjectKey(key: string, maxStringBytes: number): void {
  if (textEncoder.encode(key).byteLength > maxStringBytes) {
    throw new StaticSettingsCompilerError("STRING_BYTE_LIMIT_EXCEEDED");
  }
  if (FORBIDDEN_OBJECT_KEYS.has(key)) {
    throw new StaticSettingsCompilerError("OBJECT_KEY_FORBIDDEN");
  }
}

function isStaticElementKey(
  expression: ts.Expression | undefined
): expression is ts.StringLiteral | ts.NumericLiteral {
  return (
    expression !== undefined &&
    (ts.isStringLiteral(expression) || ts.isNumericLiteral(expression))
  );
}

function staticElementKey(
  expression: ts.StringLiteral | ts.NumericLiteral | undefined
): string {
  return expression?.text ?? "";
}

function isDirectReactiveCallback(node: ts.Node): boolean {
  const parent = node.parent;
  return (
    parent !== undefined &&
    ts.isCallExpression(parent) &&
    ts.isIdentifier(parent.expression) &&
    (parent.expression.text === "computed" || parent.expression.text === "watch")
  );
}

function isFunctionLikeNode(node: ts.Node): boolean {
  return (
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isSetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

function isMutationNode(node: ts.Node): boolean {
  if (ts.isBinaryExpression(node)) {
    return isAssignmentOperator(node.operatorToken.kind);
  }
  if (ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) {
    return (
      node.operator === ts.SyntaxKind.PlusPlusToken ||
      node.operator === ts.SyntaxKind.MinusMinusToken
    );
  }
  return ts.isDeleteExpression(node);
}

function isAssignmentOperator(kind: ts.SyntaxKind): boolean {
  return kind >= ts.SyntaxKind.FirstAssignment && kind <= ts.SyntaxKind.LastAssignment;
}

function isLoopNode(node: ts.Node): boolean {
  return (
    ts.isForStatement(node) ||
    ts.isForInStatement(node) ||
    ts.isForOfStatement(node) ||
    ts.isWhileStatement(node) ||
    ts.isDoStatement(node)
  );
}

function skipWhitespace(source: string, from: number): number {
  let cursor = from;
  while (cursor < source.length && isWhitespace(source[cursor])) cursor += 1;
  return cursor;
}

function isWhitespace(character: string | undefined): boolean {
  return character !== undefined && /[\t\n\f\r ]/u.test(character);
}

function isTagNameStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z]/u.test(character);
}

function isTagNamePart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9:_-]/u.test(character);
}
