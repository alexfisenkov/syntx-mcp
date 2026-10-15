import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
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

test("changed media selector uses bounded explicit test commands and retains frozen Keyframes public exports", async () => {
  const packageJson = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
  const selector = packageJson.scripts["test:media:changed"];
  assert.equal(typeof selector, "string");
  const commands = selector.split(/\s+&&\s+/u).map((command) => command.trim());
  assert.ok(commands.length > 0 && commands.length <= 4, "changed-media selector must remain a bounded command list");
  const selectedPaths = [];
  for (const command of commands) {
    const parts = command.split(/\s+/u);
    assert.equal(parts[0], "node", "only Node test commands are permitted");
    assert.equal(parts[1], "--test", "each selector segment must run the test runner");
    assert.ok(parts.length >= 3, "each test command must explicitly name files");
    for (const path of parts.slice(2)) {
      assert.match(path, /^(?:dist\/)?tests\/[A-Za-z0-9._-]+\.test\.(?:js|mjs)$/u,
        "every selector path must be a safe relative explicit test file");
      assert.equal(path.split("/").includes(".."), false);
      selectedPaths.push(path);
      if (path.startsWith("dist/")) {
        const sourcePath = path.replace(/^dist\//u, "").replace(/\.js$/u, ".ts");
        assert.equal(existsSync(new URL(`../${sourcePath}`, import.meta.url)), true,
          `missing source counterpart: ${sourcePath}`);
      } else {
        assert.equal(existsSync(new URL(`../${path}`, import.meta.url)), true, `missing explicit test file: ${path}`);
      }
    }
  }
  assert.ok(selectedPaths.length > 0 && selectedPaths.length <= 40, "the total selected test file count must remain bounded");
  assert.equal(new Set(selectedPaths).size, selectedPaths.length, "selector paths must not be duplicated");

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
