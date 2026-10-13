import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthBinding } from "../src/auth/types.js";
import {
  OwnerSoulStyleCatalogHttpClient,
  type OwnerSoulStyleCatalogSnapshot
} from "../src/adapter/syntx/owner-soul-style-catalog-http-client.js";
import { OwnerSoulStyleOptionsService, isRevalidatedOwnerSoulStyleHandle, readOwnerSoulStyleRevalidationProvenance } from "../src/application/owner-soul-style-options-service.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION } from "../src/catalog/selected-discovery-catalog.js";

const BINDING: AuthBinding = Object.freeze({ tenant_id: "tenant_soul_options", subject: "subject_soul_options" });
const ATTEMPT = "link_soul_style_options_test_000001";
const FOREIGN_ATTEMPT = "link_soul_style_options_test_000002";
const TOOL_NAME = "syntx_list_owner_soul_style_options";
const SOURCE_MAPPING_SHA256 = "sha256:a11bcb0b533f7f3f9f1668e5bab290ef5d0ba85410df5b78f18e361db96b9391";

test("a revalidated style result exposes an issuer-bound current-context guard", async () => {
  let now = 1_000;
  let fetches = 0;
  const adapter = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-style-credential");
    } },
    fetchImpl: async (input, init) => {
      fetches += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
      assert.equal(init?.method, "GET");
      return Response.json({ items: [{ style_id: "exact-source-style-id", name: "Source style", image: "https://images.invalid/style.png" }], total: 1 });
    }
  });
  const service = new OwnerSoulStyleOptionsService(serviceOptions(() => adapter, { now: () => now }) as never);
  try {
    const listed = await service.listOptions({ attemptId: ATTEMPT });
    const styleHandle = listed.options[0]!.style_handle;
    now += 299_000;
    const revalidated = await service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle });
    const currentContext = { attemptId: ATTEMPT, styleHandle,
      principal: { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT },
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256 };
    assert.equal(fetches, 2, "one listing GET and one fresh revalidation GET use the actual catalog adapter");
    const guard = Reflect.get(service, "isRevalidatedStyleForContext");
    assert.equal(typeof guard, "function", "a freshness token must be checkable against its issuing service and current context");
    const isCurrent = guard as (value: unknown, context: unknown) => boolean;
    assert.equal(isCurrent.call(service, revalidated, currentContext), true);
    const provenance = readOwnerSoulStyleRevalidationProvenance(service, revalidated, currentContext);
    assert.equal(provenance?.original_expires_at_ms, 301_000, "fresh revalidation must retain the list handle's original expiry");
    assert.equal(provenance?.catalog_version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(provenance?.source_mapping_sha256, SOURCE_MAPPING_SHA256);
    assert.equal(Object.hasOwn(revalidated, "original_expires_at_ms"), false);
    now += 1_001;
    assert.equal(isCurrent.call(service, revalidated, currentContext), false, "revalidation does not extend the original five-minute handle TTL");
    assert.equal(readOwnerSoulStyleRevalidationProvenance(service, revalidated, currentContext), null);
    assert.equal(revalidated.style_id, "exact-source-style-id");
  } finally { await service.close(); }
});

