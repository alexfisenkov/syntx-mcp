import ts from "typescript";

export type StaticEsmJsonValue = null | boolean | number | string |
  StaticEsmJsonValue[] | { [key: string]: StaticEsmJsonValue };

type RecordBase = {
  scope: string;
  name: string;
  exported: boolean;
  locator: { line: number; column: number };
};

export type StaticEsmConstantRecord = RecordBase & (
  { status: "STATIC_VALUE"; value: StaticEsmJsonValue } |
  { status: "BLOCKED"; blocker: string }
);

export type StaticEsmConstantsResult = {
  profile: "STATIC_ESM_CONSTANTS_V1";
  proof_scope: "DECLARATION_INITIALIZERS_ONLY";
  runtime_usable: false;
  vendor_code_executed: false;
  source_persisted: false;
  records: StaticEsmConstantRecord[];
};

export const STATIC_ESM_CONSTANTS_LIMITS = Object.freeze({
  sourceBytes: 262_144,
  sourcePathBytes: 4096,
  astNodes: 30_000,
  astDepth: 96,
  lexicalTokenRun: 512,
  evaluationDepth: 64,
  evaluationSteps: 200_000,
  records: 512,
  localFunctions: 16,
  stringBytes: 16_384,
  valueNodes: 8192,
  valueBytes: 131_072,
  outputBytes: 1_048_576
});

export class StaticEsmConstantsError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "StaticEsmConstantsError";
  }
}

class Blocked extends Error {
  constructor(readonly code: string) { super(code); }
}

type Value = { json: StaticEsmJsonValue; bytes: number; nodes: number; depth: number };
type Binding = {
  name: string;
  declaration: ts.Node;
  initializer?: ts.Expression;
  constant: boolean;
  destructured: boolean;
};
type Scope = { name: string; bindings: Map<string, Binding[]>; parent?: Scope };
type Candidate = { binding: Binding; scope: Scope; exported: boolean; blocker?: string };

const forbiddenKeys = new Set(["__proto__", "prototype", "constructor"]);
const bytes = (value: string): number => Buffer.byteLength(value, "utf8");
const fail = (code: string): never => { throw new StaticEsmConstantsError(code); };
const blocked = (code: string): never => { throw new Blocked(code); };

/**
 * Extracts declaration initializer facts, NOT effective values, payload schemas,
 * control-flow outcomes, module execution, or dependency closure. Object aliases
 * are conservatively rejected if a same-named reference escapes or is mutated
 * anywhere in the file. Harmless primitive comparisons do not count as escapes.
 */
