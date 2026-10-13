import assert from "node:assert/strict";
import test from "node:test";
import type { AuthBinding, PublicAuthLinkAttempt } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import {
  OwnerMediaReferenceStore,
  type OwnerMediaReferenceContractBinding
} from "../src/application/owner-media-reference-store.js";

const BINDING: AuthBinding = { tenant_id: "tenant_local_owner", subject: "subject_local_owner" };
const ATTEMPT = "link_abcdefghijklmnopqrstuvwxyz123456";
const CONTRACT: OwnerMediaReferenceContractBinding = Object.freeze({
  schema_hash: `sha256:${"a".repeat(64)}`,
  catalog_version: `sha256-${"b".repeat(64)}.json`,
  model_id: "wan-i2v-reviewed",
  model_type: "wan_26_i2v",
  operation_id: "generate-video",
  modality: "video",
  variant_id: "wan-i2v-one-image"
});
const GROK_IMAGE_CONTRACT: OwnerMediaReferenceContractBinding = Object.freeze({
  ...CONTRACT, schema_hash: `sha256:${"c".repeat(64)}`, model_id: "grok_i2i", model_type: "grok_i2i",
  operation_id: "generate-image", modality: "image", variant_id: "grok-i2i-reviewed"
});
const GROK_IMAGE_PRO_CONTRACT: OwnerMediaReferenceContractBinding = Object.freeze({
  ...GROK_IMAGE_CONTRACT, model_id: "grok_i2i_pro", model_type: "grok_i2i_pro", variant_id: "grok-i2i-pro-reviewed"
});

function linkedService(status: "LINKED" | "POLLING" | "REVOKED" = "LINKED", attemptId = ATTEMPT) {
  const calls: Array<{ binding: AuthBinding; attemptId: string }> = [];
  return {
    calls,
    service: {
      async getStatus(binding: AuthBinding, requestedAttemptId: string): Promise<PublicAuthLinkAttempt> {
        calls.push({ binding, attemptId: requestedAttemptId });
        return {
          attempt_id: attemptId,
          authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
          status,
          expires_at: null,
          linked: status === "LINKED"
        };
      }
    }
  };
}

test("principal resolver snapshots private binding and requires the exact linked attempt", async () => {
  let received: { binding: AuthBinding; attemptId: string } | undefined;
  let finishStatus!: (value: PublicAuthLinkAttempt) => void;
  const pending = new Promise<PublicAuthLinkAttempt>((resolve) => { finishStatus = resolve; });
  const linkService = {
    async getStatus(binding: AuthBinding, attemptId: string): Promise<PublicAuthLinkAttempt> {
      received = { binding, attemptId };
      return pending;
    }
  };
  const original = { ...BINDING };
  const resolving = resolveOwnerReferencePrincipal({ binding: original, attemptId: ATTEMPT, linkService });
  original.tenant_id = "tenant_attacker_mutation";
  finishStatus({
    attempt_id: ATTEMPT,
    authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "LINKED",
    expires_at: null,
    linked: true
  });

  assert.deepEqual(await resolving, {
    tenant_id: BINDING.tenant_id,
    subject_id: BINDING.subject,
    connection_id: ATTEMPT
  });
  assert.deepEqual(received, { binding: BINDING, attemptId: ATTEMPT });
});

test("principal resolver denies pending, revoked, or mismatched attempts with a safe error", async () => {
  for (const service of [
    linkedService("POLLING"),
    linkedService("REVOKED"),
    linkedService("LINKED", "link_some_other_attempt_000000000")
  ]) {
    await assert.rejects(
      resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: service.service }),
      (error: unknown) => error instanceof Error && error.message.includes("linked owner principal") &&
        !error.message.includes(ATTEMPT) && "code" in error && error.code === "REFERENCE_PRINCIPAL_NOT_LINKED"
    );
  }
});

test("principal resolver rejects accessors, proxies, prototype input, and status getters without invoking them", async () => {
  let statusCalls = 0;
  const service = {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      statusCalls += 1;
      return {
        attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "LINKED", expires_at: null, linked: true
      };
    }
  };
  const getterInput = Object.defineProperty({ binding: BINDING, attemptId: ATTEMPT, linkService: service }, "attemptId", {
    get() { throw new Error("attempt getter must not run"); }
  });
  const inheritedInput = Object.assign(Object.create({ extra: true }) as object, {
    binding: BINDING, attemptId: ATTEMPT, linkService: service
  });
  const getterService = Object.defineProperty({}, "getStatus", { get() { throw new Error("method getter must not run"); } });
  for (const input of [
    getterInput,
    new Proxy({ binding: BINDING, attemptId: ATTEMPT, linkService: service }, {}),
    inheritedInput,
    { binding: BINDING, attemptId: ATTEMPT, linkService: getterService }
  ]) {
    await assert.rejects(resolveOwnerReferencePrincipal(input as never), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "REFERENCE_PRINCIPAL_INVALID");
  }
  assert.equal(statusCalls, 0);
});