test("revalidated style guard rejects clones, foreign issuers, cache-only resolutions, and revoked or closed handles", async () => {
  const createFixture = () => {
    let now = 10_000;
    const catalogModel = { id: "higgsfield-soul", ai_name: "higgsfield-soul", active: true, modalities: ["image"] };
    let fetches = 0;
    const adapter = new OwnerSoulStyleCatalogHttpClient({
      credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
        return operation("synthetic-style-credential");
      } },
      fetchImpl: async () => {
        fetches += 1;
        return Response.json({ items: [{ style_id: "source-style-only", name: "Example style", image: "https://images.invalid/style.png" }], total: 1 });
      }
    });
    const options = { ...serviceOptions(() => adapter, { now: () => now }), catalog: { getModel: () => catalogModel } };
    const service = new OwnerSoulStyleOptionsService(options as never);
    const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
    return { service, principal, catalogModel, get fetches() { return fetches; }, set now(value: number) { now = value; } };
  };
  const contextFor = (principal: { tenant_id: string; subject_id: string; connection_id: string }, styleHandle: string) => ({
    attemptId: ATTEMPT, styleHandle, principal, catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    source_mapping_sha256: SOURCE_MAPPING_SHA256
  });
  const first = createFixture();
  const second = createFixture();
  try {
    const listed = await first.service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0]!.style_handle;
    const cachedOnly = await first.service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    const revalidated = await first.service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    const context = contextFor(first.principal, handle);
    assert.equal(revalidated.style_handle, handle, "revalidation must not replace the issued handle");
    assert.equal(isRevalidatedOwnerSoulStyleHandle(cachedOnly), false, "cache-only resolve is not fresh provenance");
    assert.equal(first.service.isRevalidatedStyleForContext(cachedOnly, context), false);
    assert.equal(first.service.isRevalidatedStyleForContext({ ...revalidated }, context), false, "a clone cannot carry the private brand");
    assert.equal(second.service.isRevalidatedStyleForContext(revalidated, context), false, "another issuer cannot validate this object");
    assert.equal(first.service.isRevalidatedStyleForContext(revalidated, { ...context, styleHandle: "soul_style_00000000-0000-4000-8000-000000000099" }), false);
    assert.equal(first.service.isRevalidatedStyleForContext(revalidated, { ...context,
      principal: { ...context.principal, subject_id: "foreign-subject" } }), false);
    assert.equal(first.service.isRevalidatedStyleForContext(revalidated, { ...context, catalog_version: "sha256-deadbeef.json" as never }), false);
    assert.equal(first.service.isRevalidatedStyleForContext(revalidated, { ...context, source_mapping_sha256: "sha256-deadbeef" as never }), false);
    const facade = Object.create(OwnerSoulStyleOptionsService.prototype) as OwnerSoulStyleOptionsService;
    assert.equal(OwnerSoulStyleOptionsService.prototype.isRevalidatedStyleForContext.call(facade, revalidated, context), false,
      "the method prototype alone is not an issuer");
    assert.equal(readOwnerSoulStyleRevalidationProvenance(facade, revalidated, context), null);
    assert.equal(first.fetches, 2, "only listOptions and revalidateStyleHandle fetch the real fixed style adapter");

    const refreshed = await first.service.listOptions({ attemptId: ATTEMPT });
    assert.notEqual(refreshed.options[0]!.style_handle, handle);
    assert.equal(first.service.isRevalidatedStyleForContext(revalidated, context), false, "a new style snapshot invalidates its previous epoch");
    const currentHandle = refreshed.options[0]!.style_handle;
    const currentResult = await first.service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: currentHandle });
    const currentContext = contextFor(first.principal, currentHandle);
    assert.equal(first.fetches, 4);

    first.service.invalidateAttempt(ATTEMPT);
    assert.equal(first.service.isRevalidatedStyleForContext(currentResult, currentContext), false, "revoke invalidates provenance synchronously");
    assert.equal(isRevalidatedOwnerSoulStyleHandle(currentResult), false);

    const secondList = await second.service.listOptions({ attemptId: ATTEMPT });
    const secondHandle = secondList.options[0]!.style_handle;
    const secondResult = await second.service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: secondHandle });
    await second.service.close();
    assert.equal(second.service.isRevalidatedStyleForContext(secondResult, contextFor(second.principal, secondHandle)), false,
      "close invalidates provenance synchronously");
  } finally { await first.service.close(); await second.service.close(); }
});

test("current-context guard invalidates original expiry, backwards clock, and selected-catalog drift", async () => {
  const issue = async (fixture: ReturnType<typeof createCurrentContextStyleFixture>) => {
    const listed = await fixture.service.listOptions({ attemptId: ATTEMPT });
    const styleHandle = listed.options[0]!.style_handle;
    const value = await fixture.service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle });
    return { value, context: { attemptId: ATTEMPT, styleHandle, principal: fixture.principal,
      catalog_version: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, source_mapping_sha256: SOURCE_MAPPING_SHA256 } };
  };

  const expired = createCurrentContextStyleFixture();
  try {
    const { value, context } = await issue(expired);
    expired.now = 310_000;
    assert.equal(expired.service.isRevalidatedStyleForContext(value, context), false, "the original 300-second expiry is not renewed by GET");
    assert.equal(isRevalidatedOwnerSoulStyleHandle(value), false);
  } finally { await expired.service.close(); }

  const backwards = createCurrentContextStyleFixture();
  try {
    const { value, context } = await issue(backwards);
    backwards.now = 9_999;
    assert.equal(backwards.service.isRevalidatedStyleForContext(value, context), false, "a backwards clock invalidates the token");
  } finally { await backwards.service.close(); }

  const drifted = createCurrentContextStyleFixture();
  try {
    const { value, context } = await issue(drifted);
    drifted.catalogModel.active = false;
    assert.equal(drifted.service.isRevalidatedStyleForContext(value, context), false, "catalog/model drift fails closed");
  } finally { await drifted.service.close(); }
});

