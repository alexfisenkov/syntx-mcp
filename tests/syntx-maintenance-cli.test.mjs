import assert from "node:assert/strict";
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { main, parseArguments, SyntxMaintenanceCliError } from "../scripts/syntx-maintenance.mjs";

const versionA = `sha256-${"a".repeat(64)}.json`;
const versionB = `sha256-${"b".repeat(64)}.json`;
const publicVersion = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const publicDriftVersion = "sha256-c6fdcc522def8f6f4ef2c172d23822164f0124b29bb5fe86e2b5dce5c54b9fbc.json";
const settingsVersion = "sha256-00f46710febbeffcaa99d49d3c213aca305706921607db2269f04c5e33381d61.json";
const catalogDirectory = fileURLToPath(new URL("../catalog/", import.meta.url));

test("maintenance CLI defaults to offline help", () => {
  assert.deepEqual(parseArguments([]), { kind: "help" });
  assert.deepEqual(parseArguments(["--help"]), { kind: "help" });
});

test("default/help mode does not load runtime dependencies or fetch", async () => {
  let runtimeReads = 0;
  let fetchCalls = 0;
  const output = [];
  const runtime = new Proxy({}, { get() { runtimeReads += 1; throw new Error("runtime must remain unloaded"); } });
  const result = await main([], {
    runtime,
    fetchImpl: async () => { fetchCalls += 1; throw new Error("network must remain unused"); },
    writeStdout: (value) => output.push(value)
  });
  assert.equal(result.status, "HELP");
  assert.equal(runtimeReads, 0);
  assert.equal(fetchCalls, 0);
  assert.match(output.join(""), /Offline compare never fetches/u);
});

test("CLI parse errors are named and never echo malformed version arguments", () => {
  const scriptPath = fileURLToPath(new URL("../scripts/syntx-maintenance.mjs", import.meta.url));
  const result = spawnSync(process.execPath, [
    scriptPath,
    "--compare",
    "--baseline-public",
    `${versionA}\nprivate-argument-fragment`,
    "--candidate-public",
    versionB
  ], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "MAINTENANCE_ARGUMENTS_INVALID\n");
  assert.equal(result.stderr.includes("private-argument-fragment"), false);
});

test("offline compare requires exact public versions and paired settings versions", () => {
  assert.deepEqual(
    parseArguments([
      "--compare",
      "--baseline-public",
      versionA,
      "--candidate-public",
      versionB,
      "--baseline-settings",
      versionA,
      "--candidate-settings",
      versionB,
      "--catalog-directory",
      "/trusted/catalog"
    ]),
    {
      kind: "compare",
      baselinePublic: versionA,
      candidatePublic: versionB,
      baselineSettings: versionA,
      candidateSettings: versionB,
      catalogDirectory: "/trusted/catalog"
    }
  );
});

test("public probe is a distinct explicitly confirmed mode", () => {
  assert.deepEqual(
    parseArguments([
      "--probe-public",
      "--baseline-public",
      versionA,
      "--confirm-source-fetch"
    ]),
    { kind: "probe-public", baselinePublic: versionA }
  );
});

