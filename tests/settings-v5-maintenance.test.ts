import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import {
  collectLocalEsmGraphV5,
  collectRootOnlyV5ImplementationComponents,
  V5ImplementationGraphError
} from "../tools/settings-ir/v5/implementation-graph.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const CLI = pathToFileURL(join(ROOT, "scripts/settings-v5-root-only.mjs")).href;

test("v5 graph follows transitive imports, reexports and cycles deterministically", () => {
  fixture((root) => {
    put(root, "tools/root.js", "import '../src/a.js'; export * from '../src/b.js';\n");
    put(root, "src/a.js", "import './b.js'; export const a = 1;\n");
    put(root, "src/b.js", "import './a.js'; import fs from 'node:fs'; export const b = 2;\n");
    const records = collectLocalEsmGraphV5(root, ["tools/root.js"]);
    assert.deepEqual(records.map((entry) => entry.name), ["module.src.a.js", "module.src.b.js", "module.tools.root.js"]);
    const before = records[1]!.sha256;
    put(root, "src/b.js", "import './a.js'; export const b = 3;\n");
    assert.notEqual(collectLocalEsmGraphV5(root, ["tools/root.js"])[1]!.sha256, before);
    assert.deepEqual(collectLocalEsmGraphV5(root, ["tools/root.js"]), collectLocalEsmGraphV5(root, ["tools/root.js"]));
  });
});

test("v5 graph detects source TS edits even when emitted JS is unchanged", () => {
  fixture((root) => {
    put(root, "dist/tools/root.js", "export const value = 1;");
    put(root, "tools/root.ts", "export const value: number = 1;");
    const before = collectLocalEsmGraphV5(join(root, "dist"), ["tools/root.js"], root);
    put(root, "tools/root.ts", "export const value: number = 2;");
    const after = collectLocalEsmGraphV5(join(root, "dist"), ["tools/root.js"], root);
    assert.equal(before[0]!.sha256, after[0]!.sha256);
    assert.equal(after[1]!.name, "source.tools.root.ts");
    assert.notEqual(before[1]!.sha256, after[1]!.sha256);
  });
});

test("v5 graph rejects unknown packages, computed imports, missing paths and symlink escape", () => {
  fixture((root) => {
    for (const code of ["import 'unlisted-package';", "const path = './a.js'; import(path);", "import '../src/missing.js';", "import '../../outside.js';"]) {
      put(root, "tools/root.js", code);
      assert.throws(() => collectLocalEsmGraphV5(root, ["tools/root.js"]), V5ImplementationGraphError);
    }
    put(root, "tools/root.js", "import '../src/link.js';");
    put(root, "outside.js", "export const sensitive = 'fixture only';");
    mkdirSync(join(root, "src"), { recursive: true });
    symlinkSync(join(root, "outside.js"), join(root, "src/link.js"));
    assert.throws(() => collectLocalEsmGraphV5(root, ["tools/root.js"]), V5ImplementationGraphError);
  });
});

test("actual v5 implementation list includes dependency graph, maintenance scripts and runtime boundary", () => {
  const records = collectRootOnlyV5ImplementationComponents(ROOT);
  for (const name of [
    "module.tools.settings-ir.v5.pinned-root-bundle.js",
    "module.tools.settings-ir.v5.compile-root-only.js",
    "module.src.catalog.settings-root-only-result-v5.js",
    "module.tools.settings-ir.static-settings-compiler.js",
    "module.tools.settings-ir.v5.implementation-graph.js",
    "source.tools.settings-ir.v5.implementation-graph.ts",
    "source.src.catalog.settings-root-only-result-v5.ts",
    "checkout.scripts.settings-v5-root-only.mjs",
    "checkout.package-lock.json", "external.zod.package-metadata", "runtime.node"
  ]) assert.ok(records.some((record) => record.name === name), name);
  assert.equal(new Set(records.map((entry) => entry.name)).size, records.length);
  assert.ok(records.every((entry) => entry.bytes > 0 && /^sha256:[a-f0-9]{64}$/u.test(entry.sha256)));
});

