import assert from "node:assert/strict";
import test from "node:test";
import { OwnerClarityUpscaleUploadService, OwnerClarityUpscaleUploadServiceError } from "../src/application/owner-clarity-upscale-upload-service.js";
import { createOwnerClarityUpscaleOwnedImageBindingIssuer, prepareOwnerClarityUpscaleRequest } from "../src/application/owner-clarity-upscale-request-preparer.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { InternalUploadReference } from "../src/adapter/syntx/upload-reference-bridge.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { AuthBinding } from "../src/auth/types.js";

const ATTEMPT = "link_clarity_upload_test_1234567890";
const BINDING = Object.freeze({ tenant_id: "tenant_clarity_test", subject: "subject_clarity_test" });
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const FFMPEG_AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";
const FILE_URL = "https://r2.syntx.ai/clarity/opaque-asset.png";
const CATALOG = loadSelectedDiscoveryCatalog().discoveryCatalog;

function linkedAttempt(attemptId: string, status: "LINKED" | "REVOKED" = "LINKED") {
  return {
    attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status,
    expires_at: new Date(1_900_000_000_000).toISOString(),
    linked: status === "LINKED"
  };
}

function createService(options: {
  readonly now?: () => number;
  readonly upload?: (input: Record<string, unknown>, signal?: AbortSignal) => Promise<InternalUploadReference[]>;
  readonly statusForCall?: (call: number, attemptId: string) => "LINKED" | "REVOKED";
} = {}) {
  const events: string[] = [];
  let statusCalls = 0;
  let uploadCalls = 0;
  const service = new OwnerClarityUpscaleUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) {
      statusCalls += 1;
      return linkedAttempt(attemptId, options.statusForCall?.(statusCalls, attemptId) ?? "LINKED");
    } } as never,
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        return operation("synthetic-clarity-upload-credential");
      } },
      fetchImpl: async (_input, init) => {
        uploadCalls += 1;
        events.push("upload");
        if (init?.body instanceof FormData && options.upload) {
          const file = init.body.get("files");
          assert.ok(file instanceof File);
          const result = await options.upload({
            bytes: new Uint8Array(await file.arrayBuffer()), filename: file.name, mime_type: file.type
          }, init.signal ?? undefined);
          return new Response(JSON.stringify({ files: result.map((reference) => ({ id: reference.file_id, url: reference.url })) }), {
            status: 200, headers: { "content-type": "application/json" }
          });
        }
        return new Response(JSON.stringify({ files: [{ id: "private-upstream-file-id", url: FILE_URL }] }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
    }),
    ...(options.now === undefined ? {} : { now: options.now })
  });
  return { service, events, get statusCalls() { return statusCalls; }, get uploadCalls() { return uploadCalls; } };
}

function request(overrides: Record<string, unknown> = {}) {
  return { attemptId: ATTEMPT, content_base64: PNG, filename: "clarity.png", mime_type: "image/png", ...overrides };
}

function pngWithExactSize(byteLength: number): Buffer {
  const original = Buffer.from(PNG, "base64");
  const textDataLength = byteLength - original.byteLength - 12;
  const textChunk = Buffer.alloc(textDataLength + 12, 0x41);
  textChunk.writeUInt32BE(textDataLength, 0);
  textChunk.write("tEXt", 4, 4, "ascii");
  textChunk.write("Comment\0", 8, "ascii");
  let crc = 0xffff_ffff;
  for (const byte of textChunk.subarray(4, 8 + textDataLength)) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  textChunk.writeUInt32BE((crc ^ 0xffff_ffff) >>> 0, 8 + textDataLength);
  return Buffer.concat([original.subarray(0, original.byteLength - 12), textChunk, original.subarray(original.byteLength - 12)]);
}

