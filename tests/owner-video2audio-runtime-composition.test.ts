import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { fileURLToPath } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerVideo2AudioFlag, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const TOOL_NAMES = [
  "syntx_owner_get_video2audio_source",
  "syntx_upload_video2audio_original",
  "syntx_owner_generate_video2audio",
  "syntx_owner_reconcile_video2audio",
  "syntx_owner_list_video2audio_recoveries",
  "syntx_owner_get_video2audio_result_page"
] as const;
const moduleUrl = new URL("../src/mcp/owner-video2audio-tools.js", import.meta.url).href;
const toolsModule = await import(moduleUrl).catch(() => null) as Record<string, unknown> | null;
const stdioUrl = new URL("../src/transports/stdio-owner.js", import.meta.url);
type Runtime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerVideo2AudioLifecycle?: { close(): Promise<void>; invalidateAttempt(id: string): Promise<void> };
};

test("Video2Audio MCP registrar exists", () => {
  assert.ok(toolsModule, "MISSING_OWNER_VIDEO2AUDIO_TOOLS_MODULE");
  assert.equal(typeof toolsModule.registerSyntxOwnerVideo2AudioTools, "function", "MISSING_OWNER_VIDEO2AUDIO_REGISTRAR");
});

test("MCP composition rejects structurally forged Video2Audio services", () => {
  const local = runtime();
  assert.throws(() => createMcpServer(local.application, { ownerVideo2Audio: {
    profile: { source: {} }, originalReferenceService: { uploadOriginal: async () => ({}) },
    generationService: { generate: async () => ({}), reconcile: async () => ({}), listRecoveries: async () => [], getResultPage: async () => ({}) }
  } } as never), /OWNER_VIDEO2AUDIO_COMPOSITION_INVALID/u);
});

function runtime(options: unknown = {}): Runtime {
  return Reflect.apply(createObservedOwnerRuntime, undefined, [options]) as Runtime;
}

async function connect(runtimeValue: Runtime) {
  const server = createMcpServer(runtimeValue.application, runtimeValue.serverOptions);
  const client = new Client({ name: "owner-video2audio-runtime-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

test("Video2Audio opt-in flag is strict and default-off", () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerVideo2AudioFlag(value), false);
  assert.equal(readOwnerVideo2AudioFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readOwnerVideo2AudioFlag(value), /Invalid SYNTX_OWNER_VIDEO2AUDIO configuration/u);
  }
});

