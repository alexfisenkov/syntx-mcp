import assert from "node:assert/strict";
import test from "node:test";
import {
  readOwnerKlingMotionControlPresetForClient,
  SyntxChatHttpClient
} from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const audioUrl = "https://r2.syntx.ai/mcv/preset-audio.mp4";
const noaudioUrl = "https://r2.syntx.ai/mcv/preset-noaudio.mp4";

function makeClient(onFetch: (url: URL, init: RequestInit | undefined) => Promise<Response>): SyntxChatHttpClient {
  const credentialBroker: SyntxCredentialBroker = {
    async useCredential<T>(operation: (credential: string) => Promise<T>): Promise<T> {
      return operation("synthetic-test-credential");
    }
  };
  return new SyntxChatHttpClient({ credentialBroker, fetchImpl: async (input, init) => {
    const url = input instanceof URL ? input : new URL(typeof input === "string" ? input : input.url);
    return onFetch(url, init);
  }, requestTimeoutMs: 1_000 });
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

test("native GET mints bounded client-bound preset contexts from the fixed service route", async () => {
  let calls = 0;
  const native = makeClient(async (url, init) => {
    calls += 1;
    assert.equal(url.href, "https://api.syntx.ai/api/v1/kling/motions");
    assert.equal(init?.method, "GET");
    assert.equal(init?.body, undefined);
    assert.equal(new URL(url).search, "");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-test-credential");
    return jsonResponse([
      { name: "Preset A", audio: audioUrl, noaudio: noaudioUrl, preview: "https://cdn.example/preview.mp4", top: true },
      { name: "Preset B", audio: audioUrl, noaudio: null },
      { name: "Preset C", audio: "https://cdn.example/unverified.mp4" }
    ]);
  });
  const other = makeClient(async () => jsonResponse([]));
  const library = await native.listKlingMotionControlPresets();
  assert.equal(calls, 1);
  assert.equal(library.source_shape, "SOURCE_OBSERVED_RESPONSE_SHAPE_ONLY");
  assert.equal(library.url_policy, "R2_UPLOAD_ORIGIN_ONLY_LOCAL_UNVERIFIED_FOR_PRESET_LIBRARY");
  assert.deepEqual(library.entries.map(({ name, index, availability }) => ({ name, index, availability })), [
    { name: "Preset A", index: 0, availability: { audio: true, noaudio: true } },
    { name: "Preset B", index: 1, availability: { audio: true, noaudio: false } }
  ]);
  assert.equal(JSON.stringify(library).includes("https://"), false);
  assert.equal(library.gaps.some(({ code }) => code === "PREVIEW_URL_ORIGIN_UNVERIFIED"), true);
  assert.equal(JSON.stringify(library.gaps).includes("cdn.example"), false);
  assert.equal(library.gaps.some(({ code }) => code === "VARIANT_URL_ORIGIN_UNVERIFIED"), true);
  assert.equal(Object.isFrozen(library), true);
  assert.equal(Object.isFrozen(library.entries[0]), true);
  const first = library.entries[0]!;
  assert.deepEqual(readOwnerKlingMotionControlPresetForClient(native, first.context, "audio"), { url: audioUrl });
  assert.deepEqual(readOwnerKlingMotionControlPresetForClient(native, first.context, "noaudio"), { url: noaudioUrl });
  assert.equal(readOwnerKlingMotionControlPresetForClient(native, first.context, "invalid" as unknown as "audio"), null);
  assert.equal(readOwnerKlingMotionControlPresetForClient(other, first.context, "audio"), null);
  assert.equal(readOwnerKlingMotionControlPresetForClient(native, { ...first.context }, "audio"), null);
});

test("native preset GET is not retried after abort or unsafe client prototype change", async () => {
  let calls = 0;
  const native = makeClient(async () => { calls += 1; return jsonResponse([]); });
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(native.listKlingMotionControlPresets(controller.signal));
  assert.equal(calls, 0);
  const context = await native.listKlingMotionControlPresets();
  assert.equal(calls, 1);
  Object.setPrototypeOf(native, {});
  assert.equal(readOwnerKlingMotionControlPresetForClient(native, context.entries[0]?.context, "audio"), null);
});

test("native preset GET rejects wrapped data and does not retry failed requests", async () => {
  let calls = 0;
  const wrapped = makeClient(async () => {
    calls += 1;
    return jsonResponse({ data: [{ name: "Wrapped", audio: audioUrl }] });
  });
  await assert.rejects(wrapped.listKlingMotionControlPresets(), /INVALID_KLING_MOTION_CONTROL_PRESETS_RESPONSE/u);
  assert.equal(calls, 1);

  const unavailable = makeClient(async () => {
    calls += 1;
    return new Response("", { status: 503 });
  });
  await assert.rejects(unavailable.listKlingMotionControlPresets());
  assert.equal(calls, 2);
});
