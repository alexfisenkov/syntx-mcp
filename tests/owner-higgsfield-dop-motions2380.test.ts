import assert from "node:assert/strict";
import test from "node:test";
import { SyntxHttpClient, SyntxHttpError } from "../src/adapter/syntx/http-client.js";
import { OWNER_HIGGSFIELD_DOP_MOTIONS_SOURCE } from "../src/application/owner-higgsfield-dop-motion-service.js";
import { normalizeOwnerHiggsfieldDopParameters } from "../src/application/owner-higgsfield-dop-parameters.js";
import { buildOwnerHiggsfieldDopWire } from "../src/application/owner-higgsfield-dop-wire.js";

const IMAGE_URL = "https://r2.syntx.ai/higgsfield-dop/private/frame.png";
const pickerMotion = (id: string | number, label = "Soft orbit") => ({ id, label, strength: 1 as const });
const input = (motions: unknown) => ({ model_id: "dop-lite", prompt: "Animate the subject gently.",
  enhance_prompt: false, motions });
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200, headers: { "content-type": "application/json" } });

test("2380 reads the fixed authenticated motion endpoint and preserves native ID types without preview URLs", async () => {
  let calls = 0;
  const client = new SyntxHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) {
    return use("synthetic-credential");
  } }, fetchImpl: async (request, init) => {
    calls++;
    assert.equal(String(request), OWNER_HIGGSFIELD_DOP_MOTIONS_SOURCE.endpoint);
    assert.equal(init?.method, "GET");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer synthetic-credential");
    return json([{ id: 17, title: "Numeric motion", preview_uri: "https://cdn.invalid/one.webp" },
      { id: "17", title: "String motion", preview_uri: "https://cdn.invalid/two.webp" }]);
  } });
  const rows = await client.listOwnerHiggsfieldDopMotions();
  assert.equal(calls, 1);
  assert.deepEqual(rows, [{ id: 17, title: "Numeric motion" }, { id: "17", title: "String motion" }]);
  assert.equal(JSON.stringify(rows).includes("preview_uri"), false);
});

test("2380 rejects malformed or duplicated typed motion catalogue IDs", async () => {
  const client = new SyntxHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) {
    return use("synthetic-credential");
  } }, fetchImpl: async () => json([{ id: 17, title: "Numeric motion", preview_uri: "" },
    { id: "17", title: "String motion", preview_uri: "" }, { id: 17, title: "Duplicate", preview_uri: "" }]) });
  await assert.rejects(client.listOwnerHiggsfieldDopMotions(), (error: unknown) =>
    error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
});

test("2380 rejects empty and malformed current motion catalogues", async () => {
  for (const rows of [[], [{ id: 17, title: "", preview_uri: "" }], [{ id: 17, title: "Numeric motion" }]]) {
    const client = new SyntxHttpClient({ credentialBroker: { async useCredential<T>(use: (token: string) => Promise<T>) {
      return use("synthetic-credential");
    } }, fetchImpl: async () => json(rows) });
    await assert.rejects(client.listOwnerHiggsfieldDopMotions(), (error: unknown) =>
      error instanceof SyntxHttpError && error.code === "UPSTREAM_PROTOCOL_ERROR");
  }
});

test("2380 preserves one or two exact selected picker objects and native ID types in the DOP wire", () => {
  const selected = [pickerMotion(17, "Numeric motion"), pickerMotion("17", "String motion")];
  const normalized = normalizeOwnerHiggsfieldDopParameters(input(selected));
  assert.deepEqual(normalized.intent.motions, selected);
  assert.equal(typeof normalized.intent.motions[0]?.id, "number");
  assert.equal(typeof normalized.intent.motions[1]?.id, "string");

  const wire = buildOwnerHiggsfieldDopWire(input(selected), { url: IMAGE_URL, sha256: "a".repeat(64), width: 160, height: 90 });
  assert.deepEqual(wire.wire.settings.motions, selected);
  assert.equal(wire.wire.settings.motions[0]?.id, 17);
  assert.equal(wire.wire.settings.motions[1]?.id, "17");
  assert.notEqual(buildOwnerHiggsfieldDopWire(input([selected[0]]), {
    url: IMAGE_URL, sha256: "a".repeat(64), width: 160, height: 90
  }).intent_fingerprint, buildOwnerHiggsfieldDopWire(input([selected[1]]), {
      url: IMAGE_URL, sha256: "a".repeat(64), width: 160, height: 90
    }).intent_fingerprint);
});

test("2380 rejects empty, oversized, duplicate, or malformed motion selections", () => {
  const valid = pickerMotion(17);
  for (const motions of [[], [valid, valid], [valid, pickerMotion("17"), pickerMotion(18)],
    [{ id: 17, label: "Soft orbit", strength: 2 }], [{ id: 17, label: "Soft orbit" }],
    [{ id: -1, label: "Soft orbit", strength: 1 }], [{ id: "orbit-soft", label: "", strength: 1 }],
    [{ id: 17, label: "Soft orbit", strength: 1, extra: true }]]) {
    assert.throws(() => normalizeOwnerHiggsfieldDopParameters(input(motions)), { code: "INVALID_PARAMETERS" });
  }
});
