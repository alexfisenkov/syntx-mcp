import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { refreshSettingsSourceInventory, type SettingsSourceArtifact } from "../src/catalog/settings-source-inventory.js";
import { buildSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import {
  derivePinnedHelperScope,
  derivePinnedHelperScopeFromInventory,
  fetchPinnedHelperBundle,
  verifyPinnedHelperBundle,
  verifyPinnedGenericHelperBundle,
  SettingsV6HelperSourceError,
  type FetchPinnedHelperBundleV6Options,
  type PinnedHelperScopeV6,
  type SettingsV6HelperSourceErrorCode
} from "../tools/settings-ir/v6/pinned-helper-bundle.js";

const BUILD = "1234567890";
const BASE = `https://syntx.ai/assets/${BUILD}/`;
const PREFIX = "/src/components/chat/forms/settings/";
const encoder = new TextEncoder();
const SYNTHETIC_SECRET = "SYNTHETIC_VENDOR_BODY_NEVER_IN_ERRORS";

test("derive validates a synthetic inventory and selects helper pairs without form attribution", async () => {
  const inventory = await makeInventory();
  for (const name of ["video.js", "useLuma.js"] as const) {
    const scope = derivePinnedHelperScope(inventory, name);
    const fixture = makeFixture(name);
    assert.deepEqual(scope, fixture.scope);
    assert.equal(scope.form_id, null);
    assert.equal(scope.role, "DIRECT_SETTINGS_HELPER");
    assert.equal(JSON.stringify(scope).includes(SYNTHETIC_SECRET), false);
    assert.equal(JSON.stringify(scope).includes("sourcesContent"), false);
  }
  const invalid = structuredClone(inventory);
  invalid.summary.source_artifacts += 1;
  assert.throws(() => derivePinnedHelperScope(invalid, "video.js"), isError);
  assert.throws(() => derivePinnedHelperScope(inventory, "alpha.js" as "video.js"), isError);
  const duplicate = structuredClone(inventory);
  duplicate.source_artifacts.push(duplicate.source_artifacts.find((entry) => entry.module_name === "video.js")!);
  assert.throws(() => derivePinnedHelperScope(duplicate, "video.js"), isError);
});

test("generic derive selects an inventory-bound helper such as constants.js and rejects untrusted modules", async () => {
  const inventory = await makeInventory();
  const scope = derivePinnedHelperScopeFromInventory(inventory, "constants.js");
  assert.equal(scope.module_name, "constants.js");
  assert.equal(scope.role, "DIRECT_SETTINGS_HELPER");
  assert.equal(scope.form_id, null);
  const fixture = makeFixture("constants.js");
  const verified = verifyPinnedGenericHelperBundle(scope, fixture.javascript, fixture.mapBytes);
  assert.equal(verified.scope.module_name, "constants.js");
  assert.equal(verified.sources.length, 1);
  for (const name of ["missing.js", "Settings2.js", "alpha.js", "../constants.js", "constants.ts", "", "x.js?bad"])
    assert.throws(() => derivePinnedHelperScopeFromInventory(inventory, name), isError);
  const wrongRole = structuredClone(inventory);
  const artifact = wrongRole.source_artifacts.find((entry) => entry.module_name === "constants.js");
  assert.ok(artifact);
  artifact.role = "PROVIDER_FORM";
  artifact.form_id = "alpha";
  assert.throws(() => derivePinnedHelperScopeFromInventory(wrongRole, "constants.js"), isError);
  const duplicate = structuredClone(inventory);
  duplicate.source_artifacts.push(structuredClone(duplicate.source_artifacts.find((entry) => entry.module_name === "constants.js")!));
  duplicate.summary.source_artifacts += 1;
  assert.throws(() => derivePinnedHelperScopeFromInventory(duplicate, "constants.js"), isError);
});

test("pure verification returns all and only declared settings sources with exact identities", () => {
  for (const name of ["video.js", "useLuma.js"] as const) {
    const fixture = makeFixture(name);
    const before = structuredClone(fixture.scope);
    const verified = verifyPinnedHelperBundle(fixture.scope, fixture.javascript, fixture.mapBytes);
    assert.deepEqual(fixture.scope, before);
    assert.deepEqual(verified.scope, before);
    assert.equal(verified.sources.length, name === "video.js" ? 1 : 2);
    assert.equal(fixture.map.sources.length, 2);
    for (const source of verified.sources) {
      assert.equal(source.content, fixture.map.sourcesContent[source.source_index]);
      assert.equal(source.source_content_sha256, hash(encoder.encode(source.content)));
    }
  }
});

test("legacy, relative and canonical source paths normalize to the same settings identity", () => {
  for (const prefix of ["../../../src/", "src/", "/src/"]) {
    const fixture = makeFixture();
    fixture.map.sources = fixture.map.sources.map((path) => path.replace("/src/", prefix));
    const rebound = rebindMap(fixture);
    assert.equal(verifyPinnedHelperBundle(rebound.scope, fixture.javascript, rebound.bytes).sources.length, 1);
  }
});

test("scope validation refuses unsafe URLs, arbitrary modules, wrong roles, metadata and duplicates", () => {
  const fixture = makeFixture();
  const mutations: ((scope: MutableScope) => void)[] = [
    (scope) => { scope.build.base_url = "https://private.invalid/"; },
    (scope) => { scope.build.id = "12/../../secret"; },
    (scope) => { scope.build.id = "1234567891"; },
    (scope) => { scope.javascript.url += "?cookie=sensitive"; },
    (scope) => { scope.source_map.url = "http://syntx.ai/assets/1234567890/video.js.map"; },
    (scope) => { scope.source_map.url = "https://syntx.ai.evil.invalid/assets/1234567890/video.js.map"; },
    (scope) => { scope.source_map.module_name = "useLuma.js"; },
    (scope) => { scope.javascript.role = "PROVIDER_FORM"; scope.javascript.form_id = "video"; },
    (scope) => { scope.javascript.kind = "SOURCE_MAP_V3"; },
    (scope) => { scope.javascript.source_map = scope.source_map.source_map; },
    (scope) => { scope.javascript.bytes = 1_048_577; },
    (scope) => { scope.javascript.sha256 = "sha256:no"; },
    (scope) => { scope.javascript.content_type = "text/html"; },
    (scope) => { scope.source_map.source_map = null; },
    (scope) => { scope.source_map.source_map!.file = "another.js"; },
    (scope) => { scope.source_map.source_map!.sources_content_count = 1; },
    (scope) => { scope.source_map.source_map!.settings_source_count = 2; },
    (scope) => { scope.source_map.source_map!.settings_sources = []; },
    (scope) => { scope.source_map.source_map!.settings_sources[0]!.source_index = 2; },
    (scope) => { scope.source_map.source_map!.settings_sources[0]!.source_path = "/src/components/other.ts"; },
    (scope) => { scope.source_map.source_map!.settings_sources[0]!.source_path = `${PREFIX}../other.ts`; }
  ];
  for (const mutate of mutations) {
    const scope = structuredClone(fixture.scope);
    mutate(scope);
    assert.throws(() => verifyPinnedHelperBundle(scope, fixture.javascript, fixture.mapBytes), isError);
  }
  assert.throws(() => verifyPinnedHelperBundle({ ...fixture.scope, injected: true } as PinnedHelperScopeV6, fixture.javascript, fixture.mapBytes), isError);
  const luma = makeFixture("useLuma.js");
  for (const sources of [
    [...luma.scope.source_map.source_map!.settings_sources].reverse(),
    Array(2).fill(luma.scope.source_map.source_map!.settings_sources[0])
  ]) {
    const scope = structuredClone(luma.scope);
    scope.source_map.source_map!.settings_sources = sources;
    assert.throws(() => verifyPinnedHelperBundle(scope, luma.javascript, luma.mapBytes), isError);
  }
});

test("exact artifact bytes and hashes reject drift and oversize without decoding vendor errors", () => {
  const fixture = makeFixture();
  for (const [javascript, map] of [
    [encoder.encode("other"), fixture.mapBytes],
    [fixture.javascript, encoder.encode("other")],
    [fixture.javascript.subarray(1), fixture.mapBytes]
  ] as const) assert.throws(() => verifyPinnedHelperBundle(fixture.scope, javascript, map), hasCode("SETTINGS_V6_HELPER_SOURCE_DRIFT"));
  assert.throws(() => verifyPinnedHelperBundle(fixture.scope, new Uint8Array(1_048_577), fixture.mapBytes), isError);
  assert.throws(() => verifyPinnedHelperBundle(fixture.scope, fixture.javascript, new Uint8Array(1_048_577)), isError);
  assert.throws(() => verifyPinnedHelperBundle(fixture.scope, new Uint8Array(), fixture.mapBytes), isError);
});

test("invalid UTF8 in either artifact fails even with rebound hashes", () => {
  const fixture = makeFixture();
  const invalid = new Uint8Array([0xff, 0xfe]);
  const jsScope = structuredClone(fixture.scope);
  jsScope.javascript = rebindArtifact(jsScope.javascript, invalid);
  assert.throws(() => verifyPinnedHelperBundle(jsScope, invalid, fixture.mapBytes), isError);
  const mapScope = structuredClone(fixture.scope);
  mapScope.source_map = rebindArtifact(mapScope.source_map, invalid);
  assert.throws(() => verifyPinnedHelperBundle(mapScope, fixture.javascript, invalid), isError);
});

test("map structure and all selected identities remain verified after rebinding whole-map hash", () => {
  const mutations: ((map: Record<string, unknown>) => void)[] = [
    (map) => { map.version = 2; },
    (map) => { map.file = "wrong.js"; },
    (map) => { map.sourceRoot = "https://untrusted.invalid/"; },
    (map) => { map.sections = []; },
    (map) => { map.names = [3]; },
    (map) => { map.mappings = null; },
    (map) => { map.sourcesContent = [null, "opaque"]; },
    (map) => { (map.sourcesContent as string[])[0] = "CHANGED"; },
    (map) => { (map.sources as string[])[0] = `${PREFIX}data/other.ts`; },
    (map) => { (map.sources as string[]).push(`${PREFIX}extra.ts`); (map.sourcesContent as string[]).push("extra"); },
    (map) => { (map.sources as string[])[1] = `${PREFIX}omitted.ts`; },
    (map) => { map.sources = (map.sources as string[]).slice(1); },
    (map) => { (map.sources as string[])[1] = (map.sources as string[])[0]!; },
    (map) => { (map.sources as string[])[1] = (map.sources as string[])[0]!.replace("/src/", "../../../src/"); },
    (map) => { (map.sources as string[])[0] = `${PREFIX}%2E%2E/other.ts`; },
    (map) => { (map.sources as string[])[0] = `${PREFIX}../other.ts`; },
    (map) => { (map.sources as string[])[0] = `${PREFIX}./data.ts`; },
    (map) => { (map.sources as string[])[0] = `x/components/chat/forms/settings/hidden.ts`; },
    (map) => { (map.sources as string[])[1] = "/src/components/chat/forms/Settings/hidden.ts"; },
    (map) => { (map.sources as string[])[1] = "/src/components/chat/forms/settings-shadow/hidden.ts"; },
    (map) => { (map.sources as string[])[0] = `${PREFIX}data\\bad.ts`; }
  ];
  for (const mutate of mutations) {
    const fixture = makeFixture();
    mutate(fixture.map);
    const rebound = rebindMap(fixture);
    assert.throws(() => verifyPinnedHelperBundle(rebound.scope, fixture.javascript, rebound.bytes), isError);
  }
});

test("exact module-relative map file metadata is accepted, and opaque nonsettings sources are not returned", () => {
  const fixture = makeFixture();
  fixture.map.file = `assets/${BUILD}/video.js`;
  fixture.map.sources[1] = "../../../node_modules/example/index.js";
  fixture.scope.source_map.source_map!.file = fixture.map.file;
  const rebound = rebindMap(fixture);
  assert.equal(verifyPinnedHelperBundle(rebound.scope, fixture.javascript, rebound.bytes).sources.length, 1);
});

test("an unrelated scheme-prefixed map source (containing \"//\") is opaque, not rejected", () => {
  for (const opaque of ["webpack://project-name/./node_modules/example/index.js", "webpack:///webpack/bootstrap"]) {
    const fixture = makeFixture();
    fixture.map.sources[1] = opaque;
    const rebound = rebindMap(fixture);
    assert.equal(verifyPinnedHelperBundle(rebound.scope, fixture.javascript, rebound.bytes).sources.length, 1);
  }
});

test("confirmation, options and scope gates reject before fetch", async () => {
  const fixture = makeFixture();
  let calls = 0;
  const fetchImpl: typeof fetch = async () => { calls += 1; throw new Error(SYNTHETIC_SECRET); };
  for (const options of [undefined, {}, { confirmedSourceFetch: false }, { confirmedSourceFetch: "true" }]) {
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, options as FetchPinnedHelperBundleV6Options), hasCode("SETTINGS_V6_HELPER_SOURCE_FETCH_NOT_CONFIRMED"));
  }
  for (const timeout of [0, -1, NaN, Infinity, 60_001, 1.5]) {
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, { confirmedSourceFetch: true, fetchImpl, absoluteTimeoutMs: timeout }), isError);
  }
  for (const options of [
    { confirmedSourceFetch: true, fetchImpl, retry: true },
    { confirmedSourceFetch: true, fetchImpl, signal: {} },
    { confirmedSourceFetch: true, fetchImpl: false }
  ]) await assert.rejects(fetchPinnedHelperBundle(fixture.scope, options as unknown as FetchPinnedHelperBundleV6Options), isError);
  await assert.rejects(fetchPinnedHelperBundle({ ...fixture.scope, build: { ...fixture.scope.build, base_url: "https://private.invalid/" } }, { confirmedSourceFetch: true, fetchImpl }), isError);
  assert.equal(calls, 0);
});

