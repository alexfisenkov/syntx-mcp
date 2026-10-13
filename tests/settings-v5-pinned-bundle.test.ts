import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { sha256CanonicalPayload } from "../src/catalog/syntx-public-catalog.js";
import {
  fetchPinnedRootBundleV5,
  loadRootOnlyScopeV5,
  SettingsV5SourceError,
  verifyPinnedRootBundleV5,
  type FetchPinnedRootBundleV5Options,
  type RootOnlyScopeV5,
  type RootOnlySourceV5
} from "../tools/settings-ir/v5/pinned-root-bundle.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const JS_URL = "https://syntx.ai/assets/1788368942/beeble.js";
const MAP_URL = `${JS_URL}.map`;
const encoder = new TextEncoder();

test("v5 scope derives exact root+aux identities and bindings from canonical local catalogs without fetch", () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("NETWORK_FORBIDDEN"); };
  try {
    const scope = loadRootOnlyScopeV5(ROOT);
    assert.equal(scope.form_id, "beeble");
    assert.deepEqual(scope.model_ids, ["switchx"]);
    assert.equal(scope.source_observed_at, "2026-09-02T21:00:08.402Z");
    assert.equal(scope.javascript.url, JS_URL);
    assert.equal(scope.source_map.url, MAP_URL);
    assert.deepEqual(scope.sources.map((source) => [source.source_index, source.role]), [[0, "AUXILIARY"], [1, "ROOT"]]);
    assert.equal(scope.sources[0]!.source_ref_id, scope.auxiliary_source_ref_ids[0]);
    assert.equal(scope.sources[1]!.source_ref_id, scope.root_source_ref_id);
    assert.deepEqual(scope.bindings.map((binding) => binding.name), ["public_catalog", "inventory", "census"]);
    assert.equal(scope.javascript.bytes, 16_847);
    assert.equal(scope.source_map.bytes, 50_529);
    assert.equal(JSON.stringify(scope).includes("sourcesContent"), false);
  } finally { globalThis.fetch = originalFetch; }
});

