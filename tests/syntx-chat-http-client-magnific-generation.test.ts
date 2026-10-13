import assert from "node:assert/strict";
import test from "node:test";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import {
  createOwnerMagnificUpscaleOwnedImageBindingIssuer,
  getOwnerMagnificUpscaleSourceProfile,
  prepareOwnerMagnificUpscaleRequest,
  type OwnerMagnificUpscaleOwnedImageResolution
} from "../src/application/owner-magnific-upscale-request-preparer.js";
import {
  createOwnerMagnificUpscaleOneShotPermit,
  OwnerMagnificUpscaleOneShotPolicyError
} from "../src/application/owner-magnific-upscale-one-shot-policy.js";
import type { OwnerMagnificUpscaleVariant } from "../src/application/owner-magnific-upscale-parameters.js";
import type { GenerationPrincipalRef } from "../src/domain/generation-operation.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const ATTEMPT = "link_magnific_native_gen_000001";
const PRINCIPAL: Readonly<GenerationPrincipalRef> = Object.freeze({
  tenant_id: "native-magnific-tenant", subject_id: "native-magnific-subject", connection_id: ATTEMPT
});
const CATALOG_VERSION = "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json";
const CATALOG = loadSelectedDiscoveryCatalog(CATALOG_VERSION).discoveryCatalog;
const CHAT_UUID = "magnific-private-chat-123";
const PARAMETER_STATE = Object.freeze({
  scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
  resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime"
} as const);
const CREDENTIAL = "synthetic-magnific-generation-credential";

function imageResolution(variant: OwnerMagnificUpscaleVariant, expiresAt: number): OwnerMagnificUpscaleOwnedImageResolution {
  const profile = getOwnerMagnificUpscaleSourceProfile(variant);
  return {
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, model_id: variant,
    scope: "tool_image_upscaler", catalog_version: CATALOG_VERSION, profile_schema_hash: profile.profile_schema_hash,
    file_url: `https://r2.syntx.ai/private/magnific-${variant}?sig=synthetic-owned`, mime_type: "image/png",
    width: 512, height: 512, size: 5_461, sha256: `sha256:${"a".repeat(64)}`,
    expires_at: expiresAt, metadata_confidence: "CONTAINER_METADATA_ONLY"
  };
}

async function prepareCandidate(
  variant: OwnerMagnificUpscaleVariant,
  options: { readonly now?: number; readonly expiresAt?: number; readonly prompt?: string } = {}
) {
  const now = options.now ?? Date.now();
  const expiresAt = options.expiresAt ?? now + 900_000;
  const issuer = createOwnerMagnificUpscaleOwnedImageBindingIssuer(
    async () => imageResolution(variant, expiresAt), { now: () => now }
  );
  const binding = await issuer.issue({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, opaque_image_handle: `magnific_owned_${variant}_native`
  });
  const candidate = prepareOwnerMagnificUpscaleRequest({
    principal: PRINCIPAL, attempt_id: ATTEMPT, variant, parameters: PARAMETER_STATE, image_binding: binding,
    ...(options.prompt === undefined ? {} : { prompt: options.prompt })
  }, { now: () => now });
  const permit = createOwnerMagnificUpscaleOneShotPermit({
    candidate, principal: PRINCIPAL, attemptId: ATTEMPT, catalog: CATALOG, now: () => now
  });
  return { candidate, permit, issuer, fileUrl: `https://r2.syntx.ai/private/magnific-${variant}?sig=synthetic-owned` };
}

function broker(counter: { calls: number }): SyntxCredentialBroker {
  return {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      counter.calls += 1;
      return operation(CREDENTIAL);
    }
  };
}

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(value), {
    status: init.status ?? 200,
    headers: { "content-type": "application/json", ...Object.fromEntries(new Headers(init.headers).entries()) }
  });
}

function exactExpectedSettings(variant: OwnerMagnificUpscaleVariant, fileUrl: string) {
  return {
    n: 1, model_type: variant, width: 512, height: 512,
    scale_factor: "2x", optimized_for: "standard", engine: "automatic", creativity: 3, hdr: 3,
    resemblance: 3, fractality: 3, sharpen: 30, smart_grain: 30, ultra_detail: 30, flavor: "sublime",
    file_urls: [{ type: "image", url: fileUrl }]
  };
}

