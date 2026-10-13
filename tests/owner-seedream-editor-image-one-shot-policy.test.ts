import assert from "node:assert/strict";
import test from "node:test";

const moduleUrl = new URL("../src/application/owner-seedream-editor-image-one-shot-policy.js", import.meta.url).href;
const api = await import(moduleUrl).catch(() => null) as Record<string, unknown> | null;

test("Seedream Editor image one-shot policy exposes local-only permit operations", () => {
  assert.ok(api, "MISSING_SEEDREAM_EDITOR_IMAGE_ONE_SHOT_POLICY_MODULE");
  assert.equal(typeof api!.createOwnerSeedreamEditorImageOneShotPermit, "function");
  assert.equal(typeof api!.revalidateOwnerSeedreamEditorImageOneShotPermit, "function");
  assert.equal(typeof api!.consumeOwnerSeedreamEditorImageOneShotPermit, "function");
});
