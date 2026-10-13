import { createHash } from "node:crypto";
import posix from "node:path/posix";
import { z } from "zod/v4";
import {
  settingsSourceInventorySchema,
  type SettingsSourceInventory
} from "../../../src/catalog/settings-source-inventory.js";
import {
  compileStaticSfcImportSurface,
  type StaticSfcImport
} from "./static-sfc-import-surface.js";

export const STATIC_SFC_HELPER_GRAPH_LIMITS = Object.freeze({
  maxSourceBytes: 2 * 1024 * 1024,
  maxSourcePathBytes: 2048,
  maxNodes: 512,
  maxUnresolvedImports: 512,
  maxInventoryArtifacts: 1_000,
  maxDeclaredSourcesPerMap: 5_000
});

const SETTINGS_PREFIX = "/src/components/chat/forms/settings/";
const FORM_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;
const SHA256 = /^sha256:[a-f0-9]{64}$/u;

export interface StaticSfcHelperGraphOptions {
  readonly formId: string;
  readonly providerSourcePath: string;
  readonly providerSource: string | Uint8Array;
  readonly inventory: SettingsSourceInventory;
}

export interface StaticSfcHelperGraphNode {
  readonly module_name: string;
  readonly source_path: string;
  readonly source_content_sha256: string;
  readonly relation: "DIRECT_IMPORT" | "PROVIDER_ROOT";
}

export interface StaticSfcHelperGraphResult {
  readonly profile: "STATIC_SFC_HELPER_GRAPH_V1";
  readonly form_id: string;
  readonly provider_source_sha256: string;
  readonly nodes: readonly StaticSfcHelperGraphNode[];
  readonly unresolved_imports: readonly StaticSfcImport[];
  readonly blockers: readonly string[];
  readonly runtime_usable: false;
  readonly vendor_code_executed: false;
  readonly source_persisted: false;
}

export class StaticSfcHelperGraphError extends Error {
  constructor(readonly code: string) {
    super("The static SFC helper graph could not be derived safely.");
    this.name = "StaticSfcHelperGraphError";
  }
}

/**
 * Resolves only the provider's direct relative import surface against source
 * map declarations already present in a validated inventory. It deliberately
 * does not fetch, execute, or return vendor source.
 */
export function deriveStaticSfcHelperGraph(
  options: StaticSfcHelperGraphOptions
): StaticSfcHelperGraphResult {
  try {
    validateOptions(options);
    const inventory = settingsSourceInventorySchema.parse(options.inventory);
    if (inventory.source_artifacts.length > STATIC_SFC_HELPER_GRAPH_LIMITS.maxInventoryArtifacts) {
      fail("INVENTORY_ARTIFACT_LIMIT_EXCEEDED");
    }

    const providerPath = canonicalProviderPath(options.formId, options.providerSourcePath);
    const provider = findProviderSource(inventory, options.formId, providerPath);
    const providerSha = hashUtf8(options.providerSource);
    if (provider.source_content_sha256 !== providerSha) fail("PROVIDER_SOURCE_DRIFT");

    const surface = compileStaticSfcImportSurface({
      source: options.providerSource,
      sourcePath: providerPath
    });
    const nodes: StaticSfcHelperGraphNode[] = [{
      module_name: provider.module_name,
      source_path: providerPath,
      source_content_sha256: providerSha,
      relation: "PROVIDER_ROOT"
    }];
    const unresolved: StaticSfcImport[] = [];
    const blockers = new Set(surface.blockers.filter((code) => code !== "IMPORT_GRAPH_NOT_RESOLVED"));
    const helperSources = collectHelperSources(inventory);
    const seenNodes = new Set<string>([`${provider.module_name}\u0000${providerPath}`]);
    for (const imported of surface.imports) {
      const resolution = resolveImport(imported, providerPath, helperSources);
      if (resolution.kind === "unresolved") {
        unresolved.push(imported);
        blockers.add(resolution.blocker);
        continue;
      }
      const key = `${resolution.module_name}\u0000${resolution.source_path}`;
      if (seenNodes.has(key)) {
        blockers.add("HELPER_IMPORT_DUPLICATE");
        unresolved.push(imported);
        continue;
      }
      seenNodes.add(key);
      nodes.push({
        module_name: resolution.module_name,
        source_path: resolution.source_path,
        source_content_sha256: resolution.source_content_sha256,
        relation: "DIRECT_IMPORT"
      });
      if (nodes.length > STATIC_SFC_HELPER_GRAPH_LIMITS.maxNodes) fail("NODE_LIMIT_EXCEEDED");
    }
    if (unresolved.length > STATIC_SFC_HELPER_GRAPH_LIMITS.maxUnresolvedImports) fail("UNRESOLVED_IMPORT_LIMIT_EXCEEDED");
    return {
      profile: "STATIC_SFC_HELPER_GRAPH_V1",
      form_id: options.formId,
      provider_source_sha256: providerSha,
      nodes,
      unresolved_imports: unresolved,
      blockers: [...blockers].sort(),
      runtime_usable: false,
      vendor_code_executed: false,
      source_persisted: false
    };
  } catch (error) {
    if (error instanceof StaticSfcHelperGraphError) throw error;
    if (error instanceof z.ZodError) throw new StaticSfcHelperGraphError("INVENTORY_INVALID");
    throw error;
  }
}

