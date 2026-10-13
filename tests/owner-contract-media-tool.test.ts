import assert from "node:assert/strict";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { GenerationContractExecutor } from "../src/adapter/syntx/generation-contract-executor.js";
import { loadGenerationContractRegistry } from "../src/catalog/generation-contract-history.js";
import { loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";
import { createMcpServer } from "../src/mcp/server.js";
import { OwnerContractMediaError, OwnerContractMediaService, type OwnerContractMediaReadClient } from "../src/application/owner-contract-media.js";
import { OwnerContractMediaRecoveryStore } from "../src/application/owner-contract-media-recovery.js";

const REGISTRY_VERSION = "sha256-0a82b91685746f4aeec1b0ba4e24fccdc21532d4e3feac85969e55302b463d45.json";
const MEDIA_TOOL_NAMES = ["syntx_owner_generate_media", "syntx_owner_reconcile_media", "syntx_owner_list_media_recovery"];

async function withClient(server: ReturnType<typeof createMcpServer>, work: (client: Client) => Promise<void>) {
  const client = new Client({ name: "owner-contract-media-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try { await work(client); }
  finally { await client.close(); await server.close(); }
}

function hostDependencies(overrides: Record<string, unknown> = {}) {
  const registry = loadGenerationContractRegistry(REGISTRY_VERSION);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const executor = new GenerationContractExecutor(registry, catalog);
  const defaultOwnerOptions = {
    registry,
    catalog,
    executor,
    service: { generate: async () => ({ model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [] }), reconcile: async () => ({ model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [] }) },
    prepareGeneration: async (_attemptId: string, request: Parameters<typeof executor.prepare>[0]) => executor.prepare(request),
    resolveChatClient: () => ({})
  };
  const { ownerContractMedia: ownerOverrides, ...restOverrides } = overrides;
  const options = {
    generationContractRegistry: registry,
    ...restOverrides,
    ownerContractMedia: { ...defaultOwnerOptions, ...((ownerOverrides ?? {}) as Record<string, unknown>) }
  } as never;
  return { registry, catalog, executor, options };
}

test("contract media owner tools stay absent from the default server", async () => {
  const server = createMcpServer(createDefaultApplication());
  await withClient(server, async (client) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(MEDIA_TOOL_NAMES.every((name) => !names.includes(name)));
  });
});

test("generic owner media recovery list is exact-attempt, bounded, redacted and local-only", async () => {
  const registry = loadGenerationContractRegistry(REGISTRY_VERSION);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const executor = new GenerationContractExecutor(registry, catalog);
  const attemptId = "link_exact_media_attempt_0000001";
  const otherAttempt = "link_other_media_attempt_00000001";
  let now = 1_800_000_000_000;
  const recoveryStore = new OwnerContractMediaRecoveryStore({ now: () => now });
  const contract = {
    model_id: "banana-2.1", operation_id: "generate-image", modality: "image",
    ai_name: "banana", model_type: "banana-2.1", schema_hash: `sha256:${"a".repeat(64)}`,
    status: "live_verified", mime_types: ["image/jpeg"], variant_id: "banana21-image-1k-minimal-square"
  } as const;
  const recoveryIds: string[] = [];
  for (let index = 0; index < 21; index += 1) {
    recoveryIds.push(recoveryStore.create({
      attemptId, chatUuid: `private-chat-${index}`, messageId: null, contract,
      now: now + index
    }).recovery_id);
  }
  const expiredId = recoveryStore.create({
    attemptId, chatUuid: "private-expired-chat", messageId: null, contract, now
  }).recovery_id;
  const v1Recovery = recoveryStore.create({
    attemptId, chatUuid: "private-v1-chat", messageId: null,
    contract: {
      model_id: "banana-2.1", operation_id: "generate-image", modality: "image",
      ai_name: "banana", model_type: "banana-2.1", schema_hash: `sha256:${"c".repeat(64)}`,
      status: "live_verified", mime_types: ["image/jpeg"]
    },
    now: now + 100
  });
  let chatResolvers = 0;
  const service = new OwnerContractMediaService({ recoveryStore, now: () => now });
  const server = createMcpServer(createDefaultApplication(), {
    generationContractRegistry: registry,
    ownerContractMedia: {
      registry, catalog, executor, service,
      prepareGeneration: async (_id: string, request: Parameters<typeof executor.prepare>[0]) => executor.prepare(request),
      resolveChatClient: () => { chatResolvers += 1; throw new Error("list must not resolve a client"); }
    }
  } as never);
  await withClient(server, async (client) => {
    const listed = await client.callTool({
      name: "syntx_owner_list_media_recovery",
      arguments: { link_attempt_id: attemptId, limit: 20 }
    });
    assert.equal(listed.isError, undefined);
    const recoveries = (listed.structuredContent as { recoveries: Record<string, unknown>[] }).recoveries;
    assert.equal(recoveries.length, 20);
    const v2Item = recoveries.find((item) => item.variant_id === "banana21-image-1k-minimal-square");
    assert.ok(v2Item);
    assert.deepEqual(Object.keys(v2Item).sort(), [
      "created_at", "model_id", "operation_id", "recovery_id", "variant_id"
    ]);
    assert.ok(recoveryIds.includes(v2Item.recovery_id as string));
    const v1Item = recoveries.find((item) => item.recovery_id === v1Recovery.recovery_id);
    assert.ok(v1Item);
    assert.equal(Object.hasOwn(v1Item, "variant_id"), false, "V1 records remain backward-compatible without a variant id");
    for (const privateValue of ["private-chat-", "private-expired-chat", "sha256:", "prompt", "settings", "https://"]) {
      assert.equal(JSON.stringify(listed).includes(privateValue), false);
    }

    const foreign = await client.callTool({
      name: "syntx_owner_list_media_recovery",
      arguments: { link_attempt_id: otherAttempt, limit: 20 }
    });
    assert.deepEqual((foreign.structuredContent as { recoveries: unknown[] }).recoveries, []);

    now += 16 * 60 * 1000;
    const expired = await client.callTool({
      name: "syntx_owner_list_media_recovery",
      arguments: { link_attempt_id: attemptId, limit: 20 }
    });
    assert.deepEqual((expired.structuredContent as { recoveries: unknown[] }).recoveries, []);
    assert.equal(recoveryStore.get(expiredId, attemptId), undefined);
    assert.equal(chatResolvers, 0);
  });
});

test("explicit owner composition exposes media tools and read-only schemas from the same pinned registry", async () => {
  const host = hostDependencies();
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    const names = (await client.listTools()).tools.map((tool) => tool.name);
    assert.ok(MEDIA_TOOL_NAMES.every((name) => names.includes(name)));

    const schema = await client.callTool({
      name: "syntx_get_generation_schema",
      arguments: { model_id: "banana-2.1", operation_id: "generate-image" }
    });
    assert.equal((schema.structuredContent as Record<string, unknown>).schema_status, "live_verified");
    const validation = await client.callTool({
      name: "syntx_validate_generation",
      arguments: {
        model_id: "banana-2.1", operation_id: "generate-image",
        parameters: { prompt: "synthetic read-only contract validation", file_urls: [] }
      }
    });
    assert.equal((validation.structuredContent as Record<string, unknown>).validation_status, "VALID");
    assert.equal(JSON.stringify(validation).includes("synthetic read-only contract validation"), false);
  });
});

