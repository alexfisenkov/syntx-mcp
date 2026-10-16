import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  OWNER_FLUX3_VIDEO_TOOL_NAMES,
  SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME,
  SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME,
  SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-flux3-video-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerFlux3VideoFlag } from "../src/runtime/owner-flux3-video-stdio-config.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

type Runtime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerFlux3VideosLifecycle?: { close(): Promise<void> };
};
type RuntimeOptions = Parameters<typeof createObservedOwnerRuntime>[0] & Readonly<Record<string, unknown>>;
const CATALOG = join(process.cwd(), "catalog");

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function ffprobeFixture(): Promise<{ directory: string; binary: string; marker: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-flux3-video-mcp-2019-"));
  const binary = join(directory, "ffprobe-fixture"), marker = join(directory, "probe-was-invoked");
  await writeFile(binary, `#!/bin/sh\n: > ${shellQuote(marker)}\nprintf '%s' '{"streams":[],"format":{}}'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary), marker };
}

async function connected(runtime: Runtime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "flux3-video-mcp-2019", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test("Flux3 opt-in parser is strict and invalid stdio configuration is rejected before transport attaches", async () => {
  for (const value of [undefined, "", "0"]) assert.equal(readOwnerFlux3VideoFlag(value), false);
  assert.equal(readOwnerFlux3VideoFlag("1"), true);
  for (const value of ["true", "yes", "01", " 1", "1 "]) assert.throws(() => readOwnerFlux3VideoFlag(value));

  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_FLUX3_VIDEOS = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_FLUX3_VIDEOS configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_FLUX3_VIDEOS = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_FLUX3 operator configuration/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("Flux3 MCP is absent by default and opt-in adds six strict tools without startup network or probing", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture; Windows executable acceptance NOT_RUN"); return; }
  let networkCalls = 0;
  const fetchImpl: typeof fetch = async () => { networkCalls += 1; throw new Error("No provider request is allowed in this local registration test."); };
  const defaults = createObservedOwnerRuntime({ catalogDirectory: CATALOG, fetchImpl }) as Runtime;
  const defaultConnection = await connected(defaults);
  let fixture: Awaited<ReturnType<typeof ffprobeFixture>> | undefined;
  let enabled: Runtime | undefined;
  try {
    const defaultNames = (await defaultConnection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(OWNER_FLUX3_VIDEO_TOOL_NAMES.some((name) => defaultNames.includes(name)), false);
    assert.equal(defaults.serverOptions.ownerFlux3Videos, undefined);
    assert.equal(networkCalls, 0);

    fixture = await ffprobeFixture();
    enabled = createObservedOwnerRuntime({
      catalogDirectory: CATALOG,
      fetchImpl,
      ownerFlux3VideosEnabled: true,
      ownerFlux3FfprobePath: fixture.binary,
      ownerFlux3UploadDestination: "hidden"
    } as RuntimeOptions) as Runtime;
    const enabledConnection = await connected(enabled);
    try {
      const tools = (await enabledConnection.client.listTools()).tools;
      const names = tools.map(({ name }) => name);
      assert.deepEqual(names.filter((name) => (OWNER_FLUX3_VIDEO_TOOL_NAMES as readonly string[]).includes(name)).sort(),
        [...OWNER_FLUX3_VIDEO_TOOL_NAMES].sort());
      assert.deepEqual(names.filter((name) => !(OWNER_FLUX3_VIDEO_TOOL_NAMES as readonly string[]).includes(name)).sort(), [...defaultNames].sort());

      const upload = tools.find(({ name }) => name === SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME);
      assert.ok(upload);
      const uploadSchema = upload.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      assert.deepEqual(Object.keys(uploadSchema.properties ?? {}).sort(), ["content_base64", "filename", "link_attempt_id", "mime_type", "model_id"]);
      assert.equal(uploadSchema.additionalProperties, false);
      for (const forbidden of ["url", "width", "height", "duration_seconds"]) assert.equal(Object.hasOwn(uploadSchema.properties ?? {}, forbidden), false);

      const generate = tools.find(({ name }) => name === SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME);
      assert.ok(generate);
      const generateSchema = generate.inputSchema as { properties?: Record<string, { properties?: Record<string, unknown>; additionalProperties?: unknown }>; additionalProperties?: unknown };
      assert.equal(generateSchema.additionalProperties, false);
      const properties = generateSchema.properties ?? {};
      assert.deepEqual(Object.keys(properties).sort(), ["flux3_reference_handles", "link_attempt_id", "model_id", "parameters", "prompt"]);
      assert.deepEqual(Object.keys(properties.parameters?.properties ?? {}).sort(), ["generate_audio", "resolution", "video_duration"]);
      assert.equal(properties.parameters?.additionalProperties, false);
      for (const forbidden of ["n", "draft", "file_urls", "url", "width", "height", "duration_seconds"]) {
        assert.equal(Object.hasOwn(properties, forbidden), false);
      }

      const getterTool = tools.find(({ name }) => name === SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME);
      assert.ok(getterTool);
      const getterSchema = getterTool.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      assert.deepEqual(Object.keys(getterSchema.properties ?? {}), ["model_id"]);
      assert.equal(getterSchema.additionalProperties, false);
      assert.deepEqual((getterSchema.properties?.model_id as { enum?: string[] }).enum, ["flux3_i2v", "flux3_v2v"]);
      const getter = await enabledConnection.client.callTool({ name: SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME, arguments: { model_id: "flux3_i2v" } });
      assert.equal(getter.isError, undefined, JSON.stringify(getter));
      const output = getter.structuredContent as { status: string; model_id: string; profile: { model_id: string; runtime_usable: false; backend_acceptance: "UNPROVEN" }; dispatch_allowed: false };
      assert.equal(output.status, "SOURCE_REVIEWED_STATIC_ONLY");
      assert.equal(output.model_id, "flux3_i2v");
      assert.equal(output.profile.model_id, "flux3_i2v");
      assert.equal(output.profile.runtime_usable, false);
      assert.equal(output.profile.backend_acceptance, "UNPROVEN");
      assert.equal(output.dispatch_allowed, false);
      assert.equal(JSON.stringify(getter).includes("https://"), false);
      assert.equal(existsSync(fixture.marker), false, "service construction, listTools and getter must not run ffprobe");
      assert.equal(networkCalls, 0);

      const invalidUpload = await enabledConnection.client.callTool({ name: SYNTX_OWNER_UPLOAD_FLUX3_VIDEO_REFERENCE_TOOL_NAME, arguments: {
        link_attempt_id: "link_flux3_video_mcp_invalid_000001", model_id: "flux3_i2v", filename: "image.png", mime_type: "video/mp4", content_base64: "AAAA"
      } });
      const invalidGenerate = await enabledConnection.client.callTool({ name: SYNTX_OWNER_GENERATE_FLUX3_VIDEO_TOOL_NAME, arguments: {
        link_attempt_id: "link_flux3_video_mcp_invalid_000001", model_id: "flux3_v2v", prompt: "x",
        flux3_reference_handles: [], parameters: { resolution: "hd", video_duration: 2, generate_audio: true }, n: 1
      } });
      for (const result of [invalidUpload, invalidGenerate]) {
        assert.equal(result.isError, true);
        assert.equal(result.structuredContent, undefined);
      }
      assert.equal(existsSync(fixture.marker), false);
      assert.equal(networkCalls, 0);
    } finally {
      await enabledConnection.client.close();
      await enabledConnection.server.close();
    }
  } finally {
    await defaultConnection.client.close();
    await defaultConnection.server.close();
    await defaults.ownerFlux3VideosLifecycle?.close();
    await enabled?.ownerFlux3VideosLifecycle?.close();
    if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("the actual owner stdio child keeps Flux3 off by default and serves its local getter after opt-in", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX ffprobe fixture; Windows executable acceptance NOT_RUN"); return; }
  const fixture = await ffprobeFixture();
  const entry = fileURLToPath(new URL("../src/transports/stdio-owner.js", import.meta.url));
  const cleanEnv = () => {
    const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
      !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION")) as Record<string, string>;
    env.PATH = process.env.PATH ?? "";
    env.TMPDIR = tmpdir();
    env.LANG = "en_US.UTF-8";
    return env;
  };
  const runClient = async (env: Record<string, string>, name: string) => {
    const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: process.cwd(), env, stderr: "pipe" });
    const client = new Client({ name, version: "1.0.0" });
    await client.connect(transport);
    return client;
  };
  try {
    const defaults = await runClient(cleanEnv(), "flux3-video-stdio-default-2019");
    try {
      const names = (await defaults.listTools()).tools.map(({ name }) => name);
      assert.equal(OWNER_FLUX3_VIDEO_TOOL_NAMES.some((tool) => names.includes(tool)), false);
    } finally { await defaults.close(); }

    const enabledEnv = cleanEnv();
    enabledEnv.SYNTX_OWNER_FLUX3_VIDEOS = "1";
    enabledEnv.SYNTX_OWNER_FLUX3_FFPROBE_PATH = fixture.binary;
    enabledEnv.SYNTX_OWNER_FLUX3_UPLOAD_DESTINATION = "hidden";
    const enabled = await runClient(enabledEnv, "flux3-video-stdio-optin-2019");
    try {
      const definitions = (await enabled.listTools()).tools;
      assert.equal(OWNER_FLUX3_VIDEO_TOOL_NAMES.every((tool) => definitions.some(({ name }) => name === tool)), true);
      const getter = await enabled.callTool({ name: SYNTX_GET_FLUX3_VIDEO_PARAMETERS_TOOL_NAME, arguments: { model_id: "flux3_v2v" } });
      assert.equal(getter.isError, undefined, JSON.stringify(getter));
      assert.equal((getter.structuredContent as { model_id: string }).model_id, "flux3_v2v");
      assert.equal(existsSync(fixture.marker), false, "the child must not run ffprobe during startup, listTools, or getter");
    } finally { await enabled.close(); }
  } finally { await rm(fixture.directory, { recursive: true, force: true }); }
});
