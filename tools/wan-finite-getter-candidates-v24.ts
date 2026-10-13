import ts from "typescript";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { createImmutableJsonSnapshot } from "./settings-ir/immutable-json-snapshot.js";

export const WAN_FINITE_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
export const WAN_FINITE_SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const EXPECTED_APP_SHA = "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf";
const EXPECTED_SETTINGS3_SHA = "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe";
const EXPECTED_WAN_SHA = "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119";
const EXPECTED_WAN_BYTES = 19503;
const MAX_SOURCE_BYTES = 5 * 1024 * 1024;
const JS_MEDIA_TYPES = ["application/javascript", "application/x-javascript", "text/javascript"];
const V24_VERIFIED_SOURCE_OBJECTS = new WeakSet<object>();

export interface WanFiniteGetterCandidateInput {
  readonly model_ids: readonly string[];
  readonly source: string;
  readonly module_name?: string;
  readonly include_controls?: boolean;
}

type Scalar = string | number | boolean | null;
type StaticValue = Scalar | StaticValue[] | { [key: string]: StaticValue };
type EvalResult = { readonly status: "FINITE"; readonly value: StaticValue; readonly producer: "LITERAL" | "LOCAL_GETTER_RETURN" } | { readonly status: "DYNAMIC" | "UNKNOWN" };
type Binding = { readonly name: string; readonly kind: "CONST" | "LET" | "VAR" | "PARAMETER" | "FUNCTION"; readonly scope: ts.Node; readonly node: ts.Node; readonly initializer?: ts.Expression };
type ImportedCallFact = { callee: string; import_binding: { specifier: string; imported_name: string; local_name: string }; argument_kinds: string[]; first_argument_literal: Scalar | null; argument_facts: Array<{ kind: string; path: string[]; literal: Scalar | null; property_names: string[]; import_references: Array<{ specifier: string; imported_name: string; local_name: string }> }> };
type ModuleExportFact = { exported_name: string; local_name: string; binding_kind: Binding["kind"] | "UNRESOLVED"; initializer_kind: string | null; parameters: string[]; candidate_status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[]; static_value_kind: "SCALAR" | "ARRAY" | "OBJECT" | "DYNAMIC" | "UNKNOWN"; object_properties: Array<{ name: string; value_kind: "SCALAR" | "ARRAY" | "OBJECT" | "DYNAMIC" | "UNKNOWN"; scalar_value: Scalar | null; option_status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[] }>; return_facts: Array<{ expression_kind: string; path: string[]; parameter_references: string[]; candidate_status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[]; object_properties: Array<{ name: string; kind: string; scalar_value: Scalar | null }> }>; source_line: number };

export interface WanFiniteGetterCandidateResult {
  readonly runtime_usable: false;
  readonly backend_acceptance: false;
  readonly controls: Array<{
    field: string;
    options: { status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[]; producer: "LOCAL_GETTER_RETURN" | "LITERAL" | "CHILD_RENDER_LIST" | "UNKNOWN" };
    model_options: Array<{ model_id: string; status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[] }>;
    ui_default_candidate: { status: "SOURCE_LITERAL_CANDIDATE" | "UNKNOWN"; value: string | number | boolean | null };
    backend_default: "UNKNOWN";
    model_applicability: Array<{ model_id: string; status: "UNCONDITIONAL_SOURCE" | "SOURCE_GUARD_MATCH" | "SOURCE_GUARD_NO_MATCH" | "UNKNOWN" }>;
    guards: Array<{ model_type: string | null; operator: "===" | "!==" | "UNRESOLVED"; value: Scalar | null; branch: "THEN" | "ELSE" | "CASE"; source_line: number }>;
    source_line: number;
    source_column: number;
  }>;
  readonly render_list_candidates: Array<{ module_name: string; callee: string; first_argument_kind: string; first_argument_path: string[]; first_argument_binding_kind: Binding["kind"] | "IMPORTED_OR_UNBOUND" | null; status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[]; source_line: number; source_column: number }>;
  readonly source_diagnostics: {
    imports_by_module: Array<{ module_name: string; bindings: Array<{ specifier: string; imported_name: string; local_name: string; kind: "NAMED" | "DEFAULT" | "NAMESPACE" }> }>;
    dependency_bindings: Array<{ importer_module: string; specifier: string; imported_name: string; local_name: string; status: "HASH_PINNED_EXPORT_MATCH" | "SOURCE_NAME_NOT_EXPORTED" | "UNRESOLVED_MODULE_NOT_FETCHED" | "UNSUPPORTED_NAMESPACE_BINDING" }>;
    app_export_names: string[];
    module_imported_calls: ImportedCallFact[];
    import_usage_sites: Array<{ specifier: string; imported_name: string; local_name: string; parent_kind: string; parent_property: string | null; use_role: "CALL_CALLEE" | "CALL_ARGUMENT" | "PROPERTY_VALUE" | "OTHER"; enclosing_call: { callee: string; argument_index: number | null } | null; source_line: number; source_column: number }>;
    module_exports: ModuleExportFact[];
    field_producers: Array<{
      field: string;
      options_expression_kind: string | null;
      options_identifiers: string[];
      options_callee: string | null;
      options_binding_status: "LOCAL_CONST_OR_GETTER" | "MUTABLE_BINDING" | "PARAMETER_BINDING" | "IMPORTED_OR_UNBOUND";
      options_binding: { name: string; kind: "CONST" | "LET" | "VAR" | "PARAMETER" | "FUNCTION"; initializer_kind: string | null } | null;
      child_render_list: Array<{ callee: string; first_argument_kind: string; first_argument_binding: { name: string; kind: "CONST" | "LET" | "VAR" | "PARAMETER" | "FUNCTION"; initializer_kind: string | null } | null }>;
      render_call: {
        helper: string;
        helper_import: { specifier: string; imported_name: string; local_name: string } | null;
        props_argument_index: number;
        target: { expression_kind: string; name: string | null; literal: Scalar | null; import_binding: { specifier: string; imported_name: string; local_name: string } | null; lexical_binding: { name: string; kind: "CONST" | "LET" | "VAR" | "PARAMETER" | "FUNCTION"; initializer_kind: string | null; initializer_import_references: Array<{ specifier: string; imported_name: string; local_name: string }>; initializer_imported_calls: ImportedCallFact[] } | null; import_references: Array<{ specifier: string; imported_name: string; local_name: string }>; imported_calls: ImportedCallFact[] } | null;
        child_arguments: Array<{
          argument_index: number;
          expression_kind: string;
          top_level_callee: string | null;
          import_references: Array<{ specifier: string; imported_name: string; local_name: string }>;
          child_calls: ImportedCallFact[];
          render_list_calls: Array<{ callee: string; first_argument_kind: string; first_argument_path: string[]; first_argument_binding_kind: "CONST" | "LET" | "VAR" | "PARAMETER" | "FUNCTION" | "IMPORTED_OR_UNBOUND" | null; first_argument_import: { specifier: string; imported_name: string; local_name: string } | null; option_callback_shape: boolean }>;
        }>;
      } | null;
    }>;
  };
}

export interface WanFiniteSourceReference { readonly module_name: "app.js" | "settings3.js" | "wan-video.js"; readonly url: string; readonly bytes: number | null; readonly sha256: string; }
export interface WanFinitePinnedSource extends WanFiniteSourceReference { readonly bytes: number; readonly text: string; readonly bom_present: boolean; }
export interface WanFiniteSourceArtifact {
  readonly schema_version: "1.0.0";
  readonly catalog_kind: "WAN_FINITE_GETTER_SOURCE_CANDIDATES";
  readonly evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE";
  readonly runtime_usable: false;
  readonly backend_acceptance: false;
  readonly source_persisted: false;
  readonly public_version: string;
  readonly settings_version: string;
  readonly build_id: string;
  readonly model_ids: string[];
  readonly target_fields: string[];
  readonly source_identities: Array<{ module_name: string; url: string; bytes: number; sha256: string; bom_present: boolean }>;
  readonly controls: WanFiniteGetterCandidateResult["controls"];
  readonly render_list_candidates: WanFiniteGetterCandidateResult["render_list_candidates"];
  readonly source_diagnostics: WanFiniteGetterCandidateResult["source_diagnostics"];
  readonly unresolved_imports: Array<{ module_name: string; specifier: string }>;
  readonly limitations: string[];
}

