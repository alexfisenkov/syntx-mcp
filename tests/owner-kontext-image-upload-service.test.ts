import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerKontextImageUploadService } from "../src/application/owner-kontext-image-upload-service.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";
import {
  prepareOwnerKontextImageRequest
} from "../src/application/owner-kontext-image-request-preparer.js";
import type { OwnerKontextImageVariant } from "../src/application/owner-kontext-image-parameters.js";

const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const ATTEMPT = "link_kontext_upload_service_0123456789";
const AUTH_BINDING = Object.freeze({ tenant_id: "kontext-upload-tenant", subject: "kontext-upload-subject" });
const PRINCIPAL = Object.freeze({
  tenant_id: AUTH_BINDING.tenant_id,
  subject_id: AUTH_BINDING.subject,
  connection_id: ATTEMPT
});
const CATALOG = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const PNG_1X1 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=";
const JPEG_1X1 = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9
]);
const AVIF_16X16 = "AAAAIGZ0eXBhdmlmAAAAAGF2aWZtaWYxbWlhZk1BMUIAAAD5bWV0YQAAAAAAAAAvaGRscgAAAAAAAAAAcGljdAAAAAAAAAAAAAAAAFBpY3R1cmVIYW5kbGVyAAAAAA5waXRtAAAAAAABAAAAHmlsb2MAAAAARAAAAQABAAAAAQAAASEAAAAkAAAAKGlpbmYAAAAAAAEAAAAaaW5mZQIAAAAAAQAAYXYwMUNvbG9yAAAAAGppcHJwAAAAS2lwY28AAAAUaXNwZQAAAAAAAAAQAAAAEAAAABBwaXhpAAAAAAMICAgAAAAMYXYxQ4EADAAAAAATY29scm5jbHgAAgACAAIAAAAAF2lwbWEAAAAAAAAAAQABBAECgwQAAAAsbWRhdAoKAAAAAZ/41fIAgDIWEACXgBBAggAAEABcEytNbG+TY8nR6A==";
const WEBP_1X1 = Buffer.from([
  0x52, 0x49, 0x46, 0x46, 0x12, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
  0x56, 0x50, 0x38, 0x4c, 0x05, 0x00, 0x00, 0x00, 0x2f, 0x00, 0x00, 0x00, 0x00, 0x00
]);
const PARAMETERS = Object.freeze({ resolution: "1024x1024", cfg: 1.05, steps: 10.5, image_strength: 0.123 });

function unusedUploadClient(): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("kontext-service-test-credential");
    }
  };
  return new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async () => { throw new Error("unexpected native upload"); }
  });
}

function testCredentialBroker(): SyntxCredentialBroker {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("kontext-service-test-credential");
    }
  };
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !predicate(); index += 1) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(predicate(), true);
}

function linkedAttempt(attemptId: string) {
  return {
    attempt_id: attemptId,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const,
    expires_at: new Date(NOW + 60 * 60_000).toISOString(),
    linked: true as const
  };
}