test("fetch is exactly two sequential credential-free GETs and pins recorded media metadata", async () => {
  const fixture = makeFixture();
  const calls: string[] = [];
  let jsConsumed = false;
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(url);
    assert.equal(init?.method, "GET");
    assert.equal(init?.credentials, "omit");
    assert.equal(init?.redirect, "manual");
    assert.equal(init?.cache, "no-store");
    assert.ok(init?.signal);
    assert.equal(new Headers(init.headers).get("accept-encoding"), "identity");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.equal(new Headers(init.headers).has("cookie"), false);
    if (url === fixture.scope.javascript.url) return response(url, new ReadableStream({
      pull(controller) { jsConsumed = true; controller.enqueue(fixture.javascript); controller.close(); }
    }), "application/javascript; charset=utf-8");
    assert.equal(jsConsumed, true);
    return response(url, fixture.mapBytes, "application/octet-stream");
  };
  const result = await fetchPinnedHelperBundle(fixture.scope, { confirmedSourceFetch: true, fetchImpl });
  assert.deepEqual(calls, [fixture.scope.javascript.url, fixture.scope.source_map.url]);
  assert.equal(result.sources.length, 1);
});

test("scope snapshot does not mutate with caller changes during the first request", async () => {
  const fixture = makeFixture();
  const expectedMapUrl = fixture.scope.source_map.url;
  const calls: string[] = [];
  const result = await fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true,
    fetchImpl: async (input) => {
      const url = String(input);
      calls.push(url);
      if (calls.length === 1) {
        fixture.scope.source_map.url = "https://private.invalid/";
        fixture.scope.source_map.source_map!.settings_sources = [];
        return response(url, fixture.javascript, "application/javascript");
      }
      return response(url, fixture.mapBytes, "application/octet-stream");
    }
  });
  assert.equal(calls[1], expectedMapUrl);
  assert.equal(result.sources.length, 1);
});