export function analyzeWanFiniteGetterCandidates(input: WanFiniteGetterCandidateInput): WanFiniteGetterCandidateResult {
  const file = ts.createSourceFile("wan-video.js", input.source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] };
  if (file.parseDiagnostics.length > 0) throw new Error("WAN_V24_AST_PARSE_FAILED");
  const bindings = new Map<string, Binding[]>();
  const functions = new Map<string, ts.FunctionLikeDeclaration[]>();
  const isFunction = (node: ts.Node): node is ts.FunctionLikeDeclaration => ts.isFunctionLike(node);
  function scope(node: ts.Node, varScope = false): ts.Node {
    let current: ts.Node | undefined = node;
    while (current) {
      if (ts.isSourceFile(current)) return current;
      if (isFunction(current)) { if (varScope || ts.isBlock(current)) return current; }
      if (!varScope && (ts.isBlock(current) || ts.isCatchClause(current) || ts.isForStatement(current) || ts.isForInStatement(current) || ts.isForOfStatement(current))) return current;
      current = current.parent;
    }
    return file;
  }
  function add(binding: Binding) { bindings.set(binding.name, [...(bindings.get(binding.name) ?? []), binding]); }
  function collect(node: ts.Node): void {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
      const list = node.parent;
      const kind = ts.isVariableDeclarationList(list) ? (list.flags & ts.NodeFlags.Const) ? "CONST" : (list.flags & ts.NodeFlags.Let) ? "LET" : "VAR" : "VAR";
      add({ name: node.name.text, kind, scope: scope(node, kind === "VAR"), node, ...(node.initializer ? { initializer: node.initializer } : {}) });
      if (node.initializer && (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), node.initializer]);
    } else if (ts.isParameter(node) && ts.isIdentifier(node.name)) {
      add({ name: node.name.text, kind: "PARAMETER", scope: scope(node.parent), node });
    } else if (ts.isFunctionDeclaration(node) && node.name) {
      add({ name: node.name.text, kind: "FUNCTION", scope: scope(node.parent), node });
      functions.set(node.name.text, [...(functions.get(node.name.text) ?? []), node]);
    }
    ts.forEachChild(node, collect);
  }
  collect(file);
  const isAncestor = (ancestor: ts.Node, child: ts.Node): boolean => { let current: ts.Node | undefined = child; while (current) { if (current === ancestor) return true; current = current.parent; } return false; };
  const depth = (node: ts.Node): number => { let value = 0; let current: ts.Node | undefined = node; while (current) { value++; current = current.parent; } return value; };
  function lookup(name: string, use: ts.Node): Binding | null {
    const visible = (bindings.get(name) ?? []).filter(item => isAncestor(item.scope, scope(use)));
    if (visible.length === 0) return null;
    const nearestDepth = Math.max(...visible.map(item => depth(item.scope)));
    const nearest = visible.filter(item => depth(item.scope) === nearestDepth);
    return nearest.length === 1 ? nearest[0]! : null;
  }
  const importBindings: WanFiniteGetterCandidateResult["source_diagnostics"]["imports_by_module"][number]["bindings"] = [];
  function collectImportBindings(node: ts.Node): void {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier) && node.importClause) {
      const specifier = node.moduleSpecifier.text;
      if (node.importClause.name) importBindings.push({ specifier, imported_name: "default", local_name: node.importClause.name.text, kind: "DEFAULT" });
      const named = node.importClause.namedBindings;
      if (named && ts.isNamespaceImport(named)) importBindings.push({ specifier, imported_name: "*", local_name: named.name.text, kind: "NAMESPACE" });
      if (named && ts.isNamedImports(named)) for (const item of named.elements) importBindings.push({ specifier, imported_name: item.propertyName?.text ?? item.name.text, local_name: item.name.text, kind: "NAMED" });
    }
    ts.forEachChild(node, collectImportBindings);
  }
  collectImportBindings(file);
  const scalar = (node: ts.Expression): { found: boolean; value?: Scalar } => {
    if (ts.isStringLiteralLike(node)) return { found: true, value: node.text };
    if (ts.isNumericLiteral(node)) return { found: true, value: Number(node.text) };
    if (node.kind === ts.SyntaxKind.NullKeyword) return { found: true, value: null };
    if (node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword) return { found: true, value: node.kind === ts.SyntaxKind.TrueKeyword };
    return { found: false };
  };
  function path(node: ts.Expression): string[] { if (ts.isPropertyAccessExpression(node)) return [...path(node.expression), node.name.text]; if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return [...path(node.expression), node.argumentExpression.text]; if (ts.isIdentifier(node)) return [node.text]; return []; }
  function evaluateCondition(node: ts.Expression, env: ReadonlyMap<string, StaticValue>, active: ReadonlySet<string>, modelOverride?: Scalar): boolean | null {
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(node.operatorToken.kind)) {
      const left = evaluate(node.left, env, active, false, modelOverride); const right = evaluate(node.right, env, active, false, modelOverride);
      if (left.status !== "FINITE" || right.status !== "FINITE" || (typeof left.value === "object" && left.value !== null) || (typeof right.value === "object" && right.value !== null)) return null;
      const equal = left.value === right.value;
      return node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? equal : !equal;
    }
    if (node.kind === ts.SyntaxKind.TrueKeyword) return true;
    if (node.kind === ts.SyntaxKind.FalseKeyword) return false;
    return null;
  }
  function evaluateFunctionBody(fn: ts.FunctionLikeDeclaration, env: ReadonlyMap<string, StaticValue>, active: ReadonlySet<string>, modelOverride?: Scalar): EvalResult {
    if (!fn.body) return { status: "UNKNOWN" };
    if (!ts.isBlock(fn.body)) return evaluate(fn.body, env, active, true, modelOverride);
    function statements(items: readonly ts.Statement[], current: Map<string, StaticValue>): EvalResult {
      for (const statement of items) {
        if (ts.isReturnStatement(statement)) return statement.expression ? evaluate(statement.expression, current, active, true, modelOverride) : { status: "UNKNOWN" };
        if (ts.isVariableStatement(statement)) {
          for (const declaration of statement.declarationList.declarations) {
            if (!ts.isIdentifier(declaration.name) || !declaration.initializer || (statement.declarationList.flags & ts.NodeFlags.Const) === 0) return { status: "UNKNOWN" };
            const value = evaluate(declaration.initializer, current, active, true, modelOverride);
            if (value.status !== "FINITE") return value;
            current.set(declaration.name.text, value.value);
          }
          continue;
        }
        if (ts.isIfStatement(statement)) {
          const condition = evaluateCondition(statement.expression, current, active, modelOverride);
          if (condition === null) return { status: "UNKNOWN" };
          const selected = condition ? statement.thenStatement : statement.elseStatement;
          if (!selected) continue;
          const result = ts.isBlock(selected) ? statements(selected.statements, new Map(current)) : statements([selected], new Map(current));
          if (result.status === "FINITE") return result;
          if (result.status === "DYNAMIC") return result;
          continue;
        }
        return { status: "UNKNOWN" };
      }
      return { status: "UNKNOWN" };
    }
    return statements(fn.body.statements, new Map(env));
  }
  function evaluate(node: ts.Expression, env: ReadonlyMap<string, StaticValue>, active: ReadonlySet<string>, viaGetter = false, modelOverride?: Scalar): EvalResult {
    const primitive = scalar(node);
    if (primitive.found) return { status: "FINITE", value: primitive.value!, producer: viaGetter ? "LOCAL_GETTER_RETURN" : "LITERAL" };
    if (modelOverride !== undefined && path(node).at(-1) === "model_type") return { status: "FINITE", value: modelOverride, producer: "LITERAL" };
    if (ts.isArrayLiteralExpression(node)) {
      const values: StaticValue[] = [];
      for (const element of node.elements) {
        if (ts.isSpreadElement(element)) return { status: "UNKNOWN" };
        const result = evaluate(element as ts.Expression, env, active, viaGetter, modelOverride);
        if (result.status !== "FINITE") return result;
        values.push(result.value);
      }
      return { status: "FINITE", value: values, producer: viaGetter ? "LOCAL_GETTER_RETURN" : "LITERAL" };
    }
    if (ts.isObjectLiteralExpression(node)) {
      const value: Record<string, StaticValue> = {};
      for (const property of node.properties) {
        if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) return { status: "UNKNOWN" };
        const result = evaluate(property.initializer, env, active, viaGetter, modelOverride);
        if (result.status !== "FINITE") return result;
        value[property.name.text] = result.value;
      }
      return { status: "FINITE", value, producer: viaGetter ? "LOCAL_GETTER_RETURN" : "LITERAL" };
    }
    if (ts.isIdentifier(node)) {
      if (env.has(node.text)) return { status: "FINITE", value: env.get(node.text)!, producer: "LOCAL_GETTER_RETURN" };
      const binding = lookup(node.text, node);
      if (!binding || binding.kind !== "CONST" || !binding.initializer || active.has(node.text)) return { status: "UNKNOWN" };
      return evaluate(binding.initializer, env, new Set([...active, node.text]), viaGetter);
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const binding = lookup(node.expression.text, node.expression);
      const candidates = functions.get(node.expression.text) ?? [];
      if (!binding || (binding.kind !== "FUNCTION" && binding.kind !== "CONST") || candidates.length !== 1 || active.has(node.expression.text) || node.arguments.some(ts.isSpreadElement)) return { status: "UNKNOWN" };
      const fn = candidates[0]!;
      if (fn.parameters.length !== node.arguments.length) return { status: "UNKNOWN" };
      const nextEnv = new Map(env);
      for (const [index, parameter] of fn.parameters.entries()) {
        if (!ts.isIdentifier(parameter.name)) return { status: "UNKNOWN" };
        const argumentExpression = node.arguments[index]!;
        const argument = modelOverride !== undefined && index === 0 && path(argumentExpression).at(-1) === "model_type"
          ? { status: "FINITE" as const, value: modelOverride, producer: "LITERAL" as const }
          : evaluate(argumentExpression, env, active, viaGetter, modelOverride);
        if (argument.status !== "FINITE") return argument;
        nextEnv.set(parameter.name.text, argument.value);
      }
      return evaluateFunctionBody(fn, nextEnv, new Set([...active, node.expression.text]), modelOverride);
    }
    return { status: "DYNAMIC" };
  }
  function fieldFor(node: ts.Expression): string | null { const parts = path(node); return parts.length >= 2 && parts.at(-2) === "settings" ? parts.at(-1)! : null; }
  function optionValues(result: EvalResult, childRenderList = false): { status: "FINITE_SOURCE_CANDIDATE" | "DYNAMIC" | "UNKNOWN"; values: Scalar[]; producer: "LOCAL_GETTER_RETURN" | "LITERAL" | "CHILD_RENDER_LIST" | "UNKNOWN" } {
    if (result.status !== "FINITE") return { status: result.status, values: [], producer: "UNKNOWN" };
    if (!Array.isArray(result.value)) return { status: "UNKNOWN", values: [], producer: "UNKNOWN" };
    const values: Scalar[] = [];
    for (const item of result.value) {
      if (item === null || typeof item === "string" || typeof item === "number" || typeof item === "boolean") values.push(item);
      else if (!Array.isArray(item) && typeof item === "object" && "value" in item) {
        const itemValue = item.value;
        if (itemValue === null || typeof itemValue === "string" || typeof itemValue === "number" || typeof itemValue === "boolean") values.push(itemValue);
        else return { status: "UNKNOWN", values: [], producer: "UNKNOWN" };
      } else return { status: "UNKNOWN", values: [], producer: "UNKNOWN" };
    }
    return { status: "FINITE_SOURCE_CANDIDATE", values, producer: childRenderList ? "CHILD_RENDER_LIST" : result.producer };
  }
  function renderListCalls(root: ts.Node): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    const renderListBindings = new Set<string>(["renderList"]);
    function collectImports(node: ts.Node): void {
      if (ts.isImportDeclaration(node) && node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings)) {
        for (const specifier of node.importClause.namedBindings.elements) if ((specifier.propertyName?.text ?? specifier.name.text) === "renderList") renderListBindings.add(specifier.name.text);
      }
      ts.forEachChild(node, collectImports);
    }
    collectImports(file);
    function walk(node: ts.Node): void {
      if (node !== root && isFunction(node)) return;
      if (ts.isCallExpression(node) && ((ts.isIdentifier(node.expression) && renderListBindings.has(node.expression.text)) || (ts.isPropertyAccessExpression(node.expression) && node.expression.name.text === "renderList"))) found.push(node);
      ts.forEachChild(node, walk);
    }
    walk(root);
    return found;
  }
  function expressionName(node: ts.Expression): string {
    return ts.isIdentifier(node) ? node.text : ts.isPropertyAccessExpression(node) ? node.name.text : ts.SyntaxKind[node.kind] ?? "UNKNOWN";
  }
  function importFact(localName: string): { specifier: string; imported_name: string; local_name: string } | null {
    const found = importBindings.find(binding => binding.local_name === localName);
    return found ? { specifier: found.specifier, imported_name: found.imported_name, local_name: found.local_name } : null;
  }
  function importReferences(root: ts.Node): Array<{ specifier: string; imported_name: string; local_name: string }> {
    const locals = new Set<string>();
    function walk(node: ts.Node): void {
      if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node) && importFact(node.text)) locals.add(node.text);
      ts.forEachChild(node, walk);
    }
    walk(root);
    return [...locals].sort().map(name => importFact(name)!);
  }
  function importedCalls(root: ts.Node): ImportedCallFact[] {
    const found: ImportedCallFact[] = [];
    function walk(node: ts.Node): void {
      if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
        const binding = importFact(node.expression.text);
        if (binding) {
          const first = node.arguments[0];
          const firstScalar = first ? scalar(first) : { found: false };
          found.push({
            callee: node.expression.text,
            import_binding: binding,
            argument_kinds: node.arguments.map(argument => ts.SyntaxKind[argument.kind] ?? "UNKNOWN"),
            first_argument_literal: firstScalar.found ? firstScalar.value! : null,
            argument_facts: node.arguments.map(argument => {
              const value = scalar(argument);
              const propertyNames = ts.isObjectLiteralExpression(argument)
                ? argument.properties.map(property => ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property) ? (ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name) ? property.name.text : null) : null).filter((name): name is string => name !== null)
                : [];
              return { kind: ts.SyntaxKind[argument.kind] ?? "UNKNOWN", path: path(argument), literal: value.found ? value.value! : null, property_names: propertyNames, import_references: importReferences(argument) };
            })
          });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(root);
    return found;
  }
  function callTargetFact(call: ts.CallExpression): { expression_kind: string; name: string | null; literal: Scalar | null; import_binding: { specifier: string; imported_name: string; local_name: string } | null; lexical_binding: { name: string; kind: Binding["kind"]; initializer_kind: string | null; initializer_import_references: Array<{ specifier: string; imported_name: string; local_name: string }>; initializer_imported_calls: ImportedCallFact[] } | null; import_references: Array<{ specifier: string; imported_name: string; local_name: string }>; imported_calls: ImportedCallFact[] } | null {
    const target = call.arguments[0];
    if (!target) return null;
    const value = scalar(target);
    const name = ts.isIdentifier(target) || ts.isPropertyAccessExpression(target) ? expressionName(target) : null;
    const binding = ts.isIdentifier(target) ? lookup(target.text, target) : null;
    return {
      expression_kind: ts.SyntaxKind[target.kind] ?? "UNKNOWN",
      name,
      literal: value.found ? value.value! : null,
      import_binding: ts.isIdentifier(target) ? importFact(target.text) : null,
      lexical_binding: binding ? {
        name: binding.name,
        kind: binding.kind,
        initializer_kind: binding.initializer ? ts.SyntaxKind[binding.initializer.kind] ?? "UNKNOWN" : null,
        initializer_import_references: binding.initializer ? importReferences(binding.initializer) : [],
        initializer_imported_calls: binding.initializer ? importedCalls(binding.initializer) : []
      } : null,
      import_references: importReferences(target),
      imported_calls: importedCalls(target)
    };
  }
  function importUsageSites(root: ts.Node): WanFiniteGetterCandidateResult["source_diagnostics"]["import_usage_sites"] {
    const sites: WanFiniteGetterCandidateResult["source_diagnostics"]["import_usage_sites"] = [];
    function walk(node: ts.Node): void {
      if (ts.isIdentifier(node) && !(ts.isPropertyAccessExpression(node.parent) && node.parent.name === node)) {
        const binding = importFact(node.text);
        if (binding && !ts.isImportSpecifier(node.parent) && !ts.isImportClause(node.parent)) {
          let enclosingCall: ts.CallExpression | null = null;
          for (let current: ts.Node | undefined = node.parent; current; current = current.parent) {
            if (ts.isCallExpression(current)) { enclosingCall = current; break; }
          }
          const argumentIndex = enclosingCall?.arguments.findIndex(argument => argument === node || isAncestor(node, argument)) ?? -1;
          const parentProperty = ts.isPropertyAssignment(node.parent) && (ts.isIdentifier(node.parent.name) || ts.isStringLiteralLike(node.parent.name)) ? node.parent.name.text
            : ts.isShorthandPropertyAssignment(node.parent) ? node.parent.name.text
            : null;
          const useRole = enclosingCall && node.parent === enclosingCall.expression ? "CALL_CALLEE" as const
            : enclosingCall && argumentIndex >= 0 ? "CALL_ARGUMENT" as const
            : parentProperty !== null ? "PROPERTY_VALUE" as const
            : "OTHER" as const;
          const location = file.getLineAndCharacterOfPosition(node.getStart(file));
          sites.push({ specifier: binding.specifier, imported_name: binding.imported_name, local_name: binding.local_name, parent_kind: ts.SyntaxKind[node.parent.kind] ?? "UNKNOWN", parent_property: parentProperty, use_role: useRole, enclosing_call: enclosingCall ? { callee: expressionName(enclosingCall.expression), argument_index: argumentIndex >= 0 ? argumentIndex : null } : null, source_line: location.line + 1, source_column: location.character + 1 });
        }
      }
      ts.forEachChild(node, walk);
    }
    walk(root);
    return sites;
  }
  function moduleExports(root: ts.SourceFile): ModuleExportFact[] {
    const exportedBindings = new Map<string, string>();
    const hasExportModifier = (node: ts.Node): boolean => ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false);
    for (const statement of root.statements) {
      if (ts.isVariableStatement(statement) && hasExportModifier(statement)) {
        for (const declaration of statement.declarationList.declarations) if (ts.isIdentifier(declaration.name)) exportedBindings.set(declaration.name.text, declaration.name.text);
      } else if (ts.isFunctionDeclaration(statement) && hasExportModifier(statement) && statement.name) exportedBindings.set(statement.name.text, statement.name.text);
      else if (ts.isExportDeclaration(statement) && statement.exportClause && ts.isNamedExports(statement.exportClause)) {
        for (const specifier of statement.exportClause.elements) exportedBindings.set(specifier.name.text, specifier.propertyName?.text ?? specifier.name.text);
      } else if (ts.isExportAssignment(statement)) exportedBindings.set("default", "default");
    }
    return [...exportedBindings.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([exportedName, localName]) => {
      const binding = localName === "default" ? null : lookup(localName, root);
      const initializer = binding?.initializer;
      const fn = (functions.get(localName) ?? []).length === 1 ? functions.get(localName)![0]! : null;
      const parameters = fn?.parameters.map(parameter => ts.isIdentifier(parameter.name) ? parameter.name.text : "<pattern>") ?? [];
      const evaluated = fn
        ? fn.parameters.length === 0 ? evaluateFunctionBody(fn, new Map(), new Set()) : { status: "DYNAMIC" as const }
        : initializer ? evaluate(initializer, new Map(), new Set()) : { status: "UNKNOWN" as const };
      const candidate = optionValues(evaluated);
      const evaluatedKind = evaluated.status === "FINITE"
        ? Array.isArray(evaluated.value) ? "ARRAY" as const
          : evaluated.value !== null && typeof evaluated.value === "object" ? "OBJECT" as const
          : "SCALAR" as const
        : evaluated.status;
      const objectProperties = initializer && ts.isObjectLiteralExpression(initializer)
        ? initializer.properties.flatMap(property => {
            if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) return [];
            const value = evaluate(property.initializer, new Map(), new Set());
            const valueKind = value.status === "FINITE"
              ? Array.isArray(value.value) ? "ARRAY" as const
                : value.value !== null && typeof value.value === "object" ? "OBJECT" as const
                : "SCALAR" as const
              : value.status;
            const option = optionValues(value);
            const scalarValue = value.status === "FINITE" && (value.value === null || ["string", "number", "boolean"].includes(typeof value.value)) ? value.value as Scalar : null;
            return [{ name: property.name.text, value_kind: valueKind, scalar_value: scalarValue, option_status: option.status, values: option.values }];
          })
        : [];
      const returnExpressions: ts.Expression[] = [];
      if (fn?.body && !ts.isBlock(fn.body)) returnExpressions.push(fn.body);
      else if (fn?.body && ts.isBlock(fn.body)) {
        const functionNode = fn;
        function collectReturns(node: ts.Node): void {
          if (node !== functionNode.body && isFunction(node)) return;
          if (ts.isReturnStatement(node) && node.expression) { returnExpressions.push(node.expression); return; }
          ts.forEachChild(node, collectReturns);
        }
        collectReturns(fn.body);
      }
      const returnFacts = returnExpressions.map(expression => {
        const value = evaluate(expression, new Map(), new Set());
        const option = optionValues(value);
        const objectProperties = ts.isObjectLiteralExpression(expression)
          ? expression.properties.flatMap(property => {
              if (!ts.isPropertyAssignment(property) || !(ts.isIdentifier(property.name) || ts.isStringLiteralLike(property.name))) return [];
              const propertyValue = evaluate(property.initializer, new Map(), new Set());
              const scalarValue = propertyValue.status === "FINITE" && (propertyValue.value === null || ["string", "number", "boolean"].includes(typeof propertyValue.value)) ? propertyValue.value as Scalar : null;
              return [{ name: property.name.text, kind: ts.SyntaxKind[property.initializer.kind] ?? "UNKNOWN", scalar_value: scalarValue }];
            })
          : [];
        const identifiers = new Set<string>();
        function collectParameterRefs(node: ts.Node): void { if (ts.isIdentifier(node) && parameters.includes(node.text)) identifiers.add(node.text); ts.forEachChild(node, collectParameterRefs); }
        collectParameterRefs(expression);
        return { expression_kind: ts.SyntaxKind[expression.kind] ?? "UNKNOWN", path: path(expression), parameter_references: [...identifiers].sort(), candidate_status: option.status, values: option.values, object_properties: objectProperties };
      });
      const location = file.getLineAndCharacterOfPosition(binding?.node.getStart(file) ?? root.getStart(file));
      return {
        exported_name: exportedName,
        local_name: localName,
        binding_kind: binding?.kind ?? "UNRESOLVED",
        initializer_kind: initializer ? ts.SyntaxKind[initializer.kind] ?? "UNKNOWN" : fn ? ts.SyntaxKind[fn.kind] ?? "UNKNOWN" : null,
        parameters,
        candidate_status: candidate.status,
        values: candidate.values,
        static_value_kind: evaluatedKind,
        object_properties: objectProperties,
        return_facts: returnFacts,
        source_line: location.line + 1
      };
    });
  }
  function renderCallForProps(props: ts.ObjectLiteralExpression): ts.CallExpression | null {
    for (let current: ts.Node | undefined = props.parent; current; current = current.parent) {
      if (ts.isCallExpression(current) && current.arguments.includes(props)) return current;
    }
    return null;
  }
  function callbackBuildsOption(callback: ts.Expression): boolean {
    if (!ts.isArrowFunction(callback) && !ts.isFunctionExpression(callback)) return false;
    let matched = false;
    function walk(node: ts.Node): void {
      if (matched || (node !== callback && isFunction(node))) return;
      if (ts.isCallExpression(node) && node.arguments.some(argument => ts.isStringLiteralLike(argument) && ["option", "el-option"].includes(argument.text))) {
        matched = true;
        return;
      }
      if (ts.isCallExpression(node) && node.arguments.some(argument => ts.isObjectLiteralExpression(argument) && argument.properties.some(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && ts.isIdentifier(property.name) && property.name.text === "value"))) {
        matched = true;
        return;
      }
      ts.forEachChild(node, walk);
    }
    walk(callback.body);
    return matched;
  }
  function structuralRenderListCalls(root: ts.Node): ts.CallExpression[] {
    const found: ts.CallExpression[] = [];
    function walk(node: ts.Node): void {
      if (ts.isCallExpression(node) && node.arguments.length >= 2 &&
          node.arguments.some((argument, index) => index > 0 && callbackBuildsOption(argument))) found.push(node);
      ts.forEachChild(node, walk);
    }
    walk(root);
    return found;
  }
  function renderListFact(call: ts.CallExpression) {
    const firstArgument = call.arguments[0];
    const binding = firstArgument && ts.isIdentifier(firstArgument) ? lookup(firstArgument.text, firstArgument) : null;
    return {
      callee: expressionName(call.expression),
      first_argument_kind: firstArgument ? ts.SyntaxKind[firstArgument.kind] ?? "UNKNOWN" : "NONE",
      first_argument_path: firstArgument ? path(firstArgument) : [],
      first_argument_binding_kind: binding?.kind ?? (firstArgument && ts.isIdentifier(firstArgument) && importBindings.some(item => item.local_name === firstArgument.text) ? "IMPORTED_OR_UNBOUND" as const : null),
      first_argument_import: firstArgument && ts.isIdentifier(firstArgument) ? importFact(firstArgument.text) : null,
      option_callback_shape: call.arguments.slice(1).some(callbackBuildsOption)
    };
  }
  const globalRenderCalls = [...new Set([...renderListCalls(file), ...structuralRenderListCalls(file)])];
  const renderListCandidates = globalRenderCalls.map(call => {
    const result = optionValues(call.arguments[0] ? evaluate(call.arguments[0], new Map(), new Set()) : { status: "UNKNOWN" }, true);
    const location = file.getLineAndCharacterOfPosition(call.getStart(file));
    const firstArgument = call.arguments[0];
    const firstArgumentPath = firstArgument ? path(firstArgument) : [];
    const rootBinding = firstArgumentPath[0] ? lookup(firstArgumentPath[0], firstArgument!) : null;
    const rootImported = firstArgumentPath[0] ? importFact(firstArgumentPath[0]) : null;
    return { module_name: input.module_name ?? "wan-video.js", callee: expressionName(call.expression), first_argument_kind: firstArgument ? ts.SyntaxKind[firstArgument.kind] ?? "UNKNOWN" : "NONE", first_argument_path: firstArgumentPath, first_argument_binding_kind: rootBinding?.kind ?? (rootImported ? "IMPORTED_OR_UNBOUND" as const : null), status: result.status, values: result.values, source_line: location.line + 1, source_column: location.character + 1 };
  });
  const controls: WanFiniteGetterCandidateResult["controls"] = [];
  const fieldProducers: WanFiniteGetterCandidateResult["source_diagnostics"]["field_producers"] = [];
  function bindingFact(expression: ts.Expression | null) {
    let name: string | null = null;
    if (expression && ts.isIdentifier(expression)) name = expression.text;
    else if (expression && ts.isCallExpression(expression) && ts.isIdentifier(expression.expression)) name = expression.expression.text;
    const binding = name === null || expression === null ? null : lookup(name, expression);
    return {
      status: !binding ? "IMPORTED_OR_UNBOUND" as const : binding.kind === "PARAMETER" ? "PARAMETER_BINDING" as const : binding.kind === "LET" || binding.kind === "VAR" ? "MUTABLE_BINDING" as const : "LOCAL_CONST_OR_GETTER" as const,
      value: binding ? { name: binding.name, kind: binding.kind, initializer_kind: binding.initializer ? ts.SyntaxKind[binding.initializer.kind] ?? "UNKNOWN" : null } : null
    };
  }
  type Guard = WanFiniteGetterCandidateResult["controls"][number]["guards"][number];
  function modelGuard(expression: ts.Expression, branch: Guard["branch"], invert = false): Guard {
    if (!ts.isBinaryExpression(expression) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expression.operatorToken.kind)) return { model_type: null, operator: "UNRESOLVED", value: null, branch, source_line: file.getLineAndCharacterOfPosition(expression.getStart(file)).line + 1 };
    const left = path(expression.left); const right = scalar(expression.right); const rightPath = path(expression.right); const leftValue = scalar(expression.left);
    const modelTypeSide = left.at(-1) === "model_type" ? left : rightPath.at(-1) === "model_type" ? rightPath : null;
    const val = right.found ? right.value! : leftValue.found ? leftValue.value! : null;
    let op: Guard["operator"] = expression.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? "===" : "!==";
    if (invert) op = op === "===" ? "!==" : "===";
    return { model_type: modelTypeSide ? "model_type" : null, operator: op, value: val, branch, source_line: file.getLineAndCharacterOfPosition(expression.getStart(file)).line + 1 };
  }
  function modelStatus(guards: readonly Guard[], modelId: string): "UNCONDITIONAL_SOURCE" | "SOURCE_GUARD_MATCH" | "SOURCE_GUARD_NO_MATCH" | "UNKNOWN" {
    if (guards.length === 0) return "UNCONDITIONAL_SOURCE";
    if (guards.some(guard => guard.model_type !== "model_type" || guard.operator === "UNRESOLVED" || typeof guard.value !== "string")) return "UNKNOWN";
    if (guards.some(guard => (guard.operator === "===" && guard.value !== modelId) || (guard.operator === "!==" && guard.value === modelId))) return "SOURCE_GUARD_NO_MATCH";
    return "SOURCE_GUARD_MATCH";
  }
  function visit(node: ts.Node, guards: Guard[] = []): void {
    if (ts.isIfStatement(node)) {
      visit(node.thenStatement, [...guards, modelGuard(node.expression, "THEN")]);
      if (node.elseStatement) visit(node.elseStatement, [...guards, modelGuard(node.expression, "ELSE", true)]);
      return;
    }
    if (ts.isSwitchStatement(node)) {
      for (const clause of node.caseBlock.clauses) {
        const value = ts.isCaseClause(clause) ? scalar(clause.expression) : { found: false };
        const modelType = path(node.expression).at(-1) === "model_type" ? "model_type" : null;
        const line = file.getLineAndCharacterOfPosition(clause.getStart(file)).line + 1;
        const guard: Guard = { model_type: modelType, operator: value.found ? "===" : "UNRESOLVED", value: value.found ? value.value! : null, branch: "CASE", source_line: line };
        for (const statement of clause.statements) visit(statement, [...guards, guard]);
      }
      return;
    }
    if (ts.isConditionalExpression(node)) {
      visit(node.whenTrue, [...guards, modelGuard(node.condition, "THEN")]);
      visit(node.whenFalse, [...guards, modelGuard(node.condition, "ELSE", true)]);
      return;
    }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      visit(node.left, guards);
      const line = file.getLineAndCharacterOfPosition(node.operatorToken.getStart(file)).line + 1;
      visit(node.right, [...guards, { model_type: null, operator: "UNRESOLVED", value: null, branch: "THEN", source_line: line }]);
      return;
    }
    if (input.include_controls !== false && ts.isPropertyAssignment(node) && ts.isIdentifier(node.name) && node.name.text === "modelValue" && ts.isObjectLiteralExpression(node.parent)) {
      const field = fieldFor(node.initializer);
      if (field) {
        const childCalls = renderListCalls(node.parent).map(call => {
          const argument = call.arguments[0];
          const binding = argument && ts.isIdentifier(argument) ? lookup(argument.text, argument) : null;
          return { callee: expressionName(call.expression), first_argument_kind: argument ? ts.SyntaxKind[argument.kind] ?? "UNKNOWN" : "NONE", first_argument_binding: binding ? { name: binding.name, kind: binding.kind, initializer_kind: binding.initializer ? ts.SyntaxKind[binding.initializer.kind] ?? "UNKNOWN" : null } : null };
        });
        const optionsProp = node.parent.properties.find(property => (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) && ts.isIdentifier(property.name) && ["options", "items", "values", "list"].includes(property.name.text));
        const defaultProp = node.parent.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && ts.isIdentifier(property.name) && ["defaultValue", "default_value"].includes(property.name.text));
        let optionsExpression: ts.Expression | null = null;
        if (optionsProp && ts.isPropertyAssignment(optionsProp)) optionsExpression = optionsProp.initializer;
        else if (optionsProp && ts.isShorthandPropertyAssignment(optionsProp)) optionsExpression = optionsProp.name;
        const binding = bindingFact(optionsExpression);
        const identifiers: string[] = [];
        if (optionsExpression) {
          function collectIdentifierNames(child: ts.Node) {
            if (ts.isIdentifier(child) && !(ts.isPropertyAccessExpression(child.parent) && child.parent.name === child)) identifiers.push(child.text);
            ts.forEachChild(child, collectIdentifierNames);
          }
          collectIdentifierNames(optionsExpression);
        }
        const optionsCallee = optionsExpression && ts.isCallExpression(optionsExpression)
          ? ts.isIdentifier(optionsExpression.expression) ? optionsExpression.expression.text : ts.isPropertyAccessExpression(optionsExpression.expression) ? optionsExpression.expression.name.text : null
          : null;
        const renderCall = renderCallForProps(node.parent);
        const propsArgumentIndex = renderCall?.arguments.findIndex(argument => argument === node.parent) ?? -1;
        const childArguments = renderCall && propsArgumentIndex >= 0
          ? renderCall.arguments.slice(propsArgumentIndex + 1).map((argument, offset) => ({
              argument_index: propsArgumentIndex + offset + 1,
              expression_kind: ts.SyntaxKind[argument.kind] ?? "UNKNOWN",
              top_level_callee: ts.isCallExpression(argument) ? expressionName(argument.expression) : null,
              import_references: importReferences(argument),
              child_calls: importedCalls(argument),
              render_list_calls: structuralRenderListCalls(argument).map(renderListFact)
            }))
          : [];
        const childCandidates = renderCall && propsArgumentIndex >= 0
          ? renderCall.arguments.slice(propsArgumentIndex + 1).flatMap(argument => structuralRenderListCalls(argument))
          : [];
        const propRenderCalls = renderListCalls(node.parent);
        fieldProducers.push({
          field,
          options_expression_kind: optionsExpression ? ts.SyntaxKind[optionsExpression.kind] ?? "UNKNOWN" : null,
          options_identifiers: [...new Set(identifiers)].sort(),
          options_callee: optionsCallee,
          options_binding_status: binding.status,
          options_binding: binding.value,
          child_render_list: childCalls,
          render_call: renderCall && propsArgumentIndex >= 0 ? {
            helper: expressionName(renderCall.expression),
            helper_import: importBindings.find(item => item.local_name === expressionName(renderCall.expression))
              ? { specifier: importBindings.find(item => item.local_name === expressionName(renderCall.expression))!.specifier, imported_name: importBindings.find(item => item.local_name === expressionName(renderCall.expression))!.imported_name, local_name: expressionName(renderCall.expression) }
              : null,
            props_argument_index: propsArgumentIndex,
            target: callTargetFact(renderCall),
            child_arguments: childArguments
          } : null
        });
        const optionProducers = [...propRenderCalls, ...childCandidates];
        const childOptions = optionProducers.length === 1 && optionProducers[0]!.arguments[0]
          ? evaluate(optionProducers[0]!.arguments[0]!, new Map(), new Set())
          : null;
        const optionsResult = optionsExpression ? evaluate(optionsExpression, new Map(), new Set()) : childOptions ?? { status: "DYNAMIC" } as const;
        const options = optionValues(optionsResult, optionsExpression === null && childOptions !== null);
        const modelUsesGetterArg = optionsExpression !== null && ts.isCallExpression(optionsExpression) && optionsExpression.arguments.some(argument => path(argument).at(-1) === "model_type");
        const modelOptions = input.model_ids.map(model_id => {
          const candidate = modelUsesGetterArg && optionsExpression !== null ? evaluate(optionsExpression, new Map(), new Set(), false, model_id) : optionsResult;
          const result = optionValues(candidate);
          return { model_id, status: result.status, values: result.values };
        });
        const defaultEval = defaultProp ? evaluate(defaultProp.initializer, new Map(), new Set()) : { status: "UNKNOWN" } as const;
        const defaultValue = defaultEval.status === "FINITE" && (defaultEval.value === null || ["string", "number", "boolean"].includes(typeof defaultEval.value)) ? { status: "SOURCE_LITERAL_CANDIDATE" as const, value: defaultEval.value as Scalar } : { status: "UNKNOWN" as const, value: null };
        const location = file.getLineAndCharacterOfPosition(node.getStart(file));
        controls.push({ field, options, model_options: modelOptions, ui_default_candidate: defaultValue, backend_default: "UNKNOWN", model_applicability: input.model_ids.map(model_id => ({ model_id, status: modelStatus(guards, model_id) })), guards: guards.map(guard => ({ ...guard })), source_line: location.line + 1, source_column: location.character + 1 });
      }
    }
    ts.forEachChild(node, child => visit(child, guards));
  }
  visit(file);
  return { runtime_usable: false, backend_acceptance: false, controls, render_list_candidates: renderListCandidates, source_diagnostics: { imports_by_module: [{ module_name: input.module_name ?? "wan-video.js", bindings: importBindings }], dependency_bindings: [], app_export_names: [], module_imported_calls: importedCalls(file), import_usage_sites: importUsageSites(file), module_exports: moduleExports(file), field_producers: fieldProducers } };
}

