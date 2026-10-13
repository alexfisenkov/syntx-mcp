import { createHash } from "node:crypto";
import ts from "typescript";
import { z } from "zod/v4";

const SHA256 = /^sha256:[a-f0-9]{64}$/u;
const sourceRefSchema = z.object({
  module_name: z.string().min(1).max(128),
  url: z.string().url(),
  bytes: z.number().int().positive().max(3_000_000),
  sha256: z.string().regex(SHA256)
}).strict();

const locatorSchema = z.object({
  line: z.number().int().positive(),
  column: z.number().int().positive()
}).strict();

const transformSchema = z.object({
  field: z.string().min(1).max(128),
  expression_kind: z.enum(["CALL", "UNARY", "PROPERTY_ACCESS", "ELEMENT_ACCESS", "STRING_LITERAL", "NUMBER_LITERAL", "BOOLEAN_LITERAL", "NULL_LITERAL", "CONDITIONAL", "IDENTIFIER", "OTHER"]),
  source_path: z.string().max(256).nullable(),
  transform: z.enum([
    "DIRECT_FIELD",
    "BOOLEAN_CALL",
    "BOOLEAN_COERCE",
    "STRING_CALL",
    "NUMBER_CALL",
    "LITERAL",
    "CONDITIONAL",
    "DYNAMIC"
  ]),
  locator: locatorSchema
}).strict();

const routeSchema = z.object({
  route: z.string().max(256).nullable(),
  route_status: z.enum(["CALL_ARGUMENT_LITERAL", "DYNAMIC_PATH"]),
  method: z.string().max(32).nullable(),
  operation: z.enum([
    "CHAT_CREATE_CANDIDATE",
    "IMAGE_GENERATION_CANDIDATE",
    "VIDEO_GENERATION_CANDIDATE",
    "UPLOAD_CANDIDATE",
    "POLL_CANDIDATE",
    "RESULT_CANDIDATE",
    "CANCEL_CANDIDATE",
    "UNCLASSIFIED"
  ]),
  locator: locatorSchema
}).strict();

const callSchema = z.object({
  method: z.string().max(32).nullable(),
  route: z.string().max(256).nullable(),
  route_status: z.enum(["CALL_ARGUMENT_LITERAL", "DYNAMIC_PATH"]),
  body_fields: z.array(z.string().max(128)).max(128),
  settings_fields: z.array(z.string().max(128)).max(128),
  field_transforms: z.array(transformSchema).max(256),
  unresolved_body_reasons: z.array(z.enum([
    "DYNAMIC_ROUTE",
    "OBJECT_SPREAD",
    "DYNAMIC_FIELD_VALUE",
    "NON_OBJECT_BODY"
  ])).max(8),
  locator: locatorSchema
}).strict();

export const staticMediaWireAnalysisSchema = z.object({
  schema_version: z.literal("1.0.0"),
  catalog_kind: z.literal("STATIC_MEDIA_WIRE_AST_ANALYSIS"),
  evidence_level: z.literal("HASH_PINNED_COMPILED_JS_AST"),
  source: sourceRefSchema,
  routes: z.array(routeSchema).max(2048),
  calls: z.array(callSchema).max(2048),
  runtime_usable: z.literal(false),
  backend_verified: z.literal(false),
  vendor_code_executed: z.literal(false),
  source_persisted: z.literal(false),
  limitations: z.array(z.string().min(1).max(512)).max(16)
}).strict();

export type PinnedStaticMediaWireSourceReference = z.infer<typeof sourceRefSchema>;
export type StaticMediaWireAnalysis = z.infer<typeof staticMediaWireAnalysisSchema>;

export class StaticMediaWireAnalysisError extends Error {
  constructor(readonly code: "SOURCE_BINDING_INVALID" | "SOURCE_SIZE_MISMATCH" | "SOURCE_HASH_MISMATCH" | "AST_PARSE_FAILED") {
    super("Pinned media wire source could not be analyzed safely.");
    this.name = "StaticMediaWireAnalysisError";
  }
}

