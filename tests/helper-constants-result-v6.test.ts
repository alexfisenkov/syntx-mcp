import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { refreshSettingsSourceInventory, serializeSettingsSourceInventory, type SettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { buildSyntxPublicCatalogSnapshot, serializeSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";
import { derivePinnedHelperScope } from "../tools/settings-ir/v6/pinned-helper-bundle.js";
import {
  archiveHelperConstantsResult, HELPER_MODULES, loadHelperConstantsResult,
  serializeHelperConstantsResult, validateHelperConstantsResult, type HelperConstantsResult
} from "../tools/settings-ir/v6/helper-constants-result.js";

const BUILD = "1234567890";
const BASE = `https://syntx.ai/assets/${BUILD}/`;
const PREFIX = "/src/components/chat/forms/settings/";
const encoder = new TextEncoder();

test("a validated result matches derived scope and both version bindings", async () => {
  const { inventory, publicCatalog } = await material();
  const result = validateHelperConstantsResult(makeResult(inventory, publicCatalog), inventory, publicCatalog);
  assert.equal(result.modules.length, 2);
  assert.deepEqual(result.modules[0]!.scope, derivePinnedHelperScope(inventory, "video.js"));
  const text = serializeHelperConstantsResult(result);
  assert.equal(text.endsWith("\n"), true);
  assert.deepEqual(JSON.parse(text), result);
});

test("binding, scope, source and record mismatches are all refused", async () => {
  const { inventory, publicCatalog } = await material();
  const base = makeResult(inventory, publicCatalog);
  for (const mutate of [
    (value: HelperConstantsResult) => { (value as { public_version: string }).public_version = `sha256-${"0".repeat(64)}.json`; },
    (value: HelperConstantsResult) => { (value as { settings_version: string }).settings_version = `sha256-${"0".repeat(64)}.json`; },
    (value: HelperConstantsResult) => { (value as { build_id: string }).build_id = "999999"; },
    (value: HelperConstantsResult) => { (value.modules[0] as { module_name: string }).module_name = "useLuma.js"; },
    (value: HelperConstantsResult) => { (value.modules[0]!.scope as { module_name: string }).module_name = "useLuma.js"; },
    (value: HelperConstantsResult) => { (value.modules[0]!.sources[0] as { source_index: number }).source_index = 5; },
    (value: HelperConstantsResult) => { (value.modules[0]!.sources[0] as { source_path: string }).source_path = "/src/other.ts"; },
    (value: HelperConstantsResult) => { (value.modules[0]!.sources[0] as { source_content_sha256: string }).source_content_sha256 = hash("wrong"); },
    (value: HelperConstantsResult) => {
      const records = value.modules[1]!.sources[1]!.constants.records as unknown[];
      records.push({ scope: "module", name: "duplicate", exported: false, locator: { line: 1, column: 1 }, status: "STATIC_VALUE", value: 1 });
      records.push({ scope: "module", name: "duplicate", exported: false, locator: { line: 1, column: 1 }, status: "STATIC_VALUE", value: 2 });
    },
    (value: HelperConstantsResult) => {
      const records = value.modules[1]!.sources[1]!.constants.records as unknown[];
      records.push({ scope: "unrelatedScope", name: "x", exported: false, locator: { line: 1, column: 1 }, status: "STATIC_VALUE", value: 1 });
    },
    (value: HelperConstantsResult) => {
      const records = value.modules[1]!.sources[0]!.constants.records as unknown[];
      records.push({ scope: "useLumaSettings", name: "x", exported: false, locator: { line: 1, column: 1 }, status: "STATIC_VALUE", value: 1 });
    },
    (value: HelperConstantsResult) => { (value.toolchain.files[0] as { path: string }).path = "../escape.ts"; },
    (value: HelperConstantsResult) => { (value.toolchain.files as unknown[]).push(value.toolchain.files[0]); }
  ]) {
    const mutated = structuredClone(base);
    mutate(mutated);
    assert.throws(() => validateHelperConstantsResult(mutated, inventory, publicCatalog));
  }
});

test("schema rejects prototype pollution, oversize strings and non-finite numbers before persistence", async () => {
  const { inventory, publicCatalog } = await material();
  const base = makeResult(inventory, publicCatalog);
  for (const unsafe of [
    { ...base, extra: true },
    { ...base, modules: [{ ...base.modules[0]!, scope: { ...(base.modules[0]!.scope as object), injected: true } }, base.modules[1]] },
    { ...base, modules: [{ ...base.modules[0]!, scope: JSON.parse(`${JSON.stringify(base.modules[0]!.scope).slice(0, -1)},"__proto__":{"polluted":true}}`) }, base.modules[1]] }
  ]) assert.throws(() => validateHelperConstantsResult(unsafe, inventory, publicCatalog));
  const tooLarge = structuredClone(base);
  (tooLarge.modules[0]!.sources[0]!.constants.records as unknown[]).push({
    scope: "module", name: "big", exported: false, locator: { line: 1, column: 1 },
    status: "STATIC_VALUE", value: "x".repeat(40_000)
  });
  assert.throws(() => validateHelperConstantsResult(tooLarge, inventory, publicCatalog));
  const nonFinite = structuredClone(base);
  (nonFinite.modules[0]!.sources[0]!.constants.records as unknown[]).push({
    scope: "module", name: "inf", exported: false, locator: { line: 1, column: 1 },
    status: "STATIC_VALUE", value: Number.POSITIVE_INFINITY
  });
  assert.throws(() => validateHelperConstantsResult(nonFinite, inventory, publicCatalog));
});

test("archive is create-once, byte-identical on read-back, and rejects a colliding foreign file", async (t) => {
  const root = await temporary(t);
  const { inventory, publicCatalog } = await material();
  const result = validateHelperConstantsResult(makeResult(inventory, publicCatalog), inventory, publicCatalog);
  const first = await archiveHelperConstantsResult(result, inventory, publicCatalog, root);
  assert.equal(first.status, "created");
  const second = await archiveHelperConstantsResult(result, inventory, publicCatalog, root);
  assert.equal(second.status, "existing");
  assert.equal(second.version, first.version);
  assert.deepEqual(await readdir(join(root, "catalog", "runtime", "v6")), [first.version]);
  const reread = await loadHelperConstantsResult(first.version, inventory, publicCatalog, root);
  assert.deepEqual(reread, result);
  await writeFile(join(root, "catalog", "runtime", "v6", first.version), `${JSON.stringify({ ...result, build_id: "999999" })}\n`);
  await assert.rejects(archiveHelperConstantsResult(result, inventory, publicCatalog, root));
});

test("load refuses a wrong-hash filename, truncated content and a missing v6 directory", async (t) => {
  const root = await temporary(t);
  const { inventory, publicCatalog } = await material();
  const result = validateHelperConstantsResult(makeResult(inventory, publicCatalog), inventory, publicCatalog);
  await assert.rejects(loadHelperConstantsResult(`sha256-${"0".repeat(64)}.json`, inventory, publicCatalog, root));
  const archived = await archiveHelperConstantsResult(result, inventory, publicCatalog, root);
  const path = join(root, "catalog", "runtime", "v6", archived.version);
  const bytes = await readFile(path);
  await writeFile(path, bytes.subarray(0, bytes.length - 5));
  await assert.rejects(loadHelperConstantsResult(archived.version, inventory, publicCatalog, root));
});

test("result directory refuses a symlinked catalog/runtime/v6 and a projectRoot that is not a directory", async (t) => {
  const root = await temporary(t);
  const { inventory, publicCatalog } = await material();
  const result = validateHelperConstantsResult(makeResult(inventory, publicCatalog), inventory, publicCatalog);
  await mkdir(join(root, "catalog", "runtime"), { recursive: true });
  await mkdir(join(root, "elsewhere"));
  await symlink(join(root, "elsewhere"), join(root, "catalog", "runtime", "v6"));
  await assert.rejects(archiveHelperConstantsResult(result, inventory, publicCatalog, root));
  await assert.rejects(loadHelperConstantsResult(`sha256-${"0".repeat(64)}.json`, inventory, publicCatalog, join(root, "catalog", "runtime", "v6", "nonexistent-segment")));
});

async function material(): Promise<{ inventory: SettingsSourceInventory; publicCatalog: SyntxPublicCatalogSnapshot }> {
  const publicCatalog = buildSyntxPublicCatalogSnapshot({
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
  for (const name of ["video.js", "useLuma.js"] as const) {
    const paths = name === "video.js"
      ? [`${PREFIX}data/hailuo/constants.js`, "/src/utils/video.js"]
      : [`${PREFIX}data/luma-image/payload.ts`, `${PREFIX}composables/useLuma.js`];
    const javascript = encoder.encode(`export const synthetic = '${name}';`);
    const map = { version: 3, file: name as string, names: [], mappings: "", sources: paths,
      sourcesContent: paths.map((_, index) => `export const synthetic${index} = 'fixture';`) };
    bodies.set(`${BASE}${name}`, { bytes: javascript, media: "application/javascript" });
    bodies.set(`${BASE}${name}.map`, { bytes: encoder.encode(JSON.stringify(map)), media: "application/octet-stream" });
  }
  for (const [name, javascript, path, content] of [
    ["Settings2.js", 'const forms = {"./forms/settings/alpha.vue":()=>import("./alpha.js")};', "/src/components/chat/Settings.vue", "export const registry = true;"],
    ["alpha.js", 'import "./video.js"; import "./useLuma.js";', `${PREFIX}alpha.vue`, "const model = 'alpha-model';"]
  ]) {
    bodies.set(`${BASE}${name}`, { bytes: encoder.encode(javascript!), media: "application/javascript" });
    bodies.set(`${BASE}${name}.map`, { bytes: encoder.encode(JSON.stringify({
      version: 3, file: name, names: [], mappings: "", sources: [path], sourcesContent: [content]
    })), media: "application/octet-stream" });
  }
  const inventory = await refreshSettingsSourceInventory(publicCatalog, {
    buildId: BUILD, generatedAt: "2026-09-04T00:00:00.000Z",
    fetchImpl: async (input) => {
      const data = bodies.get(String(input));
      assert.ok(data, "Unexpected synthetic fixture URL");
      const result = new Response(new Uint8Array(data.bytes), { status: 200, headers: { "content-type": data.media } });
      Object.defineProperty(result, "url", { value: String(input) });
      return result;
    }
  });
  return { inventory, publicCatalog };
}

function makeResult(inventory: SettingsSourceInventory, publicCatalog: SyntxPublicCatalogSnapshot): HelperConstantsResult {
  const modules = HELPER_MODULES.map((name) => {
    const scope = derivePinnedHelperScope(inventory, name);
    const identities = scope.source_map.source_map!.settings_sources;
    return {
      module_name: name, scope,
      sources: identities.map((identity) => ({
        source_index: identity.source_index, source_path: identity.source_path,
        source_content_sha256: identity.source_content_sha256,
        local_function_scopes: "NOT_REQUESTED" as const,
        constants: {
          profile: "STATIC_ESM_CONSTANTS_V1" as const, proof_scope: "DECLARATION_INITIALIZERS_ONLY" as const,
          runtime_usable: false as const, vendor_code_executed: false as const, source_persisted: false as const,
          records: []
        }
      }))
    };
  });
  return {
    schema_version: 1, kind: "HELPER_CONSTANT_INITIALIZERS",
    public_version: `sha256-${hash(serializeSyntxPublicCatalogSnapshot(publicCatalog)).slice(7)}.json`,
    settings_version: `sha256-${hash(serializeSettingsSourceInventory(inventory)).slice(7)}.json`,
    observed_at: "2026-09-04T00:00:00.000Z", build_id: inventory.build.id,
    runtime_usable: false, closure: "OPEN", model_binding: "NOT_PROVEN", root_forms_compiled: false,
    toolchain: { scope: "RECORDED_FILES_ONLY", typescript_version: "5.0.0",
      files: [{ path: "tools/settings-ir/v6/static-esm-constants.ts", sha256: hash("fixture-toolchain-file") }] },
    modules
  } as unknown as HelperConstantsResult;
}

function hash(value: string): string {
  return `sha256:${createHash("sha256").update(Buffer.from(value)).digest("hex")}`;
}

async function temporary(t: { after(fn: () => Promise<void>): void }): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "syntx-helper-constants-result-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
