import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMediaMcpConfig,
  main,
  parseArguments,
  MediaMcpConfigCliError
} from "../scripts/print-media-mcp-config.mjs";

const SCRIPT_URL = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
const NODE = process.execPath;
const CONFIRM = "--confirm-enable-paid-tools";
const WAN25 = "--include-wan25-t2v-preview";
const DOP = "--include-higgsfield-dop";

test("2318 WAN 2.5 T2V is independently default-off in config and CLI help", async () => {
  const base = buildMediaMcpConfig(SCRIPT_URL, NODE).mcpServers.syntx.env;
  assert.equal(Object.hasOwn(base, "SYNTX_OWNER_WAN25_T2V_PREVIEW"), false);
  assert.equal(Object.hasOwn(base, "SYNTX_OWNER_HIGGSFIELD_DOP"), false);
  assert.equal(Object.hasOwn(base, "SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION"), false);

  const stdout = [], stderr = [];
  assert.equal(await main([], { entryUrl: SCRIPT_URL, nodeExecutable: NODE,
    writeStdout: value => stdout.push(value), writeStderr: value => stderr.push(value) }), 0);
  assert.equal(stderr.join(""), "");
  assert.match(stdout.join(""), /--include-wan25-t2v-preview/u);
  assert.match(stdout.join(""), /--include-higgsfield-dop/u);
  assert.doesNotMatch(stdout.join(""), /"mcpServers"/u);
});

test("2318 each include switch is independent and emits only its exact env additions", () => {
  const base = buildMediaMcpConfig(SCRIPT_URL, NODE).mcpServers.syntx.env;
  const wan = buildMediaMcpConfig(SCRIPT_URL, NODE, { includeWan25T2vPreview: true }).mcpServers.syntx.env;
  assert.equal(wan.SYNTX_OWNER_WAN25_T2V_PREVIEW, "1");
  assert.equal(Object.hasOwn(wan, "SYNTX_OWNER_HIGGSFIELD_DOP"), false);
  assert.equal(Object.hasOwn(wan, "SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION"), false);
  assert.equal(Object.keys(wan).filter(key => /WAN25_T2V_PREVIEW_FFPROBE|WAN25_T2V_PREVIEW_FFMPEG/u.test(key)).length, 0);

  const dop = buildMediaMcpConfig(SCRIPT_URL, NODE, { includeHiggsfieldDop: true }).mcpServers.syntx.env;
  assert.equal(dop.SYNTX_OWNER_HIGGSFIELD_DOP, "1");
  assert.equal(dop.SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION, "<uploaded|hidden>");
  assert.equal(Object.hasOwn(dop, "SYNTX_OWNER_WAN25_T2V_PREVIEW"), false);
  assert.equal(Object.keys(dop).filter(key => /HIGGSFIELD_DOP.*FFPROBE/u.test(key)).length, 0);

  const added = (env, reference) => Object.fromEntries(Object.entries(env).filter(([key, value]) => reference[key] !== value));
  assert.deepEqual(added(wan, base), { SYNTX_OWNER_WAN25_T2V_PREVIEW: "1" });
  assert.deepEqual(added(dop, base), { SYNTX_OWNER_HIGGSFIELD_DOP: "1",
    SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION: "<uploaded|hidden>" });
});

test("2318 both include switches compose without changing confirmation or base env values", () => {
  const combined = buildMediaMcpConfig(SCRIPT_URL, NODE, { includeWan25T2vPreview: true, includeHiggsfieldDop: true }).mcpServers.syntx.env;
  assert.equal(combined.SYNTX_OWNER_WAN25_T2V_PREVIEW, "1");
  assert.equal(combined.SYNTX_OWNER_HIGGSFIELD_DOP, "1");
  assert.equal(combined.SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION, "<uploaded|hidden>");
  const base = buildMediaMcpConfig(SCRIPT_URL, NODE).mcpServers.syntx.env;
  for (const [key, value] of Object.entries(base)) assert.equal(combined[key], value, `${key} remains at its base value`);
  assert.equal(JSON.stringify(combined).includes("credentials"), false);
});

test("2318 CLI requires exact paid confirmation before either opt-in and rejects duplicate or reordered flags", async () => {
  assert.deepEqual(parseArguments([CONFIRM, WAN25]), { kind: "emit", includeWan25T2vPreview: true });
  assert.deepEqual(parseArguments([CONFIRM, DOP]), { kind: "emit", includeHiggsfieldDop: true });
  assert.deepEqual(parseArguments([CONFIRM, WAN25, DOP]), { kind: "emit", includeWan25T2vPreview: true, includeHiggsfieldDop: true });
  for (const args of [[WAN25], [DOP], [WAN25, CONFIRM], [CONFIRM, WAN25, WAN25], [CONFIRM, DOP, DOP],
    ["--confirm-enable-paid-tool", WAN25], [CONFIRM, "--include-higgsfield"]]) {
    assert.throws(() => parseArguments(args), MediaMcpConfigCliError);
    const stdout = [], stderr = [];
    assert.equal(await main(args, { entryUrl: SCRIPT_URL, nodeExecutable: NODE,
      writeStdout: value => stdout.push(value), writeStderr: value => stderr.push(value) }), 2);
    assert.equal(stdout.join(""), ""); assert.equal(stderr.join(""), "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
  }
});

test("2318 optional selection validation rejects accessors and unknown keys", () => {
  let getterCalls = 0;
  const accessor = {};
  Object.defineProperty(accessor, "includeHiggsfieldDop", { enumerable: true, get() { getterCalls++; return true; } });
  assert.throws(() => buildMediaMcpConfig(SCRIPT_URL, NODE, accessor), MediaMcpConfigCliError);
  assert.throws(() => buildMediaMcpConfig(SCRIPT_URL, NODE, { includeWan25T2vPreview: true, unknown: false }), MediaMcpConfigCliError);
  assert.equal(getterCalls, 0);
});
