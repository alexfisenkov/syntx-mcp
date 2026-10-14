import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig } from "../scripts/print-media-mcp-config.mjs";

test("paid media config exposes STS with explicit operator placeholders and no destination default", () => {
  const config = buildMediaMcpConfig("file:///tmp/syntx/scripts/print-media-mcp-config.mjs", "/usr/bin/node");
  const env = config.mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS, "1");
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS_FFPROBE_PATH, "<absolute path to ffprobe>");
  assert.equal(env.SYNTX_OWNER_ELEVENLABS_STS_UPLOAD_DESTINATION, "<uploaded|hidden>");
});
