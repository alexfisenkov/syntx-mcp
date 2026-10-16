import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../scripts/print-media-mcp-config.mjs";

test("WAN 3.0 Reference config is emitted only through the paid-tools confirmation route", async () => {
  const entryUrl = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
  const helpOutput = [], helpErrors = [];
  assert.equal(await main([], { entryUrl, writeStdout: text => helpOutput.push(text), writeStderr: text => helpErrors.push(text) }), 0);
  assert.equal(helpOutput.join("").includes('"mcpServers"'), false);
  assert.equal(helpErrors.join(""), "");

  const output = [], errors = [];
  assert.equal(await main(["--confirm-enable-paid-tools"], {
    entryUrl, writeStdout: text => output.push(text), writeStderr: text => errors.push(text)
  }), 0);
  const config = JSON.parse(output.join(""));
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_REFERENCE_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_DURABLE_GENERATION, "0");
  assert.equal(errors.join(""), "");

  const deniedOutput = [], deniedErrors = [];
  assert.equal(await main(["--not-confirmed"], {
    entryUrl, writeStdout: text => deniedOutput.push(text), writeStderr: text => deniedErrors.push(text)
  }), 2);
  assert.equal(deniedOutput.join(""), "");
  assert.equal(deniedErrors.join(""), "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
});
