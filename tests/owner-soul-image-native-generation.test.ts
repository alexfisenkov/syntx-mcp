import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { OwnerSoulCharacterCatalogHttpClient } from "../src/adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulStyleCatalogHttpClient } from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import type { AuthBinding } from "../src/auth/types.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import { OwnerSoulCharacterOptionsService } from "../src/application/owner-soul-character-options-service.js";
import { OwnerSoulStyleOptionsService } from "../src/application/owner-soul-style-options-service.js";
import { OwnerSoulImageRequestPreparer } from "../src/application/owner-soul-image-request-preparer.js";
import { loadSelectedDiscoveryCatalog, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";
import type { OwnerSoulGenerationParametersInput } from "../src/application/owner-soul-generation-parameters.js";

const POLICY_URL = new URL("../src/application/owner-soul-image-one-shot-policy.js", import.meta.url).href;
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const BINDING: AuthBinding = Object.freeze({ tenant_id: "soul-native-tenant", subject: "soul-native-subject" });
const ATTEMPT = "link_soul_native_00000000000000000001";
const PRINCIPAL = Object.freeze({ tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT });
const MAX_SEED = 2_147_483_647;
const QUALITY_PAIRS = {
  "720p": ["2048x1152", "1680x1120", "1536x1152", "1536x1536", "1152x1536", "1120x1680", "1152x2048"],
  "1080p": ["2048x1152", "2016x1344", "2048x1536", "1536x1536", "1536x2048", "1344x2016", "1152x2048"]
} as const;

test("exposes a source-shaped owned-candidate native Soul dispatch boundary", () => {
  const nativeClient = SyntxChatHttpClient.prototype as unknown as Record<string, unknown>;
  assert.equal(typeof nativeClient.startSoulImageWithOwnedCandidate, "function", "MISSING_SOUL_NATIVE_CANDIDATE_CONSUMER");
});

function linkedAttempt(attemptId: string) {
  return { attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: null, linked: true };
}

function createRig(options: { failPost?: boolean; malformedPost?: boolean } = {}) {
  let now = 1_000;
  let styleGets = 0; let characterGets = 0; let credentialCalls = 0;
  const posts: Array<{ url: string; body: { chat_uuid: string; prompt: string; settings: Record<string, unknown> } }> = [];
  const broker: SyntxCredentialBroker = { async useCredential<T>(operation: (credential: string) => Promise<T>) {
    credentialCalls += 1; return operation("synthetic-owner-soul-native-credential");
  } };
  const styleClient = new OwnerSoulStyleCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    styleGets += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles"); assert.equal(init?.method, "GET");
    return Response.json({ items: [{ style_id: "style:private/source-value", name: "Reviewed style", image: "https://images.invalid/style.jpg" }], total: 1 });
  } });
  const characterClient = new OwnerSoulCharacterCatalogHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    characterGets += 1; assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/list"); assert.equal(init?.method, "GET");
    return Response.json({ items: [
      { id: "source-key-string", reference_id: "reference:string/private-value", title: "String Character", status: "completed" },
      { id: 17, reference_id: 9001, title: "Numeric Character", status: "completed" }
    ], total: 2 });
  } });
  const linkService = new PerUserLinkService({} as never, { async getSnapshot(_binding: unknown, attemptId: string) {
    return linkedAttempt(attemptId);
  } } as never);
  const styleOptionsService = new OwnerSoulStyleOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalogVersion: CATALOG_VERSION, resolveClient: () => styleClient, now: () => now });
  const characterOptionsService = new OwnerSoulCharacterOptionsService({ binding: BINDING, linkService, catalog: CATALOG,
    catalog_version: CATALOG_VERSION, resolveClient: () => characterClient, now: () => now });
  const preparer = new OwnerSoulImageRequestPreparer({ binding: BINDING, linkService, styleOptionsService,
    characterOptionsService, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
  const client = new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, "/api/v1/design/generate");
    assert.equal(url.search, "?ai_name=higgsfield-soul");
    assert.equal(init?.method, "POST");
    const body = JSON.parse(String(init?.body)) as { chat_uuid: string; prompt: string; settings: Record<string, unknown> };
    posts.push({ url: url.href, body });
    if (options.failPost) throw new Error("synthetic Soul POST response lost");
    if (options.malformedPost) return Response.json({ missing_id: true });
    return Response.json({ id: `soul-native-echo-${posts.length}` });
  } });
  return { client, preparer, styleOptionsService, characterOptionsService, linkService, posts,
    get counts() { return { styleGets, characterGets, credentialCalls }; },
    get now() { return now; }, set now(value: number) { now = value; },
    async styleHandle() {
      const result = await styleOptionsService.listOptions({ attemptId: ATTEMPT });
      return result.options[0]!.style_handle;
    },
    async characterHandles() {
      const result = await characterOptionsService.listOptions({ attemptId: ATTEMPT });
      return result.options.map((option) => option.character_handle).filter((handle): handle is string => handle !== null);
    },
    async prepare(input: OwnerSoulGenerationParametersInput) {
      const candidate = await preparer.prepare({ attemptId: ATTEMPT, principal: PRINCIPAL, input });
      const policy = await import(POLICY_URL) as Record<string, unknown>;
      const createPermit = policy.createOwnerSoulImageOneShotPermit as (value: unknown) => unknown;
      assert.equal(typeof createPermit, "function", "MISSING_SOUL_ONE_SHOT_PERMIT_CREATOR");
      const permit = createPermit({ preparer, candidate, principal: PRINCIPAL, attemptId: ATTEMPT,
        catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => now });
      return { candidate, permit };
    },
    async close() { await preparer.close(); await styleOptionsService.close(); await characterOptionsService.close(); }
  };
}