test("Clarity upload issues a private handle and real preparer binding without leaking URL/file ID", async () => {
  const context = createService();
  const uploaded = await context.service.upload(request());
  assert.equal(uploaded.status, "accepted");
  assert.match(uploaded.image_handle, /^clarity_image_[0-9a-f-]{36}$/u);
  assert.equal(uploaded.mime_type, "image/png");
  assert.equal(uploaded.size, 68);
  assert.equal(uploaded.width, 1);
  assert.equal(uploaded.height, 1);
  assert.match(uploaded.sha256, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(uploaded.expires_in_seconds, 900);
  assert.equal(uploaded.upload_destination, "uploaded");
  assert.equal(uploaded.destination_source_binding, "root347_clarity_default_upload");
  assert.deepEqual(uploaded.coverage.implemented_mime_types, ["image/jpeg", "image/png", "image/avif", "image/webp"]);
  assert.equal(uploaded.coverage.implemented_max_bytes, 25 * 1024 * 1024);
  assert.equal(uploaded.coverage.status, "STRUCTURALLY_VALIDATED_NOT_PROVIDER_ACCEPTANCE");
  assert.equal(uploaded.metadata_confidence, "CONTAINER_METADATA_ONLY");
  const serialized = JSON.stringify(uploaded);
  for (const secret of [FILE_URL, "private-upstream-file-id", "clarity.png", PNG]) assert.equal(serialized.includes(secret), false);
  assert.equal(context.uploadCalls, 1);

  const issuer = createOwnerClarityUpscaleOwnedImageBindingIssuer((attemptId, principal, handle) =>
    context.service.resolveOwnedImage(attemptId, principal, handle));
  const binding = await issuer.issue({
    principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    attempt_id: ATTEMPT,
    opaque_image_handle: uploaded.image_handle
  });
  const candidate = prepareOwnerClarityUpscaleRequest({
    principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    attempt_id: ATTEMPT,
    prompt: "A clear enlarged image",
    parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 },
    image_binding: binding
  });
  assert.equal(candidate.status, "blocked");
  assert.equal(candidate.dispatch_allowed, false);
  assert.deepEqual(candidate.request.settings.file_urls, [{ type: "image", url: FILE_URL }]);
  await context.service.close();
});

test("native chat HTTP upload feeds the real Clarity binding issuer and preparer exactly once", async () => {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      credentialCalls += 1;
      return operation("synthetic-clarity-upload-credential");
    }
  };
  const service = new OwnerClarityUpscaleUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => new SyntxChatHttpClient({
      credentialBroker,
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("destination"), "uploaded");
        assert.equal(init.body.get("check_duplicates"), "true");
        assert.equal(init.body.get("model_type"), "clarity");
        const file = init.body.get("files") as File;
        assert.equal(file.name, "clarity.png");
        assert.equal(file.type, "image/png");
        return new Response(JSON.stringify({ files: [{ id: "private-upstream-file-id", url: FILE_URL }] }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
    })
  });
  const uploaded = await service.upload(request());
  assert.equal(fetchCalls, 1);
  assert.equal(credentialCalls, 1);
  const binding = await service.createOwnedImageBindingIssuer().issue({
    principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    attempt_id: ATTEMPT,
    opaque_image_handle: uploaded.image_handle
  });
  const candidate = prepareOwnerClarityUpscaleRequest({
    principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    attempt_id: ATTEMPT,
    parameters: { professional_mode: false, scale_factor: 1.5, strength: 0.5, cfg: 4, denoise: 0.3 },
    image_binding: binding
  });
  assert.equal(candidate.dispatch_allowed, false);
  assert.deepEqual(candidate.request.settings.file_urls, [{ type: "image", url: FILE_URL }]);
  assert.equal(fetchCalls, 1);
  await service.close();
});