export function compileStaticEsmConstants(input: {
  source: string;
  sourcePath: string;
  localFunctionNames?: readonly string[];
}): StaticEsmConstantsResult {
  if (typeof input?.source !== "string" || typeof input.sourcePath !== "string" ||
      input.sourcePath.length === 0 || input.sourcePath.includes("\0") ||
      bytes(input.sourcePath) > STATIC_ESM_CONSTANTS_LIMITS.sourcePathBytes) fail("INVALID_INPUT");
  if (bytes(input.source) > STATIC_ESM_CONSTANTS_LIMITS.sourceBytes) fail("SOURCE_LIMIT");
  const requested = input.localFunctionNames ?? [];
  if (!Array.isArray(requested) || requested.length > STATIC_ESM_CONSTANTS_LIMITS.localFunctions ||
      requested.some((name) => typeof name !== "string" || !/^[A-Za-z_$][\w$]{0,127}$/.test(name)) ||
      new Set(requested).size !== requested.length || requested.includes("module")) fail("INVALID_LOCAL_FUNCTIONS");

  lexicalPreflight(input.source);
  let file: ts.SourceFile;
  try { file = ts.createSourceFile(input.sourcePath, input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS); }
  catch { return fail("INVALID_SOURCE"); }
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  if (diagnostics.length > 0) fail("INVALID_SOURCE");
  const nodes = boundedNodes(file);
  for (const name of requested) {
    if (!file.statements.some((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === name && statement.body)) {
      fail("LOCAL_FUNCTION_NOT_FOUND");
    }
  }
  const moduleScope: Scope = { name: "module", bindings: new Map() };
  const candidates: Candidate[] = [];
  const exportedNames = new Set<string>();
  for (const statement of file.statements) {
    if (ts.isExportDeclaration(statement) && !statement.moduleSpecifier && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
      for (const specifier of statement.exportClause.elements) exportedNames.add((specifier.propertyName ?? specifier.name).text);
    }
  }
  collectStatements(file.statements, moduleScope, candidates, exportedNames);
  collectNestedVarBindings(file.statements, moduleScope);
  for (const statement of file.statements) {
    if (!ts.isFunctionDeclaration(statement) || !statement.name || !requested.includes(statement.name.text) || !statement.body) continue;
    const scope: Scope = { name: statement.name.text, bindings: new Map(), parent: moduleScope };
    for (const parameter of statement.parameters) addUnsupportedNames(parameter.name, parameter, scope);
    const start = candidates.length;
    collectStatements(statement.body.statements, scope, candidates, new Set());
    collectNestedVarBindings(statement.body.statements, scope);
    if (moduleScope.bindings.get(statement.name.text)?.length !== 1 || statement.asteriskToken) {
      for (const candidate of candidates.slice(start)) candidate.blocker = "AMBIGUOUS_OR_GENERATOR_SCOPE";
    }
  }
  if (candidates.length > STATIC_ESM_CONSTANTS_LIMITS.records) fail("RECORD_LIMIT");

  const candidateDeclarations = new Set(candidates.map((candidate) => candidate.binding.declaration));
  const unsafeNames = collectUnsafeNames(nodes, candidateDeclarations);
  // Direct eval and with can name bindings without an AST identifier reference.
  // Their presence disables reference folding; literal declarations remain facts.
  if (nodes.some((node) => ts.isWithStatement(node) ||
      (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "eval"))) {
    for (const candidate of candidates) unsafeNames.add(candidate.binding.name);
  }
  const dependencyNames = new Map<string, Set<string>>();
  for (const candidate of candidates) {
    if (!candidate.binding.initializer) continue;
    const dependencies = dependencyNames.get(candidate.binding.name) ?? new Set<string>();
    const pending: ts.Node[] = [candidate.binding.initializer];
    while (pending.length) {
      const node = pending.pop()!;
      if (ts.isIdentifier(node) && !isNonReferenceName(node)) dependencies.add(node.text);
      ts.forEachChild(node, (child) => { pending.push(child); });
    }
    dependencyNames.set(candidate.binding.name, dependencies);
  }
  // An escape through any alias poisons its reference chain, not the standalone
  // literal initializer evidence. Name-wide analysis deliberately overblocks
  // ambiguous/shadowed occurrences instead of pretending to resolve all scopes.
  const queue = [...unsafeNames];
  for (let index = 0; index < queue.length; index++) {
    for (const dependency of dependencyNames.get(queue[index]!) ?? []) {
      if (!unsafeNames.has(dependency)) { unsafeNames.add(dependency); queue.push(dependency); }
    }
  }

  let steps = 0;
  const resolving = new Set<Binding>();
  const cache = new Map<Binding, Value>();
  function evaluate(node: ts.Expression, scope: Scope, before: number, depth = 0): Value {
    if (++steps > STATIC_ESM_CONSTANTS_LIMITS.evaluationSteps) fail("EVALUATION_STEP_LIMIT");
    if (depth > STATIC_ESM_CONSTANTS_LIMITS.evaluationDepth) return blocked("EVALUATION_DEPTH_LIMIT");
    const child = (expression: ts.Expression): Value => evaluate(expression, scope, before, depth + 1);
    if (ts.isParenthesizedExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) return child(node.expression);
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return scalar(node.text);
    if (ts.isNumericLiteral(node)) {
      // node.text is already TS's own String(parsedDouble), not the source digits: it round-trips
      // through Number() by construction and can never expose precision lost during scanning.
      // The raw source text is the only place the original digits still exist. Exactness is
      // proven only for plain-decimal and radix-prefixed INTEGER literals via exact BigInt
      // comparison; a fractional or exponent-notation literal that loses precision (e.g.
      // "1.0000000000000001") is not currently detected and is recorded as a fact regardless.
      const parsed = Number(node.text.replaceAll("_", ""));
      const raw = node.getText(file).replaceAll("_", "");
      if ((/^0[bBoOxX][0-9a-fA-F]+$/.test(raw) || /^[0-9]+$/.test(raw)) && Number.isFinite(parsed) &&
          BigInt(raw) !== BigInt(parsed)) return blocked("NUMBER_NOT_JSON_EXACT");
      return scalar(parsed);
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return scalar(true);
    if (node.kind === ts.SyntaxKind.FalseKeyword) return scalar(false);
    if (node.kind === ts.SyntaxKind.NullKeyword) return scalar(null);
    if (ts.isIdentifier(node)) {
      let current: Scope | undefined = scope;
      while (current && !current.bindings.has(node.text)) current = current.parent;
      const bindings = current?.bindings.get(node.text);
      if (!bindings || !current) return blocked("UNRESOLVED_IDENTIFIER");
      if (bindings.length !== 1) return blocked("AMBIGUOUS_BINDING");
      const binding = bindings[0]!;
      if (!binding.constant || binding.destructured || !binding.initializer) return blocked("NON_STATIC_BINDING");
      // Module bindings declared after a function are deliberately not inferred
      // to exist by its eventual invocation; no execution order is simulated.
      if (binding.declaration.end >= before) return blocked("USE_BEFORE_DEFINITION");
      if (unsafeNames.has(binding.name)) return blocked("MUTATION_OR_ESCAPE_REFERENCE");
      return evaluateBinding(binding, current, depth + 1);
    }
    if (ts.isArrayLiteralExpression(node)) {
      const values = node.elements.map((element) => {
        if (ts.isSpreadElement(element) || ts.isOmittedExpression(element)) return blocked("ARRAY_ELEMENT_NOT_INTERPRETED");
        return child(element);
      });
      return composite(values.map((value) => value.json), values, 2 + Math.max(0, values.length - 1));
    }
    if (ts.isObjectLiteralExpression(node)) {
      const value: { [key: string]: StaticEsmJsonValue } = {};
      const children: Value[] = [];
      let overhead = 2;
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) return blocked("OBJECT_PROPERTY_NOT_INTERPRETED");
        if (ts.isShorthandPropertyAssignment(property) && property.objectAssignmentInitializer) return blocked("OBJECT_PROPERTY_NOT_INTERPRETED");
        const keyNode = property.name;
        let key: string;
        if (ts.isComputedPropertyName(keyNode)) key = propertyKey(child(keyNode.expression).json);
        else if (ts.isIdentifier(keyNode) || ts.isStringLiteral(keyNode)) key = keyNode.text;
        else if (ts.isNumericLiteral(keyNode)) key = propertyKey(Number(keyNode.text.replaceAll("_", "")));
        else return blocked("PROPERTY_KEY_NOT_INTERPRETED");
        validateKey(key);
        if (Object.hasOwn(value, key)) return blocked("DUPLICATE_PROPERTY");
        const item = child(ts.isShorthandPropertyAssignment(property) ? property.name : property.initializer);
        Object.defineProperty(value, key, { value: item.json, enumerable: true, writable: true, configurable: true });
        children.push(item);
        overhead += bytes(JSON.stringify(key)) + 1 + (children.length > 1 ? 1 : 0);
      }
      return composite(value, children, overhead);
    }
    if (ts.isPropertyAccessExpression(node) || ts.isElementAccessExpression(node)) {
      if (node.questionDotToken) return blocked("OPTIONAL_ACCESS_NOT_INTERPRETED");
      const object = child(node.expression);
      const key = ts.isPropertyAccessExpression(node) ? node.name.text : propertyKey(child(node.argumentExpression).json);
      validateKey(key);
      if (object.json === null || typeof object.json !== "object" || !Object.hasOwn(object.json, key)) return blocked("OWN_PROPERTY_REQUIRED");
      if (Array.isArray(object.json) && key === "length") return scalar(object.json.length);
      const result = (object.json as { [key: string]: StaticEsmJsonValue })[key];
      if (result === undefined) return blocked("OWN_PROPERTY_REQUIRED");
      return measure(result, () => {
        if (++steps > STATIC_ESM_CONSTANTS_LIMITS.evaluationSteps) fail("EVALUATION_STEP_LIMIT");
      });
    }
    if (ts.isPrefixUnaryExpression(node) && (node.operator === ts.SyntaxKind.PlusToken || node.operator === ts.SyntaxKind.MinusToken)) {
      const operand = child(node.operand).json;
      if (typeof operand !== "number") return blocked("NUMERIC_OPERAND_REQUIRED");
      return scalar(node.operator === ts.SyntaxKind.MinusToken ? -operand : +operand);
    }
    if (ts.isBinaryExpression(node)) {
      const left = child(node.left).json;
      const right = child(node.right).json;
      if (typeof left !== "number" || typeof right !== "number") return blocked("NUMERIC_OPERAND_REQUIRED");
      switch (node.operatorToken.kind) {
        case ts.SyntaxKind.PlusToken: return scalar(left + right);
        case ts.SyntaxKind.MinusToken: return scalar(left - right);
        case ts.SyntaxKind.AsteriskToken: return scalar(left * right);
        case ts.SyntaxKind.SlashToken: return scalar(left / right);
        default: return blocked("OPERATOR_NOT_INTERPRETED");
      }
    }
    return blocked(ts.isFunctionLike(node) ? "FUNCTION_NOT_INTERPRETED" : "EXPRESSION_NOT_INTERPRETED");
  }
  function evaluateBinding(binding: Binding, scope: Scope, depth = 0): Value {
    const cached = cache.get(binding);
    if (cached) return cached;
    if (resolving.has(binding)) return blocked("ALIAS_CYCLE");
    if (!binding.initializer) return blocked("MISSING_INITIALIZER");
    resolving.add(binding);
    try {
      const result = evaluate(binding.initializer, scope, binding.declaration.getStart(file), depth);
      cache.set(binding, result);
      return result;
    } finally { resolving.delete(binding); }
  }

  const result: StaticEsmConstantsResult = {
    profile: "STATIC_ESM_CONSTANTS_V1", proof_scope: "DECLARATION_INITIALIZERS_ONLY",
    runtime_usable: false, vendor_code_executed: false, source_persisted: false, records: []
  };
  let outputBytes = bytes(JSON.stringify(result));
  for (const candidate of candidates) {
    const { binding, scope } = candidate;
    const point = file.getLineAndCharacterOfPosition(binding.declaration.getStart(file));
    const base: RecordBase = { scope: scope.name, name: binding.name, exported: candidate.exported, locator: { line: point.line + 1, column: point.character + 1 } };
    let record: StaticEsmConstantRecord;
    try {
      if (candidate.blocker) blocked(candidate.blocker);
      if (scope.bindings.get(binding.name)?.length !== 1) blocked("AMBIGUOUS_BINDING");
      if (binding.destructured) blocked("DESTRUCTURING_NOT_INTERPRETED");
      if (!binding.constant) blocked("FUNCTION_NOT_INTERPRETED");
      record = { ...base, status: "STATIC_VALUE", value: evaluateBinding(binding, scope).json };
    } catch (error) {
      if (!(error instanceof Blocked)) throw error;
      record = { ...base, status: "BLOCKED", blocker: error.code };
    }
    outputBytes += bytes(JSON.stringify(record)) + (result.records.length > 0 ? 1 : 0);
    if (outputBytes > STATIC_ESM_CONSTANTS_LIMITS.outputBytes) fail("OUTPUT_LIMIT");
    result.records.push(record);
  }
  return result;
}

