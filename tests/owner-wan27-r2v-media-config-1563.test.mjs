import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";

import { buildMediaMcpConfig, main, parseArguments } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const ENABLE_FLAG = "--confirm-enable-paid-tools";

test("WAN R2V is present only in the confirmed paid-tools config with trusted executable placeholders", async () => {
  assert.deepEqual(parseArguments([ENABLE_FLAG]), { kind: "emit" });
  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, "/node/bin/node");
  const env = config.mcpServers.syntx.env;

  assert.equal(env.SYNTX_OWNER_WAN27_R2V, "1");
  assert.equal(env.SYNTX_OWNER_WAN27_R2V_FFPROBE_PATH, "<absolute path to ffprobe>");
  assert.equal(env.SYNTX_OWNER_WAN27_R2V_FFMPEG_PATH, "<absolute path to ffmpeg>");
  assert.equal(Object.hasOwn(env, "SYNTX_OWNER_WAN27_R2V_UPLOAD_DESTINATION"), false);

  const stdout = [], stderr = [];
  const status = await main([], {
    entryUrl: pathToFileURL(SCRIPT_PATH).href,
    writeStdout: (chunk) => stdout.push(chunk),
    writeStderr: (chunk) => stderr.push(chunk)
  });
  assert.equal(status, 0);
  assert.equal(stderr.join(""), "");
  assert.equal(stdout.join("").includes(ENABLE_FLAG), true);
  assert.match(stdout.join(""), /SYNTX_OWNER_WAN27_R2V=1/u);
  assert.match(stdout.join(""), /SYNTX_OWNER_WAN27_R2V_FFPROBE_PATH/u);
  assert.match(stdout.join(""), /SYNTX_OWNER_WAN27_R2V_FFMPEG_PATH/u);
  assert.match(stdout.join(""), /absolute trusted executable paths/u);
  assert.match(stdout.join(""), /does not edit client settings.*network/u);
});

test("changed media selector runs the frozen Keyframes suites and public exports", async () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const selector = packageJson.scripts["test:media:changed"];
  assert.equal(selector,
    'node --test dist/tests/owner-kling-keyframes-request-preparer-1588.test.js dist/tests/owner-kling-keyframes-video-result-1589.test.js dist/tests/owner-kling-keyframes-one-shot-policy-1590.test.js dist/tests/owner-kling-keyframes-history-1592.test.js dist/tests/owner-kling-keyframes-native-1593.test.js dist/tests/owner-kling-keyframes-generation-service-1595.test.js dist/tests/owner-kling-keyframes-generation-mcp-runtime-1596.test.js dist/tests/owner-kling-keyframes-result-growth-1598.test.js dist/tests/owner-kling-keyframes-input-mcp-runtime-1582.test.js && node --test --test-name-pattern="changed media selector" tests/owner-wan27-r2v-media-config-1563.test.mjs');

  const publicApi = await import("../dist/src/index.js");
  for (const name of [
    "normalizeOwnerKlingKeyframesParameters",
    "getOwnerKlingKeyframesParametersSource",
    "buildOwnerKlingKeyframesWireSettingsTemplate",
    "OwnerKlingKeyframesParametersError",
    "OwnerKlingKeyframesWireSourceError",
    "OwnerKlingKeyframesGenerationService",
    "OwnerKlingKeyframesGenerationServiceError",
    "registerSyntxOwnerKlingKeyframesGenerationTools",
    "registerSyntxOwnerKlingKeyframesTools"
  ]) assert.equal(typeof publicApi[name], "function", `${name} must be a public export`);
  assert.deepEqual(publicApi.OWNER_KLING_KEYFRAMES_GENERATION_TOOL_NAMES, [
    "syntx_get_kling_keyframes_parameters",
    "syntx_owner_generate_kling_keyframes",
    "syntx_owner_reconcile_kling_keyframes",
    "syntx_owner_list_kling_keyframes_recoveries",
    "syntx_owner_get_kling_keyframes_result_page"
  ]);
  assert.deepEqual(publicApi.OWNER_KLING_KEYFRAMES_INPUT_TOOL_NAMES, [
    "syntx_owner_get_kling_keyframes_input_policy",
    "syntx_owner_upload_kling_keyframes_image",
    "syntx_owner_check_kling_keyframes_images"
  ]);
  assert.equal(typeof publicApi.OWNER_KLING_KEYFRAMES_SOURCE_PINS, "object");
  assert.equal(typeof publicApi.SYNTX_OWNER_GET_KLING_KEYFRAMES_INPUT_POLICY_TOOL_NAME, "string");
  assert.equal(typeof publicApi.SYNTX_OWNER_UPLOAD_KLING_KEYFRAMES_IMAGE_TOOL_NAME, "string");
  assert.equal(typeof publicApi.SYNTX_OWNER_CHECK_KLING_KEYFRAMES_IMAGES_TOOL_NAME, "string");

  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, "/node/bin/node");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_KLING_KEYFRAMES, "1");
  const stdout = [], stderr = [];
  const status = await main(["--help"], {
    entryUrl: pathToFileURL(SCRIPT_PATH).href,
    writeStdout: (chunk) => stdout.push(chunk),
    writeStderr: (chunk) => stderr.push(chunk)
  });
  assert.equal(status, 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /SYNTX_OWNER_KLING_KEYFRAMES=1/u);
  assert.match(stdout.join(""), /does not start generation/u);
});
