import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import test from "node:test";
import {
  createOwnerSeedreamImageOwnedReferenceBindingIssuer,
  isOwnerSeedreamImagePreparedCandidateForPrincipal,
  prepareOwnerSeedreamImageRequest,
  type OwnerSeedreamImageOwnedReferenceResolverContext
} from "../src/application/owner-seedream-image-request-preparer.js";
import { createOwnerSeedreamSourceAlphaWitness } from "../src/application/owner-seedream-source-alpha-witness.js";
import { DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION, loadSelectedDiscoveryCatalog } from "../src/catalog/selected-discovery-catalog.js";

const catalog = loadSelectedDiscoveryCatalog(DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION).discoveryCatalog;
const VERSION = DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION;
const NOW = Date.parse("2026-10-11T00:00:00.000Z");
const PRINCIPAL = Object.freeze({ tenant_id: "tenant_seedream", subject_id: "owner_test", connection_id: "link_seedream_test_0123456789" });
const HANDLES = Array.from({ length: 14 }, (_, index) => `seedream_image_00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`);
const RATIOS = ["21:9", "16:9", "3:2", "4:3", "1:1", "3:4", "2:3", "9:16"] as const;
const RESOLUTIONS = {
  "seedream-4": ["1K", "2K", "4K"], "seedream-4.5": ["2K", "4K"], "seedream-5": ["2K", "3K", "4K"],
  "seedream-5.0-flash": ["1K", "1.5K", "2K"], "seedream-5.0-pro": ["1K", "2K"]
} as const;
const VARIANTS = Object.keys(RESOLUTIONS) as (keyof typeof RESOLUTIONS)[];
let clock = NOW;
const options = { catalog, catalog_version: VERSION, now: () => clock };

function resolver(index: number, extra: Record<string, unknown> = {}) {
  return async (context: Readonly<OwnerSeedreamImageOwnedReferenceResolverContext>) => {
    const resolvedIndex = index < 0 ? HANDLES.indexOf(context.reference_handle) : index;
    return { ...context,
    file_url: `https://r2.syntx.ai/private/seedream/${resolvedIndex}.png`, source_mime_type: "image/png", mime_type: "image/png", width: 1200, height: 800,
    size: 2048, sha256: `sha256:${String(resolvedIndex + 1).padStart(64, "0")}`, expires_at: NOW + 600_000,
    metadata_confidence: "CONTAINER_METADATA_ONLY" as const, source_alpha_witness: null, ...extra };
  };
}

function crc32(bytes: Buffer): number {
  let crc = 0xffff_ffff;
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb8_8320 : 0); }
  return (crc ^ 0xffff_ffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const header = Buffer.alloc(4); header.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(body));
  return Buffer.concat([header, body, checksum]);
}
function rgbaPng(alpha: number): Buffer {
  const width = 15, height = 15, ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4); ihdr[8] = 8; ihdr[9] = 6;
  const rows = Array.from({ length: height }, () => Buffer.from([0, ...Array.from({ length: width }, () => [20, 40, 60, alpha]).flat()]));
  const chunk = (type: string, data: Buffer) => pngChunk(type, data);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0))]);
}

test("all 104 source ratio/resolution combinations retain exact full wire controls", async () => {
  clock = NOW;
  let count = 0;
  for (const variant of VARIANTS) {
    const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(HANDLES.indexOf(context.reference_handle))(context), options);
    const referenceCount = 0;
    const referenceSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant, reference_handles: [] });
    for (const aspect_ratio of RATIOS) for (const resolution of RESOLUTIONS[variant]) {
      const flash = variant === "seedream-5.0-flash";
      const parameters = { aspect_ratio, resolution, output_format: flash ? "png" : null, background: flash ? "opaque" : null };
      const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
        parameters, reference_set: referenceSet, prompt: "  preserve my wording 🙂  " }, options);
      assert.deepEqual(candidate.parameters, parameters);
      assert.equal(candidate.request.settings.aspect_ratio, aspect_ratio);
      assert.equal(candidate.request.settings.resolution, resolution);
      assert.equal(candidate.request.settings.n, 1);
      assert.equal(candidate.request.settings.stream, false);
      assert.equal(Object.hasOwn(candidate.request.settings, "output_format"), flash);
      assert.equal(Object.hasOwn(candidate.request.settings, "background"), flash);
      assert.equal(candidate.dispatch_allowed, false);
      assert.equal(candidate.backend_acceptance, "UNPROVEN");
      assert.equal(candidate.prompt, "  preserve my wording 🙂  ");
      assert.deepEqual(candidate.cost_inputs, variant === "seedream-5.0-pro" ? { batch_size: referenceCount, resolution } : {});
      assert.equal(JSON.stringify(candidate).includes("r2.syntx.ai"), false);
      count += 1;
    }
    issuer.close();
  }
  assert.equal(count, 104);
});

