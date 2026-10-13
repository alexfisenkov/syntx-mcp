import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import { archivePublicCatalogSnapshot } from "../src/catalog/public-catalog-history.js";
import { archiveSettingsSourceInventory } from "../src/catalog/settings-source-history.js";
import { refreshSettingsSourceInventory, type SettingsSourceInventory } from "../src/catalog/settings-source-inventory.js";
import { buildSyntxPublicCatalogSnapshot, type SyntxPublicCatalogSnapshot } from "../src/catalog/syntx-public-catalog.js";

const { main, parseArguments, safeErrorCode } = (await import(
  new URL("../../scripts/settings-helper-constants.mjs", import.meta.url).href
)) as {
  main(args: string[], options: Record<string, unknown>): Promise<Record<string, unknown>>;
  parseArguments(args: string[]): unknown;
  safeErrorCode(error: unknown): string;
};

const REAL_ROOT = fileURLToPath(new URL("../../", import.meta.url));
const BUILD = "1234567890";
const BASE = `https://syntx.ai/assets/${BUILD}/`;
const PREFIX = "/src/components/chat/forms/settings/";
const encoder = new TextEncoder();
const CONFIRM = "--confirm-source-fetch";

test("CLI usage grammar refuses every malformed form before any network call", async () => {
  const versionExample = `sha256-${"a".repeat(64)}.json`;
  const forms = [
    [], ["--archive"], ["--archive", "--public-version", versionExample],
    ["--archive", "--public-version", versionExample, "--settings-version", versionExample],
    ["--probe", "--public-version", versionExample, "--settings-version", versionExample, "--confirm-source-fetch", "extra"],
    ["--archive", "--public-version", `${versionExample}\n`, "--settings-version", versionExample, CONFIRM],
    ["--inspect", "--public-version", versionExample, "--settings-version", versionExample],
    ["--inspect", "--public-version", versionExample, "--settings-version", versionExample, "--version", "not-a-hash.json"],
    ["--sync", "--public-version", versionExample, "--settings-version", versionExample, CONFIRM]
  ];
  for (const args of forms) {
    let calls = 0;
    await assert.rejects(main(args, { fetchImpl: async () => { calls++; throw new Error("no network"); } }), /Usage:/);
    assert.equal(calls, 0);
  }
  const parsed = parseArguments(["--probe", "--public-version", versionExample, "--settings-version", versionExample, CONFIRM]) as { mode: string };
  assert.equal(parsed.mode, "probe");
});

test("safe error codes prefix the static compiler, pass through USAGE and known HELPER_ codes, and hide the rest", async () => {
  const staticModule = (await import(pathToFileURL(join(REAL_ROOT, "dist/tools/settings-ir/v6/static-esm-constants.js")).href)) as {
    StaticEsmConstantsError: new (code: string) => Error;
  };
  assert.equal(safeErrorCode(new staticModule.StaticEsmConstantsError("SOURCE_LIMIT")), "STATIC_ESM_SOURCE_LIMIT");
  assert.equal(safeErrorCode(new Error("HELPER_RESULT_ALREADY_EXISTS")), "HELPER_RESULT_ALREADY_EXISTS");
  assert.match(safeErrorCode(new Error("bogus but not a real code")), /^HELPER_CLI_FAILED$/);
  assert.equal(safeErrorCode({ message: "not an Error instance" }), "HELPER_CLI_FAILED");
});

test("probe is read-only end to end, archive is create-once before network, inspect stays offline", async (t) => {
  const scene = await setupScene(t, { composable: "function" });
  const probed = await main(scene.args("--probe"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl });
  assert.equal(probed.status, "probed");
  assert.equal(scene.calls(), 4);
  await assert.rejects(readdir(join(scene.root, "catalog", "runtime", "v6")), { code: "ENOENT" });

  scene.resetCalls();
  const archived = await main(scene.args("--archive"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl });
  assert.equal(archived.status, "created");
  assert.equal(scene.calls(), 4);
  const files = await readdir(join(scene.root, "catalog", "runtime", "v6"));
  assert.equal(files.length, 1);

  scene.resetCalls();
  await assert.rejects(main(scene.args("--archive"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl }), /HELPER_RESULT_ALREADY_EXISTS/);
  assert.equal(scene.calls(), 0, "the exists-gate must refuse before any network spend");
  assert.deepEqual(await readdir(join(scene.root, "catalog", "runtime", "v6")), files);

  const inspected = await main(
    ["--inspect", "--public-version", scene.publicVersion, "--settings-version", scene.settingsVersion, "--version", files[0]!],
    { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: async () => { throw new Error("offline: inspect must not touch the network"); } }
  );
  assert.equal(inspected.kind, "HELPER_CONSTANT_INITIALIZERS");
  assert.equal(inspected.public_version, scene.publicVersion);
  assert.equal(inspected.settings_version, scene.settingsVersion);
});

