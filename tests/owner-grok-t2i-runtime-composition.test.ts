import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { PassThrough } from "node:stream";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { OwnerGrokT2iGenerationServiceError } from "../src/application/owner-grok-t2i-generation-service.js";
import { createMcpServer } from "../src/mcp/server.js";
import {
  SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME,
  SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME,
  SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME,
  SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME
} from "../src/mcp/owner-grok-t2i-image-tools.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { closeOwnerReadServicesOnTransportEof, runObservedOwnerStdioServer } from "../src/transports/stdio-owner.js";

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

function createOptedInRuntime(fetchImpl: typeof fetch = async () => { throw new Error("Unexpected provider access."); }) {
  return createObservedOwnerRuntime({ ownerGrokT2iImageReferencesEnabled: true, fetchImpl } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
}

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

test("Grok T2I runtime flag is strict and the service composition stays absent unless explicitly enabled", async () => {
  const module = await import("../src/transports/stdio-owner.js") as unknown as Record<string, unknown>;
  const readFlag = module.readOwnerGrokT2iImageReferencesFlag as (value: string | undefined) => boolean;
  assert.equal(typeof readFlag, "function");
  for (const value of [undefined, "", "0"]) assert.equal(readFlag(value), false);
  assert.equal(readFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readFlag(value), /Invalid SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES configuration/u);
  }

  let fetchCalls = 0;
  const fetchImpl: typeof fetch = async () => { fetchCalls += 1; throw new Error("Unexpected provider access during composition."); };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaultRuntime.serverOptions.ownerGrokT2iImageReferences, undefined);
  const optedInRuntime = createObservedOwnerRuntime({ ownerGrokT2iImageReferencesEnabled: true, fetchImpl } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = optedInRuntime.serverOptions.ownerGrokT2iImageReferences;
  assert.ok(composition);
  assert.equal(typeof composition.uploadService.upload, "function");
  assert.equal(typeof composition.generationService.generate, "function");
  assert.equal(typeof composition.generationService.reconcile, "function");
  assert.equal(typeof composition.generationService.listRecoveries, "function");
  await composition.generationService.close();
  assert.equal(fetchCalls, 0);
});

test("Grok T2I tools are absent by default and the opt-in exposes exactly four tools", async () => {
  const defaultRuntime = createObservedOwnerRuntime();
  const defaultServer = createMcpServer(defaultRuntime.application, defaultRuntime.serverOptions);
  const defaultClient = new Client({ name: "grok-t2i-default-test", version: "1.0.0" });
  const [defaultClientTransport, defaultServerTransport] = InMemoryTransport.createLinkedPair();
  await defaultServer.connect(defaultServerTransport);
  await defaultClient.connect(defaultClientTransport);
  try {
    const names = (await defaultClient.listTools()).tools.map(({ name }) => name);
    for (const name of [SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME]) {
      assert.equal(names.includes(name), false);
    }
  } finally { await defaultClient.close(); await defaultServer.close(); }

  const runtime = createOptedInRuntime();
  const composition = runtime.serverOptions.ownerGrokT2iImageReferences;
  assert.ok(composition);
  const server = createMcpServer(runtime.application, runtime.serverOptions);
  const client = new Client({ name: "grok-t2i-optin-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const expected = [SYNTX_UPLOAD_GROK_T2I_IMAGE_REFERENCE_TOOL_NAME, SYNTX_OWNER_GENERATE_GROK_T2I_IMAGE_TOOL_NAME,
      SYNTX_OWNER_RECONCILE_GROK_T2I_IMAGE_TOOL_NAME, SYNTX_OWNER_LIST_GROK_T2I_IMAGE_RECOVERIES_TOOL_NAME].sort();
    const actual = (await client.listTools()).tools.map(({ name }) => name)
      .filter((name) => expected.includes(name as typeof expected[number])).sort();
    assert.deepEqual(actual, expected);
  } finally { await client.close(); await server.close(); await composition.generationService.close(); }
});

