import assert from "node:assert/strict";
import test from "node:test";
import { validateProfileVideoImageUploadResponse } from "../src/adapter/syntx/profile-video-image-upload-response.js";

const submittedBytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0xff]);
const expected = Object.freeze({ filename: "frame.png", mime_type: "image/png", bytes: submittedBytes, width: 768, height: 768 });
const r2Url = "https://r2.syntx.ai/private/dop-image.png";
const file = (fields: Record<string, unknown> = {}) => ({
  filename: "frame.png", size: submittedBytes.byteLength, content_type: "image/png", width: 768, height: 768,
  url: r2Url, status: "success", ...fields
});
const response = (entry: Record<string, unknown>) => ({ files: [entry] });
const invalid = (raw: unknown) => assert.throws(
  () => validateProfileVideoImageUploadResponse(raw, expected),
  (error: unknown) => !!error && typeof error === "object" && "code" in error && error.code === "UPLOAD_RESPONSE_INVALID"
);

test("profile video image upload accepts success and preserves its safe internal URL", () => {
  const result = validateProfileVideoImageUploadResponse(response(file()), expected);
  assert.deepEqual(result, { url: r2Url });
});

test("profile video image upload accepts a duplicate only with exact submitted metadata", () => {
  const result = validateProfileVideoImageUploadResponse(response(file({ status: "duplicate" })), expected);
  assert.deepEqual(result, { url: r2Url });
});

test("duplicate response must echo filename, byte size, content type, width, and height", () => {
  for (const missing of ["filename", "size", "content_type", "width", "height"]) {
    const duplicate: Record<string, unknown> = file({ status: "duplicate" });
    delete duplicate[missing];
    invalid(response(duplicate));
  }
});

test("duplicate response rejects any submitted filename, size, content type, or dimension mismatch", () => {
  for (const mismatch of [
    { filename: "other.png" },
    { size: submittedBytes.byteLength + 1 },
    { content_type: "image/jpeg" },
    { width: 767 },
    { height: 769 }
  ]) invalid(response(file({ status: "duplicate", ...mismatch })));
});

test("content_type and mime_type aliases must agree and match the submitted image", () => {
  invalid(response(file({ status: "success", mime_type: "image/jpeg" })));
  invalid(response(file({ status: "success", content_type: "image/png", mime_type: "image/webp" })));
  const result = validateProfileVideoImageUploadResponse(response(file({ status: "success", mime_type: "image/png" })), expected);
  assert.equal(result.url, r2Url);
});

test("success accepts optional metadata only when every echoed value matches", () => {
  assert.equal(validateProfileVideoImageUploadResponse(response({ url: r2Url, status: "SUCCESS" }), expected).url, r2Url);
  invalid(response(file({ status: "success", filename: "other.png" })));
  invalid(response(file({ status: "success", size: submittedBytes.byteLength + 1 })));
  invalid(response(file({ status: "success", width: 767 })));
  invalid(response(file({ status: "success", height: 767 })));
});

test("provider duplicate hash labels remain opaque rather than assuming a digest algorithm", () => {
  const result = validateProfileVideoImageUploadResponse(response(file({ status: "duplicate", hash: "provider-defined-cache-fingerprint" })), expected);
  assert.equal(result.url, r2Url);
});

test("unrecognized upload statuses, multiple files, and unsafe references fail closed", () => {
  invalid(response(file({ status: "queued" })));
  const missingStatus: Record<string, unknown> = file(); delete missingStatus.status;
  invalid(response(missingStatus));
  invalid({ files: [file(), file()] });
  invalid(response(file({ url: "https://evil.example/private/image.png" })));
});
