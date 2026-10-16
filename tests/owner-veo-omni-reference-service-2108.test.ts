import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import {
  OwnerVeoOmniReferenceService,
  OwnerVeoOmniReferenceServiceError,
  isOwnerVeoOmniReferenceService
} from "../src/application/owner-veo-omni-reference-service.js";

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const ATTEMPT_A = "link_veo_omni_owner_0123456789abcdef";
const ATTEMPT_B = "link_veo_omni_owner_fedcba9876543210";
const BINDING = Object.freeze({ tenant_id: "omni-reference-test-tenant", subject: "omni-reference-test-owner" });
const URLS = ["https://r2.syntx.ai/veo-omni/one.png", "https://r2.syntx.ai/veo-omni/two.png"] as const;
const NOW = 1_000;

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    return operation("synthetic-veo-omni-reference-credential");
  } };
}

async function linkedOwners(attemptIds: readonly string[]): Promise<PerUserLinkService> {
  let next = 0;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: `omni-reference-${next}`, approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: "synthetic-linked-owner-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => NOW), {
    now: () => NOW, attemptIdGenerator: () => attemptIds[next++]!
  });
  for (const attemptId of attemptIds) {
    await links.createAttempt(BINDING);
    await links.issueHandoff(BINDING, attemptId);
    await links.checkAttempt(BINDING, attemptId);
  }
  return links;
}

function successfulClient(onFetch?: (init: RequestInit) => Promise<Response> | Response): SyntxChatHttpClient {
  let request = 0;
  return new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (input, init) => {
    assert.equal(String(input), "https://api.syntx.ai/api/v1/chats/upload-files");
    assert.equal(init?.method, "POST");
    request += 1;
    const form = init?.body as FormData;
    assert.deepEqual([...form.keys()], ["files", "destination", "check_duplicates", "model_type"]);
    assert.equal(form.get("destination"), "uploaded");
    assert.equal(form.get("check_duplicates"), "true");
    assert.equal(form.get("model_type"), "veo_omni");
    const file = form.get("files");
    assert.ok(file instanceof File);
    assert.equal(file.type, "image/png");
    if (onFetch) return await onFetch(init ?? {});
    return jsonResponse({ files: [{ id: `omni-reference-${request}`, url: URLS[(request - 1) % URLS.length],
      status: "uploaded", mime_type: "image/png", size: PNG_1X1.byteLength }] });
  } });
}

function makeService(links: PerUserLinkService, resolveClient: (attemptId: string) => unknown,
  now: () => number = () => NOW): OwnerVeoOmniReferenceService {
  return new OwnerVeoOmniReferenceService({ binding: BINDING, linkService: links, resolveClient,
    ffprobePath: process.execPath, now });
}

function uploadInput(attemptId = ATTEMPT_A, bytes: Uint8Array = PNG_1X1) {
  return { attemptId, filename: "source.png", mime_type: "image/png", bytes };
}

test("uploads URL-free references and resolves/captures them in caller order", async () => {
  const links = await linkedOwners([ATTEMPT_A]);
  const client = successfulClient();
  const service = makeService(links, () => client);
  try {
    assert.equal(isOwnerVeoOmniReferenceService(service), true);
    const one = await service.uploadReference(uploadInput());
    const two = await service.uploadReference({ ...uploadInput(), filename: "second.png" });
    assert.deepEqual(one, { status: "uploaded", reference_handle: one.reference_handle, model_id: "veo_omni",
      kind: "image", mime_type: "image/png", size: PNG_1X1.byteLength, sha256: one.sha256, width: 1, height: 1,
      duration_seconds: null, expires_in_seconds: 900, input_confidence: "LOCAL_METADATA_ONLY_NO_DECODE" });
    assert.match(one.reference_handle, /^veo_omni_reference_[0-9a-f-]{36}$/u);
    assert.equal(Object.isFrozen(one), true);
    assert.equal(JSON.stringify(one).includes("r2.syntx.ai"), false);

    const request = { attemptId: ATTEMPT_A, reference_handles: [two.reference_handle, one.reference_handle] };
    const refs = await service.resolveReferences(request);
    assert.deepEqual(refs.references.map(({ reference_handle, kind }) => [reference_handle, kind]),
      [[two.reference_handle, "image"], [one.reference_handle, "image"]]);
    assert.deepEqual(Object.keys(refs).sort(), ["attempt_id", "epoch", "expires_at", "generation_permit", "principal", "profile_sha256", "references"]);
    assert.equal(refs.generation_permit, false);
    assert.equal(Object.isFrozen(refs), true);
    assert.equal(Object.isFrozen(refs.references), true);
    assert.equal(refs.references.every(Object.isFrozen), true);
    assert.equal(JSON.stringify(refs).includes("r2.syntx.ai"), false);
    assert.equal(service.isOwnedReferences(refs), true);
    assert.equal(service.isOwnedReferences(Object.freeze({ ...refs })), false);
    assert.deepEqual(service.withCapturedReferences(refs, (capturedClient, captured) => ({
      sameClient: capturedClient === client,
      references: captured.map(({ reference_handle, kind, url }) => [reference_handle, kind, url])
    })), { sameClient: true, references: [[two.reference_handle, "image", URLS[1]], [one.reference_handle, "image", URLS[0]]] });
  } finally { await service.close(); }
});

