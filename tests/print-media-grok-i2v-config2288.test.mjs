import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaMcpConfig,
  main,
  parseArguments,
  INCLUDE_GROK_I2V_FLAG,
  PAID_TOOLS_CONFIRMATION_FLAG
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_URL = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;

test("2288 Grok I2V is independently selected after paid confirmation and remains default off", async () => {
  assert.equal(INCLUDE_GROK_I2V_FLAG, "--include-grok-i2v");
  const build = (selection) => buildMediaMcpConfig(SCRIPT_URL, process.execPath, selection).mcpServers.syntx.env;
  const baseline = build(undefined);
  assert.equal(Object.hasOwn(baseline, "SYNTX_OWNER_GROK_I2V"), false);
  assert.equal(Object.hasOwn(baseline, "SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION"), false);

  assert.deepEqual(parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_GROK_I2V_FLAG]),
    { kind: "emit", includeGrokI2v: true });
  assert.throws(() => parseArguments([INCLUDE_GROK_I2V_FLAG, PAID_TOOLS_CONFIRMATION_FLAG]));
  assert.throws(() => parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_GROK_I2V_FLAG, INCLUDE_GROK_I2V_FLAG]));

  const selected = build({ includeGrokI2v: true });
  assert.deepEqual(selected, { ...baseline,
    SYNTX_OWNER_GROK_I2V: "1",
    SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION: "<uploaded|hidden>"
  });
  assert.deepEqual(build({ includeGrokI2v: false }), baseline);

  let output = "";
  assert.equal(await main([PAID_TOOLS_CONFIRMATION_FLAG, INCLUDE_GROK_I2V_FLAG], {
    entryUrl: SCRIPT_URL, nodeExecutable: process.execPath, writeStdout: (text) => { output += text; }
  }), 0);
  assert.equal(JSON.parse(output).mcpServers.syntx.env.SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION, "<uploaded|hidden>");
  let help = "";
  await main(["--help"], { writeStdout: (text) => { help += text; } });
  assert.match(help, /--include-grok-i2v/u);
  assert.match(help, /SYNTX_OWNER_GROK_I2V_UPLOAD_DESTINATION/u);
  assert.match(help, /no enforceable provider cost cap/iu);
});

test("2288 Grok I2V selection keeps validation default and avoids evaluating getters", () => {
  assert.throws(() => parseArguments([INCLUDE_GROK_I2V_FLAG]));
  assert.throws(() => parseArguments([PAID_TOOLS_CONFIRMATION_FLAG, "--include-grok-i2v="]));
  let getterCalls = 0;
  const selection = Object.defineProperty({}, "includeGrokI2v", {
    enumerable: true,
    get() { getterCalls += 1; return true; }
  });
  assert.throws(() => buildMediaMcpConfig(SCRIPT_URL, process.execPath, selection));
  assert.equal(getterCalls, 0);
  for (const bad of [{ includeGrokI2v: 1 }, { includeGrokI2v: true, extra: false }, new Proxy({ includeGrokI2v: true }, {})]) {
    assert.throws(() => buildMediaMcpConfig(SCRIPT_URL, process.execPath, bad));
  }
});