test("JS hash mismatch or UTF8 failure prevents the map request and never retries", async () => {
  for (const invalidUtf8 of [false, true]) {
    const fixture = makeFixture();
    const bytes = invalidUtf8 ? new Uint8Array([0xff, 0xfe]) : encoder.encode("drift");
    if (invalidUtf8) fixture.scope.javascript = rebindArtifact(fixture.scope.javascript, bytes);
    let calls = 0;
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
      confirmedSourceFetch: true,
      fetchImpl: async (input) => { calls += 1; return response(String(input), bytes, "application/javascript"); }
    }), isError);
    assert.equal(calls, 1);
  }
});

test("redirect, media, status and declared size failures cancel bodies without following a URL", async () => {
  const fixture = makeFixture();
  for (const variant of ["redirect", "url", "status", "media", "other-js-media", "size", "size-invalid", "missing-media"]) {
    let canceled = false;
    let calls = 0;
    const body = new ReadableStream<Uint8Array>({ cancel() { canceled = true; } });
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
      confirmedSourceFetch: true,
      fetchImpl: async (input) => {
        calls += 1;
        const result = response(variant === "url" ? "https://private.invalid/" : String(input), body,
          variant === "media" ? "text/html" : variant === "other-js-media" ? "text/javascript" : "application/javascript",
          variant === "status" ? 500 : variant === "redirect" ? 302 : 200);
        if (variant === "redirect") result.headers.set("location", "https://private.invalid/");
        if (variant === "size") result.headers.set("content-length", "1048577");
        if (variant === "size-invalid") result.headers.set("content-length", "-1");
        if (variant === "missing-media") result.headers.delete("content-type");
        return result;
      }
    }), isError);
    assert.equal(calls, 1);
    assert.equal(canceled, true);
  }
});