async function loadModule(kind: "service" | "tool"): Promise<Record<string, any> | null> {
  const path = resolve(kind === "service" ? "dist/src/application/owner-soul-style-options-service.js" :
    "dist/src/mcp/owner-soul-style-options-tool.js");
  try { return await import(pathToFileURL(path).href) as Record<string, any>; }
  catch { return null; }
}

function isServiceError(error: unknown, module: Record<string, any>, code: string): boolean {
  return error instanceof module.OwnerSoulStyleOptionsServiceError &&
    typeof error === "object" && error !== null && (error as { code?: unknown }).code === code;
}

function activeAttempt(attemptId: string) {
  return {
    attempt_id: attemptId, authorization_profile: "OBSERVED_OWNER_AUTHORIZED" as const,
    status: "LINKED" as const, expires_at: new Date(1_900_000_000_000).toISOString(), linked: true
  };
}

function serviceOptions(resolveClient: (attemptId: string) => unknown, options: {
  now?: () => number; getStatus?: (attemptId: string) => unknown
} = {}) {
  return {
    binding: BINDING,
    linkService: { async getStatus(_binding: AuthBinding, attemptId: string) {
      return options.getStatus ? options.getStatus(attemptId) : activeAttempt(attemptId);
    } },
    catalog: { getModel(modelId: string) {
      assert.equal(modelId, "higgsfield-soul");
      return { id: modelId, ai_name: modelId, active: true, modalities: ["image"] };
    } },
    catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
    resolveClient,
    ...(options.now ? { now: options.now } : {})
  };
}

function createCurrentContextStyleFixture() {
  let now = 10_000;
  const catalogModel = { id: "higgsfield-soul", ai_name: "higgsfield-soul", active: true, modalities: ["image"] };
  const adapter = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-style-credential");
    } },
    fetchImpl: async () => Response.json({ items: [{ style_id: "source-style-only", name: "Example style", image: "https://images.invalid/style.png" }], total: 1 })
  });
  const service = new OwnerSoulStyleOptionsService({
    ...serviceOptions(() => adapter, { now: () => now }), catalog: { getModel: () => catalogModel }
  } as never);
  const principal = { tenant_id: BINDING.tenant_id, subject_id: BINDING.subject, connection_id: ATTEMPT };
  return { service, principal, catalogModel, set now(value: number) { now = value; } };
}

function styleRecords(prefix: string, count: number) {
  return Array.from({ length: count }, (_, index) => ({
    style_id: `${prefix}-private-id-${index + 1}`,
    name: `Style label ${index + 1}`,
    image: `https://images.invalid/private-${prefix}-${index + 1}.png`
  }));
}

function styleSnapshot(records: readonly { style_id: string; name: string; image: string }[]): OwnerSoulStyleCatalogSnapshot {
  const idLengths = records.map((record) => Buffer.byteLength(record.style_id, "utf8"));
  const nameLengths = records.map((record) => Buffer.byteLength(record.name, "utf8"));
  return {
    records,
    summary: {
      route: "hf/lora/styles", response_bytes: 512, record_count: records.length, total_matches: true,
      unique_ids: true, fields_valid: true, unknown_top_level_key_count: 0, unknown_item_key_count: 0,
      style_id_utf8_bytes: { min: Math.min(...idLengths), max: Math.max(...idLengths) },
      name_utf8_bytes: { min: Math.min(...nameLengths), max: Math.max(...nameLengths) }
    }
  };
}

