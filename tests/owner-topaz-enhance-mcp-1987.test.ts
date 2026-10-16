import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";
import { fileURLToPath } from "node:url";

const TOOLS = [
  "syntx_get_topaz_enhance_parameters",
  "syntx_owner_upload_topaz_enhance_original",
  "syntx_owner_generate_topaz_enhance",
  "syntx_owner_reconcile_topaz_enhance",
  "syntx_owner_list_topaz_enhance_recoveries",
  "syntx_owner_get_topaz_enhance_result_page"
] as const;

type Runtime = ReturnType<typeof createObservedOwnerRuntime> & {
  readonly ownerTopazEnhanceLifecycle?: { close(): Promise<void> };
};
type RuntimeFactoryOptions = Parameters<typeof createObservedOwnerRuntime>[0] & Readonly<Record<string, unknown>>;

function shellQuote(value: string): string { return `'${value.replaceAll("'", "'\\''")}'`; }
async function ffprobeFixture(): Promise<{ directory: string; binary: string; marker: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-enhance-mcp-1987-"));
  const binary = join(directory, "ffprobe-fixture");
  const marker = join(directory, "probe-was-invoked");
  await writeFile(binary, `#!/bin/sh\n: > ${shellQuote(marker)}\nprintf '%s' '{}\n'\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary), marker };
}

async function connected(runtime: Runtime) {
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "topaz-enhance-mcp-1987", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { server, client };
}

test("Topaz Enhance MCP stays absent by default and its owner stdio opt-in adds six strict tools without startup network", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN"); return; }
  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("No network is allowed in this MCP registration test."); };
  const defaults = createObservedOwnerRuntime({ fetchImpl, catalogDirectory: join(process.cwd(), "catalog") }) as Runtime;
  const defaultConnection = await connected(defaults);
  let fixture: Awaited<ReturnType<typeof ffprobeFixture>> | undefined;
  let enabled: Runtime | undefined;
  try {
    const defaultNames = (await defaultConnection.client.listTools()).tools.map(({ name }) => name);
    assert.equal(TOOLS.some((name) => defaultNames.includes(name)), false);

    fixture = await ffprobeFixture();
    enabled = createObservedOwnerRuntime({
      fetchImpl,
      catalogDirectory: join(process.cwd(), "catalog"),
      ownerTopazEnhanceEnabled: true,
      ownerTopazEnhanceFfprobePath: fixture.binary,
      ownerTopazEnhanceUploadDestination: "hidden"
    } as RuntimeFactoryOptions) as Runtime;
    const enabledConnection = await connected(enabled);
    try {
      const definitions = (await enabledConnection.client.listTools()).tools;
      const names = definitions.map(({ name }) => name);
      assert.deepEqual(names.filter((name) => (TOOLS as readonly string[]).includes(name)).sort(), [...TOOLS].sort());
      assert.deepEqual(names.filter((name) => !(TOOLS as readonly string[]).includes(name)).sort(), [...defaultNames].sort());
      const generate = definitions.find(({ name }) => name === TOOLS[2]);
      assert.ok(generate);
      const schema = generate.inputSchema as { properties?: Record<string, { properties?: Record<string, unknown>; enum?: unknown[]; const?: unknown }>; additionalProperties?: unknown };
      assert.deepEqual(Object.keys(schema.properties ?? {}).sort(), ["link_attempt_id", "model_id", "parameters", "topaz_original_handle"]);
      assert.equal(schema.additionalProperties, false);
      assert.equal(schema.properties?.model_id?.const ?? schema.properties?.model_id?.enum?.[0], "topaz_enhance");
      const parameterProperties = schema.properties?.parameters?.properties;
      assert.deepEqual(Object.keys(parameterProperties ?? {}).sort(), ["blur", "compression", "details", "focus", "grain", "halo", "interpolation", "model", "noise", "preblur", "prenoise", "upscale"]);
      assert.equal((schema.properties?.parameters as { additionalProperties?: unknown } | undefined)?.additionalProperties, false);
      assert.equal(Object.hasOwn(schema.properties ?? {}, "prompt"), false);
      assert.equal(Object.hasOwn(schema.properties ?? {}, "url"), false);
      assert.equal(Object.hasOwn(schema.properties ?? {}, "duration_seconds"), false);
      assert.equal(Object.hasOwn(schema.properties ?? {}, "width"), false);
      assert.equal(Object.hasOwn(schema.properties ?? {}, "height"), false);
      const upload = definitions.find(({ name }) => name === TOOLS[1]);
      assert.ok(upload);
      const uploadSchema = upload.inputSchema as { properties?: Record<string, unknown>; additionalProperties?: unknown };
      assert.deepEqual(Object.keys(uploadSchema.properties ?? {}).sort(), ["content_base64", "filename", "link_attempt_id"]);
      assert.equal(uploadSchema.additionalProperties, false);

      const parameters = await enabledConnection.client.callTool({ name: TOOLS[0], arguments: {} });
      assert.equal(parameters.isError, undefined, JSON.stringify(parameters));
      const source = parameters.structuredContent as {
        model_id: string; ai_name: string; runtime_usable: false; backend_acceptance: "UNPROVEN";
        effective_defaults: "UNKNOWN"; conditional_combinations: "UNPROVEN"; local_input_limitation: string;
        source_pins: { public_catalog_version: string; source_build_id: string; modules: Record<string, string> };
        controls: { model: string[]; upscale: number[]; interpolation: number[]; focus: string[]; grain: string[]; numeric_ranges: Record<string, number[]> };
      };
      assert.equal(source.model_id, "topaz_enhance");
      assert.equal(source.ai_name, "topaz_ai");
      assert.equal(source.runtime_usable, false);
      assert.equal(source.backend_acceptance, "UNPROVEN");
      assert.equal(source.effective_defaults, "UNKNOWN");
      assert.equal(source.conditional_combinations, "UNPROVEN");
      assert.equal(source.local_input_limitation, "MP4_ONLY_LOCAL_PROBE_PUBLIC_SOURCE_ALSO_LISTS_WEBM_QUICKTIME");
      assert.equal(source.source_pins.public_catalog_version, "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json");
      assert.equal(source.source_pins.source_build_id, "1792133067");
      assert.equal(source.source_pins.modules.app, "sha256:5488b33ac6de23e559932a485c7cf2f7d034151f3d735005dfb0a334ee21a175");
      assert.deepEqual(source.controls.model, ["ghq-5", "rhea-1", "prob-4", "iris-3", "gcg-5"]);
      assert.deepEqual(source.controls.upscale, [1, 2, 4]);
      assert.deepEqual(source.controls.interpolation, [24, 25, 30, 45, 50, 60]);
      assert.deepEqual(source.controls.focus, ["off", "normal", "strong"]);
      assert.deepEqual(source.controls.grain, ["off", "on"]);
      assert.deepEqual(source.controls.numeric_ranges, {
        prenoise: [0, 100], compression: [-100, 100], details: [-100, 100], blur: [-100, 100],
        noise: [-100, 100], halo: [-100, 100], preblur: [-100, 100]
      });

      const invalidGenerate = await enabledConnection.client.callTool({ name: TOOLS[2], arguments: {
        link_attempt_id: "link_topaz_enhance_mcp_invalid_0123456789", model_id: "topaz_enhance",
        topaz_original_handle: "topaz_enhance_original_00000000-0000-4000-8000-000000000000",
        prompt: "must not exist", url: "https://example.invalid/source.mp4", parameters: PARAMETERS
      } });
      assert.equal(invalidGenerate.isError, true);
      assert.equal(JSON.stringify(invalidGenerate).includes("https://example.invalid/source.mp4"), false);
      const invalidUpload = await enabledConnection.client.callTool({ name: TOOLS[1], arguments: {
        link_attempt_id: "link_topaz_enhance_mcp_invalid_0123456789", filename: "source.mp4",
        mime_type: "video/mp4", content_base64: "AAAA", url: "https://example.invalid/source.mp4"
      } });
      assert.equal(invalidUpload.isError, true);
      assert.equal(JSON.stringify(invalidUpload).includes("https://example.invalid/source.mp4"), false);
      assert.equal(fetchCalls, 0, "runtime startup, tool listing, getter and invalid requests must not use network");
      assert.equal(existsSync(fixture.marker), false, "startup, getter and invalid inputs must not invoke ffprobe");
    } finally {
      await enabledConnection.client.close();
      await enabledConnection.server.close();
    }
  } finally {
    await defaultConnection.client.close();
    await defaultConnection.server.close();
    defaults.authStore.close?.();
    await enabled?.ownerTopazEnhanceLifecycle?.close();
    enabled?.authStore.close?.();
    if (fixture) await rm(fixture.directory, { recursive: true, force: true });
  }
});

const PARAMETERS = Object.freeze({ blur: 0, halo: 0, focus: "off", grain: "off", model: "rhea-1", noise: 0, details: 0,
  preblur: 0, upscale: 1, prenoise: 0, compression: 0, interpolation: 60 });

test("Topaz Enhance stdio rejects noncanonical and incomplete operator opt-in before transport attaches", async () => {
  const prior = new Map(Object.entries(process.env).filter(([name]) => name.startsWith("SYNTX_OWNER_")));
  const input = new PassThrough();
  try {
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    process.env.SYNTX_OWNER_TOPAZ_ENHANCE = "true";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_TOPAZ_ENHANCE configuration/u);
    assert.equal(input.listenerCount("end"), 0);
    process.env.SYNTX_OWNER_TOPAZ_ENHANCE = "1";
    await assert.rejects(runObservedOwnerStdioServer(input), /Invalid SYNTX_OWNER_TOPAZ_ENHANCE operator configuration/u);
    assert.equal(input.listenerCount("end"), 0);
  } finally {
    input.destroy();
    for (const name of Object.keys(process.env)) if (name.startsWith("SYNTX_OWNER_")) delete process.env[name];
    for (const [name, value] of prior) process.env[name] = value;
  }
});

test("the opted-in owner stdio process lists only callable Enhance tools and serves its local parameter getter", async (t) => {
  if (process.platform === "win32") { t.skip("POSIX executable fixture; real Windows ffprobe acceptance NOT_RUN"); return; }
  const fixture = await ffprobeFixture();
  const entry = fileURLToPath(new URL("../src/transports/stdio-owner.js", import.meta.url));
  const env = Object.fromEntries(Object.entries(process.env).filter(([name, value]) => value !== undefined &&
    !name.startsWith("SYNTX_OWNER_") && name !== "SYNTX_PUBLIC_CATALOG_VERSION")) as Record<string, string>;
  env.PATH = process.env.PATH ?? "";
  env.TMPDIR = tmpdir();
  env.LANG = "en_US.UTF-8";
  env.SYNTX_OWNER_TOPAZ_ENHANCE = "1";
  env.SYNTX_OWNER_TOPAZ_ENHANCE_FFPROBE_PATH = fixture.binary;
  env.SYNTX_OWNER_TOPAZ_ENHANCE_UPLOAD_DESTINATION = "hidden";
  const transport = new StdioClientTransport({ command: process.execPath, args: [entry], cwd: process.cwd(), env, stderr: "pipe" });
  const client = new Client({ name: "topaz-enhance-stdio-1987", version: "1.0.0" });
  try {
    await client.connect(transport);
    const definitions = (await client.listTools()).tools;
    assert.equal(TOOLS.every((name) => definitions.some((tool) => tool.name === name)), true);
    const source = await client.callTool({ name: TOOLS[0], arguments: {} });
    assert.equal(source.isError, undefined, JSON.stringify(source));
    assert.equal((source.structuredContent as { model_id: string }).model_id, "topaz_enhance");
    assert.equal(existsSync(fixture.marker), false, "stdio startup and getter must not invoke ffprobe");
  } finally {
    await client.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});