test("native app path accepts real AVIF and structural PNG above 7 MiB through the fixed HTTP uploader", async () => {
  const largePng = pngWithExactSize(7 * 1024 * 1024 + 1);
  const cases = [
    { encoded: FFMPEG_AVIF_16X16, filename: "clarity.avif", mime_type: "image/avif", size: Buffer.from(FFMPEG_AVIF_16X16, "base64").byteLength, width: 16, height: 16 },
    { encoded: largePng.toString("base64"), filename: "large.png", mime_type: "image/png", size: largePng.byteLength, width: 1, height: 1 }
  ] as const;
  let fetchCalls = 0;
  let credentialCalls = 0;
  const fileSizes: number[] = [];
  const service = new OwnerClarityUpscaleUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => new SyntxChatHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
        credentialCalls += 1;
        return operation("synthetic-clarity-upload-credential");
      } },
      fetchImpl: async (_input, init) => {
        fetchCalls += 1;
        assert.equal(init?.method, "POST");
        assert.ok(init?.body instanceof FormData);
        assert.equal(init.body.get("destination"), "uploaded");
        assert.equal(init.body.get("check_duplicates"), "true");
        assert.equal(init.body.get("model_type"), "clarity");
        const file = init.body.get("files") as File;
        fileSizes.push(file.size);
        return new Response(JSON.stringify({ files: [{ id: `private-upstream-${fetchCalls}`, url: `${FILE_URL}?case=${fetchCalls}` }] }), {
          status: 200, headers: { "content-type": "application/json" }
        });
      }
    })
  });
  try {
    for (const [index, input] of cases.entries()) {
      const uploaded = await service.upload(request({ content_base64: input.encoded, filename: input.filename, mime_type: input.mime_type }));
      assert.equal(uploaded.mime_type, input.mime_type);
      assert.equal(uploaded.size, input.size);
      assert.equal(uploaded.width, input.width);
      assert.equal(uploaded.height, input.height);
      assert.equal(uploaded.metadata_confidence, "CONTAINER_METADATA_ONLY");
      const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
      const binding = await service.createOwnedImageBindingIssuer().issue({ principal, attempt_id: ATTEMPT, opaque_image_handle: uploaded.image_handle });
      const candidate = prepareOwnerClarityUpscaleRequest({
        principal, attempt_id: ATTEMPT,
        parameters: { professional_mode: false, scale_factor: 2, strength: 0.85, cfg: 6, denoise: 0.2 },
        image_binding: binding
      });
      const fileUrls = candidate.request.settings.file_urls;
      assert.ok(Array.isArray(fileUrls));
      const fileUrl = fileUrls[0];
      assert.ok(fileUrl !== null && typeof fileUrl === "object" && !Array.isArray(fileUrl));
      assert.equal(fileUrl.url, `${FILE_URL}?case=${index + 1}`);
      assert.equal(candidate.dispatch_allowed, false);
    }
    assert.deepEqual(fileSizes, cases.map((input) => input.size));
    assert.equal(fetchCalls, 2);
    assert.equal(credentialCalls, 2);
  } finally { await service.close(); }
});

test("Clarity upload rejects unsupported formats and inputs above its 25 MiB cap", async () => {
  const context = createService();
  await assert.rejects(() => context.service.upload(request({ mime_type: "image/gif" })),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "UNSUPPORTED_SOURCE_FORMAT");
  const tooLarge = "A".repeat(Math.ceil((25 * 1024 * 1024) / 3) * 4 + 4);
  await assert.rejects(() => context.service.upload(request({ content_base64: tooLarge })),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "UNSUPPORTED_SOURCE_SIZE");
  assert.equal(context.uploadCalls, 0);
  await context.service.close();
});

test("Clarity uploader never retries a lost ACK and exposes no raw upload details in errors", async () => {
  let fetches = 0;
  const context = createService({ upload: async () => { fetches += 1; throw new SyntxHttpError("UPSTREAM_TIMEOUT", "private upload URL"); } });
  let failure: unknown;
  await assert.rejects(() => context.service.upload(request()), (error: unknown) => {
    failure = error;
    return error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN";
  });
  assert.equal(context.uploadCalls, 1);
  assert.equal(fetches, 1);
  assert.equal(String(failure).includes(FILE_URL), false);
  assert.equal(String(failure).includes("private upload URL"), false);
  await context.service.close();
});

