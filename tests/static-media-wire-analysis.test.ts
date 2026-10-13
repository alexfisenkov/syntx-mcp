import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { analyzeStaticMediaWireSource } from "../tools/static-media-wire-analysis.js";

function ref(source: string) {
  return {
    module_name: "app.js",
    url: "https://syntx.ai/assets/1791445568/app.js",
    bytes: Buffer.byteLength(source, "utf8"),
    sha256: `sha256:${createHash("sha256").update(source, "utf8").digest("hex")}`
  };
}

test("wire AST reports exact direct route, object fields, and boolean coercion without executing source", () => {
  const source = [
    "function submit(input){",
    "  return client.post('/api/v1/images/generate', {model_type: input.model_type, prompt: input.prompt, settings: {generate_audio: Boolean(input.generate_audio), aspect_ratio: input.aspect_ratio}});",
    "}"
  ].join("\n");
  const result = analyzeStaticMediaWireSource(ref(source), source);
  assert.equal(result.routes.length, 1);
  assert.deepEqual(result.routes[0], {
    route: "/api/v1/images/generate",
    route_status: "CALL_ARGUMENT_LITERAL",
    method: "post",
    operation: "IMAGE_GENERATION_CANDIDATE",
    locator: { line: 2, column: 22 }
  });
  assert.deepEqual(result.calls[0]?.body_fields, ["model_type", "prompt", "settings"]);
  assert.deepEqual(result.calls[0]?.settings_fields, ["aspect_ratio", "generate_audio"]);
  assert.equal(result.calls[0]?.field_transforms.find((item) => item.field === "generate_audio")?.transform, "BOOLEAN_CALL");
  assert.equal(result.runtime_usable, false);
  assert.equal(result.backend_verified, false);
});

test("dynamic paths and spreads remain unresolved instead of being guessed", () => {
  const source = "function submit(path, input){ return client.post(path, {...input.settings, model_type: getModel()}); }";
  const result = analyzeStaticMediaWireSource(ref(source), source);
  assert.equal(result.routes[0]?.route_status, "DYNAMIC_PATH");
  assert.deepEqual(result.calls[0]?.unresolved_body_reasons, ["DYNAMIC_FIELD_VALUE", "DYNAMIC_ROUTE", "OBJECT_SPREAD"]);
});

test("source hash mismatch is rejected before AST facts are returned", () => {
  const source = "client.post('/api/v1/images/generate', {prompt: input.prompt});";
  assert.throws(
    () => analyzeStaticMediaWireSource({ ...ref(source), sha256: `sha256:${"0".repeat(64)}` }, source),
    { code: "SOURCE_HASH_MISMATCH" }
  );
});
