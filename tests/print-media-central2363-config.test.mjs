import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig, parseArguments } from "../scripts/print-media-mcp-config.mjs";

const entryUrl = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
const CONFIRM = "--confirm-enable-paid-tools";
const groups = [
  { flag: "--include-acttwo", key: "includeActTwo", env: "SYNTX_OWNER_ACTTWO", extra: {
    SYNTX_OWNER_ACTTWO_UPLOAD_DESTINATION: "<uploaded|hidden>",
    SYNTX_OWNER_ACTTWO_FFPROBE_PATH: "<absolute path to trusted ffprobe executable>"
  } },
  { flag: "--include-heygen4", key: "includeHeygen4", env: "SYNTX_OWNER_HEYGEN4", extra: {
    SYNTX_OWNER_HEYGEN4_FFPROBE_PATH: "<absolute path to trusted ffprobe executable>"
  } },
  { flag: "--include-existing-video-recovery", key: "includeExistingVideoRecovery", env: "SYNTX_OWNER_EXISTING_VIDEO_RECOVERY", extra: {} }
];

test("ActTwo, HeyGen 4, and read-only existing-video recovery are independent and default off", () => {
  const baseline = buildMediaMcpConfig(entryUrl, process.execPath).mcpServers.syntx.env;
  for (const group of groups) {
    assert.deepEqual(parseArguments([CONFIRM, group.flag]), { kind: "emit", [group.key]: true });
    assert.throws(() => parseArguments([group.flag]));
    assert.equal(baseline[group.env], "0");
    const selected = buildMediaMcpConfig(entryUrl, process.execPath, { [group.key]: true }).mcpServers.syntx.env;
    assert.deepEqual(Object.fromEntries(Object.entries(selected).filter(([key, value]) => baseline[key] !== value)), {
      [group.env]: "1", ...group.extra
    });
  }
  const all = parseArguments([CONFIRM, ...groups.map(({ flag }) => flag)]);
  assert.deepEqual(all, { kind: "emit", includeActTwo: true, includeHeygen4: true, includeExistingVideoRecovery: true });
});
