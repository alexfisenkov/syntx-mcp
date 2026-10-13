import { createHash } from "node:crypto";
import { readFileSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadNormalizedSettingsParserCanary
} from "../../src/catalog/normalized-settings-parser-canary.js";
import {
  loadNormalizedSettingsParserCensusManifest
} from "../../src/catalog/normalized-settings-parser-census-manifest.js";
import {
  GENERIC_IMPLEMENTATION_COMPONENT_NAMES,
  loadNormalizedSettingsParserGenericFormResult,
  normalizedSettingsParserGenericFormResultSchema,
  serializeNormalizedSettingsParserGenericFormResult
} from "../../src/catalog/normalized-settings-parser-generic-form-result.js";
import {
  SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES,
  assertNormalizedSettingsParserSourceBackedResultMatchesImplementations,
  loadNormalizedSettingsParserSourceBackedResult,
  normalizedSettingsParserSourceBackedResultSchema,
  serializeNormalizedSettingsParserSourceBackedResult,
  type SourceBackedImplementationComponentInput
} from "../../src/catalog/normalized-settings-parser-source-backed-result.js";
import { loadSettingsSourceInventory } from "../../src/catalog/settings-source-inventory.js";
import {
  loadSyntxPublicCatalogSnapshot,
  sha256CanonicalPayload
} from "../../src/catalog/syntx-public-catalog.js";
import { buildImplementationComponentRecords } from "./generic-form-result-toolchain.js";
import { collectSourceBackedImplementationComponents } from "./source-backed-result-toolchain.js";

