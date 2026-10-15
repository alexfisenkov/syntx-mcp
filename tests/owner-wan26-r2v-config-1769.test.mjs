import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildMediaMcpConfig, main } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_URL = pathToFileURL(fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url))).href;
const CONFIRM = "--confirm-enable-paid-tools";

test("WAN26 R2V flags and trusted executable placeholders appear only in confirmed config", async () => {
  const helpOut = [], helpErr = [];
  assert.equal(await main([], { entryUrl: SCRIPT_URL, writeStdout: (value) => helpOut.push(value), writeStderr: (value) => helpErr.push(value) }), 0);
  assert.equal(helpErr.join(""), "");
  assert.equal(helpOut.join("").includes("SYNTX_OWNER_WAN26_R2V"), false);

  const config = buildMediaMcpConfig(SCRIPT_URL, "/usr/bin/node");
  const { env } = config.mcpServers.syntx;
  assert.equal(env.SYNTX_OWNER_WAN26_R2V, "1");
  assert.equal(env.SYNTX_OWNER_WAN26_R2V_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(env.SYNTX_OWNER_WAN26_R2V_FFMPEG_PATH, "<absolute path to trusted ffmpeg executable>");
  assert.equal(Object.keys(env).filter((envName) => envName === "SYNTX_OWNER_WAN26_R2V").length, 1);

  const configOut = [], configErr = [];
  assert.equal(await main([CONFIRM], { entryUrl: SCRIPT_URL, writeStdout: (value) => configOut.push(value), writeStderr: (value) => configErr.push(value) }), 0);
  assert.equal(configErr.join(""), "");
  const emitted = JSON.parse(configOut.join(""));
  assert.deepEqual(emitted.mcpServers.syntx.env, env);
  assert.match(emitted.mcpServers.syntx.args[0], /dist[\/]src[\/]transports[\/]stdio-owner\.js$/u);
});