test("stream overflow is capped even when content-length is absent or lies", async () => {
  const fixture = makeFixture();
  for (const declared of [undefined, String(fixture.javascript.byteLength)]) {
    let canceled = false;
    let calls = 0;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array(1_048_577)); },
      cancel() { canceled = true; }
    });
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
      confirmedSourceFetch: true,
      fetchImpl: async (input) => {
        calls += 1;
        const result = response(String(input), body, "application/javascript");
        if (declared) result.headers.set("content-length", declared);
        return result;
      }
    }), isError);
    assert.equal(calls, 1);
    assert.equal(canceled, true);
  }
});

test("whole operation deadline settles fetch implementations that ignore abort", async () => {
  const fixture = makeFixture();
  const start = performance.now();
  await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true, absoluteTimeoutMs: 10,
    fetchImpl: () => new Promise<Response>(() => undefined)
  }), hasCode("SETTINGS_V6_HELPER_SOURCE_TIMEOUT"));
  assert.ok(performance.now() - start < 2_000);
});

test("both one-MiB artifact bodies are accepted at the exact shared two-MiB cap", async () => {
  const fixture = makeFixture();
  const javascript = encoder.encode(new TextDecoder().decode(fixture.javascript).padEnd(1_048_576, " "));
  const mapBytes = encoder.encode(new TextDecoder().decode(fixture.mapBytes).padEnd(1_048_576, " "));
  fixture.scope.javascript = rebindArtifact(fixture.scope.javascript, javascript);
  fixture.scope.source_map = rebindArtifact(fixture.scope.source_map, mapBytes);
  let calls = 0;
  const result = await fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true,
    fetchImpl: async (input) => {
      calls += 1;
      return response(String(input), calls === 1 ? javascript : mapBytes,
        calls === 1 ? "application/javascript" : "application/octet-stream");
    }
  });
  assert.equal(calls, 2);
  assert.equal(result.sources.length, 1);
});