interface DeclaredHelperSource {
  module_name: string;
  source_path: string;
  source_content_sha256: string;
}

function validateOptions(options: StaticSfcHelperGraphOptions): void {
  if (!options || typeof options !== "object" || !FORM_ID.test(options.formId) || options.formId.length > 160 ||
      (typeof options.providerSource !== "string" && !(options.providerSource instanceof Uint8Array)) ||
      typeof options.providerSourcePath !== "string" || Buffer.byteLength(options.providerSourcePath, "utf8") > STATIC_SFC_HELPER_GRAPH_LIMITS.maxSourcePathBytes) {
    fail("OPTIONS_INVALID");
  }
  const bytes = typeof options.providerSource === "string" ? Buffer.byteLength(options.providerSource, "utf8") : options.providerSource.byteLength;
  if (bytes > STATIC_SFC_HELPER_GRAPH_LIMITS.maxSourceBytes) fail("SOURCE_TOO_LARGE");
}

function canonicalProviderPath(formId: string, sourcePath: string): string {
  const expected = `${SETTINGS_PREFIX}${formId}.vue`;
  if (sourcePath !== expected) fail("PROVIDER_SOURCE_PATH_INVALID");
  return expected;
}

function findProviderSource(inventory: SettingsSourceInventory, formId: string, path: string): { module_name: string; source_content_sha256: string } {
  const matches: { module_name: string; source_content_sha256: string }[] = [];
  for (const artifact of inventory.source_artifacts) {
    if (artifact.role !== "PROVIDER_FORM" || artifact.form_id !== formId || artifact.source_map === null) continue;
    for (const source of artifact.source_map.settings_sources) {
      if (source.source_path === path) matches.push({ module_name: artifact.module_name, source_content_sha256: source.source_content_sha256 });
    }
  }
  if (matches.length !== 1) fail(matches.length === 0 ? "PROVIDER_SOURCE_NOT_DECLARED" : "PROVIDER_SOURCE_AMBIGUOUS");
  return matches[0]!;
}

function collectHelperSources(inventory: SettingsSourceInventory): Map<string, DeclaredHelperSource[]> {
  const byPath = new Map<string, DeclaredHelperSource[]>();
  for (const artifact of inventory.source_artifacts) {
    if (artifact.role !== "DIRECT_SETTINGS_HELPER" || artifact.form_id !== null || artifact.source_map === null) continue;
    if (artifact.source_map.settings_sources.length > STATIC_SFC_HELPER_GRAPH_LIMITS.maxDeclaredSourcesPerMap) fail("DECLARED_SOURCE_LIMIT_EXCEEDED");
    for (const source of artifact.source_map.settings_sources) {
      const list = byPath.get(source.source_path) ?? [];
      list.push({ module_name: artifact.module_name, source_path: source.source_path, source_content_sha256: source.source_content_sha256 });
      byPath.set(source.source_path, list);
    }
  }
  return byPath;
}

function resolveImport(imported: StaticSfcImport, providerPath: string, helpers: Map<string, DeclaredHelperSource[]>): { kind: "resolved"; module_name: string; source_path: string; source_content_sha256: string } | { kind: "unresolved"; blocker: string } {
  const specifier = imported.specifier;
  if (!specifier.startsWith(".")) return { kind: "unresolved", blocker: specifier.startsWith("/") ? "IMPORT_ABSOLUTE_UNRESOLVED" : /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier) ? "IMPORT_REMOTE_UNRESOLVED" : "IMPORT_NON_RELATIVE_UNRESOLVED" };
  if (specifier.includes("\\") || specifier.includes("\0") || specifier.includes("?") || specifier.includes("#")) return { kind: "unresolved", blocker: "IMPORT_UNSAFE_SPECIFIER" };
  const segments = specifier.split("/");
  if (segments.some((part) => part === "__proto__" || part === "prototype" || part === "constructor")) return { kind: "unresolved", blocker: "IMPORT_PROTOTYPE_PATH_REJECTED" };
  const resolved = posix.normalize(posix.join(posix.dirname(providerPath), specifier));
  if (!resolved.startsWith(SETTINGS_PREFIX) || resolved === SETTINGS_PREFIX || resolved.endsWith("/")) return { kind: "unresolved", blocker: "IMPORT_PATH_ESCAPES_SETTINGS_ROOT" };
  const matches = helpers.get(resolved) ?? [];
  if (matches.length === 0) return { kind: "unresolved", blocker: "IMPORT_HELPER_NOT_DECLARED" };
  if (matches.length !== 1) return { kind: "unresolved", blocker: "IMPORT_HELPER_AMBIGUOUS" };
  const match = matches[0]!;
  if (!SHA256.test(match.source_content_sha256)) return { kind: "unresolved", blocker: "HELPER_SOURCE_IDENTITY_INVALID" };
  return { kind: "resolved", ...match };
}

function hashUtf8(source: string | Uint8Array): string {
  const bytes = typeof source === "string" ? Buffer.from(source, "utf8") : Buffer.from(source);
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { fail("SOURCE_UTF8_INVALID"); }
  if (Buffer.from(text!, "utf8").compare(bytes) !== 0) fail("SOURCE_UTF8_INVALID");
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
}

function fail(code: string): never { throw new StaticSfcHelperGraphError(code); }
