import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import ts from "typescript";
import type { MaplessSettingsInventory } from "../src/catalog/mapless-settings-inventory.js";
import type { SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { createImmutableJsonSnapshot } from "./settings-ir/immutable-json-snapshot.js";

export const WAN_SOURCE_PUBLIC_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
export const WAN_SOURCE_SETTINGS_VERSION = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const MAX_BODY_BYTES = 5 * 1024 * 1024;
const SOURCE_MEDIA = ["application/javascript", "application/x-javascript", "text/javascript"];
const EXPECTED_MODELS = ["wan_25_i2v_preview", "wan_25_t2v_preview", "wan_26_i2v", "wan_26_i2v_flash", "wan_26_r2v", "wan_26_r2v_flash", "wan_26_t2v", "wan_27_i2v", "wan_27_r2v", "wan_27_t2v", "wan_27_videoedit"];
const verifiedSourceObjects = new WeakSet<object>();
export interface WanPinnedSourceReference { readonly module_name: string; readonly url: string; readonly bytes: number | null; readonly sha256: string; }
export class WanSourceIdentityMismatch extends Error {
  constructor(readonly details: { module_name: string; expected: WanPinnedSourceReference; actual: { module_name: string | null; url: string | null; bytes: number | null; sha256: string | null; text_sha256: string | null; bom_present: boolean | null } }) { super("SOURCE_IDENTITY_MISMATCH"); }
}
export class WanSourceHashMismatch extends Error {
  constructor(readonly details: { module_name: string; url: string; expected_bytes: number | null; actual_bytes: number; expected_sha256: string; actual_sha256: string; bom_present: boolean; text_sha256_matches: boolean }) { super("SOURCE_HASH_MISMATCH"); }
}
const literal = (node: ts.Expression): { found: boolean; value?: string | number | boolean | null } => {
  if (ts.isStringLiteralLike(node)) return { found: true, value: node.text };
  if (ts.isNumericLiteral(node)) return { found: true, value: Number(node.text) };
  if ([ts.SyntaxKind.TrueKeyword, ts.SyntaxKind.FalseKeyword, ts.SyntaxKind.NullKeyword].includes(node.kind)) return { found: true, value: node.kind === ts.SyntaxKind.NullKeyword ? null : node.kind === ts.SyntaxKind.TrueKeyword };
  return { found: false };
};

export interface WanCandidateSource { readonly module_name: string; readonly url: string; readonly bytes: number; readonly sha256: string; readonly text: string; readonly bom_present: boolean; }
export interface WanCandidateInput { readonly publicCatalog: SyntxPublicCatalogSnapshot; readonly publicVersion: string; readonly settingsInventory: MaplessSettingsInventory; readonly settingsVersion: string; readonly sources: readonly WanCandidateSource[]; }
export interface WanConditionalSourceCandidateArtifact {
  schema_version: "1.0.0"; catalog_kind: "WAN_CONDITIONAL_SOURCE_CANDIDATES"; runtime_usable: false; backend_acceptance: false; source_persisted: false;
  public_version: string; settings_version: string; build_id: string;
  sources: Array<{ module_name: string; url: string; bytes: number; sha256: string; bom_present: boolean }>;
  dependency_trace: { app_binding: "HASH_PINNED_CURRENT_INVENTORY" | "UNRESOLVED"; imported_modules: string[]; unresolved_imports: string[] };
  controls: Array<{ field: string; options_status: "STATIC_LITERAL" | "DYNAMIC" | "UNKNOWN"; option_values: Array<string | number | boolean | null>; options_nullable: boolean; required: "TRUE" | "FALSE" | "UNKNOWN"; rendered: "UNCONDITIONAL_SOURCE" | "CONDITIONAL_SOURCE" | "UNKNOWN"; guards: Array<{ model_type: string | null; operator: "===" | "!==" | "UNRESOLVED"; value: string | number | boolean | null; branch: "THEN" | "ELSE" | "CASE"; line: number }>; default_status: "UNKNOWN"; source_line: number; source_column: number }>;
  models: Array<{ model_id: string; controls: Array<{ field: string; applicability: "SOURCE_GUARD_MATCH" | "UNCONDITIONAL_CONTROL" | "UNKNOWN" }> }>;
  limitations: string[];
}

export function analyzeWanConditionalSourceCandidates(input: WanCandidateInput): WanConditionalSourceCandidateArtifact {
  const inventory = input.settingsInventory;
  const expected = buildPinnedWanSourceReferences(inventory, input.publicVersion, input.settingsVersion);
  if (input.sources.length !== expected.length) throw new Error("SOURCE_BINDING_INVALID");
  const sources = expected.map((ref, index) => {
    const source = input.sources[index];
    if (!source || !verifiedSourceObjects.has(source)) throw new Error("SOURCE_NOT_VERIFIED");
    const textSha256 = sourceSha256(Buffer.from(source.text, "utf8"));
    if (source.module_name !== ref.module_name || source.url !== ref.url || (ref.bytes !== null && source.bytes !== ref.bytes) || source.bytes !== Buffer.byteLength(source.text, "utf8") || source.sha256 !== ref.sha256 || textSha256 !== ref.sha256) throw new WanSourceIdentityMismatch({ module_name: ref.module_name, expected: ref, actual: { module_name: source.module_name, url: source.url, bytes: source.bytes, sha256: source.sha256, text_sha256: textSha256, bom_present: source.bom_present } });
    return source;
  });
  const models = inventory.models.filter(model => model.form_id === "wan-video" && model.active).map(model => model.model_id).sort();
  const publicModels = input.publicCatalog.models.filter(model => models.includes(model.value) && model.active).map(model => model.value).sort();
  if (JSON.stringify(models) !== JSON.stringify([...EXPECTED_MODELS].sort()) || JSON.stringify(models) !== JSON.stringify(publicModels)) throw new Error("MODEL_BINDING_INVALID");
  const appFile = parse(sources[0]!.text, "app.js");
  const settingsFile = parse(sources[1]!.text, "settings3.js");
  const formFile = parse(sources[2]!.text, "wan-video.js");
  const imports = (file: ts.SourceFile) => {
    const result: string[] = [];
    function visit(node: ts.Node) { if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) result.push(node.moduleSpecifier.text); ts.forEachChild(node, visit); }
    visit(file); return result;
  };
  const formImports = imports(formFile); const settingsImports = imports(settingsFile); const appImports = imports(appFile);
  const importedModules = [...new Set([...formImports, ...settingsImports, ...appImports])].sort();
  const unresolvedImports = importedModules.filter(name => !["./app.js", "./settings3.js"].includes(name));
  const { controls: uniqueControls, models: modelsOut } = extractWanConditionalControls(sources[2]!.text, models);
  return {
    schema_version: "1.0.0", catalog_kind: "WAN_CONDITIONAL_SOURCE_CANDIDATES", runtime_usable: false, backend_acceptance: false, source_persisted: false,
    public_version: input.publicVersion, settings_version: input.settingsVersion, build_id: inventory.build.id,
    sources: sources.map(source => ({ module_name: source.module_name, url: source.url, bytes: source.bytes, sha256: source.sha256, bom_present: source.bom_present })),
    dependency_trace: { app_binding: settingsImports.includes("./app.js") && formImports.includes("./settings3.js") && unresolvedImports.length === 0 ? "HASH_PINNED_CURRENT_INVENTORY" : "UNRESOLVED", imported_modules: importedModules, unresolved_imports: unresolvedImports },
    controls: uniqueControls, models: modelsOut,
    limitations: ["Static source candidates are not backend-accepted wire values or effective defaults.", "Vendor JavaScript was parsed as AST only and never executed.", "Imported modules not in the three hash-pinned sources remain unresolved.", "Public upload and cost metadata are not UI enums or wire-schema proof."]
  };
}