function lexicalPreflight(source: string): void {
  const scanner = ts.createScanner(ts.ScriptTarget.Latest, true, ts.LanguageVariant.Standard, source);
  let depth = 0;
  let tokens = 0;
  let run = 0;
  for (;;) {
    const token = scanner.scan();
    if (token === ts.SyntaxKind.EndOfFileToken) return;
    if (++tokens > STATIC_ESM_CONSTANTS_LIMITS.astNodes) fail("LEXICAL_TOKEN_LIMIT");
    if (++run > STATIC_ESM_CONSTANTS_LIMITS.lexicalTokenRun) fail("LEXICAL_RUN_LIMIT");
    if (token === ts.SyntaxKind.CommaToken || token === ts.SyntaxKind.SemicolonToken || token === ts.SyntaxKind.OpenBraceToken || token === ts.SyntaxKind.CloseBraceToken) run = 0;
    if (token === ts.SyntaxKind.OpenParenToken || token === ts.SyntaxKind.OpenBracketToken || token === ts.SyntaxKind.OpenBraceToken) {
      if (++depth > STATIC_ESM_CONSTANTS_LIMITS.astDepth) fail("LEXICAL_DEPTH_LIMIT");
    } else if (token === ts.SyntaxKind.CloseParenToken || token === ts.SyntaxKind.CloseBracketToken || token === ts.SyntaxKind.CloseBraceToken) depth = Math.max(0, depth - 1);
  }
}