test("native upload service binds all variants and a distinct four-reference Multi set through the actual issuer and preparer", async () => {
  const uploads: Array<{ model_type: string; mime_type: string; filename: string; bytes: Buffer; url: string }> = [];
  let expectedVariant: OwnerKontextImageVariant = "flux-kontext-pro";
  let expectedMime = "image/jpeg";
  let expectedFilename = "one.jpg";
  let expectedBytes = JPEG_1X1;
  let uploadIndex = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("kontext-service-test-credential");
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      assert.equal(url.href, "https://api.syntx.ai/api/v1/chats/upload-files");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof FormData);
      const form = init.body as FormData;
      assert.equal(form.get("destination"), "uploaded");
      assert.equal(form.get("check_duplicates"), "true");
      assert.equal(form.get("model_type"), expectedVariant);
      const file = form.get("files");
      assert.ok(file instanceof File);
      assert.equal(file.type, expectedMime);
      assert.equal(file.name, expectedFilename);
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), expectedBytes);
      uploadIndex += 1;
      const objectUrl = `https://r2.syntx.ai/kontext/private-${uploadIndex}.${expectedFilename.split(".").at(-1)}`;
      uploads.push({ model_type: expectedVariant, mime_type: expectedMime, filename: expectedFilename,
        bytes: Buffer.from(expectedBytes), url: objectUrl });
      return Response.json({ files: [{ id: `private-provider-file-${uploadIndex}`, url: objectUrl,
        mime_type: expectedMime, size: expectedBytes.byteLength }] });
    }
  });
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });

  const cases = [
    { variant: "flux-kontext-pro" as const, sources: [{ bytes: JPEG_1X1, filename: "one.jpg", mime_type: "image/jpg" }] },
    { variant: "flux-kontext-max" as const, sources: [{ bytes: Buffer.from(PNG_1X1, "base64"), filename: "two.png", mime_type: "image/png" }] },
    { variant: "flux-kontext-multi" as const, sources: [
      { bytes: Buffer.from(AVIF_16X16, "base64"), filename: "three.avif", mime_type: "image/avif" },
      { bytes: WEBP_1X1, filename: "four.webp", mime_type: "image/webp" },
      { bytes: JPEG_1X1, filename: "five.jpg", mime_type: "image/jpeg" },
      { bytes: Buffer.from(PNG_1X1, "base64"), filename: "six.png", mime_type: "image/png" }
    ] }
  ];
  const handlesByVariant = new Map<OwnerKontextImageVariant, string[]>();
  try {
    for (const item of cases) {
      expectedVariant = item.variant;
      const handles: string[] = [];
      for (const source of item.sources) {
        expectedFilename = source.filename;
        expectedMime = source.mime_type === "image/jpg" ? "image/jpeg" : source.mime_type;
        expectedBytes = Buffer.from(source.bytes);
        const receipt = await service.upload({
          attemptId: ATTEMPT,
          variant: item.variant,
          content_base64: source.bytes.toString("base64"),
          filename: source.filename,
          mime_type: source.mime_type
        });
        assert.equal(receipt.status, "uploaded");
        assert.equal(receipt.variant, item.variant);
        assert.equal(receipt.original_mime_type, source.mime_type);
        assert.equal(receipt.mime_type, expectedMime);
        assert.equal(receipt.size, source.bytes.byteLength);
        assert.equal(receipt.width, source.mime_type === "image/avif" ? 16 : 1);
        assert.equal(receipt.height, source.mime_type === "image/avif" ? 16 : 1);
        assert.match(receipt.reference_handle, /^kontext_image_[0-9a-f-]{36}$/u);
        assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY");
        assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
        assert.equal(JSON.stringify(receipt).includes("private-provider-file"), false);
        assert.equal(JSON.stringify(receipt).includes(source.filename), false);
        handles.push(receipt.reference_handle);
      }
      handlesByVariant.set(item.variant, handles);
    }

    const issuer = service.createOwnedReferenceBindingIssuer();
    for (const item of cases) {
      const handles = handlesByVariant.get(item.variant)!;
      const referenceSet = await issuer.issue({
        principal: PRINCIPAL,
        attempt_id: ATTEMPT,
        variant: item.variant,
        reference_handles: handles
      });
      assert.equal(referenceSet.reference_count, handles.length);
      const candidate = prepareOwnerKontextImageRequest({
        principal: PRINCIPAL,
        attempt_id: ATTEMPT,
        variant: item.variant,
        parameters: PARAMETERS,
        reference_set: referenceSet,
        workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA",
        prompt: `Owner request for ${item.variant}`
      }, { catalog: CATALOG, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, now: () => NOW });
      assert.equal(candidate.variant, item.variant);
      assert.equal(candidate.reference_count, handles.length);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.deepEqual(candidate.request.settings.file_urls.map((entry) => entry.url),
        uploads.filter((upload) => upload.model_type === item.variant).map((upload) => upload.url));
    }
    assert.equal(handlesByVariant.get("flux-kontext-multi")?.length, 4);
    const proHandle = handlesByVariant.get("flux-kontext-pro")![0]!;
    await assert.rejects(issuer.issue({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      variant: "flux-kontext-multi",
      reference_handles: [proHandle]
    }));
    await assert.rejects(issuer.issue({
      principal: Object.freeze({ ...PRINCIPAL, subject_id: "different-owner" }),
      attempt_id: ATTEMPT,
      variant: "flux-kontext-pro",
      reference_handles: [proHandle]
    }));
    assert.equal(new Set(uploads.filter((upload) => upload.model_type === "flux-kontext-multi")
      .map((upload) => upload.bytes.toString("hex"))).size, 4);
    assert.equal(uploadIndex, 6);
  } finally {
    await service.close();
  }
});