test("local_function_scopes marks a real function declaration as COMPILED, everything else as NOT_REQUESTED", async (t) => {
  const scene = await setupScene(t, { composable: "function" });
  const probed = await main(scene.args("--probe"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl });
  const result = probed.result as { modules: { module_name: string; sources: { source_path: string; local_function_scopes: string }[] }[] };
  const video = result.modules.find((module) => module.module_name === "video.js")!;
  assert.equal(video.sources[0]!.local_function_scopes, "NOT_REQUESTED");
  const luma = result.modules.find((module) => module.module_name === "useLuma.js")!;
  assert.equal(luma.sources.find((source) => source.source_path.endsWith("luma-image/payload.ts"))!.local_function_scopes, "NOT_REQUESTED");
  assert.equal(luma.sources.find((source) => source.source_path.endsWith("composables/useLuma.js"))!.local_function_scopes, "COMPILED");
});

test("an arrow-form composable falls back to module-scope records instead of losing the whole run", async (t) => {
  const scene = await setupScene(t, { composable: "arrow" });
  const probed = await main(scene.args("--probe"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl });
  assert.equal(probed.status, "probed");
  const result = probed.result as { modules: { module_name: string; sources: { source_path: string; local_function_scopes: string; constants: { records: { scope: string; name: string }[] } }[] }[] };
  const luma = result.modules.find((module) => module.module_name === "useLuma.js")!;
  const composable = luma.sources.find((source) => source.source_path.endsWith("composables/useLuma.js"))!;
  assert.equal(composable.local_function_scopes, "SKIPPED_NOT_A_FUNCTION_DECLARATION");
  assert.ok(composable.constants.records.some((record) => record.scope === "module"));
  assert.equal(composable.constants.records.some((record) => record.scope === "useLumaSettings"), false);
  const payload = luma.sources.find((source) => source.source_path.endsWith("luma-image/payload.ts"))!;
  assert.equal(payload.local_function_scopes, "NOT_REQUESTED");
  assert.ok(payload.constants.records.some((record) => record.name === "LUMA_FIELDS"));
});

test("a source newer than its own compiled dist twin refuses before network", async (t) => {
  const scene = await setupScene(t, { composable: "function" });
  const future = new Date(Date.now() + 60_000);
  await utimes(join(scene.sourceRoot, "tools/settings-ir/v6/static-esm-constants.ts"), future, future);
  await assert.rejects(main(scene.args("--probe"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl }), /HELPER_CLI_STALE_BUILD/);
  assert.equal(scene.calls(), 0);
});

test("a missing dist file and an unarchived result both fail with a named code, not a raw ENOENT", async (t) => {
  const scene = await setupScene(t, { composable: "function" });
  await assert.rejects(main(
    ["--inspect", "--public-version", scene.publicVersion, "--settings-version", scene.settingsVersion, "--version", `sha256-${"0".repeat(64)}.json`],
    { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: async () => { throw new Error("offline"); } }
  ), /HELPER_RESULT_MISSING/);
  await rm(join(scene.sourceRoot, "dist/tools/settings-ir/v6/static-esm-constants.js"));
  await assert.rejects(main(scene.args("--probe"), { projectRoot: scene.root, sourceRoot: scene.sourceRoot, fetchImpl: scene.fetchImpl }), /HELPER_CLI_REQUIRES_SOURCE_CHECKOUT/);
  assert.equal(scene.calls(), 0);
});

test("a second, different (public_version, settings_version) pair archives alongside an existing one", async (t) => {
  const first = await setupScene(t, { composable: "function" });
  const firstArchive = await main(first.args("--archive"), { projectRoot: first.root, sourceRoot: first.sourceRoot, fetchImpl: first.fetchImpl });
  assert.equal(firstArchive.status, "created");

  const second = await setupScene(t, { composable: "arrow", root: first.root, sourceRoot: first.sourceRoot });
  assert.notEqual(second.settingsVersion, first.settingsVersion, "the arrow-composable fixture must hash to a different settings inventory");
  const secondArchive = await main(second.args("--archive"), { projectRoot: second.root, sourceRoot: second.sourceRoot, fetchImpl: second.fetchImpl });
  assert.equal(secondArchive.status, "created");
  assert.notEqual(secondArchive.version, firstArchive.version);

  const files = await readdir(join(first.root, "catalog", "runtime", "v6"));
  assert.equal(files.length, 2);
  assert.ok(files.includes(firstArchive.version as string));
  assert.ok(files.includes(secondArchive.version as string));
});