function boundedNodes(file: ts.SourceFile): ts.Node[] {
  const nodes: ts.Node[] = [];
  const queue: { node: ts.Node; depth: number }[] = [{ node: file, depth: 0 }];
  while (queue.length) {
    const entry = queue.pop()!;
    if (entry.depth > STATIC_ESM_CONSTANTS_LIMITS.astDepth) fail("AST_DEPTH_LIMIT");
    if (nodes.length >= STATIC_ESM_CONSTANTS_LIMITS.astNodes) fail("AST_NODE_LIMIT");
    nodes.push(entry.node);
    ts.forEachChild(entry.node, (node) => { queue.push({ node, depth: entry.depth + 1 }); });
  }
  return nodes;
}

function namesOf(name: ts.BindingName): string[] {
  if (ts.isIdentifier(name)) return [name.text];
  return name.elements.flatMap((element) => ts.isOmittedExpression(element) ? [] : namesOf(element.name));
}

function addBinding(scope: Scope, binding: Binding): void {
  const existing = scope.bindings.get(binding.name) ?? [];
  existing.push(binding);
  scope.bindings.set(binding.name, existing);
}

function addUnsupportedNames(name: ts.BindingName, declaration: ts.Node, scope: Scope): void {
  for (const item of namesOf(name)) addBinding(scope, { name: item, declaration, constant: false, destructured: !ts.isIdentifier(name) });
}