test("owner stdio validates the Grok T2I flag and forbids mixing its paid tools with durable generation", async () => {
  const names = ["SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  try {
    for (const name of names) delete process.env[name];
    process.env.SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_GROK_T2I_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()), /Durable owner generation cannot be combined/u);
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name]; else process.env[name] = value;
    }
  }
});

test("runtime preflight uses fresh account and model reads for all four models and exact candidate cost keys", async () => {
  const modelReads: URL[] = [];
  let subscriptionReads = 0;
  let uploadCount = 0;
  let chatCount = 0;
  let generationPosts = 0;
  const runtime = createOptedInRuntime(async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/user/balance") return Response.json({ balance: "100" });
    if (url.pathname === "/api/v1/user/subscription") {
      subscriptionReads += 1;
      return Response.json({ active: subscriptionReads % 2 === 1, type: "PRO" });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      modelReads.push(url);
      return Response.json({ access: true, cost: 4, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files") {
      uploadCount += 1;
      const form = init?.body as FormData;
      return Response.json({ files: [{ id: `grok-runtime-file-${uploadCount}`,
        url: `https://r2.syntx.ai/private/grok/runtime-${uploadCount}.jpg`, mime_type: "image/jpeg",
        size: (form.get("files") as File).size }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      chatCount += 1;
      return Response.json({ uuid: `grok-runtime-chat-${chatCount}` });
    }
    if (url.pathname === "/api/v1/chats/generate" || url.pathname.endsWith("/generate")) generationPosts += 1;
    throw new Error(`Unexpected synthetic runtime route ${url.pathname}.`);
  });
  const attemptId = "link_grok_runtime_preflight_0123456789";
  const composition = runtime.serverOptions.ownerGrokT2iImageReferences;
  assert.ok(composition);
  await linkSyntheticAttempt(runtime, attemptId);
  const cases = [
    { model_id: "grok_t2i", prompt: "T2I zero", parameters: { aspect_ratio: "1:1", resolution: "1k", batch_size: 1 }, handles: [], keys: ["batch_size"] },
    { model_id: "grok_t2i_pro", prompt: "Pro zero", parameters: { aspect_ratio: "16:9", resolution: "2k", batch_size: 5 }, handles: [], keys: ["batch_size"] },
    { model_id: "grok_imagine_2", prompt: "Imagine zero", parameters: { aspect_ratio: "2:3", resolution: "1k", batch_size: 3, details_quality: "low" }, handles: [],
      keys: ["batch_size", "details_quality", "resolution"] },
    { model_id: "grok_imagine_quality", prompt: "Quality zero", parameters: { aspect_ratio: "16:9", resolution: "2k", batch_size: 4 }, handles: [],
      keys: ["batch_size", "resolution"] }
  ] as const;
  try {
    const handles = new Map<string, string>();
    for (const model_id of ["grok_imagine_2", "grok_imagine_quality"] as const) {
      const receipt = await composition.uploadService.upload({ attemptId, model_id, content_base64: JPEG.toString("base64"),
        filename: `${model_id}.jpg`, mime_type: "image/jpeg" });
      handles.set(model_id, receipt.reference_handle);
    }
    for (const item of cases) {
      await assert.rejects(composition.generationService.generate({ attemptId, model_id: item.model_id,
        prompt: item.prompt, parameters: item.parameters, reference_handles: item.handles }),
      (error: unknown) => error instanceof OwnerGrokT2iGenerationServiceError && error.code === "PREFLIGHT_FAILED");
      const reads = modelReads.filter((url) => url.searchParams.get("model_type") === item.model_id);
      assert.equal(reads.length, 2);
      for (const url of reads) {
        assert.equal(url.searchParams.get("ai_name"), "grok_image");
        assert.equal(url.searchParams.getAll("model_type").length, 1);
        assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type", ...item.keys].sort());
      }
    }
    for (const model_id of ["grok_imagine_2", "grok_imagine_quality"] as const) {
      const item = model_id === "grok_imagine_2" ? cases[2] : cases[3];
      await assert.rejects(composition.generationService.generate({ attemptId, model_id,
        prompt: `${model_id} positive reference`, parameters: item.parameters, reference_handles: [handles.get(model_id)!] }),
      (error: unknown) => error instanceof OwnerGrokT2iGenerationServiceError && error.code === "PREFLIGHT_FAILED");
      const reads = modelReads.filter((url) => url.searchParams.get("model_type") === model_id);
      assert.equal(reads.length, 4);
      const expectedKeys = model_id === "grok_imagine_2"
        ? ["ai_name", "batch_size", "details_quality", "model_type", "ref_count", "resolution"]
        : ["ai_name", "batch_size", "model_type", "resolution"];
      assert.deepEqual([...reads[2]!.searchParams.keys()].sort(), expectedKeys);
      assert.deepEqual([...reads[3]!.searchParams.keys()].sort(), expectedKeys);
    }
    assert.equal(chatCount, 6);
    assert.equal(uploadCount, 2);
    assert.equal(subscriptionReads, 12);
    assert.equal(generationPosts, 0);
  } finally { await composition.generationService.close(); }
});

test("Grok T2I owner revocation drains before credential revoke and a failed drain retains the link", async () => {
  const runtime = createOptedInRuntime();
  const generation = runtime.serverOptions.ownerGrokT2iImageReferences?.generationService;
  assert.ok(generation);
  const attemptId = "link_grok_runtime_revoke_0123456789";
  const binding = runtime.authBinding;
  await linkSyntheticAttempt(runtime, attemptId);
  const events: string[] = [];
  const originalInvalidate = generation.invalidateAttempt.bind(generation);
  generation.invalidateAttempt = async (id) => { events.push("grok-t2i.drain"); await originalInvalidate(id); };
  const originalRevoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (...args) => { events.push("credential.revoke"); return originalRevoke(...args); };
  try {
    const revoked = await runtime.serverOptions.auth!.linkService.revoke(binding, attemptId);
    assert.equal(revoked.status, "REVOKED");
    assert.deepEqual(events, ["grok-t2i.drain", "credential.revoke"]);
  } finally { await generation.close(); }

  const failed = createOptedInRuntime();
  const failedGeneration = failed.serverOptions.ownerGrokT2iImageReferences?.generationService;
  assert.ok(failedGeneration);
  const failedAttempt = "link_grok_runtime_revoke_fail_0123456789";
  await linkSyntheticAttempt(failed, failedAttempt);
  failedGeneration.invalidateAttempt = async () => { throw new Error("Grok T2I drain failed"); };
  try {
    await assert.rejects(failed.serverOptions.auth!.linkService.revoke(failed.authBinding, failedAttempt), /Grok T2I drain failed/u);
    assert.equal((await failed.linkService.getStatus(failed.authBinding, failedAttempt)).status, "LINKED");
  } finally { await failedGeneration.close(); }
});

test("stdio EOF closes Grok T2I generation, its owned upload, and then the auth profile", async () => {
  const runtime = createOptedInRuntime();
  const composition = runtime.serverOptions.ownerGrokT2iImageReferences;
  assert.ok(composition);
  const events: string[] = [];
  const originalGenerationClose = composition.generationService.close.bind(composition.generationService);
  composition.generationService.close = async () => { events.push("grok-t2i.generation.close"); await originalGenerationClose(); };
  const ownedUploadService = composition.uploadService as unknown as { close(): Promise<void> };
  const originalUploadClose = ownedUploadService.close.bind(ownedUploadService);
  ownedUploadService.close = async () => { events.push("grok-t2i.upload.close"); await originalUploadClose(); };
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolve) => { signalTransportClosed = resolve; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.profile.close"); }, input, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, undefined, composition.generationService);
  input.resume();
  input.push(null);
  await transportClosed;
  await close();
  assert.deepEqual(events, ["grok-t2i.generation.close", "grok-t2i.upload.close", "auth.profile.close"]);
  input.destroy();
});
