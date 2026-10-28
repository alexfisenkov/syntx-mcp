import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  loadSyntxPublicCatalogSnapshot,
  serializeSyntxPublicCatalogSnapshot,
  SYNTX_PUBLIC_CATALOG_ENDPOINTS
} from "../src/catalog/syntx-public-catalog.js";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  CURRENT_DISCOVERY_READ_VERSION,
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
} from "../src/catalog/selected-discovery-catalog.js";

const scriptUrl = pathToFileURL(join(process.cwd(), "scripts/sync-public-catalog.mjs"));
const { main, fetchPublicJson, assertSourceCheckout } = await import(scriptUrl.href);
const baseline = loadSyntxPublicCatalogSnapshot();
const currentDefault = loadPublicCatalogVersion(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
const currentReadDefault = loadPublicCatalogVersion(CURRENT_DISCOVERY_READ_VERSION);
const endpoints = [SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai, SYNTX_PUBLIC_CATALOG_ENDPOINTS.models, SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models];

test("archive source-checkout guard rejects an installed-layout directory", async (t) => {
  const root = await fixture(t);
  assert.throws(() => assertSourceCheckout(root), /PUBLIC_CATALOG_ARCHIVE_REQUIRES_SOURCE_CHECKOUT/);
  assert.doesNotThrow(() => assertSourceCheckout());
});

test("CLI invoked through a symlink executes and rejects legacy overwrite before I/O", async (t) => {
  const root = await fixture(t);
  const launcher = join(root, "catalog-cli.mjs");
  await symlink(fileURLToPath(scriptUrl), launcher);
  await assert.rejects(promisify(execFile)(process.execPath, [launcher], { timeout: 5000 }), (error: unknown) => {
    const failure = error as Error & { code: number; stdout: string; stderr: string };
    assert.equal(failure.code, 1);
    assert.equal(failure.stdout, "");
    assert.match(failure.stderr, /^Public catalog sync failed: Usage:/);
    return true;
  });
});

test("catalog sync refuses legacy overwrite and malformed flags before I/O", async () => {
  for (const args of [[], ["--archive"], ["--confirm-source-fetch"], ["--archive", "--confirm-source-fetch", "extra"], ["--check", "--version", "../v1/official-public-api.json"]]) {
    let calls = 0;
    await assert.rejects(main(args, { fetchImpl: async () => { calls++; throw new Error("no network"); } }), /Usage:/);
    assert.equal(calls, 0);
  }
});

test("archive CLI creates a selectable snapshot and preserves historical bytes", async (t) => {
  const root = await fixture(t);
  const historicalPath = join(root, "v1/official-public-api.json");
  const before = await readFile(historicalPath);
  const urls: string[] = [];
  const result = await main(["--archive", "--confirm-source-fetch"], {
    catalogDirectory: root,
    now: () => "2026-09-04T12:00:00.000Z",
    fetchImpl: mockCatalog(urls)
  });
  assert.equal(result.status, "created");
  assert.deepEqual(urls, endpoints);
  const archived = loadPublicCatalogVersion(result.version, root);
  assert.equal(archived.fetched_at, "2026-09-04T12:00:00.000Z");
  assert.deepEqual(archived.models, baseline.models);
  assert.deepEqual(await readFile(historicalPath), before);
  const files = await readdir(join(root, "public"));
  assert.deepEqual(files, [result.version]);
  let inspectFetches = 0;
  const inspected = await main(["--inspect", "--version", result.version], { catalogDirectory: root, fetchImpl: async () => { inspectFetches++; throw new Error("offline only"); } });
  assert.equal(inspected.status, "verified-offline");
  assert.equal(inspectFetches, 0);
  const checked = await main(["--check", "--version", result.version], { catalogDirectory: root, fetchImpl: mockCatalog([]) });
  assert.equal(checked.status, "unchanged");
  assert.deepEqual(await readdir(join(root, "public")), files);
});

test("check defaults to historical v1 and drift never writes or suggests overwrite", async (t) => {
  const root = await fixture(t);
  await main(["--check"], { catalogDirectory: root, fetchImpl: mockCatalog([]) });
  const urls: string[] = [];
  const original = mockCatalog(urls);
  await assert.rejects(main(["--check"], { catalogDirectory: root, fetchImpl: async (url: string, init: RequestInit) => {
    if (url !== SYNTX_PUBLIC_CATALOG_ENDPOINTS.models) return original(url, init);
    const models = structuredClone(baseline.models);
    models[0]!.label = "Synthetic changed public model";
    return json(models);
  } }), /drift detected.*Preserve history/);
  assert.deepEqual(await readdir(root), ["v1"]);
  assert.equal(await readFile(join(root, "v1/official-public-api.json"), "utf8"), serializeSyntxPublicCatalogSnapshot(baseline));
});

test("standard check uses current read default while explicit env/version and custom roots keep their selection", async (t) => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  t.after(() => {
    if (previous === undefined) delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    else process.env.SYNTX_PUBLIC_CATALOG_VERSION = previous;
  });
  delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  const defaultUrls: string[] = [];
  const defaultResult = await main(["--check"], { fetchImpl: mockCatalog(defaultUrls, currentReadDefault) });
  assert.equal(defaultResult.status, "unchanged");
  assert.equal(defaultResult.version, CURRENT_DISCOVERY_READ_VERSION);
  assert.deepEqual(defaultUrls, endpoints);

  const timestampOnlyVersion = "sha256-549e361e880a02ff5e61ad42c26049deeeeeb4bcede389b334b0c7a883d4cc9b.json";
  process.env.SYNTX_PUBLIC_CATALOG_VERSION = timestampOnlyVersion;
  const envUrls: string[] = [];
  const envResult = await main(["--check"], { fetchImpl: mockCatalog(envUrls, currentDefault) });
  assert.equal(envResult.version, timestampOnlyVersion);
  assert.deepEqual(envUrls, endpoints);

  const overrideUrls: string[] = [];
  const overrideResult = await main(["--check", "--version", DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION], { fetchImpl: mockCatalog(overrideUrls, currentDefault) });
  assert.equal(overrideResult.version, DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION);
  assert.deepEqual(overrideUrls, endpoints);

  const root = await fixture(t);
  const customUrls: string[] = [];
  const customResult = await main(["--check"], { catalogDirectory: root, fetchImpl: mockCatalog(customUrls) });
  assert.equal(customResult.version, null);
  assert.deepEqual(customUrls, endpoints);
});

