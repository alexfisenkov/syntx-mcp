import assert from "node:assert/strict";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { resolveOwnerReferencePrincipal } from "../src/auth/owner-reference-principal.js";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import test from "node:test";
import { OwnerWan26R2vReferenceService } from "../src/application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../src/application/owner-wan26-r2v-request-preparer.js";
import {
  consumeOwnerWan26R2vOneShotPermit, createOwnerWan26R2vOneShotPermit,
  OwnerWan26R2vOneShotPolicyError, revalidateOwnerWan26R2vOneShotPermit
} from "../src/application/owner-wan26-r2v-one-shot-policy.js";

const ATTEMPT = "link_wan26_r2v_oneshot_0123456789";
const BINDING = { tenant_id: "wan26-oneshot-test", subject: "owner" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII=", "base64");
function crc32(bytes: Uint8Array): number {
  let checksum = 0xffff_ffff;
  for (const byte of bytes) { checksum ^= byte; for (let bit = 0; bit < 8; bit += 1) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb8_8320 : 0); }
  return (checksum ^ 0xffff_ffff) >>> 0;
}
function image384(): Buffer {
  const bytes = Buffer.from(PNG); bytes.writeUInt32BE(384, 16); bytes.writeUInt32BE(384, 20);
  bytes.writeUInt32BE(crc32(bytes.subarray(12, 29)), 29); return bytes;
}
function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(use: (token: string) => Promise<T>) { return use("synthetic-wan26-one-shot-token"); } };
}
function uploadResponse(file: File): Response {
  return new Response(JSON.stringify({ files: [{ id: 1, url: "https://r2.syntx.ai/wan26-one-shot-fixture",
    filename: file.name, mime_type: file.type, content_type: file.type, type: "image", media_type: "image",
    status: "uploaded", size: file.size }] }), { status: 200, headers: { "content-type": "application/json" } });
}
async function linked(): Promise<PerUserLinkService> {
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "oneshot-fixture", approval_url: "https://example.invalid/" }; },
    async pollChallenge(_id, receive) { await receive({ scheme: "Bearer", value: "synthetic" }); return { state: "LINKED" }; }
  };
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(() => 1_000), {
    now: () => 1_000, attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  return links;
}
async function fixture(now: () => number = () => 1_000) {
  let uploadCount = 0;
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async (_url, init) => {
    const file = (init?.body as FormData).get("files"); assert.ok(file instanceof File); uploadCount += 1; return uploadResponse(file);
  } });
  const links = await linked();
  const references = new OwnerWan26R2vReferenceService({ binding: BINDING, linkService: links, resolveClient: () => client,
    ffmpegPath: "/unused/ffmpeg", ffprobePath: "/unused/ffprobe", now });
  const preparer = createOwnerWan26R2vRequestPreparer({ binding: BINDING, linkService: links, referenceService: references, now });
  const image = image384();
  async function candidate(model_id: "wan_26_r2v" | "wan_26_r2v_flash") {
    const uploaded = await references.uploadImage({ attemptId: ATTEMPT, model_id, content_base64: image.toString("base64"),
      filename: `${model_id}.png`, mime_type: "image/png" });
    return preparer.prepare({ attemptId: ATTEMPT, model_id, prompt: "ordinary multi-line\nprompt",
      parameters: { resolution: "1080P", aspect_ratio: "16:9", video_duration: 6, seed: 0,
        ...(model_id === "wan_26_r2v_flash" ? { native_audio: false } : {}) }, reference_handles: [uploaded.reference_handle] });
  }
  const principal = await resolveOwnerReferencePrincipal({ binding: BINDING, attemptId: ATTEMPT, linkService: links });
  return { client, links, references, preparer, image, candidate, principal };
}
async function close(value: Awaited<ReturnType<typeof fixture>>): Promise<void> {
  value.image.fill(0); await value.preparer.close(); await value.references.close();
}
function policyError(code: string) {
  return (error: unknown) => error instanceof OwnerWan26R2vOneShotPolicyError && error.code === code;
}

