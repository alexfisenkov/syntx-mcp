import assert from "node:assert/strict";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { PassThrough } from "node:stream";
import test from "node:test";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { runObservedOwnerStdioServer, closeOwnerReadServicesOnTransportEof } from "../src/transports/stdio-owner.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";

const TEST_FILE = fileURLToPath(import.meta.url);
const TEST_ROOT = resolve(dirname(TEST_FILE), "..");
const UNI_TOOLS = ["syntx_upload_uni_image_reference", "syntx_owner_generate_uni_image",
  "syntx_owner_reconcile_uni_image", "syntx_owner_list_uni_image_recoveries"];
const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01,
  0x11, 0x00, 0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);
const JPEG_BASE64 = "\/9j\/4AAQSkZJRgABAQEAYABgAAD\/2wBDAAQDAwQDAwQEAwQFBAQFBgoHBgYGBgoKCAgICQoKCgoKCgoMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz\/2wBDAQQFBgoHBgYGBgoMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAz\/wAARCAABAAEDASIAAhEBAxEB\/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb\/xAAUEAEAAAAAAAAAAAAAAAAAAAAA\/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAb\/xAAUEQEAAAAAAAAAAAAAAAAAAAAA\/9oADAMBAAIRAxEAPwCdAB//2Q==";

void JPEG_BASE64;

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId: string): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, `synthetic-${attemptId}`);
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: `synthetic-${attemptId}-credential` });
}

test("owner stdio exposes the strict default-off Uni image references flag reader", async () => {
  const module = await import("../src/transports/stdio-owner.js") as Record<string, unknown>;
  assert.equal(typeof module?.readOwnerUniImageReferencesFlag, "function", "MISSING_OWNER_UNI_IMAGE_REFERENCES_FLAG");
  const readFlag = module!.readOwnerUniImageReferencesFlag as (value: string | undefined) => boolean;
  for (const value of [undefined, "", "0"]) assert.equal(readFlag(value), false);
  assert.equal(readFlag("1"), true);
  for (const value of ["true", "false", "01", " 1", "1 ", "2"]) {
    assert.throws(() => readFlag(value), /Invalid SYNTX_OWNER_UNI_IMAGE_REFERENCES configuration/u);
  }
});

test("Uni image runtime composition is absent by default and owns upload/generation services only when opted in", async () => {
  const fetchImpl: typeof fetch = async () => { throw new Error("Unexpected provider access during composition."); };
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl });
  assert.equal(defaultRuntime.serverOptions.ownerUniImageReferences, undefined);

  const enabledRuntime = createObservedOwnerRuntime({ ownerUniImageReferencesEnabled: true, fetchImpl } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = enabledRuntime.serverOptions.ownerUniImageReferences;
  assert.ok(composition, "MISSING_OWNER_UNI_IMAGE_RUNTIME_COMPOSITION");
  assert.equal(typeof composition.uploadService.upload, "function");
  assert.equal(typeof composition.generationService.generate, "function");
  assert.equal(typeof composition.generationService.reconcile, "function");
  assert.equal(typeof composition.generationService.listRecoveries, "function");
  await composition.generationService.close();
});

test("owner stdio rejects malformed Uni opt-in and durable-generation conflicts", async () => {
  const keys = ["SYNTX_OWNER_UNI_IMAGE_REFERENCES", "SYNTX_OWNER_DURABLE_GENERATION"] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) delete process.env[key];
    process.env.SYNTX_OWNER_UNI_IMAGE_REFERENCES = "true";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Invalid SYNTX_OWNER_UNI_IMAGE_REFERENCES configuration/u);
    process.env.SYNTX_OWNER_UNI_IMAGE_REFERENCES = "1";
    process.env.SYNTX_OWNER_DURABLE_GENERATION = "1";
    await assert.rejects(runObservedOwnerStdioServer(new PassThrough()),
      /Durable owner generation cannot be combined/u);
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});

test("owner stdio child exposes exactly four Uni tools only for explicit opt-in", async () => {
  for (const [flag, expected] of [["0", false], ["1", true]] as const) {
    const env: Record<string, string> = Object.fromEntries(
      Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] === "string")
    );
    env.SYNTX_OWNER_UNI_IMAGE_REFERENCES = flag;
    delete env.SYNTX_OWNER_AUTH_PROFILE_DIRECTORY;
    delete env.SYNTX_OWNER_AUTH_KEY_FILE;
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(TEST_ROOT, "src/transports/stdio-owner.js")],
      cwd: TEST_ROOT,
      env,
      stderr: "pipe"
    });
    const client = new Client({ name: "uni-runtime-composition-test", version: "1.0.0" });
    await client.connect(transport);
    try {
      const names = (await client.listTools()).tools.map(({ name }) => name);
      const actual = names.filter((name) => UNI_TOOLS.includes(name));
      assert.deepEqual(actual.sort(), (expected ? UNI_TOOLS : []).sort());
    } finally { await client.close(); }
  }
});

