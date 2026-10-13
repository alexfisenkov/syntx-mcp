import assert from "node:assert/strict";
import { testPrincipal } from "./helpers.js";
import test from "node:test";
import { ApplicationError } from "../src/errors.js";
import { CatalogRepository, loadCatalog } from "../src/catalog/catalog.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import {
  generationAiNameBridgeSchema,
  GenerationAiNameResolver,
  loadGenerationAiNameBridge,
  resolveModalityFromCatalog
} from "../src/catalog/generation-ai-name-bridge.js";
import { SqliteGenerationTransactionStore } from "../src/storage/sqlite-generation-transaction-store.js";
import { SyntxUpstreamAdapter } from "../src/adapter/syntx/upstream-adapter.js";
import type { SyntxGenerationChatClient } from "../src/adapter/syntx/upstream-adapter.js";
import type { MediaGenerationReceipt, RedactedMessageEnvelope, StartImageRequest } from "../src/adapter/syntx/chat-http-client.js";

function makeRepos() {
  return {
    catalog: new CatalogRepository(loadCatalog()),
    discovery: new DiscoveryCatalogRepository()
  };
}

test("resolves every real public-samples model to its real ai_name", () => {
  const { catalog, discovery } = makeRepos();
  const resolver = new GenerationAiNameResolver(catalog, discovery);
  assert.equal(resolver.resolve("nano-banana-pro"), "banana");
  assert.equal(resolver.resolve("veo-omni-flash"), "veo3");
  assert.equal(resolver.resolve("suno"), "suno");
});

test("throws ApplicationError MODEL_NOT_FOUND for an unmapped model_id, not a guess", () => {
  const { catalog, discovery } = makeRepos();
  const resolver = new GenerationAiNameResolver(catalog, discovery);
  assert.throws(() => resolver.resolve("banana2"), (error: unknown) => {
    assert.ok(error instanceof ApplicationError);
    assert.equal(error.code, "MODEL_NOT_FOUND");
    return true;
  });
});

test("naive digit-stripping heuristic would have been wrong — real bridge is not that", () => {
  const { catalog, discovery } = makeRepos();
  const resolver = new GenerationAiNameResolver(catalog, discovery);
  // veo-omni-flash's real ai_name is "veo3", not "veo-omni-flash" with a
  // trailing-digit strip (which would leave it unchanged and wrong).
  assert.notEqual(resolver.resolve("veo-omni-flash"), "veo-omni-flash");
});

test("rejects a bridge with a duplicate model_id entry", () => {
  const source = loadGenerationAiNameBridge();
  const duplicate = structuredClone(source);
  duplicate.entries.push(structuredClone(duplicate.entries[0]!));
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, duplicate),
    /Duplicate model_id/u
  );
});

test("throws on catalog_version drift from the pinned public-samples catalog", () => {
  const source = loadGenerationAiNameBridge();
  const drifted = structuredClone(source);
  drifted.public_samples_catalog_version = "2099-01-01.public-sample.9";
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, drifted),
    /drifted from the public sample catalog version/u
  );
});

test("throws on public-samples content drift even when the version string did not change", () => {
  // REGRESSION (round-2 critic-code/critic-risk): the version string is
  // hand-maintained and would not necessarily change if e.g. an
  // output_modality were edited — content hash pinning catches that.
  const source = loadGenerationAiNameBridge();
  const drifted = structuredClone(source);
  drifted.public_samples_sha256 = `sha256:${"0".repeat(64)}`;
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, drifted),
    /drifted from the public sample catalog content/u
  );
});

test("throws on public catalog source-hash drift (any of ai/llm_models/models)", () => {
  const source = loadGenerationAiNameBridge();
  const { catalog, discovery } = makeRepos();
  for (const key of ["ai", "llm_models", "models"] as const) {
    const drifted = structuredClone(source);
    drifted.public_catalog_source_hashes[key] = `sha256:${"0".repeat(64)}`;
    assert.throws(
      () => new GenerationAiNameResolver(catalog, discovery, drifted),
      /drifted from public catalog source hashes/u
    );
  }
});

test("throws when an entry references a model_id absent from the public-samples catalog", () => {
  const source = loadGenerationAiNameBridge();
  const bogus = structuredClone(source);
  bogus.entries[0]!.model_id = "totally-unknown-model";
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, bogus),
    /references unknown model_id/u
  );
});

test("throws when an entry references an ai_name with no active SYNTX model", () => {
  const source = loadGenerationAiNameBridge();
  const bogus = structuredClone(source);
  bogus.entries[0]!.ai_name = "totally_unknown_family";
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, bogus),
    /no ACTIVE SYNTX model/u
  );
});

test("REGRESSION: a transposed pair (real model_id, real but wrong-family ai_name) is rejected, not resolved silently wrong", () => {
  // round-2 critic-code proved this constructed successfully and resolved
  // silently before the modality cross-check existed: nano-banana-pro
  // (image) mapped to suno (audio) has no modality overlap.
  const source = loadGenerationAiNameBridge();
  const transposed = structuredClone(source);
  const banana = transposed.entries.find((e) => e.model_id === "nano-banana-pro")!;
  banana.ai_name = "suno";
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, transposed),
    /no overlap, likely a transposed or mistaken entry/u
  );
});

test("rejects an ai_name whose only SYNTX models are inactive, even though the name itself is real", () => {
  // "pika" exists in official-public-api.json but (as of this snapshot) has
  // zero active models — a bridge entry pointing at it would pass a bare
  // existence check yet fail at SYNTX after the chat already exists.
  const source = loadGenerationAiNameBridge();
  const bogus = structuredClone(source);
  const suno = bogus.entries.find((e) => e.model_id === "suno")!;
  suno.ai_name = "pika";
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, bogus),
    /no ACTIVE SYNTX model/u
  );
});

