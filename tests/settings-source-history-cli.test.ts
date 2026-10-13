import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { archivePublicCatalogSnapshot } from "../src/catalog/public-catalog-history.js";
import { loadSyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { loadSettingsSourceInventory, SettingsSourceInventoryError } from "../src/catalog/settings-source-inventory.js";

const { main, parseArguments, assertSourceCheckout, createBudgetedSettingsFetch, safeErrorCode } = await import(
  new URL("../../scripts/settings-source-history.mjs", import.meta.url).href
);
const catalog = loadSyntxPublicCatalogSnapshot();
const inventory = loadSettingsSourceInventory();
const versionExample = `sha256-${"a".repeat(64)}.json`;
const buildId = inventory.build.id;
const init = { method: "GET", credentials: "omit", redirect: "manual", signal: new AbortController().signal } as const;
const url = `https://syntx.ai/assets/${buildId}/Settings2.js`;

test("legacy settings sync refuses historical overwrite before network or writes", async () => {
  const launcher = fileURLToPath(new URL("../../scripts/sync-settings-source-inventory.mjs", import.meta.url));
  const historicalPath = fileURLToPath(new URL("../../catalog/runtime/v1/settings-source-inventory.json", import.meta.url));
  const before = await readFile(historicalPath);
  for (const args of [[], ["--build-id", "999999"]]) {
    await assert.rejects(promisify(execFile)(process.execPath, [launcher, ...args], { timeout: 5000 }), (error: unknown) => {
      const failure = error as Error & { code: number; stdout: string; stderr: string };
      assert.equal(failure.code, 1);
      assert.equal(failure.stdout, "");
      assert.match(failure.stderr, /^SETTINGS_HISTORY_OVERWRITE_REFUSED:/);
      return true;
    });
  }
  assert.deepEqual(await readFile(historicalPath), before);
});

test("settings history CLI requires explicit catalog/build/confirmation before I/O", async () => {
  for (const args of [[], ["--archive"], ["--archive", "--public-version", versionExample, "--build-id", buildId], ["--inspect", "--public-version", "../v1/a.json", "--version", versionExample], ["--archive", "--public-version", versionExample, "--build-id", `${buildId}\n`, "--confirm-source-fetch"], ["--inspect", "--public-version", `${versionExample}\n`, "--version", versionExample]]) {
    let calls = 0;
    await assert.rejects(main(args, { fetchImpl: async () => { calls++; throw new Error("no network"); } }), /Usage:/);
    assert.equal(calls, 0);
  }
  assert.equal(parseArguments(archiveArgs(versionExample)).kind, "archive");
});

test("settings history source marker rejects installed layout and symlink", async (t) => {
  const root = await temporary(t);
  assert.throws(() => assertSourceCheckout(root), /REQUIRES_SOURCE_CHECKOUT/);
  await mkdir(join(root, "src/catalog"), { recursive: true });
  await writeFile(join(root, "tsconfig.json"), "{}");
  await symlink(join(root, "tsconfig.json"), join(root, "src/catalog/settings-source-history.ts"));
  assert.throws(() => assertSourceCheckout(root), /REQUIRES_SOURCE_CHECKOUT/);
  assert.doesNotThrow(() => assertSourceCheckout());
});

test("settings history CLI archives validated evidence; inspect is offline and preserves v1", async (t) => {
  const root = await temporary(t);
  await mkdir(join(root, "runtime/v1"), { recursive: true });
  const historyPath = join(root, "runtime/v1/settings-source-inventory.json");
  const text = `${JSON.stringify(inventory)}\n`;
  await writeFile(historyPath, text);
  const publicArchive = await archivePublicCatalogSnapshot(catalog, root);
  let refreshCalls = 0;
  const result = await main(archiveArgs(publicArchive.version), {
    catalogDirectory: root,
    refreshImpl: async (input: unknown, options: Record<string, unknown>) => {
      refreshCalls++;
      assert.deepEqual(input, catalog);
      assert.equal(options.buildId, buildId);
      assert.equal(options.concurrency, 4);
      assert.equal(options.absoluteTimeoutMs, 300_000);
      assert.equal(options.maxJavaScriptBytes, 2 * 1024 * 1024);
      assert.equal(options.maxSourceMapBytes, 16 * 1024 * 1024);
      return inventory;
    }
  });
  assert.equal(refreshCalls, 1);
  assert.equal(result.status, "created");
  let network = 0;
  const checked = await main(["--inspect", "--public-version", publicArchive.version, "--version", result.version], {
    catalogDirectory: root,
    fetchImpl: async () => { network++; throw new Error("offline"); }
  });
  assert.equal(checked.status, "verified-offline");
  assert.equal(network, 0);
  assert.equal(await readFile(historyPath, "utf8"), text);
  assert.deepEqual(await readdir(join(root, "settings")), [result.version]);
});

test("settings history CLI resolves catalog before fetch and refuses wrong build", async (t) => {
  const root = await temporary(t);
  let calls = 0;
  await assert.rejects(main(archiveArgs(versionExample), { catalogDirectory: root, fetchImpl: async () => { calls++; throw new Error("no"); } }));
  assert.equal(calls, 0);
  const publicArchive = await archivePublicCatalogSnapshot(catalog, root);
  await assert.rejects(main(archiveArgs(publicArchive.version), {
    catalogDirectory: root,
    refreshImpl: async () => ({ ...inventory, build: { ...inventory.build, id: "999999" } })
  }), /BUILD_MISMATCH/);
  assert.deepEqual(await readdir(root), ["public"]);
});

test("budgeted fetch preserves actual URL and counts consumed bytes, never raw source", async () => {
  const seen: string[] = [];
  const counted = createBudgetedSettingsFetch(buildId, async (input: string, request: RequestInit) => {
    seen.push(input);
    assert.equal(request.credentials, "omit");
    assert.equal(request.redirect, "manual");
    const response = new Response("example", { headers: { "content-type": "application/javascript" } });
    Object.defineProperty(response, "url", { value: `${url}.different` });
    return response;
  });
  try {
    const response = await counted.fetchImpl(url, init);
    assert.equal(response.url, `${url}.different`);
    assert.equal(await response.text(), "example");
    assert.deepEqual(counted.stats(), { requests: 1, bytes: 7, observations: [{ module: "Settings2.js", status: 200, declared_bytes: null, bytes: 7 }] });
    const copy = counted.stats();
    copy.observations[0].module = "changed";
    assert.equal(counted.stats().observations[0].module, "Settings2.js");
    assert.deepEqual(seen, [url]);
  } finally { counted.close(); }
});

test("budgeted fetch refuses URLs, missing safety options, duplicate and excess requests", async () => {
  let calls = 0;
  const counted = createBudgetedSettingsFetch(buildId, async () => { calls++; return new Response(null, { status: 204 }); }, { maxRequests: 1 });
  try {
    for (const bad of [url + "?q=1", url + "#part", "https://other.example/Settings2.js", `https://syntx.ai/assets/${buildId}/../Settings2.js`, `https://syntx.ai/assets/${buildId}/Settings2.js\n`]) {
      await assert.rejects(counted.fetchImpl(bad, init), /REQUEST_INVALID/);
    }
    await assert.rejects(counted.fetchImpl(url, { ...init, credentials: "include" }), /REQUEST_INVALID/);
    await assert.rejects(counted.fetchImpl(url, { ...init, redirect: "follow" }), /REQUEST_INVALID/);
    await assert.rejects(counted.fetchImpl(url, { ...init, method: "POST" }), /REQUEST_INVALID/);
    await assert.rejects(counted.fetchImpl(url, { ...init, signal: null }), /REQUEST_INVALID/);
    assert.equal(calls, 0);
    await counted.fetchImpl(url, init);
    await assert.rejects(counted.fetchImpl(url, init), /REPEAT_REFUSED/);
    await assert.rejects(counted.fetchImpl(url + ".map", init), /REQUEST_LIMIT/);
    assert.equal(calls, 1);
  } finally { counted.close(); }
  await assert.rejects(counted.fetchImpl(url, init), /FETCH_CLOSED/);
});

test("budgeted fetch global byte limit aborts and late response is cancelled", async () => {
  const counted = createBudgetedSettingsFetch(buildId, async () => new Response("1234"), { maxBytes: 3 });
  const response = await counted.fetchImpl(url, init);
  await assert.rejects(response.text(), /BYTE_LIMIT/);
  await assert.rejects(counted.fetchImpl(url + ".map", init), /FETCH_CLOSED/);
  counted.close();
  let cancelled = false;
  let complete: (value: Response) => void = () => undefined;
  const pending = createBudgetedSettingsFetch(buildId, () => new Promise<Response>((resolve) => { complete = resolve; }));
  const request = pending.fetchImpl(url, init);
  pending.close();
  complete(new Response(new ReadableStream({ cancel() { cancelled = true; } })));
  await assert.rejects(request, /FETCH_CLOSED/);
  assert.equal(cancelled, true);
});

test("budgeted fetch rejects inflated operator bounds and unsafe build IDs", () => {
  for (const limits of [{ maxRequests: 257 }, { maxRequests: 0 }, { maxBytes: Infinity }, { maxBytes: 0 }, { maxBytes: 65 * 1024 * 1024 }]) {
    assert.throws(() => createBudgetedSettingsFetch(buildId, fetch, limits), /BOUNDS_INVALID/);
  }
  assert.throws(() => createBudgetedSettingsFetch("../../"), /BUILD_INVALID/);
});

test("settings history errors retain controlled failure code, not source bodies", () => {
  assert.equal(safeErrorCode(new SettingsSourceInventoryError("SOURCE_TOO_LARGE")), "SOURCE_TOO_LARGE");
  assert.equal(safeErrorCode(new SettingsSourceInventoryError("SOURCE_MAP_INVALID")), "SOURCE_MAP_INVALID");
  assert.equal(safeErrorCode(new Error("do not display private source text")), "SETTINGS_HISTORY_FAILED");
  assert.equal(safeErrorCode({ code: "invented", message: "hidden body" }), "SETTINGS_HISTORY_FAILED");
});

function archiveArgs(version: string) {
  return ["--archive", "--public-version", version, "--build-id", buildId, "--confirm-source-fetch"];
}

async function temporary(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "syntx-settings-history-cli-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
