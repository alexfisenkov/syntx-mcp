import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerKontextImageOwnedReferenceBindingIssuer,
  prepareOwnerKontextImageRequest,
  type OwnerKontextImageOwnedReferenceResolverContext
} from "../src/application/owner-kontext-image-request-preparer.js";
import type { OwnerKontextImageVariant } from "../src/application/owner-kontext-image-parameters.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../src/catalog/selected-discovery-catalog.js";
import { createOwnerKontextImageOneShotPermit } from "../src/application/owner-kontext-image-one-shot-policy.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const ATTEMPT = "link_kontext_native_start_000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: "native-kontext-tenant", subject_id: "native-kontext-subject", connection_id: ATTEMPT
});
const CHAT_UUID = "kontext-private-chat-123";
const CATALOG_VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const NOW = Date.now();
const PROMPT = "  keep the subject, change the scene  ";
const CREDENTIAL = "synthetic-kontext-generation-credential";
const VARIANTS = ["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"] as const;
const RESOLUTIONS = ["1344x768", "1152x896", "1024x1024", "896x1152", "768x1344"] as const;

function resolverValue(context: OwnerKontextImageOwnedReferenceResolverContext, index: number) {
  return {
    ...context,
    file_url: `https://r2.syntx.ai/private/kontext/${index + 1}.png`,
    mime_type: "image/png",
    width: 1200 + index,
    height: 800 + index,
    size: 1_024 + index,
    sha256: `sha256:${String(index + 1).repeat(64)}`,
    expires_at: NOW + 900_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY"
  };
}

async function prepare(variant: OwnerKontextImageVariant, resolution: typeof RESOLUTIONS[number]) {
  const issuer = createOwnerKontextImageOwnedReferenceBindingIssuer(async (context) =>
    resolverValue(context, Number(context.reference_handle.slice(-1))), {
      catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW
    });
  const count = variant === "flux-kontext-multi" ? 4 : 0;
  const handles = Array.from({ length: count }, (_, index) =>
    `kontext_image_00000000-0000-4000-8000-00000000000${index + 1}`);
  const reference_set = await issuer.issue({ principal: PRINCIPAL, attempt_id: ATTEMPT, variant, reference_handles: handles });
  const candidate = prepareOwnerKontextImageRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant,
    parameters: { resolution, cfg: 3.7, steps: 27.5, image_strength: 0.63 },
    reference_set, workflow_policy: "LOCAL_CLIENT_INTENT_EXPLICIT_NO_LORA", prompt: PROMPT
  }, { catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW });
  const permit = createOwnerKontextImageOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog: CATALOG, catalog_version: CATALOG_VERSION, now: () => NOW
  });
  return { candidate, permit, issuer };
}

function broker(calls: { count: number }): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
    calls.count += 1;
    return operation(CREDENTIAL);
  } };
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
}

test("sends only the exact prepared full-state body to fixed Flux route for all variants and resolutions", async () => {
  for (const variant of VARIANTS) {
    for (const resolution of RESOLUTIONS) {
      const prepared = await prepare(variant, resolution);
      assert.equal(prepared.candidate.request.settings.civitai_loras.length, 0);
      assert.equal(prepared.candidate.request.settings.file_urls.length, variant === "flux-kontext-multi" ? 4 : 0);
      assert.equal(prepared.candidate.request.settings.cfg, 3.7);
      assert.equal(prepared.candidate.request.settings.steps, 27.5);
      assert.equal(prepared.candidate.request.settings.image_strength, 0.63);
      let fetchCalls = 0;
      const credentialCalls = { count: 0 };
      const client = new SyntxChatHttpClient({
        credentialBroker: broker(credentialCalls),
        fetchImpl: async (input, init) => {
          fetchCalls += 1;
          assert.equal(String(input), "https://api.syntx.ai/api/v1/design/generate?ai_name=flux");
          assert.equal(init?.method, "POST");
          assert.equal(init?.redirect, "error");
          assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
          assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
          assert.deepEqual(JSON.parse(init?.body as string), {
            chat_uuid: CHAT_UUID, prompt: PROMPT, settings: prepared.candidate.request.settings
          });
          return jsonResponse({ id: `kontext-ack-${variant}-${resolution}` });
        }
      });
      const receipt = await client.startKontextImageWithOwnedCandidate({
        candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
      });
      assert.deepEqual(receipt, { chat_uuid: CHAT_UUID, message_id: `kontext-ack-${variant}-${resolution}` });
      assert.equal(fetchCalls, 1);
      assert.equal(credentialCalls.count, 1);
      await assert.rejects(client.startKontextImageWithOwnedCandidate({
        candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
      }));
      assert.equal(fetchCalls, 1, "consumed permit cannot dispatch a second POST");
      prepared.issuer.close();
    }
  }
});

test("rejects wrong principal, copied candidate, and caller-supplied fields without native dispatch", async () => {
  const prepared = await prepare("flux-kontext-pro", "1024x1024");
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker({ count: 0 }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ id: "should-not-run" }); }
  });
  await assert.rejects(client.startKontextImageWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit,
    principal: { ...PRINCIPAL, subject_id: "other" }, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }));
  await assert.rejects(client.startKontextImageWithOwnedCandidate({
    candidate: { ...prepared.candidate }, permit: prepared.permit,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }));
  await assert.rejects(client.startKontextImageWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT,
    chat_uuid: CHAT_UUID, settings: { model_type: "other" }, ai_name: "other"
  }));
  assert.equal(fetchCalls, 0);
  const validClient = new SyntxChatHttpClient({
    credentialBroker: broker({ count: 0 }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ id: "valid-after-rejection" }); }
  });
  assert.deepEqual(await validClient.startKontextImageWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }), { chat_uuid: CHAT_UUID, message_id: "valid-after-rejection" });
  assert.equal(fetchCalls, 1, "local validation failures do not consume the one-shot permit");
  prepared.issuer.close();
});

test("an invalid ACK is not retried and the consumed one-shot remains consumed", async () => {
  const prepared = await prepare("flux-kontext-max", "1024x1024");
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker({ count: 0 }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ unexpected: true }); }
  });
  const input = { candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID };
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input));
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input));
  assert.equal(fetchCalls, 1);
  prepared.issuer.close();
});

test("an uncertain transport failure is attempted once and cannot be replayed", async () => {
  const prepared = await prepare("flux-kontext-multi", "1024x1024");
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker({ count: 0 }),
    fetchImpl: async () => { fetchCalls += 1; throw new TypeError("synthetic transport failure"); }
  });
  const input = { candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID };
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input));
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input));
  assert.equal(fetchCalls, 1);
  prepared.issuer.close();
});

test("a pre-send abort dispatches no request and cannot resurrect the consumed permit", async () => {
  const prepared = await prepare("flux-kontext-pro", "1024x1024");
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker({ count: 0 }),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ id: "should-not-run" }); }
  });
  const controller = new AbortController();
  controller.abort();
  const input = { candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID };
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input, controller.signal));
  await assert.rejects(client.startKontextImageWithOwnedCandidate(input));
  assert.equal(fetchCalls, 0);
  prepared.issuer.close();
});
