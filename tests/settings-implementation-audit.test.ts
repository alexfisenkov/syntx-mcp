import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  loadNormalizedSettingsParserGenericFormResult,
  serializeNormalizedSettingsParserGenericFormResult
} from "../src/catalog/normalized-settings-parser-generic-form-result.js";
import { loadNormalizedSettingsParserSourceBackedResult } from "../src/catalog/normalized-settings-parser-source-backed-result.js";
import {
  auditGenericImplementation,
  auditSourceBackedImplementation,
  auditStoredSettingsImplementations,
  SettingsImplementationAuditError,
  type SettingsImplementationAuditReport
} from "../tools/settings-ir/audit-stored-settings-implementations.js";
import { buildImplementationComponentRecords } from "../tools/settings-ir/generic-form-result-toolchain.js";
import { collectSourceBackedImplementationComponents } from "../tools/settings-ir/source-backed-result-toolchain.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = join(ROOT, "scripts/check-settings-implementations.mjs");
const C1A = "catalog/runtime/v3/normalized-settings-parser-source-backed-result.json";
const GENERIC = "catalog/runtime/v4/banana-generic-form-result.json";

test("current compiled C1a implementations match and a changed byte is detected without fetching", () => {
  const previousFetch = globalThis.fetch;
  let networkCalls = 0;
  globalThis.fetch = async () => { networkCalls += 1; throw new Error("network forbidden"); };
  try {
    const artifact = loadNormalizedSettingsParserSourceBackedResult();
    const components = collectSourceBackedImplementationComponents();
    assert.equal(auditSourceBackedImplementation(artifact, components).status, "MATCH");
    const altered = components.map((component) => ({ ...component, bytes: new Uint8Array(component.bytes) }));
    altered[1]!.bytes[0] = altered[1]!.bytes[0]! ^ 1;
    const result = auditSourceBackedImplementation(artifact, altered);
    assert.equal(result.status, "DRIFT");
    assert.deepEqual(result.changed_components, ["immutable-json-snapshot"]);
    assert.equal(networkCalls, 0);
  } finally { globalThis.fetch = previousFetch; }
});

test("C1a rejects wrong component names/order and malformed artifact metadata", () => {
  const artifact = loadNormalizedSettingsParserSourceBackedResult();
  const components = collectSourceBackedImplementationComponents();
  assert.throws(() => auditSourceBackedImplementation(artifact, [{ ...components[0]!, name: "wrong" }, ...components.slice(1)]), SettingsImplementationAuditError);
  assert.throws(() => auditSourceBackedImplementation(artifact, [...components].reverse()), SettingsImplementationAuditError);
  const altered = structuredClone(artifact);
  altered.toolchain.implementation_components[0]!.sha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(() => auditSourceBackedImplementation(altered, components), SettingsImplementationAuditError);
  const badAggregate = structuredClone(artifact);
  badAggregate.toolchain.implementation_set_sha256 = `sha256:${"0".repeat(64)}`;
  assert.throws(() => auditSourceBackedImplementation(badAggregate, components), SettingsImplementationAuditError);
});

test("generic audit compares exact byte counts and framed hashes; malformed names/hashes are invalid", () => {
  const artifact = loadNormalizedSettingsParserGenericFormResult("banana");
  const current = buildImplementationComponentRecords();
  assert.equal(auditGenericImplementation(artifact, current).status, "MATCH");
  for (const override of [{ bytes: current[0]!.bytes + 1 }, { sha256: `sha256:${"0".repeat(64)}` }]) {
    const changed = [{ ...current[0]!, ...override }, ...current.slice(1)];
    const result = auditGenericImplementation(artifact, changed);
    assert.equal(result.status, "DRIFT");
    assert.deepEqual(result.changed_components, ["generic-form-adapter"]);
    assert.equal(result.historical_note, null);
  }
  assert.throws(() => auditGenericImplementation(artifact, [{ ...current[0]!, name: "unknown" }, ...current.slice(1)]), SettingsImplementationAuditError);
  assert.throws(() => auditGenericImplementation(artifact, [{ ...current[0]!, sha256: "invalid" }, ...current.slice(1)]), SettingsImplementationAuditError);
  assert.throws(() => auditGenericImplementation(artifact, [...current].reverse()), SettingsImplementationAuditError);
  const malformed = structuredClone(artifact);
  malformed.toolchain.implementation_components[0]!.bytes += 1;
  assert.throws(() => auditGenericImplementation(malformed, current), SettingsImplementationAuditError);
});