test("one attributed URL-only image receipt mints an opaque handle without requiring an upstream file id", async () => {
  let now = 1_800_000_000_000;
  let uploadRequest: unknown;
  let finishStatus!: (value: PublicAuthLinkAttempt) => void;
  const pendingStatus = new Promise<PublicAuthLinkAttempt>((resolve) => { finishStatus = resolve; });
  let statusCalls = 0;
  const linkService = {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      statusCalls += 1;
      return pendingStatus;
    }
  };
  const store = new OwnerMediaReferenceStore({ now: () => now, createHandle: () => "reference_123e4567-e89b-12d3-a456-426614174000" });
  const sourceBytes = Uint8Array.from([1, 2, 3, 4]);
  const mutableContract = { ...CONTRACT };
  const issuing = store.uploadAndIssue({
    binding: BINDING,
    attemptId: ATTEMPT,
    linkService,
    client: {
      async uploadFileReferences(request) {
        uploadRequest = request;
        return [{ url: "https://r2.syntx.ai/uploaded/opaque.png" }];
      }
    },
    contract: mutableContract,
    filename: "reference.png",
    mime_type: "image/png",
    bytes: sourceBytes
  });
  sourceBytes.fill(9);
  mutableContract.model_type = "tampered_model_type";
  finishStatus({
    attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "LINKED", expires_at: null, linked: true
  });
  const receipt = await issuing;

  assert.deepEqual(receipt, {
    status: "accepted",
    reference_handle: "reference_123e4567-e89b-12d3-a456-426614174000",
    mime_type: "image/png",
    mime_type_source: "request_declared",
    size: 4,
    size_source: "request_bytes"
  });
  assert.deepEqual(uploadRequest, {
    bytes: Uint8Array.from([1, 2, 3, 4]),
    filename: "reference.png",
    mime_type: "image/png",
    destination: "hidden",
    check_duplicates: true,
    model_type: CONTRACT.model_type
  });
  assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
  assert.equal(statusCalls, 2);
  now += 60_000;
  store.close();
});

