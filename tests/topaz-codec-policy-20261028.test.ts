import assert from "node:assert/strict";
import test from "node:test";
import { chmod, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadPublicCatalogVersion } from "../src/catalog/public-catalog-history.js";
import {
  getReviewedTopazCodecPolicy,
  REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION
} from "../src/application/reviewed-topaz-codec-policy-20261028.js";
import {
  releaseTrustedOwnerTopazAstraOriginalProbeResult,
  createOwnerTopazAstraOriginalProbe,
  OwnerTopazAstraOriginalProbeError
} from "../src/application/owner-topaz-astra-original-probe.js";
import {
  releaseTrustedOwnerTopazEnhanceOriginalProbeResult,
  createOwnerTopazEnhanceOriginalProbe,
  OwnerTopazEnhanceOriginalProbeError
} from "../src/application/owner-topaz-enhance-original-probe.js";

const PUBLIC_MODELS_SHA256 = "sha256:b8b18eb666389f10227eed1940364c5aae5c848658d4c7d05301a0ff14a8c03b";
const PROHIBITED_CODECS = ["xvid", "divx", "dx50", "mjpg", "dvsd", "wmv3", "iv50"] as const;

function mp4Bytes(): Uint8Array {
  const bytes = new Uint8Array(28);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 20);
  bytes.set(new TextEncoder().encode("ftypisom"), 4);
  view.setUint32(12, 0);
  bytes.set(new TextEncoder().encode("mp41"), 16);
  view.setUint32(20, 8);
  bytes.set(new TextEncoder().encode("mdat"), 24);
  return bytes;
}

function astraInput(modelId = "slp-2.5") {
  return { model_id: modelId, filename: "source.mp4", mime_type: "video/mp4", bytes: new Uint8Array(64) };
}

function enhanceInput() {
  return { model_id: "topaz_enhance", ai_name: "topaz_ai",
    source_catalog_version: "sha256-1d8e35274b0e0c6198cc60ea58899c35b32bd94fd3ea28911c6b2be5747e30a0.json",
    filename: "source.mp4", mime_type: "video/mp4", bytes: mp4Bytes() };
}

function ffprobeJson(codecName: string, codecTagString?: string): string {
  const video = { codec_type: "video", codec_name: codecName,
    ...(codecTagString === undefined ? {} : { codec_tag_string: codecTagString }),
    width: 640, height: 360, nb_read_frames: "60", duration: "2.000000", disposition: { attached_pic: 0 } };
  return JSON.stringify({ streams: [video], format: { format_name: "mov,mp4,m4a,3gp,3g2,mj2", duration: "2.000000" } });
}

async function fakeFfprobe(output: string): Promise<{ directory: string; binary: string; marker: string }> {
  const directory = await mkdtemp(join(tmpdir(), "syntx-topaz-codec-policy-"));
  const binary = join(directory, "ffprobe-fixture");
  const marker = join(directory, "ffprobe-invoked");
  const quoted = `'${output.replaceAll("'", "'\\''")}'`;
  await writeFile(binary, `#!/bin/sh\nprintf invoked > '${marker}'\nprintf '%s' ${quoted}\n`, { mode: 0o700, flag: "wx" });
  await chmod(binary, 0o700);
  return { directory, binary: await realpath(binary), marker };
}

test("Oct 28 archive contains the exact reviewed codec denylist for both Topaz models", () => {
  const snapshot = loadPublicCatalogVersion("sha256-9b6dcd56111193e51922492c584519844dde3bd010e08ad8b84ba766636c961b.json");
  assert.equal(snapshot.sources.models.canonical_sha256, PUBLIC_MODELS_SHA256);
  for (const modelId of ["slp-2.5", "topaz_enhance"]) {
    const model = snapshot.models.find((entry) => entry.value === modelId);
    assert.ok(model?.settings);
    assert.deepEqual(model.settings.prohibited_codecs, PROHIBITED_CODECS);
  }
});