test("deadline settles a stuck body, cancels it, and does not await a stuck cancel", async () => {
  const fixture = makeFixture();
  let canceled = false;
  await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true, absoluteTimeoutMs: 10,
    fetchImpl: async (input) => response(String(input), new ReadableStream<Uint8Array>({
      pull: () => new Promise<void>(() => undefined),
      cancel() { canceled = true; return new Promise<void>(() => undefined); }
    }), "application/javascript")
  }), hasCode("SETTINGS_V6_HELPER_SOURCE_TIMEOUT"));
  assert.equal(canceled, true);
});

test("the second request shares the first deadline rather than receiving a fresh budget", async () => {
  const fixture = makeFixture();
  let calls = 0;
  await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true, absoluteTimeoutMs: 70,
    fetchImpl: async (input) => {
      calls += 1;
      await new Promise((resolve) => setTimeout(resolve, 45));
      return response(String(input), calls === 1 ? fixture.javascript : fixture.mapBytes,
        calls === 1 ? "application/javascript" : "application/octet-stream");
    }
  }), hasCode("SETTINGS_V6_HELPER_SOURCE_TIMEOUT"));
  assert.ok(calls <= 2);
});

test("a late response body is canceled after the already-settled timeout", async () => {
  const fixture = makeFixture();
  let complete: (value: Response) => void = () => undefined;
  const pending = new Promise<Response>((resolve) => { complete = resolve; });
  await assert.rejects(fetchPinnedHelperBundle(fixture.scope, {
    confirmedSourceFetch: true, absoluteTimeoutMs: 10, fetchImpl: () => pending
  }), hasCode("SETTINGS_V6_HELPER_SOURCE_TIMEOUT"));
  let canceled = false;
  complete(response(fixture.scope.javascript.url, new ReadableStream({ cancel() { canceled = true; } }), "application/javascript"));
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(canceled, true);
});

