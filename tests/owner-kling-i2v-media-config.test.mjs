import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import { buildMediaMcpConfig, main } from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_PATH = fileURLToPath(new URL("../scripts/print-media-mcp-config.mjs", import.meta.url));
const KLING_I2V_FLAG = ["SYNTX", "OWNER", "KLING", "I2V"].join("_");

test("paid owner media config explicitly enables Kling I2V once", () => {
  const config = buildMediaMcpConfig(pathToFileURL(SCRIPT_PATH).href, "/node/bin/node");
  const environment = config.mcpServers.syntx.env;
  assert.equal(environment[KLING_I2V_FLAG], "1");
  assert.equal(Object.keys(environment).filter((key) => key === KLING_I2V_FLAG).length, 1);
  assert.equal(environment.SYNTX_OWNER_KLING_T2V, "1");
});

test("media config help names the Kling I2V opt-in without emitting configuration", async () => {
  const stdout = [];
  const stderr = [];
  const result = await main(["--help"], {
    entryUrl: pathToFileURL(SCRIPT_PATH).href,
    writeStdout: (text) => stdout.push(text),
    writeStderr: (text) => stderr.push(text)
  });
  assert.equal(result, 0);
  assert.equal(stderr.join(""), "");
  assert.ok(stdout.join("").includes(`${KLING_I2V_FLAG}=1`));
});