test("known wan-video pair remains DRIFT; any additional changed slot loses the historical note", () => {
  const artifact = loadNormalizedSettingsParserGenericFormResult("wan-video");
  const current = buildImplementationComponentRecords();
  const known = auditGenericImplementation(artifact, current);
  assert.equal(known.status, "DRIFT");
  assert.deepEqual(known.changed_components, ["generic-form-result-toolchain"]);
  assert.match(known.historical_note!, /DEBT-042.*historical.*not reconstructed/);
  const furtherChanged = [{ ...current[0]!, bytes: current[0]!.bytes + 1 }, ...current.slice(1)];
  const unknown = auditGenericImplementation(artifact, furtherChanged);
  assert.equal(unknown.status, "DRIFT");
  assert.equal(unknown.historical_note, null);
  assert.equal(auditGenericImplementation(artifact, artifact.toolchain.implementation_components).historical_note, null);
});

test("full stored-artifact audit is offline and non-mutating, with runtime usability still false", () => {
  const before = readFileSync(join(ROOT, C1A));
  const beforeWan = readFileSync(join(ROOT, "catalog/runtime/v4/wan-video-generic-form-result.json"));
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("network forbidden"); };
  try {
    const report = auditStoredSettingsImplementations(ROOT);
    assert.equal(report.mode, "OFFLINE_COMPILED_IMPLEMENTATION_AUDIT");
    assert.equal(report.runtime_usable, false);
    assert.deepEqual(report.summary, { total: 25, matched: 24, drifted: 1 });
    assert.equal(report.artifacts.find((artifact) => artifact.artifact_id === "c1b:wan-video")?.status, "DRIFT");
    assert.deepEqual(readFileSync(join(ROOT, C1A)), before);
    assert.deepEqual(readFileSync(join(ROOT, "catalog/runtime/v4/wan-video-generic-form-result.json")), beforeWan);
    const serialized = JSON.stringify(report);
    assert.equal(serialized.includes(ROOT), false);
    assert.equal(serialized.includes("file://"), false);
  } finally { globalThis.fetch = previousFetch; }
});

test("missing, noncanonical, malformed, and mismatched-file artifacts fail safely", () => {
  withFixture((root) => {
    assert.equal(auditFixture(root).summary.drifted, 0);
    writeFileSync(join(root, GENERIC), `${readFileSync(join(root, GENERIC), "utf8")}\n`);
    assert.throws(() => auditFixture(root), SettingsImplementationAuditError);
  });
  withFixture((root) => {
    rmSync(join(root, C1A));
    assert.throws(() => auditFixture(root), SettingsImplementationAuditError);
  });
  withFixture((root) => {
    writeFileSync(join(root, GENERIC), "{invalid}");
    assert.throws(() => auditFixture(root), SettingsImplementationAuditError);
  });
  withFixture((root) => {
    cpSync(join(root, GENERIC), join(root, "catalog/runtime/v4/wrong-generic-form-result.json"));
    assert.throws(() => auditFixture(root), SettingsImplementationAuditError);
  });
});

test("disk audit accepts digit-leading form IDs allowed by the stored generic schema", () => {
  withFixture((root) => {
    const original = loadNormalizedSettingsParserGenericFormResult("banana");
    const sourcePath = original.form.source_ref.source_path;
    // Keep all source locators consistent in this synthetic, temporary fixture.
    const artifact = JSON.parse(JSON.stringify(original, (_key, value: unknown) =>
      value === sourcePath ? sourcePath.replace("banana.vue", "3d.vue") : value
    )) as typeof original;
    artifact.scope.form_id = "3d";
    artifact.form.form_id = "3d";
    writeFileSync(join(root, "catalog/runtime/v4/3d-generic-form-result.json"), serializeNormalizedSettingsParserGenericFormResult(artifact));
    const report = auditFixture(root);
    assert.deepEqual(report.summary, { total: 3, matched: 3, drifted: 0 });
    assert.equal(report.artifacts.find((entry) => entry.artifact_id === "c1b:3d")?.status, "MATCH");
  });
});

test("default collectors reject a foreign checkout instead of auditing it with this checkout's bytes", () => {
  withFixture((root) => {
    assert.throws(() => auditStoredSettingsImplementations(root), SettingsImplementationAuditError);
    assert.equal(auditFixture(root).summary.drifted, 0);
  });
});

