import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig, main } from "../scripts/print-media-mcp-config.mjs";
import { fileURLToPath, pathToFileURL } from "node:url";

const SCRIPT = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const CONFIRM = "--confirm-enable-paid-tools";

test("WAN25 preview is emitted only by the confirmed owner-stdio configuration and needs no ffprobe", async () => {
  const helpOut = [], helpErr = [];
  assert.equal(await main([], { entryUrl: pathToFileURL(SCRIPT).href,
    writeStdout: (value) => helpOut.push(value), writeStderr: (value) => helpErr.push(value) }), 0);
  assert.equal(helpErr.join(""), "");
  assert.match(helpOut.join(""), /Without the exact confirmation flag, no configuration is emitted/u);
  assert.throws(() => JSON.parse(helpOut.join("")));

  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT).href, "/node/bin/node");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN25_I2V_PREVIEW, "1");
  assert.equal(Object.hasOwn(config.mcpServers.syntx.env, "SYNTX_OWNER_WAN25_I2V_PREVIEW_FFPROBE_PATH"), false);
  assert.equal(Object.hasOwn(config.mcpServers.syntx.env, "SYNTX_OWNER_WAN25_I2V_PREVIEW_FFMPEG_PATH"), false);

  const stdout = [], stderr = [];
  assert.equal(await main([CONFIRM], { entryUrl: pathToFileURL(SCRIPT).href,
    writeStdout: (value) => stdout.push(value), writeStderr: (value) => stderr.push(value) }), 0);
  assert.equal(stderr.join(""), "");
  const emitted = JSON.parse(stdout.join(""));
  assert.equal(emitted.mcpServers.syntx.env.SYNTX_OWNER_WAN25_I2V_PREVIEW, "1");
  assert.equal(emitted.mcpServers.syntx.args[0].endsWith("dist/src/transports/stdio-owner.js"), true);
});