test("empty Pro/Max issuer sets still require a linked current principal", async () => {
  const client = unusedUploadClient();
  let calls = 0;
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { calls += 1; return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  try {
    const issuer = service.createOwnedReferenceBindingIssuer();
    for (const variant of ["flux-kontext-pro", "flux-kontext-max"] as const) {
      const attemptId = `link_kontext_empty_${variant}`;
      const principal = Object.freeze({ ...PRINCIPAL, connection_id: attemptId });
      const set = await issuer.issue({ principal, attempt_id: attemptId, variant, reference_handles: [] });
      assert.equal(set.reference_count, 0);
    }
    assert.equal(calls, 4);
  } finally {
    await service.close();
  }

  let changingCalls = 0;
  const changedPrincipalService = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) {
      changingCalls += 1;
      if (changingCalls > 1) throw new Error("link revoked during issuer call");
      return linkedAttempt(attemptId);
    } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  try {
    const issuer = changedPrincipalService.createOwnedReferenceBindingIssuer();
    await assert.rejects(
      issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [] }),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "PRINCIPAL_NOT_LINKED"
    );
    assert.equal(changingCalls, 2);
  } finally {
    await changedPrincipalService.close();
  }
});

test("reference expiry starts before native HTTP and cannot be renewed by issuer resolution", async () => {
  let now = NOW;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("kontext-service-test-credential");
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (_input, init) => {
      assert.equal(init?.method, "POST");
      now += 2_500;
      return Response.json({ files: [{ id: "private-provider-file", url: "https://r2.syntx.ai/kontext/private.jpg",
        mime_type: "image/jpeg", size: JPEG_1X1.byteLength }] });
    }
  });
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => now
  });
  try {
    const receipt = await service.upload({
      attemptId: ATTEMPT,
      variant: "flux-kontext-pro",
      content_base64: JPEG_1X1.toString("base64"),
      filename: "expiry.jpg",
      mime_type: "image/jpeg"
    });
    assert.equal(receipt.expires_in_seconds, 898);
    now = NOW + 900_001;
    const issuer = service.createOwnedReferenceBindingIssuer();
    await assert.rejects(issuer.issue({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      variant: "flux-kontext-pro",
      reference_handles: [receipt.reference_handle]
    }));
  } finally {
    await service.close();
  }
});

test("ambiguous native upload exposes no handle and is never retried", async () => {
  let posts = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("kontext-service-test-credential");
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async () => {
      posts += 1;
      return Response.json({ files: [] });
    }
  });
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  try {
    await assert.rejects(service.upload({
      attemptId: ATTEMPT,
      variant: "flux-kontext-pro",
      content_base64: JPEG_1X1.toString("base64"),
      filename: "unknown.jpg",
      mime_type: "image/jpeg"
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "UPLOAD_OUTCOME_UNKNOWN");
    assert.equal(posts, 1);
    const issuer = service.createOwnedReferenceBindingIssuer();
    await assert.rejects(issuer.issue({
      principal: PRINCIPAL,
      attempt_id: ATTEMPT,
      variant: "flux-kontext-pro",
      reference_handles: ["kontext_image_00000000-0000-4000-8000-000000000000"]
    }));
  } finally {
    await service.close();
  }
});

test("pending work is capped at four and rejects a fifth before native POST", async () => {
  let posts = 0;
  const release: Array<(response: Response) => void> = [];
  const client = new SyntxChatHttpClient({
    credentialBroker: testCredentialBroker(),
    fetchImpl: async () => {
      posts += 1;
      return new Promise<Response>((resolve) => release.push(resolve));
    }
  });
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  const input = (index: number) => ({
    attemptId: ATTEMPT,
    variant: "flux-kontext-pro" as const,
    content_base64: JPEG_1X1.toString("base64"),
    filename: `pending-${index}.jpg`,
    mime_type: "image/jpeg"
  });
  try {
    const pending = [0, 1, 2, 3].map((index) => service.upload(input(index)));
    await waitFor(() => posts === 4);
    await assert.rejects(service.upload(input(4)),
      (error: unknown) => error instanceof Error && "code" in error && error.code === "SERVICE_BUSY");
    assert.equal(posts, 4);
    for (let index = 0; index < release.length; index += 1) {
      release[index]!(Response.json({ files: [{ id: `pending-${index}`, url: `https://r2.syntx.ai/kontext/pending-${index}.jpg`,
        mime_type: "image/jpeg", size: JPEG_1X1.byteLength }] }));
    }
    assert.equal((await Promise.all(pending)).length, 4);
  } finally {
    await service.close();
  }
});

