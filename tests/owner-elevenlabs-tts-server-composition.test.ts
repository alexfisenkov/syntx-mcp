import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../src/catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { AccountStatusService } from "../src/application/account-status.js";
import { ModelAccessService } from "../src/application/model-access.js";
import { OwnerElevenLabsTtsGenerationService } from "../src/application/owner-elevenlabs-tts-generation-service.js";
import { OwnerElevenLabsVoiceReferenceService } from "../src/application/owner-elevenlabs-voice-reference-service.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION } from "../src/application/owner-elevenlabs-generation-parameters.js";
import { createDefaultApplication } from "../src/application/factory.js";
import { createMcpServer, type CreateMcpServerOptions } from "../src/mcp/server.js";

const TOOL_MODULE_URL = new URL("../src/mcp/owner-elevenlabs-tts-tools.js", import.meta.url).href;
const PUBLIC_INDEX_URL = new URL("../src/index.js", import.meta.url).href;
const toolModule = await import(TOOL_MODULE_URL).catch(() => null) as Record<string, unknown> | null;
const publicApi = await import(PUBLIC_INDEX_URL).catch(() => null) as Record<string, unknown> | null;
const EXPECTED_NAMES = [
  "syntx_get_elevenlabs_tts_parameters",
  "syntx_owner_list_elevenlabs_voice_references",
  "syntx_owner_generate_elevenlabs_tts",
  "syntx_owner_reconcile_elevenlabs_tts",
  "syntx_owner_list_elevenlabs_tts_recoveries",
  "syntx_owner_get_elevenlabs_tts_result_page"
] as const;
const BINDING = Object.freeze({ tenant_id: "elevenlabs-mcp-tenant", subject: "elevenlabs-mcp-owner" });
const ATTEMPT = "link_elevenlabs_mcp_owner_0123456789";
const CREDENTIAL = "synthetic-elevenlabs-mcp-credential";
const stores = new Set<InMemoryAuthLinkStore>();

afterEach(() => { for (const store of stores) store.close(); stores.clear(); });

async function genuineServices() {
  let now = 1_810_000_000_000;
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-elevenlabs-mcp", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receiveCredential) {
      await receiveCredential({ scheme: "Bearer", value: CREDENTIAL });
      return { state: "LINKED" };
    }
  };
  const store = new InMemoryAuthLinkStore(() => now);
  stores.add(store);
  const linkService = new PerUserLinkService(provider, store, { now: () => now, defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT });
  const broker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation(CREDENTIAL);
    }
  };
  const voiceClient = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    throw new Error("No native read expected from tools/list.");
  } });
  const voiceReferenceService = new OwnerElevenLabsVoiceReferenceService({ binding: BINDING, linkService,
    resolveClient: () => voiceClient, now: () => now });
  const selectedCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
    OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, `${process.cwd()}/catalog`));
  const createReadClient = () => new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => {
    throw new Error("No account/model reads expected from tools/list.");
  } });
  const generationService = new OwnerElevenLabsTtsGenerationService({
    binding: BINDING,
    linkService,
    catalog: selectedCatalog,
    catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
    voiceReferenceService,
    resolveChatClient: () => new SyntxChatHttpClient({ credentialBroker: broker, fetchImpl: async () => {
      throw new Error("No generation call expected from tools/list.");
    } }),
    createAccountStatusService: () => new AccountStatusService(createReadClient(), () => now),
    createModelAccessService: () => new ModelAccessService(selectedCatalog, createReadClient(), () => now),
    now: () => now
  });
  return { generationService, voiceReferenceService };
}

async function listedNames(server: ReturnType<typeof createMcpServer>): Promise<string[]> {
  const client = new Client({ name: "elevenlabs-owner-tools-list-test", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  try {
    await client.connect(clientTransport as unknown as Transport);
    return (await client.listTools()).tools.map(({ name }) => name);
  } finally { await client.close(); }
}

test("ElevenLabs TTS tool module defines exactly six owner-scoped tool names", () => {
  assert.ok(toolModule, "MISSING_OWNER_ELEVENLABS_TTS_TOOL_MODULE");
  assert.deepEqual(toolModule.OWNER_ELEVENLABS_TTS_TOOL_NAMES, EXPECTED_NAMES);
  assert.equal(typeof toolModule.registerSyntxOwnerElevenLabsTtsTools, "function");
});

test("default MCP server omits all six ElevenLabs TTS owner tools", async () => {
  const names = await listedNames(createMcpServer(createDefaultApplication()));
  assert.equal(EXPECTED_NAMES.some((name) => names.includes(name)), false);
});

test("genuine owner TTS composition registers all six tools and exposes only opaque voice references", async () => {
  const services = await genuineServices();
  try {
    const server = createMcpServer(createDefaultApplication(), {
      ownerElevenLabsTts: services
    });
    const names = await listedNames(server);
    for (const name of EXPECTED_NAMES) assert.equal(names.includes(name), true, `MISSING_${name}`);
    const voiceTool = toolModule!.OWNER_ELEVENLABS_TTS_TOOL_INPUT_SCHEMAS as Record<string, unknown>;
    const serializedSchemas = JSON.stringify(voiceTool);
    assert.equal(serializedSchemas.includes("voice_id"), false);
    assert.equal(serializedSchemas.includes("voice_ref"), true);
  } finally {
    await services.generationService.close();
    await services.voiceReferenceService.close();
  }
});

test("server rejects a forged ElevenLabs TTS composition instead of registering partial tools", () => {
  const forged = {
    ownerElevenLabsTts: { generationService: { generate() {} }, voiceReferenceService: { listVoices() {} } }
  } as unknown as CreateMcpServerOptions;
  assert.throws(() => createMcpServer(createDefaultApplication(), forged));
});

test("ElevenLabs TTS cannot be composed beside durable owner generation", async () => {
  const services = await genuineServices();
  try {
    assert.throws(() => createMcpServer(createDefaultApplication(), {
      ownerElevenLabsTts: services,
      ownerDurableGeneration: {} as never
    }));
  } finally {
    await services.generationService.close();
    await services.voiceReferenceService.close();
  }
});

test("public barrel exports TTS parameter/tool DTOs but no preparer, one-shot, voice-ID, or native handles", async () => {
  assert.ok(publicApi, "PUBLIC_INDEX_IMPORT_FAILED");
  const api = publicApi;
  for (const name of ["getOwnerElevenLabsGenerationParameterProfile", "normalizeOwnerElevenLabsGenerationParameters",
    "OwnerElevenLabsGenerationParametersError", "OWNER_ELEVENLABS_TTS_TOOL_NAMES",
    "SYNTX_OWNER_GENERATE_ELEVENLABS_TTS_TOOL_NAME", "registerSyntxOwnerElevenLabsTtsTools"]) {
    assert.ok(name in api, `MISSING_PUBLIC_TTS_EXPORT_${name}`);
  }
  for (const name of ["OwnerElevenLabsTtsRequestPreparer", "OwnerElevenLabsTtsOneShotPolicy",
    "OwnerElevenLabsVoicePrivateResolution", "OwnerElevenLabsTtsChatContext", "OwnerElevenLabsTtsAudioResultMessageContext"]) {
    assert.equal(name in api, false, `PRIVATE_TTS_EXPORT_LEAK_${name}`);
  }
});