test("owner media MCP path preflights once before client resolution and forwards only prepared media", async () => {
  const registry = loadGenerationContractRegistry(REGISTRY_VERSION);
  const catalog = loadSelectedDiscoveryCatalog().discoveryCatalog;
  const executor = new GenerationContractExecutor(registry, catalog);
  const order: string[] = [];
  let generatedInput: Record<string, unknown> | null = null;
  const ownerContractMedia = {
    registry,
    catalog,
    executor,
    prepareGeneration: async (attemptId: string, request: Parameters<typeof executor.prepare>[0]) => {
      order.push(`preflight:${attemptId}`);
      return executor.prepare(request);
    },
    resolveChatClient: (attemptId: string) => { order.push(`client:${attemptId}`); return {}; },
    service: {
      async generate(input: Record<string, unknown>) {
        order.push("service.generate");
        generatedInput = input;
        return {
          model_id: "banana-2.1", operation_id: "generate-image", modality: "image",
          artifacts: [{ url: "https://r2.syntx.ai/fake-image.jpg", mime_type: "image/jpeg" }]
        };
      },
      async reconcile() { throw new Error("not called"); }
    }
  };
  const server = createMcpServer(createDefaultApplication(), {
    generationContractRegistry: registry,
    ownerContractMedia
  } as never);
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: "synthetic owner contract image", file_urls: [] }
      }
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(order, [
      "preflight:link_exact_media_attempt_0000001",
      "client:link_exact_media_attempt_0000001",
      "service.generate"
    ]);
    const forwarded = generatedInput as Record<string, unknown>;
    assert.equal(forwarded.attemptId, "link_exact_media_attempt_0000001");
    assert.equal(typeof forwarded.prepared, "object");
    assert.equal("parameters" in forwarded, false, "the service receives no raw caller values");
    assert.equal(JSON.stringify(result).includes("synthetic owner contract image"), false);
    assert.deepEqual((result.structuredContent as Record<string, unknown>).artifacts, [
      { url: "https://r2.syntx.ai/fake-image.jpg", mime_type: "image/jpeg" }
    ]);
  });
});