test("bad environment-selected version fails before any GET", async (t) => {
  const previous = process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  t.after(() => {
    if (previous === undefined) delete process.env.SYNTX_PUBLIC_CATALOG_VERSION;
    else process.env.SYNTX_PUBLIC_CATALOG_VERSION = previous;
  });
  process.env.SYNTX_PUBLIC_CATALOG_VERSION = `sha256-${"0".repeat(64)}.json`;
  let calls = 0;
  await assert.rejects(main(["--check"], { fetchImpl: async () => { calls += 1; throw new Error("no network"); } }));
  assert.equal(calls, 0);
});

test("failed second GET is not retried and creates no snapshot", async (t) => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(main(["--archive", "--confirm-source-fetch"], { catalogDirectory: root, fetchImpl: async () => {
    calls++;
    if (calls === 2) return new Response("private test marker", { status: 503 });
    return json(baseline.ai);
  } }), /HTTP 503/);
  assert.equal(calls, 2);
  assert.deepEqual(await readdir(root), ["v1"]);
});

test("schema failure is redacted and leaves history unchanged", async (t) => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(main(["--archive", "--confirm-source-fetch"], { catalogDirectory: root, fetchImpl: async () => {
    calls++;
    return json({ invalid: "private schema marker" });
  } }), (error: unknown) => {
    assert.equal((error as Error).message, "Public catalog payload failed the supported snapshot schema.");
    return true;
  });
  assert.equal(calls, 3);
  assert.deepEqual(await readdir(root), ["v1"]);
});

test("missing selected snapshot fails check before network", async (t) => {
  const root = await fixture(t);
  let calls = 0;
  await assert.rejects(main(["--check", "--version", `sha256-${"0".repeat(64)}.json`], { catalogDirectory: root, fetchImpl: async () => { calls++; throw new Error("no network"); } }));
  assert.equal(calls, 0);
});

test("public fetch bounds origin, MIME, UTF-8 and response size", async () => {
  let calls = 0;
  await assert.rejects(fetchPublicJson("https://example.invalid/", async () => { calls++; return json({}); }), /not allowlisted/);
  assert.equal(calls, 0);
  for (const response of [
    new Response("{}", { headers: { "content-type": "application/jsonp" } }),
    new Response(new Uint8Array([0xff]), { headers: { "content-type": "application/json" } }),
    new Response("{}", { headers: { "content-type": "application/json", "content-length": String(5 * 1024 * 1024 + 1) } }),
    new Response("x".repeat(5 * 1024 * 1024 + 1), { headers: { "content-type": "application/json" } }),
    new Response("not json", { headers: { "content-type": "application/json" } })
  ]) {
    await assert.rejects(fetchPublicJson(SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai, async () => response));
  }
});

test("streamed size overflow keeps a controlled diagnostic without body content", async () => {
  const marker = "sensitive-body-marker";
  const response = new Response(marker + "x".repeat(5 * 1024 * 1024), { headers: { "content-type": "application/json" } });
  await assert.rejects(fetchPublicJson(SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai, async () => response), (error: unknown) => {
    assert.match((error as Error).message, /^RESPONSE_TOO_LARGE:/);
    assert.equal((error as Error).message.includes(marker), false);
    return true;
  });
});

async function fixture(t: { after: (fn: () => Promise<void>) => void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "syntx-public-catalog-sync-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "v1"));
  await writeFile(join(root, "v1/official-public-api.json"), serializeSyntxPublicCatalogSnapshot(baseline));
  return root;
}

function mockCatalog(urls: string[], source = baseline) {
  return async (url: string, init: RequestInit) => {
    urls.push(url);
    assert.equal(init.method, "GET");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, "omit");
    assert.equal(new Headers(init.headers).has("authorization"), false);
    assert.ok(init.signal instanceof AbortSignal);
    if (url === SYNTX_PUBLIC_CATALOG_ENDPOINTS.ai) return json(source.ai);
    if (url === SYNTX_PUBLIC_CATALOG_ENDPOINTS.models) return json(source.models);
    if (url === SYNTX_PUBLIC_CATALOG_ENDPOINTS.llm_models) return json({ count: source.llm_models.length, models: source.llm_models });
    throw new Error("Unexpected endpoint");
  };
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json; charset=utf-8" } });
}