test("native fixed-route adapter → service → MCP exposes labels and opaque handles only", async () => {
  const [serviceModule, toolModule] = await Promise.all([loadModule("service"), loadModule("tool")]);
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "service must implement the frozen read-only capability contract");
  assert.ok(toolModule?.registerSyntxOwnerSoulStyleOptionsTool, "MCP list tool registration must exist");
  const ids = ["style-token-private-01", "style-token-private-02"];
  const images = ["https://images.invalid/raw-01.png", "https://images.invalid/raw-02.png"];
  let fetches = 0;
  const adapter = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-style-credential-only");
    } },
    fetchImpl: async (input, init) => {
      fetches += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
      assert.equal(init?.method, "GET");
      assert.equal(new URL(String(input)).search, "");
      return new Response(JSON.stringify({ items: ids.map((style_id, index) => ({
        style_id, name: `Private label ${index + 1}`, image: images[index], private_extra: "raw-hidden"
      })), total: 2 }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  let resolveClientAttempts = 0;
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions((attemptId: string) => {
    resolveClientAttempts += 1;
    assert.equal(attemptId, ATTEMPT);
    return adapter;
  }));
  const server = new McpServer({ name: "soul-style-options-source-test", version: "1.0.0" });
  toolModule.registerSyntxOwnerSoulStyleOptionsTool(server, { service });
  const client = new Client({ name: "soul-style-options-source-test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  try {
    const listed = await client.listTools();
    const tool = listed.tools.find(({ name }) => name === TOOL_NAME);
    assert.ok(tool);
    assert.deepEqual(Object.keys(tool.inputSchema.properties ?? {}), ["link_attempt_id"]);
    assert.equal(tool.annotations?.readOnlyHint, true);
    assert.equal(tool.annotations?.destructiveHint, false);
    assert.equal(tool.annotations?.idempotentHint, false);
    const response = await client.callTool({ name: TOOL_NAME, arguments: { link_attempt_id: ATTEMPT } });
    assert.equal(response.isError, undefined);
    const result = response.structuredContent as Record<string, any>;
    assert.equal(result.status, "OPTIONS_ISSUED");
    assert.equal(result.model_id, "higgsfield-soul");
    assert.equal(result.catalog_version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
    assert.equal(result.source_reviewed, true);
    assert.equal(result.source_mapping_sha256, SOURCE_MAPPING_SHA256);
    assert.equal(result.confidence_scope, "owner_authenticated_source_reviewed_style_options");
    assert.equal(result.generation_allowed, false);
    assert.equal(result.expires_in_seconds, 300);
    assert.deepEqual(result.options.map(({ label }: { label: string }) => label), ["Private label 1", "Private label 2"]);
    assert.ok(result.options.every(({ style_handle }: { style_handle: string }) =>
      /^soul_style_[0-9a-f-]{36}$/u.test(style_handle)));
    assert.equal(fetches, 1);
    assert.equal(resolveClientAttempts, 1);
    const serialized = JSON.stringify({ structured: result, text: response.content });
    for (const privateValue of [...ids, ...images, "raw-hidden"]) assert.equal(serialized.includes(privateValue), false);
    assert.equal("style_id" in result.options[0], false);
    assert.equal("image" in result.options[0], false);
  } finally {
    await client.close();
    await server.close();
    await service.close();
  }
});

test("successful same-attempt refresh atomically invalidates prior handles; foreign attempt cannot resolve them", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let read = 0;
  const snapshots = [styleSnapshot(styleRecords("first", 2)), styleSnapshot(styleRecords("second", 1))];
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles() { return snapshots[read++]!; }
  })));
  try {
    const first = await service.listOptions({ attemptId: ATTEMPT });
    const firstHandle = first.options[0].style_handle;
    const firstResolved = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: firstHandle });
    assert.equal(firstResolved.style_id, "first-private-id-1");
    const second = await service.listOptions({ attemptId: ATTEMPT });
    assert.equal(second.options.length, 1);
    await assert.rejects(() => service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: firstHandle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND"));
    await assert.rejects(() => service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: firstHandle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND"));
    await assert.rejects(() => service.resolveStyleHandle({ attemptId: FOREIGN_ATTEMPT, styleHandle: second.options[0].style_handle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND"));
    await assert.rejects(() => service.revalidateStyleHandle({ attemptId: FOREIGN_ATTEMPT, styleHandle: second.options[0].style_handle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND"));
    assert.equal(read, 2);
  } finally { await service.close(); }
});

test("style handles expire after five minutes and revoked attempts cannot list or resolve", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let now = 1_000;
  let statusOverride: ((attemptId: string) => unknown) | undefined;
  let reads = 0;
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles() { reads += 1; return styleSnapshot(styleRecords("expiry", 2)); }
  }), { now: () => now, getStatus: (attemptId) => statusOverride?.(attemptId) ?? activeAttempt(attemptId) }));
  try {
    const result = await service.listOptions({ attemptId: ATTEMPT });
    const handle = result.options[0].style_handle;
    const freshCheckHandle = result.options[1].style_handle;
    now += 300_001;
    await assert.rejects(() => service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_EXPIRED"));
    await assert.rejects(() => service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: freshCheckHandle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_EXPIRED"));
    statusOverride = (attemptId) => ({ ...activeAttempt(attemptId), status: "REVOKED", linked: false });
    await assert.rejects(() => service.listOptions({ attemptId: ATTEMPT }),
      (error: unknown) => isServiceError(error, serviceModule, "PRINCIPAL_NOT_LINKED"));
    assert.equal(reads, 1);
  } finally { await service.close(); }
});

test("revalidation aborts on revoke or close and never exposes upstream labels in errors", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let reads = 0;
  let block = false;
  let started!: () => void;
  let release!: () => void;
  const readStarted = new Promise<void>((resolveStarted) => { started = resolveStarted; });
  const held = new Promise<void>((resolveHeld) => { release = resolveHeld; });
  let statusOverride: ((attemptId: string) => unknown) | undefined;
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles(signal?: AbortSignal) {
      reads += 1;
      if (block) {
        started();
        await new Promise<void>((resolveDone, reject) => {
          const abort = () => reject(Object.assign(new Error("secret style-label upstream error"), { code: "UPSTREAM_REQUEST_ABORTED" }));
          signal?.addEventListener("abort", abort, { once: true });
          held.then(resolveDone);
        });
      }
      return styleSnapshot(styleRecords("abort-private", 1));
    }
  }), { getStatus: (attemptId) => statusOverride?.(attemptId) ?? activeAttempt(attemptId) }));
  try {
    const listed = await service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0].style_handle;
    block = true;
    const pending = service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    await readStarted;
    statusOverride = (attemptId) => ({ ...activeAttempt(attemptId), status: "REVOKED", linked: false });
    service.invalidateAttempt(ATTEMPT);
    await assert.rejects(() => pending,
      (error: unknown) => isServiceError(error, serviceModule, "UPSTREAM_REQUEST_ABORTED") &&
        !String(error).includes("secret style-label upstream error"));
    assert.equal(reads, 2);
  } finally { release(); await service.close(); }

  let closeReads = 0;
  let closeStarted!: () => void;
  const closeReadStarted = new Promise<void>((resolveStarted) => { closeStarted = resolveStarted; });
  const closing = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles(signal?: AbortSignal) {
      closeReads += 1;
      if (closeReads === 2) {
        closeStarted();
        await new Promise<void>((_resolveDone, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { code: "UPSTREAM_REQUEST_ABORTED" })), { once: true });
        });
      }
      return styleSnapshot(styleRecords("close-private", 1));
    }
  })));
  const initial = closing.listOptions({ attemptId: ATTEMPT });
  const firstOptions = await initial;
  const closeHandle = firstOptions.options[0].style_handle;
  const closePending = closing.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: closeHandle });
  await closeReadStarted;
  const closePromise = closing.close();
  await assert.rejects(() => closePending,
    (error: unknown) => isServiceError(error, serviceModule, "UPSTREAM_REQUEST_ABORTED"));
  await closePromise;
});

