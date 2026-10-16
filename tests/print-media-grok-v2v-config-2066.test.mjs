import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { main, PAID_TOOLS_CONFIRMATION_FLAG } from "../scripts/print-media-mcp-config.mjs";

function invoke(args) {
  let stdout = "", stderr = "";
  return main(args, {
    entryUrl: pathToFileURL(resolve("scripts/print-media-mcp-config.mjs")).href,
    nodeExecutable: process.execPath,
    writeStdout(value) { stdout += value; },
    writeStderr(value) { stderr += value; }
  }).then((status) => ({ status, stdout, stderr }));
}

test("confirmed media config includes explicit default-off Grok V2V operator placeholders", async () => {
  const result = await invoke([PAID_TOOLS_CONFIRMATION_FLAG]);
  assert.equal(result.status, 0);
  assert.equal(result.stderr, "");
  const config = JSON.parse(result.stdout);
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_GROK_V2V, "1");
  assert.equal(env.SYNTX_OWNER_GROK_V2V_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");
  assert.equal(env.SYNTX_OWNER_GROK_V2V_UPLOAD_DESTINATION, "<uploaded|hidden>");
  assert.equal(env.SYNTX_OWNER_GROK_V2V_GENERATE, undefined);
});

test("help explains Grok V2V limits and startup behavior without emitting configuration", async () => {
  for (const args of [[], ["--help"]]) {
    const result = await invoke(args);
    assert.equal(result.status, 0);
    assert.equal(result.stderr, "");
    assert.match(result.stdout, /Grok V2V/iu);
    assert.match(result.stdout, /one MP4 or QuickTime original/i);
    assert.match(result.stdout, /1(?:\.0)?[–-]8\.7 seconds/i);
    assert.match(result.stdout, /duration and resolution are inferred locally/i);
    assert.match(result.stdout, /startup does not generate/i);
    assert.match(result.stdout, /no enforceable cost cap/i);
    assert.throws(() => JSON.parse(result.stdout));
  }
});

test("configuration is not emitted without the existing exact paid-tools confirmation", async () => {
  const result = await invoke(["--confirm-enable-paid-tools", "extra"]);
  assert.equal(result.status, 2);
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
});
