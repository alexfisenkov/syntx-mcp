import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { buildMediaMcpConfig, main, parseArguments } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const CONFIRMATION = "--confirm-enable-paid-tools";

test("WAN26 I2V config appears only behind the existing exact paid-tools confirmation", async () => {
  assert.deepEqual(parseArguments([CONFIRMATION]), { kind: "emit" });
  assert.throws(() => parseArguments([CONFIRMATION, "--wan26"]));

  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, process.execPath);
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_WAN26_I2V, "1");
  assert.equal(env.SYNTX_OWNER_WAN26_I2V_FFPROBE_PATH, "<absolute path to trusted ffprobe executable>");

  for (const [name, value] of [
    ["SYNTX_OWNER_WAN_IMAGE_REFERENCES", "1"],
    ["SYNTX_OWNER_WAN_T2V_VIDEOS", "1"],
    ["SYNTX_OWNER_WAN27_R2V", "1"],
    ["SYNTX_OWNER_KLING_I2V", "1"],
    ["SYNTX_OWNER_GENERATE_VIDEO", "0"]
  ]) assert.equal(env[name], value);

  const originalFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = async () => {
    fetchCalls += 1;
    throw new Error("config helper must remain offline");
  };
  try {
    const stdout = [], stderr = [];
    const exitCode = await main([CONFIRMATION], {
      entryUrl: pathToFileURL(SCRIPT_PATH).href,
      nodeExecutable: process.execPath,
      writeStdout: (chunk) => stdout.push(chunk),
      writeStderr: (chunk) => stderr.push(chunk)
    });
    assert.equal(exitCode, 0);
    assert.equal(stderr.join(""), "");
    assert.equal(stdout.length, 1);
    const emitted = JSON.parse(stdout.join(""));
    assert.equal(emitted.mcpServers.syntx.env.SYNTX_OWNER_WAN26_I2V, "1");
    assert.equal(fetchCalls, 0);

    const rejectedStdout = [], rejectedStderr = [];
    const rejectedCode = await main([CONFIRMATION, "--other"], {
      entryUrl: pathToFileURL(SCRIPT_PATH).href,
      nodeExecutable: process.execPath,
      writeStdout: (chunk) => rejectedStdout.push(chunk),
      writeStderr: (chunk) => rejectedStderr.push(chunk)
    });
    assert.equal(rejectedCode, 2);
    assert.equal(rejectedStdout.join(""), "");
    assert.equal(rejectedStderr.join(""), "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
    assert.equal(fetchCalls, 0);

    const helpOutput = [], helpErrors = [];
    const helpCode = await main([], {
      writeStdout: (chunk) => helpOutput.push(chunk),
      writeStderr: (chunk) => helpErrors.push(chunk)
    });
    assert.equal(helpCode, 0);
    assert.equal(helpErrors.join(""), "");
    assert.match(helpOutput.join(""), /Without the exact confirmation flag, no configuration is emitted/u);
    assert.doesNotMatch(helpOutput.join(""), /"mcpServers"/u);
    assert.doesNotMatch(helpOutput.join(""), /SYNTX_OWNER_WAN26_I2V/u);
    assert.equal(fetchCalls, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
