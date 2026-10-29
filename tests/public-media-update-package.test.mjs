import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const installChecker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const coverageMapV1 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v1.json", import.meta.url), "utf8"));
const coverageMapV2 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v2.json", import.meta.url), "utf8"));
const coverageMapV3 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v3.json", import.meta.url), "utf8"));

test("public npm manifest declares the updater command and source files", () => {
  assert.equal(packageJson.bin["syntx-mcp-update"], "scripts/update-mcp.mjs");
  assert.equal(packageLock.packages[""].bin["syntx-mcp-update"], "scripts/update-mcp.mjs");
  assert.equal(packageJson.files.includes("scripts/update-mcp.mjs"), true);
  assert.equal(packageJson.files.includes("catalog"), true);
  assert.equal(packageJson.files.includes("dist/src"), true);
});

test("release test command pins catalog, coverage, profiles, updater, and package regressions", () => {
  const command = packageJson.scripts["test:media:update"];
  assert.equal(typeof command, "string");
  for (const path of [
    "dist/tests/syntx-public-catalog-schema-20261028.test.js",
    "dist/tests/owner-wan27-r2v-generation-parameters-1546.test.js",
    "dist/tests/owner-wan27-r2v-request-preparer-1555.test.js",
    "dist/tests/owner-wan27-r2v-generation-mcp-runtime-1565.test.js",
    "dist/tests/public-catalog-selection.test.js",
    "dist/tests/public-catalog-sync.test.js",
    "dist/tests/owner-wan26-r2v-image-policy-1725.test.js",
    "dist/tests/media-coverage.test.js",
    "dist/tests/reviewed-media-profile.test.js",
    "dist/tests/expanded-t2v-profile.test.js",
    "dist/tests/owner-expanded-t2v-tools.test.js",
    "dist/tests/owner-existing-kling4-recovery.test.js",
    "dist/tests/owner-existing-video-recovery2361.test.js",
    "dist/tests/owner-suno-track-operation-parameters.test.js",
    "dist/tests/owner-suno-track-operation-preparer.test.js",
    "dist/tests/owner-suno-track-operation-generation-service.test.js",
    "dist/tests/owner-suno-track-operation-tools.test.js",
    "dist/tests/syntx-chat-http-client-owner-suno-track-operation.test.js",
    "dist/tests/owner-seedance-editor-source2216.test.js",
    "dist/tests/owner-seedance-editor-cost2222.test.js",
    "dist/tests/owner-seedance-editor-chat2221.test.js",
    "dist/tests/owner-seedance-editor-flow2230.test.js",
    "dist/tests/owner-seedance-editor-mcp2231.test.js",
    "tests/public-media-stdio-optins.test.mjs",
    "tests/mcp-self-update-service.test.mjs",
    "tests/print-media-all-supported-media.test.mjs",
    "tests/public-media-update-package.test.mjs"
  ]) assert.ok(command.includes(path), `release tests omit ${path}`);
  assert.ok(command.includes('tests/export-public-snapshot.test.mjs'));
  assert.ok(command.includes('tests/public-source-package-manifest.test.mjs'));
  assert.ok(command.includes('exports only the exact committed|exports only the allowlisted media guides|manifest rejects owner receipts and private documentation|public package paths must contain manifest'));
  assert.ok(installChecker.includes(JSON.stringify(command)), "installed package test-command pin is stale");
});

test("public package checker compares the packed media map and verifies the updater bin", () => {
  assert.equal(coverageMapV1.schema_version, "1.0.0");
  assert.ok(Number.isInteger(coverageMapV1.owner_tool_count) && coverageMapV1.owner_tool_count > 0);
  assert.equal(coverageMapV2.schema_version, "2.0.0");
  assert.equal(coverageMapV2.owner_tool_count, null);
  assert.equal(coverageMapV2.owner_tool_count_status, "UNVERIFIED_FOR_ROUTE_EXTENSION");
  assert.equal(coverageMapV3.schema_version, "3.0.0");
  assert.equal(coverageMapV3.owner_tool_count, null);
  assert.equal(coverageMapV3.owner_tool_count_status, "UNVERIFIED_FOR_ROUTE_EXTENSION");
  assert.equal(coverageMapV3.public_catalog_version, coverageMapV2.public_catalog_version);
  const recoveryAlias = coverageMapV3.native_alias_bindings.find((binding) => binding.operator_flag === "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY");
  assert.deepEqual(recoveryAlias?.public_model_ids, ["kling_4_keyframes", "kling_4_omni"]);
  assert.deepEqual(recoveryAlias?.tool_names, ["syntx_owner_get_existing_video_recovery"]);
  assert.match(recoveryAlias?.operation_note ?? "", /NO_REFERENCE_ONLY/u);
  for (const path of [
    '"catalog/media-coverage/owner-tool-routes-v1.json"',
    '"catalog/media-coverage/owner-tool-routes-v2.json"',
    '"catalog/media-coverage/owner-tool-routes-v3.json"',
    '"catalog/media-coverage/owner-expanded-t2v-controls-v2.json"'
  ]) assert.ok(installChecker.includes(path), `package checker omits ${path}`);
  assert.ok(installChecker.includes("assertInstalledMediaUpdateArtifacts(installedPackagePath, consumerPath)"));
  assert.ok(installChecker.includes('"UPDATER_PACKAGE_BIN_MISSING"'));
  assert.ok(installChecker.includes('"MEDIA_COVERAGE_PACKAGE_INVALID"'));
});
