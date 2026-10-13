#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SYNTX_MEDIA_MCP_BIN = "syntx-mcp-media-config";
export const PAID_TOOLS_CONFIRMATION_FLAG = "--confirm-enable-paid-tools";

const ENABLED_FLAGS = Object.freeze([
  "SYNTX_OWNER_ACCOUNT_STATUS",
  "SYNTX_OWNER_CLARITY_UPSCALE",
  "SYNTX_OWNER_MAGNIFIC_UPSCALE",
  "SYNTX_OWNER_KONTEXT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_IMAGE_REFERENCES",
  "SYNTX_OWNER_STANDARD_IMAGE_REFERENCES",
  "SYNTX_OWNER_RUNWAY_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_SEEDREAM_EDITOR_IMAGE_REFERENCES",
  "SYNTX_OWNER_FLUX_IMAGE_REFERENCES",
  "SYNTX_OWNER_IDEOGRAM_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES",
  "SYNTX_OWNER_UNI_IMAGE_REFERENCES",
  "SYNTX_OWNER_SOUL_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2I_IMAGE",
  "SYNTX_OWNER_BANANA_INPAINT_IMAGE_REFERENCES",
  "SYNTX_OWNER_WAN_T2V_VIDEOS",
  "SYNTX_OWNER_ELEVENLABS_TTS",
  "SYNTX_OWNER_ELEVENLABS_DIALOGUE",
  "SYNTX_OWNER_SUNO_GENERATION",
  "SYNTX_OWNER_LUMA_T2V",
  "SYNTX_OWNER_HAILUO01_T2V",
  "SYNTX_OWNER_HAILUO01_DIRECTOR_T2V",
  "SYNTX_OWNER_HAILUO23_T2V",
  "SYNTX_OWNER_HAILUO02_T2V",
  "SYNTX_OWNER_VIDEO2AUDIO"
]);

const DISABLED_FLAGS = Object.freeze([
  "SYNTX_OWNER_IMAGE_REFERENCES",
  "SYNTX_OWNER_GROK_IMAGE_REFERENCES",
  "SYNTX_OWNER_UPLOADED_FILES",
  "SYNTX_OWNER_UPLOAD_FILE",
  "SYNTX_OWNER_RECONCILE_UPLOADED_FILE",
  "SYNTX_OWNER_GENERATE_IMAGE",
  "SYNTX_OWNER_GENERATE_VIDEO",
  "SYNTX_OWNER_GENERATE_CONTRACT_MEDIA",
  "SYNTX_OWNER_DURABLE_GENERATION",
  "SYNTX_OWNER_SOUL_CATALOG_SHAPE",
  "SYNTX_OWNER_SOUL_STYLE_OPTIONS"
]);

const HELP_TEXT = [
  "Print a local stdio MCP configuration for the existing owner media tools.",
  "",
  "Usage:",
  `  ${SYNTX_MEDIA_MCP_BIN} ${PAID_TOOLS_CONFIRMATION_FLAG}`,
  "  node scripts/print-media-mcp-config.mjs --help",
  "",
  "Without the exact confirmation flag, no configuration is emitted.",
  "This command does not edit client settings, read credentials, log in, or call the network.",
  "The emitted tools can perform paid generation only when explicitly called by the client."
].join("\n") + "\n";

export class MediaMcpConfigCliError extends Error {
  constructor() {
    super("MEDIA_MCP_CONFIG_ARGUMENTS_INVALID");
    this.name = "MediaMcpConfigCliError";
    this.code = "MEDIA_MCP_CONFIG_ARGUMENTS_INVALID";
  }
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new MediaMcpConfigCliError();
  }
  if (argv.length === 0 || (argv.length === 1 && argv[0] === "--help")) {
    return Object.freeze({ kind: "help" });
  }
  if (argv.length === 1 && argv[0] === PAID_TOOLS_CONFIRMATION_FLAG) {
    return Object.freeze({ kind: "emit" });
  }
  throw new MediaMcpConfigCliError();
}

export function buildMediaMcpConfig(entryUrl, nodeExecutable) {
  if (typeof entryUrl !== "string" || typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
    throw new MediaMcpConfigCliError();
  }

  let scriptPath;
  try {
    const parsedUrl = new URL(entryUrl);
    if (parsedUrl.protocol !== "file:") throw new Error("invalid URL protocol");
    scriptPath = fileURLToPath(parsedUrl);
  } catch {
    throw new MediaMcpConfigCliError();
  }

  const packageRoot = resolve(dirname(scriptPath), "..");
  const ownerStdioEntrypoint = resolve(packageRoot, "dist", "src", "transports", "stdio-owner.js");
  const env = Object.fromEntries([
    ...ENABLED_FLAGS.map((flag) => [flag, "1"]),
    ...DISABLED_FLAGS.map((flag) => [flag, "0"])
  ]);

  return Object.freeze({
    mcpServers: Object.freeze({
      syntx: Object.freeze({
        command: nodeExecutable,
        args: Object.freeze([ownerStdioEntrypoint]),
        env: Object.freeze(env)
      })
    })
  });
}

export async function main(argv, options = {}) {
  const writeStdout = options.writeStdout ?? ((text) => process.stdout.write(text));
  const writeStderr = options.writeStderr ?? ((text) => process.stderr.write(text));
  try {
    const parsed = parseArguments(argv);
    if (parsed.kind === "help") {
      writeStdout(HELP_TEXT);
      return 0;
    }
    const config = buildMediaMcpConfig(options.entryUrl ?? import.meta.url, options.nodeExecutable ?? process.execPath);
    writeStdout(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch {
    writeStderr("MEDIA_MCP_CONFIG_ARGUMENTS_INVALID\n");
    return 2;
  }
}

const entry = process.argv[1];
if (entry !== undefined) {
  try {
    if (realpathSync(fileURLToPath(import.meta.url)) === realpathSync(resolve(entry))) {
      process.exitCode = await main(process.argv.slice(2));
    }
  } catch {
    process.exitCode = 2;
  }
}
