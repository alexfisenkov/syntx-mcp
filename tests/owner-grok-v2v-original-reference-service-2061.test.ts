import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { access, chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient, readOwnerGrokV2vUploadReferenceForClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import {
  OwnerGrokV2vOriginalReferenceService,
  OwnerGrokV2vOriginalReferenceServiceError
} from "../src/application/owner-grok-v2v-original-reference-service.js";

const ATTEMPT_A = "link_grok_owner_0123456789abcdef";
const ATTEMPT_B = "link_grok_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "grok-reference-test-tenant", subject: "grok-reference-test-owner" });
const REFERENCE_URL = "https://r2.syntx.ai/grok-v2v/hidden/original.mp4";
const OUTPUT = JSON.stringify({
  streams: [
    { codec_type: "video", codec_name: "h264", width: 960, height: 432, duration: "6.2", disposition: { attached_pic: 0 } },
    { codec_type: "audio", codec_name: "aac", duration: "6.25" }
  ],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "6.24" }
});

function originalBytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-grok-reference-credential");
  } };
}

async function linkedOwners(attemptIds: readonly string[], now: () => number): Promise<PerUserLinkService> {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `grok-reference-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-linked-owner-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), {
    now,
    attemptIdGenerator: () => attemptIds[next++]!
  });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING);
    await links.issueHandoff(BINDING, attemptId);
    await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}

async function ffprobeFixture(marker?: string): Promise<{ directory: string; binary: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-grok-v2v-reference-2061-"));
  const binary = join(directory, "ffprobe-fixture");
  const program = `#!${process.execPath}\nconst fs=require("node:fs");const args=process.argv.slice(2);` +
    `const inputPath=args.at(-1);if(!inputPath||!fs.statSync(inputPath).isFile())process.exit(40);` +
    `const whitelist=args.indexOf("-protocol_whitelist"),entries=args.indexOf("-show_entries");` +
    `if(whitelist<0||args[whitelist+1]!=="file"||entries<0||!args[entries+1].includes("stream_disposition=attached_pic"))process.exit(41);` +
    (marker ? `fs.writeFileSync(${JSON.stringify(marker)},inputPath);` : "") +
    `process.stdout.write(${JSON.stringify(OUTPUT)});\n`;
  await writeFile(binary, program, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary) };
}

type Service = Pick<OwnerGrokV2vOriginalReferenceService,
  "uploadReference" | "resolveReference" | "isOwnedReferenceResolution" | "withCapturedNativeReference" | "invalidateAttempt" | "close">;

function makeService(options: Record<string, unknown>): Service {
  return new OwnerGrokV2vOriginalReferenceService(options);
}

function uploadInput(attemptId = ATTEMPT_A) {
  return { attemptId, model_id: "grok_v2v", filename: "original.mp4", mime_type: "video/mp4", bytes: originalBytes() };
}

function successfulUploadClient(onFetch?: (form: FormData, signal: AbortSignal | null | undefined) => Promise<Response> | Response): SyntxChatHttpClient {
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "hidden");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "grok_v2v");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.name, "original.mp4");
    assert.equal(file.type, "video/mp4");
    assert.deepEqual(new Uint8Array(await file.arrayBuffer()), originalBytes());
    if (onFetch) return await onFetch(form, init?.signal);
    return response({ files: [{ url: REFERENCE_URL, filename: "original.mp4", status: "success",
      size: originalBytes().byteLength, content_type: "video/mp4" }] });
  } });
}

const posixFixture = { skip: process.platform === "win32" ? "POSIX fixture; real Windows ffprobe acceptance NOT_RUN" : false };