test("128 live handles and empty-owner attempts are bounded, then expiry prunes idle issuer state", async () => {
  let uploadPosts = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: testCredentialBroker(),
    fetchImpl: async () => {
      uploadPosts += 1;
      return Response.json({ files: [{ id: `capacity-${uploadPosts}`, url: `https://r2.syntx.ai/kontext/capacity-${uploadPosts}.jpg`,
        mime_type: "image/jpeg", size: JPEG_1X1.byteLength }] });
    }
  });
  let now = NOW;
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus(_binding: unknown, attemptId: string) { return linkedAttempt(attemptId); } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => now
  });
  try {
    for (let index = 0; index < 128; index += 1) {
      await service.upload({ attemptId: ATTEMPT, variant: "flux-kontext-pro", content_base64: JPEG_1X1.toString("base64"),
        filename: `capacity-${index}.jpg`, mime_type: "image/jpeg" });
    }
    await assert.rejects(service.upload({ attemptId: ATTEMPT, variant: "flux-kontext-pro", content_base64: JPEG_1X1.toString("base64"),
      filename: "capacity-overflow.jpg", mime_type: "image/jpeg" }),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "CAPACITY_EXCEEDED");
    assert.equal(uploadPosts, 128);
    await service.invalidateAttempt(ATTEMPT);

    const issuer = service.createOwnedReferenceBindingIssuer();
    for (let index = 0; index < 128; index += 1) {
      const attemptId = `link_kontext_empty_cap_${index.toString().padStart(3, "0")}`;
      const principal = Object.freeze({ ...PRINCIPAL, connection_id: attemptId });
      await issuer.issue({ principal, attempt_id: attemptId, variant: "flux-kontext-pro", reference_handles: [] });
    }
    const overflowAttempt = "link_kontext_empty_cap_overflow";
    await assert.rejects(issuer.issue({
      principal: Object.freeze({ ...PRINCIPAL, connection_id: overflowAttempt }),
      attempt_id: overflowAttempt,
      variant: "flux-kontext-pro",
      reference_handles: []
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "CAPACITY_EXCEEDED");
    now += 900_001;
    const freshAttempt = "link_kontext_empty_cap_afterexpiry";
    const freshSet = await issuer.issue({
      principal: Object.freeze({ ...PRINCIPAL, connection_id: freshAttempt }),
      attempt_id: freshAttempt,
      variant: "flux-kontext-pro",
      reference_handles: []
    });
    assert.equal(freshSet.reference_count, 0);
    assert.equal(uploadPosts, 128);
  } finally {
    await service.close();
  }
});

test("close and attempt invalidation bound blocked owner lookups and ignore late resolutions", async () => {
  let releaseStatus!: (value: unknown) => void;
  const blockedStatus = new Promise<unknown>((resolve) => { releaseStatus = resolve; });
  let statusCalls = 0;
  const client = unusedUploadClient();
  const service = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus() { statusCalls += 1; return blockedStatus; } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  const input = {
    attemptId: ATTEMPT,
    variant: "flux-kontext-pro" as const,
    content_base64: JPEG_1X1.toString("base64"),
    filename: "blocked.jpg",
    mime_type: "image/jpeg"
  };
  const upload = service.upload(input);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(statusCalls, 1);
  const invalidation = service.invalidateAttempt(ATTEMPT);
  const invalidated = await Promise.race([invalidation.then(() => "done"), new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100))]);
  assert.equal(invalidated, "done");
  await assert.rejects(upload, (error: unknown) => error instanceof Error && "code" in error && error.code === "REQUEST_ABORTED");
  releaseStatus(linkedAttempt(ATTEMPT));
  await service.close();

  let releaseCloseStatus!: (value: unknown) => void;
  const blockedCloseStatus = new Promise<unknown>((resolve) => { releaseCloseStatus = resolve; });
  const closeService = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus() { return blockedCloseStatus; } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  const closeUpload = closeService.upload(input);
  await new Promise((resolve) => setImmediate(resolve));
  const closing = await Promise.race([closeService.close().then(() => "done"), new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100))]);
  assert.equal(closing, "done");
  await assert.rejects(closeUpload, (error: unknown) => error instanceof Error && "code" in error && error.code === "REQUEST_ABORTED");
  releaseCloseStatus(linkedAttempt(ATTEMPT));

  let releaseIssuerStatus!: (value: unknown) => void;
  const blockedIssuerStatus = new Promise<unknown>((resolve) => { releaseIssuerStatus = resolve; });
  const issuerService = new OwnerKontextImageUploadService({
    binding: AUTH_BINDING,
    linkService: { async getStatus() { return blockedIssuerStatus; } } as never,
    catalog: CATALOG,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
  const issuer = issuerService.createOwnedReferenceBindingIssuer();
  const pendingIssue = issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant: "flux-kontext-pro", reference_handles: [] });
  await new Promise((resolve) => setImmediate(resolve));
  issuer.close();
  const issuerClosed = await Promise.race([pendingIssue.then(() => "resolved", () => "rejected"),
    new Promise<string>((resolve) => setTimeout(() => resolve("timeout"), 100))]);
  assert.equal(issuerClosed, "rejected");
  releaseIssuerStatus(linkedAttempt(ATTEMPT));
  await issuerService.close();
});
