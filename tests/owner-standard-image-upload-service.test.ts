import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import type { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerStandardImageUploadService, OwnerStandardImageUploadServiceError } from "../src/application/owner-standard-image-upload-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const ATTEMPT = "link_standard_upload_service_0123456789";
const BINDING = Object.freeze({ tenant_id: "standard-upload-tenant", subject: "standard-upload-subject" });
const NOW = Date.parse("2026-10-10T12:00:00.000Z");
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const VARIANTS = ["banana", "banana-2.1", "banana2", "banana3", "banana3_light", "gpt-image-1", "gpt-image-1.5", "gpt-image-2", "gpt-image-2.5-flare", "gpt-image-2.5-sunburst"] as const;

function mp4Fixture(): Buffer {
  const box = (type: string, payload: Buffer) => {
    const header = Buffer.alloc(8);
    header.writeUInt32BE(payload.byteLength + 8, 0);
    header.write(type, 4, 4, "ascii");
    return Buffer.concat([header, payload]);
  };
  return Buffer.concat([box("ftyp", Buffer.concat([Buffer.from("isom"), Buffer.alloc(4), Buffer.from("isom")])),
    box("mdat", Buffer.from([1])), box("moov", Buffer.alloc(0))]);
}

function pdfFixture(): Buffer {
  return Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\nxref\n0 1\n0000000000 65535 f \ntrailer\n<< /Size 1 >>\nstartxref\n30\n%%EOF\n", "ascii");
}

function credentialBroker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("standard-upload-test-credential"); } };
}

function service(fetchImpl: typeof fetch, linkService: Pick<PerUserLinkService, "getStatus"> = linkedService()) {
  const client = new SyntxChatHttpClient({ credentialBroker: credentialBroker(), fetchImpl });
  return new OwnerStandardImageUploadService({
    binding: BINDING,
    linkService,
    catalog: loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => client,
    now: () => NOW
  });
}

function linkedService() {
  return {
    async getStatus(_binding: typeof BINDING, attemptId: string) {
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: "LINKED" as const, expires_at: null, linked: true as const };
    }
  };
}