export interface SettingsImplementationComponentRecord {
  readonly name: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface SettingsImplementationArtifactAudit {
  readonly artifact_id: string;
  readonly status: "MATCH" | "DRIFT";
  readonly changed_components: readonly string[];
  readonly historical_note: string | null;
}

export interface SettingsImplementationAuditReport {
  readonly mode: "OFFLINE_COMPILED_IMPLEMENTATION_AUDIT";
  readonly runtime_usable: false;
  readonly artifacts: readonly SettingsImplementationArtifactAudit[];
  readonly summary: { total: number; matched: number; drifted: number };
}

export interface SettingsImplementationAuditComponents {
  /** Explicit test seam; these components do not attest the target checkout's files. */
  readonly sourceBacked: readonly SourceBackedImplementationComponentInput[];
  readonly generic: readonly SettingsImplementationComponentRecord[];
}

export class SettingsImplementationAuditError extends Error {
  readonly code = "SETTINGS_IMPLEMENTATION_AUDIT_INVALID";
  constructor() {
    super("The offline implementation audit inputs could not be validated.");
    this.name = "SettingsImplementationAuditError";
  }
}

const KNOWN_WAN_RECORDED_SET = "sha256:9b0b7cb7ffd9069037034f8daf8e31792a527e04b63bea42a18845e5a097c279";
const KNOWN_WAN_CURRENT_SET = "sha256:ea5434357a0903bf5c99008ef0d889db3e1c87db2e4ece9f51f397aab3006395";

/** Pure comparison; it never calls the source loader or compiler. */
export function auditSourceBackedImplementation(
  artifact: unknown,
  components: readonly SourceBackedImplementationComponentInput[]
): SettingsImplementationArtifactAudit {
  const parsed = normalizedSettingsParserSourceBackedResultSchema.safeParse(artifact);
  if (!parsed.success || !Array.isArray(components) ||
      components.length !== SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES.length) invalid();
  if (parsed.data.toolchain.implementation_set_sha256 !==
      sha256CanonicalPayload(parsed.data.toolchain.implementation_components)) invalid();
  const records = components.map((component, index) => {
    if (!component || component.name !== SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES[index] ||
        !(component.bytes instanceof Uint8Array)) invalid();
    return {
      name: component.name,
      bytes: component.bytes.byteLength,
      sha256: `sha256:${createHash("sha256").update(component.bytes).digest("hex")}`
    };
  });
  validateRecords(records, SOURCE_BACKED_IMPLEMENTATION_COMPONENT_NAMES);
  const changed = changedComponents(parsed.data.toolchain.implementation_components, records);
  try {
    assertNormalizedSettingsParserSourceBackedResultMatchesImplementations(parsed.data, components);
  } catch (error) {
    if (!hasCode(error, "IMPLEMENTATION_RELATIONSHIP_INVALID")) invalid();
    return {
      artifact_id: "c1a:banana",
      status: "DRIFT",
      changed_components: changed.length > 0 ? changed : ["normalized-compiler"],
      historical_note: null
    };
  }
  return { artifact_id: "c1a:banana", status: "MATCH", changed_components: [], historical_note: null };
}

/** Compare metadata produced by the existing byte/framing collector. */
export function auditGenericImplementation(
  artifact: unknown,
  current: readonly SettingsImplementationComponentRecord[]
): SettingsImplementationArtifactAudit {
  const parsed = normalizedSettingsParserGenericFormResultSchema.safeParse(artifact);
  if (!parsed.success) invalid();
  validateRecords(current, GENERIC_IMPLEMENTATION_COMPONENT_NAMES);
  const recorded = parsed.data.toolchain.implementation_components;
  // The existing generic schema validates hash shape, not this relationship.
  // Reject internally inconsistent stored evidence before classifying drift.
  if (parsed.data.toolchain.implementation_set_sha256 !== sha256CanonicalPayload(recorded)) invalid();
  const changed = changedComponents(recorded, current);
  const currentHash = sha256CanonicalPayload(current);
  const matches = changed.length === 0 && parsed.data.toolchain.implementation_set_sha256 === currentHash;
  const knownHistoricalDrift = !matches && parsed.data.scope.form_id === "wan-video" &&
    parsed.data.toolchain.implementation_set_sha256 === KNOWN_WAN_RECORDED_SET &&
    currentHash === KNOWN_WAN_CURRENT_SET && changed.length === 1 &&
    changed[0] === "generic-form-result-toolchain";
  return {
    artifact_id: `c1b:${parsed.data.scope.form_id}`,
    status: matches ? "MATCH" : "DRIFT",
    changed_components: changed,
    historical_note: knownHistoricalDrift
      ? "DEBT-042: documented historical toolchain drift; not reconstructed or revalidated."
      : null
  };
}

/**
 * Read-only checkout audit of prebuilt implementation bytes, not TypeScript
 * source freshness, compilation semantics, or backend support.
 * Imports of the existing toolchains perform no source fetch or compilation;
 * only their local implementation-byte collectors are invoked here.
 * Default collectors are module-relative, so the target must be this compiled
 * module's own checkout. Injected components are an explicit fixture-test seam.
 */
export function auditStoredSettingsImplementations(
  projectRoot: string,
  injectedComponents?: SettingsImplementationAuditComponents
): SettingsImplementationAuditReport {
  try {
    if (injectedComponents === undefined &&
        realpathSync(projectRoot) !== realpathSync(fileURLToPath(new URL("../../../", import.meta.url)))) invalid();
    const components = injectedComponents ?? {
      sourceBacked: collectSourceBackedImplementationComponents(),
      generic: buildImplementationComponentRecords()
    };
    const publicCatalog = loadSyntxPublicCatalogSnapshot(join(projectRoot, "catalog/v1/official-public-api.json"));
    const inventory = loadSettingsSourceInventory(join(projectRoot, "catalog/runtime/v1/settings-source-inventory.json"), publicCatalog);
    const censusPath = join(projectRoot, "catalog/runtime/v2/normalized-settings-parser-census-manifest.json");
    const parserPath = join(projectRoot, "catalog/runtime/v1/normalized-settings-parser-canary.json");
    const sources = {
      publicCatalog,
      inventory,
      censusManifest: loadNormalizedSettingsParserCensusManifest({ path: censusPath, publicCatalog, inventory }),
      censusArtifactText: readFileSync(censusPath, "utf8"),
      parserCanary: loadNormalizedSettingsParserCanary({ path: parserPath, publicCatalog, inventory }),
      parserArtifactText: readFileSync(parserPath, "utf8")
    };
    const c1aPath = join(projectRoot, "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json");
    const c1a = loadNormalizedSettingsParserSourceBackedResult({ path: c1aPath, ...sources });
    if (readFileSync(c1aPath, "utf8") !== serializeNormalizedSettingsParserSourceBackedResult(c1a, sources)) invalid();
    const artifacts: SettingsImplementationArtifactAudit[] = [auditSourceBackedImplementation(c1a, components.sourceBacked)];
    const genericDirectory = join(projectRoot, "catalog/runtime/v4");
    const files = readdirSync(genericDirectory, { withFileTypes: true })
      .filter((entry) => entry.name.endsWith("-generic-form-result.json"))
      .sort((left, right) => left.name.localeCompare(right.name));
    if (files.length === 0) invalid();
    for (const file of files) {
      const match = /^([a-z0-9][a-z0-9-]{0,63})-generic-form-result\.json$/u.exec(file.name);
      if (!file.isFile() || !match?.[1]) invalid();
      const path = join(genericDirectory, file.name);
      const artifact = loadNormalizedSettingsParserGenericFormResult(match[1], { path });
      if (readFileSync(path, "utf8") !== serializeNormalizedSettingsParserGenericFormResult(artifact)) invalid();
      artifacts.push(auditGenericImplementation(artifact, components.generic));
    }
    const drifted = artifacts.filter((artifact) => artifact.status === "DRIFT").length;
    return {
      mode: "OFFLINE_COMPILED_IMPLEMENTATION_AUDIT",
      runtime_usable: false,
      artifacts,
      summary: { total: artifacts.length, matched: artifacts.length - drifted, drifted }
    };
  } catch {
    return invalid();
  }
}

function validateRecords(
  records: readonly SettingsImplementationComponentRecord[],
  names: readonly string[]
): void {
  if (!Array.isArray(records) || records.length !== names.length) invalid();
  let total = 0;
  records.forEach((record, index) => {
    if (!record || record.name !== names[index] ||
        !Number.isSafeInteger(record.bytes) || record.bytes <= 0 || record.bytes > 16 * 1024 * 1024 ||
        typeof record.sha256 !== "string" || !/^sha256:[a-f0-9]{64}$/.test(record.sha256)) invalid();
    total += record.bytes;
  });
  if (total > 32 * 1024 * 1024) invalid();
}

function changedComponents(
  recorded: readonly SettingsImplementationComponentRecord[],
  current: readonly SettingsImplementationComponentRecord[]
): string[] {
  return current.filter((component, index) => {
    const prior = recorded[index];
    return prior?.name !== component.name || prior.bytes !== component.bytes || prior.sha256 !== component.sha256;
  }).map((component) => component.name);
}

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function invalid(): never { throw new SettingsImplementationAuditError(); }
