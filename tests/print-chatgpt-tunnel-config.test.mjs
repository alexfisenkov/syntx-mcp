import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  buildChatGptTunnelConfig,
  main,
  parseArguments
} from "../scripts/print-chatgpt-tunnel-config.mjs";

const TUNNEL_ID = "tunnel_0123456789abcdef0123456789abcdef";
const API_KEY_ENV = "OPENAI_API_KEY";

test("requires an explicit valid tunnel id and accepts only an environment variable name", () => {
  assert.deepEqual(parseArguments(["--tunnel-id", TUNNEL_ID]), {
    kind: "emit",
    tunnelId: TUNNEL_ID,
    apiKeyEnv: API_KEY_ENV
  });
  assert.deepEqual(parseArguments([
    "--tunnel-id", TUNNEL_ID,
    "--api-key-env", "OPENAI_RUNTIME_KEY_2"
  ]), {
    kind: "emit",
    tunnelId: TUNNEL_ID,
    apiKeyEnv: "OPENAI_RUNTIME_KEY_2"
  });
  assert.throws(() => parseArguments([]));
  assert.throws(() => parseArguments(["--tunnel-id", "tunnel_fake"]));
  assert.throws(() => parseArguments(["--tunnel-id", TUNNEL_ID, "--api-key-env", "bad-name"]));
  assert.throws(() => parseArguments(["--tunnel-id", TUNNEL_ID, "--api-key-env", "OPENAI-API-KEY"]));
});

test("builds the official main-channel stdio profile without losing the existing owner flags", () => {
  const config = buildChatGptTunnelConfig({
    tunnelId: TUNNEL_ID,
    apiKeyEnv: API_KEY_ENV,
    entryUrl: "file:///tmp/SYNTX%20Owner/scripts/print-chatgpt-tunnel-config.mjs",
    nodeExecutable: "/runtime with spaces/quote\"/backslash\\segment/newline\nbuild-雪/node"
  });

  assert.deepEqual(config.control_plane, {
    base_url: "https://api.openai.com",
    tunnel_id: TUNNEL_ID,
    api_key: `env:${API_KEY_ENV}`
  });
  assert.equal(config.mcp.commands.length, 1);
  assert.equal(config.mcp.commands[0].channel, "main");

  const argv = parseTunnelCommand(config.mcp.commands[0].command);
  assert.equal(argv[0], "/runtime with spaces/quote\"/backslash\\segment/newline\nbuild-雪/node");
  assert.equal(argv[1], "-e");
  assert.equal(argv[3], "/tmp/SYNTX Owner/dist/src/transports/stdio-owner.js");
  assert.match(argv[2], /Object\.assign\(process\.env,ownerEnv\)/u);
  assert.match(argv[2], /pathToFileURL\(process\.argv\[1\]\)/u);
  assert.match(argv[2], /process\.env\.SYNTX_SELF_UPDATE="0"/u);
  assert.doesNotMatch(config.mcp.commands[0].command, /(?:^|\s)(?:sh|bash|cmd\.exe|powershell)(?:\s|$)/iu);

  const environment = JSON.parse(argv[2].match(/const ownerEnv=(\{.*\});const missing=/u)[1]);
  assert.equal(environment.SYNTX_OWNER_MEDIA_PROFILE, "all-supported");
  assert.equal(environment.SYNTX_OWNER_GENERATE_IMAGE, "1");
  assert.equal(environment.SYNTX_OWNER_GENERATE_VIDEO, "1");
  assert.equal(environment.SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION, "<uploaded|hidden>");
  assert.equal(environment.SYNTX_SELF_UPDATE, undefined);
  assert.equal(config.control_plane.api_key, "env:OPENAI_API_KEY");
  assert.equal(JSON.stringify(config).includes("OPENAI-API-KEY"), false);
});