export function extractWanConditionalControls(formText: string, modelIds: readonly string[]): { controls: WanConditionalSourceCandidateArtifact["controls"]; models: WanConditionalSourceCandidateArtifact["models"] } {
  const formFile = parse(formText, "wan-video.js");
  const constants = new Map<string, ts.VariableDeclaration[]>();
  function consts(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer && ts.isVariableDeclarationList(node.parent) && (node.parent.flags & ts.NodeFlags.Const) !== 0) {
      constants.set(node.name.text, [...(constants.get(node.name.text) ?? []), node]);
    }
    ts.forEachChild(node, consts);
  }
  consts(formFile);
  function lexicalScope(node: ts.Node): ts.Node { let current: ts.Node | undefined = node; while (current && !ts.isSourceFile(current) && !ts.isBlock(current)) current = current.parent; return current ?? formFile; }
  function scopeDepth(node: ts.Node): number { let depth = 0; let current: ts.Node | undefined = node; while (current) { depth++; current = current.parent; } return depth; }
  function isAncestor(ancestor: ts.Node, node: ts.Node): boolean { let current: ts.Node | undefined = node; while (current) { if (current === ancestor) return true; current = current.parent; } return false; }
  function resolveOptions(node: ts.Expression): { status: "STATIC_LITERAL" | "DYNAMIC" | "UNKNOWN"; values: Array<string | number | boolean | null> } {
    let value: ts.Expression | undefined = node;
    if (ts.isIdentifier(node)) {
      const declarations = constants.get(node.text) ?? [];
      const useScope = lexicalScope(node);
      const visible = declarations.filter(declaration => isAncestor(lexicalScope(declaration), useScope));
      const nearestDepth = Math.max(-1, ...visible.map(declaration => scopeDepth(lexicalScope(declaration))));
      const nearest = visible.filter(declaration => scopeDepth(lexicalScope(declaration)) === nearestDepth);
      if (nearest.length !== 1) return { status: "UNKNOWN", values: [] };
      value = nearest[0]!.initializer;
    }
    if (!value || !ts.isArrayLiteralExpression(value)) return { status: "DYNAMIC", values: [] };
    const values: Array<string | number | boolean | null> = [];
    for (const element of value.elements) {
      if (ts.isSpreadElement(element)) return { status: "UNKNOWN", values: [] };
      const direct = literal(element as ts.Expression);
      if (direct.found) { values.push(direct.value!); continue; }
      if (ts.isObjectLiteralExpression(element)) {
        const val = element.properties.find((property): property is ts.PropertyAssignment => ts.isPropertyAssignment(property) && (property.name.getText(formFile) === "value" || (ts.isStringLiteralLike(property.name) && property.name.text === "value")));
        const found = val && literal(val.initializer);
        if (!found?.found) return { status: "UNKNOWN", values: [] };
        values.push(found.value!); continue;
      }
      return { status: "UNKNOWN", values: [] };
    }
    return { status: "STATIC_LITERAL", values };
  }
  function path(node: ts.Expression): string[] { if (ts.isPropertyAccessExpression(node)) return [...path(node.expression), node.name.text]; if (ts.isElementAccessExpression(node) && node.argumentExpression && ts.isStringLiteralLike(node.argumentExpression)) return [...path(node.expression), node.argumentExpression.text]; if (ts.isIdentifier(node)) return [node.text]; return []; }
  function modelGuard(expr: ts.Expression): { model_type: string | null; operator: "===" | "!==" | "UNRESOLVED"; value: string | number | boolean | null } {
    if (!ts.isBinaryExpression(expr) || ![ts.SyntaxKind.EqualsEqualsEqualsToken, ts.SyntaxKind.ExclamationEqualsEqualsToken].includes(expr.operatorToken.kind)) return { model_type: null, operator: "UNRESOLVED", value: null };
    const left = path(expr.left); const right = literal(expr.right); const reverse = path(expr.right); const leftLiteral = literal(expr.left);
    const field = left.at(-1) === "model_type" ? "model_type" : reverse.at(-1) === "model_type" ? "model_type" : null;
    const val = right.found ? right.value! : leftLiteral.found ? leftLiteral.value! : null;
    return { model_type: field, operator: expr.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken ? "===" : "!==", value: val };
  }
  type Guard = { model_type: string | null; operator: "===" | "!==" | "UNRESOLVED"; value: string | number | boolean | null; branch: "THEN" | "ELSE" | "CASE"; line: number };
  const controls: WanConditionalSourceCandidateArtifact["controls"] = [];
  function scan(node: ts.Node, guards: Guard[] = []) {
    if (ts.isIfStatement(node)) { const g = modelGuard(node.expression); const line = formFile.getLineAndCharacterOfPosition(node.expression.getStart(formFile)).line + 1; scan(node.thenStatement, [...guards, { ...g, branch: "THEN", line }]); if (node.elseStatement) scan(node.elseStatement, [...guards, { ...g, operator: g.operator === "===" ? "!==" : g.operator === "!==" ? "===" : "UNRESOLVED", branch: "ELSE", line }]); return; }
    if (ts.isSwitchStatement(node)) { for (const clause of node.caseBlock.clauses) { const value = ts.isCaseClause(clause) ? literal(clause.expression) : { found: false }; const line = formFile.getLineAndCharacterOfPosition(clause.getStart(formFile)).line + 1; for (const child of clause.statements) scan(child, [...guards, { model_type: path(node.expression).at(-1) === "model_type" ? "model_type" : null, operator: "===", value: value.found ? value.value! : null, branch: "CASE", line }]); } return; }
    if (ts.isConditionalExpression(node)) { const g = modelGuard(node.condition); const line = formFile.getLineAndCharacterOfPosition(node.condition.getStart(formFile)).line + 1; scan(node.whenTrue, [...guards, { ...g, branch: "THEN", line }]); scan(node.whenFalse, [...guards, { ...g, operator: g.operator === "===" ? "!==" : g.operator === "!==" ? "===" : "UNRESOLVED", branch: "ELSE", line }]); return; }
    if (ts.isBinaryExpression(node) && [ts.SyntaxKind.AmpersandAmpersandToken, ts.SyntaxKind.BarBarToken].includes(node.operatorToken.kind)) {
      const line = formFile.getLineAndCharacterOfPosition(node.operatorToken.getStart(formFile)).line + 1;
      scan(node.left, guards);
      scan(node.right, [...guards, { model_type: null, operator: "UNRESOLVED", value: null, branch: "THEN", line }]);
      return;
    }
    if (ts.isPropertyAssignment(node) && (ts.isIdentifier(node.name) || ts.isStringLiteralLike(node.name)) && node.name.text === "modelValue") {
      const parts = path(node.initializer); const field = parts.at(-2) === "settings" ? parts.at(-1) : null;
      if (field) {
        const props = ts.isObjectLiteralExpression(node.parent) ? node.parent.properties.filter(ts.isPropertyAssignment) : [];
        const optionProp = props.find(prop => ["options", "optionList", "option_list", "ratios"].includes(ts.isIdentifier(prop.name) ? prop.name.text : ts.isStringLiteralLike(prop.name) ? prop.name.text : ""));
        const requiredProp = props.find(prop => (ts.isIdentifier(prop.name) ? prop.name.text : "") === "required");
        const optionResult = optionProp ? resolveOptions(optionProp.initializer) : { status: "DYNAMIC" as const, values: [] };
        const location = formFile.getLineAndCharacterOfPosition(node.getStart(formFile));
        controls.push({ field, options_status: optionResult.status, option_values: optionResult.values, options_nullable: optionResult.values.includes(null), required: requiredProp && requiredProp.initializer.kind === ts.SyntaxKind.TrueKeyword ? "TRUE" : requiredProp && requiredProp.initializer.kind === ts.SyntaxKind.FalseKeyword ? "FALSE" : "UNKNOWN", rendered: guards.length === 0 ? "UNCONDITIONAL_SOURCE" : guards.some(guard => guard.operator === "UNRESOLVED" || guard.model_type === null) ? "UNKNOWN" : "CONDITIONAL_SOURCE", guards: guards.map(g => ({ ...g })), default_status: "UNKNOWN", source_line: location.line + 1, source_column: location.character + 1 });
      }
    }
    ts.forEachChild(node, child => scan(child, guards));
  }
  scan(formFile);
  const uniqueControls = controls.sort((a,b)=>a.source_line-b.source_line || a.source_column-b.source_column);
  const models = modelIds.map(model_id => ({ model_id, controls: uniqueControls.map(control => {
    const guards = control.guards;
    if (guards.length === 0) return { field: control.field, applicability: "UNCONDITIONAL_CONTROL" as const };
    if (guards.some(guard => guard.model_type !== "model_type" || guard.operator === "UNRESOLVED" || typeof guard.value !== "string")) return { field: control.field, applicability: "UNKNOWN" as const };
    return { field: control.field, applicability: guards.every(guard => (guard.operator === "===" && guard.value === model_id) || (guard.operator === "!==" && guard.value !== model_id)) ? "SOURCE_GUARD_MATCH" as const : "UNKNOWN" as const };
  }) }));
  return { controls: uniqueControls, models };
}