test("owner generate media prepares the exact request before resolving one linked client", async () => {
  const calls: string[] = [];
  const host = hostDependencies({
    ownerContractMedia: {
      prepareGeneration: async (attemptId: string, request: Parameters<GenerationContractExecutor["prepare"]>[0]) => {
        calls.push(`preflight:${attemptId}`);
        return host.executor.prepare(request);
      },
      resolveChatClient: (attemptId: string) => {
        calls.push(`client:${attemptId}`);
        return {};
      },
      service: {
        async generate(input: { attemptId: string; prepared: { prompt: string; settings: Record<string, unknown>; modality: string } }) {
          calls.push("generate");
          assert.equal(input.attemptId, "link_exact_media_attempt_0000001");
          assert.equal(input.prepared.prompt, "synthetic owner media prompt");
          assert.equal(input.prepared.modality, "image");
          assert.equal(input.prepared.settings.model_type, "banana-2.1");
          assert.equal(input.prepared.settings.image_size, "1K");
          return {
            model_id: "banana-2.1", operation_id: "generate-image", modality: "image",
            artifacts: [{ url: "https://r2.syntx.ai/fake.jpg", mime_type: "image/jpeg" }]
          };
        },
        async reconcile() { throw new Error("not called"); }
      }
    }
  });
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: "synthetic owner media prompt", file_urls: [] }
      }
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, [
      "preflight:link_exact_media_attempt_0000001",
      "client:link_exact_media_attempt_0000001",
      "generate"
    ]);
    assert.equal(JSON.stringify(result).includes("synthetic owner media prompt"), false);
    assert.equal(JSON.stringify(result).includes("fake.jpg"), true);
  });
});

test("owner media rejects references and multi-copy fields before resolving a client", async () => {
  const calls: string[] = [];
  const host = hostDependencies({
    ownerContractMedia: {
      prepareGeneration: async (attemptId: string, request: Parameters<GenerationContractExecutor["prepare"]>[0]) => {
        calls.push(`preflight:${attemptId}`);
        return host.executor.prepare(request);
      },
      resolveChatClient: () => { calls.push("client"); return {}; },
      service: {
        async generate() { calls.push("dispatch"); throw new Error("must not dispatch"); },
        async reconcile() { throw new Error("not called"); }
      }
    }
  });
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    for (const extra of [{ references: ["https://example.invalid/reference.png"] }, { copies: 2 }]) {
      const result = await client.callTool({
        name: "syntx_owner_generate_media",
        arguments: {
          link_attempt_id: "link_exact_media_attempt_0000001",
          model_id: "banana-2.1", operation_id: "generate-image",
          parameters: { prompt: "synthetic forbidden-field fixture", file_urls: [], ...extra }
        }
      });
      assert.equal(result.isError, true);
    }
    assert.deepEqual(calls, [
      "preflight:link_exact_media_attempt_0000001",
      "preflight:link_exact_media_attempt_0000001"
    ]);
  });
});