test("scope loading rejects other forms, missing files, noncanonical bytes, and broken source relationships", () => {
  assert.throws(() => loadRootOnlyScopeV5(ROOT, "other"), isSourceError);
  withLocalCatalogs((root) => {
    const path = join(root, "catalog/runtime/v1/settings-source-inventory.json");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n`);
    assert.throws(() => loadRootOnlyScopeV5(root), isSourceError);
  });
  withLocalCatalogs((root) => {
    const path = join(root, "catalog/runtime/v2/normalized-settings-parser-census-manifest.json");
    const text = readFileSync(path, "utf8");
    writeFileSync(path, text.replace('"model_ids": [\n        "switchx"\n      ]', '"model_ids": [\n        "other"\n      ]'));
    assert.throws(() => loadRootOnlyScopeV5(root), isSourceError);
  });
  const missing = mkdtempSync(join(tmpdir(), "syntx-v5-missing-"));
  try { assert.throws(() => loadRootOnlyScopeV5(missing), isSourceError); }
  finally { rmSync(missing, { recursive: true, force: true }); }
});

test("pure verifier accepts both sources from the same pinned map without executing or persisting vendor content", () => {
  const fixture = makeFixture();
  const before = structuredClone(fixture.scope);
  const verified = verifyPinnedRootBundleV5(fixture.scope, fixture.javascript, fixture.sourceMap);
  assert.deepEqual(verified.scope, before);
  assert.deepEqual(fixture.scope, before);
  assert.equal(verified.sources.length, 2);
  assert.match(verified.sources[0]!.content, /SYNTHETIC_AUX_ONLY/);
  assert.match(verified.sources[1]!.content, /const AI_NAME = 'beeble'/);
});

test("pure verifier accepts only the legacy/canonical/relative source-path normalization conventions", () => {
  for (const prefix of ["../../../src/", "src/", "/src/"]) {
    const fixture = makeFixture();
    const map = JSON.parse(new TextDecoder().decode(fixture.sourceMap));
    map.sources = fixture.scope.sources.map((source) => source.source_path.replace("/src/", prefix));
    const sourceMap = encoder.encode(JSON.stringify(map));
    const scope = rebind(fixture.scope, fixture.javascript, sourceMap);
    assert.equal(verifyPinnedRootBundleV5(scope, fixture.javascript, sourceMap).sources.length, 2);
  }
});

test("runtime scope validation rejects altered model/ref/role/index/url and silently dropped aux", () => {
  const fixture = makeFixture();
  const changed: unknown[] = [
    { ...fixture.scope, model_ids: ["other"] },
    { ...fixture.scope, auxiliary_source_ref_ids: [] },
    { ...fixture.scope, root_source_ref_id: fixture.scope.auxiliary_source_ref_ids[0] },
    { ...fixture.scope, sources: [...fixture.scope.sources].reverse() },
    { ...fixture.scope, sources: [{ ...fixture.scope.sources[0], role: "ROOT" }, fixture.scope.sources[1]] },
    { ...fixture.scope, sources: [{ ...fixture.scope.sources[0], source_index: 1 }, fixture.scope.sources[1]] },
    { ...fixture.scope, javascript: { ...fixture.scope.javascript, url: "https://syntx.ai/assets/1788368943/beeble.js" } },
    { ...fixture.scope, source_map: { ...fixture.scope.source_map, url: "https://private.invalid/beeble.js.map" } },
    { ...fixture.scope, bindings: [...fixture.scope.bindings].reverse() },
    { ...fixture.scope, raw_source: "FORBIDDEN_EXTRA" }
  ];
  for (const scope of changed) assert.throws(() => verifyPinnedRootBundleV5(scope as RootOnlyScopeV5, fixture.javascript, fixture.sourceMap), isSourceError);
});

test("JS/map raw bytes and hashes must match their exact pinned metadata", () => {
  const fixture = makeFixture();
  const changedJs = fixture.javascript.slice();
  changedJs[0] = changedJs[0]! ^ 1;
  const changedMap = fixture.sourceMap.slice();
  changedMap[0] = changedMap[0]! ^ 1;
  assert.throws(() => verifyPinnedRootBundleV5(fixture.scope, changedJs, fixture.sourceMap), isDrift);
  assert.throws(() => verifyPinnedRootBundleV5(fixture.scope, fixture.javascript, changedMap), isDrift);
  assert.throws(() => verifyPinnedRootBundleV5(fixture.scope, fixture.javascript.subarray(1), fixture.sourceMap), isDrift);
  assert.throws(() => verifyPinnedRootBundleV5(fixture.scope, new Uint8Array(16 * 1024 * 1024 + 1), fixture.sourceMap), isSourceError);
});

test("matching map-body hash does not excuse changed aux content, missing/extra sources or wrong map structure", () => {
  const fixture = makeFixture();
  const mutations: ((map: Record<string, unknown>) => void)[] = [
    (map) => { (map.sourcesContent as string[])[0] = "TAMPERED_AUX"; },
    (map) => { map.sources = (map.sources as string[]).slice(1); map.sourcesContent = (map.sourcesContent as string[]).slice(1); },
    (map) => { (map.sources as string[]).push("../../../src/extra.js"); (map.sourcesContent as string[]).push("extra"); },
    (map) => { map.file = "wrong.js"; },
    (map) => { map.sourceRoot = "https://untrusted.invalid/"; },
    (map) => { map.version = 2; },
    (map) => { map.sourcesContent = [null, "root"]; },
    (map) => { map.names = [4]; },
    (map) => { (map.sources as string[])[0] = "../../../src/components/chat/forms/settings/../beeble.vue"; },
    (map) => { (map.sources as string[])[0] = "%2fsrc/components/chat/forms/settings/beeble.vue"; },
    (map) => { (map.sources as string[])[0] = (map.sources as string[])[1]!; }
  ];
  for (const mutate of mutations) {
    const map = JSON.parse(new TextDecoder().decode(fixture.sourceMap)) as Record<string, unknown>;
    mutate(map);
    const bytes = encoder.encode(JSON.stringify(map));
    const scope = rebind(fixture.scope, fixture.javascript, bytes);
    assert.throws(() => verifyPinnedRootBundleV5(scope, fixture.javascript, bytes), isSourceError);
  }
});

test("raw UTF-8 errors are rejected even when all raw byte hashes are coherent", () => {
  const fixture = makeFixture();
  const invalidBytes = new Uint8Array([0xff, 0xfe]);
  assert.throws(() => verifyPinnedRootBundleV5(rebind(fixture.scope, invalidBytes, fixture.sourceMap), invalidBytes, fixture.sourceMap), isSourceError);
  assert.throws(() => verifyPinnedRootBundleV5(rebind(fixture.scope, fixture.javascript, invalidBytes), fixture.javascript, invalidBytes), isSourceError);
});

test("fetch requires exact confirmation and valid scope/options before any request", async () => {
  const fixture = makeFixture();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error("unexpected request"); };
  for (const options of [undefined, {}, { confirmedSourceFetch: false }, { confirmedSourceFetch: "true" }]) {
    await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, options as FetchPinnedRootBundleV5Options), (error: unknown) => error instanceof SettingsV5SourceError && error.code === "SETTINGS_V5_SOURCE_FETCH_NOT_CONFIRMED");
  }
  for (const timeout of [0, -1, 120_001, NaN]) {
    await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, absoluteTimeoutMs: timeout, fetchImpl }), isSourceError);
  }
  await assert.rejects(fetchPinnedRootBundleV5({ ...fixture.scope, auxiliary_source_ref_ids: [] } as unknown as RootOnlyScopeV5, { confirmedSourceFetch: true, fetchImpl }), isSourceError);
  assert.equal(calls, 0);
});

test("fetch does exactly two sequential credential-free GETs and returns root plus aux", async () => {
  const fixture = makeFixture();
  const calls: string[] = [];
  let javascriptRead = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    assert.equal(new Headers(init.headers).has("authorization"), false);
    if (url === JS_URL) {
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { javascriptRead = true; controller.enqueue(fixture.javascript); controller.close(); }
      });
      return response(url, body, "application/javascript");
    }
    assert.equal(javascriptRead, true);
    return response(url, fixture.sourceMap, "application/octet-stream");
  };
  const verified = await fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, fetchImpl });
  assert.deepEqual(calls, [JS_URL, MAP_URL]);
  assert.equal(verified.sources.length, 2);
});

test("redirect/status/MIME/declared size failures cancel bodies without requesting map", async () => {
  const fixture = makeFixture();
  for (const variant of ["redirect", "url", "mime", "length", "status"]) {
    let calls = 0;
    let cancelled = 0;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      const body = new ReadableStream<Uint8Array>({ cancel() { cancelled += 1; } });
      return response(variant === "url" ? `${JS_URL}?changed` : JS_URL, body,
        variant === "mime" ? "text/html" : "application/javascript",
        variant === "redirect" ? 302 : variant === "status" ? 500 : 200,
        variant === "length" ? { "content-length": String(fixture.javascript.byteLength + 1) } : {});
    };
    await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, fetchImpl }), isSourceError);
    assert.equal(calls, 1);
    assert.equal(cancelled, 1);
  }
});

test("oversize streaming and first-body drift stop before a second GET", async () => {
  const fixture = makeFixture();
  for (const oversized of [true, false]) {
    let calls = 0;
    let cancelled = 0;
    const body = oversized ? new Uint8Array(fixture.javascript.byteLength + 1) : fixture.javascript.slice();
    if (!oversized) body[0] = body[0]! ^ 1;
    const fetchImpl: typeof fetch = async () => {
      calls += 1;
      return response(JS_URL, new ReadableStream<Uint8Array>({
        start(controller) { controller.enqueue(body); if (!oversized) controller.close(); },
        cancel() { cancelled += 1; }
      }), "application/javascript");
    };
    await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, fetchImpl }), isSourceError);
    assert.equal(calls, 1);
    if (oversized) assert.equal(cancelled, 1);
  }
});

test("one absolute deadline covers stalled fetch, late responses, and stalled body reads", async () => {
  const fixture = makeFixture();
  let lateCancelled = 0;
  let observedSignal: AbortSignal | null | undefined;
  const lateFetch: typeof fetch = async (_input, init) => {
    observedSignal = init?.signal;
    await new Promise((resolve) => setTimeout(resolve, 35));
    return response(JS_URL, new ReadableStream<Uint8Array>({ cancel() { lateCancelled += 1; } }), "application/javascript");
  };
  await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, fetchImpl: lateFetch, absoluteTimeoutMs: 5 }), isSourceError);
  assert.equal(observedSignal?.aborted, true);
  await new Promise((resolve) => setTimeout(resolve, 45));
  assert.equal(lateCancelled, 1);
  let readCancelled = 0;
  const stalledBody: typeof fetch = async () => response(JS_URL,
    new ReadableStream<Uint8Array>({ cancel() { readCancelled += 1; } }), "application/javascript");
  await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, { confirmedSourceFetch: true, fetchImpl: stalledBody, absoluteTimeoutMs: 5 }), isSourceError);
  assert.equal(readCancelled, 1);
});

test("external cancellation rejects before fetch or cancels a stalled request without waiting for deadline", async () => {
  const fixture = makeFixture();
  const preAborted = new AbortController();
  preAborted.abort();
  let calls = 0;
  await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, {
    confirmedSourceFetch: true, signal: preAborted.signal,
    fetchImpl: async () => { calls += 1; throw new Error("Must not fetch"); }
  }), isSourceError);
  assert.equal(calls, 0);
  const controller = new AbortController();
  let observedSignal: AbortSignal | null | undefined;
  let deliver!: (result: Response) => void;
  let cancelled = 0;
  const pending = fetchPinnedRootBundleV5(fixture.scope, {
    confirmedSourceFetch: true, signal: controller.signal,
    fetchImpl: async (_url, init) => {
      calls += 1; observedSignal = init?.signal;
      return new Promise<Response>((resolve) => { deliver = resolve; });
    }
  });
  controller.abort();
  await assert.rejects(pending, isSourceError);
  assert.equal(calls, 1);
  assert.equal(observedSignal?.aborted, true);
  deliver(response(JS_URL, new ReadableStream<Uint8Array>({ cancel() { cancelled += 1; } }), "application/javascript"));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cancelled, 1);
});

test("failure messages never include provider bodies, fetch diagnostics, or private paths", async () => {
  const fixture = makeFixture();
  const marker = "PRIVATE_SYNTHETIC_DIAGNOSTIC";
  await assert.rejects(fetchPinnedRootBundleV5(fixture.scope, {
    confirmedSourceFetch: true, fetchImpl: async () => { throw new Error(`${marker} ${ROOT}`); }
  }), (error: unknown) => {
    assert.ok(error instanceof SettingsV5SourceError);
    assert.equal(error.message.includes(marker), false);
    assert.equal(error.message.includes(ROOT), false);
    assert.equal("cause" in error, false);
    return true;
  });
});

function makeFixture(): { scope: RootOnlyScopeV5; javascript: Uint8Array; sourceMap: Uint8Array } {
  const original = loadRootOnlyScopeV5(ROOT);
  const javascript = encoder.encode("export const syntheticBeebleFixture = true;");
  const contents = [
    "<script setup>const auxiliary = 'SYNTHETIC_AUX_ONLY';</script><template><div /></template>",
    "<script setup>const AI_NAME = 'beeble'; const SCOPE = 'VIDEO'; const defaultSettings = {resolution: '720p'};</script><template><div /></template>"
  ];
  const sourceMap = encoder.encode(JSON.stringify({
    version: 3, file: "beeble.js", names: [], mappings: "",
    sources: original.sources.map((source) => source.source_path.replace("/src/", "../../../src/")),
    sourcesContent: contents
  }));
  const scope = rebind({ ...original, sources: original.sources.map((source, index) => ({
    ...source, source_content_sha256: hash(encoder.encode(contents[index]!))
  })) }, javascript, sourceMap);
  return { scope, javascript, sourceMap };
}

function rebind(scope: RootOnlyScopeV5, javascript: Uint8Array, sourceMap: Uint8Array): RootOnlyScopeV5 {
  const pins = {
    ...scope,
    javascript: { ...scope.javascript, bytes: javascript.byteLength, sha256: hash(javascript) },
    source_map: { ...scope.source_map, bytes: sourceMap.byteLength, sha256: hash(sourceMap) }
  };
  const sources = scope.sources.map((source) => ({ ...source, source_ref_id: sourceRefId(pins, source) }));
  return { ...pins, sources, root_source_ref_id: sources[1]!.source_ref_id, auxiliary_source_ref_ids: [sources[0]!.source_ref_id] };
}

function sourceRefId(scope: RootOnlyScopeV5, source: RootOnlySourceV5): string {
  return `settings-source-${sha256CanonicalPayload({
    role: "PROVIDER_FORM", module_name: "beeble.js", form_id: "beeble",
    module_javascript_sha256: scope.javascript.sha256, module_source_map_sha256: scope.source_map.sha256,
    source_index: source.source_index, source_path: source.source_path, source_content_sha256: source.source_content_sha256
  }).slice(7)}`;
}

function hash(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function isSourceError(error: unknown): boolean { return error instanceof SettingsV5SourceError; }
function isDrift(error: unknown): boolean { return error instanceof SettingsV5SourceError && error.code === "SETTINGS_V5_SOURCE_DRIFT"; }

function response(url: string, body: Uint8Array | ReadableStream<Uint8Array>, mime: string, status = 200, headers: Record<string, string> = {}): Response {
  const result = new Response(body as BodyInit, { status, headers: { "content-type": mime, ...headers } });
  Object.defineProperty(result, "url", { value: url });
  return result;
}

function withLocalCatalogs(work: (root: string) => void): void {
  const directory = mkdtempSync(join(tmpdir(), "syntx-v5-scope-test-"));
  try {
    for (const relative of ["catalog/v1/official-public-api.json", "catalog/runtime/v1/settings-source-inventory.json", "catalog/runtime/v2/normalized-settings-parser-census-manifest.json"]) {
      mkdirSync(dirname(join(directory, relative)), { recursive: true });
      cpSync(join(ROOT, relative), join(directory, relative));
    }
    work(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
