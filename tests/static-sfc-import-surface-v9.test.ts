import assert from "node:assert/strict";
import test from "node:test";
import { compileStaticSfcImportSurface, STATIC_SFC_IMPORT_SURFACE_LIMITS } from "../tools/settings-ir/v9/static-sfc-import-surface.js";

test("v9 extracts SFC script metadata and static imports without returning source", () => {
  const source = `<template><div /></template>\n<script setup lang="ts">\nimport { ref } from "vue";\nconst lazy = import("./helper.js");\nimport { ref as again } from "vue";\n</script>`;
  const result = compileStaticSfcImportSurface({ source, sourcePath: "/synthetic/veo.vue" });
  assert.equal(result.profile, "STATIC_SFC_IMPORT_SURFACE_V1");
  assert.equal(result.source_path, "/synthetic/veo.vue");
  assert.equal(result.source_bytes, Buffer.byteLength(source));
  assert.deepEqual(result.script_blocks, [{ setup: true, lang: "ts", content_bytes: 100, content_sha256: "080f6d8838a031209e3e2be589bd7806f9160d8c3069f7e86ad5c300542d7056" }]);
  assert.deepEqual(result.imports.map(({ specifier, kind }) => ({ specifier, kind })), [
    { specifier: "vue", kind: "IMPORT_DECLARATION" },
    { specifier: "./helper.js", kind: "DYNAMIC_IMPORT" }
  ]);
  assert.ok(result.blockers.includes("IMPORT_GRAPH_NOT_RESOLVED"));
  assert.equal(result.runtime_usable, false);
  assert.equal(result.vendor_code_executed, false);
  assert.equal(result.source_persisted, false);
  assert.equal(JSON.stringify(result).includes("const lazy"), false);
});

test("v9 supports JS scripts, Uint8Array input and deterministic duplicate removal", () => {
  const source = `<script>import "x"; import("x"); import "x"</script>\n<script setup>import "x"</script>`;
  const result = compileStaticSfcImportSurface({ source: new TextEncoder().encode(source), sourcePath: "/synthetic/a.vue" });
  assert.equal(result.script_blocks.length, 2);
  assert.deepEqual(result.imports.map(({ specifier, kind }) => ({ specifier, kind })), [
    { specifier: "x", kind: "IMPORT_DECLARATION" },
    { specifier: "x", kind: "DYNAMIC_IMPORT" }
  ]);
  assert.deepEqual(result, compileStaticSfcImportSurface({ source, sourcePath: "/synthetic/a.vue" }));
});

test("v9 rejects malformed tags, NUL and oversized sources", () => {
  assert.equal(errorCode(() => compileStaticSfcImportSurface({ source: "<script setup", sourcePath: "/synthetic/a.vue" })), "SFC_TAG_UNCLOSED");
  assert.equal(errorCode(() => compileStaticSfcImportSurface({ source: "<script>const x = 1", sourcePath: "/synthetic/a.vue" })), "SCRIPT_UNCLOSED");
  assert.equal(errorCode(() => compileStaticSfcImportSurface({ source: "<script>\0</script>", sourcePath: "/synthetic/a.vue" })), "SOURCE_NUL_FORBIDDEN");
  assert.equal(errorCode(() => compileStaticSfcImportSurface({ source: "x".repeat(STATIC_SFC_IMPORT_SURFACE_LIMITS.maxSourceBytes + 1), sourcePath: "/synthetic/a.vue" })), "SOURCE_TOO_LARGE");
});

test("v9 reports non-static dynamic imports and rejects unsupported attributes", () => {
  const result = compileStaticSfcImportSurface({ source: `<script setup>const name = "x"; import(name)</script>`, sourcePath: "/synthetic/a.vue" });
  assert.deepEqual(result.imports, []);
  assert.deepEqual(result.blockers, ["DYNAMIC_IMPORT_NOT_STATIC"]);
  assert.equal(errorCode(() => compileStaticSfcImportSurface({ source: `<script src="x">import "x"</script>`, sourcePath: "/synthetic/a.vue" })), "SCRIPT_ATTRIBUTES_INVALID");
});

function errorCode(action: () => unknown): string {
  try {
    action();
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && typeof error.code === "string") return error.code;
  }
  throw new Error("EXPECTED_STATIC_SFC_ERROR");
}
