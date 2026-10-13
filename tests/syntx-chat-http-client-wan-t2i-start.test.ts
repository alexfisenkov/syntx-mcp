import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import test from "node:test";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthBinding } from "../src/auth/types.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import { OwnerWanT2iRequestPreparer, type OwnerWanT2iPreparedCandidate } from "../src/application/owner-wan-t2i-request-preparer.js";
import {
  createOwnerWanT2iOneShotPermit,
  OwnerWanT2iOneShotPolicyError,
  type OwnerWanT2iOneShotPermit
} from "../src/application/owner-wan-t2i-one-shot-policy.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { MediaGenerationReceipt } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG_ROOT = join(process.cwd(), "catalog");
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION, CATALOG_ROOT).discoveryCatalog;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "wan-t2i-native-tenant", subject: "wan-t2i-native-subject" });
const ATTEMPT = "link_wan_t2i_native_test_000000000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT
});
const MODELS = ["wan_25_t2i_preview", "wan_26_t2i"] as const;
const RATIOS = ["1:1", "3:4", "4:3", "9:16", "16:9"] as const;
const RESOLUTIONS = ["720P", "1080P"] as const;
const SEEDS = [null, 0, 2_147_483_647] as const;
const CHAT_UUID = "wan-t2i-native-chat-001";

interface NativeClientPort {
  startWanT2iImageWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt>;
}

function createLinkService() {
  let calls = 0;
  const service = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    calls += 1;
    return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
      status: "LINKED" as const, expires_at: null, linked: true };
  } } as never);
  return { service, get calls() { return calls; } };
}

function createRig(now: () => number = () => 1_000_000) {
  const link = createLinkService();
  const preparer = new OwnerWanT2iRequestPreparer({ binding: BINDING, linkService: link.service,
    catalog: CATALOG, catalog_version: CATALOG_VERSION, now });
  return { link, preparer, now };
}

function sourceInput(model_id: typeof MODELS[number], prompt: string, parameters: Record<string, unknown> = {}) {
  return { model_id, prompt, parameters: { aspect_ratio: "1:1", resolution: "720P", batch_size: 1,
    prompt_extend: false, seed: null, color_palette: null, bbox_list: [], ...parameters } };
}

async function preparePermit(rig: ReturnType<typeof createRig>, model_id: typeof MODELS[number],
  prompt: string, parameters: Record<string, unknown> = {}) {
  const candidate = await rig.preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL,
    input: sourceInput(model_id, prompt, parameters) });
  const permit = createOwnerWanT2iOneShotPermit({ preparer: rig.preparer, candidate, principal: PRINCIPAL,
    attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: rig.now });
  return { candidate, permit };
}

function makeClient(fetchImpl: typeof fetch) {
  let fetchCalls = 0;
  let credentialCalls = 0;
  const credentialBroker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1;
    return operation("synthetic-wan-t2i-native-credential");
  } };
  const client = new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    fetchCalls += 1;
    return fetchImpl(input, init);
  } });
  return { client, fetchCalls: () => fetchCalls, credentialCalls: () => credentialCalls };
}

function nativePort(client: SyntxChatHttpClient): NativeClientPort {
  const port = client as unknown as NativeClientPort;
  assert.equal(typeof port.startWanT2iImageWithOwnedCandidate, "function", "MISSING_OWNER_WAN_T2I_NATIVE_START");
  return port;
}

function nativeInput(rig: ReturnType<typeof createRig>, candidate: OwnerWanT2iPreparedCandidate, permit: OwnerWanT2iOneShotPermit,
  overrides: Partial<{ principal: GenerationPrincipalRef; attemptId: string; chat_uuid: string }> = {}) {
  return { preparer: rig.preparer, candidate, permit, principal: overrides.principal ?? PRINCIPAL,
    attemptId: overrides.attemptId ?? ATTEMPT, chat_uuid: overrides.chat_uuid ?? CHAT_UUID };
}

test("a fresh Node process can import client, preparer, and one-shot policy without a module cycle", () => {
  const clientUrl = new URL("../src/adapter/syntx/chat-http-client.js", import.meta.url).href;
  const preparerUrl = new URL("../src/application/owner-wan-t2i-request-preparer.js", import.meta.url).href;
  const policyUrl = new URL("../src/application/owner-wan-t2i-one-shot-policy.js", import.meta.url).href;
  const script = `const client=await import(${JSON.stringify(clientUrl)}); await import(${JSON.stringify(preparerUrl)}); await import(${JSON.stringify(policyUrl)}); if(typeof client.SyntxChatHttpClient.prototype.startWanT2iImageWithOwnedCandidate!=="function") process.exit(17);`;
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: process.cwd(), env: { PATH: process.env.PATH ?? "" }, encoding: "utf8", timeout: 5_000
  });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
});

