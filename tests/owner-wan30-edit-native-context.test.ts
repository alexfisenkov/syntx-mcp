import assert from "node:assert/strict";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import {
  createOwnerWan30EditGenerationContext,
  readOwnerWan30EditPrivateWireBinding,
  releaseOwnerWan30EditGenerationContext,
  releaseOwnerWan30EditVideoInput,
  validateOwnerWan30EditVideoInput
} from "../src/adapter/syntx/owner-wan30-edit-native-context.js";
import type { OwnerWan30EditUploadedVideo } from "../src/adapter/syntx/owner-wan30-edit-native-context.js";
import {
  createOwnerWan30EditOriginalProbe,
  isTrustedOwnerWan30EditOriginalProbeResult
} from "../src/adapter/syntx/owner-wan30-edit-original-probe.js";
import { normalizeOwnerWan30EditGenerationIntent } from "../src/application/owner-wan30-edit-generation-parameters.js";

const INPUT_BYTES = Uint8Array.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
const UPLOAD_URL = "https://r2.syntx.ai/uploads/wan30-edit-owned.mp4";
const MODEL_ID = "wan_30_edit" as const;
const PROMPT = "Warm sunset light crosses the boat on a calm lake.";
const LOCAL_EXECUTABLE_FIXTURE = Object.freeze({
  skip: process.platform === "win32" ? "Local executable fixture uses a POSIX shebang; Windows ffprobe.exe coverage is separate." : false
});

function parameters() {
  return { aspect_ratio: "16:9" as const, resolution: "480P" as const, video_duration: 2 as const,
    prompt_extend: true as const, shot_type: "single" as const, audio_setting: "auto" as const,
    seed: null, native_audio: true as const, duration: 2 as const, rendering_speed: "basic" as const };
}

function intent(prompt = PROMPT) {
  return normalizeOwnerWan30EditGenerationIntent({ prompt, parameters: parameters() }).intent;
}

function contextInput(chatId: string, referenceVideo: OwnerWan30EditUploadedVideo) {
  return { attempt_id: "link_wan30_edit_native_1921", principal: {
    tenant_id: "tenant-edit", subject_id: "owner-edit", connection_id: "connection-edit"
  }, chat_id: chatId, intent: intent(), reference_video: referenceVideo };
}

async function makeProbeReceipt(t: TestContext, probeOutput = {
  streams: [{ codec_type: "video", width: 854, height: 480, duration: "2.000000", avg_frame_rate: "30/1", r_frame_rate: "30/1", nb_frames: "60" }],
  format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" }
}) {
  const directory = await mkdtemp(join(tmpdir(), "syntx-wan30-edit-native-test-"));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const ffprobePath = join(directory, "ffprobe-fixture");
  const output = JSON.stringify(probeOutput);
  const fixture = `#!${process.execPath}\nconst fs=require("node:fs");const path=process.argv.at(-1);if(!path||!fs.statSync(path).isFile()||fs.readFileSync(path).length<16)process.exit(2);process.stdout.write(${JSON.stringify(output)});\n`;
  await writeFile(ffprobePath, fixture, { mode: 0o700 });
  await chmod(ffprobePath, 0o700);
  return createOwnerWan30EditOriginalProbe({ ffprobePath }).probe({
    filename: "input.mp4", mime_type: "video/mp4", bytes: INPUT_BYTES
  });
}

type AckMode = "exact_text_video" | "exact_video_text" | "duplicate_text" | "duplicate_child_id" | "extra_object" |
  "wrong_prompt" | "wrong_url" | "wrong_model" | "wrong_ack_id" | "wrong_author" | "wrong_child_message_id";