test("all five source reference-count limits are admitted exactly and Pro cost uses count including zero", async () => {
  clock = NOW;
  const limits = { "seedream-4": 4, "seedream-4.5": 4, "seedream-5": 14, "seedream-5.0-flash": 10, "seedream-5.0-pro": 10 } as const;
  for (const variant of VARIANTS) {
    const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(-1)(context), options);
    const references = HANDLES.slice(0, limits[variant]);
    const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant, reference_handles: references });
    const flash = variant === "seedream-5.0-flash";
    const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
      parameters: { aspect_ratio: "1:1", resolution: RESOLUTIONS[variant][0], output_format: flash ? "jpeg" : null, background: flash ? "opaque" : null },
      reference_set: set, prompt: "maximum refs" }, options);
    assert.equal(candidate.reference_count, limits[variant]);
    assert.deepEqual(candidate.cost_inputs, variant === "seedream-5.0-pro" ? { batch_size: limits[variant], resolution: RESOLUTIONS[variant][0] } : {});
    await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant,
      reference_handles: [...references, HANDLES[limits[variant]!]!] }));
    issuer.close();
  }
});

test("source MIME, model-specific image byte caps, strict DTOs, and source pins are enforced", async () => {
  clock = NOW;
  const badMime = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    source_mime_type: "image/bmp", mime_type: "image/bmp"
  })(context), options);
  await assert.rejects(badMime.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [HANDLES[0]!] }));
  const tooLarge = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    size: 11_010_049
  })(context), options);
  await assert.rejects(tooLarge.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] }));
  const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0)(context), options);
  await assert.rejects(issuer.issue(new Proxy({}, {})));
  await assert.rejects(issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [HANDLES[0]!], extra: true }));
  const validSet = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] });
  assert.equal(Object.isFrozen(validSet), true);
  const longUrlIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, { expires_at: NOW + 3_600_000 })(context), options);
  const ttlSet = await longUrlIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [HANDLES[0]!] });
  assert.equal(ttlSet.expires_at, NOW + 15 * 60_000);
  const staleOptions = { ...options, catalog_version: "sha256-not-the-selected-catalog.json" };
  await assert.rejects(createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0)(context), staleOptions)
    .issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] }));
  badMime.close(); tooLarge.close(); issuer.close(); longUrlIssuer.close();
});

test("intent fingerprint survives relink and URL rotation while request fingerprint changes", async () => {
  clock = NOW;
  const otherPrincipal = Object.freeze({ ...PRINCIPAL, connection_id: "link_seedream_relinked_0123456789" });
  const firstIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    file_url: "https://r2.syntx.ai/private/seedream/original.png", expires_at: NOW + 300_000
  })(context), options);
  const firstSet = await firstIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [HANDLES[0]!] });
  const first = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4",
    parameters: { aspect_ratio: "4:3", resolution: "2K", output_format: null, background: null }, reference_set: firstSet, prompt: "same image" }, options);
  const secondIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    file_url: "https://r2.syntx.ai/private/seedream/relinked.png", expires_at: NOW + 240_000
  })(context), options);
  const secondSet = await secondIssuer.issue({ principal: otherPrincipal, attempt_id: otherPrincipal.connection_id, variant: "seedream-4", reference_handles: [HANDLES[1]!] });
  const second = prepareOwnerSeedreamImageRequest({ principal: otherPrincipal, attempt_id: otherPrincipal.connection_id, variant: "seedream-4",
    parameters: { aspect_ratio: "4:3", resolution: "2K", output_format: null, background: null }, reference_set: secondSet, prompt: "same image" }, options);
  assert.equal(first.intent_fingerprint, second.intent_fingerprint);
  assert.notEqual(first.request_fingerprint, second.request_fingerprint);
  firstIssuer.close(); secondIssuer.close();
});

