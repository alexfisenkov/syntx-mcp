import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../scripts/print-media-mcp-config.mjs";

test("FirstLast config is emitted only by the explicit paid-tools configuration route", async () => {
  const entryUrl = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
  const help = [], output = [], errors = [];
  assert.equal(await main([], { entryUrl, writeStdout: text => help.push(text), writeStderr: text => errors.push(text) }), 0);
  assert.equal(help.join("").includes('"mcpServers"'), false);
  assert.equal(await main(["--confirm-enable-paid-tools"], {
    entryUrl, writeStdout: text => output.push(text), writeStderr: text => errors.push(text)
  }), 0);
  const config = JSON.parse(output.join(""));
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_FIRST_LAST_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_DURABLE_GENERATION, "0");
  assert.equal(errors.join(""), "");
});