test("uploads every frozen standard image variant once and returns a private-metadata-free handle", async () => {
  const expectedUrl = "https://r2.syntx.ai/standard/owned-reference.png";
  let posts = 0;
  const client = service(async (input, init) => {
    posts += 1;
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    const form = init?.body as FormData;
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), PNG);
    return new Response(JSON.stringify({ files: [{ url: expectedUrl, mime_type: "image/png", size: PNG.byteLength }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  });

  for (const variant of VARIANTS) {
    const receipt = await client.upload({ attemptId: ATTEMPT, variant, content_base64: PNG.toString("base64"),
      filename: "reference.png", mime_type: "image/png" });
    assert.equal(receipt.status, "uploaded");
    assert.equal(receipt.variant, variant);
    assert.equal(receipt.kind, "image");
    assert.equal(receipt.original_mime_type, "image/png");
    assert.equal(receipt.mime_type, "image/png");
    assert.equal(receipt.width, 1);
    assert.equal(receipt.height, 1);
    assert.equal(receipt.duration, null);
    assert.equal(receipt.size, PNG.byteLength);
    assert.match(receipt.sha256, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(receipt.expires_in_seconds, 900);
    assert.equal(receipt.metadata_confidence, "CONTAINER_METADATA_ONLY");
    assert.equal(receipt.validation_confidence, variant === "banana-2.1"
      ? "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;BANANA_21_CATALOG_METADATA_CEILING_PROVIDER_UNPROVEN"
      : "JPEG_PNG_WEBP_STRUCTURAL_HEADER_ONLY;LOCAL_PROCESS_32MIB_RESOURCE_CEILING_NOT_PROVIDER_LIMIT");
    assert.equal(Object.isFrozen(receipt), true);
    assert.deepEqual(Object.keys(receipt).sort(), ["duration", "expires_in_seconds", "height", "kind", "metadata_confidence", "mime_type", "original_mime_type", "reference_handle", "sha256", "size", "status", "validation_confidence", "variant", "width"].sort());
    assert.equal("file_url" in receipt, false);
    assert.equal("url" in receipt, false);
    assert.equal("file_id" in receipt, false);
    assert.equal("filename" in receipt, false);
    assert.equal("principal" in receipt, false);

    const issued = await client.createOwnedReferenceBindingIssuer().issue({
      principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
      attempt_id: ATTEMPT, variant, reference_handles: [receipt.reference_handle]
    });
    assert.equal(issued.variant, variant);
    assert.equal(issued.reference_count, 1);
    assert.equal(issued.counts_by_kind.image, 1);
  }
  assert.equal(posts, VARIANTS.length);
  await client.close();
});

test("Banana 2.1 keeps its validated video and PDF media kinds and marks unextracted metadata unknown privately", async () => {
  const inputs = [
    { bytes: mp4Fixture(), filename: "clip.mp4", mime_type: "video/mp4", kind: "video" as const,
      validation: "STRUCTURAL_CONTAINER_VALIDATED_NOT_DECODED" as const },
    { bytes: pdfFixture(), filename: "brief.pdf", mime_type: "application/pdf", kind: "file" as const,
      validation: "PDF_HEADER_TAIL_GUARDS_ONLY_NOT_PARSED" as const }
  ];
  let index = 0;
  const client = service(async (_input, init) => {
    const current = inputs[index++]!;
    const file = (init?.body as FormData).get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, current.mime_type);
    assert.deepEqual(Buffer.from(await file.arrayBuffer()), current.bytes);
    return new Response(JSON.stringify({ files: [{ url: `https://r2.syntx.ai/standard/media-${index}`, mime_type: current.mime_type, size: current.bytes.byteLength }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  });
  const issuer = client.createOwnedReferenceBindingIssuer();
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };

  for (const current of inputs) {
    const receipt = await client.upload({ attemptId: ATTEMPT, variant: "banana-2.1",
      content_base64: current.bytes.toString("base64"), filename: current.filename, mime_type: current.mime_type });
    assert.equal(receipt.kind, current.kind);
    assert.equal(receipt.mime_type, current.mime_type);
    assert.equal(receipt.width, null);
    assert.equal(receipt.height, null);
    assert.equal(receipt.duration, null);
    assert.equal(receipt.metadata_confidence, "NOT_EXTRACTED");
    assert.equal(receipt.validation_confidence, current.validation);
    const issued = await issuer.issue({ principal, attempt_id: ATTEMPT, variant: "banana-2.1", reference_handles: [receipt.reference_handle] });
    assert.equal(issued.counts_by_kind[current.kind], 1);
    assert.equal(issued.total_reference_count, 1);
    assert.equal("file_url" in issued, false);
  }
  assert.equal(index, inputs.length);
  await client.close();
});

test("refuses a caller-supplied upload method and invalid bytes before any native POST", async () => {
  let statuses = 0;
  let posts = 0;
  const linkService = { async getStatus(_binding: typeof BINDING, attemptId: string) {
    statuses += 1;
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true as const };
  } };
  const fakeMethodService = new OwnerStandardImageUploadService({ binding: BINDING, linkService,
    catalog: loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog,
    catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient: () => ({ async uploadStandardImageReference() { posts += 1; return { url: "https://r2.syntx.ai/fake" }; } }), now: () => NOW });
  await assert.rejects(() => fakeMethodService.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "reference.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof OwnerStandardImageUploadServiceError && error.code === "MODEL_BINDING_MISMATCH");
  assert.equal(statuses, 1);
  assert.equal(posts, 0);
  await fakeMethodService.close();

  statuses = 0;
  const client = service(async () => { posts += 1; throw new Error("synthetic transport interruption"); }, linkService);
  await assert.rejects(() => client.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: "AQ==",
    filename: "reference.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof OwnerStandardImageUploadServiceError && error.code === "INVALID_IMAGE_INPUT");
  assert.equal(statuses, 0);
  assert.equal(posts, 0);
  await client.close();
});

test("preserves an ambiguous native upload outcome without automatic retry", async () => {
  let posts = 0;
  const client = service(async () => { posts += 1; throw new Error("synthetic transport interruption"); });
  await assert.rejects(() => client.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "reference.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof OwnerStandardImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(posts, 1);
  await client.close();
});

test("does not mint a reference when the owner link changes during the native upload", async () => {
  let statusCalls = 0;
  let posts = 0;
  let linked = true;
  const changingLink = {
    async getStatus(_binding: typeof BINDING, attemptId: string) {
      statusCalls += 1;
      return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
        status: linked ? "LINKED" as const : "REVOKED" as const,
        expires_at: null, linked };
    }
  };
  const client = service(async (_input, init) => {
    posts += 1;
    if (posts === 2) linked = false;
    const form = init?.body as FormData;
    const file = form.get("files");
    assert.ok(file instanceof File);
    return new Response(JSON.stringify({ files: [{ url: `https://r2.syntx.ai/standard/drift-${posts}.png`, mime_type: "image/png", size: PNG.byteLength }] }), {
      status: 200, headers: { "content-type": "application/json" }
    });
  }, changingLink);

  const first = await client.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "reference.png", mime_type: "image/png" });
  await assert.rejects(() => client.upload({ attemptId: ATTEMPT, variant: "banana", content_base64: PNG.toString("base64"),
    filename: "reference.png", mime_type: "image/png" }),
  (error: unknown) => error instanceof OwnerStandardImageUploadServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(statusCalls, 4);
  assert.equal(posts, 2);
  await assert.rejects(() => client.createOwnedReferenceBindingIssuer().issue({
    principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
    attempt_id: ATTEMPT, variant: "banana", reference_handles: [first.reference_handle]
  }), (error: unknown) => error instanceof OwnerStandardImageUploadServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  assert.equal(statusCalls, 5);
  await client.close();
});