function collectNestedVarBindings(statements: readonly ts.Statement[], scope: Scope): void {
  // var is function/module scoped even in an unselected block. Do not enter
  // nested functions, classes, or namespaces with their own declaration scopes.
  const pending: ts.Node[] = statements.filter((node) => !ts.isVariableStatement(node));
  while (pending.length > 0) {
    const node = pending.pop()!;
    if (ts.isFunctionLike(node) || ts.isClassLike(node) || ts.isModuleDeclaration(node)) continue;
    if (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.BlockScoped)) {
      for (const declaration of node.declarations) addUnsupportedNames(declaration.name, declaration, scope);
      continue;
    }
    ts.forEachChild(node, (child) => { pending.push(child); });
  }
}

function collectStatements(statements: readonly ts.Statement[], scope: Scope, candidates: Candidate[], exportedNames: ReadonlySet<string>): void {
  for (const statement of statements) {
    const exported = scope.name === "module" && ts.canHaveModifiers(statement) && !!ts.getModifiers(statement)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        for (const name of namesOf(declaration.name)) {
          const binding: Binding = {
            name, declaration, constant: !!(statement.declarationList.flags & ts.NodeFlags.Const),
            destructured: !ts.isIdentifier(declaration.name), ...(declaration.initializer ? { initializer: declaration.initializer } : {})
          };
          addBinding(scope, binding);
          if (binding.constant) candidates.push({ binding, scope, exported: exported || exportedNames.has(name) });
        }
      }
    } else if (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement) || ts.isEnumDeclaration(statement)) {
      if (!statement.name) continue;
      const binding: Binding = { name: statement.name.text, declaration: statement, constant: false, destructured: false };
      addBinding(scope, binding);
      if (ts.isFunctionDeclaration(statement) && scope.name === "module") candidates.push({ binding, scope, exported: exported || exportedNames.has(binding.name) });
    } else if (ts.isImportDeclaration(statement) && statement.importClause) {
      if (statement.importClause.name) addUnsupportedNames(statement.importClause.name, statement, scope);
      const bindings = statement.importClause.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) addUnsupportedNames(bindings.name, statement, scope);
      else if (bindings) for (const binding of bindings.elements) addUnsupportedNames(binding.name, statement, scope);
    } else if (ts.isImportEqualsDeclaration(statement)) addUnsupportedNames(statement.name, statement, scope);
  }
}

function isNonReferenceName(node: ts.Identifier): boolean {
  const parent = node.parent;
  return (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isBindingElement(parent) && (parent.name === node || parent.propertyName === node)) ||
    ((ts.isVariableDeclaration(parent) || ts.isParameter(parent) || ts.isFunctionDeclaration(parent) || ts.isClassDeclaration(parent) || ts.isEnumDeclaration(parent)) && parent.name === node) ||
    ts.isImportSpecifier(parent) || ts.isExportSpecifier(parent) || ts.isNamespaceImport(parent) || ts.isImportClause(parent) ||
    ts.isTypeNode(parent) || ts.isLabeledStatement(parent) || ts.isBreakOrContinueStatement(parent);
}