export function parseWanConditionalSourceArguments(args: readonly string[]) {
  if (args.length !== 6 || !["--probe", "--archive"].includes(args[0] ?? "") || args[1] !== "--public-version" || args[2] !== WAN_SOURCE_PUBLIC_VERSION || args[3] !== "--settings-version" || args[4] !== WAN_SOURCE_SETTINGS_VERSION || args[5] !== "--confirm-source-fetch") throw new Error("Usage: wan-conditional-source-candidates-v23.mjs --probe|--archive --public-version <pinned> --settings-version <pinned> --confirm-source-fetch");
  return { mode: args[0] as "--probe" | "--archive", publicVersion: args[2]!, settingsVersion: args[4]! };
}

export function buildPinnedWanSourceReferences(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string): WanPinnedSourceReference[] {
  if (publicVersion !== WAN_SOURCE_PUBLIC_VERSION || settingsVersion !== WAN_SOURCE_SETTINGS_VERSION || inventory.public_catalog.version !== publicVersion || inventory.build.id !== "1791467421" || inventory.app_sha256 !== "sha256:0b12fd2028bf81fd8c8482adb807fd8f14d092a3c26d2e60e718418147f8d0cf") throw new Error("SOURCE_BINDING_INVALID");
  const form = inventory.forms.find(candidate => candidate.form_id === "wan-video");
  const refs: WanPinnedSourceReference[] = [
    { module_name: "app.js", url: `${inventory.build.base_url}app.js`, bytes: null, sha256: inventory.app_sha256 },
    { module_name: "settings3.js", url: inventory.framework.settings3.url, bytes: inventory.framework.settings3.bytes, sha256: inventory.framework.settings3.sha256 },
    { module_name: "wan-video.js", url: form?.javascript.url ?? "", bytes: form?.javascript.bytes ?? -1, sha256: form?.javascript.sha256 ?? "" }
  ];
  if (refs[2]!.bytes !== 19503 || refs[2]!.sha256 !== "sha256:aae2be04ca8a814db7dfb93717a234f55922b4b9f0ebc3eccd517c9d82f46119" || refs[1]!.sha256 !== "sha256:cbf76cc326616566ae9132655802af9a8c16261a42b7796b1809f9958ea2cdfe") throw new Error("SOURCE_BINDING_INVALID");
  return refs;
}

