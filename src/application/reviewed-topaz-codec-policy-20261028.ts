import {
  loadPublicCatalogVersion
} from "../catalog/public-catalog-history.js";
import {
  sha256CanonicalPayload
} from "../catalog/syntx-public-catalog.js";

export const REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION =
  "sha256-9b6dcd56111193e51922492c584519844dde3bd010e08ad8b84ba766636c961b.json" as const;
export const REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_MODELS_SHA256 =
  "sha256:b8b18eb666389f10227eed1940364c5aae5c848658d4c7d05301a0ff14a8c03b" as const;

const POLICY_MODELS = Object.freeze({
  "slp-2.5": "topaz_astra",
  topaz_enhance: "topaz_ai"
} as const);
const EXPECTED_PROHIBITED_CODECS = Object.freeze([
  "xvid", "divx", "dx50", "mjpg", "dvsd", "wmv3", "iv50"
] as const);
const CODEC_TOKEN = /^[a-z0-9_+-]{1,64}$/iu;
const PRINTABLE_CODEC_TAG = /^[\x20-\x7e]{1,64}$/u;
const policyCache = new Map<keyof typeof POLICY_MODELS, Readonly<ReviewedTopazCodecPolicy>>();

export interface ReviewedTopazCodecPolicy {
  readonly model_id: keyof typeof POLICY_MODELS;
  readonly ai_name: (typeof POLICY_MODELS)[keyof typeof POLICY_MODELS];
  readonly public_catalog_version: typeof REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION;
  readonly public_models_sha256: typeof REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_MODELS_SHA256;
  readonly settings_sha256: `sha256:${string}`;
  readonly prohibited_codecs: readonly string[];
}

export class ReviewedTopazCodecPolicyError extends Error {
  constructor(readonly code: "CODEC_POLICY_UNAVAILABLE" | "VIDEO_CODEC_METADATA_UNAVAILABLE" | "PROHIBITED_VIDEO_CODEC") {
    super("The reviewed Topaz codec policy rejected this media input.");
    this.name = "ReviewedTopazCodecPolicyError";
  }
}

/** Loads only the source-hash-pinned Oct 28 archive; it performs no network access. */
export function getReviewedTopazCodecPolicy(modelId: string): Readonly<ReviewedTopazCodecPolicy> | null {
  if (!Object.hasOwn(POLICY_MODELS, modelId)) return null;
  const typedModelId = modelId as keyof typeof POLICY_MODELS;
  const cached = policyCache.get(typedModelId);
  if (cached) return cached;

  try {
    const snapshot = loadPublicCatalogVersion(REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION);
    if (snapshot.sources.models.canonical_sha256 !== REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_MODELS_SHA256) {
      throw new Error("TOPAZ_CODEC_POLICY_SOURCE_HASH_MISMATCH");
    }
    const model = snapshot.models.find((entry) => entry.value === typedModelId);
    const expectedAiName = POLICY_MODELS[typedModelId];
    const prohibited = model?.settings?.prohibited_codecs;
    if (snapshot.runtime_usable !== false || !model || !model.active || model.ai_name !== expectedAiName ||
        !Array.isArray(prohibited) || prohibited.length !== EXPECTED_PROHIBITED_CODECS.length ||
        prohibited.some((codec, index) => codec !== EXPECTED_PROHIBITED_CODECS[index])) {
      throw new Error("TOPAZ_CODEC_POLICY_ENTRY_INVALID");
    }
    const policy = Object.freeze({
      model_id: typedModelId,
      ai_name: expectedAiName,
      public_catalog_version: REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_VERSION,
      public_models_sha256: REVIEWED_TOPAZ_CODEC_POLICY_PUBLIC_MODELS_SHA256,
      settings_sha256: sha256CanonicalPayload(model.settings) as `sha256:${string}`,
      prohibited_codecs: Object.freeze([...prohibited])
    });
    policyCache.set(typedModelId, policy);
    return policy;
  } catch {
    throw new ReviewedTopazCodecPolicyError("CODEC_POLICY_UNAVAILABLE");
  }
}

/** Checks both ffprobe codec name and tag without guessing aliases. */
export function assertReviewedTopazVideoCodecAllowed(
  policy: Readonly<ReviewedTopazCodecPolicy> | null,
  codecName: unknown,
  codecTagString: unknown
): void {
  if (policy === null) return;
  if (typeof codecName !== "string" || !CODEC_TOKEN.test(codecName) ||
      typeof codecTagString !== "string" || !PRINTABLE_CODEC_TAG.test(codecTagString) || codecTagString.trim().length === 0) {
    throw new ReviewedTopazCodecPolicyError("VIDEO_CODEC_METADATA_UNAVAILABLE");
  }
  const prohibited = new Set(policy.prohibited_codecs.map((codec) => codec.toLowerCase()));
  if (prohibited.has(codecName.toLowerCase()) || prohibited.has(codecTagString.trim().toLowerCase())) {
    throw new ReviewedTopazCodecPolicyError("PROHIBITED_VIDEO_CODEC");
  }
}
