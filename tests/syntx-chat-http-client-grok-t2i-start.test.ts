import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { syntxPublicCatalogSnapshotSchema } from "../src/catalog/syntx-public-catalog.js";
import { OwnerGrokT2iImageUploadService } from "../src/application/owner-grok-t2i-image-upload-service.js";
import { createOwnerGrokT2iRequestPreparer } from "../src/application/owner-grok-t2i-request-preparer.js";
import { createOwnerGrokT2iOneShotPermit } from "../src/application/owner-grok-t2i-one-shot-policy.js";

const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = new DiscoveryCatalogRepository(syntxPublicCatalogSnapshotSchema.parse(JSON.parse(readFileSync(
  join(process.cwd(), "catalog/public", CATALOG_VERSION), "utf8"
))));
const BINDING = Object.freeze({ tenant_id: "grok-start-tenant", subject: "grok-start-subject" });
const ATTEMPT = "link_grok_start_000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });

function makeClient(fetchImpl: typeof fetch) {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    credentialCalls += 1; return operation("synthetic-grok-start-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (...args) => {
    fetchCalls += 1; return fetchImpl(...args);
  } });
  return { client, fetchCalls: () => fetchCalls, credentialCalls: () => credentialCalls };
}

test("fresh Node process imports client before the Grok T2I preparer and policy without an ESM cycle", () => {
  const clientUrl = new URL("../src/adapter/syntx/chat-http-client.js", import.meta.url).href;
  const preparerUrl = new URL("../src/application/owner-grok-t2i-request-preparer.js", import.meta.url).href;
  const policyUrl = new URL("../src/application/owner-grok-t2i-one-shot-policy.js", import.meta.url).href;
  const script = `const client = await import(${JSON.stringify(clientUrl)}); await import(${JSON.stringify(preparerUrl)}); await import(${JSON.stringify(policyUrl)}); if (typeof client.SyntxChatHttpClient.prototype.startGrokT2iImageWithOwnedCandidate !== "function") process.exit(17);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 5_000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x00, 0x01, 0x00, 0x01, 0x01, 0x01, 0x11, 0x00,
  0xff, 0xda, 0x00, 0x08, 0x01, 0x01, 0x00, 0x00, 0x3f, 0x00, 0x00, 0xff, 0xd9]);

async function prepare(model_id: "grok_t2i" | "grok_t2i_pro" | "grok_imagine_2" | "grok_imagine_quality", referenceCount = 0,
  prompt = "A synthetic source-shaped prompt", now: () => number = Date.now, batchSize = 2) {
  const links = { async getStatus(_binding: unknown, attemptId: string) {
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED", status: "LINKED", expires_at: null, linked: true };
  } };
  let uploadCount = 0;
  const uploadClient = new SyntxChatHttpClient({ credentialBroker: { async useCredential(operation) {
    return operation("synthetic-grok-upload-credential");
  } }, fetchImpl: async (_input, init) => {
    uploadCount += 1;
    const form = init?.body as FormData;
    const file = form.get("files") as File;
    return Response.json({ files: [{ id: `grok-start-owned-${uploadCount}`, url: `https://r2.syntx.ai/private/grok/start-${uploadCount}.jpg`,
      mime_type: "image/jpeg", size: file.size }] });
  } });
  const imageUploadService = new OwnerGrokT2iImageUploadService({ binding: BINDING, linkService: links,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, resolveClient: () => uploadClient, now });
  const preparer = createOwnerGrokT2iRequestPreparer({ binding: BINDING, linkService: links, imageUploadService,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now });
  const parameters = { aspect_ratio: "1:1", resolution: "1k", batch_size: batchSize,
    ...(model_id === "grok_imagine_2" ? { details_quality: "medium" } : {}) };
  try {
    const reference_handles: string[] = [];
    for (let index = 0; index < referenceCount; index += 1) {
      const bytes = Buffer.from(JPEG);
      bytes[10] = index + 1;
      const uploaded = await imageUploadService.upload({ attemptId: ATTEMPT, model_id,
        content_base64: bytes.toString("base64"), filename: `grok-${index + 1}.jpg`, mime_type: "image/jpeg" });
      reference_handles.push(uploaded.reference_handle);
    }
    const asset_set = await preparer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, model_id, prompt,
      parameters, reference_handles });
    const candidate = await preparer.prepare({ principal: PRINCIPAL, attempt_id: ATTEMPT, asset_set });
    const permit = createOwnerGrokT2iOneShotPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now });
    return { candidate, permit, preparer, imageUploadService, uploadCount };
  } catch (error) { await preparer.close(); await imageUploadService.close(); throw error; }
}

