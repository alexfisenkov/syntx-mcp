import assert from "node:assert/strict";
import test from "node:test";
import {
  isSafeUploadReferenceUrl,
  parseInternalUploadReferences
} from "../src/adapter/syntx/upload-reference-bridge.js";
import * as publicApi from "../src/index.js";

test("upload reference bridge accepts numeric and missing ids when URL is valid", () => {
  assert.deepEqual(parseInternalUploadReferences({
    files: [
      { id: 42, url: "https://r2.syntx.ai/uploads/42.png" },
      { url: "https://r2.syntx.ai/uploads/no-id.png" }
    ]
  }), [
    { file_id: "42", url: "https://r2.syntx.ai/uploads/42.png" },
    { url: "https://r2.syntx.ai/uploads/no-id.png" }
  ]);
});

test("upload reference bridge fails closed when files or URL is absent", () => {
  assert.throws(() => parseInternalUploadReferences({}), /UPLOAD_REFERENCE_PROTOCOL_ERROR/);
  assert.throws(() => parseInternalUploadReferences({ files: [] }), /UPLOAD_REFERENCE_PROTOCOL_ERROR/);
  assert.throws(() => parseInternalUploadReferences({ files: [{ id: 42 }] }), /UPLOAD_REFERENCE_PROTOCOL_ERROR/);
  assert.throws(() => parseInternalUploadReferences({ files: [{ url: "" }] }), /UPLOAD_REFERENCE_PROTOCOL_ERROR/);
});

test("upload reference bridge rejects wrong hosts and unsafe URL forms", () => {
  for (const url of [
    "https://attacker.invalid/uploads/a.png",
    "http://r2.syntx.ai/uploads/a.png",
    "https://r2.syntx.ai.evil.invalid/uploads/a.png",
    "https://user:password@r2.syntx.ai/uploads/a.png",
    "https://r2.syntx.ai:8443/uploads/a.png",
    "https://r2.syntx.ai/uploads/a.png#secret",
    "not-a-url"
  ]) {
    assert.equal(isSafeUploadReferenceUrl(url), false, url);
    assert.throws(() => parseInternalUploadReferences({ files: [{ url }] }), /UPLOAD_REFERENCE_URL_NOT_ALLOWLISTED/);
  }
});

test("internal bridge data is not an MCP-shaped receipt and URL is not leaked by helper errors", () => {
  assert.equal("parseInternalUploadReferences" in publicApi, false);
  assert.equal("isSafeUploadReferenceUrl" in publicApi, false);
  assert.equal(JSON.stringify({ status: "accepted", file_id: "42" }).includes("r2.syntx.ai"), false);
  assert.throws(() => parseInternalUploadReferences({ files: [{ url: "https://attacker.invalid/a.png" }] }), (error: unknown) => {
    assert.equal(error instanceof Error, true);
    assert.equal((error as Error).message.includes("attacker.invalid"), false);
    return true;
  });
});