test("uploads one local-probed V2V original and returns an opaque owner-bound resolution with same-client URL access", posixFixture, async () => {
  const marker = join(tmpdir(), `syntx-grok-reference-path-${process.pid}-${Date.now()}`);
  const fixture = await ffprobeFixture(marker);
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  let posts = 0;
  const client = successfulUploadClient(async () => { posts += 1; return response({ files: [{ url: REFERENCE_URL,
    filename: "original.mp4", status: "success", size: originalBytes().byteLength, content_type: "video/mp4" }] }); });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  try {
    const receipt = await service.uploadReference(uploadInput());
    assert.equal(posts, 1);
    assert.match(receipt.grok_reference_handle, /^grok_v2v_reference_[0-9a-f-]{36}$/u);
    assert.deepEqual(receipt, {
      status: "uploaded", grok_reference_handle: receipt.grok_reference_handle, model_id: "grok_v2v",
      mime_type: "video/mp4", size: 28, sha256: createHash("sha256").update(originalBytes()).digest("hex"), width: 960, height: 432,
      duration_seconds: 6.25, input_confidence: "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE", expires_in_seconds: 900
    });
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/u);
    assert.equal(JSON.stringify(receipt).includes(REFERENCE_URL), false);
    const tempPath = await import("node:fs/promises").then(({ readFile }) => readFile(marker, "utf8"));
    const { access } = await import("node:fs/promises");
    await assert.rejects(access(tempPath));

    const resolveInput = { attemptId: ATTEMPT_A, model_id: "grok_v2v", grok_reference_handle: receipt.grok_reference_handle };
    const resolution = await service.resolveReference(resolveInput);
    assert.equal(resolution.role, "grok_v2v_original_reference");
    assert.equal(resolution.wire_type, "video");
    assert.equal(resolution.attempt_id, ATTEMPT_A);
    assert.equal(resolution.model_id, "grok_v2v");
    assert.equal(resolution.ai_name, "grok_video");
    assert.equal(resolution.source_sha256, receipt.sha256);
    assert.equal(resolution.size, 28);
    assert.equal(resolution.duration_seconds, 6.25);
    assert.equal(resolution.generation_permit, false);
    assert.equal(resolution.input_confidence, "LOCAL_FFPROBE_METADATA_ONLY_NO_DECODE");
    assert.equal(Object.hasOwn(resolution, "url"), false);
    assert.equal(JSON.stringify(resolution).includes(REFERENCE_URL), false);
    assert.equal(service.isOwnedReferenceResolution(resolution, resolveInput), true);
    assert.equal(service.withCapturedNativeReference(resolution, (capturedClient, context) =>
      readOwnerGrokV2vUploadReferenceForClient(capturedClient, context)?.url), REFERENCE_URL);
    const otherClient = new SyntxChatHttpClient({ credentialBroker: broker() });
    const context = service.withCapturedNativeReference(resolution, (_capturedClient, uploadContext) => uploadContext);
    assert.equal(readOwnerGrokV2vUploadReferenceForClient(otherClient, context), null);
    assert.equal(posts, 1);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
});

