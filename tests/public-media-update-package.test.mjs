import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
const packageLock = JSON.parse(readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const installChecker = readFileSync(new URL("../scripts/check-package-install.mjs", import.meta.url), "utf8");
const coverageMapV1 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v1.json", import.meta.url), "utf8"));
const coverageMapV2 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v2.json", import.meta.url), "utf8"));
const coverageMapV4 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v4.json", import.meta.url), "utf8"));
const coverageMapV5 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v5.json", import.meta.url), "utf8"));
const coverageMapV6 = JSON.parse(readFileSync(new URL("../catalog/media-coverage/owner-tool-routes-v6.json", import.meta.url), "utf8"));
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
    "tests/public-media-update-package.test.mjs",
    "dist/tests/remote-owner-oauth.test.js",
    "dist/tests/remote-owner-stdio-bridge.test.js",
    "dist/tests/remote-owner-stdio-buffer.test.js",
    "dist/tests/remote-owner-media-file-input.test.js",
    "dist/tests/owner-seedance-editor-frames.test.js",
    "dist/tests/owner-seedance25-t2v-current.test.js",
    "dist/tests/owner-wan27-i2v-current.test.js",
    "dist/tests/owner-seedance25-t2v2348.test.js",
    "dist/tests/owner-wan27-i2v-sdk2349.test.js",
    "dist/tests/owner-wan27-i2v2334-contract.test.js",
    "dist/tests/owner-wan30-t2v-adaptive-current.test.js",
    "dist/tests/owner-video2audio-current-controls.test.js",
    "dist/tests/owner-video2audio-request-preparer.test.js",
    "dist/tests/owner-video2audio-generation-service.test.js",
    "dist/tests/syntx-chat-http-client-video2audio-native.test.js",
    "tests/owner-acttwo-2355.test.mjs",
    "dist/tests/owner-acttwo-sdk2355.test.js",
    "dist/tests/owner-elevenlabs-voice-reference-service.test.js",
    "dist/tests/owner-happy-horse-2324.test.js",
    "dist/tests/owner-happy-horse-native2330.test.js",
    "dist/tests/owner-heygen4-sdk2355.test.js",
    "dist/tests/owner-higgsfield-dop-native2310.test.js",
    "dist/tests/owner-higgsfield-dop-native2312.test.js",
    "dist/tests/owner-kling-i2v-generation-service.test.js",
    "dist/tests/owner-kling-i2v-tools.test.js",
    "dist/tests/owner-kling-i2v-wire-source.test.js",
    "dist/tests/owner-kling-keyframes-parameters-1583.test.js",
    "dist/tests/owner-runway-i2v-flow2261.test.js",
    "dist/tests/owner-runway-i2v-parameters2255.test.js",
    "dist/tests/owner-runway-i2v-tools2262.test.js",
    "dist/tests/owner-seedance20-t2v-tools.test.js",
    "dist/tests/owner-switchx-video-sdk2355.test.js",
    "dist/tests/owner-topaz-enhance-generation-service-1986.test.js",
    "dist/tests/owner-topaz-enhance-parameters-1970.test.js",
    "dist/tests/owner-video2audio-runtime-composition.test.js",
    "dist/tests/owner-wan-t2v-generation-service.test.js",
    "dist/tests/owner-wan30-edit-generation-parameters.test.js",
    "dist/tests/owner-wan30-edit-mcp-1924.test.js",
    "dist/tests/owner-wan30-edit-native-context.test.js",
    "dist/tests/owner-wan30-edit-original-probe.test.js",
    "dist/tests/owner-wan30-first-last-mcp-1829.test.js",
    "dist/tests/owner-wan30-first-last-parameters-1825.test.js",
    "dist/tests/owner-wan30-omni-generation-parameters.test.js",
    "dist/tests/owner-wan30-omni-mcp-1886.test.js",
    "dist/tests/owner-wan30-reference-generation-parameters.test.js",
    "dist/tests/owner-wan30-reference-mcp-1876.test.js",
    "dist/tests/syntx-http-client-elevenlabs-voices.test.js",
    "dist/tests/advertised-input-schema.test.js",
    "dist/tests/mcp-initialize-owner-instructions.test.js",
    "dist/tests/owner-actor-current-controls.test.js",
    "dist/tests/owner-current-reference-family-intents.test.js",
    "dist/tests/owner-current-video-generation-sdk.test.js",
    "dist/tests/owner-current-video-reference-native.test.js",
    "dist/tests/owner-current-video-reference-operation.test.js",
    "dist/tests/owner-current-video-reference-policy.test.js",
    "dist/tests/owner-current-video-reference-store.test.js",
    "dist/tests/owner-current-video-reference-tools.test.js",
    "dist/tests/owner-current-video-reference-trim.test.js",
    "dist/tests/owner-current-video-reference-validation.test.js",
    "dist/tests/owner-elevenlabs-sts-wav-preparation.test.js",
    "dist/tests/owner-elevenlabs-voice-discovery.test.js",
    "dist/tests/owner-expanded-t2v-current-seed.test.js",
    "dist/tests/owner-happy-horse-current-controls.test.js",
    "dist/tests/owner-happy-horse-current-sdk.test.js",
    "dist/tests/owner-heygen4-absolute-path.test.js",
    "dist/tests/owner-higgsfield-dop-current-controls.test.js",
    "dist/tests/owner-kling-media-current.test.js",
    "dist/tests/owner-kling-t2v-current.test.js",
    "dist/tests/owner-seedance-current-intent.test.js",
    "dist/tests/owner-seedance-current-sdk.test.js",
    "dist/tests/owner-seedance-editor-prompt-markers.test.js",
    "dist/tests/owner-seedance20-t2v-current.test.js",
    "dist/tests/owner-sts-ffmpeg-config.test.js",
    "dist/tests/owner-switchx-current-native-config.test.js",
    "dist/tests/owner-switchx-current-native-reference.test.js",
    "dist/tests/owner-switchx-current-sdk.test.js",
    "dist/tests/owner-video2audio-current-input-sdk.test.js",
    "dist/tests/owner-video2audio-current-native-codec.test.js",
    "dist/tests/owner-wan-current-intent.test.js",
    "dist/tests/owner-wan-current-sdk.test.js",
    "dist/tests/owner-wan-t2v-audio-current.test.js",
    "dist/tests/owner-wan30-edit-current.test.js",
    "dist/tests/owner-wan30-first-last-current.test.js",
    "dist/tests/owner-wan30-omni-current.test.js",
    "dist/tests/owner-wan30-prompt-markers.test.js",
    "dist/tests/owner-wan30-reference-current.test.js",
    "dist/tests/maintenance-skill-resources.test.js",
    "dist/tests/owner-clarity-upscale-request-preparer.test.js",
    "dist/tests/owner-grok-i2v-flow2283.test.js",
    "dist/tests/owner-grok-i2v-image-policy2281.test.js",
    "dist/tests/owner-grok-i2v-parameters2280.test.js",
    "dist/tests/owner-grok-i2v-wire2281.test.js",
    "dist/tests/owner-kling-keyframes-generation-service-1595.test.js",
    "dist/tests/owner-kling4-generation-service-2148.test.js",
    "dist/tests/owner-kling4-parameters-2138.test.js",
    "dist/tests/owner-magnific-upscale-parameters.test.js",
    "dist/tests/owner-soul-generation-parameters.test.js",
    "dist/tests/owner-flux3-current-sdk.test.js",
    "dist/tests/owner-image-manual-current-sdk.test.js",
    "dist/tests/local-media-native-permissions.test.js",
    "dist/tests/mcp-estimate-reference-pattern.test.js",
    "tests/check-installed-wan-t2v-flow.test.mjs",
    "tests/check-installed-elevenlabs-tts-flow.test.mjs",
    "tests/check-installed-video2audio-flow.test.mjs",
    "dist/tests/owner-wan-document-dependency.test.js",
    "deploy/private-owner.test.mjs"
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
  assert.equal(coverageMapV4.schema_version, "4.0.0");
  assert.equal(coverageMapV4.route_method, "REUSED_V3_CODE_BINDINGS_NO_NEW_TOOLS_LIST_OR_PROVIDER_PROOF");
  assert.deepEqual(coverageMapV4.routes, coverageMapV3.routes);
  assert.deepEqual(coverageMapV4.native_alias_bindings, coverageMapV3.native_alias_bindings);
  assert.equal(coverageMapV5.schema_version, "5.0.0");
  assert.equal(coverageMapV5.public_catalog_version, coverageMapV4.public_catalog_version);
  assert.equal(coverageMapV5.route_provenance.source_v4_sha256, "sha256:2847eb6ca45ac5c820a8b51dfa6d622b382097e25310346588979c4fe94897e7");
  const expectedRoutes = structuredClone(coverageMapV4.routes);
  for (const id of ["V6", "V6_wild"]) expectedRoutes[id] = [...expectedRoutes[id], "syntx_owner_upload_suno_audio_reference"].sort();
  assert.deepEqual(coverageMapV5.routes, expectedRoutes);
  assert.equal(coverageMapV6.schema_version, "6.0.0");
  assert.equal(coverageMapV6.public_catalog_version, "sha256-a82998ab6aa5f7597e6d37f7efc9abdc194501b83bbb932eb6b1f264af935f88.json");
  assert.equal(coverageMapV6.route_provenance.source_v5_sha256, "sha256:2a0da329494ae60a35f1df82b9d04e66dcd4c3cadda7cbbb49baaef07ee20790");
  const expectedCurrentRoutes = structuredClone(coverageMapV5.routes);
  const currentGroups = [[["seedance-2.0", "seedance-2.5", "seedance_pro", "seedance_pro-fast", "seedance-1.5-pro"], ["syntx_owner_get_seedance_current_source", "syntx_owner_generate_seedance_current_video", "syntx_owner_get_seedance_current_result", "syntx_owner_list_seedance_current_recoveries"]], [["hailuo-3.0"], ["syntx_owner_get_hailuo3_current_source", "syntx_owner_generate_hailuo3_current", "syntx_owner_get_hailuo3_current_result", "syntx_owner_list_hailuo3_current_recoveries"]], [["ray-3.14"], ["syntx_owner_get_luma_current_source", "syntx_owner_generate_luma_current", "syntx_owner_get_luma_current_result", "syntx_owner_list_luma_current_recoveries"]], [["veo3", "veo3fast", "veo3fast_r"], ["syntx_owner_get_veo3_current_source", "syntx_owner_generate_veo3_current", "syntx_owner_get_veo3_current_result", "syntx_owner_list_veo3_current_recoveries"]], [["wan_30_reference", "wan_30_omni", "wan_30_edit", "wan_30_first_last_frame", "wan_25_t2v_preview", "wan_25_i2v_preview", "wan_27_i2v", "wan_27_r2v", "wan_27_videoedit", "wan_30_t2v"], ["syntx_owner_get_wan_current_source", "syntx_owner_generate_wan_current", "syntx_owner_get_wan_current_result", "syntx_owner_list_wan_current_recoveries"]], [["flux3_t2v", "flux3_i2v", "flux3_v2v"], ["syntx_owner_get_flux3_current_source", "syntx_owner_generate_flux3_current_video", "syntx_owner_get_flux3_current_result", "syntx_owner_list_flux3_current_recoveries"]]];
  for (const [ids, names] of currentGroups) for (const id of ids) {
    const common = ["syntx_get_current_video_reference_policy"];
    if (!["flux3_t2v", "wan_30_t2v"].includes(id)) common.push("syntx_owner_upload_current_video_reference");
    expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], ...common, ...names])].sort();
  }
  for (const id of ["wan_26_t2v", "wan_27_t2v"]) expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], "syntx_owner_upload_wan_t2v_audio"])].sort();
  expectedCurrentRoutes.switchx = [...new Set([...expectedCurrentRoutes.switchx, "syntx_owner_upload_switchx_reference"])].sort();
  for (const [ids, name] of [[["clarity"], "syntx_owner_get_clarity_current_manual_source"], [["creative", "precision_v1", "precision_v2"], "syntx_owner_get_magnific_current_manual_source"], [["higgsfield-soul"], "syntx_owner_get_soul_current_manual_source"]]) for (const id of ids) expectedCurrentRoutes[id] = [...new Set([...expectedCurrentRoutes[id], name])].sort();
  assert.deepEqual(coverageMapV6.routes, expectedCurrentRoutes);
  assert.deepEqual(coverageMapV6.source_only_model_ids, ["gpt-image-2.6-flare", "gpt-image-2.6-sunburst"]);
  const expectedAliases = structuredClone(coverageMapV5.native_alias_bindings);
  const editor = expectedAliases.find(binding => binding.operator_flag === "SYNTX_OWNER_SEEDANCE_EDITOR");
  editor.tool_names.push("syntx_owner_upload_seedance_editor_frame");
  editor.route_evidence_sources.push("src/application/owner-seedance-editor-frame-policy.ts");
  assert.deepEqual(coverageMapV6.native_alias_bindings, expectedAliases);
  const recoveryAlias = coverageMapV3.native_alias_bindings.find((binding) => binding.operator_flag === "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY");
  assert.deepEqual(recoveryAlias?.public_model_ids, ["kling_4_keyframes", "kling_4_omni"]);
  assert.deepEqual(recoveryAlias?.tool_names, ["syntx_owner_get_existing_video_recovery"]);
  assert.match(recoveryAlias?.operation_note ?? "", /NO_REFERENCE_ONLY/u);
  for (const path of [
    '"catalog/media-coverage/owner-tool-routes-v1.json"',
    '"catalog/media-coverage/owner-tool-routes-v2.json"',
    '"catalog/media-coverage/owner-tool-routes-v3.json"',
    '"catalog/media-coverage/owner-tool-routes-v4.json"',
    '"catalog/media-coverage/owner-tool-routes-v5.json"',
    '"catalog/media-coverage/owner-tool-routes-v6.json"',
    '"catalog/media-coverage/owner-expanded-t2v-controls-v2.json"'
  ]) assert.ok(installChecker.includes(path), `package checker omits ${path}`);
  assert.ok(installChecker.includes("assertInstalledMediaUpdateArtifacts(installedPackagePath, consumerPath)"));
  assert.ok(installChecker.includes('"UPDATER_PACKAGE_BIN_MISSING"'));
  assert.ok(installChecker.includes('"MEDIA_COVERAGE_PACKAGE_INVALID"'));
  assert.ok(installChecker.includes("loadPublicCatalogVersion(inventory.public_catalog.version, catalogDirectory)"));
  assert.equal(installChecker.includes("inventory.summary.total_models, 200"), false);
});