test("expired active sets are pruned and invalidation/close revoke candidates already prepared", async () => {
  clock = NOW;
  const localIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(-1)(context), options);
  const set = await localIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] });
  const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4",
    parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, reference_set: set, prompt: "revoke" }, options);
  localIssuer.invalidateAttempt(PRINCIPAL.connection_id);
  assert.equal(isOwnerSeedreamImagePreparedCandidateForPrincipal(candidate, PRINCIPAL, PRINCIPAL.connection_id, NOW), false);
  localIssuer.close();

  clock = NOW;
  const rollbackIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(-1)(context), options);
  const rollbackSet = await rollbackIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] });
  clock = NOW - 1;
  assert.throws(() => prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4",
    parameters: { aspect_ratio: "1:1", resolution: "2K", output_format: null, background: null }, reference_set: rollbackSet, prompt: "clock" }, options),
  { code: "CLOCK_INVALID" });
  rollbackIssuer.close();

  clock = NOW;
  const bounded = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(-1)(context), options);
  for (let index = 0; index < 128; index += 1) await bounded.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] });
  await assert.rejects(bounded.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] }));
  clock = NOW + 15 * 60_000;
  const afterExpiry = await bounded.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-4", reference_handles: [] });
  assert.equal(afterExpiry.expires_at, clock + 15 * 60_000);
  bounded.close();
});

test("transparent Flash requires one owned PNG and a nominal matching source-alpha witness", async () => {
  clock = NOW;
  const bytes = rgbaPng(128);
  const sha256 = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const witness = createOwnerSeedreamSourceAlphaWitness(bytes);
  const issuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    width: 15, height: 15, size: bytes.byteLength, sha256, source_alpha_witness: witness
  })(context), options);
  const set = await issuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] });
  const candidate = prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
    reference_set: set, prompt: "transparent source" }, options);
  assert.equal(candidate.request.settings.output_format, "png");
  assert.equal(candidate.request.settings.background, "transparent");
  assert.equal(candidate.transparency_eligibility.source_alpha_eligible, true);
  assert.deepEqual(candidate.transparency_eligibility.sampled_source_dimensions, [{ width: 15, height: 15 }]);
  assert.equal(candidate.transparency_eligibility.browser_geometry_proven, false);
  assert.equal(candidate.dispatch_allowed, false);
  issuer.close();
});

test("a forged witness, wrong content hash, false sampled alpha, or mixed source is never transparency authority", async () => {
  clock = NOW;
  const bytes = rgbaPng(128);
  const digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
  const witness = createOwnerSeedreamSourceAlphaWitness(bytes);
  const wrongShaIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    width: 15, height: 15, size: bytes.byteLength, sha256: `sha256:${"0".repeat(64)}`, source_alpha_witness: witness
  })(context), options);
  await assert.rejects(wrongShaIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] }));
  const cloneIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => resolver(0, {
    width: 15, height: 15, size: bytes.byteLength, sha256: digest, source_alpha_witness: Object.freeze(Object.create(null))
  })(context), options);
  await assert.rejects(cloneIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] }));

  const opaqueBytes = rgbaPng(255);
  const opaqueWitness = createOwnerSeedreamSourceAlphaWitness(opaqueBytes);
  const opaqueSha = `sha256:${createHash("sha256").update(opaqueBytes).digest("hex")}`;
  const opaqueIssuer = createOwnerSeedreamImageOwnedReferenceBindingIssuer(async (context) => {
    const first = context.reference_handle === HANDLES[0];
    const resolved = await resolver(-1, { width: 15, height: 15, size: opaqueBytes.byteLength,
      source_mime_type: first ? "image/png" : "image/jpeg", mime_type: first ? "image/png" : "image/jpeg",
      source_alpha_witness: first ? opaqueWitness : null })(context);
    return { ...resolved, sha256: first ? opaqueSha : `sha256:${"2".repeat(64)}` };
  }, options);
  const opaqueSet = await opaqueIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!] });
  assert.throws(() => prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
    reference_set: opaqueSet, prompt: "no alpha" }, options));
  const mixed = await opaqueIssuer.issue({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id, variant: "seedream-5.0-flash", reference_handles: [HANDLES[0]!, HANDLES[1]!] });
  assert.throws(() => prepareOwnerSeedreamImageRequest({ principal: PRINCIPAL, attempt_id: PRINCIPAL.connection_id,
    variant: "seedream-5.0-flash", parameters: { aspect_ratio: "1:1", resolution: "1K", output_format: "png", background: "transparent" },
    reference_set: mixed, prompt: "mixed" }, options));
  wrongShaIssuer.close(); cloneIssuer.close(); opaqueIssuer.close();
});