test("resolver returns only an exact contract-bound internal projection and denies another principal", async () => {
  const handle = "reference_223e4567-e89b-12d3-a456-426614174000";
  const store = new OwnerMediaReferenceStore({ createHandle: () => handle });
  const identity = linkedService();
  const receipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ file_id: "opaque_upstream_7", url: "https://r2.syntx.ai/private/r.png" }]; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([7, 8])
  });
  assert.equal(JSON.stringify(receipt).includes("r2.syntx.ai"), false);
  assert.equal(JSON.stringify(receipt).includes("opaque_upstream_7"), false);
  assert.equal(JSON.stringify(receipt).includes(BINDING.tenant_id), false);
  assert.equal(JSON.stringify(receipt).includes(BINDING.subject), false);
  const resolved = await store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: [receipt.reference_handle]
  });
  assert.deepEqual(resolved, { file_urls: ["https://r2.syntx.ai/private/r.png"] });
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.file_urls), true);

  await assert.rejects(store.resolveImageReferences({
    binding: { tenant_id: "tenant_other_owner", subject: "subject_other_owner" },
    attemptId: ATTEMPT,
    linkService: linkedService().service,
    contract: CONTRACT,
    reference_handles: [receipt.reference_handle]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_SCOPE_MISMATCH" &&
    !error.message.includes("r2.syntx.ai") && !error.message.includes("opaque_upstream_7"));

  for (const changedContract of [
    { ...CONTRACT, schema_hash: `sha256:${"c".repeat(64)}` },
    { ...CONTRACT, catalog_version: `sha256-${"d".repeat(64)}.json` },
    { ...CONTRACT, model_id: "other-model" },
    { ...CONTRACT, model_type: "other-wire-model" },
    { ...CONTRACT, operation_id: "generate-image" as const, modality: "image" as const },
    { ...CONTRACT, variant_id: "other-variant" }
  ]) {
    await assert.rejects(store.resolveImageReferences({
      binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
      contract: changedContract,
      reference_handles: [receipt.reference_handle]
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_SCOPE_MISMATCH");
  }
  await assert.rejects(store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: ["https://r2.syntx.ai/private/r.png"]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  store.close();
});

test("ordered Grok resolver preserves three-handle order and pro accepts exactly one", async () => {
  const handles = [
    "reference_823e4567-e89b-12d3-a456-426614174000",
    "reference_923e4567-e89b-12d3-a456-426614174000",
    "reference_a23e4567-e89b-12d3-a456-426614174000"
  ];
  const urls = ["https://r2.syntx.ai/grok/first.png", "https://r2.syntx.ai/grok/second.png", "https://r2.syntx.ai/grok/third.png"];
  let handleIndex = 0;
  let uploadIndex = 0;
  const store = new OwnerMediaReferenceStore({ createHandle: () => handles[handleIndex++]! });
  const identity = linkedService();
  for (let index = 0; index < 3; index += 1) {
    await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
      client: { async uploadFileReferences() { return [{ url: urls[uploadIndex++]! }]; } },
      contract: GROK_IMAGE_CONTRACT, filename: `grok-${index}.png`, mime_type: "image/png", bytes: Uint8Array.from([index + 1]) });
  }
  const resolved = await store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT, reference_handles: handles });
  assert.deepEqual(resolved.file_urls, urls);
  assert.equal(Object.isFrozen(resolved), true);
  assert.equal(Object.isFrozen(resolved.file_urls), true);

  const proHandle = "reference_b23e4567-e89b-12d3-a456-426614174000";
  const proStore = new OwnerMediaReferenceStore({ createHandle: () => proHandle });
  const proReceipt = await proStore.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/grok/pro.png" }]; } },
    contract: GROK_IMAGE_PRO_CONTRACT, filename: "grok-pro.png", mime_type: "image/png", bytes: Uint8Array.from([9]) });
  const proResolved = await proStore.resolveOrderedImageReferences({ server_contract: "grok_i2i_pro", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_PRO_CONTRACT,
    reference_handles: [proReceipt.reference_handle] });
  assert.deepEqual(proResolved.file_urls, ["https://r2.syntx.ai/grok/pro.png"]);
  store.close();
  proStore.close();
});

