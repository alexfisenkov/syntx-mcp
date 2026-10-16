import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../scripts/print-media-mcp-config.mjs";

test("WAN 3.0 Omni config is emitted only through the paid-tools confirmation route", async () => {
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
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_OMNI_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_REFERENCE_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_DURABLE_GENERATION, "0");
  assert.equal(errors.join(""), "");
});
