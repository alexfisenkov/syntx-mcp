import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SERVICE_MODULE_URL = new URL("../src/application/owner-kling-keyframes-reference-service.js", import.meta.url).href;
const serviceModule = await import(SERVICE_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const ATTEMPT = "link_keyframes_owner_0123456789";
const FOREIGN_ATTEMPT = "link_keyframes_foreign_0123456789";
const BINDING = Object.freeze({ tenant_id: "keyframes-reference-tenant", subject: "keyframes-reference-owner" });
const NOW = Date.parse("2026-10-14T00:00:00.000Z");
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

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-keyframes-test-token"); } };
}

async function linkService(attemptIds: readonly string[] = [ATTEMPT], now = () => NOW) {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `synthetic-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic-link-token" }); return { state: "LINKED" }; }
  };
  const store = new InMemoryAuthLinkStore(now);
  const service = new PerUserLinkService(provider, store, { now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => attemptIds[next++]! });
  for (const attemptId of attemptIds) {
    await service.createAttempt(BINDING); await service.issueHandoff(BINDING, attemptId); await service.checkAttempt(BINDING, attemptId);
  }
  return service;
}

function makeService(options: { readonly linkService: unknown; readonly client: SyntxChatHttpClient; readonly now?: () => number }) {
  const Service = serviceModule?.OwnerKlingKeyframesReferenceService as (new (input: unknown) => {
    upload(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    resolvePair(input: unknown, signal?: AbortSignal): Promise<Record<string, unknown>>;
    getPrivateReferences(value: unknown): Promise<readonly { readonly url: string; readonly type: "image" }[]>;
    isOwnedPairResolution(value: unknown, input: unknown): boolean;
    invalidateAttempt(attemptId: unknown): Promise<void>;
    close(): Promise<void>;
  }) | undefined;
  assert.equal(typeof Service, "function", "MISSING_OWNER_KLING_KEYFRAMES_REFERENCE_SERVICE");
  return new Service!({ binding: BINDING, linkService: options.linkService, resolveClient: () => options.client, now: options.now ?? (() => NOW) });
}

function uploadInput(filename: string, attemptId = ATTEMPT, bytes = PNG) {
  return { attemptId, content_base64: bytes.toString("base64"), filename, mime_type: "image/png" };
}

test("uploads two named Keyframes images once and resolves a sealed ordered pair with private native references", async () => {
  const posts: { filename: string; url: string }[] = [];
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("model_type"), "kling_keyframes");
    assert.equal(form.get("check_duplicates"), "true");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    posts.push({ filename: file.name, url: `https://r2.syntx.ai/hidden/${file.name}` });
    return Response.json({ files: [{ id: `private-${posts.length}`, url: posts.at(-1)!.url, filename: file.name,
      mime_type: "image/png", size: PNG.byteLength }] });
  } });
  let ownerReads = 0;
  const linked = await linkService([ATTEMPT, FOREIGN_ATTEMPT]);
  const getStatus = linked.getStatus.bind(linked);
  linked.getStatus = async (...args: Parameters<typeof linked.getStatus>) => { ownerReads += 1; return getStatus(...args); };
  const service = makeService({ linkService: linked, client });
  try {
    const first = await service.upload(uploadInput("first.png"));
    const second = await service.upload(uploadInput("second.png"));
    assert.equal(posts.length, 2);
    for (const receipt of [first, second]) {
      assert.equal(receipt.status, "uploaded");
      assert.match(String(receipt.image_handle), /^kling_keyframes_image_[0-9a-f-]{36}$/u);
      assert.equal(receipt.model_id, "kling_keyframes");
      assert.equal(receipt.mime_type, "image/png");
      assert.equal(receipt.size, PNG.byteLength);
      assert.equal(receipt.sha256, createHash("sha256").update(PNG).digest("hex"));
      assert.equal(receipt.generation_permit, false);
      assert.equal(JSON.stringify(receipt).includes("https://"), false);
    }
    const handles = [String(first.image_handle), String(second.image_handle)] as const;
    const input = { attempt_id: ATTEMPT, image_handles: handles };
    const pair = await service.resolvePair(input);
    assert.equal(service.isOwnedPairResolution(pair, input), true);
    assert.equal(pair.generation_permit, false);
    assert.deepEqual(await service.getPrivateReferences(pair), [
      { url: posts[0]!.url, type: "image" }, { url: posts[1]!.url, type: "image" }
    ]);
    const reversedInput = { attempt_id: ATTEMPT, image_handles: [handles[1], handles[0]] as const };
    const reversed = await service.resolvePair(reversedInput);
    assert.deepEqual(await service.getPrivateReferences(reversed), [
      { url: posts[1]!.url, type: "image" }, { url: posts[0]!.url, type: "image" }
    ]);
    assert.equal(posts.length, 2, "resolve never repeats native upload");

    const frozenInput = { attempt_id: ATTEMPT, image_handles: Object.freeze([...handles]) as unknown as readonly [string, string] };
    const frozenPair = await service.resolvePair(frozenInput);
    assert.equal(service.isOwnedPairResolution(frozenPair, frozenInput), true);
    assert.deepEqual(await service.getPrivateReferences(frozenPair), [
      { url: posts[0]!.url, type: "image" }, { url: posts[1]!.url, type: "image" }
    ]);
    const sealedHandles = Object.seal([...handles]) as unknown as readonly [string, string];
    const sealedInput = { attempt_id: ATTEMPT, image_handles: sealedHandles };
    const sealedPair = await service.resolvePair(sealedInput);
    assert.equal(service.isOwnedPairResolution(sealedPair, sealedInput), true);
    assert.deepEqual(await service.getPrivateReferences(sealedPair), [
      { url: posts[0]!.url, type: "image" }, { url: posts[1]!.url, type: "image" }
    ]);

    ownerReads = 0;
    let proxyArrayReads = 0;
    const proxiedHandles = new Proxy([...handles], { get(target, property, receiver) {
      proxyArrayReads += 1;
      return Reflect.get(target, property, receiver);
    } });
    await assert.rejects(() => service.resolvePair({ attempt_id: ATTEMPT, image_handles: proxiedHandles }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.equal(proxyArrayReads, 0, "proxy traps must not run while rejecting the pair input");
    assert.equal(ownerReads, 0, "hostile pair input must be rejected before owner lookup");
    assert.equal(posts.length, 2, "hostile pair input must be rejected before native upload");

    let getterReads = 0;
    const accessorHandles = [...handles] as string[];
    Object.defineProperty(accessorHandles, "0", { enumerable: true, configurable: true, get() { getterReads += 1; return handles[0]; } });
    await assert.rejects(() => service.resolvePair({ attempt_id: ATTEMPT, image_handles: accessorHandles }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.equal(getterReads, 0, "accessor values must not be invoked while rejecting the pair input");
    assert.equal(ownerReads, 0, "accessor pair input must be rejected before owner lookup");
    assert.equal(posts.length, 2, "accessor pair input must be rejected before native upload");

    const sparseHandles = new Array<string>(2);
    sparseHandles[0] = handles[0];
    await assert.rejects(() => service.resolvePair({ attempt_id: ATTEMPT, image_handles: sparseHandles }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    const extraHandles = [...handles] as string[] & { extra?: boolean };
    extraHandles.extra = true;
    await assert.rejects(() => service.resolvePair({ attempt_id: ATTEMPT, image_handles: extraHandles }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
    assert.equal(ownerReads, 0, "sparse and extended pair inputs must be rejected before owner lookup");
    assert.equal(posts.length, 2, "sparse and extended pair inputs must be rejected before native upload");

    const clonedPair = { ...pair };
    assert.equal(service.isOwnedPairResolution(clonedPair, input), false);
    await assert.rejects(() => service.getPrivateReferences(clonedPair),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    let proxyResolutionReads = 0;
    const proxiedPair = new Proxy(pair, { get(target, property, receiver) {
      proxyResolutionReads += 1;
      return Reflect.get(target, property, receiver);
    } });
    assert.equal(service.isOwnedPairResolution(proxiedPair, input), false);
    await assert.rejects(() => service.getPrivateReferences(proxiedPair),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    assert.equal(proxyResolutionReads, 0, "untrusted resolution proxy traps must not run");
    assert.deepEqual(await service.getPrivateReferences(pair), [
      { url: posts[0]!.url, type: "image" }, { url: posts[1]!.url, type: "image" }
    ], "genuine pair remains usable after rejecting cloned and proxied inputs");
  } finally { await service.close(); }
});

test("rejects mixed-attempt pairs and stops exposing references after pair expiry", async () => {
  let now = NOW;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `private-${file.name}`, url: `https://r2.syntx.ai/hidden/${file.name}`,
      filename: file.name, mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const service = makeService({ linkService: await linkService([ATTEMPT, FOREIGN_ATTEMPT]), client, now: () => now });
  try {
    const first = await service.upload(uploadInput("owner-a.png"));
    const second = await service.upload(uploadInput("owner-b.png"));
    const foreign = await service.upload(uploadInput("foreign.png", FOREIGN_ATTEMPT));
    await assert.rejects(() => service.resolvePair({ attempt_id: ATTEMPT,
      image_handles: [first.image_handle, foreign.image_handle] }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UNAVAILABLE");
    const input = { attempt_id: ATTEMPT, image_handles: [first.image_handle, second.image_handle] as const };
    const pair = await service.resolvePair(input);
    assert.equal(service.isOwnedPairResolution(pair, input), true);
    now += 15 * 60_000;
    assert.equal(service.isOwnedPairResolution(pair, input), false);
    await assert.rejects(() => service.getPrivateReferences(pair),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED");
  } finally { await service.close(); }
});

test("keeps an unknown native upload sticky and never repeats its POST", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => {
    posts += 1; throw new Error("synthetic lost upload acknowledgement");
  } });
  const service = makeService({ linkService: await linkService(), client });
  try {
    for (let call = 0; call < 2; call += 1) {
      await assert.rejects(() => service.upload(uploadInput("unknown.png")),
        (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    }
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("drains an in-flight native upload on attempt invalidation without replay", async () => {
  let posts = 0, aborts = 0, markStarted!: () => void;
  const started = new Promise<void>((resolve) => { markStarted = resolve; });
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    posts += 1; markStarted();
    return new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal;
      const onAbort = () => { aborts += 1; reject(new DOMException("Synthetic request abort", "AbortError")); };
      if (signal?.aborted) onAbort(); else signal?.addEventListener("abort", onAbort, { once: true });
    });
  } });
  const service = makeService({ linkService: await linkService(), client });
  try {
    const pending = service.upload(uploadInput("draining.png"));
    await started;
    await service.invalidateAttempt(ATTEMPT);
    await assert.rejects(pending,
      (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(aborts, 1);
    assert.equal(posts, 1);
  } finally { await service.close(); }
});

test("invalidates existing handles when the genuine linked owner is revoked", async () => {
  let posts = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_request, init) => {
    posts += 1;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    return Response.json({ files: [{ id: `private-${posts}`, url: `https://r2.syntx.ai/hidden/${file.name}`,
      filename: file.name, mime_type: "image/png", size: PNG.byteLength }] });
  } });
  const linked = await linkService();
  const service = makeService({ linkService: linked, client });
  try {
    const first = await service.upload(uploadInput("revoke-a.png"));
    const second = await service.upload(uploadInput("revoke-b.png"));
    const pairInput = { attempt_id: ATTEMPT, image_handles: [first.image_handle, second.image_handle] as const };
    const pair = await service.resolvePair(pairInput);
    await linked.revoke(BINDING, ATTEMPT);
    await assert.rejects(() => service.getPrivateReferences(pair),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED");
    assert.equal(service.isOwnedPairResolution(pair, pairInput), false);
    assert.equal(posts, 2);
  } finally { await service.close(); }
});