test("ordered methods reject invalid cardinality, duplicates, and mismatched server contract before auth", async () => {
  let authCalls = 0;
  const linkService = { async getStatus(): Promise<PublicAuthLinkAttempt> {
    authCalls += 1;
    return { attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const store = new OwnerMediaReferenceStore();
  const one = "reference_c23e4567-e89b-12d3-a456-426614174000";
  const many = [one, "reference_d23e4567-e89b-12d3-a456-426614174000", "reference_e23e4567-e89b-12d3-a456-426614174000"];
  const invalidRequests = [
    { server_contract: "grok_i2i", handles: [], error: "REFERENCE_COUNT_INVALID" },
    { server_contract: "grok_i2i", handles: [one, one], error: "REFERENCE_COUNT_INVALID" },
    { server_contract: "grok_i2i", handles: [...many, "reference_f23e4567-e89b-12d3-a456-426614174000"], error: "REFERENCE_COUNT_INVALID" },
    { server_contract: "grok_i2i_pro", contract: GROK_IMAGE_PRO_CONTRACT, handles: [one, many[1]!], error: "REFERENCE_COUNT_INVALID" },
    { server_contract: "grok_i2i", contract: GROK_IMAGE_PRO_CONTRACT, handles: [one], error: "INVALID_REQUEST" },
    { server_contract: "grok_i2i", contract: { ...GROK_IMAGE_CONTRACT, model_type: "wrong" }, handles: [one], error: "INVALID_REQUEST" },
    { server_contract: "arbitrary-capability", contract: GROK_IMAGE_CONTRACT, handles: [one], error: "INVALID_REQUEST" }
  ];
  for (const invalid of invalidRequests) {
    await assert.rejects(store.resolveOrderedImageReferences({ server_contract: invalid.server_contract as never,
      binding: BINDING, attemptId: ATTEMPT, linkService, contract: invalid.contract ?? GROK_IMAGE_CONTRACT,
      reference_handles: invalid.handles }), (error: unknown) => error instanceof Error && "code" in error && error.code === invalid.error);
  }
  assert.equal(authCalls, 0);
  store.close();
});

test("ordered input snapshots reject accessors, proxies, symbols, and custom prototypes before auth", async () => {
  let authCalls = 0;
  const linkService = { async getStatus(): Promise<PublicAuthLinkAttempt> {
    authCalls += 1;
    return { attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const store = new OwnerMediaReferenceStore();
  const handle = "reference_f23e4567-e89b-12d3-a456-426614174000";
  const input = { server_contract: "grok_i2i", binding: BINDING, attemptId: ATTEMPT, linkService,
    contract: GROK_IMAGE_CONTRACT, reference_handles: [handle] };
  const getterInput = Object.defineProperty({ ...input }, "server_contract", { get() { throw new Error("must not execute"); } });
  const getterHandleList: unknown[] = [];
  Object.defineProperty(getterHandleList, "0", { get() { throw new Error("handle getter must not run"); }, configurable: true });
  Object.defineProperty(getterHandleList, "length", { value: 1 });
  const symbolHandleList = [handle] as unknown[];
  Object.defineProperty(symbolHandleList, Symbol("extra"), { value: "extra" });
  const inheritedHandleList = Object.setPrototypeOf([handle], { inherited: true });
  const invalidInputs = [
    getterInput,
    new Proxy(input, {}),
    Object.assign(Object.create({ inherited: true }) as object, input),
    { ...input, [Symbol("extra")]: true },
    { ...input, reference_handles: new Proxy([handle], {}) },
    { ...input, reference_handles: getterHandleList },
    { ...input, reference_handles: symbolHandleList },
    { ...input, reference_handles: inheritedHandleList }
  ];
  for (const badInput of invalidInputs) await assert.rejects(store.resolveOrderedImageReferences(badInput as never),
    (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  const getterUrls: unknown[] = [];
  Object.defineProperty(getterUrls, "0", { get() { throw new Error("URL getter must not run"); }, configurable: true });
  Object.defineProperty(getterUrls, "length", { value: 1 });
  await assert.rejects(store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService, contract: GROK_IMAGE_CONTRACT, reference_handles: [handle], expected_file_urls: getterUrls } as never),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  assert.equal(authCalls, 0);
  store.close();
});

test("ordered handles are principal- and full-contract-bound", async () => {
  const handle = "reference_133e4567-e89b-12d3-a456-426614174000";
  const store = new OwnerMediaReferenceStore({ createHandle: () => handle });
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: linkedService().service,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/grok/foreign.png" }]; } },
    contract: GROK_IMAGE_CONTRACT, filename: "foreign.png", mime_type: "image/png", bytes: Uint8Array.from([1]) });
  await assert.rejects(store.resolveOrderedImageReferences({ server_contract: "grok_i2i",
    binding: { tenant_id: "tenant_other_owner", subject: "subject_other_owner" }, attemptId: ATTEMPT,
    linkService: linkedService().service, contract: GROK_IMAGE_CONTRACT, reference_handles: [handle] }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_SCOPE_MISMATCH");
  for (const changedContract of [
    { ...GROK_IMAGE_CONTRACT, schema_hash: `sha256:${"d".repeat(64)}` },
    { ...GROK_IMAGE_CONTRACT, catalog_version: `sha256-${"e".repeat(64)}.json` },
    { ...GROK_IMAGE_CONTRACT, variant_id: "other-grok-variant" }
  ]) await assert.rejects(store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: linkedService().service, contract: changedContract, reference_handles: [handle] }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_SCOPE_MISMATCH");
  store.close();
});

test("ordered consume expires only the expired reference and does not partially consume live siblings", async () => {
  let now = 1_800_000_000_000;
  const handles = ["reference_233e4567-e89b-12d3-a456-426614174000", "reference_333e4567-e89b-12d3-a456-426614174000"];
  const urls = ["https://r2.syntx.ai/grok/expired.png", "https://r2.syntx.ai/grok/live.png"];
  let handleIndex = 0;
  const store = new OwnerMediaReferenceStore({ now: () => now, createHandle: () => handles[handleIndex++]! });
  const identity = linkedService();
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: urls[0]! }]; } }, contract: GROK_IMAGE_CONTRACT,
    filename: "expired.png", mime_type: "image/png", bytes: Uint8Array.from([1]) });
  now += 1;
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: urls[1]! }]; } }, contract: GROK_IMAGE_CONTRACT,
    filename: "live.png", mime_type: "image/png", bytes: Uint8Array.from([2]) });
  now += 15 * 60_000 - 1;
  await assert.rejects(store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles, expected_file_urls: urls }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED");
  assert.deepEqual((await store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: [handles[1]!] })).file_urls, [urls[1]]);
  store.close();
});