/** Parses one hash-bound compiled source in memory; result contains derived AST facts, never source text. */
export function analyzeStaticMediaWireSource(
  input: PinnedStaticMediaWireSourceReference,
  sourceText: string
): StaticMediaWireAnalysis {
  const source = validateSource(input, sourceText);
  const file = ts.createSourceFile(source.module_name, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as ts.SourceFile & { readonly parseDiagnostics?: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics && diagnostics.length > 0) throw new StaticMediaWireAnalysisError("AST_PARSE_FAILED");

  const routes: StaticMediaWireAnalysis["routes"] = [];
  const calls: StaticMediaWireAnalysis["calls"] = [];
  const seen = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && isWireLikeCall(node)) {
      const first = node.arguments[0];
      const route = first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first))
        ? first.text
        : null;
      if (route === null || isRouteLike(route)) {
        const routeStatus = route === null ? "DYNAMIC_PATH" as const : "CALL_ARGUMENT_LITERAL" as const;
        const method = methodName(node.expression);
        const location = locator(file, first ?? node);
        const key = `${location.line}:${location.column}:${route ?? "<dynamic>"}:${method ?? ""}`;
        if (!seen.has(key)) {
          seen.add(key);
          routes.push({ route, route_status: routeStatus, method, operation: classifyOperation(route), locator: location });
          const body = node.arguments[1];
          const parsedBody = readBody(body, file);
          const reasons = new Set(parsedBody.reasons);
          if (routeStatus === "DYNAMIC_PATH") reasons.add("DYNAMIC_ROUTE");
          calls.push({
            method,
            route,
            route_status: routeStatus,
            body_fields: parsedBody.bodyFields,
            settings_fields: parsedBody.settingsFields,
            field_transforms: parsedBody.transforms,
            unresolved_body_reasons: [...reasons].sort(),
            locator: locator(file, node)
          });
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(file);

  return staticMediaWireAnalysisSchema.parse({
    schema_version: "1.0.0",
    catalog_kind: "STATIC_MEDIA_WIRE_AST_ANALYSIS",
    evidence_level: "HASH_PINNED_COMPILED_JS_AST",
    source,
    routes: routes.sort(compareLocator),
    calls: calls.sort(compareLocator),
    runtime_usable: false,
    backend_verified: false,
    vendor_code_executed: false,
    source_persisted: false,
    limitations: [
      "Only direct call-argument route literals and object-literal field expressions are projected.",
      "Dynamic route factories, imported aliases, object spreads, and runtime conditions remain unresolved.",
      "Static first-party source evidence is not backend acceptance or runtime verification."
    ]
  });
}

function validateSource(input: PinnedStaticMediaWireSourceReference, sourceText: string): PinnedStaticMediaWireSourceReference {
  let source: PinnedStaticMediaWireSourceReference;
  try {
    source = sourceRefSchema.parse(input);
    const url = new URL(source.url);
    if (url.protocol !== "https:" || url.hostname !== "syntx.ai" || !/^\/assets\/\d+\//u.test(url.pathname)) {
      throw new Error("invalid first-party asset URL");
    }
  } catch {
    throw new StaticMediaWireAnalysisError("SOURCE_BINDING_INVALID");
  }
  const bytes = Buffer.from(sourceText, "utf8");
  if (bytes.byteLength !== source.bytes) throw new StaticMediaWireAnalysisError("SOURCE_SIZE_MISMATCH");
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (digest !== source.sha256) throw new StaticMediaWireAnalysisError("SOURCE_HASH_MISMATCH");
  return source;
}

function isWireLikeCall(node: ts.CallExpression): boolean {
  const name = methodName(node.expression)?.toLowerCase() ?? "";
  if (!new Set(["get", "post", "put", "patch", "delete", "request", "fetch"]).has(name)) return false;
  if (name === "get" || name === "delete") {
    const first = node.arguments[0];
    return first !== undefined && (ts.isStringLiteral(first) || ts.isNoSubstitutionTemplateLiteral(first)) && isRouteLike(first.text);
  }
  return true;
}

function methodName(expression: ts.Expression): string | null {
  if (ts.isPropertyAccessExpression(expression)) return expression.name.text;
  if (ts.isIdentifier(expression)) return expression.text === "fetch" ? "fetch" : null;
  return null;
}

function isRouteLike(value: string): boolean {
  return value.startsWith("/") || /^(?:api\/|chats\/|files\/|images\/|video\/|audio\/)/iu.test(value);
}

function classifyOperation(route: string | null): StaticMediaWireAnalysis["routes"][number]["operation"] {
  if (route === null) return "UNCLASSIFIED";
  const normalized = route.toLowerCase();
  if (/chat[^/]*\/(?:create|new)|chats?\/(?:create|new)$/u.test(normalized)) return "CHAT_CREATE_CANDIDATE";
  if (/images?\/(?:generate|create)|(?:^|\/)generate-image/u.test(normalized)) return "IMAGE_GENERATION_CANDIDATE";
  if (/videos?\/(?:generate|create)|(?:^|\/)generate-video/u.test(normalized)) return "VIDEO_GENERATION_CANDIDATE";
  if (/upload/u.test(normalized)) return "UPLOAD_CANDIDATE";
  if (/cancel/u.test(normalized)) return "CANCEL_CANDIDATE";
  if (/result/u.test(normalized)) return "RESULT_CANDIDATE";
  if (/status|poll/u.test(normalized)) return "POLL_CANDIDATE";
  return "UNCLASSIFIED";
}

function readBody(body: ts.Expression | undefined, file: ts.SourceFile): {
  bodyFields: string[];
  settingsFields: string[];
  transforms: StaticMediaWireAnalysis["calls"][number]["field_transforms"];
  reasons: StaticMediaWireAnalysis["calls"][number]["unresolved_body_reasons"];
} {
  if (body === undefined) return { bodyFields: [], settingsFields: [], transforms: [], reasons: ["NON_OBJECT_BODY"] };
  let object = unwrap(body);
  if (!ts.isObjectLiteralExpression(object)) return { bodyFields: [], settingsFields: [], transforms: [], reasons: ["NON_OBJECT_BODY"] };
  const reasons = new Set<StaticMediaWireAnalysis["calls"][number]["unresolved_body_reasons"][number]>();
  const bodyFields: string[] = [];
  const transforms: StaticMediaWireAnalysis["calls"][number]["field_transforms"] = [];
  let settingsFields: string[] = [];
  for (const property of object.properties) {
    if (ts.isSpreadAssignment(property)) { reasons.add("OBJECT_SPREAD"); continue; }
    if (!ts.isPropertyAssignment(property)) continue;
    const field = propertyName(property.name);
    if (field === null) { reasons.add("DYNAMIC_FIELD_VALUE"); continue; }
    bodyFields.push(field);
    const value = unwrap(property.initializer);
    if (field === "settings" && ts.isObjectLiteralExpression(value)) {
      settingsFields = value.properties.flatMap((setting) => {
        if (ts.isSpreadAssignment(setting)) { reasons.add("OBJECT_SPREAD"); return []; }
        if (!ts.isPropertyAssignment(setting)) return [];
        const settingField = propertyName(setting.name);
        if (settingField === null) { reasons.add("DYNAMIC_FIELD_VALUE"); return []; }
        const transform = analyzeTransform(settingField, setting.initializer, file);
        transforms.push(transform);
        if (transform.transform === "DYNAMIC") reasons.add("DYNAMIC_FIELD_VALUE");
        return [settingField];
      });
    } else {
      const transform = analyzeTransform(field, property.initializer, file);
      transforms.push(transform);
      if (transform.transform === "DYNAMIC") reasons.add("DYNAMIC_FIELD_VALUE");
    }
  }
  return { bodyFields: bodyFields.sort(), settingsFields: settingsFields.sort(), transforms: transforms.sort((a, b) => a.field.localeCompare(b.field)), reasons: [...reasons] };
}

function analyzeTransform(field: string, expression: ts.Expression, file: ts.SourceFile): StaticMediaWireAnalysis["calls"][number]["field_transforms"][number] {
  const value = unwrap(expression);
  let transform: StaticMediaWireAnalysis["calls"][number]["field_transforms"][number]["transform"];
  let expressionKind: StaticMediaWireAnalysis["calls"][number]["field_transforms"][number]["expression_kind"];
  let sourcePath: string | null = null;
  if (ts.isCallExpression(value) && ts.isIdentifier(value.expression)) {
    expressionKind = "CALL";
    transform = value.expression.text === "Boolean" ? "BOOLEAN_CALL"
      : value.expression.text === "String" ? "STRING_CALL"
      : ["Number", "parseInt", "parseFloat"].includes(value.expression.text) ? "NUMBER_CALL"
      : "DYNAMIC";
  } else if (ts.isPrefixUnaryExpression(value) && value.operator === ts.SyntaxKind.ExclamationToken) {
    expressionKind = "UNARY";
    transform = "BOOLEAN_COERCE";
  } else if (ts.isPropertyAccessExpression(value)) {
    expressionKind = "PROPERTY_ACCESS";
    transform = "DIRECT_FIELD";
    sourcePath = staticPropertyPath(value);
  } else if (ts.isElementAccessExpression(value)) {
    expressionKind = "ELEMENT_ACCESS";
    transform = "DIRECT_FIELD";
    sourcePath = staticPropertyPath(value);
  } else if (ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) || ts.isNumericLiteral(value) || value.kind === ts.SyntaxKind.TrueKeyword || value.kind === ts.SyntaxKind.FalseKeyword || value.kind === ts.SyntaxKind.NullKeyword) {
    expressionKind = ts.isNumericLiteral(value) ? "NUMBER_LITERAL" : ts.isStringLiteral(value) || ts.isNoSubstitutionTemplateLiteral(value) ? "STRING_LITERAL" : value.kind === ts.SyntaxKind.NullKeyword ? "NULL_LITERAL" : "BOOLEAN_LITERAL";
    transform = "LITERAL";
  } else if (ts.isConditionalExpression(value)) {
    expressionKind = "CONDITIONAL";
    transform = "CONDITIONAL";
  } else if (ts.isIdentifier(value)) {
    expressionKind = "IDENTIFIER";
    transform = "DYNAMIC";
  } else {
    expressionKind = "OTHER";
    transform = "DYNAMIC";
  }
  return {
    field,
    expression_kind: expressionKind,
    source_path: sourcePath,
    transform,
    locator: locator(file, expression)
  };
}

