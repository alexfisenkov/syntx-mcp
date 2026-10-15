import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import test from "node:test";
import { createMcpServer } from "../src/mcp/server.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";
import { readOwnerKlingKeyframesFlag } from "../src/transports/stdio-owner.js";
import { closeOwnerImageReferenceServiceOnTransportEof } from "../src/transports/stdio-owner.js";

const TOOL_NAMES = [
  "syntx_owner_get_kling_keyframes_input_policy",
  "syntx_owner_upload_kling_keyframes_image",
  "syntx_owner_check_kling_keyframes_images"
] as const;
const ATTEMPT = "link_keyframes_runtime_owner_0123456789";
const PNG = png300();

function png300(): Buffer {
  const bytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
  bytes.writeUInt32BE(300, 16); bytes.writeUInt32BE(300, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}
function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}

async function withSdk<T>(application: Parameters<typeof createMcpServer>[0], options: Parameters<typeof createMcpServer>[1],
  run: (client: Client, serverTransport: ReturnType<typeof InMemoryTransport.createLinkedPair>[1]) => Promise<T>): Promise<T> {
  const server = createMcpServer(application, options);
  const client = new Client({ name: "keyframes-input-runtime-1582", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport); await client.connect(clientTransport);
  try { return await run(client, serverTransport); }
  finally { await Promise.all([client.close(), server.close()]); }
}

async function linkSyntheticAttempt(runtime: ReturnType<typeof createObservedOwnerRuntime>, attemptId = ATTEMPT): Promise<void> {
  const binding = runtime.authBinding;
  await runtime.authStore.createAttempt({ attempt_id: attemptId, binding, expires_at_ms: Date.now() + 3 * 60 * 60_000 });
  await runtime.authStore.beginHandoff(binding, attemptId);
  await runtime.authStore.attachChallenge(binding, attemptId, "synthetic-keyframes-input");
  await runtime.authStore.beginPoll(binding, attemptId);
  await runtime.authStore.markLinked(binding, attemptId, { scheme: "Bearer", value: "synthetic-keyframes-input-token" });
}

test("Kling Keyframes preserves its 3 input tools and adds generation tools only under strict owner opt-in", async () => {
  assert.equal(readOwnerKlingKeyframesFlag(undefined), false);
  assert.equal(readOwnerKlingKeyframesFlag(""), false);
  assert.equal(readOwnerKlingKeyframesFlag("0"), false);
  assert.equal(readOwnerKlingKeyframesFlag("1"), true);
  for (const value of ["true", "01", " 1", "1 ", "2"]) assert.throws(() => readOwnerKlingKeyframesFlag(value));
  const defaultRuntime = createObservedOwnerRuntime({ fetchImpl: async () => { throw new Error("unexpected startup HTTP"); } });
  await withSdk(defaultRuntime.application, defaultRuntime.serverOptions, async (client) => {
    const names = (await client.listTools()).tools.map(({ name }) => name);
    assert.equal(names.some((name) => TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])), false);
  });

  const requests: { url: string; method: string; name: string; mime: string }[] = [];
  let pendingSignal: AbortSignal | undefined;
  let signalPendingStarted!: () => void;
  const pendingStarted = new Promise<void>((resolve) => { signalPendingStarted = resolve; });
  let now = Date.now();
  const runtime = createObservedOwnerRuntime({
    now: () => now,
    ownerKlingKeyframesEnabled: true,
    fetchImpl: async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input));
      const file = (init?.body as FormData).get("files");
      assert.ok(file instanceof File);
      assert.equal((init?.body as FormData).get("model_type"), "kling_keyframes");
      assert.equal((init?.body as FormData).get("destination"), "uploaded");
      assert.equal((init?.body as FormData).get("check_duplicates"), "true");
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
      requests.push({ url: url.href, method: init?.method ?? "GET", name: file.name, mime: file.type });
      if (file.name === "pending.png") {
        pendingSignal = init?.signal ?? undefined;
        signalPendingStarted();
        return await new Promise<Response>((_resolve, reject) => {
          if (pendingSignal?.aborted) { reject(new DOMException("aborted", "AbortError")); return; }
          pendingSignal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
        });
      }
      return Response.json({ files: [{ id: `keyframes-${requests.length}`, url: `https://r2.syntx.ai/private/${file.name}`,
        filename: file.name, mime_type: file.type, size: PNG.byteLength }] });
    }
  } as never);
  const composition = (runtime.serverOptions as unknown as Record<string, unknown>).ownerKlingKeyframes as Record<string, unknown> | undefined;
  assert.ok(composition, "opt-in must compose the owner input service through the actual runtime");
  await linkSyntheticAttempt(runtime);

  await withSdk(runtime.application, runtime.serverOptions, async (client, serverTransport) => {
    const listed = (await client.listTools()).tools;
    assert.deepEqual(listed.map(({ name }) => name).filter((name) => TOOL_NAMES.includes(name as typeof TOOL_NAMES[number])), TOOL_NAMES);
    const policyTool = listed.find(({ name }) => name === TOOL_NAMES[0]);
    const uploadTool = listed.find(({ name }) => name === TOOL_NAMES[1]);
    const checkTool = listed.find(({ name }) => name === TOOL_NAMES[2]);
    assert.ok(policyTool && uploadTool && checkTool);
    assert.equal(uploadTool.annotations?.readOnlyHint, false);
    assert.equal(uploadTool.annotations?.idempotentHint, false);
    assert.equal(uploadTool.annotations?.openWorldHint, true);
    assert.equal(checkTool.annotations?.readOnlyHint, true);
    assert.equal(checkTool.annotations?.idempotentHint, true);
    assert.equal(checkTool.annotations?.openWorldHint, false);
    assert.equal((uploadTool.inputSchema as { additionalProperties?: boolean }).additionalProperties ?? false, false);
    assert.equal((checkTool.inputSchema as { additionalProperties?: boolean }).additionalProperties ?? false, false);
    assert.deepEqual(Object.keys((uploadTool.inputSchema as { properties: object }).properties).sort(),
      ["link_attempt_id", "content_base64", "filename", "mime_type"].sort());
    assert.deepEqual(Object.keys((checkTool.inputSchema as { properties: object }).properties).sort(),
      ["link_attempt_id", "image_handles"].sort());
    for (const tool of [uploadTool, checkTool]) {
      const fields = Object.keys((tool.inputSchema as { properties: object }).properties);
      for (const forbidden of ["url", "native_context", "principal", "model_id", "destination", "frame_role"]) {
        assert.equal(fields.includes(forbidden), false, `${tool.name} must not accept ${forbidden}`);
      }
    }
    assert.equal(JSON.stringify(uploadTool.description).includes("Provider acceptance is unproven"), true);
    const generationNames = listed.map(({ name }) => name).filter((name) => name.startsWith("syntx_owner_") && name.includes("kling_keyframes"));
    assert.deepEqual(generationNames, [
      "syntx_owner_get_kling_keyframes_input_policy", "syntx_owner_upload_kling_keyframes_image", "syntx_owner_check_kling_keyframes_images",
      "syntx_owner_generate_kling_keyframes", "syntx_owner_reconcile_kling_keyframes",
      "syntx_owner_list_kling_keyframes_recoveries", "syntx_owner_get_kling_keyframes_result_page"
    ]);

    const policy = await client.callTool({ name: TOOL_NAMES[0], arguments: {} });
    const policyDto = policy.structuredContent as Record<string, unknown>;
    assert.equal(policy.isError, undefined);
    assert.equal(policyDto.model_id, "kling_keyframes");
    assert.equal(policyDto.generation_permit, false);
    assert.equal(policyDto.backend_acceptance, "UNPROVEN");
    assert.deepEqual(policyDto.accepted_mime_types, ["image/jpg", "image/jpeg", "image/png", "image/avif"]);

    const input = (filename: string) => ({ link_attempt_id: ATTEMPT, filename, mime_type: "image/png", content_base64: PNG.toString("base64") });
    const first = await client.callTool({ name: TOOL_NAMES[1], arguments: input("start.png") });
    const second = await client.callTool({ name: TOOL_NAMES[1], arguments: input("end.png") });
    assert.equal(first.isError, undefined, JSON.stringify(first));
    assert.equal(second.isError, undefined, JSON.stringify(second));
    const one = first.structuredContent as Record<string, unknown>;
    const two = second.structuredContent as Record<string, unknown>;
    assert.equal(one.generation_permit, undefined);
    assert.equal(one.backend_acceptance, "UNPROVEN");
    assert.equal(JSON.stringify([one, two]).includes("https://"), false);
    for (const forbidden of ["url", "principal", "tenant_id", "subject_id", "connection_id", "epoch"]) {
      assert.equal(JSON.stringify([one, two]).includes(forbidden), false);
    }
    assert.equal(requests.length, 2);

    for (const handles of [[one.image_handle, two.image_handle], [two.image_handle, one.image_handle]]) {
      const result = await client.callTool({ name: TOOL_NAMES[2], arguments: { link_attempt_id: ATTEMPT, image_handles: handles } });
      assert.equal(result.isError, undefined, JSON.stringify(result));
      const checked = result.structuredContent as Record<string, unknown>;
      assert.equal(checked.generation_permit, false);
      assert.equal(checked.backend_acceptance, "UNPROVEN");
      assert.deepEqual((checked.images as { image_handle: string }[]).map(({ image_handle }) => image_handle), handles);
      assert.equal(JSON.stringify(checked).includes("https://"), false);
      assert.equal(JSON.stringify(checked).includes("principal"), false);
      assert.equal(JSON.stringify(checked).includes("epoch"), false);
    }
    const mismatch = await client.callTool({ name: TOOL_NAMES[2], arguments: {
      link_attempt_id: "link_keyframes_runtime_other_0123456789", image_handles: [one.image_handle, two.image_handle]
    } });
    assert.equal(mismatch.isError, true);
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map(({ name }) => name), ["start.png", "end.png"]);
    assert.equal(requests.every(({ method, name, mime, url }) => method === "POST" && name.endsWith(".png") &&
      mime === "image/png" && new URL(url).pathname.endsWith("/api/v1/chats/upload-files")), true);

    now += 16 * 60_000;
    const expired = await client.callTool({ name: TOOL_NAMES[2], arguments: {
      link_attempt_id: ATTEMPT, image_handles: [one.image_handle, two.image_handle]
    } });
    assert.equal(expired.isError, true);
    assert.equal((expired.structuredContent as { code: string }).code, "REFERENCE_EXPIRED");
    const revoked = await client.callTool({ name: "syntx_unlink", arguments: { attempt_id: ATTEMPT } });
    assert.equal(revoked.isError, undefined, JSON.stringify(revoked));
    assert.equal((revoked.structuredContent as { status: string }).status, "REVOKED");
    assert.equal(requests.length, 2);

    await linkSyntheticAttempt(runtime, "link_keyframes_runtime_pending_0123456789");
    const pendingUpload = client.callTool({ name: TOOL_NAMES[1], arguments: {
      link_attempt_id: "link_keyframes_runtime_pending_0123456789",
      filename: "pending.png", mime_type: "image/png", content_base64: PNG.toString("base64")
    } });
    await pendingStarted;
    assert.ok(pendingSignal);
    assert.equal(pendingSignal.aborted, false);
    const lifecycle = (runtime as unknown as { ownerKlingKeyframesLifecycle?: { close(): Promise<void> } }).ownerKlingKeyframesLifecycle;
    assert.ok(lifecycle);
    const eofInput = new PassThrough();
    const closeEof = closeOwnerImageReferenceServiceOnTransportEof(serverTransport, lifecycle, undefined, eofInput);
    eofInput.end();
    await closeEof();
    assert.equal(pendingSignal.aborted, true, "EOF close aborts and drains an in-flight upload before teardown");
    const pendingResult = await pendingUpload;
    assert.equal(pendingResult.isError, true);
  });
});