const EXPECTED_WAN_MODEL_IDS = ["wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash", "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v", "wan_27_t2v", "wan_27_videoedit"];

export function buildWanFiniteSourceReferences(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string): WanFiniteSourceReference[] {
  if (publicVersion !== WAN_FINITE_PUBLIC_VERSION || settingsVersion !== WAN_FINITE_SETTINGS_VERSION || inventory.public_catalog.version !== publicVersion || inventory.build.id !== "1791467421" || inventory.app_sha256 !== EXPECTED_APP_SHA) throw new Error("WAN_V24_SOURCE_BINDING_INVALID");
  const form = inventory.forms.find(candidate => candidate.form_id === "wan-video");
  const refs: WanFiniteSourceReference[] = [
    { module_name: "app.js", url: `${inventory.build.base_url}app.js`, bytes: null, sha256: inventory.app_sha256 },
    { module_name: "settings3.js", url: inventory.framework.settings3.url, bytes: inventory.framework.settings3.bytes, sha256: inventory.framework.settings3.sha256 },
    { module_name: "wan-video.js", url: form?.javascript.url ?? "", bytes: form?.javascript.bytes ?? -1, sha256: form?.javascript.sha256 ?? "" }
  ];
  if (refs[1]!.bytes !== 4123 || refs[1]!.sha256 !== EXPECTED_SETTINGS3_SHA || refs[2]!.bytes !== EXPECTED_WAN_BYTES || refs[2]!.sha256 !== EXPECTED_WAN_SHA) throw new Error("WAN_V24_SOURCE_BINDING_INVALID");
  return refs;
}