test("ordered validation leaves every handle untouched when a mixed set contains an expired reference", async () => {
  let now = 1_800_000_000_000;
  const handles = ["reference_533e4567-e89b-12d3-a456-426614174000", "reference_633e4567-e89b-12d3-a456-426614174000"];
  const urls = ["https://r2.syntx.ai/grok/atomic-expired.png", "https://r2.syntx.ai/grok/atomic-live.png"];
  let handleIndex = 0;
  const identity = linkedService();
  const store = new OwnerMediaReferenceStore({ now: () => now, createHandle: () => handles[handleIndex++]! });
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: urls[0]! }]; } }, contract: GROK_IMAGE_CONTRACT,
    filename: "atomic-expired.png", mime_type: "image/png", bytes: Uint8Array.from([1]) });
  now += 1;
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: urls[1]! }]; } }, contract: GROK_IMAGE_CONTRACT,
    filename: "atomic-live.png", mime_type: "image/png", bytes: Uint8Array.from([2]) });

  now += 15 * 60_000 - 1;
  await assert.rejects(store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles, expected_file_urls: urls }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_EXPIRED");

  now -= 1;
  assert.deepEqual((await store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles })).file_urls, urls);
  store.close();
});

test("ordered consume validates the complete set before deleting any handle", async () => {
  const handles = ["reference_123e4567-e89b-12d3-a456-426614174000", "reference_223e4567-e89b-12d3-a456-426614174000"];
  const urls = ["https://r2.syntx.ai/grok/one.png", "https://r2.syntx.ai/grok/two.png"];
  let index = 0;
  const identity = linkedService();
  const store = new OwnerMediaReferenceStore({ createHandle: () => handles[index++]! });
  for (let item = 0; item < handles.length; item += 1) {
    await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
      client: { async uploadFileReferences() { return [{ url: urls[item]! }]; } }, contract: GROK_IMAGE_CONTRACT,
      filename: `partial-${item}.png`, mime_type: "image/png", bytes: Uint8Array.from([item + 1]) });
  }
  await assert.rejects(store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: [handles[0]!, "reference_323e4567-e89b-12d3-a456-426614174000"], expected_file_urls: [urls[0]!, "https://r2.syntx.ai/grok/missing.png"] }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_NOT_FOUND");
  assert.deepEqual((await store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles })).file_urls, urls);
  await store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles, expected_file_urls: urls });
  await assert.rejects(store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: identity.service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_NOT_FOUND");
  store.close();
});

test("ordered resolve and consume recheck revocation and exact contract after awaits", async () => {
  const handles = ["reference_423e4567-e89b-12d3-a456-426614174000", "reference_523e4567-e89b-12d3-a456-426614174000"];
  const urls = ["https://r2.syntx.ai/grok/revoke-one.png", "https://r2.syntx.ai/grok/revoke-two.png"];
  let statusCalls = 0;
  const linkService = { async getStatus(): Promise<PublicAuthLinkAttempt> {
    statusCalls += 1;
    return { attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
      status: statusCalls === 2 ? "REVOKED" : "LINKED", expires_at: null, linked: statusCalls !== 2 };
  } };
  let handleIndex = 0;
  let urlIndex = 0;
  const store = new OwnerMediaReferenceStore({ createHandle: () => handles[handleIndex++]! });
  for (let item = 0; item < handles.length; item += 1) await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT,
    linkService: linkedService().service, client: { async uploadFileReferences() { return [{ url: urls[urlIndex++]! }]; } },
    contract: GROK_IMAGE_CONTRACT, filename: `revoke-${item}.png`, mime_type: "image/png", bytes: Uint8Array.from([item + 1]) });
  await assert.rejects(store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService, contract: GROK_IMAGE_CONTRACT, reference_handles: handles, expected_file_urls: urls }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_PRINCIPAL_NOT_LINKED");
  assert.equal(statusCalls, 2);
  await store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService: linkedService().service, contract: GROK_IMAGE_CONTRACT,
    reference_handles: handles, expected_file_urls: urls });
  store.close();
});