test("same source handle cannot be resolved from a different linked attempt", posixFixture, async () => {
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  const client = successfulUploadClient();
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  try {
    const receipt = await service.uploadReference(uploadInput(ATTEMPT_A));
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_B, model_id: "grok_v2v",
      grok_reference_handle: receipt.grok_reference_handle }), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    const own = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "grok_v2v",
      grok_reference_handle: receipt.grok_reference_handle });
    assert.equal(service.isOwnedReferenceResolution(own), true);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("15-minute expiry and explicit invalidation revoke resolutions without extending TTL", posixFixture, async () => {
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  const client = successfulUploadClient();
  let now = 1_000;
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => now });
  try {
    const first = await service.uploadReference(uploadInput(ATTEMPT_A));
    assert.equal(first.expires_in_seconds, 900);
    const firstResolution = await service.resolveReference({ attemptId: ATTEMPT_A, model_id: "grok_v2v",
      grok_reference_handle: first.grok_reference_handle });
    const expiresAt = firstResolution.expires_at;
    assert.equal(expiresAt, 901_000);

    const second = await service.uploadReference(uploadInput(ATTEMPT_B));
    const secondResolution = await service.resolveReference({ attemptId: ATTEMPT_B, model_id: "grok_v2v",
      grok_reference_handle: second.grok_reference_handle });
    await service.invalidateAttempt(ATTEMPT_B);
    assert.equal(service.isOwnedReferenceResolution(secondResolution), false);
    assert.throws(() => service.withCapturedNativeReference(secondResolution, () => "not reachable"), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");

    now = expiresAt - 1;
    assert.equal(service.isOwnedReferenceResolution(firstResolution), true);
    now = expiresAt;
    assert.equal(service.isOwnedReferenceResolution(firstResolution), false);
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "grok_v2v",
      grok_reference_handle: first.grok_reference_handle }), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("a pending duplicate is blocked and an unknown POST outcome tombstones the content across attempts", posixFixture, async () => {
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B], () => 1_000);
  let notifyStarted!: () => void;
  const postStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let rejectFirst!: (error: Error) => void;
  const held = new Promise<Response>((_resolve, reject) => { rejectFirst = reject; });
  let posts = 0;
  const client = successfulUploadClient(async () => {
    posts += 1;
    if (posts === 1) { notifyStarted(); return held; }
    return response({ files: [{ url: REFERENCE_URL, filename: "original.mp4", status: "success",
      size: originalBytes().byteLength, content_type: "video/mp4" }] });
  });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  const first = service.uploadReference(uploadInput(ATTEMPT_A));
  try {
    await postStarted;
    await assert.rejects(service.uploadReference(uploadInput(ATTEMPT_B)), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "SERVICE_BUSY");
    assert.equal(posts, 1);
    rejectFirst(new Error("synthetic transport loss after POST dispatch"));
    await assert.rejects(first, (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await assert.rejects(service.uploadReference(uploadInput(ATTEMPT_B)), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally {
    rejectFirst(new Error("cleanup"));
    await first.catch(() => undefined);
    await service.close();
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("client replacement after possible POST returns no reference handle", posixFixture, async () => {
  const fixture = await ffprobeFixture();
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  let posts = 0, clientLookups = 0;
  const uploadClient = successfulUploadClient(async () => {
    posts += 1;
    return response({ files: [{ url: REFERENCE_URL, filename: "original.mp4", status: "success",
      size: originalBytes().byteLength, content_type: "video/mp4" }] });
  });
  const replacementClient = new SyntxChatHttpClient({ credentialBroker: broker() });
  const service = makeService({ binding: BINDING, linkService: links,
    resolveClient: () => ++clientLookups <= 2 ? uploadClient : replacementClient,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  try {
    await assert.rejects(service.uploadReference(uploadInput()), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); }
});

test("close aborts and drains a pending native upload before releasing its probe", posixFixture, async () => {
  const marker = join(tmpdir(), `syntx-grok-reference-close-path-${process.pid}-${Date.now()}`);
  const fixture = await ffprobeFixture(marker);
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  let notifyStarted!: () => void;
  const postStarted = new Promise<void>((resolve) => { notifyStarted = resolve; });
  let posts = 0;
  const client = successfulUploadClient(async (_form, signal) => {
    posts += 1;
    notifyStarted();
    return await new Promise<Response>((_resolve, reject) => {
      const aborted = () => reject(new DOMException("aborted", "AbortError"));
      if (signal?.aborted) { aborted(); return; }
      signal?.addEventListener("abort", aborted, { once: true });
    });
  });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: fixture.binary, destination: "hidden", now: () => 1_000 });
  const pending = service.uploadReference(uploadInput());
  try {
    await postStarted;
    const closing = service.close();
    await assert.rejects(pending, (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    await closing;
    assert.equal(posts, 1);
    const inputPath = await readFile(marker, "utf8");
    await assert.rejects(access(inputPath));
    await assert.rejects(access(dirname(inputPath)));
    await assert.rejects(service.resolveReference({ attemptId: ATTEMPT_A, model_id: "grok_v2v",
      grok_reference_handle: "grok_v2v_reference_00000000-0000-4000-8000-000000000000" }), (error: unknown) =>
      error instanceof OwnerGrokV2vOriginalReferenceServiceError && error.code === "SERVICE_CLOSED");
  } finally { await service.close(); await rm(fixture.directory, { recursive: true, force: true }); await rm(marker, { force: true }); }
});

test("reference-service guard accepts only its genuine instance, not prototype clones or proxies", async () => {
  const links = await linkedOwners([ATTEMPT_A], () => 1_000);
  const client = new SyntxChatHttpClient({ credentialBroker: broker() });
  const service = makeService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffprobePath: "/trusted/operator/ffprobe", destination: "hidden", now: () => 1_000 });
  try {
    const module = await import("../src/application/owner-grok-v2v-original-reference-service.js");
    const guard: unknown = Reflect.get(module, "isOwnerGrokV2vOriginalReferenceService");
    assert.equal(typeof guard, "function", "a nominal predicate must be exported for runtime composition");
    if (typeof guard !== "function") return;
    assert.equal(guard(service), true);
    assert.equal(guard(Object.create(Object.getPrototypeOf(service))), false);
    assert.equal(guard({ ...service }), false);
    assert.equal(guard(new Proxy(service, {})), false);
  } finally { await service.close(); }
});