export async function fetchWanFinitePinnedSources(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, fetchImpl: typeof fetch = fetch): Promise<WanFinitePinnedSource[]> {
  const refs = buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  const sources: WanFinitePinnedSource[] = [];
  for (const ref of refs) sources.push(await fetchWanFiniteSource(ref, fetchImpl));
  return sources;
}

export async function fetchWanFinitePinnedFormSource(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, fetchImpl: typeof fetch = fetch): Promise<WanFinitePinnedSource> {
  const ref = buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion).find(source => source.module_name === "wan-video.js");
  if (!ref) throw new Error("WAN_V24_FORM_SOURCE_NOT_PINNED");
  return fetchWanFiniteSource(ref, fetchImpl);
}

export async function fetchWanFiniteDirectAspectRatioHelper(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, formSource: WanFinitePinnedSource, fetchImpl: typeof fetch = fetch): Promise<{ module_name: "AspectRatio.js"; url: string; bytes: number; sha256: string; bom_present: boolean; text: string }> {
  const refs = buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  const formRef = refs.find(source => source.module_name === "wan-video.js");
  if (!formRef || formSource.module_name !== formRef.module_name || formSource.url !== formRef.url || formSource.bytes !== formRef.bytes || formSource.sha256 !== formRef.sha256 || wanFiniteSourceSha256(Buffer.from(formSource.text, "utf8")) !== formRef.sha256 || Buffer.byteLength(formSource.text, "utf8") !== formRef.bytes) throw new Error("WAN_V24_HELPER_PARENT_SOURCE_UNVERIFIED");
  const modelIds = inventory.models.filter(model => model.form_id === "wan-video" && model.active).map(model => model.model_id).sort();
  const formAnalysis = analyzeWanFiniteGetterCandidates({ source: formSource.text, model_ids: modelIds, module_name: formSource.module_name });
  const aspectRatioUse = formAnalysis.source_diagnostics.field_producers.find(producer => producer.field === "aspect_ratio")?.render_call?.target?.import_references.some(binding => binding.specifier === "./AspectRatio.js" && binding.imported_name === "A" && binding.local_name === "St");
  if (!aspectRatioUse) throw new Error("WAN_V24_ASPECT_RATIO_HELPER_BINDING_UNPROVEN");
  return fetchWanFiniteAspectRatioHelperForReview(inventory, publicVersion, settingsVersion, fetchImpl);
}

