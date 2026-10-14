import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig, main, PAID_TOOLS_CONFIRMATION_FLAG } from "../scripts/print-media-mcp-config.mjs";

test("Hailuo-02 I2V is enabled only in the explicitly confirmed owner media config", async () => {
  let defaultOutput = "";
  assert.equal(await main([], { writeStdout: (value) => { defaultOutput += value; } }), 0);
  assert.match(defaultOutput, /Without the exact confirmation flag, no configuration is emitted/u);
  assert.doesNotMatch(defaultOutput, /"mcpServers"/u);

  let confirmedOutput = "";
  assert.equal(await main([PAID_TOOLS_CONFIRMATION_FLAG], { writeStdout: (value) => { confirmedOutput += value; } }), 0);
  const confirmed = JSON.parse(confirmedOutput);
  assert.equal(confirmed.mcpServers.syntx.env.SYNTX_OWNER_HAILUO02_I2V, "1");

  const config = buildMediaMcpConfig("file:///tmp/syntx/scripts/print-media-mcp-config.mjs", "/usr/bin/node");
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_HAILUO02_I2V, "1");
  assert.equal(Object.hasOwn(env, "SYNTX_OWNER_HAILUO02_I2V"), true);
  assert.equal(PAID_TOOLS_CONFIRMATION_FLAG, "--confirm-enable-paid-tools");
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA, "1");
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA_FFPROBE_PATH, "<absolute path to ffprobe>");
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA_UPLOAD_DESTINATION, "<uploaded|hidden>");
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS, "1");
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS_FFPROBE_PATH, "<absolute path to ffprobe>");
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS_UPLOAD_DESTINATION, "<uploaded|hidden>");
  assert.equal(Object.hasOwn(env, "SYNTX_OWNER_HAILUO02_I2V_FFPROBE_PATH"), false);
  assert.equal(Object.hasOwn(env, "SYNTX_OWNER_HAILUO02_I2V_UPLOAD_DESTINATION"), false);
});

test("media config help documents the Hailuo-02 I2V paid opt-in", async () => {
  const stdout = [];
  const stderr = [];
  const result = await main(["--help"], {
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text)
  });
  assert.equal(result, 0);
  assert.equal(stderr.join(""), "");
  assert.ok(stdout.join("").includes("SYNTX_OWNER_HAILUO02_I2V=1"));
});