test("caller abort is honored before network and during a noncooperative fetch", async () => {
  const fixture = makeFixture();
  const before = new AbortController();
  before.abort(SYNTHETIC_SECRET);
  let calls = 0;
  const fetchImpl: typeof fetch = () => { calls += 1; return new Promise<Response>(() => undefined); };
  await assert.rejects(fetchPinnedHelperBundle(fixture.scope, { confirmedSourceFetch: true, fetchImpl, signal: before.signal }), hasCode("SETTINGS_V6_HELPER_SOURCE_ABORTED"));
  assert.equal(calls, 0);
  const during = new AbortController();
  const pending = fetchPinnedHelperBundle(fixture.scope, { confirmedSourceFetch: true, fetchImpl, signal: during.signal });
  during.abort(SYNTHETIC_SECRET);
  await assert.rejects(pending, hasCode("SETTINGS_V6_HELPER_SOURCE_ABORTED"));
  assert.equal(calls, 1);
});

test("upstream thrown errors, bodies and caller abort reasons never escape safe errors", async () => {
  const fixture = makeFixture();
  for (const fetchImpl of [
    () => { throw new Error(SYNTHETIC_SECRET); },
    async () => { throw new TypeError(SYNTHETIC_SECRET); },
    async (input: Parameters<typeof fetch>[0]) => response(String(input), encoder.encode(SYNTHETIC_SECRET), "text/html")
  ] as typeof fetch[]) {
    await assert.rejects(fetchPinnedHelperBundle(fixture.scope, { confirmedSourceFetch: true, fetchImpl }), (error: unknown) => {
      assert.ok(error instanceof SettingsV6HelperSourceError);
      assert.equal(JSON.stringify(error).includes(SYNTHETIC_SECRET), false);
      assert.equal(error.message.includes(SYNTHETIC_SECRET), false);
      assert.equal("cause" in error, false);
      return true;
    });
  }
});

