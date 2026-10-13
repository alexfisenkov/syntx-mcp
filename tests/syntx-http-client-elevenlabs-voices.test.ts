import assert from "node:assert/strict";
import test from "node:test";
import { SyntxHttpClient, type SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";

const SECRET = "elevenlabs-voices-test-credential";
const broker: SyntxCredentialBroker = {
  async useCredential(operation) { return operation(SECRET); }
};

function list(client: SyntxHttpClient, request: unknown, signal?: AbortSignal): Promise<unknown> {
  const api = client as unknown as { listElevenLabsVoices(input: unknown, signal?: AbortSignal): Promise<unknown> };
  return api.listElevenLabsVoices(request, signal);
}

test("ElevenLabs voice listing uses the fixed first-page GET and strips unconsumed provider fields", async () => {
  let seen: { url: string; method: string | undefined; authorization: string | null; cache: RequestCache | undefined;
    redirect: RequestRedirect | undefined; body: BodyInit | null | undefined } | undefined;
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async (input, init) => {
    seen = { url: String(input), method: init?.method, authorization: new Headers(init?.headers).get("authorization"),
      cache: init?.cache, redirect: init?.redirect, body: init?.body };
    return new Response(JSON.stringify({ page: 1, total: 12, facets: { genders: ["female"], private: SECRET },
      results: [{ voice_id: "voice_A1", name: "Studio voice", url: "https://signed.invalid/private", favorite: true, secret: SECRET }] }),
    { headers: { "content-type": "application/json" } });
  } });

  assert.deepEqual(await list(client, { page: 1, page_size: 10 }), {
    page: 1, page_size: 10, total: 12, has_more: true, voices: [{ voice_id: "voice_A1", name: "Studio voice" }]
  });
  assert.deepEqual(seen, {
    url: "https://api.syntx.ai/api/v1/audio/elevenlabs/voice_examples?page=1&page_size=10",
    method: "GET", authorization: `Bearer ${SECRET}`, cache: "no-store", redirect: "error", body: undefined
  });
  assert.equal(JSON.stringify(await list(client, { page: 1, page_size: 10 })).includes("signed.invalid"), false);
});

test("ElevenLabs voice listing accepts the observed row-array response as page-one partial data", async () => {
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () => new Response(JSON.stringify([
    { voice_id: "voice_B2", name: "Voice B", metadata: { token: SECRET } }
  ]), { headers: { "content-type": "application/json" } }) });
  assert.deepEqual(await list(client, { page: 1, page_size: 10 }), {
    page: 1, page_size: 10, total: null, has_more: null, voices: [{ voice_id: "voice_B2", name: "Voice B" }]
  });
});

test("ElevenLabs voice listing rejects malformed rows, wrong page envelopes, and responses over the local row bound", async () => {
  const bodies: unknown[] = [
    { page: 1, total: 1, facets: {}, results: [{ name: "Missing voice id" }] },
    { page: 2, total: 1, facets: {}, results: [{ voice_id: "voice_A", name: "Wrong page" }] },
    { page: 1, total: "one", facets: {}, results: [{ voice_id: "voice_A", name: "Bad total" }] },
    { page: 1, total: 0, facets: {}, results: [{ voice_id: "voice_A", name: "Rows exceed total" }] },
    Array.from({ length: 101 }, (_, index) => ({ voice_id: `voice_${index}`, name: "Too many" }))
  ];
  let index = 0;
  const client = new SyntxHttpClient({ credentialBroker: broker, fetchImpl: async () =>
    new Response(JSON.stringify(bodies[index++]), { headers: { "content-type": "application/json" } }) });
  for (const _body of bodies) await assert.rejects(list(client, { page: 1, page_size: 10 }));
  assert.equal(index, bodies.length);
});

test("ElevenLabs voice listing rejects caller-selected pages, sizes, and query extensions before credential access", async () => {
  let credentials = 0, fetches = 0;
  const counting: SyntxCredentialBroker = { async useCredential(operation) { credentials += 1; return operation(SECRET); } };
  const client = new SyntxHttpClient({ credentialBroker: counting, fetchImpl: async () => {
    fetches += 1; return new Response("[]", { headers: { "content-type": "application/json" } });
  } });
  for (const request of [
    { page: 2, page_size: 10 }, { page: 1, page_size: 11 }, { page: 1, page_size: 10, favourites: true }
  ]) await assert.rejects(list(client, request));
  assert.equal(credentials, 0);
  assert.equal(fetches, 0);
});