test("principal invalidation while the second ordered authorization check awaits prevents resolution", async () => {
  const handle = "reference_433e4567-e89b-12d3-a456-426614174000";
  const store = new OwnerMediaReferenceStore({ createHandle: () => handle });
  await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT, linkService: linkedService().service,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/grok/revoked.png" }]; } },
    contract: GROK_IMAGE_CONTRACT, filename: "revoked.png", mime_type: "image/png", bytes: Uint8Array.from([1]) });
  let finishRecheck!: (value: PublicAuthLinkAttempt) => void;
  let recheckStarted!: () => void;
  const started = new Promise<void>((resolve) => { recheckStarted = resolve; });
  const waitingRecheck = new Promise<PublicAuthLinkAttempt>((resolve) => { finishRecheck = resolve; });
  let calls = 0;
  const linkService = { async getStatus(): Promise<PublicAuthLinkAttempt> {
    calls += 1;
    if (calls === 2) { recheckStarted(); return waitingRecheck; }
    return { attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  const resolving = store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService, contract: GROK_IMAGE_CONTRACT, reference_handles: [handle] });
  await started;
  store.invalidateByPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  finishRecheck({ attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true });
  await assert.rejects(resolving, (error: unknown) => error instanceof Error && "code" in error &&
    (error.code === "REFERENCE_NOT_FOUND" || error.code === "REFERENCE_PRINCIPAL_NOT_LINKED"));
  assert.equal(calls, 2);
  store.close();
});