function makeClient() {
  const observed: Array<{ method: string; url: string; body: unknown }> = [];
  let ackMode: AckMode = "exact_text_video";
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-wan-edit-token"); }
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      if (method === "POST" && init?.body instanceof FormData) {
        const form = init.body;
        const file = form.get("files");
        observed.push({ method, url: url.toString(), body: {
          keys: Array.from(form.keys()), destination: form.get("destination"),
          check_duplicates: form.get("check_duplicates"), model_type: form.get("model_type"),
          filename: file instanceof File ? file.name : null, mime_type: file instanceof File ? file.type : null,
          bytes: file instanceof File ? Buffer.from(await file.arrayBuffer()) : null
        } });
        return Response.json({ files: [{ id: "edit-file-1", url: UPLOAD_URL }] });
      }
      const body = method === "POST" && typeof init?.body === "string" ? JSON.parse(init.body) : null;
      observed.push({ method, url: url.toString(), body });
      if (url.pathname === "/api/v1/chats" && method === "POST") return Response.json({ uuid: "edit-chat-1" });
      if (url.pathname === "/api/v1/video/generate" && method === "POST") return Response.json({ id: 5201 });
      if (url.pathname === "/api/v1/chats/edit-chat-1/5201" && method === "GET") {
        const text = { id: "edit-text-1", message_id: ackMode === "wrong_child_message_id" ? 5210 : 5201, object_type: "text",
          object_text: ackMode === "wrong_prompt" ? `${PROMPT} ` : PROMPT, object_url: null,
          completed: true, model_type: ackMode === "wrong_model" ? "wan_30_omni" : MODEL_ID };
        const video = { id: ackMode === "duplicate_child_id" ? "edit-text-1" : "edit-video-1", message_id: 5201, object_type: "video",
          object_text: null, object_url: ackMode === "wrong_url" ? "https://r2.syntx.ai/uploads/not-owned.mp4" : UPLOAD_URL,
          completed: true, model_type: MODEL_ID };
        const objects = ackMode === "duplicate_text" ? [text, { ...text, id: "edit-text-2" }] :
          ackMode === "exact_video_text" ? [video, text] : ackMode === "extra_object" ? [text, video,
            { id: "edit-file-1", message_id: 5201, object_type: "file", object_text: null,
              object_url: UPLOAD_URL, completed: true, model_type: MODEL_ID }] : [text, video];
        return Response.json({ id: ackMode === "wrong_ack_id" ? 5202 : 5201, chat_id: 422,
          author_id: ackMode === "wrong_author" ? -1 : 17, message_object: objects });
      }
      throw new Error(`Unexpected synthetic request: ${method} ${url.pathname}`);
    }
  });
  return { client, observed, setAckMode(mode: AckMode) { ackMode = mode; } };
}

function makeResultReaderClient() {
  const observed: Array<{ method: string; url: string }> = [];
  let mode: "exact" | "bad_model" | "wrong_id" = "exact";
  const client = new SyntxChatHttpClient({
    credentialBroker: {
      async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> { return operation("synthetic-wan-edit-reader-token"); }
    },
    fetchImpl: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      observed.push({ method, url: url.toString() });
      if (method !== "GET" || url.pathname !== "/api/v1/chats/edit-result-chat/edit-result-message") {
        throw new Error(`Unexpected synthetic result-reader request: ${method} ${url.pathname}`);
      }
      return Response.json({
        id: mode === "wrong_id" ? "different-message" : "edit-result-message",
        chat_id: 422,
        author_id: -1,
        message_object: [{ id: "edit-result-video", message_id: "edit-result-message", object_type: "video",
          object_url: "https://r2.syntx.ai/results/wan30-edit-result.mp4", completed: true,
          model_type: mode === "bad_model" ? "wan_30_omni" : MODEL_ID }]
      });
    }
  });
  return { client, observed, setMode(next: "exact" | "bad_model" | "wrong_id") { mode = next; } };
}

