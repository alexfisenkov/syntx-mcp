import assert from "node:assert/strict";
import test from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import { SyntxHttpError, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import {
  isValidatedOwnerKling4Image,
  releaseValidatedOwnerKling4Image,
  validateOwnerKling4Image,
  type OwnerKling4ModelId
} from "../src/application/owner-kling4-image-policy.js";

const SAFE_URL = "https://r2.syntx.ai/kling4/renamed-source.png";
const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
const MODEL_IDS: readonly OwnerKling4ModelId[] = ["kling_4_keyframes", "kling_4_omni"];

function crc32(bytes: Uint8Array): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb8_8320 : 0);
  }
  return (crc ^ 0xffff_ffff) >>> 0;
}

function validPng300(): Buffer {
  const bytes = Buffer.from(PNG_1X1);
  bytes.writeUInt32BE(300, 16);
  bytes.writeUInt32BE(300, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29);
  return bytes;
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function clientWithResponse(body: unknown, onFetch: (form: FormData) => void = () => {}): {
  readonly client: SyntxChatHttpClient;
  readonly getFetchCalls: () => number;
} {
  let fetchCalls = 0;
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-kling4-upload-credential");
    }
  };
  const client = new SyntxChatHttpClient({
    credentialBroker,
    fetchImpl: async (_input, init) => {
      fetchCalls += 1;
      onFetch(init?.body as FormData);
      return jsonResponse(body);
    },
    requestTimeoutMs: 1_000
  });
  return { client, getFetchCalls: () => fetchCalls };
}

test("accepts a safe renamed filename annotation for both K4 image model IDs without changing ownership", async () => {
  for (const modelId of MODEL_IDS) {
    const receipt = validateOwnerKling4Image({
      model_id: modelId,
      filename: "submitted-frame.png",
      mime_type: "image/png",
      bytes: validPng300()
    });
    let fileWasOriginal = false;
    const { client, getFetchCalls } = clientWithResponse({ files: [{
      id: `renamed-${modelId}`,
      url: SAFE_URL,
      filename: "provider renamed frame (1).png",
      mime_type: "image/png",
      size: receipt.size,
      status: "uploaded"
    }] }, (form) => {
      const file = form.get("files");
      assert.ok(file instanceof File);
      fileWasOriginal = file.name === "submitted-frame.png" && form.get("model_type") === modelId;
    });
    try {
      const result = await client.uploadOwnerKling4Reference(receipt);
      assert.deepEqual(result, { file_id: `renamed-${modelId}`, url: SAFE_URL });
      assert.equal(fileWasOriginal, true, "the submitted filename/model tuple remains the upload authority");
      assert.equal(getFetchCalls(), 1, "one genuine native upload request is made");
      assert.equal(isValidatedOwnerKling4Image(receipt, modelId), false, "the receipt remains one-shot");
    } finally {
      releaseValidatedOwnerKling4Image(receipt);
    }
  }
});

test("rejects malformed echoed basenames for both K4 image model IDs", async () => {
  const malformed = [
    "",
    " \t ",
    ".",
    "..",
    "folder/frame.png",
    "folder\\frame.png",
    "line\nframe.png",
    "c1\u0085frame.png",
    "del\u007fframe.png",
    "x".repeat(256)
  ];

  for (const modelId of MODEL_IDS) {
    for (const echoedFilename of malformed) {
      const receipt = validateOwnerKling4Image({
        model_id: modelId,
        filename: "submitted-frame.png",
        mime_type: "image/png",
        bytes: validPng300()
      });
      const { client, getFetchCalls } = clientWithResponse({ files: [{
        id: `malformed-${modelId}`,
        url: SAFE_URL,
        filename: echoedFilename,
        mime_type: "image/png",
        size: receipt.size,
        status: "uploaded"
      }] });
      try {
        await assert.rejects(client.uploadOwnerKling4Reference(receipt), (error: unknown) =>
          error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
        assert.equal(getFetchCalls(), 1, "malformed response is detected only after the single upload dispatch");
        assert.equal(isValidatedOwnerKling4Image(receipt, modelId), false, "failed upload does not restore the receipt");
      } finally {
        releaseValidatedOwnerKling4Image(receipt);
      }
    }
  }
});