test("v5 CLI rejects missing confirmation and unsupported forms before filesystem writes", async () => {
  const cli = await import(CLI);
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-cli-"));
  try {
    const errors: string[] = [];
    for (const argv of [[], ["--sync-source", "--form-id", "beeble"],
      ["--probe-source", "--form-id", "banana", "--confirm-source-fetch"],
      ["--check", "--form-id", "../beeble"], ["--check", "--form-id", "beeble", "--extra"]]) {
      const code = await cli.runRootOnlyV5Cli(argv, { projectRoot: root, writeStdout: () => assert.fail("No successful output"), writeStderr: (text: string) => errors.push(text) });
      assert.equal(code, 1);
      assert.match(errors.at(-1)!, /INVALID_ARGUMENT/);
    }
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("v5 CLI has a source checkout guard for every accepted mode", async () => {
  const cli = await import(CLI);
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-package-"));
  try {
    for (const mode of ["--check", "--probe-source", "--sync-source"]) {
      let error = "";
      const args = [mode, "--form-id", "beeble", ...(mode === "--check" ? [] : ["--confirm-source-fetch"])];
      assert.equal(await cli.runRootOnlyV5Cli(args, { projectRoot: root, writeStdout: () => assert.fail("No successful output"), writeStderr: (text: string) => { error += text; } }), 1);
      assert.match(error, /SETTINGS_V5_REQUIRES_SOURCE_CHECKOUT/);
      assert.equal(error.includes(root), false);
    }
    assert.deepEqual(readdirSync(root), []);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("v5 missing result check and pre-existing sync target are both non-mutating", async () => {
  const cli = await import(CLI);
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-preflight-"));
  try {
    for (const marker of ["tsconfig.json", "node_modules/typescript/bin/tsc", "src/catalog/settings-root-only-result-v5.ts",
      "tools/settings-ir/v5/pinned-root-bundle.ts", "tools/settings-ir/v5/compile-root-only.ts",
      "tools/settings-ir/v5/root-only-result-toolchain.ts", "tools/settings-ir/v5/implementation-graph.ts"]) put(root, marker, "fixture");
    let error = "";
    const options = { projectRoot: root, writeStdout: () => assert.fail("No output"), writeStderr: (text: string) => { error = text; } };
    assert.equal(await cli.runRootOnlyV5Cli(["--check", "--form-id", "beeble"], options), 1);
    assert.match(error, /SETTINGS_V5_RESULT_MISSING/);
    put(root, "catalog/runtime/v5/beeble-root-only-result.json", "existing fixture");
    assert.equal(await cli.runRootOnlyV5Cli(["--sync-source", "--form-id", "beeble", "--confirm-source-fetch"], options), 1);
    assert.match(error, /SETTINGS_V5_RESULT_EXISTS/);
    assert.equal(readFileSync(join(root, "catalog/runtime/v5/beeble-root-only-result.json"), "utf8"), "existing fixture");
    assert.equal(readdirSync(root).includes(".черновики"), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("v5 CLI cancellation during isolated build reports INTERRUPTED and cleans its owned files", async () => {
  const cli = await import(CLI);
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-interrupt-"));
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    putBuildInputs(root);
    put(root, "node_modules/typescript/bin/tsc", "require('node:fs').writeFileSync('build-started', 'yes'); setInterval(() => {}, 1000);");
    const pollStarted = (): void => {
      if (existsSync(join(root, "build-started"))) process.emit("SIGTERM");
      else timer = setTimeout(pollStarted, 10);
    };
    timer = setTimeout(pollStarted, 10);
    let error = "";
    const previousListeners = process.listenerCount("SIGTERM");
    const result = await cli.runRootOnlyV5Cli(["--sync-source", "--form-id", "beeble", "--confirm-source-fetch"], {
      projectRoot: root, writeStdout: () => assert.fail("No successful output"), writeStderr: (text: string) => { error += text; }
    });
    assert.equal(result, 1);
    assert.match(error, /SETTINGS_V5_INTERRUPTED/);
    assert.equal(error.includes("SETTINGS_V5_BUILD_FAILED"), false);
    assert.equal(process.listenerCount("SIGTERM"), previousListeners);
    assert.deepEqual(readdirSync(join(root, ".черновики")), []);
    assert.equal(existsSync(join(root, "catalog/runtime/v5/beeble-root-only-result.json")), false);
  } finally {
    clearTimeout(timer);
    rmSync(root, { recursive: true, force: true });
  }
});

test("v5 refuses a concurrent source edit during tsc before fetch or artifact creation", async () => {
  const cli = await import(CLI);
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-build-drift-"));
  try {
    putBuildInputs(root);
    put(root, "node_modules/typescript/bin/tsc", "require('node:fs').appendFileSync('tools/settings-ir/v5/compile-root-only.ts', '\\n// concurrent edit');");
    let error = "";
    const result = await cli.runRootOnlyV5Cli(["--sync-source", "--form-id", "beeble", "--confirm-source-fetch"], {
      projectRoot: root, writeStdout: () => assert.fail("No successful output"), writeStderr: (text: string) => { error += text; }
    });
    assert.equal(result, 1);
    assert.match(error, /SETTINGS_V5_BUILD_INPUT_DRIFT/);
    assert.deepEqual(readdirSync(join(root, ".черновики")), []);
    assert.equal(existsSync(join(root, "catalog/runtime/v5/beeble-root-only-result.json")), false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function putBuildInputs(root: string): void {
  for (const marker of ["tsconfig.json", "package-lock.json", "tests/fixture.ts",
    "scripts/settings-v5-root-only.mjs", "scripts/sync-normalized-settings-parser-generic-form-result.mjs", "scripts/lock-signal-cleanup.mjs",
    "src/catalog/settings-root-only-result-v5.ts", "tools/settings-ir/v5/pinned-root-bundle.ts",
    "tools/settings-ir/v5/compile-root-only.ts", "tools/settings-ir/v5/root-only-result-toolchain.ts",
    "tools/settings-ir/v5/implementation-graph.ts"]) put(root, marker, "fixture");
  put(root, "package.json", "{}");
}

function put(root: string, path: string, text: string): void {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), text);
}
function fixture(work: (root: string) => void): void {
  const root = mkdtempSync(join(tmpdir(), "syntx-v5-graph-"));
  try { work(root); } finally { rmSync(root, { recursive: true, force: true }); }
}
