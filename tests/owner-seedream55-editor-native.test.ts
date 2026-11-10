import assert from "node:assert/strict";
import test from "node:test";
import { createOwnerSeedream55EditorNative, OwnerSeedream55EditorNativeError } from "../src/adapter/syntx/owner-seedream55-editor-native.js";

const attempt = "link_seedream55_editor_test_0123456789";
const sourceUrl = "https://r2.syntx.ai/seedream/editor-original.png";

test("55 Editor cannot start a paid POST with a fabricated token", async () => {
  let posts = 0;
  const native = createOwnerSeedream55EditorNative({
    async createChat() { return { chat_uuid: "editor-chat-1" }; },
    async uploadOriginal() { return { url: sourceUrl }; }, async uploadDrawing() { return { url: sourceUrl }; },
    async postGenerate() { posts += 1; return { message_id: "1" }; },
    async getHistoryPage() { throw new Error("unused"); }, async getRawResult() { throw new Error("unused"); }
  });
  await native.createChat({ attemptId: attempt, title: "Editor" });
  await assert.rejects(native.start({ attemptId: attempt, chat_uuid: "editor-chat-1", token: Object.freeze({}) as never }),
    (error: unknown) => error instanceof OwnerSeedream55EditorNativeError && error.code === "INVALID_REQUEST");
  assert.equal(posts, 0);
  native.close();
});

test("55 Editor late chat and upload callbacks cannot resurrect invalidated attempt", async () => {
  let releaseChat!: (value: { chat_uuid: string }) => void;
  let releaseUpload!: (value: { url: string }) => void;
  const native = createOwnerSeedream55EditorNative({
    async createChat() { return await new Promise((resolve) => { releaseChat = resolve; }); },
    async uploadOriginal() { return await new Promise((resolve) => { releaseUpload = resolve; }); },
    async uploadDrawing() { return { url: sourceUrl }; },
    async postGenerate() { return { message_id: "1" }; }, async getHistoryPage() { throw new Error("unused"); },
    async getRawResult() { throw new Error("unused"); }
  });
  const creating = native.createChat({ attemptId: attempt, title: "Editor" });
  native.invalidateAttempt(attempt); releaseChat({ chat_uuid: "editor-chat-1" });
  await assert.rejects(creating, (error: unknown) => error instanceof OwnerSeedream55EditorNativeError && error.code === "CHAT_UNAVAILABLE");
  const uploading = native.uploadOriginal({ attemptId: attempt, bytes: new Uint8Array([1]), filename: "input.png", mime_type: "image/png" });
  native.invalidateAttempt(attempt); releaseUpload({ url: sourceUrl });
  await assert.rejects(uploading, (error: unknown) => error instanceof OwnerSeedream55EditorNativeError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  native.close();
});

test("55 Editor rejects accessor upload receipts without invoking getter", async () => {
  let invoked = 0;
  const native = createOwnerSeedream55EditorNative({
    async createChat() { return { chat_uuid: "editor-chat-1" }; },
    async uploadOriginal() { return Object.defineProperty({}, "url", { enumerable: true, get() { invoked += 1; return sourceUrl; } }) as {url:string}; },
    async uploadDrawing() { return { url: sourceUrl }; },
    async postGenerate() { return { message_id: "1" }; }, async getHistoryPage() { throw new Error("unused"); },
    async getRawResult() { throw new Error("unused"); }
  });
  await assert.rejects(native.uploadOriginal({ attemptId: attempt, bytes: new Uint8Array([1]), filename: "input.png", mime_type: "image/png" }),
    (error: unknown) => error instanceof OwnerSeedream55EditorNativeError && error.code === "UPLOAD_OUTCOME_UNKNOWN");
  assert.equal(invoked, 0);
  native.close();
});