type MutableScope = { -readonly [K in keyof PinnedHelperScopeV6]: PinnedHelperScopeV6[K] } & {
  build: { id: string; base_url: string };
};
interface Fixture {
  scope: MutableScope;
  javascript: Uint8Array;
  map: { version: number; file: string; names: string[]; mappings: string; sources: string[]; sourcesContent: string[] };
  mapBytes: Uint8Array;
}
function makeFixture(name: "video.js" | "useLuma.js" | "constants.js" = "video.js"): Fixture {
  const javascript = encoder.encode(`export const synthetic = '${name}';`);
  const paths = name === "video.js"
    ? [`${PREFIX}data/hailuo/constants.js`, "/src/utils/video.js"]
    : name === "useLuma.js"
      ? [`${PREFIX}data/luma-image/payload.ts`, `${PREFIX}composables/useLuma.js`]
      : [`${PREFIX}data/shared/constants.ts`, "/src/utils/constants.js"];
  const map = { version: 3, file: name as string, names: [], mappings: "", sources: paths,
    sourcesContent: paths.map((_, index) => `export const synthetic${index} = '${SYNTHETIC_SECRET}';`) };
  const mapBytes = encoder.encode(JSON.stringify(map));
  const artifact = (kind: "JAVASCRIPT" | "SOURCE_MAP_V3", bytes: Uint8Array): SettingsSourceArtifact => ({
    role: "DIRECT_SETTINGS_HELPER", form_id: null, kind, module_name: name as "video.js" | "useLuma.js",
    url: `${BASE}${name}${kind === "JAVASCRIPT" ? "" : ".map"}`,
    content_type: kind === "JAVASCRIPT" ? "application/javascript" : "application/octet-stream",
    bytes: bytes.byteLength, sha256: hash(bytes),
    source_map: kind === "JAVASCRIPT" ? null : {
      version: 3, file: name, source_count: 2, sources_content_count: 2,
      settings_source_count: name === "video.js" ? 1 : 2,
      settings_sources: paths.flatMap((path, index) => path.startsWith(PREFIX) ? [{
        source_index: index, source_path: path, source_content_sha256: hash(encoder.encode(map.sourcesContent[index]!))
      }] : [])
    }
  });
  return { scope: { role: "DIRECT_SETTINGS_HELPER", form_id: null, module_name: name as "video.js" | "useLuma.js",
    build: { id: BUILD, base_url: BASE }, javascript: artifact("JAVASCRIPT", javascript), source_map: artifact("SOURCE_MAP_V3", mapBytes) },
    javascript, map, mapBytes };
}
function rebindMap(fixture: Fixture): { scope: PinnedHelperScopeV6; bytes: Uint8Array } {
  const bytes = encoder.encode(JSON.stringify(fixture.map));
  return { scope: { ...fixture.scope, source_map: rebindArtifact(fixture.scope.source_map, bytes) }, bytes };
}
function rebindArtifact(artifact: SettingsSourceArtifact, bytes: Uint8Array): SettingsSourceArtifact {
  return { ...artifact, bytes: bytes.byteLength, sha256: hash(bytes) };
}
function response(url: string, body: Uint8Array | ReadableStream<Uint8Array>, media: string, status = 200): Response {
  const result = new Response(body instanceof Uint8Array ? new Uint8Array(body) : body, {
    status, headers: { "content-type": media }
  });
  Object.defineProperty(result, "url", { value: url });
  return result;
}
function hash(bytes: Uint8Array): string { return `sha256:${createHash("sha256").update(bytes).digest("hex")}`; }
function isError(error: unknown): boolean { return error instanceof SettingsV6HelperSourceError; }
function hasCode(code: SettingsV6HelperSourceErrorCode): (error: unknown) => boolean {
  return (error) => error instanceof SettingsV6HelperSourceError && error.code === code;
}
async function makeInventory() {
  const catalog = buildSyntxPublicCatalogSnapshot({
    fetchedAt: "2026-09-04T00:00:00.000Z",
    aiPayload: [{ active: true, description: null, label: "Alpha", scope: "video", value: "alpha" }],
    modelsPayload: [{ active: true, ai_name: "alpha", default: false, description: null,
      features: { files_generation: false, files_processing: false, image_generation: false, image_processing: false, search: false },
      label: "Alpha", settings: null, type: null, value: "alpha-model" }],
    llmModelsPayload: { count: 1, models: [{ ai_name: "alpha", available_subscriptions: [],
      capabilities: { deep_research: false, files: false, images: false, planning: false, streaming: false,
        system_message: false, thinking: false, web_explorer: false },
      context_window: 1, default_max_tokens: 1, description: null, enabled: true, free_from_sub: null,
      icon: null, id: "fixture-llm", is_free: false, label: "Fixture", max_images_count: 0,
      min_subscription: null, performance_level: 1, supported_tools: [] }] }
  });
  const bodies = new Map<string, { bytes: Uint8Array; media: string }>();
  for (const name of ["video.js", "useLuma.js", "constants.js"] as const) {
    const fixture = makeFixture(name);
    bodies.set(fixture.scope.javascript.url, { bytes: fixture.javascript, media: "application/javascript" });
    bodies.set(fixture.scope.source_map.url, { bytes: fixture.mapBytes, media: "application/octet-stream" });
  }
  for (const [name, javascript, path, content] of [
    ["Settings2.js", 'const forms = {"./forms/settings/alpha.vue":()=>import("./alpha.js")};', "/src/components/chat/Settings.vue", "export const registry = true;"],
    ["alpha.js", 'import "./video.js"; import "./useLuma.js"; import "./constants.js";', `${PREFIX}alpha.vue`, "const model = 'alpha-model';"]
  ]) {
    bodies.set(`${BASE}${name}`, { bytes: encoder.encode(javascript!), media: "application/javascript" });
    bodies.set(`${BASE}${name}.map`, { bytes: encoder.encode(JSON.stringify({
      version: 3, file: name, names: [], mappings: "", sources: [path], sourcesContent: [content]
    })), media: "application/octet-stream" });
  }
  return refreshSettingsSourceInventory(catalog, {
    buildId: BUILD, generatedAt: "2026-09-04T00:00:00.000Z",
    fetchImpl: async (input) => {
      const data = bodies.get(String(input));
      assert.ok(data, "Unexpected synthetic fixture URL");
      return response(String(input), data.bytes, data.media);
    }
  });
}