/** One newly pinned, RAM-only helper GET after the current pinned form AST established its direct aspect-ratio import. */
export async function fetchWanFiniteAspectRatioHelperForReview(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, fetchImpl: typeof fetch = fetch): Promise<{ module_name: "AspectRatio.js"; url: string; bytes: number; sha256: string; bom_present: boolean; text: string }> {
  buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  const ref = { module_name: "AspectRatio.js" as const, url: `${inventory.build.base_url}AspectRatio.js` };
  const url = new URL(ref.url);
  if (url.origin !== "https://syntx.ai" || url.pathname !== "/assets/1791467421/AspectRatio.js") throw new Error("WAN_V24_HELPER_REFERENCE_INVALID");
  let response: Response;
  try { response = await fetchImpl(ref.url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { accept: JS_MEDIA_TYPES.join(", "), "accept-encoding": "identity" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("WAN_V24_HELPER_FETCH_FAILED"); }
  if (!response.ok || response.redirected || response.url !== ref.url || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error("WAN_V24_HELPER_RESPONSE_INVALID"); }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("content-length");
  const maxHelperBytes = 1024 * 1024;
  if (!mediaType || !JS_MEDIA_TYPES.includes(mediaType) || (contentLength !== null && (!/^\d{1,12}$/u.test(contentLength) || Number(contentLength) > maxHelperBytes))) { void response.body.cancel().catch(() => undefined); throw new Error("WAN_V24_HELPER_RESPONSE_INVALID"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxHelperBytes) { void reader.cancel().catch(() => undefined); throw new Error("WAN_V24_HELPER_SIZE_LIMIT"); } chunks.push(Buffer.from(value)); } }
  finally { try { reader.releaseLock(); } catch { /* preserve primary failure */ } }
  const raw = Buffer.concat(chunks, bytes); const sha256 = wanFiniteSourceSha256(raw); const bomPresent = wanFiniteHasBom(raw);
  const text = decodeWanFiniteSourceText(raw);
  if (Buffer.byteLength(text, "utf8") !== bytes || wanFiniteSourceSha256(Buffer.from(text, "utf8")) !== sha256) throw new Error("WAN_V24_HELPER_DECODE_HASH_MISMATCH");
  return { module_name: ref.module_name, url: ref.url, bytes, sha256, bom_present: bomPresent, text };
}

export async function fetchWanFiniteAspectRatioListHelperForReview(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, parent: { readonly module_name: string; readonly bytes: number; readonly sha256: string; readonly imported_names: readonly string[] }, fetchImpl: typeof fetch = fetch): Promise<{ module_name: "aspectRatioList.js"; url: string; bytes: number; sha256: string; bom_present: boolean; text: string }> {
  buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  const expectedImports = ["i as b", "g as r", "r as T"];
  if (parent.module_name !== "AspectRatio.js" || parent.bytes !== 2695 || parent.sha256 !== "sha256:ba08e10bef5b19f13ffe8bb425dab56c38700178d1d8fecc8d01bdd054452cbf" || expectedImports.some(binding => !parent.imported_names.includes(binding))) throw new Error("WAN_V24_RATIO_LIST_PARENT_BINDING_UNVERIFIED");
  const urlString = `${inventory.build.base_url}aspectRatioList.js`;
  const url = new URL(urlString);
  if (url.origin !== "https://syntx.ai" || url.pathname !== "/assets/1791467421/aspectRatioList.js") throw new Error("WAN_V24_RATIO_LIST_REFERENCE_INVALID");
  let response: Response;
  try { response = await fetchImpl(urlString, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { accept: JS_MEDIA_TYPES.join(", "), "accept-encoding": "identity" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("WAN_V24_RATIO_LIST_FETCH_FAILED"); }
  if (!response.ok || response.redirected || response.url !== urlString || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error("WAN_V24_RATIO_LIST_RESPONSE_INVALID"); }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("content-length");
  const maxHelperBytes = 1024 * 1024;
  if (!mediaType || !JS_MEDIA_TYPES.includes(mediaType) || (contentLength !== null && (!/^\d{1,12}$/u.test(contentLength) || Number(contentLength) > maxHelperBytes))) { void response.body.cancel().catch(() => undefined); throw new Error("WAN_V24_RATIO_LIST_RESPONSE_INVALID"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > maxHelperBytes) { void reader.cancel().catch(() => undefined); throw new Error("WAN_V24_RATIO_LIST_SIZE_LIMIT"); } chunks.push(Buffer.from(value)); } }
  finally { try { reader.releaseLock(); } catch { /* preserve primary failure */ } }
  const raw = Buffer.concat(chunks, bytes); const sha256 = wanFiniteSourceSha256(raw); const bomPresent = wanFiniteHasBom(raw);
  const text = decodeWanFiniteSourceText(raw);
  if (Buffer.byteLength(text, "utf8") !== bytes || wanFiniteSourceSha256(Buffer.from(text, "utf8")) !== sha256) throw new Error("WAN_V24_RATIO_LIST_DECODE_HASH_MISMATCH");
  return { module_name: "aspectRatioList.js", url: urlString, bytes, sha256, bom_present: bomPresent, text };
}

/** Revalidates in-memory source texts against the exact current pins after an AST-only code rebuild; performs no I/O. */
export function reverifyWanFiniteSourceTexts(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, candidates: readonly WanFinitePinnedSource[]): WanFinitePinnedSource[] {
  const refs = buildWanFiniteSourceReferences(inventory, publicVersion, settingsVersion);
  if (candidates.length !== refs.length) throw new Error("WAN_V24_SOURCE_SET_INVALID");
  return refs.map((ref, index) => {
    const candidate = candidates[index];
    if (!candidate || candidate.module_name !== ref.module_name || candidate.url !== ref.url || (ref.bytes !== null && candidate.bytes !== ref.bytes)) throw new Error("WAN_V24_SOURCE_IDENTITY_MISMATCH");
    const raw = Buffer.from(candidate.text, "utf8");
    if (raw.byteLength !== candidate.bytes || wanFiniteSourceSha256(raw) !== ref.sha256 || candidate.sha256 !== ref.sha256 || wanFiniteHasBom(raw) !== candidate.bom_present) throw new Error("WAN_V24_SOURCE_HASH_MISMATCH");
    const verified = Object.freeze({ ...candidate });
    V24_VERIFIED_SOURCE_OBJECTS.add(verified);
    return verified;
  });
}

export function analyzeWanFiniteSourceCandidates(input: { public_catalog: SyntxPublicCatalogSnapshot; public_version: string; settings_inventory: MaplessSettingsInventory; settings_version: string; sources: readonly WanFinitePinnedSource[] }): WanFiniteSourceArtifact {
  const refs = buildWanFiniteSourceReferences(input.settings_inventory, input.public_version, input.settings_version);
  if (input.sources.length !== refs.length) throw new Error("WAN_V24_SOURCE_SET_INVALID");
  const sources = refs.map((ref, index) => {
    const source = input.sources[index];
    if (!source || !V24_VERIFIED_SOURCE_OBJECTS.has(source)) throw new Error("WAN_V24_SOURCE_NOT_VERIFIED");
    const textSha = wanFiniteSourceSha256(Buffer.from(source.text, "utf8"));
    if (source.module_name !== ref.module_name || source.url !== ref.url || (ref.bytes !== null && ref.bytes !== source.bytes) || source.sha256 !== ref.sha256 || textSha !== ref.sha256 || source.bytes !== Buffer.byteLength(source.text, "utf8")) throw new Error(`WAN_V24_SOURCE_MISMATCH_${ref.module_name.replace(/[^A-Za-z0-9]/gu, "_").toUpperCase()}`);
    return source;
  });
  const modelIds = input.settings_inventory.models.filter(model => model.form_id === "wan-video" && model.active).map(model => model.model_id).sort();
  const publicIds = input.public_catalog.models.filter(model => model.active && modelIds.includes(model.value)).map(model => model.value).sort();
  if (JSON.stringify(modelIds) !== JSON.stringify([...EXPECTED_WAN_MODEL_IDS].sort()) || JSON.stringify(modelIds) !== JSON.stringify(publicIds)) throw new Error("WAN_V24_MODEL_BINDING_INVALID");
  const formResult = analyzeWanFiniteGetterCandidates({ source: sources[2]!.text, model_ids: modelIds, module_name: "wan-video.js" });
  const helpers = sources.slice(0, 2).map(source => analyzeWanFiniteGetterCandidates({ source: source.text, model_ids: [], module_name: source.module_name, include_controls: false }));
  const sourceFiles = sources.map(source => parseSource(source.text, source.module_name));
  const analysisByModule = new Map(sources.map((source, index) => [source.module_name, index === 2 ? formResult : helpers[index]!] as const));
  const exportsByModule = new Map(sources.map((source, index) => [source.module_name, collectExportNames(sourceFiles[index]!)] as const));
  const importsByModule = sources.flatMap(source => analysisByModule.get(source.module_name)!.source_diagnostics.imports_by_module);
  const dependencyBindings = importsByModule.flatMap(module => module.bindings.map(binding => {
    const target = binding.specifier === "./app.js" ? "app.js" : binding.specifier === "./settings3.js" ? "settings3.js" : null;
    const targetExports = target ? exportsByModule.get(target) : undefined;
    const status = binding.kind === "NAMESPACE" ? "UNSUPPORTED_NAMESPACE_BINDING" as const
      : !target || !targetExports ? "UNRESOLVED_MODULE_NOT_FETCHED" as const
      : targetExports.has(binding.imported_name) ? "HASH_PINNED_EXPORT_MATCH" as const
      : "SOURCE_NAME_NOT_EXPORTED" as const;
    return { importer_module: module.module_name, specifier: binding.specifier, imported_name: binding.imported_name, local_name: binding.local_name, status };
  }));
  const unresolvedImports = dependencyBindings.filter(binding => binding.status !== "HASH_PINNED_EXPORT_MATCH").map(binding => ({ module_name: binding.importer_module, specifier: binding.specifier }));
  const sourceDiagnostics = {
    imports_by_module: importsByModule,
    dependency_bindings: dependencyBindings,
    app_export_names: [...(exportsByModule.get("app.js") ?? new Set<string>())].sort(),
    module_imported_calls: formResult.source_diagnostics.module_imported_calls,
    import_usage_sites: formResult.source_diagnostics.import_usage_sites,
    module_exports: formResult.source_diagnostics.module_exports,
    field_producers: formResult.source_diagnostics.field_producers
  };
  const renderListCandidates = [...helpers.flatMap(result => result.render_list_candidates), ...formResult.render_list_candidates];
  const sourcesByModule = sources.map(source => ({ module_name: source.module_name, url: source.url, bytes: source.bytes, sha256: source.sha256, bom_present: source.bom_present }));
  return {
    schema_version: "1.0.0", catalog_kind: "WAN_FINITE_GETTER_SOURCE_CANDIDATES", evidence_scope: "PARTIAL_STATIC_SOURCE_CANDIDATE", runtime_usable: false, backend_acceptance: false, source_persisted: false,
    public_version: input.public_version, settings_version: input.settings_version, build_id: input.settings_inventory.build.id,
    model_ids: modelIds, target_fields: ["aspect_ratio", "resolution", "video_duration"], source_identities: sourcesByModule,
    controls: formResult.controls, render_list_candidates: renderListCandidates, source_diagnostics: sourceDiagnostics, unresolved_imports: unresolvedImports,
    limitations: ["Literal options/getter values and child renderList inputs are UI-source candidates only; no backend wire acceptance is inferred.", "Finite local bindings are limited to AST-resolved const/getters; parameter, let/var, imported, dynamic, ambiguous, or unsupported expressions remain unknown.", "UI null/auto choices, guarded options, UI defaults, and effective backend defaults are separate; backend defaults remain UNKNOWN.", "No other import source was fetched or executed; unresolved dependency bindings remain unknown.", "This artifact is not a reviewed executable V2 contract or live runtime proof."]
  };
}

export async function archiveWanFiniteSourceCandidates(artifact: WanFiniteSourceArtifact, projectRoot: string, now: () => Date = () => new Date()): Promise<{ version: string; status: "created" | "existing" }> {
  const serialized = `${JSON.stringify({ ...artifact, observed_at: now().toISOString() }, null, 2)}\n`;
  const directory = join(resolve(projectRoot), "catalog", "runtime", "v24");
  await mkdir(directory, { recursive: true });
  const version = `sha256-${rawDigest(Buffer.from(serialized))}.json`;
  const target = join(directory, version);
  let status: "created" | "existing" = "created";
  try { await createImmutableJsonSnapshot(target, serialized, { maxBytes: 2 * 1024 * 1024 }); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS")) throw error; status = "existing"; }
  if ((await readFile(target, "utf8")) !== serialized) throw new Error("WAN_V24_ARTIFACT_COLLISION");
  return { version, status };
}

export function parseWanFiniteSourceArguments(args: readonly string[]) {
  if (args.length !== 6 || !["--review", "--archive"].includes(args[0] ?? "") || args[1] !== "--public-version" || args[2] !== WAN_FINITE_PUBLIC_VERSION || args[3] !== "--settings-version" || args[4] !== WAN_FINITE_SETTINGS_VERSION || args[5] !== "--confirm-source-fetch") throw new Error("Usage: wan-finite-getter-candidates-v24.mjs --review|--archive --public-version <pinned> --settings-version <pinned> --confirm-source-fetch");
  return { mode: args[0] as "--review" | "--archive", public_version: args[2]!, settings_version: args[4]! };
}

async function fetchWanFiniteSource(ref: WanFiniteSourceReference, fetchImpl: typeof fetch): Promise<WanFinitePinnedSource> {
  const url = new URL(ref.url);
  if (url.origin !== "https://syntx.ai" || url.pathname !== `/assets/1791467421/${ref.module_name}` || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) throw new Error("WAN_V24_SOURCE_REFERENCE_INVALID");
  let response: Response;
  try { response = await fetchImpl(ref.url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { accept: JS_MEDIA_TYPES.join(", "), "accept-encoding": "identity" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("WAN_V24_SOURCE_FETCH_FAILED"); }
  if (!response.ok || response.redirected || response.url !== ref.url || !response.body) { void response.body?.cancel().catch(() => undefined); throw new Error("WAN_V24_SOURCE_RESPONSE_INVALID"); }
  const mediaType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = response.headers.get("content-length");
  if (!mediaType || !JS_MEDIA_TYPES.includes(mediaType) || (contentLength !== null && (!/^\d{1,12}$/u.test(contentLength) || Number(contentLength) > MAX_SOURCE_BYTES || (ref.bytes !== null && Number(contentLength) !== ref.bytes)))) { void response.body.cancel().catch(() => undefined); throw new Error("WAN_V24_SOURCE_RESPONSE_INVALID"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let bytes = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.byteLength; if (bytes > MAX_SOURCE_BYTES || (ref.bytes !== null && bytes > ref.bytes)) { void reader.cancel().catch(() => undefined); throw new Error("WAN_V24_SOURCE_SIZE_LIMIT"); } chunks.push(Buffer.from(value)); } }
  finally { try { reader.releaseLock(); } catch { /* preserve primary failure */ } }
  if (ref.bytes !== null && bytes !== ref.bytes) throw new Error("WAN_V24_SOURCE_SIZE_MISMATCH");
  const raw = Buffer.concat(chunks, bytes); const sha = wanFiniteSourceSha256(raw); const bom = wanFiniteHasBom(raw);
  if (sha !== ref.sha256) throw new Error("WAN_V24_SOURCE_HASH_MISMATCH");
  const text = decodeWanFiniteSourceText(raw);
  if (Buffer.byteLength(text, "utf8") !== bytes || wanFiniteSourceSha256(Buffer.from(text, "utf8")) !== sha) throw new Error("WAN_V24_SOURCE_DECODE_HASH_MISMATCH");
  const source = Object.freeze({ module_name: ref.module_name, url: ref.url, bytes, sha256: sha, text, bom_present: bom });
  V24_VERIFIED_SOURCE_OBJECTS.add(source);
  return source;
}

function parseSource(text: string, name: string): ts.SourceFile { const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }; if (file.parseDiagnostics.length) throw new Error("WAN_V24_AST_PARSE_FAILED"); return file; }
function collectExportNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  function exported(node: ts.Node): boolean { return ts.canHaveModifiers(node) && (ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword) ?? false); }
  function visit(node: ts.Node): void {
    if (ts.isExportAssignment(node)) names.add("default");
    else if (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause)) for (const item of node.exportClause.elements) names.add(item.name.text);
    else if (exported(node)) {
      if (ts.isVariableStatement(node)) {
        for (const declaration of node.declarationList.declarations) if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text);
      } else if ((ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node) || ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node) || ts.isEnumDeclaration(node)) && node.name) names.add(node.name.text);
      if (ts.canHaveModifiers(node) && ts.getModifiers(node)?.some(modifier => modifier.kind === ts.SyntaxKind.DefaultKeyword)) names.add("default");
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return names;
}
export function wanFiniteHasBom(bytes: Uint8Array): boolean { return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf; }
export function decodeWanFiniteSourceText(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
export function wanFiniteSourceSha256(bytes: Uint8Array): string { return `sha256:${rawDigest(bytes)}`; }
function rawDigest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