function staticPropertyPath(expression: ts.PropertyAccessExpression | ts.ElementAccessExpression): string | null {
  const parts: string[] = [];
  let current: ts.Expression = expression;
  while (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
    if (ts.isPropertyAccessExpression(current)) {
      parts.unshift(current.name.text);
      current = current.expression;
    } else {
      const argument = current.argumentExpression;
      if (argument === undefined || !ts.isStringLiteral(argument) && !ts.isNumericLiteral(argument)) return null;
      parts.unshift(argument.text);
      current = current.expression;
    }
  }
  if (!ts.isIdentifier(current)) return null;
  parts.unshift(current.text);
  const path = parts.join(".");
  return path.length <= 256 ? path : null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let value = expression;
  while (ts.isParenthesizedExpression(value) || ts.isAsExpression(value) || ts.isTypeAssertionExpression(value) || ts.isNonNullExpression(value)) value = value.expression;
  return value;
}

function propertyName(name: ts.PropertyName): string | null {
  if (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) return name.text;
  return null;
}

function locator(file: ts.SourceFile, node: ts.Node) {
  const point = file.getLineAndCharacterOfPosition(node.getStart(file));
  return { line: point.line + 1, column: point.character + 1 };
}

function compareLocator(left: { locator: { line: number; column: number } }, right: { locator: { line: number; column: number } }): number {
  return left.locator.line - right.locator.line || left.locator.column - right.locator.column;
}