async function startSoul(client: SyntxChatHttpClient, input: unknown, signal?: AbortSignal): Promise<unknown> {
  const method = (client as unknown as { startSoulImageWithOwnedCandidate?:
    (request: unknown, signal?: AbortSignal) => Promise<unknown> }).startSoulImageWithOwnedCandidate;
  assert.equal(typeof method, "function", "MISSING_SOUL_NATIVE_CANDIDATE_CONSUMER");
  return Reflect.apply(method!, client, [input, signal]) as Promise<unknown>;
}

function explicitIntent(overrides: Partial<OwnerSoulGenerationParametersInput> = {}): OwnerSoulGenerationParametersInput {
  return { prompt: "An explicit Soul portrait", quality: "720p", resolution: "2048x1152", batch_size: 1,
    enhance_prompt: false, seed: null, style: { kind: "none" }, character: { kind: "none" }, ...overrides };
}

test("posts exact Soul source-shaped settings for all 14 quality/resolution pairs and batches 1/4", async () => {
  const rig = createRig();
  try {
    let index = 0;
    for (const [quality, resolutions] of Object.entries(QUALITY_PAIRS)) {
      for (const resolution of resolutions) {
        for (const batch_size of [1, 4] as const) {
          const seed = [null, 0, MAX_SEED][index % 3]!;
          const enhance_prompt = index % 2 === 1;
          const prompt = `explicit Soul matrix ${index}`;
          const prepared = await rig.prepare(explicitIntent({ prompt, quality: quality as "720p" | "1080p", resolution,
            batch_size, enhance_prompt, seed }));
          const receipt = await startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate,
            permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: `soul-native-chat-${index}` }) as
            { chat_uuid: string; message_id: string };
          assert.deepEqual(receipt, { chat_uuid: `soul-native-chat-${index}`, message_id: `soul-native-echo-${index + 1}` });
          assert.deepEqual(rig.posts[index], { url: "https://api.syntx.ai/api/v1/design/generate?ai_name=higgsfield-soul",
            body: { chat_uuid: `soul-native-chat-${index}`, prompt,
              settings: { n: 1, model_type: "higgsfield-soul", quality, resolution, batch_size, enhance_prompt, seed,
                style_id: "", reference_id: "", file_urls: [] } } });
          index += 1;
        }
      }
    }
    assert.equal(index, 28);
    assert.equal(rig.posts.length, 28);
    assert.equal(rig.counts.credentialCalls, 28, "one authorization callback per one-shot POST");
  } finally { await rig.close(); }
});

test("preserves all 11 explicit selected-style strengths and source-bound string/numeric Character values", async () => {
  const rig = createRig();
  try {
    const styleHandle = await rig.styleHandle();
    const characterHandles = await rig.characterHandles();
    assert.equal(characterHandles.length, 2);
    for (let index = 0; index <= 10; index += 1) {
      const strength = index / 10;
      const characterHandle = characterHandles[index % 2]!;
      const prepared = await rig.prepare(explicitIntent({ batch_size: 4, seed: index === 0 ? null : index === 1 ? 0 : MAX_SEED,
        style: { kind: "selected", style_handle: styleHandle, strength },
        character: { kind: "selected", character_handle: characterHandle } }));
      await startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
        principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: `soul-selected-chat-${index}` });
      const settings = rig.posts[index]!.body.settings;
      assert.deepEqual(settings, { n: 1, model_type: "higgsfield-soul", quality: "720p", resolution: "2048x1152",
        batch_size: 4, enhance_prompt: false, seed: index === 0 ? null : index === 1 ? 0 : MAX_SEED,
        style_id: "style:private/source-value", style_strength: strength,
        reference_id: index % 2 === 0 ? "reference:string/private-value" : 9001, file_urls: [] });
      assert.equal(Object.hasOwn(settings, "reference_strength"), false);
      assert.equal(Object.hasOwn(settings, "version"), false);
    }
    assert.equal(rig.posts.length, 11);
  } finally { await rig.close(); }
});

test("pre-abort, foreign context, and candidate clone cannot post or consume the actual one-shot permit", async () => {
  const rig = createRig();
  try {
    const prepared = await rig.prepare(explicitIntent());
    const toRevoke = await rig.prepare(explicitIntent({ prompt: "candidate revoked before dispatch" }));
    const controller = new AbortController(); controller.abort();
    const before = rig.counts.credentialCalls;
    await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-pre-abort" }, controller.signal),
    (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
    await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: { ...prepared.candidate }, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-clone" }));
    await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: { ...PRINCIPAL, subject_id: "foreign-subject" }, attemptId: ATTEMPT, chat_uuid: "soul-foreign" }));
    assert.equal(rig.posts.length, 0);
    assert.equal(rig.counts.credentialCalls, before);
    await startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
      principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-valid-after-rejects" });
    assert.equal(rig.posts.length, 1);
    rig.preparer.invalidateAttempt(ATTEMPT);
    await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: toRevoke.candidate,
      permit: toRevoke.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-revoked" }));
    assert.equal(rig.posts.length, 1, "attempt revocation must invalidate a still-unconsumed candidate before POST");
  } finally { await rig.close(); }
});

test("does not retry a failed or malformed native POST and cannot replay the consumed permit", async () => {
  for (const options of [{ failPost: true }, { malformedPost: true }]) {
    const rig = createRig(options);
    try {
      const prepared = await rig.prepare(explicitIntent());
      await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
        principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-single-post" }));
      assert.equal(rig.posts.length, 1);
      await assert.rejects(startSoul(rig.client, { preparer: rig.preparer, candidate: prepared.candidate, permit: prepared.permit,
        principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: "soul-no-retry" }));
      assert.equal(rig.posts.length, 1);
    } finally { await rig.close(); }
  }
});