test("schema accepts a real hyphenated ai_name (round-2 regression: underscore-only pattern rejected 10 of 49 real families)", () => {
  const source = loadGenerationAiNameBridge();
  const withHyphenatedName = structuredClone(source);
  withHyphenatedName.entries[0]!.ai_name = "stable-diffusion";
  assert.equal(
    generationAiNameBridgeSchema.safeParse(withHyphenatedName).success,
    true
  );
});

test("fails closed when a real public-samples model has no bridge entry at all", () => {
  const source = loadGenerationAiNameBridge();
  const missing = structuredClone(source);
  missing.entries = missing.entries.filter(
    (entry) => entry.model_id !== "suno"
  );
  const { catalog, discovery } = makeRepos();
  assert.throws(
    () => new GenerationAiNameResolver(catalog, discovery, missing),
    /missing an entry for model_id "suno"/u
  );
});

test("loadGenerationAiNameBridge throws for a nonexistent explicit path, not a silent empty result", () => {
  assert.throws(() =>
    loadGenerationAiNameBridge("/nonexistent/path/generation-ai-name-bridge.json")
  );
});

test("resolveModalityFromCatalog reads output_modality for every real public-samples operation", () => {
  const { catalog } = makeRepos();
  assert.equal(
    resolveModalityFromCatalog(catalog, {
      model_id: "nano-banana-pro",
      operation_id: "text-to-image"
    }),
    "image"
  );
  assert.equal(
    resolveModalityFromCatalog(catalog, {
      model_id: "veo-omni-flash",
      operation_id: "text-to-video"
    }),
    "video"
  );
  assert.equal(
    resolveModalityFromCatalog(catalog, {
      model_id: "suno",
      operation_id: "standard-text-to-music"
    }),
    "audio"
  );
});

test("resolveModalityFromCatalog throws, does not guess, for unknown model_id or operation_id", () => {
  const { catalog } = makeRepos();
  assert.throws(
    () =>
      resolveModalityFromCatalog(catalog, {
        model_id: "does-not-exist",
        operation_id: "text-to-image"
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "MODEL_NOT_FOUND");
      return true;
    }
  );
  assert.throws(
    () =>
      resolveModalityFromCatalog(catalog, {
        model_id: "nano-banana-pro",
        operation_id: "does-not-exist"
      }),
    (error: unknown) => {
      assert.ok(error instanceof ApplicationError);
      assert.equal(error.code, "OPERATION_NOT_FOUND");
      return true;
    }
  );
});

// ---------------------------------------------------------------------------
// End-to-end composition: proves resolver.resolve and resolveModalityFromCatalog
// really do plug into SyntxUpstreamAdapterOptions.resolveAiName/resolveModality
// without adaptation (skeptic round-2: type-signature compatibility alone was
// never actually exercised) — using a REAL public-samples model_id/operation_id
// ("nano-banana-pro"/"text-to-image"), not the discovery-space fixture id
// ("banana2") the rest of syntx-upstream-adapter.test.ts intentionally uses.
// ---------------------------------------------------------------------------

class MinimalFakeChatClient implements SyntxGenerationChatClient {
  lastStartImageRequest: StartImageRequest | null = null;

  createChat(): Promise<{ chat_uuid: string }> {
    return Promise.resolve({ chat_uuid: "chat_bridge_e2e_001" });
  }

  startImage(request: StartImageRequest): Promise<MediaGenerationReceipt> {
    this.lastStartImageRequest = request;
    return Promise.resolve({
      chat_uuid: request.chat_uuid,
      message_id: "message_bridge_e2e_001"
    });
  }

  startVideo(): Promise<MediaGenerationReceipt> {
    throw new Error("not used in this test");
  }

  startAudio(): Promise<MediaGenerationReceipt> {
    throw new Error("not used in this test");
  }

  getMessage(): Promise<RedactedMessageEnvelope> {
    throw new Error("not used in this test");
  }

  cancelMessage(): Promise<{ chat_uuid: string; message_id: string; accepted: true }> {
    throw new Error("not used in this test");
  }
}

test("end to end: the real bridge composes into SyntxUpstreamAdapter and the real ai_name reaches the network call", async () => {
  const { catalog, discovery } = makeRepos();
  const resolver = new GenerationAiNameResolver(catalog, discovery);
  const chatClient = new MinimalFakeChatClient();
  const store = new SqliteGenerationTransactionStore(":memory:");
  const adapter = new SyntxUpstreamAdapter({
    transactionStore: store,
    resolveChatClient: () => chatClient,
    resolveAiName: (modelId) => resolver.resolve(modelId),
    resolveModality: (request) => resolveModalityFromCatalog(catalog, request)
  });

  const job = await adapter.startGeneration(
    {
      principal: testPrincipal("tenant_bridge_e2e"),
      idempotency_key: "idem_bridge_e2e_001",
      confirmation_id: "confirmation_bridge_e2e_001",
      approved_max_cost_tokens: 10
    },
    {
      model_id: "nano-banana-pro",
      operation_id: "text-to-image",
      parameters: { prompt: "a red bicycle" },
      catalog_version: catalog.catalog.catalog_version
    }
  );

  assert.equal(chatClient.lastStartImageRequest?.ai_name, "banana");
  // PROVIDER_ACCEPTED maps to "queued" in toJobStatus, not "running".
  assert.equal(job.status, "queued");
});