test("Magnific generation sends the exact prepared full-state body for all variants and consumes each permit once", async () => {
  for (const [variant, prompt] of [
    ["creative", "A fox under autumn leaves"],
    ["precision_v1", "Precision finish"],
    ["precision_v2", undefined]
  ] as const) {
    const prepared = await prepareCandidate(variant, prompt === undefined ? {} : { prompt });
    const credentialCalls = { calls: 0 };
    let fetchCalls = 0;
    const client = new SyntxChatHttpClient({
      credentialBroker: broker(credentialCalls),
      fetchImpl: async (input, init) => {
        fetchCalls += 1;
        assert.equal(String(input), "https://api.syntx.ai/api/v1/design/generate?ai_name=magnific");
        assert.equal(init?.method, "POST");
        assert.equal(init?.redirect, "error");
        assert.equal(new Headers(init?.headers).get("authorization"), `Bearer ${CREDENTIAL}`);
        assert.equal(new Headers(init?.headers).get("content-type"), "application/json");
        assert.equal(typeof init?.body, "string");
        assert.deepEqual(JSON.parse(init.body as string), {
          chat_uuid: CHAT_UUID,
          ...(prompt === undefined ? {} : { prompt }),
          settings: exactExpectedSettings(variant, prepared.fileUrl)
        });
        return jsonResponse({ id: `magnific-ack-${variant}` });
      }
    });

    const receipt = await client.startMagnificUpscaleWithOwnedCandidate({
      candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
    });
    assert.deepEqual(receipt, { chat_uuid: CHAT_UUID, message_id: `magnific-ack-${variant}` });
    assert.equal(fetchCalls, 1);
    assert.equal(credentialCalls.calls, 1);
    await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
      candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
    }));
    assert.equal(fetchCalls, 1, "a consumed permit cannot issue a second POST");
    prepared.issuer.close();
  }
});

test("copied candidate/permit, foreign principal, wrong attempt, and expired candidate fail before auth", async () => {
  const prepared = await prepareCandidate("creative", { expiresAt: Date.now() + 900_000 });
  const credentialCalls = { calls: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(credentialCalls),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ id: "unexpected" }); }
  });
  const invalidInputs: Array<[Record<string, unknown>, "INVALID_REQUEST" | "PERMIT_INVALID"]> = [
    [{ candidate: { ...prepared.candidate }, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID }, "INVALID_REQUEST"],
    [{ candidate: prepared.candidate, permit: { ...prepared.permit }, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID }, "PERMIT_INVALID"],
    [{ candidate: prepared.candidate, permit: prepared.permit, principal: { ...PRINCIPAL, subject_id: "foreign" }, attemptId: ATTEMPT, chat_uuid: CHAT_UUID }, "INVALID_REQUEST"],
    [{ candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: `${ATTEMPT}-other`, chat_uuid: CHAT_UUID }, "INVALID_REQUEST"]
  ];
  for (const [input, code] of invalidInputs) {
    await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate(input as never), (error: unknown) =>
      code === "PERMIT_INVALID"
        ? error instanceof OwnerMagnificUpscaleOneShotPolicyError && error.code === code
        : error instanceof SyntxHttpError && error.code === code);
  }

  const now = Date.now();
  const expiring = await prepareCandidate("precision_v1", { now, expiresAt: now + 500 });
  const originalDateNow = Date.now;
  try {
    Date.now = () => now + 1_000;
    await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
      candidate: expiring.candidate, permit: expiring.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
    }), (error: unknown) => error instanceof SyntxHttpError && error.code === "INVALID_REQUEST");
  } finally {
    Date.now = originalDateNow;
  }
  assert.equal(fetchCalls, 0);
  assert.equal(credentialCalls.calls, 0);
  prepared.issuer.close();
  expiring.issuer.close();
});

test("unknown ACK and oversized ACK body fail closed without retry or permit reissue", async () => {
  const prepared = await prepareCandidate("precision_v2");
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker({ calls: 0 }),
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ private_ack_text: "must-not-leak" });
    }
  });
  await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR" &&
    !error.message.includes("must-not-leak") && !error.message.includes(prepared.fileUrl));
  assert.equal(fetchCalls, 1);
  await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }));
  assert.equal(fetchCalls, 1);

  const bodyCapPrepared = await prepareCandidate("creative");
  const bodyCapClient = new SyntxChatHttpClient({
    credentialBroker: broker({ calls: 0 }),
    maxResponseBytes: 256,
    fetchImpl: async () => {
      fetchCalls += 1;
      return jsonResponse({ id: "x".repeat(1_024) });
    }
  });
  await assert.rejects(bodyCapClient.startMagnificUpscaleWithOwnedCandidate({
    candidate: bodyCapPrepared.candidate, permit: bodyCapPrepared.permit,
    principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }), (error: unknown) => error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  assert.equal(fetchCalls, 2);
  prepared.issuer.close();
  bodyCapPrepared.issuer.close();
});

test("pre-aborted Magnific generation consumes the one-shot permit but never reaches credentials or fetch", async () => {
  const prepared = await prepareCandidate("precision_v2");
  const credentialCalls = { calls: 0 };
  let fetchCalls = 0;
  const client = new SyntxChatHttpClient({
    credentialBroker: broker(credentialCalls),
    fetchImpl: async () => { fetchCalls += 1; return jsonResponse({ id: "unexpected" }); }
  });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }, controller.signal), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_REQUEST_ABORTED");
  assert.equal(credentialCalls.calls, 0);
  assert.equal(fetchCalls, 0);
  await assert.rejects(client.startMagnificUpscaleWithOwnedCandidate({
    candidate: prepared.candidate, permit: prepared.permit, principal: PRINCIPAL, attemptId: ATTEMPT, chat_uuid: CHAT_UUID
  }));
  assert.equal(fetchCalls, 0);
  prepared.issuer.close();
});