function collectUnsafeNames(nodes: readonly ts.Node[], candidates: ReadonlySet<ts.Node>): Set<string> {
  const unsafe = new Set<string>();
  for (const node of nodes) {
    if (!ts.isIdentifier(node) || isNonReferenceName(node)) continue;
    let current: ts.Node = node;
    for (;;) {
      const parent = current.parent;
      if (!parent) break;
      if (ts.isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind;
        if (operator >= ts.SyntaxKind.FirstAssignment && operator <= ts.SyntaxKind.LastAssignment) { unsafe.add(node.text); break; }
        // These operators consume operands as primitives without exposing them.
        if (operator === ts.SyntaxKind.EqualsEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsEqualsToken) break;
      }
      if ((ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent)) &&
          (parent.operator === ts.SyntaxKind.PlusPlusToken || parent.operator === ts.SyntaxKind.MinusMinusToken)) { unsafe.add(node.text); break; }
      if (ts.isDeleteExpression(parent) || ts.isCallExpression(parent) || ts.isNewExpression(parent) ||
          ts.isTaggedTemplateExpression(parent) || ts.isReturnStatement(parent) || ts.isYieldExpression(parent) ||
          ts.isAwaitExpression(parent) || ts.isSpreadElement(parent) || ts.isSpreadAssignment(parent) || ts.isExportAssignment(parent)) {
        unsafe.add(node.text); break;
      }
      if ((ts.isForInStatement(parent) || ts.isForOfStatement(parent)) && parent.initializer === current) {
        unsafe.add(node.text); break;
      }
      if (ts.isVariableDeclaration(parent) && parent.initializer === current) {
        if (!candidates.has(parent)) unsafe.add(node.text);
        break;
      }
      if (ts.isArrowFunction(parent) && parent.body === current) { unsafe.add(node.text); break; }
      if (ts.isFunctionLike(parent) || ts.isStatement(parent)) break;
      current = parent;
    }
  }
  return unsafe;
}

function scalar(value: null | boolean | number | string): Value {
  if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) return blocked("NUMBER_NOT_JSON_EXACT");
  if (typeof value === "string" && bytes(value) > STATIC_ESM_CONSTANTS_LIMITS.stringBytes) return blocked("STRING_LIMIT");
  return { json: value, bytes: bytes(JSON.stringify(value)), nodes: 1, depth: 0 };
}

function composite(json: StaticEsmJsonValue, children: readonly Value[], overhead: number): Value {
  const value = { json, bytes: overhead, nodes: 1, depth: 0 };
  for (const child of children) {
    value.bytes += child.bytes;
    value.nodes += child.nodes;
    value.depth = Math.max(value.depth, child.depth + 1);
  }
  if (value.bytes > STATIC_ESM_CONSTANTS_LIMITS.valueBytes || value.nodes > STATIC_ESM_CONSTANTS_LIMITS.valueNodes || value.depth > STATIC_ESM_CONSTANTS_LIMITS.evaluationDepth) return blocked("VALUE_LIMIT");
  return value;
}

function measure(json: StaticEsmJsonValue, charge: () => void): Value {
  charge();
  if (json === null || typeof json !== "object") return scalar(json);
  if (Array.isArray(json)) return composite(json, json.map((value) => measure(value, charge)), 2 + Math.max(0, json.length - 1));
  const entries = Object.entries(json);
  return composite(json, entries.map(([, value]) => measure(value, charge)), 2 + Math.max(0, entries.length - 1) + entries.reduce((sum, [key]) => sum + bytes(JSON.stringify(key)) + 1, 0));
}

function propertyKey(value: StaticEsmJsonValue): string {
  if (typeof value !== "string" && (typeof value !== "number" || !Number.isFinite(value))) return blocked("PROPERTY_KEY_NOT_INTERPRETED");
  return String(value);
}

function validateKey(key: string): void {
  if (forbiddenKeys.has(key)) blocked("PROTOTYPE_KEY_FORBIDDEN");
  if (bytes(key) > STATIC_ESM_CONSTANTS_LIMITS.stringBytes) blocked("STRING_LIMIT");
}
