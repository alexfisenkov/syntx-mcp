#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { buildMediaMcpConfig } from "./print-media-mcp-config.mjs";

export const CHATGPT_TUNNEL_CONFIG_BIN = "syntx-mcp-chatgpt-tunnel-config";
export const DEFAULT_API_KEY_ENV = "OPENAI_API_KEY";
const TUNNEL_ID_PATTERN = /^tunnel_(?:[a-z0-9]{4}_)?[a-z0-9]{32}$/u;
const ENVIRONMENT_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u;

const HELP_TEXT = [
  "Print an OpenAI Secure MCP Tunnel YAML profile for the existing all-supported owner stdio server.",
  "Output is JSON, which is valid YAML; it contains the tunnel id and an environment-variable reference, never a key value.",
  "",
  "Usage:",
  `  ${CHATGPT_TUNNEL_CONFIG_BIN} --tunnel-id <tunnel_id> [--api-key-env <ENV_NAME>]`,
  `  node scripts/print-chatgpt-tunnel-config.mjs --help`,
  "",
  `The runtime API key must be available to tunnel-client in the named environment variable (default: ${DEFAULT_API_KEY_ENV}).`,
  "The generated stdio child receives the existing owner profile; replace every operator placeholder via a same-name environment variable before starting tunnel-client.",
  "This command only prints configuration; it does not read client settings, credentials or files, authenticate, or access the network.",
  "Owner media placeholders still require trusted operator values before use."
].join("\n") + "\n";

export class ChatGptTunnelConfigCliError extends Error {
  constructor() {
    super("CHATGPT_TUNNEL_CONFIG_ARGUMENTS_INVALID");
    this.name = "ChatGptTunnelConfigCliError";
    this.code = "CHATGPT_TUNNEL_CONFIG_ARGUMENTS_INVALID";
  }
}

export function parseArguments(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string")) {
    throw new ChatGptTunnelConfigCliError();
  }
  if (argv.length === 1 && argv[0] === "--help") return Object.freeze({ kind: "help" });
  let tunnelId;
  let apiKeyEnv = DEFAULT_API_KEY_ENV;
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if ((flag !== "--tunnel-id" && flag !== "--api-key-env") || seen.has(flag)) {
      throw new ChatGptTunnelConfigCliError();
    }
    seen.add(flag);
    const value = argv[index + 1];
    if (typeof value !== "string" || value.length === 0 || value.startsWith("--")) {
      throw new ChatGptTunnelConfigCliError();
    }
    index += 1;
    if (flag === "--tunnel-id") tunnelId = value;
    else apiKeyEnv = value;
  }
  if (typeof tunnelId !== "string" || !TUNNEL_ID_PATTERN.test(tunnelId) ||
      !ENVIRONMENT_NAME_PATTERN.test(apiKeyEnv)) {
    throw new ChatGptTunnelConfigCliError();
  }
  return Object.freeze({ kind: "emit", tunnelId, apiKeyEnv });
}

/** Build the tunnel-client v1 YAML schema using the existing local stdio profile. */
export function buildChatGptTunnelConfig({
  tunnelId,
  apiKeyEnv = DEFAULT_API_KEY_ENV,
  entryUrl = import.meta.url,
  nodeExecutable = process.execPath
}) {
  if (typeof tunnelId !== "string" || !TUNNEL_ID_PATTERN.test(tunnelId) ||
      typeof apiKeyEnv !== "string" || !ENVIRONMENT_NAME_PATTERN.test(apiKeyEnv) ||
      typeof nodeExecutable !== "string" || !isAbsolute(nodeExecutable)) {
    throw new ChatGptTunnelConfigCliError();
  }

  const ownerProfile = buildMediaMcpConfig(entryUrl, nodeExecutable, {
    includeAllSupportedMedia: true
  }).mcpServers.syntx;
  const bootstrap = [
    'const {isAbsolute}=require("node:path");',
    'const {pathToFileURL}=require("node:url");',
    `(async()=>{const ownerEnv=${JSON.stringify(ownerProfile.env)};const missing=[];`,
    'for(const [key,value] of Object.entries(ownerEnv)){if(typeof value!=="string"||!value.startsWith("<")||!value.endsWith(">"))continue;',
    'const override=process.env[key];const valid=typeof override==="string"&&override.length>0&&!/^<[^>]*>$/.test(override)&&',
    '(key.endsWith("_UPLOAD_DESTINATION")?["uploaded","hidden"].includes(override):/(?:_FFPROBE|_FFMPEG)_PATH$/.test(key)?isAbsolute(override):true);',
    'if(valid)ownerEnv[key]=override;else missing.push(key);}',
    'if(missing.length){console.error("SYNTX owner MCP requires valid operator values for: "+missing.sort().join(", "));process.exitCode=2;return;}',
    'Object.assign(process.env,ownerEnv);process.env.SYNTX_SELF_UPDATE="0";',
    'try{await import(pathToFileURL(process.argv[1]).href);}catch{console.error("SYNTX owner stdio process failed to import.");process.exitCode=1;}})();'
  ].join("");
  const argv = [ownerProfile.command, "-e", bootstrap, ...ownerProfile.args];

  return Object.freeze({
    config_version: 1,
    control_plane: Object.freeze({
      base_url: "https://api.openai.com",
      tunnel_id: tunnelId,
      api_key: `env:${apiKeyEnv}`
    }),
    mcp: Object.freeze({
      commands: Object.freeze([Object.freeze({
        channel: "main",
        // tunnel-client v0.0.19 accepts command as text, parses it into argv,
        // then starts the child directly; it does not route this through a shell.
        command: encodeTunnelArgv(argv)
      })])
    })
  });
}

function encodeTunnelArgv(argv) {
  if (!Array.isArray(argv) || argv.some((argument) => typeof argument !== "string" || argument.length === 0)) {
    throw new ChatGptTunnelConfigCliError();
  }
  return argv.map((argument) => `"${argument.replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`).join(" ");
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
    const config = buildChatGptTunnelConfig({
      tunnelId: parsed.tunnelId,
      apiKeyEnv: parsed.apiKeyEnv,
      entryUrl: options.entryUrl ?? import.meta.url,
      nodeExecutable: options.nodeExecutable ?? process.execPath
    });
    writeStdout(`${JSON.stringify(config, null, 2)}\n`);
    return 0;
  } catch {
    writeStderr("CHATGPT_TUNNEL_CONFIG_ARGUMENTS_INVALID\n");
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
