import assert from "node:assert/strict";
import test from "node:test";
import { main } from "../scripts/print-media-mcp-config.mjs";

test("WAN 3.0 Edit config is emitted only through the existing paid-tools confirmation route", async () => {
  const entryUrl = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
  const helpOutput = [], helpErrors = [];
  assert.equal(await main([], { entryUrl, writeStdout: text => helpOutput.push(text), writeStderr: text => helpErrors.push(text) }), 0);
  assert.equal(helpOutput.join("").includes('"mcpServers"'), false);
  assert.equal(helpErrors.join(""), "");
  assert.match(helpOutput.join(""), /ffprobe runs only when the upload tool is explicitly called/iu);

  const output = [], errors = [];
  assert.equal(await main(["--confirm-enable-paid-tools"], {
    entryUrl, writeStdout: text => output.push(text), writeStderr: text => errors.push(text)
  }), 0);
  const config = JSON.parse(output.join(""));
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_EDIT_VIDEOS, "1");
  assert.equal(config.mcpServers.syntx.env.SYNTX_OWNER_WAN30_EDIT_FFPROBE_PATH,
    "<absolute path to trusted ffprobe executable>");
  assert.equal(errors.join(""), "");
});
