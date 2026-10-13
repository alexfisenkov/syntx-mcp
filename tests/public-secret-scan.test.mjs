import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { spawnSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  PUBLIC_SOURCE_EXCLUDED_ROOTS,
  PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS,
  loadAndVerifyPublicSourceManifest,
  validatePublicSourceManifest
} from "../scripts/public-source-package-manifest.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const configPath = join(repoRoot, ".gitleaks.toml");
const gitleaks = process.env.GITLEAKS_BIN || "gitleaks";
const probe = spawnSync(gitleaks, ["version"], { encoding: "utf8" });
const scannerMissing = probe.error?.code === "ENOENT";
const explicitMissingScannerSkip = scannerMissing && process.env.SKIP_GITLEAKS_TESTS === "1";
const scannerOptions = explicitMissingScannerSkip
  ? { skip: "Gitleaks is absent; SKIP_GITLEAKS_TESTS=1 was explicitly set." }
  : {};

function parseFindingMetadata(reportText) {
  const findings = JSON.parse(reportText);
  assert.ok(Array.isArray(findings));
  return findings.map(({ RuleID, File }) => ({ RuleID, File }));
}

function scanDirectory(directory, reportDirectory) {
  const reportPath = join(reportDirectory, `gitleaks-${randomBytes(8).toString("hex")}.json`);
  const result = spawnSync(gitleaks, [
    "dir", ".",
    "--config", configPath,
    "--no-banner",
    "--no-color",
    "--redact",
    "--log-level", "error",
    "--report-format", "json",
    "--report-path", reportPath
  ], { cwd: directory, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });

  if (result.error) {
    throw new Error(scannerMissing ? "GITLEAKS_REQUIRED (set SKIP_GITLEAKS_TESTS=1 only for documented scanner-free environments)" : "GITLEAKS_EXECUTION_FAILED");
  }

  return readFile(reportPath, "utf8").then(async (reportText) => {
    await rm(reportPath, { force: true });
    return { status: result.status, findings: parseFindingMetadata(reportText) };
  }, () => {
    throw new Error(`GITLEAKS_REPORT_MISSING (exit=${result.status})`);
  });
}

async function writeManifest(root, { extraHashKey = false } = {}) {
  const readme = Buffer.from("public test fixture\n", "utf8");
  await writeFile(join(root, "README.md"), readme);
  const hashes = {
    "README.md": createHash("sha256").update(readme).digest("hex")
  };
  if (extraHashKey) hashes.unclassified = "a".repeat(64);
  const manifest = {
    schema_version: "1.0.0",
    profile: "public-source",
    source_commit: "a".repeat(40),
    included_paths: ["README.md"],
    excluded_paths: [...PUBLIC_SOURCE_PRIVATE_RECEIPT_PATHS],
    excluded_roots: [...PUBLIC_SOURCE_EXCLUDED_ROOTS],
    file_sha256: hashes
  };
  await writeFile(join(root, "publication-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  return manifest;
}

test("public secret-scan allowlists suppress only validated hashes and exact synthetic fixtures", scannerOptions, async (t) => {
  const tempRoot = await mkdtemp(join(tmpdir(), "syntx-public-secret-scan-"));
  const fixtureRoot = join(tempRoot, "known-fixtures");
  await mkdir(join(fixtureRoot, "tests"), { recursive: true });

  try {
    const fixturePaths = [
      "tests/live-owner-soul-shape-stdio-acceptance.test.mjs",
      "tests/mcp-syntx-job-id.test.ts",
      "tests/owner-durable-live-service.test.ts",
      "tests/sqlite-generation-cancel-attempt-store.test.ts",
      "tests/sqlite-generation-transaction-store.test.ts",
      "tests/syntx-upstream-adapter.test.ts"
    ];
    for (const relativePath of fixturePaths) {
      await copyFile(join(repoRoot, relativePath), join(fixtureRoot, relativePath));
    }

    await writeManifest(fixtureRoot);
    await loadAndVerifyPublicSourceManifest(fixtureRoot);

    const allowedFixtureScan = await scanDirectory(fixtureRoot, tempRoot);
    assert.equal(allowedFixtureScan.status, 0, "exact known fixture values and validated manifest hashes should be ignored");
    assert.deepEqual(allowedFixtureScan.findings, []);

    const invalidManifest = await writeManifest(fixtureRoot, { extraHashKey: true });
    assert.throws(
      () => validatePublicSourceManifest(invalidManifest),
      (error) => error?.message === "PUBLIC_MANIFEST_INVALID",
      "an arbitrary hash-map key must fail the closed manifest schema"
    );
    await assert.rejects(
      loadAndVerifyPublicSourceManifest(fixtureRoot),
      (error) => error?.message === "PUBLIC_MANIFEST_INVALID"
    );

    // A new high-entropy credential in an otherwise allowlisted test path and
    // field must remain visible to the inherited default rules.
    const unknownRoot = join(tempRoot, "unknown-credential");
    await mkdir(join(unknownRoot, "tests"), { recursive: true });
    const unknownCredential = `ghp_${randomBytes(18).toString("hex")}`;
    const authPath = join(unknownRoot, "tests/owner-durable-live-service.test.ts");
    await writeFile(authPath, `export const auth = { idempotency_key: "${unknownCredential}" };\n`);
    const credentialScan = await scanDirectory(unknownRoot, tempRoot);
    assert.equal(credentialScan.status, 1, "a previously unknown credential in an exception path must still fail");
    assert.ok(credentialScan.findings.length > 0, "an inherited Gitleaks rule must report the synthetic credential");
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});

test("the current public export is manifest-verified before its Gitleaks scan", scannerOptions, async () => {
  const rootManifest = join(repoRoot, "publication-manifest.json");
  const checkoutRoot = join(repoRoot, ".публикация", "checkout");
  let publicRoot;
  try {
    await readFile(rootManifest);
    publicRoot = repoRoot;
  } catch {
    try {
      await readFile(join(checkoutRoot, "publication-manifest.json"));
      publicRoot = checkoutRoot;
    } catch {
      return;
    }
  }

  const verified = await loadAndVerifyPublicSourceManifest(publicRoot);
  assert.equal(verified.profile, "public-source");
  const tempRoot = await mkdtemp(join(tmpdir(), "syntx-public-export-scan-"));
  try {
    const scan = await scanDirectory(publicRoot, tempRoot);
    assert.equal(scan.status, 0, `public export must be clean after manifest validation; finding count=${scan.findings.length}`);
    assert.deepEqual(scan.findings, []);
  } finally {
    await rm(tempRoot, { recursive: true, force: true });
  }
});