test("CLI rejects all arguments and installed-package layouts before project import", async () => {
  const cli = await import(pathToFileURL(CLI).href);
  const directory = mkdtempSync(join(tmpdir(), "syntx-implementation-cli-test-"));
  try {
    let imports = 0;
    const errors: string[] = [];
    const options = {
      projectRoot: directory,
      importAudit: async () => { imports += 1; throw new Error("private diagnostics must not escape"); },
      writeStdout: () => assert.fail("must not write successful report"),
      writeStderr: (text: string) => errors.push(text)
    };
    for (const argv of [["--check"], ["--mode", "unknown"], ["--sync-source"], ["--confirm-source-fetch"]]) {
      assert.equal(await cli.runSettingsImplementationAuditCli(argv, options), 1);
      assert.match(errors.pop()!, /INVALID_ARGUMENT/);
    }
    assert.equal(await cli.runSettingsImplementationAuditCli([], options), 1);
    assert.match(errors.pop()!, /IMPLEMENTATION_AUDIT_REQUIRES_SOURCE_CHECKOUT/);
    assert.equal(imports, 0);
    for (const relative of [
      "tsconfig.json", "tools/settings-ir/audit-stored-settings-implementations.ts",
      "tools/settings-ir/source-backed-result-toolchain.ts", "tools/settings-ir/generic-form-result-toolchain.ts",
      "src/catalog/normalized-settings-parser-source-backed-result.ts", "src/catalog/normalized-settings-parser-generic-form-result.ts"
    ]) { mkdirSync(dirname(join(directory, relative)), { recursive: true }); writeFileSync(join(directory, relative), ""); }
    assert.equal(await cli.runSettingsImplementationAuditCli([], options), 1);
    assert.match(errors.pop()!, /IMPLEMENTATION_AUDIT_REQUIRES_PREBUILT_DIST/);
    assert.equal(imports, 0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("CLI returns 0 only for all matches, 2 for known/unknown drift, and sanitizes failures", async () => {
  const cli = await import(pathToFileURL(CLI).href);
  const real = auditStoredSettingsImplementations(ROOT);
  const outputs: string[] = [];
  const errors: string[] = [];
  const options = { projectRoot: ROOT, writeStdout: (text: string) => outputs.push(text), writeStderr: (text: string) => errors.push(text) };
  for (const report of [real, { ...real, artifacts: real.artifacts.map((artifact) => ({ ...artifact, historical_note: null })) }]) {
    assert.equal(await cli.runSettingsImplementationAuditCli([], { ...options, importAudit: async () => ({ auditStoredSettingsImplementations: () => report }) }), 2);
  }
  const matchReport: SettingsImplementationAuditReport = {
    ...real, artifacts: [real.artifacts[0]!], summary: { total: 1, matched: 1, drifted: 0 }
  };
  assert.equal(await cli.runSettingsImplementationAuditCli([], { ...options, importAudit: async () => ({ auditStoredSettingsImplementations: () => matchReport }) }), 0);
  assert.equal(await cli.runSettingsImplementationAuditCli([], { ...options, importAudit: async () => { throw new Error(`private path ${ROOT}`); } }), 1);
  assert.equal(errors.at(-1), "Settings implementation audit failed: SETTINGS_IMPLEMENTATION_AUDIT_INVALID.\n");
  assert.equal(errors.join("").includes(ROOT), false);
  assert.equal(outputs.length, 3);
});

test("fresh-process audit import and execution never fetch or self-build", () => {
  const output = execFileSync(process.execPath, ["--input-type=module", "-e", `
    globalThis.fetch = async () => { throw new Error('NETWORK_FORBIDDEN'); };
    const { runSettingsImplementationAuditCli } = await import(${JSON.stringify(pathToFileURL(CLI).href)});
    const code = await runSettingsImplementationAuditCli([], { projectRoot: ${JSON.stringify(ROOT)} });
    if (code !== 2) throw new Error('EXPECTED_KNOWN_DRIFT');
  `], { encoding: "utf8", cwd: tmpdir() });
  const report = JSON.parse(output) as SettingsImplementationAuditReport;
  assert.equal(report.summary.drifted, 1);
  assert.equal(report.runtime_usable, false);
});

test("symlink CLI execution runs the audit, while import remains side-effect-free", () => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-implementation-symlink-test-"));
  try {
    const linkedCli = join(directory, "audit-link.mjs");
    symlinkSync(CLI, linkedCli);
    const direct = spawnSync(process.execPath, [linkedCli], { encoding: "utf8", cwd: directory });
    assert.equal(direct.status, 2);
    assert.equal(direct.stderr, "");
    assert.equal((JSON.parse(direct.stdout) as SettingsImplementationAuditReport).summary.drifted, 1);
    const imported = spawnSync(process.execPath, ["--input-type=module", "-e", `await import(${JSON.stringify(pathToFileURL(linkedCli).href)});`], { encoding: "utf8", cwd: directory });
    assert.equal(imported.status, 0);
    assert.equal(imported.stdout, "");
    assert.equal(imported.stderr, "");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

function auditFixture(root: string): SettingsImplementationAuditReport {
  return auditStoredSettingsImplementations(root, {
    sourceBacked: collectSourceBackedImplementationComponents(),
    generic: buildImplementationComponentRecords()
  });
}

function withFixture(work: (root: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "syntx-implementation-audit-test-"));
  try {
    for (const relative of [
      "catalog/v1/official-public-api.json", "catalog/runtime/v1/settings-source-inventory.json",
      "catalog/runtime/v1/normalized-settings-parser-canary.json",
      "catalog/runtime/v2/normalized-settings-parser-census-manifest.json", C1A, GENERIC
    ]) {
      mkdirSync(dirname(join(directory, relative)), { recursive: true });
      cpSync(join(ROOT, relative), join(directory, relative));
    }
    work(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
