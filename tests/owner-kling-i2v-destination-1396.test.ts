import assert from "node:assert/strict";
import test from "node:test";
import { resolve } from "node:path";
import { InMemoryAuthLinkStore } from "../src/auth/in-memory-auth-store.js";
import { PerUserLinkService } from "../src/auth/link-service.js";
import type { AuthLinkProvider, AuthBinding } from "../src/auth/types.js";
import { createObservedOwnerRuntime } from "../src/runtime/observed-owner-runtime.js";

const ATTEMPT = "link_kling_i2v_destination_1396";
const BINDING: AuthBinding = Object.freeze({ tenant_id: "synthetic-tenant", subject: "synthetic-owner" });
const NOW = Date.parse("2026-10-15T00:00:00.000Z");
const JPEG = Buffer.from([
  0xff, 0xd8, 0xff, 0xc0, 0x00, 0x0b, 0x08, 0x01, 0x2c, 0x01, 0x2c, 0x01, 0x01, 0x11, 0,
  0xff, 0xda, 0x00, 0x08, 1, 1, 0, 0, 0x3f, 0, 0, 0xff, 0xd9
]);
const UPLOAD_URL = "https://r2.syntx.ai/uploaded/kling-frame.jpg";

async function seedLinkedAttempt(store: InMemoryAuthLinkStore): Promise<void> {
  const provider: AuthLinkProvider = {
    authorizationProfile: "OBSERVED_OWNER_AUTHORIZED",
    async createChallenge() {
      return { upstream_attempt_id: "synthetic-auth-attempt", approval_url: "https://example.invalid/approve" };
    },
    async pollChallenge(_id, receive) {
      await receive({ scheme: "Bearer", value: "synthetic-linked-token" });
      return { state: "LINKED" };
    }
  };
  const links = new PerUserLinkService(provider, store, {
    now: () => NOW,
    defaultTtlMs: 30 * 60_000,
    attemptIdGenerator: () => ATTEMPT
  });
  await links.createAttempt(BINDING);
  await links.issueHandoff(BINDING, ATTEMPT);
  await links.checkAttempt(BINDING, ATTEMPT);
}

test("Kling I2V runtime sends its image reference to the uploaded destination", async () => {
  const authStore = new InMemoryAuthLinkStore(() => NOW);
  await seedLinkedAttempt(authStore);
  const destinations: FormDataEntryValue[] = [];
  let uploadCalls = 0;
  const fetchImpl: typeof fetch = async (_request, init) => {
    uploadCalls += 1;
    assert.equal(init?.method, "POST");
    assert.ok(init?.body instanceof FormData);
    const form = init.body;
    const destination = form.get("destination");
    assert.ok(destination !== null);
    destinations.push(destination);
    assert.equal(form.get("model_type"), "kling_image2video");
    assert.equal(form.get("check_duplicates"), "true");
    return Response.json({ files: [{ id: "synthetic-file-id", url: UPLOAD_URL }] });
  };
  const runtime = createObservedOwnerRuntime({ ownerKlingI2vEnabled: true, authStore, authBinding: BINDING, fetchImpl,
    catalogDirectory: resolve(process.cwd(), "catalog"), now: () => NOW });
  const composition = runtime.serverOptions.ownerKlingI2v;
  assert.ok(composition);
  try {
    const receipt = await composition.referenceService.upload({
      attemptId: ATTEMPT,
      content_base64: JPEG.toString("base64"),
      filename: "kling-frame.jpg",
      mime_type: "image/jpeg"
    });
    assert.equal(receipt.status, "uploaded");
    assert.deepEqual(destinations, ["uploaded"]);
    assert.equal(uploadCalls, 1);
  } finally {
    await runtime.ownerKlingI2vLifecycle?.close();
    runtime.authStore.close?.();
  }
});
