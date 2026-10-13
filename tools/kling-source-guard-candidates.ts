import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { archiveKlingSourceGuardCandidatesV27, buildKlingSourceGuardCandidatesV27, KLING_SOURCE_GUARD_V27_PUBLIC_VERSION, KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256, KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256, KLING_SOURCE_GUARD_V27_SETTINGS_VERSION, KLING_SOURCE_GUARD_V27_SOURCE_SHA256, KLING_SOURCE_GUARD_V27_SOURCE_URL, type KlingFreshGetMetadata } from "../src/catalog/kling-source-guard-candidates-v27.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion } from "../src/catalog/mapless-settings-inventory.js";
import ts from "typescript";

const ACTIVE_MODELS = [
  "kling_elements", "kling_image2video", "kling_keyframes", "kling_motion_control",
  "kling_o1_image2video", "kling_o1_text2video", "kling_o1_video2video", "kling_text2video"
] as const;

export interface KlingSourceAstEvidence {
  readonly parse_diagnostics: number;
  readonly source_bytes: number;
  readonly source_sha256: string;
  readonly normalizer_ast: unknown;
  readonly duration_validator_ast: unknown;
  readonly ast_node_count: number;
}

export function analyzeKlingSourceGuardAst(source: string): KlingSourceAstEvidence {
  const file = ts.createSourceFile("kling.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const diagnostics = (file as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  let astNodeCount = 0;
  const functionNodes: ts.FunctionLikeDeclaration[] = [];
  const visit = (node: ts.Node): void => {
    astNodeCount += 1;
    if (isFunctionLike(node)) functionNodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(file);
  if (astNodeCount > 100_000 || diagnostics.length !== 0) throw new Error("KLING_SOURCE_AST_INVALID");

  const candidates = functionNodes.map((node) => ({ node, identifiers: collectAtoms(node) }));
  const normalizerCandidates = candidates.filter(({ identifiers }) =>
    ACTIVE_MODELS.every((model) => identifiers.has(model)) &&
    ["version", "mode", "gen_type", "video_duration"].every((field) => identifiers.has(field))
  ).sort((left, right) => left.node.end - left.node.pos - (right.node.end - right.node.pos));
  const durationCandidates = candidates.filter(({ identifiers }) =>
    identifiers.has("kling_o1_image2video") && identifiers.has("kling_o1_video2video") &&
    identifiers.has("video_duration")
  ).sort((left, right) => left.node.end - left.node.pos - (right.node.end - right.node.pos));
  const normalizer = normalizerCandidates[0]?.node;
  const duration = durationCandidates[0]?.node;
  if (!normalizer) throw new Error("KLING_SOURCE_NORMALIZER_AST_COHORT_INCOMPLETE");
  if (!duration) throw new Error("KLING_SOURCE_DURATION_AST_NOT_FOUND");

  const tree = (node: ts.Node): unknown => {
    const children: unknown[] = [];
    ts.forEachChild(node, (child) => { children.push(tree(child)); });
    const leaf = children.length === 0 && isSemanticLeaf(node) ? node.getText(file) : null;
    return [ts.SyntaxKind[node.kind], leaf, children];
  };
  const factTree = { normalizer: tree(normalizer), duration_validator: tree(duration) };
  const factBytes = Buffer.from(JSON.stringify(factTree), "utf8");
  if (factBytes.byteLength > 512 * 1024) throw new Error("KLING_SOURCE_AST_FACT_TREE_TOO_LARGE");
  return {
    parse_diagnostics: diagnostics.length,
    source_bytes: Buffer.byteLength(source, "utf8"),
    source_sha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`,
    normalizer_ast: factTree.normalizer,
    duration_validator_ast: factTree.duration_validator,
    ast_node_count: astNodeCount
  };
}

export async function fetchKlingPinnedSourceOnce(inventory: ReturnType<typeof loadMaplessSettingsInventoryVersion>, fetchImpl: typeof fetch = fetch): Promise<{ readonly bytes: Buffer; readonly source: string; readonly metadata: KlingFreshGetMetadata }> {
  const form = inventory.forms.find((entry) => entry.form_id === "kling");
  if (!form || form.module_name !== "kling.js" || form.javascript.url !== KLING_SOURCE_GUARD_V27_SOURCE_URL || form.javascript.bytes !== 31_857 || form.javascript.sha256 !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256 || form.javascript.bytes > 64 * 1024) {
    throw new Error("KLING_SOURCE_PREFLIGHT_PIN_MISMATCH");
  }
  const startedAt = new Date().toISOString();
  let response: Response;
  try { response = await fetchImpl(KLING_SOURCE_GUARD_V27_SOURCE_URL, { method: "GET", redirect: "manual", signal: AbortSignal.timeout(15_000), headers: { accept: "application/javascript" } }); }
  catch { throw new Error("KLING_SOURCE_GET_FAILED"); }
  if (response.status >= 300 && response.status < 400) { await response.body?.cancel(); throw new Error("KLING_SOURCE_REDIRECT_REJECTED"); }
  if (response.status !== 200 || !response.body) { await response.body?.cancel(); throw new Error("KLING_SOURCE_HTTP_STATUS_INVALID"); }
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > 64 * 1024) { await response.body.cancel(); throw new Error("KLING_SOURCE_BODY_LIMIT_EXCEEDED"); }
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > 64 * 1024) { await reader.cancel(); throw new Error("KLING_SOURCE_BODY_LIMIT_EXCEEDED"); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  const bytes = Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
  const actualSha = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  if (bytes.byteLength !== form.javascript.bytes || actualSha !== form.javascript.sha256 || actualSha !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256) throw new Error("KLING_SOURCE_PIN_MISMATCH");
  let source: string;
  try { source = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { throw new Error("KLING_SOURCE_UTF8_INVALID"); }
  const metadata = {
    started_at: startedAt, completed_at: new Date().toISOString(),
    response_date: parseHttpDate(response.headers.get("date")), status: 200 as const, redirects: 0 as const, retries: 0 as const
  };
  if (Date.parse(metadata.completed_at) - Date.parse(metadata.started_at) > 15_000) throw new Error("KLING_SOURCE_TIME_LIMIT_EXCEEDED");
  return { bytes, source, metadata };
}

export async function runKlingSourceGuardCandidatesV27(args = process.argv.slice(2), dependencies: { projectRoot?: string; fetch_impl?: typeof fetch } = {}): Promise<unknown> {
  if (args.length !== 5 || args[0] !== "--public-version" || args[1] !== KLING_SOURCE_GUARD_V27_PUBLIC_VERSION || args[2] !== "--settings-version" || args[3] !== KLING_SOURCE_GUARD_V27_SETTINGS_VERSION || args[4] !== "--confirm-source-fetch") throw new Error("KLING_SOURCE_GUARD_USAGE_INVALID");
  const projectRoot = resolve(dependencies.projectRoot ?? process.cwd());
  const publicCatalog = loadPublicCatalogVersion(KLING_SOURCE_GUARD_V27_PUBLIC_VERSION, join(projectRoot, "catalog"));
  const settingsInventory = loadMaplessSettingsInventoryVersion(KLING_SOURCE_GUARD_V27_SETTINGS_VERSION, join(projectRoot, "catalog"));
  const summaryJson = await readFile(join(projectRoot, ".autopilot/2026-10-08-syntx-completion--wip/tickets/result-69-kling-finite-settings-map.json"));
  const summaryMarkdown = await readFile(join(projectRoot, ".autopilot/2026-10-08-syntx-completion--wip/tickets/result-69-kling-finite-settings-map.md"));
  if (digest(summaryJson) !== KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256.slice(7) || digest(summaryMarkdown) !== KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256.slice(7)) throw new Error("KLING_SOURCE_SUMMARY_PIN_MISMATCH");
  const summary = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(summaryJson)) as { schema?: unknown; astFacts?: unknown };
  if (summary.schema !== "syntx.kling.finite-settings-source-facts.v1" || !summary.astFacts) throw new Error("KLING_SOURCE_SUMMARY_SHAPE_INVALID");
  const fetched = await fetchKlingPinnedSourceOnce(settingsInventory, dependencies.fetch_impl ?? fetch);
  process.stdout.write(`${JSON.stringify({ event: "pinned_source_get_verified", fresh_get: fetched.metadata, source_bytes: fetched.bytes.byteLength, source_sha256: KLING_SOURCE_GUARD_V27_SOURCE_SHA256, raw_source_persisted: false })}\n`);
  const evidence = analyzeKlingSourceGuardAst(fetched.source);
  if (evidence.source_bytes !== fetched.bytes.byteLength || evidence.source_sha256 !== KLING_SOURCE_GUARD_V27_SOURCE_SHA256) throw new Error("KLING_SOURCE_AST_BINDING_INVALID");
  const tree = { normalizer_ast: evidence.normalizer_ast, duration_validator_ast: evidence.duration_validator_ast };
  const treeDigest = `sha256:${createHash("sha256").update(canonicalTree(tree), "utf8").digest("hex")}`;
  const artifact = buildKlingSourceGuardCandidatesV27({
    public_catalog: publicCatalog, settings_inventory: settingsInventory,
    source_fact_tree: { normalizer_ast: evidence.normalizer_ast, duration_validator_ast: evidence.duration_validator_ast, ast_node_count: evidence.ast_node_count, parse_diagnostics: evidence.parse_diagnostics, source_bytes: evidence.source_bytes, source_sha256: evidence.source_sha256 },
    source_fact_tree_sha256: treeDigest, provenance: fetched.metadata,
    result_json_sha256: KLING_SOURCE_GUARD_V27_RESULT_JSON_SHA256, result_markdown_sha256: KLING_SOURCE_GUARD_V27_RESULT_MARKDOWN_SHA256
  });
  const archived = await archiveKlingSourceGuardCandidatesV27(artifact, join(projectRoot, "catalog"));
  process.stdout.write(`${JSON.stringify({ status: archived.status, version: archived.version, sha256: archived.sha256, bytes: archived.bytes, source_identity: { bytes: fetched.bytes.byteLength, sha256: evidence.source_sha256, parse_diagnostics: evidence.parse_diagnostics, ast_node_count: evidence.ast_node_count }, fresh_get: fetched.metadata, runtime_usable: false, backend_acceptance: false, source_persisted: false })}\n`);
  return { artifact, archived };
}

function digest(bytes: Uint8Array): string { return createHash("sha256").update(bytes).digest("hex"); }
function canonicalTree(value: unknown): string {
  if (value === null || typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
  if (typeof value === "number") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalTree).join(",")}]`;
  if (typeof value === "object") return `{${Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => `${JSON.stringify(key)}:${canonicalTree(item)}`).join(",")}}`;
  throw new Error("KLING_SOURCE_AST_CANONICALIZATION_FAILED");
}
function parseHttpDate(value: string | null): string | null { if (!value) return null; const parsed = Date.parse(value); return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null; }

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  runKlingSourceGuardCandidatesV27().catch((error: unknown) => {
    const code = error instanceof Error && /^KLING_[A-Z0-9_]{2,100}$/u.test(error.message) ? error.message : "KLING_SOURCE_GUARD_FAILED";
    process.stderr.write(`${code}\n`); process.exitCode = 1;
  });
}

function isFunctionLike(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isFunctionExpression(node) || ts.isArrowFunction(node) || ts.isMethodDeclaration(node);
}

function isSemanticLeaf(node: ts.Node): boolean {
  return ts.isIdentifier(node) || ts.isStringLiteralLike(node) || ts.isNumericLiteral(node) ||
    node.kind === ts.SyntaxKind.TrueKeyword || node.kind === ts.SyntaxKind.FalseKeyword || node.kind === ts.SyntaxKind.NullKeyword;
}

function collectAtoms(node: ts.Node): Set<string> {
  const atoms = new Set<string>();
  const visit = (child: ts.Node): void => {
    if (isSemanticLeaf(child)) atoms.add(ts.isStringLiteralLike(child) ? child.text : child.getText());
    ts.forEachChild(child, visit);
  };
  visit(node);
  return atoms;
}