test("local invalidation aborts an in-flight list and close drains and rejects future work", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  const makeBlockingService = () => {
    let started!: () => void;
    const readStarted = new Promise<void>((resolveStarted) => { started = resolveStarted; });
    let reads = 0;
    const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
      listStyles(signal?: AbortSignal) {
        reads += 1;
        started();
        return new Promise((_, reject) => {
          signal?.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), {
            code: "UPSTREAM_REQUEST_ABORTED"
          })), { once: true });
        });
      }
    })));
    return { service, readStarted, get reads() { return reads; } };
  };

  const invalidated = makeBlockingService();
  const invalidatedOperation = invalidated.service.listOptions({ attemptId: ATTEMPT });
  await invalidated.readStarted;
  invalidated.service.invalidateAttempt(ATTEMPT);
  await assert.rejects(invalidatedOperation, (error: unknown) => isServiceError(error, serviceModule, "UPSTREAM_REQUEST_ABORTED"));
  assert.equal(invalidated.reads, 1);
  await invalidated.service.close();

  const closing = makeBlockingService();
  const closingOperation = closing.service.listOptions({ attemptId: ATTEMPT });
  await closing.readStarted;
  const closePromise = closing.service.close();
  await assert.rejects(closingOperation, (error: unknown) => isServiceError(error, serviceModule, "UPSTREAM_REQUEST_ABORTED"));
  await closePromise;
  await assert.rejects(() => closing.service.listOptions({ attemptId: ATTEMPT }),
    (error: unknown) => isServiceError(error, serviceModule, "SERVICE_CLOSED"));
  assert.equal(closing.reads, 1);
});