test("owner reconcile media uses a read-only path without subscription preflight", async () => {
  const calls: string[] = [];
  const host = hostDependencies({
    ownerContractMedia: {
      prepareGeneration: async () => { calls.push("preflight"); throw new Error("reconcile must not preflight"); },
      resolveChatClient: (attemptId: string) => {
        calls.push(`read-client:${attemptId}`);
        return {
          listInProgress: async () => [],
          getMessage: async (chatUuid: string, messageId: string) => ({
            chat_uuid: chatUuid, message_id: messageId, object_type: "text", model_type: "banana-2.1", artifacts: []
          }),
          listMessageCandidates: async (_chatUuid: string, echoId: string) => {
            calls.push(`history:${echoId}`);
            return {
              complete: true as const, page: 1 as const, page_size: 10 as const, total_count: 1,
              total_pages: 1, has_next: false as const, has_previous: false,
              provider_chat_id: "412", messages: [{
                message_id: echoId, provider_chat_id: "412", author_role: "owner" as const, objects: []
              }]
            };
          }
        };
      },
      service: {
        async generate() { throw new Error("not called"); },
        async reconcile(input: { client: OwnerContractMediaReadClient; attemptId: string; recoveryId: string; contract: { model_id: string; operation_id: string } }) {
          calls.push("reconcile");
          assert.equal(input.attemptId, "link_exact_media_attempt_0000001");
          assert.equal(input.recoveryId, "recovery_00000000-0000-4000-8000-000000000001");
          assert.equal(input.contract.model_id, "banana-2.1");
          assert.equal(input.contract.operation_id, "generate-image");
          assert.ok(input.client.listMessageCandidates);
          await input.client.listMessageCandidates!("chat-1", "known-echo");
          return { model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [] };
        }
      }
    }
  });
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: "syntx_owner_reconcile_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        recovery_id: "recovery_00000000-0000-4000-8000-000000000001"
      }
    });
    assert.equal(result.isError, undefined);
    assert.deepEqual(calls, ["read-client:link_exact_media_attempt_0000001", "reconcile", "history:known-echo"]);
  });
});

test("prepared owner tool maps uncertain outcomes to an opaque handle without echoing inputs", async () => {
  const privatePrompt = "never echo this private prompt";
  const privateChat = "private-chat-uuid";
  const host = hostDependencies({
    ownerContractMedia: {
      prepareGeneration: async (_attemptId: string, request: Parameters<GenerationContractExecutor["prepare"]>[0]) => host.executor.prepare(request),
      resolveChatClient: () => ({}),
      service: {
        async generate() { throw new OwnerContractMediaError("OUTCOME_UNKNOWN", "recovery_00000000-0000-4000-8000-000000000099"); },
        async reconcile() { throw new Error(`${privatePrompt} ${privateChat}`); }
      }
    }
  });
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    const result = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1",
        operation_id: "generate-image",
        parameters: { prompt: privatePrompt, file_urls: [] }
      }
    });
    assert.equal(result.isError, true);
    assert.equal(JSON.stringify(result).includes(privatePrompt), false);
    assert.equal(JSON.stringify(result).includes(privateChat), false);
    assert.equal(JSON.stringify(result).includes("OUTCOME_UNKNOWN"), true);
    assert.equal(JSON.stringify(result).includes("recovery_00000000-0000-4000-8000-000000000099"), true);
  });
});

test("invalid service result after generation is OUTCOME_UNKNOWN and never hides behind cleanup-style failure", async () => {
  const host = hostDependencies({
    ownerContractMedia: {
      prepareGeneration: async (_attemptId: string, request: Parameters<GenerationContractExecutor["prepare"]>[0]) => host.executor.prepare(request),
      resolveChatClient: () => ({}),
      service: {
        async generate() {
          return { model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [{ url: "not a URL" }] };
        },
        async reconcile() { return { model_id: "banana-2.1", operation_id: "generate-image", modality: "image", artifacts: [{ url: "not a URL" }] }; }
      }
    }
  });
  const server = createMcpServer(createDefaultApplication(), host.options);
  await withClient(server, async (client) => {
    const generated = await client.callTool({
      name: "syntx_owner_generate_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1", operation_id: "generate-image",
        parameters: { prompt: "synthetic malformed service-result fixture", file_urls: [] }
      }
    });
    assert.equal(generated.isError, true);
    const generatedError = (generated.content as { text: string }[])[0]!.text;
    assert.match(generatedError, /OUTCOME_UNKNOWN/u);
    assert.equal(generatedError.includes("synthetic malformed service-result fixture"), false);
    assert.equal(generatedError.includes("recovery_id"), false, "success already consumed its private handle; do not claim recovery");

    const reconciled = await client.callTool({
      name: "syntx_owner_reconcile_media",
      arguments: {
        link_attempt_id: "link_exact_media_attempt_0000001",
        model_id: "banana-2.1", operation_id: "generate-image",
        recovery_id: "recovery_00000000-0000-4000-8000-000000000099"
      }
    });
    assert.equal(reconciled.isError, true);
    const reconcileError = (reconciled.content as { text: string }[])[0]!.text;
    assert.match(reconcileError, /OUTCOME_UNKNOWN/u);
    assert.match(reconcileError, /recovery_00000000-0000-4000-8000-000000000099/u);
  });
});
