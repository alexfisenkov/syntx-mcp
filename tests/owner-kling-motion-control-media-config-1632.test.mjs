import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { buildMediaMcpConfig, main, parseArguments } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const CONFIRM = "--confirm-enable-paid-tools";
const TOOL_NAMES = [
  "syntx_owner_get_kling_motion_control_parameters",
  "syntx_owner_upload_kling_motion_control_image",
  "syntx_owner_upload_kling_motion_control_video",
  "syntx_owner_list_kling_motion_control_presets",
  "syntx_owner_select_kling_motion_control_preset",
  "syntx_owner_generate_kling_motion_control_video",
  "syntx_owner_reconcile_kling_motion_control_video",
  "syntx_owner_list_kling_motion_control_recoveries",
  "syntx_owner_get_kling_motion_control_result_page"
];
const CHANGED_SELECTOR = "node --test dist/tests/owner-kling-motion-control-image-policy-1607.test.js dist/tests/owner-kling-motion-control-video-probe-1609.test.js dist/tests/owner-kling-motion-control-video-result-1612.test.js dist/tests/owner-kling-motion-control-parameters-1613.test.js dist/tests/owner-kling-motion-control-native-upload-1614.test.js dist/tests/kling-motion-control-presets-decoder-1615.test.js dist/tests/owner-kling-motion-control-reference-service-1616.test.js dist/tests/owner-kling-motion-control-native-presets-1617.test.js dist/tests/owner-kling-motion-control-history-1620.test.js dist/tests/owner-kling-motion-control-request-preparer-1622.test.js dist/tests/owner-kling-motion-control-preset-reference-service-1623.test.js dist/tests/owner-kling-motion-control-preset-preparer-1626.test.js dist/tests/owner-kling-motion-control-native-1627.test.js dist/tests/owner-kling-motion-control-generation-service-1628.test.js dist/tests/owner-kling-motion-control-runtime-1630.test.js dist/tests/owner-kling-motion-control-generation-mcp-runtime-1631.test.js && node --test tests/owner-kling-motion-control-media-config-1632.test.mjs && node --test --test-name-pattern=\"changed media selector\" tests/owner-wan27-r2v-media-config-1563.test.mjs";

test("Motion Control media config stays explicit, owner-stdio-only, and advertises trusted ffprobe setup", async () => {
  assert.deepEqual(parseArguments([CONFIRM]), { kind: "emit" });
  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT).href, "/node/bin/node");
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_KLING_MOTION_CONTROL, "1");
  assert.equal(env.SYNTX_OWNER_KLING_MOTION_CONTROL_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(env.SYNTX_OWNER_KLING_KEYFRAMES, "1");
  assert.equal(env.SYNTX_OWNER_DURABLE_GENERATION, "0");

  const stdout = [], stderr = [];
  assert.equal(await main([], { entryUrl: pathToFileURL(SCRIPT).href, writeStdout: (value) => stdout.push(value), writeStderr: (value) => stderr.push(value) }), 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /SYNTX_OWNER_KLING_MOTION_CONTROL_FFPROBE_PATH/u);
  assert.match(stdout.join(""), /absolute path to a trusted ffprobe executable/u);
  assert.match(stdout.join(""), /may incur provider charges/u);
  assert.match(stdout.join(""), /does not generate automatically/u);
  assert.match(stdout.join(""), /No enforceable cost cap/u);

  const emitted = [], emitErrors = [];
  assert.equal(await main([CONFIRM], { entryUrl: pathToFileURL(SCRIPT).href, writeStdout: (value) => emitted.push(value), writeStderr: (value) => emitErrors.push(value) }), 0);
  assert.equal(emitErrors.join(""), "");
  assert.equal(JSON.parse(emitted.join("")).mcpServers.syntx.env.SYNTX_OWNER_KLING_MOTION_CONTROL, "1");
  assert.equal(JSON.stringify(config).includes("token"), false);
});

test("Motion Control public API exposes exactly the nine owner tool names", async () => {
  const api = await import("../dist/src/index.js");
  assert.deepEqual(api.OWNER_KLING_MOTION_CONTROL_TOOL_NAMES, TOOL_NAMES);
  for (const name of [
    "normalizeOwnerKlingMotionControlParameters",
    "getOwnerKlingMotionControlParametersSource",
    "buildOwnerKlingMotionControlWireSettingsTemplate",
    "OwnerKlingMotionControlGenerationService",
    "OwnerKlingMotionControlGenerationServiceError",
    "registerSyntxOwnerKlingMotionControlTools",
    "readOwnerKlingMotionControlFlag"
  ]) assert.equal(typeof api[name], "function", `${name} must be publicly exported`);
});

test("changed media selector is frozen to the Motion Control unit suites and one config test", async () => {
  const packageJson = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  assert.equal(packageJson.scripts["test:media:changed"], CHANGED_SELECTOR);
});