test("fixed Grok T2I POST preserves all four prepared full-state settings branches", async () => {
  const cases = ["grok_t2i", "grok_t2i_pro", "grok_imagine_2", "grok_imagine_quality"] as const;
  for (const model_id of cases) {
    for (const batchSize of [1, 2, 3, 4, 5]) {
      const prepared = await prepare(model_id, 0, "A synthetic source-shaped prompt", Date.now, batchSize);
      let calls = 0;
      const harness = makeClient(async (input, init) => {
        calls += 1;
        assert.equal(new URL(String(input)).href, "https://api.syntx.ai/api/v1/design/generate?ai_name=grok_image");
        assert.equal(init?.method, "POST");
        assert.equal((init?.headers as Record<string, string>).authorization, "Bearer synthetic-grok-start-credential");
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
        assert.deepEqual(Object.keys(body), ["chat_uuid", "prompt", "settings"]);
        assert.equal(body.chat_uuid, "grok-start-chat");
        assert.equal(body.prompt, "A synthetic source-shaped prompt");
        const settings = body.settings as Record<string, unknown>;
        const expectedSettings = { n: 1, model_type: model_id, aspect_ratio: "1:1", resolution: "1k", batch_size: batchSize,
          ...(model_id === "grok_imagine_2" ? { details_quality: "medium" } : {}), file_urls: [] };
        assert.deepEqual(settings, expectedSettings);
        assert.deepEqual(Object.keys(settings), Object.keys(expectedSettings));
        return Response.json({ id: `synthetic-${model_id}-${batchSize}-ack` });
      });
      try {
        const result = await harness.client.startGrokT2iImageWithOwnedCandidate({ preparer: prepared.preparer,
          candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-start-chat" });
        assert.deepEqual(result, { chat_uuid: "grok-start-chat", message_id: `synthetic-${model_id}-${batchSize}-ack` });
        assert.equal(calls, 1);
        assert.equal(harness.credentialCalls(), 1);
        assert.equal(prepared.uploadCount, 0);
      } finally { await prepared.preparer.close(); await prepared.imageUploadService.close(); }
    }
  }
});

test("positive references retain actual 765 URL order at Imagine2 and Quality selector maxima", async () => {
  for (const [model_id, count] of [["grok_imagine_2", 5], ["grok_imagine_quality", 3]] as const) {
    const prepared = await prepare(model_id, count);
    const expectedFiles = (prepared.candidate.request.settings.file_urls as readonly Readonly<{ type: string; url: string }>[]);
    let posts = 0;
    const harness = makeClient(async (_input, init) => {
      posts += 1;
      const body = JSON.parse(String(init?.body)) as { settings: { file_urls: unknown } };
      assert.deepEqual(body.settings.file_urls, expectedFiles);
      assert.equal((body.settings.file_urls as unknown[]).length, count);
      return Response.json({ id: `refs-${model_id}` });
    });
    try {
      await harness.client.startGrokT2iImageWithOwnedCandidate({ preparer: prepared.preparer, candidate: prepared.candidate,
        permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-start-refs" });
      assert.equal(posts, 1);
      assert.equal(harness.credentialCalls(), 1);
      assert.equal(prepared.uploadCount, count);
    } finally { await prepared.preparer.close(); await prepared.imageUploadService.close(); }
  }
});

test("source-valid Cyrillic and emoji prompt at the UTF-16 UI boundary is preserved unchanged", async () => {
  const prompt = "я".repeat(500) + "😀".repeat(250);
  assert.equal(prompt.length, 1_000);
  const prepared = await prepare("grok_imagine_2", 0, prompt);
  const harness = makeClient(async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as { prompt: string };
    assert.equal(body.prompt, prompt);
    return Response.json({ id: "unicode-ack" });
  });
  try {
    const result = await harness.client.startGrokT2iImageWithOwnedCandidate({ preparer: prepared.preparer,
      candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-unicode" });
    assert.equal(result.message_id, "unicode-ack");
  } finally { await prepared.preparer.close(); await prepared.imageUploadService.close(); }
});

test("wrong principal, forged candidate or permit, changed attempt, and malformed fields fail before dispatch", async () => {
  const prepared = await prepare("grok_t2i");
  let posts = 0;
  const harness = makeClient(async () => { posts += 1; return Response.json({ id: "unexpected" }); });
  const base = { preparer: prepared.preparer, candidate: prepared.candidate, permit: prepared.permit,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-invalid" };
  const invalid = [
    { ...base, principal: { ...PRINCIPAL, subject_id: "different-subject" } },
    { ...base, candidate: { ...prepared.candidate } },
    { ...base, candidate: new Proxy(prepared.candidate, {}) },
    { ...base, permit: { ...prepared.permit } },
    { ...base, attemptId: `${ATTEMPT}-wrong` },
    { ...base, chat_uuid: "bad/chat" },
    { ...base, extra: "caller settings are forbidden" }
  ];
  try {
    for (const input of invalid) await assert.rejects(harness.client.startGrokT2iImageWithOwnedCandidate(input));
    assert.equal(posts, 0);
    assert.equal(harness.credentialCalls(), 0);
    const valid = await harness.client.startGrokT2iImageWithOwnedCandidate(base);
    assert.equal(valid.message_id, "unexpected");
    assert.equal(posts, 1, "pre-dispatch rejection leaves the genuine permit unconsumed");
  } finally { await prepared.preparer.close(); await prepared.imageUploadService.close(); }
});

test("pre-abort keeps the permit reusable; ambiguous POST failure is not retried or replayed", async () => {
  const prepared = await prepare("grok_imagine_2");
  let posts = 0;
  const failing = makeClient(async () => { posts += 1; throw new Error("private upstream response secret"); });
  const input = { preparer: prepared.preparer, candidate: prepared.candidate, permit: prepared.permit,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-ambiguous" };
  const aborter = new AbortController(); aborter.abort();
  try {
    await assert.rejects(failing.client.startGrokT2iImageWithOwnedCandidate(input, aborter.signal));
    assert.equal(posts, 0);
    assert.equal(failing.credentialCalls(), 0);
    await assert.rejects(failing.client.startGrokT2iImageWithOwnedCandidate(input), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.equal(error instanceof SyntxHttpError ? error.code : "", "UPSTREAM_UNAVAILABLE");
      assert.equal(error.message.includes("private upstream response secret"), false);
      return true;
    });
    assert.equal(posts, 1, "ambiguous dispatch has no internal retry");
    assert.equal(failing.credentialCalls(), 1);
    await assert.rejects(failing.client.startGrokT2iImageWithOwnedCandidate(input));
    assert.equal(posts, 1, "consumed permit prevents replay after ambiguous outcome");
  } finally { await prepared.preparer.close(); await prepared.imageUploadService.close(); }
});

test("expired and invalidated source candidates are denied before credentials and POST", async () => {
  let nowValue = Date.parse("2026-10-11T02:00:00.000Z");
  const expired = await prepare("grok_t2i", 0, "A synthetic source-shaped prompt", () => nowValue);
  let posts = 0;
  const harness = makeClient(async () => { posts += 1; return Response.json({ id: "unexpected" }); });
  const input = { preparer: expired.preparer, candidate: expired.candidate, permit: expired.permit,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-expired" };
  try {
    nowValue += 15 * 60_000;
    await assert.rejects(harness.client.startGrokT2iImageWithOwnedCandidate(input));
    assert.equal(posts, 0);
    assert.equal(harness.credentialCalls(), 0);
  } finally { await expired.preparer.close(); await expired.imageUploadService.close(); }

  const revoked = await prepare("grok_imagine_quality");
  try {
    await revoked.preparer.invalidateAttempt(ATTEMPT);
    await assert.rejects(harness.client.startGrokT2iImageWithOwnedCandidate({ preparer: revoked.preparer,
      candidate: revoked.candidate, permit: revoked.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "grok-revoked" }));
    assert.equal(posts, 0);
    assert.equal(harness.credentialCalls(), 0);
  } finally { await revoked.preparer.close(); await revoked.imageUploadService.close(); }
});
