import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig, main, parseArguments, PAID_TOOLS_CONFIRMATION_FLAG } from "../scripts/print-media-mcp-config.mjs";

test("Topaz Astra media config is opt-in and requires explicit operator settings", async () => {
  assert.deepEqual(parseArguments([]), { kind: "help" });
  assert.deepEqual(parseArguments(["--help"]), { kind: "help" });
  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG]), { kind: "emit" });

  let defaultOutput = "";
  assert.equal(await main([], { writeStdout: (value) => { defaultOutput += value; } }), 0);
  assert.match(defaultOutput, /Without the exact confirmation flag, no configuration is emitted/u);
  assert.doesNotMatch(defaultOutput, /"mcpServers"/u);

  const config = buildMediaMcpConfig("file:///tmp/syntx/scripts/print-media-mcp-config.mjs", "/usr/bin/node");
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA, "1");
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA_FFPROBE_PATH, "<absolute path to ffprobe>");
  assert.equal(env.SYNTX_OWNER_TOPAZ_ASTRA_UPLOAD_DESTINATION, "<uploaded|hidden>");
});