test("Video2Audio is opt-in, registers exactly six strict tools, and keeps source-only metadata non-authorizing", async () => {
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected external request"); };
  const defaults = runtime({ fetchImpl });
  assert.equal(Reflect.get(defaults.serverOptions, "ownerVideo2Audio"), undefined);
  const defaultPair = await connect(defaults);
  let defaultNames: string[];
  try { defaultNames = (await defaultPair.client.listTools()).tools.map(({ name }) => name); }
  finally { await defaultPair.client.close(); await defaultPair.server.close(); }

  const enabled = runtime({ ownerVideo2AudioEnabled: true, fetchImpl });
  const composition = Reflect.get(enabled.serverOptions, "ownerVideo2Audio");
  assert.ok(composition, "MISSING_OWNER_VIDEO2AUDIO_COMPOSITION");
  try {
    const pair = await connect(enabled);
    try {
      const definitions = (await pair.client.listTools()).tools;
      const names = definitions.map(({ name }) => name);
      assert.deepEqual(names.filter((name) => (TOOL_NAMES as readonly string[]).includes(name)).sort(), [...TOOL_NAMES].sort());
      assert.deepEqual(names.filter((name) => !(TOOL_NAMES as readonly string[]).includes(name)).sort(), defaultNames.sort());
      for (const [toolName, expectedKeys] of [
        [TOOL_NAMES[1], ["content_base64", "filename", "link_attempt_id", "mime_type"]],
        [TOOL_NAMES[2], ["link_attempt_id", "prompt", "video_original_handle"]],
        [TOOL_NAMES[3], ["link_attempt_id", "recovery_id"]],
        [TOOL_NAMES[4], ["limit", "link_attempt_id"]],
        [TOOL_NAMES[5], ["link_attempt_id", "offset", "recovery_id"]]
      ] as const) {
        const tool = definitions.find(({ name }) => name === toolName);
        assert.ok(tool, `MISSING_TOOL_${toolName}`);
        const schema = tool.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
        assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), [...expectedKeys].sort());
        assert.equal(schema.additionalProperties, false, `${toolName} must reject undeclared raw fields`);
      }
      const sourceTool = definitions.find(({ name }) => name === TOOL_NAMES[0]);
      assert.ok(sourceTool);
      assert.deepEqual(Object.keys((sourceTool.inputSchema as { properties?: object }).properties ?? {}), []);
      const source = await pair.client.callTool({ name: TOOL_NAMES[0], arguments: {} });
      assert.notEqual(source.isError, true);
      const sourceValue = source.structuredContent as { runtime_usable?: boolean; dispatch_allowed?: boolean;
        model_access_observation?: { current_user_access?: string }; };
      assert.equal(sourceValue.runtime_usable, false);
      assert.equal(sourceValue.dispatch_allowed, false);
      assert.equal(sourceValue.model_access_observation?.current_user_access, "NOT_READ");
      const badGenerate = await pair.client.callTool({ name: TOOL_NAMES[2], arguments: {
        link_attempt_id: "link_unlinked_video2audio_0123456789", prompt: "synthetic", video_original_handle: "video2audio_original_00000000-0000-4000-8000-000000000000",
        model_id: "audio-model"
      } });
      assert.equal(badGenerate.isError, true, "raw selectors must not become dispatch arguments");
      const unlinkedGenerate = await pair.client.callTool({ name: TOOL_NAMES[2], arguments: {
        link_attempt_id: "link_unlinked_video2audio_0123456789", prompt: "synthetic", video_original_handle: "video2audio_original_00000000-0000-4000-8000-000000000000"
      } });
      assert.equal(unlinkedGenerate.isError, true, "valid schema is still not generation authority without a linked owner");
      const badUpload = await pair.client.callTool({ name: TOOL_NAMES[1], arguments: {
        link_attempt_id: "link_unlinked_video2audio_0123456789", content_base64: "AAAA", filename: "sample.mp4", mime_type: "video/mp4", url: "https://example.invalid/video.mp4"
      } });
      assert.equal(badUpload.isError, true, "raw external URLs are not an upload input");
      const recoveryList = await pair.client.callTool({ name: TOOL_NAMES[4], arguments: { link_attempt_id: "link_unlinked_video2audio_0123456789" } });
      assert.equal(recoveryList.isError, true, "unlinked attempts do not read recovery state");
      assert.equal(fetchCalls, 0, "construction, tools/list, source read, and schema rejects must not perform network I/O");
      const lifecycle = enabled.ownerVideo2AudioLifecycle;
      assert.ok(lifecycle, "MISSING_OWNER_VIDEO2AUDIO_LIFECYCLE");
      const revokeAttempt = "link_video2audio_revoke_0123456789";
      await enabled.authStore.createAttempt({ attempt_id: revokeAttempt, binding: enabled.authBinding, expires_at_ms: Date.now() + 60_000 });
      await enabled.authStore.beginHandoff(enabled.authBinding, revokeAttempt);
      await enabled.authStore.attachChallenge(enabled.authBinding, revokeAttempt, "synthetic-video2audio-challenge");
      await enabled.authStore.beginPoll(enabled.authBinding, revokeAttempt);
      await enabled.authStore.markLinked(enabled.authBinding, revokeAttempt, { scheme: "Bearer", value: "synthetic-only-credential" });
      const auth = Reflect.get(enabled.serverOptions, "auth") as { linkService: { revoke(binding: unknown, attemptId: string): Promise<unknown> } };
      await auth.linkService.revoke(enabled.authBinding, revokeAttempt);
      assert.equal((await enabled.authStore.getSnapshot(enabled.authBinding, revokeAttempt)).status, "REVOKED");
      await lifecycle.invalidateAttempt("link_video2audio_lifecycle_0123456789");
      await lifecycle.close();
      const generationService = Reflect.get(composition as object, "generationService") as { listRecoveries(input: unknown): Promise<unknown> };
      await assert.rejects(generationService.listRecoveries({ attemptId: "link_video2audio_lifecycle_0123456789" }),
        (error: unknown) => Reflect.get(error as object, "code") === "SERVICE_CLOSED");
    } finally { await pair.client.close(); await pair.server.close(); }
  } finally { await enabled.ownerVideo2AudioLifecycle?.close(); }
});

test("owner stdio exposes exactly the six additional tools only under the strict opt-in", async () => {
  const list = async (enabled: boolean) => {
    const client = new Client({ name: "owner-video2audio-stdio-test", version: "1.0.0" });
    const env = enabled ? { PATH: process.env.PATH ?? "", SYNTX_OWNER_VIDEO2AUDIO: "1" } : { PATH: process.env.PATH ?? "" };
    const transport = new StdioClientTransport({ command: process.execPath, args: [fileURLToPath(stdioUrl)],
      cwd: process.cwd(), env, stderr: "pipe" });
    await client.connect(transport as unknown as Transport);
    try { return { client, names: (await client.listTools()).tools.map(({ name }) => name) }; }
    catch (error) { await client.close(); throw error; }
  };
  const defaults = await list(false);
  try {
    const optedIn = await list(true);
    try {
      assert.deepEqual(optedIn.names.filter((name) => (TOOL_NAMES as readonly string[]).includes(name)).sort(), [...TOOL_NAMES].sort());
      assert.deepEqual(optedIn.names.filter((name) => !(TOOL_NAMES as readonly string[]).includes(name)).sort(), defaults.names.sort());
      const source = await optedIn.client.callTool({ name: TOOL_NAMES[0], arguments: {} });
      assert.notEqual(source.isError, true);
    } finally { await optedIn.client.close(); }
  } finally { await defaults.client.close(); }
});

test("invalid Video2Audio flag and durable conflict fail before stdio attaches", async () => {
  const previous = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_VIDEO2AUDIO = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_VIDEO2AUDIO configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_VIDEO2AUDIO = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Durable owner generation cannot be combined/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of previous) process.env[name] = value;
  }
});