test("stdio EOF drains the Uni generation service before auth close", async () => {
  const runtime = createObservedOwnerRuntime({ ownerUniImageReferencesEnabled: true } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
  const service = runtime.serverOptions.ownerUniImageReferences?.generationService;
  assert.ok(service);
  const events: string[] = [];
  const originalClose = service.close.bind(service);
  service.close = async () => { events.push("uni.generation.close"); await originalClose(); };
  const input = new PassThrough();
  let transport!: Transport;
  let signalTransportClosed!: () => void;
  const transportClosed = new Promise<void>((resolvePromise) => { signalTransportClosed = resolvePromise; });
  transport = { async start() {}, async send() {}, async close() { transport.onclose?.(); signalTransportClosed(); } };
  const close = closeOwnerReadServicesOnTransportEof(transport, undefined, undefined, undefined, undefined,
    () => { events.push("auth.close"); }, input, undefined, undefined, undefined, undefined, undefined,
    undefined, undefined, undefined, undefined, service);
  input.resume(); input.push(null);
  await transportClosed;
  await close();
  assert.deepEqual(events, ["uni.generation.close", "auth.close"]);
  input.destroy();
});

test("owner revoke drains Uni generation before revoking the user credential", async () => {
  const runtime = createObservedOwnerRuntime({ ownerUniImageReferencesEnabled: true } as unknown as
    Parameters<typeof createObservedOwnerRuntime>[0]);
  const service = runtime.serverOptions.ownerUniImageReferences?.generationService;
  assert.ok(service);
  const attemptId = "link_uni_runtime_revoke_012345678901";
  await linkSyntheticAttempt(runtime, attemptId);
  const events: string[] = [];
  const invalidate = service.invalidateAttempt.bind(service);
  service.invalidateAttempt = async (id) => { events.push("uni.drain"); await invalidate(id); };
  const revoke = runtime.linkService.revoke.bind(runtime.linkService);
  runtime.linkService.revoke = async (...args) => { events.push("credential.revoke"); return revoke(...args); };
  try {
    const result = await runtime.serverOptions.auth!.linkService.revoke(runtime.authBinding, attemptId);
    assert.equal(result.status, "REVOKED");
    assert.deepEqual(events, ["uni.drain", "credential.revoke"]);
  } finally { await service.close(); }
});

test("runtime preflight performs two fresh account/model reads for each of the three exact Uni variants", async () => {
  const modelReads: URL[] = [];
  const counts = { balance: 0, subscription: 0, uploads: 0, chats: 0, posts: 0, histories: 0, results: 0 };
  const transactions = new Map<string, { model_id: string; ack: string; result_message: string; input_count: number }>();
  const runtime = createObservedOwnerRuntime({ ownerUniImageReferencesEnabled: true, fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/api/v1/user/balance") { counts.balance += 1; return Response.json({ balance: "0.000" }); }
    if (url.pathname === "/api/v1/user/subscription") {
      counts.subscription += 1; return Response.json({ active: true, type: "pro", end_date: null });
    }
    if (url.pathname === "/api/v2/get_model_info") {
      modelReads.push(url); return Response.json({ access: true, cost: 1, discount_cost: null,
        free_remaining_generations: null, limit: null, show_warning: false });
    }
    if (url.pathname === "/api/v1/chats/upload-files" && init?.method === "POST") {
      counts.uploads += 1;
      const form = init.body as FormData; const file = form.get("files");
      assert.ok(file instanceof File);
      return Response.json({ files: [{ id: `uni-runtime-file-${counts.uploads}`,
        url: `https://r2.syntx.ai/uni/runtime-input-${counts.uploads}.jpg`, mime_type: file.type,
        size: file.size, model_type: String(form.get("model_type")) }] });
    }
    if (url.pathname === "/api/v1/chats" && init?.method === "POST") {
      counts.chats += 1; return Response.json({ uuid: `uni-runtime-chat-${counts.chats}` });
    }
    if (url.pathname === "/api/v1/design/generate" && init?.method === "POST") {
      counts.posts += 1;
      const body = JSON.parse(String(init.body)) as { settings: { model_type: string; file_urls?: unknown[] } };
      const tx = { model_id: body.settings.model_type, ack: `uni-runtime-ack-${counts.posts}`,
        result_message: `uni-runtime-result-${counts.posts}`, input_count: body.settings.file_urls?.length ?? 0 };
      transactions.set(`uni-runtime-chat-${counts.chats}`, tx);
      return Response.json({ id: tx.ack });
    }
    const history = url.pathname.match(/^\/api\/v1\/chats\/(uni-runtime-chat-\d+)\/messages$/u);
    if (history && init?.method === "GET") {
      counts.histories += 1; const tx = transactions.get(history[1]!); assert.ok(tx);
      const ownerObjects = Array.from({ length: tx.input_count }, (_unused, index) => ({ id: `runtime-input-${index}`,
        message_id: tx.ack, object_type: "image", model_type: tx.model_id }));
      const resultObjects = [1, 2].map((index) => ({ id: `runtime-result-object-${index}`,
        message_id: tx.result_message, object_type: "image", model_type: tx.model_id }));
      return Response.json({ messages: [
        { id: tx.ack, chat_id: 700 + counts.posts, author_id: 100, message_object: ownerObjects },
        { id: tx.result_message, chat_id: 700 + counts.posts, author_id: -1, message_object: resultObjects }
      ], pagination: { page: 1, page_size: 10, total_count: 2, total_pages: 1, has_next: false, has_previous: false } });
    }
    const result = url.pathname.match(/^\/api\/v1\/chats\/(uni-runtime-chat-\d+)\/(uni-runtime-result-\d+)$/u);
    if (result && init?.method === "GET") {
      counts.results += 1; const tx = transactions.get(result[1]!); assert.ok(tx);
      return Response.json({ id: tx.result_message, chat_id: 700 + counts.posts, author_id: -1,
        message_object: [1, 2].map((index) => ({ id: `runtime-result-object-${index}`, message_id: tx.result_message,
          object_type: "image", model_type: tx.model_id, completed: true,
          object_url: `https://r2.syntx.ai/uni/runtime-result-${index}.png` })) });
    }
    throw new Error(`Unexpected synthetic Uni runtime route ${url.pathname}`);
  } } as unknown as Parameters<typeof createObservedOwnerRuntime>[0]);
  const composition = runtime.serverOptions.ownerUniImageReferences;
  assert.ok(composition);
  const attemptId = "link_uni_runtime_reads_012345678901";
  await linkSyntheticAttempt(runtime, attemptId);
  try {
    const modifyUpload = await composition.uploadService.upload({ attemptId, model_id: "uni-1.1-modify-image",
      content_base64: JPEG_BYTES.toString("base64"), filename: "modify.jpg", mime_type: "image/jpeg" });
    const removeUpload = await composition.uploadService.upload({ attemptId, model_id: "uni-1.1-remove-background",
      content_base64: JPEG_BYTES.toString("base64"), filename: "remove.jpg", mime_type: "image/jpeg" });
    const cases = [
      { variant: "uni-1" as const, prompt: "explicit prompt", parameters: { aspect_ratio: "16:9" as const, seed: null, mode: "auto" as const },
        image_reference_handles: [] as string[], main_image_reference_handle: null },
      { variant: "uni-1.1-modify-image" as const, prompt: "modify this image", parameters: { seed: 0, mode: "manga" as const },
        image_reference_handles: [modifyUpload.reference_handle], main_image_reference_handle: modifyUpload.reference_handle },
      { variant: "uni-1.1-remove-background" as const, prompt: "", parameters: { invert_mask: false },
        image_reference_handles: [removeUpload.reference_handle], main_image_reference_handle: null }
    ];
    for (const item of cases) {
      const result = await composition.generationService.generate({ attemptId, ...item });
      assert.equal(result.observation_status, "COMPLETE");
    }
    for (const model_id of ["uni-1", "uni-1.1-modify-image", "uni-1.1-remove-background"]) {
      const reads = modelReads.filter((url) => url.searchParams.get("model_type") === model_id);
      assert.equal(reads.length, 2, `${model_id} must have two distinct live model-access reads`);
      for (const url of reads) {
        assert.equal(url.searchParams.get("ai_name"), "luma_image");
        assert.deepEqual([...url.searchParams.keys()].sort(), ["ai_name", "model_type"]);
      }
    }
    assert.deepEqual(counts, { balance: 6, subscription: 6, uploads: 2, chats: 3, posts: 3, histories: 3, results: 3 });
  } finally { await composition.generationService.close(); }
});