test("fails before importing stdio when generated placeholders lack valid operator overrides", () => {
  const config = buildChatGptTunnelConfig({
    tunnelId: TUNNEL_ID,
    entryUrl: "file:///tmp/SYNTX/scripts/print-chatgpt-tunnel-config.mjs",
    nodeExecutable: process.execPath
  });
  const argv = parseTunnelCommand(config.mcp.commands[0].command);
  const result = runNodeEval(argv[2], "/does/not/import/owner-stdio.js");
  assert.equal(result.status, 2);
  assert.match(result.stderr, /SYNTX owner MCP requires valid operator values for:/u);
  assert.match(result.stderr, /SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION/u);
  assert.doesNotMatch(result.stderr, /<uploaded\|hidden>|absolute path|not\/import/u);
});

test("accepts only valid same-name operator overrides for generated placeholders", () => {
  const config = buildChatGptTunnelConfig({
    tunnelId: TUNNEL_ID,
    entryUrl: "file:///tmp/SYNTX/scripts/print-chatgpt-tunnel-config.mjs",
    nodeExecutable: process.execPath
  });
  const argv = parseTunnelCommand(config.mcp.commands[0].command);
  const ownerEnv = JSON.parse(argv[2].match(/const ownerEnv=(\{.*\});const missing=/u)[1]);
  const overrides = Object.fromEntries(Object.entries(ownerEnv)
    .filter(([, value]) => typeof value === "string" && value.startsWith("<") && value.endsWith(">"))
    .map(([key]) => [key, key.endsWith("_UPLOAD_DESTINATION") ? "hidden" : "/synthetic/trusted-tool"]));
  const accepted = runNodeEval(argv[2], "/does/not/import/owner-stdio.js", overrides);
  assert.equal(accepted.status, 1);
  assert.equal(accepted.stderr, "SYNTX owner stdio process failed to import.\n");

  overrides.SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION = "not-a-valid-destination";
  const rejected = runNodeEval(argv[2], "/does/not/import/owner-stdio.js", overrides);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /SYNTX_OWNER_HIGGSFIELD_DOP_UPLOAD_DESTINATION/u);
  assert.doesNotMatch(rejected.stderr, /not-a-valid-destination|<uploaded\|hidden>/u);
});

test("prints JSON-compatible tunnel YAML and keeps help/invalid arguments offline", async () => {
  const stdout = [];
  const stderr = [];
  assert.equal(await main(["--tunnel-id", TUNNEL_ID], {
    entryUrl: "file:///tmp/SYNTX/scripts/print-chatgpt-tunnel-config.mjs",
    nodeExecutable: "/usr/bin/node",
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value)
  }), 0);
  assert.equal(JSON.parse(stdout.join("")).control_plane.tunnel_id, TUNNEL_ID);
  assert.deepEqual(stderr, []);

  stdout.length = 0;
  assert.equal(await main(["--help"], {
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value)
  }), 0);
  assert.match(stdout.join(""), /--tunnel-id/u);

  stderr.length = 0;
  assert.equal(await main(["--tunnel-id", "bad"], {
    writeStdout: (value) => stdout.push(value),
    writeStderr: (value) => stderr.push(value)
  }), 2);
  assert.deepEqual(stderr, ["CHATGPT_TUNNEL_CONFIG_ARGUMENTS_INVALID\n"]);
});

function parseTunnelCommand(command) {
  const args = [];
  let current = "";
  let quoted = false;
  let escaped = false;
  for (const character of command) {
    if (escaped) {
      current += character;
      escaped = false;
    } else if (quoted && character === "\\") {
      escaped = true;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (!quoted && /\s/u.test(character)) {
      if (current !== "") {
        args.push(current);
        current = "";
      }
    } else {
      current += character;
    }
  }
  assert.equal(quoted, false, "command must have balanced quotes");
  assert.equal(escaped, false, "command must not end with an escape");
  if (current !== "") args.push(current);
  return args;
}

function runNodeEval(source, ownerScriptPath, env = {}) {
  const result = spawnSync(process.execPath, ["-e", source, ownerScriptPath], {
    encoding: "utf8",
    env
  });
  if (result.error) throw result.error;
  return result;
}