test("Clarity upload requires exact linked owner before its single upload", async () => {
  const context = createService({ statusForCall: () => "REVOKED" });
  await assert.rejects(() => context.service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  assert.equal(context.uploadCalls, 0);
  await context.service.close();
});

test("Clarity service refuses an unverified structural upload reply without issuing a handle", async () => {
  const context = createService({ upload: async () => [{ file_id: "fake-id", url: "http://attacker.invalid/file.png" }] });
  let failure: unknown;
  await assert.rejects(() => context.service.upload(request()), (error: unknown) => {
    failure = error;
    return error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN";
  });
  assert.equal(String(failure).includes("attacker.invalid"), false);
  assert.equal(String(failure).includes("fake-id"), false);
  await assert.rejects(() => context.service.resolveOwnedImage(ATTEMPT,
    { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    "clarity_image_00000000-0000-4000-8000-000000000001"),
  (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "IMAGE_HANDLE_UNAVAILABLE");
  await context.service.close();
});

test("Clarity upload refuses a structural client that did not use the native producer", async () => {
  let uploadCalls = 0;
  const service = new OwnerClarityUpscaleUploadService({
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => ({ async uploadClarityUpscaleImageReference() {
      uploadCalls += 1;
      return { url: FILE_URL };
    } }) as never
  });
  await assert.rejects(() => service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "INVALID_REQUEST");
  assert.equal(uploadCalls, 0);
  await service.close();
});

test("Clarity upload reserves bounded pending slots before its one POST and drains on close", async () => {
  const startedSignals: AbortSignal[] = [];
  let allStarted!: () => void;
  const fourStarted = new Promise<void>((resolve) => { allStarted = resolve; });
  const context = createService({ upload: async (_input, signal) => {
    startedSignals.push(signal!);
    if (startedSignals.length === 4) allStarted();
    return await new Promise<InternalUploadReference[]>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true });
    });
  } });
  const requests = Array.from({ length: 4 }, () => context.service.upload(request()));
  await fourStarted;
  await assert.rejects(() => context.service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "SERVICE_BUSY");
  assert.equal(context.uploadCalls, 4);
  await context.service.close();
  const settled = await Promise.allSettled(requests);
  assert.equal(settled.every((result) => result.status === "rejected"), true);
  assert.ok(startedSignals.every((signal) => signal.aborted));
});

test("Clarity private handles stop at 128 until expiry or revoke", async () => {
  let sequence = 0;
  const context = createService({ upload: async () => {
    sequence += 1;
    return [{ url: `https://r2.syntx.ai/clarity/opaque-${sequence}.png` }];
  } });
  for (let index = 0; index < 128; index += 1) await context.service.upload(request());
  assert.equal(context.uploadCalls, 128);
  await assert.rejects(() => context.service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "CAPACITY_EXCEEDED");
  assert.equal(context.uploadCalls, 128);
  await context.service.close();
});

test("revocation after upload returns unknown and does not issue a Clarity handle", async () => {
  const context = createService({ statusForCall: (call) => call === 1 ? "LINKED" : "REVOKED" });
  await assert.rejects(() => context.service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(context.uploadCalls, 1);
  await assert.rejects(() => context.service.resolveOwnedImage(ATTEMPT,
    { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    "clarity_image_00000000-0000-4000-8000-000000000001"),
  (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  await context.service.close();
});

test("Clarity private image handle is exact-attempt scoped, expires, and is cleared on revoke/close", async () => {
  let now = 1000;
  const context = createService({ now: () => now });
  const uploaded = await context.service.upload(request());
  await assert.rejects(() => context.service.resolveOwnedImage("link_foreign_1234567890123456",
    { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: "link_foreign_1234567890123456" }, uploaded.image_handle),
  (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "IMAGE_HANDLE_UNAVAILABLE");
  context.service.invalidateAttempt(ATTEMPT);
  await assert.rejects(() => context.service.resolveOwnedImage(ATTEMPT,
    { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT }, uploaded.image_handle),
  (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "IMAGE_HANDLE_UNAVAILABLE");
  const next = await context.service.upload(request());
  now += 15 * 60_000 + 1;
  await assert.rejects(() => context.service.resolveOwnedImage(ATTEMPT,
    { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT }, next.image_handle),
  (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "IMAGE_HANDLE_EXPIRED");
  await context.service.close();
  await assert.rejects(() => context.service.upload(request()),
    (error: unknown) => error instanceof OwnerClarityUpscaleUploadServiceError && error.code === "SERVICE_CLOSED");
});