test("policy carries independent model/source pins and is scoped to the two changed models", () => {
  const astra = getReviewedTopazCodecPolicy("slp-2.5");
  const enhance = getReviewedTopazCodecPolicy("topaz_enhance");
  assert.ok(astra);
  assert.ok(enhance);
  assert.equal(astra.public_catalog_version, REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION);
  assert.equal(astra.public_models_sha256, PUBLIC_MODELS_SHA256);
  assert.equal(astra.settings_sha256, "sha256:cb29f2502be321e8d26eb14a3c1395c10dae6153ff588ea02b6a80f96dbb65f8");
  assert.equal(enhance.settings_sha256, "sha256:a9a1e9d68495af8be30396ef49c595ebea979b93168880cf61c42e683d1525df");
  assert.deepEqual(astra.prohibited_codecs, PROHIBITED_CODECS);
  assert.deepEqual(enhance.prohibited_codecs, PROHIBITED_CODECS);
  assert.equal(getReviewedTopazCodecPolicy("slc-1"), null);
});

test("matches the prohibited tag string case-insensitively when codec_name is generic", async () => {
  for (const codec of PROHIBITED_CODECS) {
    const fixture = await fakeFfprobe(ffprobeJson("mpeg4", codec.toUpperCase()));
    try {
      await assert.rejects(
        createOwnerTopazAstraOriginalProbe({ ffprobePath: fixture.binary }).probe(astraInput()),
        (error: unknown) => error instanceof OwnerTopazAstraOriginalProbeError && String(error.code) === "PROHIBITED_VIDEO_CODEC",
        codec
      );
      assert.equal(await readFile(fixture.marker, "utf8"), "invoked");
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }

  const directName = await fakeFfprobe(ffprobeJson("wmv3", "avc1"));
  try {
    await assert.rejects(
      createOwnerTopazEnhanceOriginalProbe({ ffprobePath: directName.binary }).probe(enhanceInput()),
      (error: unknown) => error instanceof OwnerTopazEnhanceOriginalProbeError && String(error.code) === "PROHIBITED_VIDEO_CODEC"
    );
  } finally {
    await rm(directName.directory, { recursive: true, force: true });
  }
});

test("rejects missing codec tag metadata for affected models but keeps other Astra models unchanged", async () => {
  const affected = await fakeFfprobe(ffprobeJson("h264"));
  try {
    await assert.rejects(
      createOwnerTopazAstraOriginalProbe({ ffprobePath: affected.binary }).probe(astraInput("slp-2.5")),
      (error: unknown) => error instanceof OwnerTopazAstraOriginalProbeError && String(error.code) === "VIDEO_CODEC_METADATA_UNAVAILABLE"
    );
  } finally {
    await rm(affected.directory, { recursive: true, force: true });
  }

  const unaffected = await fakeFfprobe(ffprobeJson("mpeg4", "XVID"));
  try {
    const result = await createOwnerTopazAstraOriginalProbe({ ffprobePath: unaffected.binary }).probe(astraInput("slc-1"));
    assert.equal(result.metadata.codec_name, "mpeg4");
    releaseTrustedOwnerTopazAstraOriginalProbeResult(result);
  } finally {
    await rm(unaffected.directory, { recursive: true, force: true });
  }
});

test("rejects a prohibited codec before minting an uploadable Topaz Enhance probe result", async () => {
  const fixture = await fakeFfprobe(ffprobeJson("mpeg4", "DIVX"));
  try {
    await assert.rejects(
      createOwnerTopazEnhanceOriginalProbe({ ffprobePath: fixture.binary }).probe(enhanceInput()),
      (error: unknown) => error instanceof OwnerTopazEnhanceOriginalProbeError && String(error.code) === "PROHIBITED_VIDEO_CODEC"
    );
    assert.equal(await readFile(fixture.marker, "utf8"), "invoked");
  } finally {
    await rm(fixture.directory, { recursive: true, force: true });
  }
});

test("preserves H.264, HEVC and other nonlisted codec names", async () => {
  for (const [codecName, codecTag] of [
    ["h264", "avc1"], ["hevc", "hvc1"], ["mpeg4", "mp4v"], ["mpeg4", "vp09"],
    ["rawvideo", "raw "], ["mpeg4", "[0][0][0][0]"]
  ] as const) {
    const fixture = await fakeFfprobe(ffprobeJson(codecName, codecTag));
    try {
      const result = await createOwnerTopazEnhanceOriginalProbe({ ffprobePath: fixture.binary }).probe(enhanceInput());
      assert.ok(result);
      releaseTrustedOwnerTopazEnhanceOriginalProbeResult(result);
    } finally {
      await rm(fixture.directory, { recursive: true, force: true });
    }
  }
});