test("concurrency is capped at four and global handle count at 512", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let started = 0;
  let release!: () => void;
  const wait = new Promise<void>((resolveWait) => { release = resolveWait; });
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles(signal?: AbortSignal) {
      started += 1;
      await wait;
      if (signal?.aborted) throw Object.assign(new Error("cancelled"), { code: "UPSTREAM_REQUEST_ABORTED" });
      return styleSnapshot(styleRecords(`pending-${started}`, 1));
    }
  })));
  try {
    const pending = [1, 2, 3, 4].map((index) => service.listOptions({ attemptId: `link_soul_options_pending_${index}_1234567890` }));
    while (started < 4) await new Promise((resolveWait) => setTimeout(resolveWait, 0));
    await assert.rejects(() => service.listOptions({ attemptId: "link_soul_options_pending_5_1234567890" }),
      (error: unknown) => isServiceError(error, serviceModule, "SERVICE_BUSY"));
    release();
    await Promise.all(pending);
  } finally { release(); await service.close(); }

  const many = styleSnapshot(styleRecords("wide", 128));
  const global = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({ async listStyles() { return many; } })));
  try {
    for (let owner = 0; owner < 4; owner += 1) {
      await global.listOptions({ attemptId: `link_soul_options_global_${owner}_1234567890` });
    }
    await assert.rejects(() => global.listOptions({ attemptId: "link_soul_options_global_4_1234567890" }),
      (error: unknown) => isServiceError(error, serviceModule, "CAPACITY_EXCEEDED"));
  } finally { await global.close(); }
});

test("invalid source rows and atomic failed refresh do not expose or partially replace options", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let reads = 0;
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles() {
      reads += 1;
      if (reads === 2) throw new Error("raw-style-id-and-image-must-not-leak");
      return styleSnapshot(styleRecords("stable", 1));
    }
  })));
  try {
    const first = await service.listOptions({ attemptId: ATTEMPT });
    const handle = first.options[0].style_handle;
    await assert.rejects(() => service.listOptions({ attemptId: ATTEMPT }),
      (error: unknown) => isServiceError(error, serviceModule, "UPSTREAM_UNAVAILABLE"));
    const stillValid = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    assert.equal(stillValid.style_id, "stable-private-id-1");
    await assert.rejects(() => service.resolveStyleHandle({ attemptId: FOREIGN_ATTEMPT, styleHandle: handle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND") &&
        !String(error).includes("stable-private-id-1"));
  } finally { await service.close(); }
});

test("service rejects invalid plain labels and more than 128 options before issuing handles", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  for (const records of [
    styleRecords("safe", 1).map((record) => ({ ...record, name: "bad\nlabel" })),
    styleRecords("over-limit", 129)
  ]) {
    const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
      async listStyles() { return styleSnapshot(records); }
    })));
    try {
      await assert.rejects(() => service.listOptions({ attemptId: ATTEMPT }),
        (error: unknown) => isServiceError(error, serviceModule, "SOURCE_SNAPSHOT_INVALID"));
    } finally { await service.close(); }
  }
});