test("rejects forged, cross-service, cross-attempt and duplicate handle snapshots", async () => {
  const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B]);
  const client = successfulClient();
  const first = makeService(links, () => client);
  const second = makeService(links, () => client);
  try {
    const uploaded = await first.uploadReference(uploadInput());
    const good = await first.resolveReferences({ attemptId: ATTEMPT_A, reference_handles: [uploaded.reference_handle] });
    assert.equal(first.isOwnedReferences(good), true);
    assert.equal(second.isOwnedReferences(good), false);
    assert.throws(() => first.withCapturedReferences(Object.freeze({ ...good }), () => "forged"),
      (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(first.resolveReferences({ attemptId: ATTEMPT_B, reference_handles: [uploaded.reference_handle] }),
      (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    await assert.rejects(first.resolveReferences({ attemptId: ATTEMPT_A,
      reference_handles: [uploaded.reference_handle, uploaded.reference_handle] }),
      (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError && error.code === "INVALID_REQUEST");
  } finally { await first.close(); await second.close(); }
});

test("snapshots caller bytes before awaiting and rejects client replacement, link revocation, or expiry", async () => {
  const links = await linkedOwners([ATTEMPT_A]);
  const original = Buffer.from(PNG_1X1);
  let fetchStarted!: () => void;
  const started = new Promise<void>((resolve) => { fetchStarted = resolve; });
  let fetchedBytes: Buffer | undefined;
  const client = successfulClient(async (init) => {
    const file = (init.body as FormData).get("files");
    assert.ok(file instanceof File);
    fetchedBytes = Buffer.from(await file.arrayBuffer());
    fetchStarted();
    return jsonResponse({ files: [{ url: URLS[0], id: "omni-mutation", status: "uploaded", mime_type: "image/png", size: original.length }] });
  });
  let now = NOW;
  let currentClient: SyntxChatHttpClient = client;
  const service = makeService(links, () => currentClient, () => now);
  try {
    const callerBytes = Buffer.from(original);
    const pending = service.uploadReference(uploadInput(ATTEMPT_A, callerBytes));
    callerBytes.fill(0);
    const upload = await pending;
    await started;
    assert.deepEqual(fetchedBytes, original);
    const replaced = new SyntxChatHttpClient({ credentialBroker: broker() });
    currentClient = replaced;
    const request = { attemptId: ATTEMPT_A, reference_handles: [upload.reference_handle] };
    await assert.rejects(service.resolveReferences(request),
      (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError && error.code === "REFERENCE_UNAVAILABLE");
    currentClient = client;
    const refs = await service.resolveReferences(request);
    assert.equal(service.isOwnedReferences(refs), true);
    now += 15 * 60_000;
    assert.equal(service.isOwnedReferences(refs), false);
    now += 1;
    await links.revoke(BINDING, ATTEMPT_A);
    await assert.rejects(service.resolveReferences(request),
      (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError && error.code === "PRINCIPAL_NOT_LINKED");
  } finally { await service.close(); }
});

test("invalidation and close drain pending native uploads and tombstone unknown outcomes without retry", async () => {
  for (const shutdown of ["invalidate", "close"] as const) {
    const links = await linkedOwners([ATTEMPT_A, ATTEMPT_B]);
    let startFetch!: () => void;
    const fetchStarted = new Promise<void>((resolve) => { startFetch = resolve; });
    let posts = 0;
    const client = successfulClient(async (init) => {
      posts += 1;
      startFetch();
      return await new Promise<Response>((_resolve, reject) => init.signal?.addEventListener("abort", () => reject(new Error("synthetic abort")), { once: true }));
    });
    const service = makeService(links, () => client);
    const pending = service.uploadReference(uploadInput());
    try {
      await fetchStarted;
      if (shutdown === "invalidate") await service.invalidateAttempt(ATTEMPT_A);
      else await service.close();
      await assert.rejects(pending, (error: unknown) => error instanceof OwnerVeoOmniReferenceServiceError &&
        error.code === "UPLOAD_OUTCOME_UNKNOWN");
      if (shutdown === "invalidate") {
        await assert.rejects(service.uploadReference(uploadInput(ATTEMPT_B)), (error: unknown) =>
          error instanceof OwnerVeoOmniReferenceServiceError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
      } else {
        await assert.rejects(service.uploadReference(uploadInput(ATTEMPT_B)), (error: unknown) =>
          error instanceof OwnerVeoOmniReferenceServiceError && error.code === "SERVICE_CLOSED");
      }
      assert.equal(posts, 1);
    } finally { await service.close(); }
  }
});