export async function fetchPinnedWanCandidateSources(inventory: MaplessSettingsInventory, publicVersion: string, settingsVersion: string, fetchImpl: typeof fetch = fetch): Promise<WanCandidateSource[]> {
  const refs = buildPinnedWanSourceReferences(inventory, publicVersion, settingsVersion);
  const sources: WanCandidateSource[] = [];
  for (const ref of refs) sources.push(await fetchSource(ref, fetchImpl));
  return sources;
}

export async function archiveWanConditionalSourceCandidate(artifact: WanConditionalSourceCandidateArtifact, projectRoot: string, now: () => Date = () => new Date()): Promise<{ version: string; status: "created" | "existing" }> {
  const bytes = `${JSON.stringify({ ...artifact, observed_at: now().toISOString() }, null, 2)}\n`;
  const targetDir = join(resolve(projectRoot), "catalog", "runtime", "v23");
  await mkdir(targetDir, { recursive: true });
  const version = `sha256-${digest(Buffer.from(bytes))}.json`;
  const target = join(targetDir, version);
  let status: "created" | "existing" = "created";
  try { await createImmutableJsonSnapshot(target, bytes, { maxBytes: 2 * 1024 * 1024 }); }
  catch (error) { if (!(error instanceof Error && "code" in error && error.code === "IMMUTABLE_SNAPSHOT_TARGET_EXISTS")) throw error; status = "existing"; }
  const stored = await readFile(target, "utf8");
  if (stored !== bytes) throw new Error("ARTIFACT_COLLISION");
  return { version, status };
}