test("plan-audit accepts only paired archived sources and an optional checkpoint path", () => {
  assert.deepEqual(parseArguments([
    "--plan-audit",
    "--baseline-public", versionA,
    "--candidate-public", versionB,
    "--baseline-settings", versionA,
    "--candidate-settings", versionB,
    "--checkpoint", ".private/audit.json",
    "--catalog-directory", "/trusted/catalog"
  ]), {
    kind: "plan-audit",
    baselinePublic: versionA,
    candidatePublic: versionB,
    baselineSettings: versionA,
    candidateSettings: versionB,
    checkpointPath: ".private/audit.json",
    catalogDirectory: "/trusted/catalog"
  });
  for (const input of [
    ["--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB, "--baseline-settings", versionA],
    ["--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB, "--probe-public"],
    ["--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB, "--checkpoint", "../outside.json"]
  ]) {
    assert.throws(() => parseArguments(input), { code: "MAINTENANCE_ARGUMENTS_INVALID" });
  }
});

test("per-control walk is an optional plan-audit extension requiring paired settings and its own checkpoint flag", () => {
  assert.deepEqual(parseArguments([
    "--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB,
    "--baseline-settings", settingsVersion, "--candidate-settings", settingsVersion,
    "--control-walk"
  ]), {
    kind: "plan-audit", baselinePublic: versionA, candidatePublic: versionB,
    baselineSettings: settingsVersion, candidateSettings: settingsVersion,
    controlWalk: true
  });
  assert.deepEqual(parseArguments([
    "--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB,
    "--baseline-settings", settingsVersion, "--candidate-settings", settingsVersion,
    "--control-walk", "--control-checkpoint", ".private/control-walk.json"
  ]), {
    kind: "plan-audit", baselinePublic: versionA, candidatePublic: versionB,
    baselineSettings: settingsVersion, candidateSettings: settingsVersion,
    controlWalk: true, controlCheckpointPath: ".private/control-walk.json"
  });
  for (const input of [
    ["--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB, "--control-walk"],
    ["--plan-audit", "--baseline-public", versionA, "--candidate-public", versionB,
      "--baseline-settings", settingsVersion, "--candidate-settings", settingsVersion,
      "--control-checkpoint", ".private/control-walk.json"],
    ["--compare", "--baseline-public", versionA, "--candidate-public", versionB, "--control-walk"]
  ]) assert.throws(() => parseArguments(input), { code: "MAINTENANCE_ARGUMENTS_INVALID" });
});

test("plan-audit uses real archives offline and returns a checkpoint template without writing it", async () => {
  const before = await catalogState();
  let fetchCalls = 0;
  const output = [];
  const result = await main([
    "--plan-audit",
    "--baseline-public", publicVersion,
    "--candidate-public", publicDriftVersion,
    "--catalog-directory", catalogDirectory
  ], {
    ...(await sourceRuntimeOption()),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("network must remain unused"); },
    writeStdout: (value) => output.push(value)
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(fetchCalls, 0);
  assert.equal(result.operation, "INCREMENTAL_AUDIT_PLAN");
  assert.equal(parsed.plan.census.total_models, parsed.plan.census.models.length);
  assert.equal(parsed.plan.census.models.length, parsed.plan.report.candidate.public.counts.models);
  assert.equal(parsed.plan.checkpoint_template.schema_version, "1.0.0");
  assert.equal(parsed.plan.coverage.account_access, "NOT_CHECKED");
  assert.equal(JSON.stringify(parsed).includes(catalogDirectory), false);
  assert.equal(await catalogState(), before);
});

test("opt-in control walk emits safe per-control rows and resumes through the bounded checkpoint reader", async () => {
  const before = await catalogState();
  const directory = mkdtempSync(join(tmpdir(), "syntx-control-walk-"));
  const checkpointPath = join(directory, "control-walk.json");
  const symlinkPath = join(directory, "control-walk-link.json");
  const oversizedObservationPath = join(directory, "control-walk-4001.json");
  const baseArgs = [
    "--plan-audit", "--baseline-public", publicVersion, "--candidate-public", publicVersion,
    "--baseline-settings", settingsVersion, "--candidate-settings", settingsVersion, "--control-walk",
    "--catalog-directory", catalogDirectory
  ];
  try {
    let fetchCalls = 0;
    const output = [];
    const initial = await main(baseArgs, {
      ...(await sourceRuntimeOption()),
      fetchImpl: async () => { fetchCalls += 1; throw new Error("network must remain unused"); },
      writeStdout: (value) => output.push(value)
    });
    const parsed = JSON.parse(output.join(""));
    assert.equal(fetchCalls, 0);
    assert.equal(parsed.operation, "INCREMENTAL_AUDIT_PLAN");
    assert.equal(parsed.control_walk.operation, "PER_CONTROL_SOURCE_WALK");
    assert.equal(parsed.control_walk.models.length, parsed.plan.census.total_models);
    const row = parsed.control_walk.controls.find((item) => item.model_id === "banana-2.1" && item.control_key === "model_type");
    assert.deepEqual(row.origins, ["FORM_MODEL_VALUE", "PAYLOAD_FIELD"]);
    assert.equal(row.status, "NOT_VISITED");
    assert.equal(JSON.stringify(parsed).includes("image/png"), false);
    assert.equal(JSON.stringify(parsed).includes(catalogDirectory), false);
    assert.equal(initial.control_walk.checkpoint_template.schema_version, "1.0.0");

    const checkpoint = {
      ...initial.control_walk.checkpoint_template,
      observations: [{ control_id: row.control_id, fingerprint: row.fingerprint, status: "OBSERVED" }]
    };
    writeFileSync(checkpointPath, JSON.stringify(checkpoint));
    const resumedOutput = [];
    const resumed = await main([...baseArgs, "--control-checkpoint", checkpointPath], {
      ...(await sourceRuntimeOption()),
      fetchImpl: async () => { fetchCalls += 1; throw new Error("network must remain unused"); },
      writeStdout: (value) => resumedOutput.push(value)
    });
    assert.equal(resumed.control_walk.checkpoint_resume.status, "EXACT_SOURCE");
    assert.equal(resumed.control_walk.controls.find((item) => item.control_id === row.control_id)?.status, "OBSERVED");
    assert.equal(fetchCalls, 0);

    symlinkSync(checkpointPath, symlinkPath);
    await assert.rejects(main([...baseArgs, "--control-checkpoint", symlinkPath], {
      ...(await sourceRuntimeOption())
    }), { code: "MAINTENANCE_CHECKPOINT_INVALID" });
    const tooManyObservations = Array.from({ length: 4_001 }, (_, index) => ({
      control_id: "ctl_" + index.toString(16).padStart(32, "0"),
      fingerprint: "sha256:" + "a".repeat(64), status: "OBSERVED"
    }));
    writeFileSync(oversizedObservationPath, JSON.stringify({
      ...initial.control_walk.checkpoint_template, observations: tooManyObservations
    }));
    await assert.rejects(main([...baseArgs, "--control-checkpoint", oversizedObservationPath], {
      ...(await sourceRuntimeOption())
    }), { code: "MAINTENANCE_CONTROL_CHECKPOINT_INVALID" });
    assert.equal(await catalogState(), before);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("plan-audit rejects checkpoint symlinks, invalid UTF-8, and oversized files without path details", async () => {
  const directory = mkdtempSync(join(tmpdir(), "syntx-audit-checkpoint-"));
  const regular = join(directory, "regular.json");
  const link = join(directory, "link.json");
  const invalidUtf8 = join(directory, "invalid-utf8.json");
  const oversized = join(directory, "oversized.json");
  writeFileSync(regular, "{}");
  symlinkSync(regular, link);
  writeFileSync(invalidUtf8, Buffer.from([0xff, 0xfe]));
  writeFileSync(oversized, Buffer.alloc(1024 * 1024 + 1, 0x20));
  try {
    for (const checkpointPath of [link, invalidUtf8, oversized]) {
      await assert.rejects(main([
        "--plan-audit", "--baseline-public", publicVersion,
        "--candidate-public", publicVersion, "--checkpoint", checkpointPath,
        "--catalog-directory", catalogDirectory
      ], { ...(await sourceRuntimeOption()) }), (error) => {
        assert.equal(error.code, "MAINTENANCE_CHECKPOINT_INVALID");
        assert.equal(error.message.includes(directory), false);
        return true;
      });
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("invalid, incomplete, duplicate, and mixed mode flags fail closed", () => {
  const invalidInputs = [
    ["--compare"],
    ["--compare", "--baseline-public", versionA],
    ["--compare", "--baseline-public", versionA, "--candidate-public", versionB, "--baseline-settings", versionA],
    ["--compare", "--baseline-public", "../public.json", "--candidate-public", versionB],
    ["--compare", "--baseline-public", `${versionA}\n`, "--candidate-public", versionB],
    ["--compare", "--baseline-public", versionA, "--candidate-public", versionB, "--baseline-public", versionB],
    ["--compare", "--baseline-public", versionA, "--candidate-public", versionB, "--confirm-source-fetch"],
    ["--probe-public", "--baseline-public", versionA],
    ["--probe-public", "--baseline-public", versionA, "--confirm-source-fetch", "--candidate-public", versionB],
    ["--compare", "--baseline-public", versionA, "--candidate-public", versionB, "--unknown-private-value"]
  ];
  for (const input of invalidInputs) {
    assert.throws(() => parseArguments(input), { code: "MAINTENANCE_ARGUMENTS_INVALID" });
  }
});

test("offline compare loads exact archives through the real report engine and does not fetch or write", async () => {
  const catalog = await loadCatalogModules();
  const { loadPublicCatalogVersion, loadMaplessSettingsInventoryVersion } = catalog;
  const publicSnapshot = loadPublicCatalogVersion(publicVersion);
  const settings = loadMaplessSettingsInventoryVersion(settingsVersion);
  assert.equal(settings.public_catalog.version, publicVersion);
  const before = await catalogState();
  let fetchCalls = 0;
  const output = [];
  const result = await main([
    "--compare",
    "--baseline-public", publicVersion,
    "--candidate-public", publicVersion,
    "--baseline-settings", settingsVersion,
    "--candidate-settings", settingsVersion,
    "--catalog-directory", catalogDirectory
  ], {
    ...(await sourceRuntimeOption()),
    fetchImpl: async () => { fetchCalls += 1; throw new Error("network must remain unused"); },
    writeStdout: (value) => output.push(value)
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(fetchCalls, 0);
  assert.equal(result.operation, "OFFLINE_COMPARE");
  assert.equal(parsed.report.status, "COMPARED");
  assert.deepEqual(parsed.report.coverage, {
    public_catalog: "COMPARED",
    settings_inventory: "COMPARED",
    account_availability: "NOT_CHECKED",
    rendered_ui: "NOT_CHECKED",
    provider_acceptance: "NOT_CHECKED"
  });
  assert.equal(parsed.report.automatic_runtime_promotion, false);
  assert.equal(parsed.report.paid_operations, false);
  assert.equal(parsed.report.baseline.public.counts.models, publicSnapshot.models.length);
  assert.equal(parsed.baseline_public_version, publicVersion);
  assert.equal(parsed.candidate_settings_version, settingsVersion);
  assert.equal(await catalogState(), before);
  assert.equal(JSON.stringify(parsed).includes(catalogDirectory), false);
});

test("offline compare preserves source-only drift and rejects settings bound to another public snapshot", async () => {
  const { loadPublicCatalogVersion } = await loadCatalogModules();
  const base = loadPublicCatalogVersion(publicVersion);
  const drift = loadPublicCatalogVersion(publicDriftVersion);
  assert.equal(base.models.length, drift.models.length);
  assert.equal(base.sources.models.canonical_sha256 === drift.sources.models.canonical_sha256, false);

  const output = [];
  const compared = await main([
    "--compare",
    "--baseline-public", publicVersion,
    "--candidate-public", publicDriftVersion
  ], { ...(await sourceRuntimeOption()), writeStdout: (value) => output.push(value) });
  assert.equal(compared.report.public_source_hashes.source_hash_only_drift, true);
  assert.equal(compared.report.public_source_hashes.proof_revalidation_required, true);
  assert.ok(compared.report.public_source_hashes.affected_model_ids.length > 0);
  assert.equal(compared.report.deltas.models.added_ids.length, 0);
  assert.equal(compared.report.deltas.models.removed_ids.length, 0);
  assert.equal(compared.report.deltas.models.changed.length, 0);

  const errorOutput = [];
  await assert.rejects(main([
    "--compare",
    "--baseline-public", publicDriftVersion,
    "--candidate-public", publicDriftVersion,
    "--baseline-settings", settingsVersion,
    "--candidate-settings", settingsVersion
  ], { ...(await sourceRuntimeOption()), writeStdout: (value) => errorOutput.push(value) }), (error) => {
    assert.equal(error.code, "SETTINGS_PUBLIC_BINDING_MISMATCH");
    return true;
  });
  assert.deepEqual(errorOutput, []);
});

test("error codes require own data properties in finite allowlists; accessors and proxies are not read", async () => {
  const { runtime } = await sourceRuntimeOption();
  const cases = [];
  let getterReads = 0;
  const accessorReportError = new runtime.SyntxMaintenanceReportError("UNSAFE_INPUT");
  Object.defineProperty(accessorReportError, "code", {
    configurable: true,
    get() { getterReads += 1; throw new Error("secret getter must not run"); }
  });
  cases.push(accessorReportError);

  const unsafeReportCode = Object.create(runtime.SyntxMaintenanceReportError.prototype);
  Object.defineProperty(unsafeReportCode, "code", { value: "PUBLIC_CATALOG_private_secret" });
  cases.push(unsafeReportCode);

  const unsafeCliCode = Object.create(SyntxMaintenanceCliError.prototype);
  Object.defineProperty(unsafeCliCode, "code", { value: "PUBLIC_CATALOG_private_secret" });
  cases.push(unsafeCliCode);

  const accessorCliError = Object.create(SyntxMaintenanceCliError.prototype);
  Object.defineProperty(accessorCliError, "code", {
    get() { getterReads += 1; throw new Error("CLI getter must not run"); }
  });
  cases.push(accessorCliError);

  let proxyTrapReads = 0;
  const proxyReportError = new Proxy(new runtime.SyntxMaintenanceReportError("UNSAFE_INPUT"), {
    getOwnPropertyDescriptor() { proxyTrapReads += 1; throw new Error("proxy trap must not run"); }
  });
  cases.push(proxyReportError);

  for (const thrown of cases) {
    const failingRuntime = {
      ...runtime,
      compareSyntxMaintenanceSnapshots() { throw thrown; }
    };
    await assert.rejects(main([
      "--compare",
      "--baseline-public", publicVersion,
      "--candidate-public", publicVersion
    ], { runtime: failingRuntime }), (error) => {
      assert.equal(error.code, "MAINTENANCE_OPERATION_FAILED");
      assert.equal(error.message.includes("private_secret"), false);
      return true;
    });
  }
  assert.equal(getterReads, 0);
  assert.equal(proxyTrapReads, 0);
});

test("confirmed public probe uses only the three allowlisted GETs and never archives", async () => {
  const { loadPublicCatalogVersion, SYNTX_PUBLIC_CATALOG_ENDPOINTS } = await loadCatalogModules();
  const snapshot = loadPublicCatalogVersion(publicVersion);
  const payloads = new Map([
    [SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai, snapshot.ai],
    [SYNTX_PUBLIC_CATALOG_ENDPOINTS.models, snapshot.models],
    [SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models, { count: snapshot.llm_models.length, models: snapshot.llm_models }]
  ]);
  const calls = [];
  const before = await catalogState();
  const output = [];
  const result = await main([
    "--probe-public",
    "--baseline-public", publicVersion,
    "--confirm-source-fetch"
  ], {
    ...(await sourceRuntimeOption()),
    now: () => "2026-10-10T00:00:00.000Z",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(payloads.get(url)), {
        status: 200,
        headers: { "content-type": "application/json" }
      });
    },
    writeStdout: (value) => output.push(value)
  });
  const parsed = JSON.parse(output.join(""));
  assert.equal(result.operation, "CONFIRMED_PUBLIC_PROBE");
  assert.deepEqual(calls.map(({ url }) => url), [
    SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai,
    SYNTX_PUBLIC_CATALOG_ENDPOINTS.models,
    SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models
  ]);
  for (const { init } of calls) {
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
  }
  assert.equal(parsed.candidate_public_version, null);
  assert.equal(parsed.report.deltas.models.added_ids.length, 0);
  assert.equal(parsed.report.public_source_hashes.source_hash_only_drift, false);
  assert.equal(parsed.report.coverage.settings_inventory, "NOT_CHECKED");
  assert.equal(await catalogState(), before);
});

test("probe failure stops at first GET and emits no raw response or error detail", async () => {
  const calls = [];
  await assert.rejects(main([
    "--probe-public",
    "--baseline-public", publicVersion,
    "--confirm-source-fetch"
  ], {
    ...(await sourceRuntimeOption()),
    fetchImpl: async (url) => {
      calls.push(url);
      const failure = new Error("private payload detail");
      failure.code = "PUBLIC_CATALOG_private_secret";
      throw failure;
    },
    writeStdout: () => assert.fail("failed probe must not print a partial report")
  }), (error) => {
    assert.equal(error.code, "PUBLIC_CATALOG_PROBE_FAILED");
    assert.equal(error.message.includes("private payload detail"), false);
    return true;
  });
  assert.equal(calls.length, 1);
});

async function catalogState() {
  const paths = [
    join(catalogDirectory, "public"),
    join(catalogDirectory, "settings", "v2")
  ];
  const records = [];
  for (const directory of paths) {
    for (const name of (await readdir(directory)).sort()) {
      const bytes = await readFile(join(directory, name));
      records.push(`${directory}/${name}:${createHash("sha256").update(bytes).digest("hex")}`);
    }
  }
  return records.join("\n");
}

async function loadCatalogModules() {
  if (typeof Bun !== "undefined") {
    const [history, settings, publicCatalog] = await Promise.all([
      import("../src/catalog/public-catalog-history.ts"),
      import("../src/catalog/mapless-settings-inventory.ts"),
      import("../src/catalog/syntx-public-catalog.ts")
    ]);
    return {
      loadPublicCatalogVersion: history.loadPublicCatalogVersion,
      loadMaplessSettingsInventoryVersion: settings.loadMaplessSettingsInventoryVersion,
      SYNTX_PUBLIC_CATALOG_ENDPOINTS: publicCatalog.SYNTX_PUBLIC_CATALOG_ENDPOINTS
    };
  }
  const [history, settings, publicCatalog] = await Promise.all([
    import("../dist/src/catalog/public-catalog-history.js"),
    import("../dist/src/catalog/mapless-settings-inventory.js"),
    import("../dist/src/catalog/syntx-public-catalog.js")
  ]);
  return {
    loadPublicCatalogVersion: history.loadPublicCatalogVersion,
    loadMaplessSettingsInventoryVersion: settings.loadMaplessSettingsInventoryVersion,
    SYNTX_PUBLIC_CATALOG_ENDPOINTS: publicCatalog.SYNTX_PUBLIC_CATALOG_ENDPOINTS
  };
}

async function sourceRuntimeOption() {
  const compiled = typeof Bun === "undefined";
  const [report, auditPlan, controlWalk, history, settings, publicCatalog, publicSync] = await Promise.all(compiled ? [
    import("../dist/src/application/syntx-maintenance-report.js"),
    import("../dist/src/application/syntx-maintenance-audit-plan.js"),
    import("../dist/src/application/syntx-maintenance-control-walk.js"),
    import("../dist/src/catalog/public-catalog-history.js"),
    import("../dist/src/catalog/mapless-settings-inventory.js"),
    import("../dist/src/catalog/syntx-public-catalog.js"),
    import("../scripts/sync-public-catalog.mjs")
  ] : [
    import("../src/application/syntx-maintenance-report.ts"),
    import("../src/application/syntx-maintenance-audit-plan.ts"),
    import("../src/application/syntx-maintenance-control-walk.ts"),
    import("../src/catalog/public-catalog-history.ts"),
    import("../src/catalog/mapless-settings-inventory.ts"),
    import("../src/catalog/syntx-public-catalog.ts"),
    import("../scripts/sync-public-catalog.mjs")
  ]);
  return {
    runtime: {
      compareSyntxMaintenanceSnapshots: report.compareSyntxMaintenanceSnapshots,
      SyntxMaintenanceReportError: report.SyntxMaintenanceReportError,
      buildSyntxMaintenanceAuditPlan: auditPlan.buildSyntxMaintenanceAuditPlan,
      SyntxMaintenanceAuditPlanError: auditPlan.SyntxMaintenanceAuditPlanError,
      buildSyntxMaintenanceControlWalk: controlWalk.buildSyntxMaintenanceControlWalk,
      SyntxMaintenanceControlWalkError: controlWalk.SyntxMaintenanceControlWalkError,
      loadPublicCatalogVersion: history.loadPublicCatalogVersion,
      loadMaplessSettingsInventoryVersion: settings.loadMaplessSettingsInventoryVersion,
      buildSyntxPublicCatalogSnapshot: publicCatalog.buildSyntxPublicCatalogSnapshot,
      endpoints: publicCatalog.SYNTX_PUBLIC_CATALOG_ENDPOINTS,
      fetchPublicJson: publicSync.fetchPublicJson
    }
  };
}
