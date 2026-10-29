import assert from "node:assert/strict";
import test from "node:test";
import { buildMediaMcpConfig, main, parseArguments, MediaMcpConfigCliError } from "../scripts/print-media-mcp-config.mjs";
import { pathToFileURL } from "node:url";

const entry = new URL("../scripts/print-media-mcp-config.mjs", import.meta.url).href;
const confirmation = "--confirm-enable-paid-tools";

test("all-supported-media requires existing paid confirmation and expands the reviewed include set", () => {
  assert.throws(() => parseArguments(["--include-all-supported-media"]), MediaMcpConfigCliError);
  const parsed = parseArguments([confirmation, "--include-all-supported-media"]);
  assert.equal(parsed.includeAllSupportedMedia, true);
  for (const field of ["includeKling4", "includeWan27VideoEdit", "includeSeedanceEditor", "includeRunwayI2v", "includeGrokI2v", "includeWan25T2vPreview", "includeHiggsfieldDop", "includeHailuoInitial", "includeHappyHorse", "includeWan27I2v", "includeSeedance25T2v", "includeKlingMedia", "includeSwitchxVideo", "includeActTwo", "includeHeygen4", "includeExistingVideoRecovery"]) {
    assert.equal(parsed[field], true, field);
  }
  assert.equal("includeSelfUpdate" in parsed, false);
});

test("all-supported-media CLI output enables its generic and pinned Grok routes without self-update", async () => {
  const stdout = [];
  const stderr = [];
  const code = await main([confirmation, "--include-all-supported-media"], {
    entryUrl: entry,
    nodeExecutable: process.execPath,
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value)
  });
  assert.equal(code, 0);
  assert.equal(stderr.join(""), "");
  const env = JSON.parse(stdout.join("")).mcpServers.syntx.env;
  assert.equal(env.SYNTX_OWNER_GENERATE_IMAGE, "1");
  assert.equal(env.SYNTX_OWNER_GENERATE_VIDEO, "1");
  assert.equal(env.SYNTX_OWNER_GROK_IMAGE_REFERENCES, "1");
  assert.equal(env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION, "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json");
  assert.equal(env.SYNTX_SELF_UPDATE, undefined);
});

test("self-update environment opt-in stays separate and off by default", () => {
  const defaultConfig = buildMediaMcpConfig(entry, process.execPath);
  assert.equal(defaultConfig.mcpServers.syntx.env.SYNTX_SELF_UPDATE, undefined);
  assert.equal(defaultConfig.mcpServers.syntx.env.SYNTX_OWNER_GENERATE_VIDEO, "0");
  assert.equal(defaultConfig.mcpServers.syntx.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES, "0");
  const selectedConfig = buildMediaMcpConfig(entry, process.execPath, { includeSelfUpdate: true });
  assert.equal(selectedConfig.mcpServers.syntx.env.SYNTX_SELF_UPDATE, "1");
  const allMediaConfig = buildMediaMcpConfig(entry, process.execPath, { includeAllSupportedMedia: true });
  assert.equal(allMediaConfig.mcpServers.syntx.env.SYNTX_OWNER_GENERATE_IMAGE, "1");
  assert.equal(allMediaConfig.mcpServers.syntx.env.SYNTX_OWNER_GENERATE_VIDEO, "1");
  assert.equal(allMediaConfig.mcpServers.syntx.env.SYNTX_OWNER_GROK_IMAGE_REFERENCES, "1");
  assert.equal(allMediaConfig.mcpServers.syntx.env.SYNTX_OWNER_GROK_REFERENCE_PROFILE_VERSION, "sha256-87f53d7f198a6550038a59279948e10b251a4138509bf76c25c791c990d66299.json");
  assert.equal(allMediaConfig.mcpServers.syntx.env.SYNTX_OWNER_KLING4, "1");
  assert.throws(() => buildMediaMcpConfig(entry, process.execPath, { includeSelfUpdate: "1" }), MediaMcpConfigCliError);
});