test("fresh handle revalidation performs one fixed GET, returns a branded private binding, and preserves the snapshot", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  assert.equal(typeof serviceModule.isRevalidatedOwnerSoulStyleHandle, "function");
  let fetches = 0;
  const ids = ["style-token-private-01"];
  const adapter = new OwnerSoulStyleCatalogHttpClient({
    credentialBroker: { async useCredential<T>(operation: (credential: string) => Promise<T>) {
      return operation("synthetic-style-credential-only");
    } },
    fetchImpl: async (input, init) => {
      fetches += 1;
      assert.equal(String(input), "https://api.syntx.ai/api/v1/hf/lora/styles");
      assert.equal(init?.method, "GET");
      assert.equal(new URL(String(input)).search, "");
      return new Response(JSON.stringify({ items: [{
        style_id: ids[0], name: "Private label", image: "https://images.invalid/private.png"
      }], total: 1 }), { status: 200, headers: { "content-type": "application/json" } });
    }
  });
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => adapter));
  try {
    const listed = await service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0].style_handle;
    const cached = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    assert.equal(cached.style_id, ids[0]);
    assert.equal(fetches, 1, "cache-only lookup must not make another source call");

    const fresh = await service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    assert.equal(fetches, 2, "fresh revalidation must make exactly one source call");
    assert.equal(fresh.style_id, ids[0]);
    assert.equal(fresh.attempt_id, ATTEMPT);
    assert.equal(fresh.fresh_source_snapshot, true);
    assert.equal(serviceModule.isRevalidatedOwnerSoulStyleHandle(fresh), true);
    assert.equal(serviceModule.isRevalidatedOwnerSoulStyleHandle({ ...fresh }), false);

    const stillCached = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    assert.equal(stillCached.style_id, ids[0]);
    assert.equal(fetches, 2, "revalidation must not replace or reissue the handle snapshot");
    const serialized = JSON.stringify(fresh);
    assert.equal(serialized.includes("https://images.invalid/private.png"), false);
    assert.equal(serialized.includes("synthetic-style-credential-only"), false);
  } finally { await service.close(); }
});

test("missing fresh style fails closed without replacing the old opaque handle snapshot", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let reads = 0;
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles() {
      reads += 1;
      return styleSnapshot(styleRecords(reads === 1 ? "present" : "changed", 1));
    }
  })));
  try {
    const listed = await service.listOptions({ attemptId: ATTEMPT });
    const handle = listed.options[0].style_handle;
    await assert.rejects(() => service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: handle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND") &&
        !String(error).includes("present-private-id-1"));
    const cached = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: handle });
    assert.equal(cached.style_id, "present-private-id-1");
    assert.equal(reads, 2);
  } finally { await service.close(); }
});

test("parallel same-attempt list replacement invalidates in-flight revalidation proof", async () => {
  const serviceModule = await loadModule("service");
  assert.ok(serviceModule?.OwnerSoulStyleOptionsService, "style options service must exist");
  let reads = 0;
  let releaseFresh!: () => void;
  let freshStarted!: () => void;
  const started = new Promise<void>((resolveStarted) => { freshStarted = resolveStarted; });
  const held = new Promise<void>((resolveHeld) => { releaseFresh = resolveHeld; });
  const service = new serviceModule.OwnerSoulStyleOptionsService(serviceOptions(() => ({
    async listStyles() {
      reads += 1;
      if (reads === 2) {
        freshStarted();
        await held;
        return styleSnapshot(styleRecords("original", 1));
      }
      return styleSnapshot(styleRecords(reads === 1 ? "original" : "replacement", 1));
    }
  })));
  try {
    const first = await service.listOptions({ attemptId: ATTEMPT });
    const oldHandle = first.options[0].style_handle;
    const revalidation = service.revalidateStyleHandle({ attemptId: ATTEMPT, styleHandle: oldHandle });
    await started;
    const replacement = await service.listOptions({ attemptId: ATTEMPT });
    releaseFresh();
    await assert.rejects(() => revalidation,
      (error: unknown) => isServiceError(error, serviceModule, "SNAPSHOT_SUPERSEDED"));
    await assert.rejects(() => service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: oldHandle }),
      (error: unknown) => isServiceError(error, serviceModule, "OPTION_HANDLE_NOT_FOUND"));
    const current = await service.resolveStyleHandle({ attemptId: ATTEMPT, styleHandle: replacement.options[0].style_handle });
    assert.equal(current.style_id, "replacement-private-id-1");
    assert.equal(reads, 3);
  } finally { releaseFresh(); await service.close(); }
});