test("Edit input requires a nominal metadata-only probe and retains no bytes in its receipt", LOCAL_EXECUTABLE_FIXTURE, async (t) => {
  const probed = await makeProbeReceipt(t);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(probed), true);
  const receipt = validateOwnerWan30EditVideoInput(probed);
  assert.equal(isTrustedOwnerWan30EditOriginalProbeResult(probed), false, "validation consumes the original probe bytes");
  assert.equal(receipt.model_id, MODEL_ID);
  assert.equal(receipt.status, "LOCAL_SOURCE_VALIDATED");
  assert.equal(receipt.width, 854);
  assert.equal(receipt.height, 480);
  assert.equal(receipt.duration_seconds, 2);
  assert.equal(receipt.probe_confidence, "LOCAL_FFPROBE_METADATA_ONLY");
  assert.equal(receipt.upload_binding, "NOT_ESTABLISHED");
  assert.equal(receipt.generation_permit, false);
  assert.equal("bytes" in receipt, false);
  assert.equal(releaseOwnerWan30EditVideoInput(receipt), true);
  assert.equal(releaseOwnerWan30EditVideoInput(receipt), false);
});

test("Edit upload uses the observed multipart tuple and generation sends exact plain prompt and one trusted video URL", LOCAL_EXECUTABLE_FIXTURE, async (t) => {
  const { client, observed } = makeClient();
  const receipt = validateOwnerWan30EditVideoInput(await makeProbeReceipt(t));
  const uploads = await Promise.allSettled([client.uploadWan30EditVideo(receipt), client.uploadWan30EditVideo(receipt)]);
  assert.equal(uploads.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(uploads.filter((entry) => entry.status === "rejected").length, 1);
  const uploaded = uploads.find((entry) => entry.status === "fulfilled");
  assert.ok(uploaded && uploaded.status === "fulfilled");
  assert.equal(uploaded.value.model_id, MODEL_ID);
  assert.equal(uploaded.value.upload_profile_confidence, "UI_MULTIPART_FIELDS_OBSERVED_1918");
  assert.equal(JSON.stringify(uploaded.value).includes(UPLOAD_URL), false);
  const upload = observed.find((entry) => entry.url.includes("/api/v1/chats/upload-files"));
  assert.ok(upload);
  assert.deepEqual(upload.body, {
    keys: ["files", "destination", "check_duplicates", "model_type"], destination: "uploaded",
    check_duplicates: "true", model_type: MODEL_ID, filename: "input.mp4", mime_type: "video/mp4", bytes: Buffer.from(INPUT_BYTES)
  });

  const chat = await client.createChat("video", "owner-wan30-edit-1921");
  const context = createOwnerWan30EditGenerationContext(client, contextInput(chat.chat_uuid, uploaded.value));
  assert.equal(JSON.stringify(context).includes(UPLOAD_URL), false);
  assert.deepEqual(readOwnerWan30EditPrivateWireBinding(client, context), { prompt: PROMPT, reference_url: UPLOAD_URL });
  const sends = await Promise.allSettled([client.generateWan30EditVideo(context), client.generateWan30EditVideo(context)]);
  assert.equal(sends.filter((entry) => entry.status === "fulfilled").length, 1);
  assert.equal(sends.filter((entry) => entry.status === "rejected").length, 1);
  const post = observed.find((entry) => entry.url.includes("/api/v1/video/generate"));
  assert.ok(post);
  assert.equal(post.url, "https://api.syntx.ai/api/v1/video/generate?ai_name=wan_video");
  const body = post.body as { chat_id: string; prompt: string; settings: Record<string, unknown> };
  assert.deepEqual(body, {
    chat_id: chat.chat_uuid,
    prompt: PROMPT,
    settings: {
      model_type: MODEL_ID,
      file_urls: [{ type: "video", url: UPLOAD_URL }],
      ...parameters()
    }
  });
  assert.equal(body.prompt.endsWith(" "), false);
  assert.equal(observed.filter((entry) => entry.url.includes("/api/v1/video/generate")).length, 1);
  assert.equal(releaseOwnerWan30EditGenerationContext(client, context), true);
  assert.equal(readOwnerWan30EditPrivateWireBinding(client, context), null);
});

test("Edit owner ACK accepts exact text and video in either order and rejects mismatches", LOCAL_EXECUTABLE_FIXTURE, async (t) => {
  const { client, observed, setAckMode } = makeClient();
  const uploaded = await client.uploadWan30EditVideo(validateOwnerWan30EditVideoInput(await makeProbeReceipt(t)));
  const chat = await client.createChat("video", "owner-wan30-edit-ack-1921");
  const context = createOwnerWan30EditGenerationContext(client, contextInput(chat.chat_uuid, uploaded));
  await client.generateWan30EditVideo(context);
  const foreign = makeClient();
  assert.deepEqual(await foreign.client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(foreign.observed.length, 0, "foreign client must not issue an ACK GET");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "not-numeric"),
    { status: "UNVERIFIED", reason: "MESSAGE_ID_INVALID" });
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"), { status: "BOUND" });
  setAckMode("exact_video_text");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"), { status: "BOUND" });
  setAckMode("duplicate_text");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("wrong_prompt");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("wrong_url");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("wrong_model");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_MODEL_MISMATCH" });
  setAckMode("wrong_ack_id");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_ID_MISMATCH" });
  setAckMode("wrong_author");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_AUTHOR_NOT_OWNER" });
  setAckMode("wrong_child_message_id");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("duplicate_child_id");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_OBJECTS_MISMATCH" });
  setAckMode("extra_object");
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "ACK_SHAPE_INVALID" });
  const gets = observed.filter((entry) => entry.method === "GET" && entry.url.includes("/api/v1/chats/edit-chat-1/5201"));
  assert.equal(gets.length, 11);
  assert.equal(releaseOwnerWan30EditGenerationContext(client, context), true);
  const before = observed.length;
  assert.deepEqual(await client.getWan30EditOwnerAckBinding(context, "5201"),
    { status: "UNVERIFIED", reason: "CONTEXT_NOT_RESERVED" });
  assert.equal(observed.length, before);
});

