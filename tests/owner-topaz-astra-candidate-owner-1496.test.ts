import assert from "node:assert/strict";
import { mkdtemp, writeFile, chmod, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SyntxChatHttpClient } from "../src/adapter/syntx/chat-http-client.js";
import type { SyntxCredentialBroker } from "../src/adapter/syntx/http-client.js";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider } from "../src/auth/types.js";
import { createOwnerTopazAstraOwnedRequestPreparer, type OwnerTopazAstraOwnedRequestPreparer } from "../src/application/owner-topaz-astra-owned-request-preparer.js";
import { OwnerTopazAstraOriginalReferenceService } from "../src/application/owner-topaz-astra-original-reference-service.js";
import test from "node:test";

const ATTEMPT = "link_topaz_candidate_owner_1496";
const BINDING = Object.freeze({ tenant_id: "topaz-owned-tenant", subject: "topaz-owned-subject" });
const SOURCE = Uint8Array.from([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d,
  0, 0, 2, 0, 0x69, 0x73, 0x6f, 0x6d, 0x6d, 0x70, 0x34]);

function broker(): SyntxCredentialBroker {
  return { async useCredential<T>(operation: (credential: string) => Promise<T>) { return operation("synthetic-topaz-credential"); } };
}
function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

test("Topaz owned candidate is visible only to the preparer instance that created it", async () => {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-owner-1496-")), ffprobe = join(directory, "ffprobe");
  await writeFile(ffprobe, "#!/bin/sh\nprintf '%s' '{\"streams\":[{\"codec_type\":\"video\",\"codec_name\":\"h264\",\"width\":640,\"height\":360,\"nb_read_frames\":\"72\"}],\"format\":{\"format_name\":\"mov,mp4,m4a,3gp,3g2,mj2\",\"duration\":\"3.2\"}}'\n");
  await chmod(ffprobe, 0o700);
  let nextAttempt = 0;
  const provider: AuthLinkProvider = { authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() { return { upstream_attempt_id: "synthetic-link", approval_url: "https://example.invalid/approve" }; },
    async pollChallenge(_id, receiveCredential) { await receiveCredential({ scheme: "Bearer", value: "synthetic-owner-token" }); return { state: "LINKED" }; } };
  const now = () => 1_000;
  const links = new PerUserLinkService(provider, new InMemoryAuthLinkStore(now), { now, attemptIdGenerator: () => [ATTEMPT][nextAttempt++]! });
  await links.createAttempt(BINDING); await links.issueHandoff(BINDING, ATTEMPT); await links.checkAttempt(BINDING, ATTEMPT);
  const client = new SyntxChatHttpClient({ credentialBroker: broker(), fetchImpl: async () => jsonResponse({ files: [{
    filename: "source.mp4", url: "https://r2.syntx.ai/topaz/owned/1496.mp4", status: "success", size: SOURCE.byteLength,
    content_type: "video/mp4", duration: 3.2
  }] }) });
  const service = new OwnerTopazAstraOriginalReferenceService({ ffprobePath: ffprobe, destination: "hidden", binding: BINDING,
    linkService: links, resolveClient: () => client, now });
  const owner: OwnerTopazAstraOwnedRequestPreparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: service, now });
  const other: OwnerTopazAstraOwnedRequestPreparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService: service, now });
  try {
    const uploaded = await service.uploadOriginal({ attemptId: ATTEMPT, model_id: "slc-1", filename: "source.mp4", mime_type: "video/mp4", bytes: SOURCE });
    const candidate = await owner.prepare({ attemptId: ATTEMPT, topaz_original_handle: uploaded.topaz_original_handle,
      model_id: "slc-1", parameters: { resolution: "1920x1080", frame_rate: 24, slowmo: null, creativity: "middle" } });
    assert.ok(owner.inspectCandidate(candidate));
    assert.equal(other.inspectCandidate(candidate), undefined);
    assert.throws(() => other.getPrivateRequest(candidate), (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "CANDIDATE_UNBOUND");
    await assert.rejects(() => other.revalidateCandidate(candidate), (error: unknown) => error instanceof Error &&
      "code" in error && error.code === "CANDIDATE_UNBOUND");
    assert.ok(owner.getPrivateRequest(candidate));
    assert.ok(await owner.revalidateCandidate(candidate));
  } finally {
    await owner.close(); await other.close(); await service.close(); await rm(directory, { recursive: true, force: true });
  }
});