export async function runWanConditionalSourceCandidateCli(args: readonly string[], deps: { projectRoot: string; publicCatalog: SyntxPublicCatalogSnapshot; settingsInventory: MaplessSettingsInventory; fetchImpl?: typeof fetch; now?: () => Date; }): Promise<{ artifact: WanConditionalSourceCandidateArtifact; version: string | null; status: "created" | "existing" | "not_archived" }> {
  const parsed = parseWanConditionalSourceArguments(args);
  if (deps.publicCatalog.models.length === 0) throw new Error("SOURCE_BINDING_INVALID");
  const sources = await fetchPinnedWanCandidateSources(deps.settingsInventory, parsed.publicVersion, parsed.settingsVersion, deps.fetchImpl ?? fetch);
  const artifact = analyzeWanConditionalSourceCandidates({ publicCatalog: deps.publicCatalog, publicVersion: parsed.publicVersion, settingsInventory: deps.settingsInventory, settingsVersion: parsed.settingsVersion, sources });
  if (parsed.mode === "--probe") return { artifact, version: null, status: "not_archived" };
  const archived = await archiveWanConditionalSourceCandidate(artifact, deps.projectRoot, deps.now);
  return { artifact, ...archived };
}

async function fetchSource(ref: { module_name: string; url: string; bytes: number | null; sha256: string }, fetchImpl: typeof fetch): Promise<WanCandidateSource> {
  const url = new URL(ref.url);
  if (url.origin !== "https://syntx.ai" || !url.pathname.startsWith("/assets/1791467421/") || url.pathname !== `/assets/1791467421/${ref.module_name}` || !/^sha256:[a-f0-9]{64}$/u.test(ref.sha256)) throw new Error("SOURCE_REFERENCE_INVALID");
  let response: Response;
  try { response = await fetchImpl(ref.url, { method: "GET", redirect: "error", credentials: "omit", cache: "no-store", headers: { accept: SOURCE_MEDIA.join(", "), "accept-encoding": "identity" }, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new Error("SOURCE_FETCH_FAILED"); }
  if (!response.ok || response.redirected || response.url !== ref.url) { void response.body?.cancel().catch(() => undefined); throw new Error("SOURCE_RESPONSE_INVALID"); }
  const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const declared = response.headers.get("content-length");
  if (!contentType || !SOURCE_MEDIA.includes(contentType) || response.body === null || (declared !== null && (!/^\d{1,12}$/u.test(declared) || Number(declared) > MAX_BODY_BYTES)) || (ref.bytes !== null && declared !== null && Number(declared) !== ref.bytes)) { void response.body?.cancel().catch(() => undefined); throw new Error("SOURCE_RESPONSE_INVALID"); }
  const reader = response.body.getReader(); const chunks: Buffer[] = []; let length = 0;
  try { while (true) { const { done, value } = await reader.read(); if (done) break; length += value.byteLength; if (length > MAX_BODY_BYTES || (ref.bytes !== null && length > ref.bytes)) { void reader.cancel().catch(() => undefined); throw new Error("SOURCE_SIZE_LIMIT"); } chunks.push(Buffer.from(value)); } }
  finally { try { reader.releaseLock(); } catch { /* preserve primary failure */ } }
  if (ref.bytes !== null && length !== ref.bytes) throw new Error("SOURCE_SIZE_MISMATCH");
  const bytes = Buffer.concat(chunks, length); const sha256 = sourceSha256(bytes);
  if (sha256 !== ref.sha256) throw new WanSourceHashMismatch({ module_name: ref.module_name, url: ref.url, expected_bytes: ref.bytes, actual_bytes: length, expected_sha256: ref.sha256, actual_sha256: sha256, bom_present: hasUtf8Bom(bytes), text_sha256_matches: false });
  const text = decodeWanSourceText(bytes);
  const textSha256 = sourceSha256(Buffer.from(text, "utf8"));
  if (textSha256 !== sha256 || Buffer.byteLength(text, "utf8") !== length) throw new WanSourceHashMismatch({ module_name: ref.module_name, url: ref.url, expected_bytes: ref.bytes, actual_bytes: length, expected_sha256: ref.sha256, actual_sha256: sha256, bom_present: hasUtf8Bom(bytes), text_sha256_matches: textSha256 === sha256 });
  const source = Object.freeze({ module_name: ref.module_name, url: ref.url, bytes: length, sha256, text, bom_present: hasUtf8Bom(bytes) });
  verifiedSourceObjects.add(source);
  return source;
}
export function decodeWanSourceText(bytes: Uint8Array): string { return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
export function hasUtf8Bom(bytes: Uint8Array): boolean { return bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf; }
export function sourceSha256(bytes: Uint8Array): string { return `sha256:${digest(bytes)}`; }
function parse(text: string, name: string): ts.SourceFile { const file = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS) as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }; if (file.parseDiagnostics.length) throw new Error("AST_PARSE_FAILED"); return file; }
function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
