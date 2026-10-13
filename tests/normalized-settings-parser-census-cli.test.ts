import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";

const SCRIPT_PATH = join(
  "scripts",
  "sync-normalized-settings-parser-census-manifest.mjs"
);
const MANIFEST_PATH = join(
  "catalog",
  "runtime",
  "v2",
  "normalized-settings-parser-census-manifest.json"
);
const EXPECTED_OFFLINE_SUMMARY =
  "Normalized settings parser census manifest unchanged. " +
  "verification=OFFLINE forms=42 model_bearing_forms=39 " +
  "zero_model_forms=3 models=192 current_models=182 legacy_models=10 " +
  "literal_models=97 dynamic_models=85 unbound_forms=3 sources=123 " +
  "compile_boundary=76 deferred=47 locators=351 runtime_usable=false\n";

test("census CLI offline check is byte-preserving", async () => {
  const before = await readFile(MANIFEST_PATH, "utf8");
  const result = spawnSync(process.execPath, [SCRIPT_PATH, "--check"], {
    encoding: "utf8",
    timeout: 30_000
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stderr, "");
  assert.equal(result.stdout, EXPECTED_OFFLINE_SUMMARY);
  assert.equal(await readFile(MANIFEST_PATH, "utf8"), before);
});

test("census CLI accepts only the three explicit offline/local modes", () => {
  for (const argumentsValue of [
    [],
    ["--invalid"],
    ["--check-source"],
    ["--sync-source"],
    ["--check", "extra"]
  ]) {
    const result = spawnSync(
      process.execPath,
      [SCRIPT_PATH, ...argumentsValue],
      { encoding: "utf8", timeout: 10_000 }
    );
    assert.equal(result.status, 1);
    assert.equal(result.stdout, "");
    assert.equal(
      result.stderr,
      "Normalized settings parser census failed: INVALID_ARGUMENT.\n"
    );
  }
});

test("census CLI contains no network or parser-source integration", async () => {
  const source = await readFile(SCRIPT_PATH, "utf8");
  const sourceFile = ts.createSourceFile(
    SCRIPT_PATH,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS
  );
  const moduleSpecifiers: string[] = [];
  const calledIdentifiers: string[] = [];

  function visit(node: ts.Node): void {
    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier !== undefined &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      moduleSpecifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0]!)
    ) {
      moduleSpecifiers.push(node.arguments[0].text);
    }
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression)
    ) {
      calledIdentifiers.push(node.expression.text);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);

  assert.equal(
    moduleSpecifiers.some(
      (specifier) =>
        specifier === "node:http" ||
        specifier === "node:https" ||
        specifier === "node:net" ||
        specifier === "node:tls" ||
        specifier.includes("pinned-settings-source-loader") ||
        specifier.includes("static-settings-compiler") ||
        specifier.includes("build-banana-parser-canary")
    ),
    false
  );
  assert.equal(calledIdentifiers.includes("fetch"), false);
  for (const safeSnapshotCode of [
    "SNAPSHOT_REQUEST_INVALID",
    "SNAPSHOT_CONTENT_TOO_LARGE",
    "SNAPSHOT_TEMPORARY_COLLISION",
    "SNAPSHOT_CLEANUP_FAILED",
    "SNAPSHOT_WRITE_FAILED"
  ]) {
    assert.equal(
      source.includes(`\"${safeSnapshotCode}\"`),
      true,
      `${safeSnapshotCode} must remain in the CLI safe error allowlist`
    );
  }
});