interface Scene {
  root: string;
  sourceRoot: string;
  publicVersion: string;
  settingsVersion: string;
  args(mode: "--probe" | "--archive"): string[];
  fetchImpl: typeof fetch;
  calls(): number;
  resetCalls(): void;
}

async function setupScene(
  t: { after(fn: () => Promise<void>): void },
  options: { composable: "function" | "arrow"; root?: string; sourceRoot?: string }
): Promise<Scene> {
  const root = options.root ?? await mkdtemp(join(tmpdir(), "syntx-helper-cli-"));
  if (!options.root) t.after(() => rm(root, { recursive: true, force: true }));
  const { inventory, publicCatalog, bodies } = await material(options.composable);
  const catalogDirectory = join(root, "catalog");
  await mkdir(catalogDirectory, { recursive: true });
  const publicArchive = await archivePublicCatalogSnapshot(publicCatalog, catalogDirectory);
  const settingsArchive = await archiveSettingsSourceInventory(inventory, publicCatalog, catalogDirectory);
  const sourceRoot = options.sourceRoot ?? await mkdtemp(join(tmpdir(), "syntx-helper-cli-toolchain-"));
  if (!options.sourceRoot) t.after(() => rm(sourceRoot, { recursive: true, force: true }));
  await putToolchainFixture(sourceRoot);
  let count = 0;
  const fetchImpl = (async (input: unknown) => {
    count += 1;
    const data = bodies.get(String(input));
    assert.ok(data, `Unexpected fixture URL: ${String(input)}`);
    const response = new Response(new Uint8Array(data.bytes), { status: 200, headers: { "content-type": data.media } });
    Object.defineProperty(response, "url", { value: String(input) });
    return response;
  }) as typeof fetch;
  return {
    root, sourceRoot, publicVersion: publicArchive.version, settingsVersion: settingsArchive.version,
    args: (mode) => [mode, "--public-version", publicArchive.version, "--settings-version", settingsArchive.version, CONFIRM],
    fetchImpl, calls: () => count, resetCalls: () => { count = 0; }
  };
}

async function material(composable: "function" | "arrow"): Promise<{
  inventory: SettingsSourceInventory; publicCatalog: SyntxPublicCatalogSnapshot; bodies: Map<string, { bytes: Uint8Array; media: string }>;
}> {
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
  const useLumaBody = composable === "function"
    ? 'export function useLumaSettings() {\n  const styleOptions = ["auto"];\n  return { styleOptions };\n}\n'
    : 'export const useLumaSettings = () => {\n  const styleOptions = ["auto"];\n  return { styleOptions };\n};\n';
  const sourceContents: Record<"video.js" | "useLuma.js", string[]> = {
    "video.js": ['export const MODEL = "hailuo-3.0";\nexport const DURATION = 6;\n'],
    "useLuma.js": ['export const LUMA_FIELDS = ["prompt", "seed"];\n', useLumaBody]
  };
  for (const name of ["video.js", "useLuma.js"] as const) {
    const paths = name === "video.js"
      ? [`${PREFIX}data/hailuo/constants.js`]
      : [`${PREFIX}data/luma-image/payload.ts`, `${PREFIX}composables/useLuma.js`];
    const javascript = encoder.encode(`export const synthetic = '${name}';`);
    const map = { version: 3, file: name as string, names: [], mappings: "", sources: paths, sourcesContent: sourceContents[name] };
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
  return { inventory, publicCatalog, bodies };
}

const TOOLCHAIN_TS_PATHS = [
  "tools/settings-ir/v6/pinned-helper-bundle.ts",
  "tools/settings-ir/v6/static-esm-constants.ts",
  "tools/settings-ir/v6/helper-constants-result.ts",
  "tools/settings-ir/immutable-json-snapshot.ts",
  "src/catalog/settings-source-inventory.ts",
  "src/catalog/settings-source-history.ts",
  "src/catalog/public-catalog-history.ts",
  "src/catalog/syntx-public-catalog.ts",
  "src/transports/is-main.ts"
];

async function putToolchainFixture(root: string): Promise<void> {
  for (const path of TOOLCHAIN_TS_PATHS) {
    await put(root, path, "// fixture toolchain source, never the real implementation\n");
    await put(root, `dist/${path.replace(/\.ts$/u, ".js")}`, "// fixture compiled output\n");
  }
  await put(root, "scripts/settings-helper-constants.mjs", "// fixture checkout marker\n");
}

async function put(root: string, path: string, text: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), text);
}