test("fixed native POST preserves all 80 full explicit T2I states and emits exactly one request each", async () => {
  const rig = createRig();
  let requestCount = 0;
  let expectedBody: Record<string, unknown> | undefined;
  const client = makeClient(async (input, init) => {
    requestCount += 1;
    const url = new URL(String(input));
    assert.equal(url.href, "https://api.syntx.ai/api/v1/design/generate?ai_name=wan_image");
    assert.equal(init?.method, "POST");
    assert.equal(init?.redirect, "error");
    assert.equal((init?.headers as Record<string, string>).authorization, "Bearer synthetic-wan-t2i-native-credential");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body), ["chat_uuid", "prompt", "settings"]);
    const settings = body.settings as Record<string, unknown>;
    assert.deepEqual(body, expectedBody);
    assert.equal(settings.n, 1);
    assert.equal(Object.hasOwn(settings, "size"), false);
    assert.equal(Object.hasOwn(settings, "version"), false);
    return Response.json({ id: `wan-native-ack-${requestCount}` });
  });
  let count = 0;
  try {
    for (const model_id of MODELS) for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS) {
      for (const batch_size of [1, 2, 3, 4] as const) {
        const prompt_extend = count % 2 === 0;
        const seed = SEEDS[count % SEEDS.length]!;
        const prompt = `Prompt ${count}`;
        const { candidate, permit } = await preparePermit(rig, model_id, prompt,
          { aspect_ratio, resolution, batch_size, prompt_extend, seed });
        const expectedSettings = { n: 1, model_type: model_id, aspect_ratio, resolution, batch_size, prompt_extend,
          seed, color_palette: null, bbox_list: [], file_urls: [] };
        expectedBody = { chat_uuid: CHAT_UUID, prompt, settings: expectedSettings };
        const nativeCall = await nativePort(client.client).startWanT2iImageWithOwnedCandidate(
          nativeInput(rig, candidate, permit));
        assert.deepEqual(nativeCall, { chat_uuid: CHAT_UUID, message_id: `wan-native-ack-${count + 1}` });
        assert.deepEqual(candidate.request.settings, expectedSettings);
        count += 1;
      }
    }
    assert.equal(count, 80);
    assert.equal(requestCount, 80);
    assert.equal(client.fetchCalls(), 80);
    assert.equal(client.credentialCalls(), 80);
  } finally { await rig.preparer.close(); }
});

test("preserves the exact 1500 UTF-16-plus-LF prompt at native dispatch", async () => {
  const rig = createRig();
  const prompt = "x".repeat(1_498) + "\n";
  let postedPrompt: unknown;
  const client = makeClient(async (_input, init) => {
    postedPrompt = (JSON.parse(String(init?.body)) as Record<string, unknown>).prompt;
    return Response.json({ id: "wan-native-boundary-ack" });
  });
  try {
    const { candidate, permit } = await preparePermit(rig, "wan_26_t2i", prompt);
    await nativePort(client.client).startWanT2iImageWithOwnedCandidate(nativeInput(rig, candidate, permit));
    assert.equal(postedPrompt, prompt);
    assert.equal(client.fetchCalls(), 1);
  } finally { await rig.preparer.close(); }
});

test("aborted-before-dispatch leaves the actual one-shot permit usable and makes no credential or fetch call", async () => {
  const rig = createRig();
  const client = makeClient(async () => Response.json({ id: "wan-native-abort-ack" }));
  try {
    const { candidate, permit } = await preparePermit(rig, "wan_25_t2i_preview", "Abort boundary");
    const controller = new AbortController(); controller.abort();
    await assert.rejects(nativePort(client.client).startWanT2iImageWithOwnedCandidate(
      nativeInput(rig, candidate, permit), controller.signal));
    assert.equal(client.fetchCalls(), 0);
    assert.equal(client.credentialCalls(), 0);
    const result = await nativePort(client.client).startWanT2iImageWithOwnedCandidate(nativeInput(rig, candidate, permit));
    assert.deepEqual(result, { chat_uuid: CHAT_UUID, message_id: "wan-native-abort-ack" });
    assert.equal(client.fetchCalls(), 1);
    assert.equal(client.credentialCalls(), 1);
  } finally { await rig.preparer.close(); }
});

test("clone, foreign principal, spoofed input, and invalid chat path cannot spend or burn a permit", async () => {
  const rig = createRig();
  const client = makeClient(async () => Response.json({ id: "wan-native-guard-ack" }));
  try {
    const { candidate, permit } = await preparePermit(rig, "wan_26_t2i", "Guard sequence");
    const call = nativePort(client.client).startWanT2iImageWithOwnedCandidate.bind(client.client);
    await assert.rejects(call({ ...nativeInput(rig, structuredClone(candidate) as OwnerWanT2iPreparedCandidate, permit) }));
    await assert.rejects(call(nativeInput(rig, candidate, permit, {
      principal: Object.freeze({ ...PRINCIPAL, subject_id: "foreign-owner" })
    })));
    await assert.rejects(call({ ...nativeInput(rig, candidate, permit), extra: true }));
    await assert.rejects(call(nativeInput(rig, candidate, permit, { chat_uuid: "../unsafe" })));
    assert.equal(client.fetchCalls(), 0);
    const valid = await call(nativeInput(rig, candidate, permit));
    assert.deepEqual(valid, { chat_uuid: CHAT_UUID, message_id: "wan-native-guard-ack" });
    assert.equal(client.fetchCalls(), 1);
  } finally { await rig.preparer.close(); }
});

test("a dispatch transport error is not retried and the same actual permit cannot be consumed again", async () => {
  const rig = createRig();
  let calls = 0;
  const client = makeClient(async () => { calls += 1; throw new Error("synthetic one-shot transport failure"); });
  try {
    const { candidate, permit } = await preparePermit(rig, "wan_25_t2i_preview", "No retry");
    const call = nativePort(client.client).startWanT2iImageWithOwnedCandidate.bind(client.client);
    await assert.rejects(call(nativeInput(rig, candidate, permit)));
    assert.equal(calls, 1);
    await assert.rejects(call(nativeInput(rig, candidate, permit)), (error: unknown) =>
      error instanceof OwnerWanT2iOneShotPolicyError && error.code === "PERMIT_ALREADY_CONSUMED");
    assert.equal(calls, 1);
    assert.equal(client.fetchCalls(), 1);
  } finally { await rig.preparer.close(); }
});