test("concurrent ordered consume has one atomic winner", async () => {
  const handles = ["reference_623e4567-e89b-12d3-a456-426614174000", "reference_723e4567-e89b-12d3-a456-426614174000"];
  const urls = ["https://r2.syntx.ai/grok/race-one.png", "https://r2.syntx.ai/grok/race-two.png"];
  let statusCalls = 0;
  let secondPhaseCallers = 0;
  let releaseSecondPhase!: () => void;
  const secondPhaseGate = new Promise<void>((resolve) => { releaseSecondPhase = resolve; });
  const linkService = { async getStatus(): Promise<PublicAuthLinkAttempt> {
    statusCalls += 1;
    if (statusCalls > 2) {
      secondPhaseCallers += 1;
      if (secondPhaseCallers === 2) releaseSecondPhase();
      await secondPhaseGate;
    }
    return { attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  let handleIndex = 0;
  let urlIndex = 0;
  const store = new OwnerMediaReferenceStore({ createHandle: () => handles[handleIndex++]! });
  for (let item = 0; item < handles.length; item += 1) await store.uploadAndIssue({ binding: BINDING, attemptId: ATTEMPT,
    linkService: linkedService().service, client: { async uploadFileReferences() { return [{ url: urls[urlIndex++]! }]; } },
    contract: GROK_IMAGE_CONTRACT, filename: `race-${item}.png`, mime_type: "image/png", bytes: Uint8Array.from([item + 1]) });
  const consume = () => store.consumeOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService, contract: GROK_IMAGE_CONTRACT, reference_handles: handles, expected_file_urls: urls });
  const results = await Promise.allSettled([consume(), consume()]);
  assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  await assert.rejects(store.resolveOrderedImageReferences({ server_contract: "grok_i2i", binding: BINDING,
    attemptId: ATTEMPT, linkService, contract: GROK_IMAGE_CONTRACT, reference_handles: handles }),
  (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_NOT_FOUND");
  store.close();
});

test("unlinked principal is rejected before upload and no upload credential-capable port is called", async () => {
  let uploadCalls = 0;
  const store = new OwnerMediaReferenceStore();
  const pending = linkedService("POLLING");
  await assert.rejects(store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: pending.service,
    client: { async uploadFileReferences() { uploadCalls += 1; return [{ url: "https://r2.syntx.ai/no.png" }]; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_PRINCIPAL_NOT_LINKED");
  assert.equal(uploadCalls, 0);
  store.close();
});

test("invalidation while exact auth status is pending prevents the subsequent upload", async () => {
  let finishStatus!: (value: PublicAuthLinkAttempt) => void;
  const statusWait = new Promise<PublicAuthLinkAttempt>((resolve) => { finishStatus = resolve; });
  let uploadCalls = 0;
  const handle = "reference_523e4567-e89b-12d3-a456-426614174000";
  const store = new OwnerMediaReferenceStore({ createHandle: () => handle });
  const linkService = { async getStatus() { return statusWait; } };
  const issuing = store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() { uploadCalls += 1; return [{ url: "https://r2.syntx.ai/no.png" }]; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  store.invalidateByPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  finishStatus({
    attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
    status: "LINKED", expires_at: null, linked: true
  });
  await assert.rejects(issuing, (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_PRINCIPAL_NOT_LINKED");
  assert.equal(uploadCalls, 0);
  store.close();
});

test("invalidation during upload prevents minting; revoked final status leaves no handle", async () => {
  let finishUpload!: (value: { url: string }[]) => void;
  let notifyUploadStarted!: () => void;
  const uploadStarted = new Promise<void>((resolve) => { notifyUploadStarted = resolve; });
  const pendingUpload = new Promise<{ url: string }[]>((resolve) => { finishUpload = resolve; });
  let handleCalls = 0;
  let statusCalls = 0;
  const store = new OwnerMediaReferenceStore({ createHandle: () => {
    handleCalls += 1;
    return "reference_623e4567-e89b-12d3-a456-426614174000";
  } });
  const linkService = {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      statusCalls += 1;
      return {
        attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "LINKED", expires_at: null, linked: true
      };
    }
  };
  const issuing = store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService,
    client: { async uploadFileReferences() { notifyUploadStarted(); return pendingUpload; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  await uploadStarted;
  store.invalidateByPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  finishUpload([{ url: "https://r2.syntx.ai/maybe-uploaded.png" }]);
  await assert.rejects(issuing, (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(handleCalls, 0);
  assert.equal(statusCalls, 1);

  const revokedAfterUpload = new OwnerMediaReferenceStore({ createHandle: () => {
    handleCalls += 1;
    return "reference_723e4567-e89b-12d3-a456-426614174000";
  } });
  statusCalls = 0;
  await assert.rejects(revokedAfterUpload.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT,
    linkService: { async getStatus(): Promise<PublicAuthLinkAttempt> {
      statusCalls += 1;
      return {
        attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: statusCalls === 1 ? "LINKED" : "REVOKED",
        expires_at: null, linked: statusCalls === 1
      };
    } },
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/maybe-uploaded.png" }]; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(handleCalls, 0);
  assert.equal(statusCalls, 2);
  store.close();
  revokedAfterUpload.close();
});

test("zero, ambiguous, unsafe, and unknown upload receipts mint no opaque handle", async () => {
  const unsafe: unknown[] = [
    [],
    { status: "accepted", reference_handle: "reference_123e4567-e89b-12d3-a456-426614174000" },
    [
      { url: "https://r2.syntx.ai/one.png" },
      { url: "https://r2.syntx.ai/two.png" }
    ],
    [{ url: "https://r2.syntx.ai.evil.invalid/x.png" }],
    [{ url: "https://user:secret@r2.syntx.ai/x.png" }],
    [{ url: "https://r2.syntx.ai:9443/x.png" }],
    [{ url: "https://r2.syntx.ai/x.png#private" }],
    [{ file_id: "bad id", url: "https://r2.syntx.ai/x.png" }]
  ];
  let handleCalls = 0;
  let shouldThrow = false;
  const identity = linkedService();
  const store = new OwnerMediaReferenceStore({ createHandle: () => {
    handleCalls += 1;
    return `reference_323e4567-e89b-12d3-a456-42661417400${handleCalls}`;
  } });
  for (const response of unsafe) {
    await assert.rejects(store.uploadAndIssue({
      binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
      client: { async uploadFileReferences() { return response as never; } },
      contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
    }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_RECEIPT_INVALID");
  }
  shouldThrow = true;
  await assert.rejects(store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() {
      if (shouldThrow) throw new Error("private upstream URL or body must not escape");
      return [{ url: "https://r2.syntx.ai/x.png" }];
    } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN" &&
    !error.message.includes("private upstream") && !error.message.includes("r2.syntx.ai"));
  assert.equal(handleCalls, 0);
  store.close();
});

test("known local upload rejection is distinct from an unknown post-invocation outcome", async () => {
  let uploadCalls = 0;
  const store = new OwnerMediaReferenceStore();
  await assert.rejects(store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: linkedService().service,
    client: { async uploadFileReferences() {
      uploadCalls += 1;
      throw new SyntxHttpError("INVALID_REQUEST", "private detail must not escape");
    } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UPLOAD_REJECTED" &&
    !error.message.includes("private detail"));
  assert.equal(uploadCalls, 1);
  store.close();
});

test("handle is one-image, TTL-bounded, principal-invalidatable, and erased on close", async () => {
  let now = 1_800_000_000_000;
  const handle = "reference_423e4567-e89b-12d3-a456-426614174000";
  const identity = linkedService();
  const store = new OwnerMediaReferenceStore({ now: () => now, createHandle: () => handle });
  const receipt = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/x.png" }]; } },
    contract: CONTRACT, filename: "x.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  await assert.rejects(store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: [receipt.reference_handle, receipt.reference_handle]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_COUNT_INVALID");

  now += 15 * 60_000;
  await assert.rejects(store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: [receipt.reference_handle]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_NOT_FOUND");

  const second = await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    client: { async uploadFileReferences() { return [{ url: "https://r2.syntx.ai/y.png" }]; } },
    contract: CONTRACT, filename: "y.png", mime_type: "image/png", bytes: Uint8Array.from([2])
  });
  store.invalidateByPrincipal({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
  await assert.rejects(store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: [second.reference_handle]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_NOT_FOUND");
  store.close();
  await assert.rejects(store.resolveImageReferences({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service,
    contract: CONTRACT, reference_handles: [second.reference_handle]
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_STORE_CLOSED");
});

test("input accessors, proxies, prototype keys, invalid MIME, size, and filenames fail before auth/upload", async () => {
  let authCalls = 0;
  let uploadCalls = 0;
  const service = {
    async getStatus(): Promise<PublicAuthLinkAttempt> {
      authCalls += 1;
      return {
        attempt_id: ATTEMPT, authorization_profile: "OBSERVED_OWNER_AUTHORIZED",
        status: "LINKED", expires_at: null, linked: true
      };
    }
  };
  const client = { async uploadFileReferences() { uploadCalls += 1; return [{ url: "https://r2.syntx.ai/x.png" }]; } };
  const getterService = Object.defineProperty({}, "getStatus", { get() { throw new Error("auth port getter must not run"); } });
  const getterClient = Object.defineProperty({}, "uploadFileReferences", { get() { throw new Error("upload port getter must not run"); } });
  const store = new OwnerMediaReferenceStore();
  const valid = {
    binding: BINDING, attemptId: ATTEMPT, linkService: service, client, contract: CONTRACT,
    filename: "x.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  };
  const getterInput = Object.defineProperty({ ...valid }, "filename", { get() { throw new Error("must not execute"); } });
  const badInputs = [
    getterInput,
    new Proxy(valid, {}),
    Object.assign(Object.create({ inherited: true }) as object, valid),
    { ...valid, linkService: getterService },
    { ...valid, client: getterClient },
    { ...valid, mime_type: "video/mp4" },
    { ...valid, filename: "../x.png" },
    { ...valid, bytes: new Uint8Array(10 * 1024 * 1024 + 1) }
  ];
  for (const badInput of badInputs) {
    await assert.rejects(store.uploadAndIssue(badInput as never), (error: unknown) =>
      error instanceof Error && "code" in error && error.code === "INVALID_REQUEST");
  }
  assert.equal(authCalls, 0);
  assert.equal(uploadCalls, 0);
  store.close();
});

test("store caps active and pending reference handles at 128 before starting another upload", async () => {
  let now = 1_800_000_000_000;
  let uploadCalls = 0;
  let handleCounter = 0;
  const identity = linkedService();
  const store = new OwnerMediaReferenceStore({
    now: () => now,
    createHandle: () => `reference_${String(++handleCounter).padStart(8, "0")}-e89b-12d3-a456-426614174000`
  });
  const client = { async uploadFileReferences() {
    uploadCalls += 1;
    return [{ url: `https://r2.syntx.ai/${uploadCalls}.png` }];
  } };
  for (let index = 0; index < 128; index += 1) {
    await store.uploadAndIssue({
      binding: BINDING, attemptId: ATTEMPT, linkService: identity.service, client,
      contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
    });
  }
  await assert.rejects(store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service, client,
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  }), (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_STORE_FULL");
  assert.equal(uploadCalls, 128);
  now += 15 * 60_000;
  await store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: identity.service, client,
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  assert.equal(uploadCalls, 129);
  store.close();
});

test("closing during an in-flight fake upload prevents a late handle from being stored", async () => {
  let finishUpload!: (value: { url: string }[]) => void;
  let notifyUploadStarted!: () => void;
  const uploadStarted = new Promise<void>((resolve) => { notifyUploadStarted = resolve; });
  const pendingUpload = new Promise<{ url: string }[]>((resolve) => { finishUpload = resolve; });
  const store = new OwnerMediaReferenceStore();
  const issuing = store.uploadAndIssue({
    binding: BINDING, attemptId: ATTEMPT, linkService: linkedService().service,
    client: { async uploadFileReferences() { notifyUploadStarted(); return pendingUpload; } },
    contract: CONTRACT, filename: "r.png", mime_type: "image/png", bytes: Uint8Array.from([1])
  });
  await uploadStarted;
  store.close();
  finishUpload([{ url: "https://r2.syntx.ai/late.png" }]);
  await assert.rejects(issuing, (error: unknown) => error instanceof Error && "code" in error && error.code === "REFERENCE_UPLOAD_OUTCOME_UNKNOWN");
});