test("issues nominal permits for both genuine WAN26 R2V candidates and consumes once after revalidation", async () => {
  const f = await fixture();
  try {
    for (const model_id of ["wan_26_r2v", "wan_26_r2v_flash"] as const) {
      const candidate = await f.candidate(model_id);
      const input = { preparer: f.preparer, candidate, principal: f.principal, attemptId: ATTEMPT };
      const issued = await Promise.allSettled([createOwnerWan26R2vOneShotPermit(input), createOwnerWan26R2vOneShotPermit(input)]);
      assert.equal(issued.filter((result) => result.status === "fulfilled").length, 1);
      assert.equal(issued.filter((result) => result.status === "rejected" && policyError("CANDIDATE_ALREADY_ISSUED")(result.reason)).length, 1);
      const permit = issued.find((result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof createOwnerWan26R2vOneShotPermit>>> => result.status === "fulfilled")!.value;
      assert.equal(permit.model_id, model_id);
      assert.equal(permit.status, "nominal"); assert.equal(permit.dispatch_allowed, false); assert.equal(permit.backend_acceptance, "UNPROVEN");
      assert.equal(permit.source_readiness, "PARTIAL_SOURCE_EXPLICIT_SETTINGS");
      assert.equal(permit.prompt_readiness, "CURRENT_PROMPT_RULES_NOT_ESTABLISHED");
      assert.equal(permit.settings_readiness, "FULL_CURRENT_SETTINGS_NOT_ESTABLISHED");
      assert.equal(JSON.stringify(permit).includes("ordinary multi-line"), false);
      const context = { ...input, permit };
      assert.throws(() => consumeOwnerWan26R2vOneShotPermit(context), policyError("PERMIT_NOT_REVALIDATED"));
      await revalidateOwnerWan26R2vOneShotPermit(context);
      const consumed = consumeOwnerWan26R2vOneShotPermit(context);
      assert.equal(consumed.status, "consumed"); assert.equal(consumed.dispatch_allowed, false);
      assert.equal(consumed.backend_acceptance, "UNPROVEN");
      assert.equal(consumed.request.settings.model_type, model_id);
      assert.equal(consumed.request.prompt, "ordinary multi-line\nprompt");
      assert.throws(() => consumeOwnerWan26R2vOneShotPermit(context), policyError("PERMIT_ALREADY_CONSUMED"));
    }
  } finally { await close(f); }
});

test("rejects copied, foreign and mismatched identities; revalidation cannot survive revocation or expiry", async () => {
  let now = 10;
  const f = await fixture(() => now);
  try {
    const candidate = await f.candidate("wan_26_r2v");
    const input = { preparer: f.preparer, candidate, principal: f.principal, attemptId: ATTEMPT };
    await assert.rejects(createOwnerWan26R2vOneShotPermit({ ...input, candidate: { ...candidate } }), policyError("CANDIDATE_UNBOUND"));
    const permit = await createOwnerWan26R2vOneShotPermit(input);
    const context = { ...input, permit };
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...context, principal: { ...f.principal, subject_id: "other" } }), policyError("PRINCIPAL_MISMATCH"));
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...context, attemptId: "link_other_attempt_0123456789" }), policyError("PRINCIPAL_MISMATCH"));
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...context, permit: { ...permit } }), policyError("PERMIT_INVALID"));
    const foreign = await fixture();
    try {
      await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...context, preparer: foreign.preparer }), policyError("CANDIDATE_MISMATCH"));
    } finally { await close(foreign); }
    const otherCandidate = await f.candidate("wan_26_r2v_flash");
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...context, candidate: otherCandidate }), policyError("CANDIDATE_MISMATCH"));
    await f.links.revoke(BINDING, ATTEMPT);
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit(context), (error: unknown) => error instanceof Error);
    assert.throws(() => consumeOwnerWan26R2vOneShotPermit(context), policyError("PERMIT_NOT_REVALIDATED"));
  } finally { await close(f); }
});

test("expires permits with their candidate and refuses a closed preparer", async () => {
  let now = 10;
  const f = await fixture(() => now);
  const candidate = await f.candidate("wan_26_r2v_flash");
  const input = { preparer: f.preparer, candidate, principal: f.principal, attemptId: ATTEMPT };
  const permit = await createOwnerWan26R2vOneShotPermit(input);
  const context = { ...input, permit };
  try {
    await revalidateOwnerWan26R2vOneShotPermit(context);
    now += 15 * 60_000;
    assert.throws(() => consumeOwnerWan26R2vOneShotPermit(context), policyError("CANDIDATE_EXPIRED"));
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit(context), (error: unknown) => error instanceof Error);
  } finally { await close(f); }
  const closed = await fixture();
  try {
    const closedCandidate = await closed.candidate("wan_26_r2v");
    const closedInput = { preparer: closed.preparer, candidate: closedCandidate, principal: closed.principal, attemptId: ATTEMPT };
    const closedPermit = await createOwnerWan26R2vOneShotPermit(closedInput);
    await closed.preparer.close();
    await assert.rejects(revalidateOwnerWan26R2vOneShotPermit({ ...closedInput, permit: closedPermit }), policyError("CANDIDATE_EXPIRED"));
  } finally { await close(closed); }
});