test("Edit result reader GET accepts a bound Edit video and rejects wrong model and message IDs", async () => {
  const { client, observed, setMode } = makeResultReaderClient();
  const context = { chat_uuid: "edit-result-chat", message_id: "edit-result-message", model_id: MODEL_ID,
    provider_chat_id: "422", message_object_ids: ["edit-result-video"] };
  const result = await client.getWanT2vVideoResultMessage(context);
  assert.deepEqual(result, {
    message_binding: "BOUND", model_echo: "MATCHED", gaps: [], backend_acceptance: "UNPROVEN",
    ready_videos: [{ object_index: 0, message_object_id: "edit-result-video", object_type: "video",
      object_url: "https://r2.syntx.ai/results/wan30-edit-result.mp4", mime_type: "video/mp4", mime_source: "URL_EXTENSION" }]
  });
  assert.deepEqual(observed, [{ method: "GET", url: "https://api.syntx.ai/api/v1/chats/edit-result-chat/edit-result-message" }]);

  setMode("bad_model");
  const wrongModel = await client.getWanT2vVideoResultMessage(context);
  assert.equal(wrongModel.message_binding, "UNVERIFIED");
  assert.equal(wrongModel.model_echo, "MISMATCH");
  assert.deepEqual(wrongModel.gaps, ["MODEL_TYPE_MISMATCH"]);

  setMode("wrong_id");
  const wrongId = await client.getWanT2vVideoResultMessage(context);
  assert.equal(wrongId.message_binding, "UNVERIFIED");
  assert.deepEqual(wrongId.gaps, ["OUTER_MESSAGE_ID_MISMATCH"]);

  const beforeInvalidModel = observed.length;
  await assert.rejects(client.getWanT2vVideoResultMessage({ ...context, model_id: "wan_30_edit_invalid" }));
  assert.equal(observed.length, beforeInvalidModel, "invalid model context must not issue GET");
  assert.equal(observed.every((entry) => entry.method === "GET"), true);
});
