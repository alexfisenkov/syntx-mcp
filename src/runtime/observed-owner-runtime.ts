import { LinkedAttemptCredentialBroker } from "../adapter/syntx/link-credential-broker.js";
import { createOwnerVeoOmniT2vRuntime } from "./owner-veo-omni-t2v-runtime.js";
import { createOwnerVeoOmniReferenceRuntime, getOwnerVeoOmniReferenceRuntimeStartupCleanup } from "./owner-veo-omni-reference-runtime.js";
import { SyntxChatHttpClient } from "../adapter/syntx/chat-http-client.js";
import { SyntxHttpClient, isSyntxModelInfoCallerParameterKey } from "../adapter/syntx/http-client.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { GenerationContractExecutor } from "../adapter/syntx/generation-contract-executor.js";
import { GenerationContractExecutorV2 } from "../adapter/syntx/generation-contract-executor-v2.js";
import { createDefaultApplication } from "../application/factory.js";
import { OwnerContractMediaRecoveryStore } from "../application/owner-contract-media-recovery.js";
import { OwnerImageReferenceService } from "../application/owner-image-reference-service.js";
import { OwnerKlingI2VImageReferenceService } from "../application/owner-kling-i2v-reference-service.js";
import { OwnerKlingI2vGenerationService } from "../application/owner-kling-i2v-generation-service.js";
import { OwnerKlingKeyframesReferenceService } from "../application/owner-kling-keyframes-reference-service.js";
import { createOwnerKlingKeyframesRequestPreparer } from "../application/owner-kling-keyframes-request-preparer.js";
import { OwnerKlingKeyframesGenerationService, OWNER_KLING_KEYFRAMES_GENERATION_CATALOG_VERSION } from "../application/owner-kling-keyframes-generation-service.js";
import { OwnerKlingMotionControlReferenceService } from "../application/owner-kling-motion-control-reference-service.js";
import { OwnerKlingMotionControlPresetReferenceService } from "../application/owner-kling-motion-control-preset-reference-service.js";
import { createOwnerKlingMotionControlRequestPreparer } from "../application/owner-kling-motion-control-request-preparer.js";
import { OwnerKlingMotionControlGenerationService, OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION } from "../application/owner-kling-motion-control-generation-service.js";
import { OWNER_KLING_I2V_SOURCE_PINS } from "../application/owner-kling-i2v-parameters.js";
import { OwnerHailuo02I2vImageReferenceService } from "../application/owner-hailuo02-i2v-image-reference-service.js";
import { createOwnerHailuo02I2vRequestPreparer } from "../application/owner-hailuo02-i2v-request-preparer.js";
import { OwnerHailuo02I2vGenerationService, OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION } from "../application/owner-hailuo02-i2v-generation-service.js";
import { OWNER_HAILUO02_I2V_SOURCE_PINS } from "../application/owner-hailuo02-i2v-source-profile.js";
import { OwnerMediaReferenceStore } from "../application/owner-media-reference-store.js";
import { ModelAccessService } from "../application/model-access.js";
import { AccountStatusService } from "../application/account-status.js";
import { OwnerClarityUpscaleUploadService } from "../application/owner-clarity-upscale-upload-service.js";
import { OwnerClarityUpscaleGenerationService } from "../application/owner-clarity-upscale-generation-service.js";
import { OwnerMagnificUpscaleUploadService } from "../application/owner-magnific-upscale-upload-service.js";
import { OwnerMagnificUpscaleGenerationService } from "../application/owner-magnific-upscale-generation-service.js";
import { OwnerKontextImageUploadService } from "../application/owner-kontext-image-upload-service.js";
import { OwnerKontextImageGenerationService } from "../application/owner-kontext-image-generation-service.js";
import { OwnerWanImageUploadService } from "../application/owner-wan-image-upload-service.js";
import { OwnerWanImageGenerationService } from "../application/owner-wan-image-generation-service.js";
import { OwnerStandardImageUploadService } from "../application/owner-standard-image-upload-service.js";
import { OwnerStandardImageGenerationService } from "../application/owner-standard-image-generation-service.js";
import type { OwnerStandardImageGenerationPreflight } from "../application/owner-standard-image-generation-service.js";
import { OwnerRunwayImageUploadService } from "../application/owner-runway-image-upload-service.js";
import { OwnerRunwayImageGenerationService } from "../application/owner-runway-image-generation-service.js";
import type { OwnerRunwayImageGenerationPreflight } from "../application/owner-runway-image-generation-service.js";
import { OwnerSeedreamImageUploadService } from "../application/owner-seedream-image-upload-service.js";
import { OwnerSeedreamImageGenerationService } from "../application/owner-seedream-image-generation-service.js";
import type { OwnerSeedreamImageGenerationPreflight } from "../application/owner-seedream-image-generation-service.js";
import { OwnerSeedreamEditorOriginalReferenceService } from "../application/owner-seedream-editor-original-reference-service.js";
import { OwnerSeedreamEditorDrawingReferenceService } from "../application/owner-seedream-editor-drawing-reference-service.js";
import { createOwnerSeedreamEditorImageGenerationService } from "../application/owner-seedream-editor-image-generation-service.js";
import {
  OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
  OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION
} from "../application/owner-seedream-editor-original-upload-source-profile.js";
import { OwnerFluxImageUploadService } from "../application/owner-flux-image-upload-service.js";
import { OwnerFluxImageAssetService } from "../application/owner-flux-image-asset-service.js";
import { OwnerFluxImageGenerationService } from "../application/owner-flux-image-generation-service.js";
import type { OwnerFluxImageGenerationPreflight } from "../application/owner-flux-image-generation-service.js";
import { OwnerIdeogramImageUploadService } from "../application/owner-ideogram-image-upload-service.js";
import { OwnerIdeogramImageMaskUploadService } from "../application/owner-ideogram-image-mask-upload-service.js";
import { OwnerIdeogramImageGenerationService } from "../application/owner-ideogram-image-generation-service.js";
import type { OwnerIdeogramImageGenerationPreflight } from "../application/owner-ideogram-image-generation-service.js";
import { CivitaiPublicModelFileAttestor } from "../adapter/civitai/public-model-file-attestor.js";
import { loadGenerationContractRegistryV2 } from "../catalog/generation-contract-history-v2.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import { loadPublicCatalogVersion } from "../catalog/public-catalog-history.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import { OwnerBananaInpaintOriginalReferenceService } from "../application/owner-banana-inpaint-original-reference-service.js";
import { OwnerBananaInpaintPaintedCompositeReferenceService } from "../application/owner-banana-inpaint-painted-composite-reference-service.js";
import { OwnerBananaInpaintAuxiliaryReferenceService } from "../application/owner-banana-inpaint-auxiliary-reference-service.js";
import { createOwnerBananaInpaintImageGenerationService } from "../application/owner-banana-inpaint-image-generation-service.js";
import { OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION, OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION }
  from "../application/owner-banana-inpaint-original-upload-source-profile.js";
import { OwnerImageRecoveryStore } from "../application/owner-image-recovery.js";
import type { OwnerImageRecoveryStoreLike } from "../application/owner-image-recovery.js";
import { InMemoryAuthLinkStore } from "../auth/in-memory-auth-store.js";
import type { AuthLinkStore } from "../auth/auth-link-store.js";
import { PerUserLinkService } from "../auth/link-service.js";
import { ObservedSyntxAuthProvider } from "../auth/observed-syntx-provider.js";
import type { AuthBinding } from "../auth/types.js";
import {
  DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
  loadSelectedDiscoveryCatalog
} from "../catalog/selected-discovery-catalog.js";
import type { CreateMcpServerOptions } from "../mcp/server.js";
import type { OwnerVideoRecoveryStoreLike } from "../application/owner-video-recovery.js";
import { createOwnerGenerationPreflight } from "../application/owner-generation-preflight.js";
import { createReviewedContractPreflight } from "../application/reviewed-contract-preflight.js";
import { generationContractRegistrySchema } from "../domain/generation-contract.js";
import type { GenerationContractRegistry } from "../domain/generation-contract.js";
import { generationContractRegistryV2Schema } from "../domain/generation-contract-v2.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import { OwnerContractMediaService } from "../application/owner-contract-media.js";
import { OwnerGrokImageReferenceService } from "../application/owner-grok-image-reference-service.js";
import { OwnerGrokT2iImageUploadService } from "../application/owner-grok-t2i-image-upload-service.js";
import { OwnerGrokT2iRequestPreparer } from "../application/owner-grok-t2i-request-preparer.js";
import { OwnerGrokT2iGenerationService } from "../application/owner-grok-t2i-generation-service.js";
import type { OwnerGrokT2iGenerationPreflight } from "../application/owner-grok-t2i-generation-service.js";
import { OwnerSoulCatalogShapeService } from "../application/owner-soul-catalog-shape-service.js";
import { OwnerSoulCatalogShapeHttpClient } from "../adapter/syntx/owner-soul-catalog-shape-http-client.js";
import { OwnerSoulCharacterOptionsService } from "../application/owner-soul-character-options-service.js";
import { OwnerSoulCharacterCatalogHttpClient } from "../adapter/syntx/owner-soul-character-catalog-http-client.js";
import { OwnerSoulImageRequestPreparer } from "../application/owner-soul-image-request-preparer.js";
import { OwnerSoulImageGenerationService } from "../application/owner-soul-image-generation-service.js";
import { OwnerSoulStyleOptionsService } from "../application/owner-soul-style-options-service.js";
import { OwnerSoulStyleCatalogHttpClient } from "../adapter/syntx/owner-soul-style-catalog-http-client.js";
import type { OwnerGrokImageReferenceProfileSet } from "../catalog/owner-grok-image-reference-profiles.js";
import {
  getOwnerGrokImageReferenceProfile,
  type OwnerGrokImageReferenceProfileId
} from "../catalog/owner-grok-image-reference-profiles.js";
import { getOwnerGrokImageReferenceCandidateBinding } from "../application/owner-grok-image-reference-request-preparer.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { sameGenerationPrincipal } from "../domain/generation-principal.js";
import { resolveOwnerReferencePrincipal } from "../auth/owner-reference-principal.js";
import { isAbsolute } from "node:path";
import type { OwnerGrokImageReferencePreparedCandidate } from "../application/owner-grok-image-reference-request-preparer.js";
import { OwnerUniImageUploadService } from "../application/owner-uni-image-upload-service.js";
import { OwnerUniImageRequestPreparer } from "../application/owner-uni-image-request-preparer.js";
import { OwnerUniImageGenerationService, type OwnerUniImageGenerationPreflight } from "../application/owner-uni-image-generation-service.js";
import { OwnerWanT2iRequestPreparer } from "../application/owner-wan-t2i-request-preparer.js";
import { OwnerWanT2iGenerationService } from "../application/owner-wan-t2i-generation-service.js";
import { OwnerWanT2vGenerationService } from "../application/owner-wan-t2v-generation-service.js";
import { OwnerWan30FirstLastGenerationService } from "../application/owner-wan30-first-last-generation-service.js";
import { createOwnerWan30ReferenceGenerationService } from "../application/owner-wan30-reference-generation-service.js";
import { createOwnerWan30OmniGenerationService } from "../application/owner-wan30-omni-generation-service.js";
import { createOwnerWan30EditGenerationService } from "../application/owner-wan30-edit-generation-service.js";
import { createOwnerWan30EditOriginalProbe } from "../adapter/syntx/owner-wan30-edit-original-probe.js";
import { OwnerElevenLabsVoiceReferenceService } from "../application/owner-elevenlabs-voice-reference-service.js";
import { OwnerElevenLabsTtsGenerationService } from "../application/owner-elevenlabs-tts-generation-service.js";
import { OwnerElevenLabsDialogueGenerationService } from "../application/owner-elevenlabs-dialogue-generation-service.js";
import { OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION } from "../application/owner-elevenlabs-generation-parameters.js";
import { OwnerElevenLabsStsOriginalReferenceService } from "../application/owner-elevenlabs-sts-original-reference-service.js";
import { OwnerElevenLabsStsExistingMediaService } from "../application/owner-elevenlabs-sts-existing-media-service.js";
import { createOwnerElevenLabsStsRequestPreparer } from "../application/owner-elevenlabs-sts-request-preparer.js";
import { OwnerElevenLabsStsGenerationService, OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION } from "../application/owner-elevenlabs-sts-generation-service.js";
import { OwnerSunoGenerationService } from "../application/owner-suno-generation-service.js";
import { OWNER_SUNO_GENERATION_PUBLIC_VERSION } from "../application/owner-suno-generation-parameters.js";
import { OwnerLumaT2vContractService, OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION } from "../application/owner-luma-t2v-contract-service.js";
import { OwnerReviewedNoReferenceT2vService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo01T2vProfile } from "../application/owner-hailuo01-t2v-profile.js";
import { OwnerHailuo01DirectorT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo01DirectorT2vProfile } from "../application/owner-hailuo01-director-t2v-profile.js";
import { OwnerHailuo23T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo23T2vProfile } from "../application/owner-hailuo23-t2v-profile.js";
import { OwnerHailuo02T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuo02T2vProfile } from "../application/owner-hailuo02-t2v-profile.js";
import { OwnerSeedance20T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerSeedance20T2vProfile } from "../application/owner-seedance20-t2v-profile.js";
import { OwnerKlingT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerKlingT2vProfile } from "../application/owner-kling-t2v-profile.js";
import { OwnerVeoT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerVeoT2vProfile } from "../application/owner-veo-t2v-profile.js";
import { OwnerGrokT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerGrokT2vProfile } from "../application/owner-grok-t2v-profile.js";
import { OwnerHailuoLiveT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { createOwnerHailuoLiveT2vProfile } from "../application/owner-hailuo-live-t2v-profile.js";
import { createOwnerVideo2AudioSourceProfile } from "../application/owner-video2audio-source-profile.js";
import { OwnerVideo2AudioOriginalReferenceService } from "../application/owner-video2audio-original-reference-service.js";
import { createOwnerVideo2AudioRequestPreparer } from "../application/owner-video2audio-request-preparer.js";
import { OwnerVideo2AudioGenerationService } from "../application/owner-video2audio-generation-service.js";
import { OwnerTopazAstraOriginalReferenceService } from "../application/owner-topaz-astra-original-reference-service.js";
import { createOwnerTopazAstraOwnedRequestPreparer } from "../application/owner-topaz-astra-owned-request-preparer.js";
import { OwnerTopazAstraGenerationService, OWNER_TOPAZ_ASTRA_GENERATION_CATALOG_VERSION } from "../application/owner-topaz-astra-generation-service.js";
import { OwnerTopazAstraExistingMediaService } from "../application/owner-topaz-astra-existing-media-service.js";
import { OwnerTopazEnhanceOriginalReferenceService } from "../application/owner-topaz-enhance-original-reference-service.js";
import { createOwnerTopazEnhanceOwnedRequestPreparer } from "../application/owner-topaz-enhance-owned-request-preparer.js";
import { OwnerTopazEnhanceGenerationService, OWNER_TOPAZ_ENHANCE_GENERATION_CATALOG_VERSION } from "../application/owner-topaz-enhance-generation-service.js";
import { OwnerFlux3MediaReferenceService } from "../application/owner-flux3-media-reference-service.js";
import { createOwnerFlux3VideoOwnedRequestPreparer } from "../application/owner-flux3-video-owned-request-preparer.js";
import { createOwnerFlux3VideoGenerationService, OWNER_FLUX3_VIDEO_GENERATION_CATALOG_VERSION } from "../application/owner-flux3-video-generation-service.js";
import { OwnerGrokV2vOriginalReferenceService } from "../application/owner-grok-v2v-original-reference-service.js";
import { createOwnerGrokV2vOwnedRequestPreparer } from "../application/owner-grok-v2v-owned-request-preparer.js";
import { OwnerGrokV2vGenerationService, OWNER_GROK_V2V_GENERATION_CATALOG_VERSION } from "../application/owner-grok-v2v-generation-service.js";
import { OwnerWan27R2vReferenceService } from "../application/owner-wan27-r2v-reference-service.js";
import { OwnerWan27R2vReferenceUploadService } from "../application/owner-wan27-r2v-reference-upload-service.js";
import { createOwnerWan27R2vRequestPreparer } from "../application/owner-wan27-r2v-request-preparer.js";
import { OwnerWan27R2vGenerationService, OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION } from "../application/owner-wan27-r2v-generation-service.js";
import { OwnerWan26I2vReferenceService } from "../application/owner-wan26-i2v-reference-service.js";
import { createOwnerWan26I2vRequestPreparer } from "../application/owner-wan26-i2v-request-preparer.js";
import { OwnerWan26I2vGenerationService, OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION } from "../application/owner-wan26-i2v-generation-service.js";
import { OwnerWan26R2vReferenceService } from "../application/owner-wan26-r2v-reference-service.js";
import { createOwnerWan26R2vRequestPreparer } from "../application/owner-wan26-r2v-request-preparer.js";
import { OwnerWan26R2vGenerationService, OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION } from "../application/owner-wan26-r2v-generation-service.js";
import { OwnerWan25I2vReferenceService } from "../application/owner-wan25-i2v-reference-service.js";
import { createOwnerWan25I2vRequestPreparer } from "../application/owner-wan25-i2v-request-preparer.js";
import { OwnerWan25I2vGenerationService, OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION } from "../application/owner-wan25-i2v-generation-service.js";

const LOCAL_OWNER_BINDING: AuthBinding = Object.freeze({
  tenant_id: "tenant_local_owner",
  subject: "subject_local_owner"
});
const OWNER_IMAGE_REFERENCE_REGISTRY_VERSION =
  "sha256-0e5b7a6ab56a4fc5103c025690293297b49258c1c876d7a0a663ff7959099d39.json";
const OWNER_BANANA_INPAINT_CLIENT_IDLE_TTL_MS = 15 * 60_000;
const OWNER_WAN_T2V_PUBLIC_CATALOG_VERSION = "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json";
const OWNER_RUNTIME_STARTUP_CLEANUPS = new WeakMap<object, Promise<void>>();

export function getObservedOwnerRuntimeStartupCleanup(error: unknown): Promise<void> | undefined {
  return error !== null && (typeof error === "object" || typeof error === "function")
    ? OWNER_RUNTIME_STARTUP_CLEANUPS.get(error as object)
    : undefined;
}

export interface ObservedOwnerRuntimeOptions {
  /** Trusted local operator selection, not a model-callable parameter. */
  publicCatalogVersion?: string;
  catalogDirectory?: string;
  /** Trusted operator opt-in, not proof of terms acceptance or a model input. */
  accountStatusEnabled?: boolean;
  /** Trusted local opt-in to read bounded stored-file metadata; never mutates files. */
  uploadedFilesEnabled?: boolean;
  uploadFileEnabled?: boolean;
  reconcileUploadedFileEnabled?: boolean;
  /** Trusted operator opt-in to REAL, BILLED image generation; not a model input. */
  generateImageEnabled?: boolean;
  generateVideoEnabled?: boolean;
  /** Separate explicit local-owner opt-in for live_verified media contracts. */
  ownerContractMediaEnabled?: boolean;
  /** Separate trusted opt-in for the exact owner image-reference flow. */
  ownerImageReferencesEnabled?: boolean;
  /** Trusted locally loaded, source-bound Grok profiles; never an MCP input. */
  ownerGrokImageReferencesEnabled?: boolean;
  ownerGrokImageReferenceProfiles?: OwnerGrokImageReferenceProfileSet;
  /** Explicit owner-stdio opt-in for private full-four Grok T2I generation. */
  ownerGrokT2iImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for full source-shaped WAN T2I generation. */
  ownerWanT2iImageEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the pinned private B066 WAN T2V tools. */
  ownerWanT2vVideosEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the exact C19 WAN 3.0 First/Last Frame profile. */
  ownerWan30FirstLastVideosEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the exact C19 WAN 3.0 Reference profile. */
  ownerWan30ReferenceVideosEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the exact C19 WAN 3.0 Omni image profile. */
  ownerWan30OmniVideosEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the observed WAN 3.0 Edit MP4 profile. */
  ownerWan30EditVideosEnabled?: boolean;
  /** Trusted absolute operator ffprobe path; required only when Edit is enabled. */
  ownerWan30EditFfprobePath?: string;
  /** Explicit owner-stdio opt-in for Flux3 I2V/V2V; disabled by default. */
  ownerFlux3VideosEnabled?: boolean;
  /** Trusted absolute operator ffprobe path; required only when Flux3 video tools are enabled. */
  ownerFlux3FfprobePath?: string;
  /** Trusted Flux3 media upload destination; required only when enabled. */
  ownerFlux3UploadDestination?: "uploaded" | "hidden";
  /** Explicit default-off Grok V2V tool group; configuration never starts an upload or generation. */
  ownerGrokV2vEnabled?: boolean;
  /** Trusted local executable path, not a tool input. */
  ownerGrokV2vFfprobePath?: string;
  ownerGrokV2vUploadDestination?: "uploaded" | "hidden";
  /** Explicit owner-stdio opt-in for the pinned private ElevenLabs TTS tools. */
  ownerElevenLabsTtsEnabled?: boolean;
  /** Explicit owner-stdio opt-in for ordered ElevenLabs multi-voice dialogue. */
  ownerElevenLabsDialogueEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private ElevenLabs STS upload and generation. */
  ownerElevenLabsStsEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when STS is enabled. */
  ownerElevenLabsStsFfprobePath?: string;
  /** Trusted upload destination, required only when STS is enabled. */
  ownerElevenLabsStsUploadDestination?: "uploaded" | "hidden";
  /** Explicit owner-stdio opt-in for private Suno generation and recovery tools. */
  ownerSunoGenerationEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Topaz Astra upload, generation, and recovery tools. */
  ownerTopazAstraEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when Topaz Astra is enabled. */
  ownerTopazAstraFfprobePath?: string;
  /** Trusted upload destination, required only when Topaz Astra is enabled. */
  ownerTopazAstraUploadDestination?: "uploaded" | "hidden";
  /** Explicit owner-stdio opt-in for private Topaz Enhance tools; default is off. */
  ownerTopazEnhanceEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when Topaz Enhance is enabled. */
  ownerTopazEnhanceFfprobePath?: string;
  /** Trusted upload destination, required only when Topaz Enhance is enabled. */
  ownerTopazEnhanceUploadDestination?: "uploaded" | "hidden";
  /** Explicit owner-stdio opt-in for private WAN 2.7 R2V reference upload tools. */
  ownerWan27R2vEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when WAN 2.7 R2V references are enabled. */
  ownerWan27R2vFfprobePath?: string;
  /** Trusted absolute local ffmpeg path, required only when WAN 2.7 R2V references are enabled. */
  ownerWan27R2vFfmpegPath?: string;
  /** Explicit owner-stdio opt-in for private WAN 2.6 I2V reference upload and generation. */
  ownerWan26I2vEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when WAN 2.6 I2V is enabled. */
  ownerWan26I2vFfprobePath?: string;
  /** Explicit owner-stdio opt-in for private WAN 2.6 R2V generation and recovery. */
  ownerWan26R2vEnabled?: boolean;
  /** Trusted absolute local media tools, required only when WAN 2.6 R2V is enabled. */
  ownerWan26R2vFfprobePath?: string;
  ownerWan26R2vFfmpegPath?: string;
  /** Explicit owner-stdio opt-in for private WAN 2.5 I2V preview image, generation, and recovery tools. */
  ownerWan25I2vPreviewEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the reviewed Luma T2V contract tools. */
  ownerLumaT2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the sealed, reviewed Hailuo-01 T2V profile. */
  ownerHailuo01T2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the sealed, reviewed Hailuo-01 Director T2V profile. */
  ownerHailuo01DirectorT2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the sealed, reviewed Hailuo 2.3 T2V profile. */
  ownerHailuo23T2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for Hailuo-02 source-reviewed no-reference generation. */
  ownerHailuo02T2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for Seedance 2.0 mini with no references. */
  ownerSeedance20T2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for source-reviewed Kling T2V and O1 T2V. */
  ownerKlingT2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for source-pinned owner Kling I2V upload and generation. */
  ownerKlingI2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for owner-bound Kling Keyframes image input tools only. */
  ownerKlingKeyframesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for source-pinned Kling Motion Control uploads, presets, generation, and recovery. */
  ownerKlingMotionControlEnabled?: boolean;
  /** Trusted absolute local ffprobe path, required only when Kling Motion Control is enabled. */
  ownerKlingMotionControlFfprobePath?: string;
  /** Explicit owner-stdio opt-in for source-pinned Hailuo-02 I2V upload and generation. */
  ownerHailuo02I2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for source-reviewed Veo no-reference T2V. */
  ownerVeoT2vEnabled?: boolean;
  /** Separate source-bound Omni T2V opt-in with mandatory live budget checks. */
  ownerVeoOmniT2vEnabled?: boolean;
  /** Separate owned image/mixed-reference Omni group, never enabled by the T2V flag. */
  ownerVeoOmniReferencesEnabled?: boolean;
  ownerVeoOmniReferencesFfprobePath?: string;
  ownerVeoOmniReferencesMaxFileBytes?: number;
  /** Explicit owner-stdio opt-in for source-reviewed Grok T2V without references. */
  ownerGrokT2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for source-reviewed Hailuo-01 Live T2V. */
  ownerHailuoLiveT2vEnabled?: boolean;
  /** Explicit owner-stdio opt-in for Video2Audio upload, generation, and GET-only recovery. */
  ownerVideo2AudioEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Banana Inpaint uploads and generation. */
  ownerBananaInpaintImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Uni image-reference generation. */
  ownerUniImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for redacted Soul list shape diagnostics only. */
  ownerSoulCatalogShapeEnabled?: boolean;
  /** Trusted local sample cap for the read-only Soul shape diagnostic; defaults to 20. */
  ownerSoulCatalogShapeMaxItems?: 20 | 128;
  /** Explicit owner-local opt-in to read-only Soul style options; never generation admission. */
  ownerSoulStyleOptionsEnabled?: boolean;
  /** Explicit owner-stdio opt-in for the full private Soul image intent and recovery tools. */
  ownerSoulImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private Clarity upscale upload and generation tools. */
  ownerClarityUpscaleEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private Magnific upscale upload and generation tools. */
  ownerMagnificUpscaleEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private Kontext reference-image upload and generation tools. */
  ownerKontextImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private WAN reference-image upload and generation tools. */
  ownerWanImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private Banana/GPT Image reference and generation tools. */
  ownerStandardImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in to private Runway Frames image reference and generation tools. */
  ownerRunwayImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Seedream image-reference and generation tools. */
  ownerSeedreamImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Seedream Editor references and generation tools. */
  ownerSeedreamEditorImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Flux image-reference and generation tools. */
  ownerFluxImageReferencesEnabled?: boolean;
  /** Explicit owner-stdio opt-in for private Ideogram image upload and generation tools. */
  ownerIdeogramImageReferencesEnabled?: boolean;
  /** Trusted local composition only; never sourced from MCP input or environment values. Defaults to Civitai-only. */
  ownerFluxImageLoraAttestor?: CivitaiPublicModelFileAttestor;
  /** Trusted immutable registry supplied only by local composition, never by MCP input. */
  generationContractRegistry?: GenerationContractRegistry | GenerationContractRegistryV2 | null;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  now?: () => number;
  /** Explicit durable/auth store injection; default remains process-local. */
  authStore?: AuthLinkStore;
  /** Explicit stable principal for an injected private owner profile; default remains local-memory owner. */
  authBinding?: AuthBinding;
  /** Explicit recovery store injection; default is process-local. */
  videoRecoveryStore?: OwnerVideoRecoveryStoreLike;
  /** Explicit owner-image recovery store injection for local tests/runtime integration. */
  imageRecoveryStore?: OwnerImageRecoveryStoreLike;
}

/**
 * Explicit local-owner composition. It keeps credentials only in this process
 * and must not be reused as a hosted multi-user deployment.
 */
export function createObservedOwnerRuntime(
  options: ObservedOwnerRuntimeOptions = {}
) {
  const now = options.now ?? Date.now;
  const selected = loadSelectedDiscoveryCatalog(
    options.publicCatalogVersion,
    options.catalogDirectory
  );
  const catalog = selected.discoveryCatalog;
  const configuredCatalogVersion = options.publicCatalogVersion ?? process.env.SYNTX_PUBLIC_CATALOG_VERSION;
  const selectedCatalogVersion = configuredCatalogVersion === undefined && options.catalogDirectory === undefined
    ? DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION
    : configuredCatalogVersion;
  const catalogVersion = `${catalog.fetched_at}.${catalog.source_hashes.models.slice(7, 19)}`;
  const store = options.authStore ?? new InMemoryAuthLinkStore(now);
  const authBinding: AuthBinding = Object.freeze({
    tenant_id: options.authBinding?.tenant_id ?? LOCAL_OWNER_BINDING.tenant_id,
    subject: options.authBinding?.subject ?? LOCAL_OWNER_BINDING.subject
  });
  const provider = new ObservedSyntxAuthProvider({
    approvalTransport: "t.me",
    ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
    ...(options.requestTimeoutMs === undefined
      ? {}
      : { requestTimeoutMs: options.requestTimeoutMs })
  });
  const linkService = new PerUserLinkService(provider, store, { now });
  const application = createDefaultApplication(selected);
  const createCredentialBroker = (attemptId: string) =>
    new LinkedAttemptCredentialBroker(
      linkService,
      authBinding,
      attemptId
    );
  const createChatClient = (attemptId: string) =>
    new SyntxChatHttpClient({
      credentialBroker: createCredentialBroker(attemptId),
      ...(options.fetchImpl === undefined
        ? {}
        : { fetchImpl: options.fetchImpl }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs })
    });
  const createReadClient = (attemptId: string) =>
    new SyntxHttpClient({
      credentialBroker: createCredentialBroker(attemptId),
      ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      ...(options.requestTimeoutMs === undefined
        ? {}
        : { requestTimeoutMs: options.requestTimeoutMs })
    });
  const assertGenerationAllowed = createOwnerGenerationPreflight({
    catalog,
    resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal)
  });
  const ownerContractMediaRegistry = options.ownerContractMediaEnabled === true
    ? selectOwnerContractMediaRegistry(options.generationContractRegistry)
    : null;
  const resolveOwnerSubscription = (attemptId: string, signal?: AbortSignal) => createReadClient(attemptId).getSubscription(signal);
  const ownerContractMediaExecutor = ownerContractMediaRegistry === null
    ? null
    : ownerContractMediaRegistry.schema_version === "2.0.0"
      ? new GenerationContractExecutorV2(ownerContractMediaRegistry, catalog)
      : new GenerationContractExecutor(ownerContractMediaRegistry, catalog);
  const ownerContractMedia = ownerContractMediaExecutor === null || ownerContractMediaRegistry === null
    ? undefined
    : {
        registry: ownerContractMediaRegistry,
        executor: ownerContractMediaExecutor,
        service: new OwnerContractMediaService({
          recoveryStore: new OwnerContractMediaRecoveryStore({ now }),
          now
        }),
        prepareGeneration: ownerContractMediaExecutor instanceof GenerationContractExecutorV2
          ? createReviewedContractPreflight({ executor: ownerContractMediaExecutor, resolveSubscription: resolveOwnerSubscription })
          : createReviewedContractPreflight({ executor: ownerContractMediaExecutor, resolveSubscription: resolveOwnerSubscription }),
        resolveChatClient: createChatClient
      };
  const ownerImageReferences = options.ownerImageReferencesEnabled === true
      ? new OwnerImageReferenceService({
        binding: authBinding,
        registry: loadGenerationContractRegistryV2(OWNER_IMAGE_REFERENCE_REGISTRY_VERSION, options.catalogDirectory),
        catalog,
        linkService,
        referenceStore: new OwnerMediaReferenceStore({ now }),
        createChatClient,
        createReadClient: (attemptId) => createChatClient(attemptId),
        preflightFactory: (attemptId, principal, candidate) => {
          let modelAccess: Awaited<ReturnType<ModelAccessService["getModelAccess"]>> | undefined;
          const matchesRequest = (actualAttemptId: string, actualPrincipal: { tenant_id: string; subject_id: string }) =>
            actualAttemptId === attemptId &&
            actualPrincipal.tenant_id === principal.tenant_id &&
            actualPrincipal.subject_id === principal.subject_id;
          return {
            verifyFreshSubscription: async (actualAttemptId, actualPrincipal, signal) => {
              if (!matchesRequest(actualAttemptId, actualPrincipal)) throw new Error("OWNER_REFERENCE_PREFLIGHT_BINDING_MISMATCH");
              await assertGenerationAllowed(actualAttemptId, candidate.model_id, signal);
            },
            verifyModelAccess: async (actualAttemptId, actualPrincipal, modelId, signal) => {
              if (!matchesRequest(actualAttemptId, actualPrincipal) || modelId !== candidate.model_id) {
                throw new Error("OWNER_REFERENCE_PREFLIGHT_BINDING_MISMATCH");
              }
              const model = catalog.getModel(modelId);
              const costParameters = ownerImageReferenceCostParameters(model.settings?.get_cost_params, candidate.request.settings);
              modelAccess = await new ModelAccessService(catalog, createReadClient(actualAttemptId), now)
                .getModelAccess({ model_id: modelId, cost_parameters: costParameters }, signal);
              assertOwnerImageReferenceModelAccess(modelAccess, {
                model_id: modelId,
                ai_name: model.ai_name,
                model_type: model.upstream_id,
                catalog_kind: catalog.catalog_kind,
                catalog_version: catalogVersion,
                parameter_keys: Object.keys(costParameters).sort()
              });
            },
            authorizeCost: async (actualAttemptId, actualPrincipal, actualCandidate) => {
              if (!matchesRequest(actualAttemptId, actualPrincipal) || actualCandidate !== candidate ||
                  modelAccess === undefined || modelAccess.model_id !== candidate.model_id ||
                  typeof modelAccess.cost !== "number" || !Number.isFinite(modelAccess.cost) || modelAccess.cost < 0 ||
                  (modelAccess.discount_cost !== null &&
                    (typeof modelAccess.discount_cost !== "number" || !Number.isFinite(modelAccess.discount_cost) || modelAccess.discount_cost < 0))) {
                throw new Error("OWNER_REFERENCE_COST_UNAVAILABLE");
              }
            }
          };
        },
        now
      })
    : undefined;
  const ownerGrokImageReferences = options.ownerGrokImageReferencesEnabled === true
    ? createOwnerGrokImageReferenceService({
        profileSet: options.ownerGrokImageReferenceProfiles,
        catalog,
        catalogVersion,
        binding: authBinding,
        linkService,
        createChatClient,
        createReadClient,
        now
      })
    : undefined;
  const ownerSoulCatalogShape = options.ownerSoulCatalogShapeEnabled === true
    ? new OwnerSoulCatalogShapeService({
        binding: authBinding,
        linkService,
        catalog,
        catalogVersion: selectedCatalogVersion ?? "",
        resolveClient: (attemptId) => new OwnerSoulCatalogShapeHttpClient({
          credentialBroker: createCredentialBroker(attemptId),
          maxInspectedItems: options.ownerSoulCatalogShapeMaxItems ?? 20,
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
        })
      })
    : undefined;
  const ownerSoulStyleOptions = options.ownerSoulStyleOptionsEnabled === true || options.ownerSoulImageReferencesEnabled === true
    ? new OwnerSoulStyleOptionsService({
        binding: authBinding,
        linkService,
        catalog,
        catalogVersion: selectedCatalogVersion ?? "",
        resolveClient: (attemptId) => new OwnerSoulStyleCatalogHttpClient({
          credentialBroker: createCredentialBroker(attemptId),
          ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
        }),
        now
      })
    : undefined;
  const ownerSoulImageReferences = options.ownerSoulImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION || ownerSoulStyleOptions === undefined) {
          throw new Error("Owner Soul image generation requires the selected e551 catalog and shared Style selector service.");
        }
        const characterOptionsService = new OwnerSoulCharacterOptionsService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: (attemptId: string) => new OwnerSoulCharacterCatalogHttpClient({
            credentialBroker: createCredentialBroker(attemptId),
            ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl })
          }),
          now
        });
        const preparer = new OwnerSoulImageRequestPreparer({
          binding: authBinding,
          linkService,
          styleOptionsService: ownerSoulStyleOptions,
          characterOptionsService,
          catalog,
          catalog_version: selectedCatalogVersion,
          now
        });
        const generationService = new OwnerSoulImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          preparer,
          styleOptionsService: ownerSoulStyleOptions,
          characterOptionsService,
          resolveChatClient: createChatClient,
          createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
          createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, createReadClient(attemptId), now),
          now
        });
        return Object.freeze({ generationService, characterOptionsService });
      })()
    : undefined;
  const ownerClarityUpscale = options.ownerClarityUpscaleEnabled === true
    ? (() => {
        const uploadService = new OwnerClarityUpscaleUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerClarityUpscaleGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalogVersion: DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async (attemptId, _principal, signal) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: "clarity" }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
    })()
    : undefined;
  const ownerGrokT2iImageReferences = options.ownerGrokT2iImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Grok T2I image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerGrokT2iImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const preparer = new OwnerGrokT2iRequestPreparer({
          binding: authBinding,
          linkService,
          imageUploadService: uploadService,
          catalog,
          catalog_version: selectedCatalogVersion,
          now
        });
        const preflight: OwnerGrokT2iGenerationPreflight = async ({ attemptId, principal, model_id, cost_inputs,
          catalog_version: requestCatalogVersion, signal }) => {
          if (requestCatalogVersion !== selectedCatalogVersion) throw new Error("OWNER_GROK_T2I_CATALOG_BINDING_MISMATCH");
          await assertGrokPrincipal(authBinding, attemptId, principal, linkService);
          const readClient = createReadClient(attemptId);
          const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
          const model_access = await new ModelAccessService(catalog, readClient, now)
            .getModelAccess({ model_id, cost_parameters: cost_inputs }, signal);
          const model = catalog.getModel(model_id);
          assertOwnerImageReferenceModelAccess(model_access, {
            model_id,
            ai_name: model.ai_name,
            model_type: model.upstream_id,
            catalog_kind: catalog.catalog_kind,
            catalog_version: catalogVersion,
            parameter_keys: Object.keys(cost_inputs).sort()
          });
          return { account, model_access };
        };
        const generationService = new OwnerGrokT2iGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          imageUploadService: uploadService,
          preparer,
          resolveChatClient: createChatClient,
          preflight,
          now
        });
        return Object.freeze({ uploadService, generationService });
    })()
    : undefined;
  const ownerWanT2iImageReferences = options.ownerWanT2iImageEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner WAN T2I generation requires the selected e551 source-pinned public catalog.");
        }
        const preparer = new OwnerWanT2iRequestPreparer({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          now
        });
        const generationService = new OwnerWanT2iGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          preparer,
          resolveChatClient: createChatClient,
          createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
          createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, createReadClient(attemptId), now),
          now
        });
        return Object.freeze({ generationService });
      })()
    : undefined;
  const ownerUniImageReferences = options.ownerUniImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Uni image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerUniImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const preparer = new OwnerUniImageRequestPreparer({
          binding: authBinding,
          linkService,
          imageUploadService: uploadService,
          catalog,
          catalog_version: selectedCatalogVersion,
          now
        });
        const preflight: OwnerUniImageGenerationPreflight = async ({ attemptId, principal, model_id, cost_inputs,
          catalog_version: requestCatalogVersion, signal }) => {
          if (requestCatalogVersion !== selectedCatalogVersion) throw new Error("OWNER_UNI_IMAGE_CATALOG_BINDING_MISMATCH");
          await assertGrokPrincipal(authBinding, attemptId, principal, linkService);
          const readClient = createReadClient(attemptId);
          const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
          const model_access = await new ModelAccessService(catalog, readClient, now)
            .getModelAccess({ model_id, cost_parameters: cost_inputs }, signal);
          const model = catalog.getModel(model_id);
          assertOwnerImageReferenceModelAccess(model_access, {
            model_id,
            ai_name: model.ai_name,
            model_type: model.upstream_id,
            catalog_kind: catalog.catalog_kind,
            catalog_version: catalogVersion,
            parameter_keys: Object.keys(cost_inputs).sort()
          });
          return { account, model_access };
        };
        const generationService = new OwnerUniImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          preparer,
          resolveChatClient: createChatClient,
          preflight,
          now
        });
        return Object.freeze({ uploadService, generationService });
      })()
    : undefined;
  const ownerMagnificUpscale = options.ownerMagnificUpscaleEnabled === true
    ? (() => {
        // Magnific's source contract is tied to one reviewed immutable public
        // snapshot. Never silently relabel an injected catalog as that pin.
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Magnific upscale requires the selected source-pinned public catalog.");
        }
        const uploadService = new OwnerMagnificUpscaleUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalogVersion: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerMagnificUpscaleGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalogVersion: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now).getModelAccess({
              model_id: variant,
              cost_parameters: cost_inputs
            }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
      })()
    : undefined;
  const ownerKontextImageReferences = options.ownerKontextImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Kontext references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerKontextImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerKontextImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
    })()
    : undefined;
  const ownerWanImageReferences = options.ownerWanImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner WAN references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerWanImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerWanImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
    })()
    : undefined;
  const ownerStandardImageReferences = options.ownerStandardImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner standard image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerStandardImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerStandardImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }: Parameters<OwnerStandardImageGenerationPreflight>[0]) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
      })()
    : undefined;
  const ownerRunwayImageReferences = options.ownerRunwayImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Runway image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerRunwayImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerRunwayImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }: Parameters<OwnerRunwayImageGenerationPreflight>[0]) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
      })()
    : undefined;
  const ownerSeedreamImageReferences = options.ownerSeedreamImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Seedream image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerSeedreamImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerSeedreamImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }: Parameters<OwnerSeedreamImageGenerationPreflight>[0]) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, generationService });
      })()
    : undefined;
  const ownerSeedreamEditorImageReferences = options.ownerSeedreamEditorImageReferencesEnabled === true
    ? (() => {
        const editorCatalog = loadSelectedDiscoveryCatalog(
          OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
          options.catalogDirectory
        ).discoveryCatalog;
        const settingsInventory = loadMaplessSettingsInventoryVersion(
          OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
          options.catalogDirectory
        );
        const editorClientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveEditorChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = editorClientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (editorClientsByAttempt.size >= 128) throw new Error("OWNER_SEEDREAM_EDITOR_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          editorClientsByAttempt.set(attemptId, client);
          return client;
        };
        let originalReferenceService: OwnerSeedreamEditorOriginalReferenceService | undefined;
        let drawingReferenceService: OwnerSeedreamEditorDrawingReferenceService | undefined;
        let generationService: ReturnType<typeof createOwnerSeedreamEditorImageGenerationService> | undefined;
        try {
          originalReferenceService = new OwnerSeedreamEditorOriginalReferenceService({
            binding: authBinding,
            linkService,
            catalog: editorCatalog,
            public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
            settings_inventory: settingsInventory,
            settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
            resolveClient: resolveEditorChatClient,
            now
          });
          drawingReferenceService = new OwnerSeedreamEditorDrawingReferenceService({
            originalReferenceService,
            binding: authBinding,
            linkService,
            catalog: editorCatalog,
            public_catalog_version: OWNER_SEEDREAM_EDITOR_C5_PUBLIC_VERSION,
            settings_inventory: settingsInventory,
            settings_inventory_version: OWNER_SEEDREAM_EDITOR_62BC_SETTINGS_VERSION,
            resolveClient: resolveEditorChatClient,
            now
          });
          generationService = createOwnerSeedreamEditorImageGenerationService({
            binding: authBinding,
            linkService,
            originalReferenceService,
            drawingReferenceService,
            resolveChatClient: resolveEditorChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, actualCatalog: DiscoveryCatalogRepository) =>
              new ModelAccessService(actualCatalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [
              () => generationService?.close(),
              () => drawingReferenceService?.close(),
              () => originalReferenceService?.close()
            ]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            editorClientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Seedream Editor constructor cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const invalidateAttempt = async (attemptId: string): Promise<void> => {
          const errors: unknown[] = [];
          for (const invalidate of [
            () => generationService!.invalidateAttempt(attemptId),
            () => drawingReferenceService!.invalidateAttempt(attemptId),
            () => originalReferenceService!.invalidateAttempt(attemptId)
          ]) {
            try { await invalidate(); } catch (error) { errors.push(error); }
          }
          editorClientsByAttempt.delete(attemptId);
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Seedream Editor attempt drain failed.");
        };
        const lifecycle = Object.freeze({
          async close(): Promise<void> {
            const errors: unknown[] = [];
            for (const close of [
              () => generationService!.close(),
              () => drawingReferenceService!.close(),
              () => originalReferenceService!.close()
            ]) {
              try { await close(); } catch (error) { errors.push(error); }
            }
            editorClientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Seedream Editor services did not close cleanly.");
          }
        });
        return Object.freeze({ originalReferenceService, drawingReferenceService, generationService, invalidateAttempt, lifecycle });
      })()
    : undefined;
  const ownerFluxImageReferences = options.ownerFluxImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Flux image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerFluxImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const assetService = new OwnerFluxImageAssetService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          // The default attestor permits only exact Civitai origins. A host may inject a
          // separately constructed, operator-approved attestor; no MCP input can alter it.
          loraAttestor: options.ownerFluxImageLoraAttestor ?? new CivitaiPublicModelFileAttestor(),
          now
        });
        const generationService = new OwnerFluxImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          assetService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, variant, cost_inputs, signal }: Parameters<OwnerFluxImageGenerationPreflight>[0]) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id: variant, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, assetService, generationService });
      })()
    : undefined;
  const ownerIdeogramImageReferences = options.ownerIdeogramImageReferencesEnabled === true
    ? (() => {
        if (selectedCatalogVersion !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("Owner Ideogram image references require the selected e551 source-pinned public catalog.");
        }
        const uploadService = new OwnerIdeogramImageUploadService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const maskUploadService = new OwnerIdeogramImageMaskUploadService({
          baseUploadService: uploadService,
          catalog,
          catalog_version: selectedCatalogVersion,
          resolveClient: createChatClient,
          now
        });
        const generationService = new OwnerIdeogramImageGenerationService({
          binding: authBinding,
          linkService,
          catalog,
          catalog_version: selectedCatalogVersion,
          uploadService,
          maskUploadService,
          resolveChatClient: createChatClient,
          preflight: async ({ attemptId, model_id, cost_inputs, signal }: Parameters<OwnerIdeogramImageGenerationPreflight>[0]) => {
            const readClient = createReadClient(attemptId);
            const account = await new AccountStatusService(readClient, now).getAccountStatus(signal);
            const model_access = await new ModelAccessService(catalog, readClient, now)
              .getModelAccess({ model_id, cost_parameters: cost_inputs }, signal);
            return { account, model_access };
          },
          now
        });
        return Object.freeze({ uploadService, maskUploadService, generationService });
      })()
    : undefined;
  const ownerBananaInpaintImageReferences = options.ownerBananaInpaintImageReferencesEnabled === true
    ? (() => {
        const inpaintCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION));
        const inpaintSettings = loadMaplessSettingsInventoryVersion(OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION);
        const resolveInpaintClientByAttempt = new Map<string, { readonly client: SyntxChatHttpClient; lastUsedAt: number }>();
        const resolveInpaintClient = (attemptId: string): SyntxChatHttpClient => {
          const checkedAt = now();
          for (const [cachedAttempt, entry] of resolveInpaintClientByAttempt) {
            if (checkedAt >= entry.lastUsedAt && checkedAt - entry.lastUsedAt >= OWNER_BANANA_INPAINT_CLIENT_IDLE_TTL_MS) {
              resolveInpaintClientByAttempt.delete(cachedAttempt);
            }
          }
          const existing = resolveInpaintClientByAttempt.get(attemptId);
          if (existing) {
            existing.lastUsedAt = checkedAt;
            return existing.client;
          }
          if (resolveInpaintClientByAttempt.size >= 128) throw new Error("OWNER_BANANA_INPAINT_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          resolveInpaintClientByAttempt.set(attemptId, { client, lastUsedAt: checkedAt });
          return client;
        };
        const originalReferenceService = new OwnerBananaInpaintOriginalReferenceService({
          binding: authBinding,
          linkService,
          catalog: inpaintCatalog,
          public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
          settings_inventory: inpaintSettings,
          settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
          resolveClient: resolveInpaintClient,
          now
        });
        const paintedCompositeReferenceService = new OwnerBananaInpaintPaintedCompositeReferenceService({
          originalReferenceService,
          binding: authBinding,
          linkService,
          catalog: inpaintCatalog,
          public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
          settings_inventory: inpaintSettings,
          settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
          resolveClient: resolveInpaintClient,
          now
        });
        const auxiliaryReferenceService = new OwnerBananaInpaintAuxiliaryReferenceService({
          binding: authBinding,
          linkService,
          catalog: inpaintCatalog,
          public_catalog_version: OWNER_BANANA_INPAINT_C5_PUBLIC_VERSION,
          settings_inventory: inpaintSettings,
          settings_inventory_version: OWNER_BANANA_INPAINT_62BC_SETTINGS_VERSION,
          resolveClient: resolveInpaintClient,
          now
        });
        const generationService = createOwnerBananaInpaintImageGenerationService({
          binding: authBinding,
          linkService,
          originalReferenceService,
          paintedCompositeReferenceService,
          auxiliaryReferenceService,
          resolveChatClient: resolveInpaintClient,
          createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
          createModelAccessService: (attemptId: string, modelCatalog: DiscoveryCatalogRepository) =>
            new ModelAccessService(modelCatalog, createReadClient(attemptId), now),
          now
        });
        const generationInvalidateAttempt = generationService.invalidateAttempt.bind(generationService);
        const generationClose = generationService.close.bind(generationService);
        generationService.invalidateAttempt = async (attemptId: string): Promise<void> => {
          const settled = await Promise.allSettled([
            generationInvalidateAttempt(attemptId),
            originalReferenceService.invalidateAttempt(attemptId),
            paintedCompositeReferenceService.invalidateAttempt(attemptId),
            auxiliaryReferenceService.invalidateAttempt(attemptId)
          ]);
          const errors = settled.filter((result): result is PromiseRejectedResult => result.status === "rejected")
            .map((result) => result.reason);
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Banana Inpaint attempt invalidation drain failed.");
          resolveInpaintClientByAttempt.delete(attemptId);
        };
        generationService.close = async (): Promise<void> => {
          try { await generationClose(); }
          finally { resolveInpaintClientByAttempt.clear(); }
        };
        return Object.freeze({ originalReferenceService, paintedCompositeReferenceService, auxiliaryReferenceService, generationService });
      })()
    : undefined;
  // Compose this last among service constructors so a later initialization failure
  // cannot strand its per-attempt client cache.
  const ownerWanT2vVideos = options.ownerWanT2vVideosEnabled === true
    ? (() => {
        const wanCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_WAN_T2V_PUBLIC_CATALOG_VERSION,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveWanChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerWanT2vGenerationService | undefined;
        try {
          generationService = new OwnerWanT2vGenerationService({
            binding: authBinding,
            linkService,
            catalog: wanCatalog,
            catalog_version: OWNER_WAN_T2V_PUBLIC_CATALOG_VERSION,
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            resolveChatClient: resolveWanChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository = wanCatalog) =>
              new ModelAccessService(catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerWan30FirstLastVideos = options.ownerWan30FirstLastVideosEnabled === true
    ? (() => {
        const catalogVersion = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
        const firstLastCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveFirstLastClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN30_FIRST_LAST_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerWan30FirstLastGenerationService | undefined;
        try {
          generationService = new OwnerWan30FirstLastGenerationService({
            binding: authBinding,
            linkService,
            catalog: firstLastCatalog,
            catalog_version: catalogVersion,
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            resolveClient: resolveFirstLastClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) =>
              new ModelAccessService(catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerWan30ReferenceVideos = options.ownerWan30ReferenceVideosEnabled === true
    ? (() => {
        const catalogVersion = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
        const referenceCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveReferenceClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN30_REFERENCE_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: ReturnType<typeof createOwnerWan30ReferenceGenerationService> | undefined;
        try {
          generationService = createOwnerWan30ReferenceGenerationService({
            binding: authBinding,
            linkService,
            catalog: referenceCatalog,
            catalog_version: catalogVersion,
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            resolveClient: resolveReferenceClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) =>
              new ModelAccessService(catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerWan30OmniVideos = options.ownerWan30OmniVideosEnabled === true
    ? (() => {
        const catalogVersion = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
        const omniCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveOmniClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN30_OMNI_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: ReturnType<typeof createOwnerWan30OmniGenerationService> | undefined;
        try {
          generationService = createOwnerWan30OmniGenerationService({
            binding: authBinding,
            linkService,
            catalog: omniCatalog,
            catalog_version: catalogVersion,
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            resolveClient: resolveOmniClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) =>
              new ModelAccessService(catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerWan30EditVideos = options.ownerWan30EditVideosEnabled === true
    ? (() => {
        const catalogVersion = "sha256-19c882601bb8ecdba994adf819544ebf06fd2db30374335631bb6078a66e5a76.json";
        const editCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(catalogVersion, options.catalogDirectory));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveEditClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN30_EDIT_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const originalProbe = createOwnerWan30EditOriginalProbe({ ffprobePath: options.ownerWan30EditFfprobePath });
        let generationService: ReturnType<typeof createOwnerWan30EditGenerationService> | undefined;
        try {
          generationService = createOwnerWan30EditGenerationService({
            binding: authBinding,
            linkService,
            catalog: editCatalog,
            catalog_version: catalogVersion,
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            originalProbe,
            resolveClient: resolveEditClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string, catalog: DiscoveryCatalogRepository) =>
              new ModelAccessService(catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerElevenLabsShared = options.ownerElevenLabsTtsEnabled === true || options.ownerElevenLabsDialogueEnabled === true || options.ownerElevenLabsStsEnabled === true
    ? (() => {
        const elevenLabsCatalog = options.ownerElevenLabsTtsEnabled === true || options.ownerElevenLabsDialogueEnabled === true
          ? new DiscoveryCatalogRepository(loadPublicCatalogVersion(
            OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
            options.catalogDirectory
          ))
          : undefined;
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveElevenLabsChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_ELEVENLABS_TTS_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let voiceReferenceService: OwnerElevenLabsVoiceReferenceService | undefined;
        let generationService: OwnerElevenLabsTtsGenerationService | undefined;
        let dialogueService: OwnerElevenLabsDialogueGenerationService | undefined;
        let originalReferenceService: OwnerElevenLabsStsOriginalReferenceService | undefined;
        let stsExistingMediaService: OwnerElevenLabsStsExistingMediaService | undefined;
        let stsGenerationService: OwnerElevenLabsStsGenerationService | undefined;
        let stsPreparer: ReturnType<typeof createOwnerElevenLabsStsRequestPreparer> | undefined;
        try {
          voiceReferenceService = new OwnerElevenLabsVoiceReferenceService({
            binding: authBinding,
            linkService,
            resolveClient: createReadClient,
            now
          });
          if (options.ownerElevenLabsTtsEnabled === true) generationService = new OwnerElevenLabsTtsGenerationService({
            binding: authBinding,
            linkService,
            catalog: elevenLabsCatalog!,
            catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
            voiceReferenceService,
            resolveChatClient: resolveElevenLabsChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(elevenLabsCatalog!, createReadClient(attemptId), now),
            now
          });
          if (options.ownerElevenLabsDialogueEnabled === true) dialogueService = new OwnerElevenLabsDialogueGenerationService({
            binding: authBinding, linkService, catalog: elevenLabsCatalog!,
            catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION, voiceReferenceService,
            resolveChatClient: resolveElevenLabsChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(elevenLabsCatalog!, createReadClient(attemptId), now),
            now
          });
          if (options.ownerElevenLabsStsEnabled === true) {
            if (typeof options.ownerElevenLabsStsFfprobePath !== "string" || !isAbsolute(options.ownerElevenLabsStsFfprobePath) ||
                (options.ownerElevenLabsStsUploadDestination !== "uploaded" && options.ownerElevenLabsStsUploadDestination !== "hidden")) {
              throw new Error("OWNER_ELEVENLABS_STS_OPERATOR_CONFIGURATION_REQUIRED");
            }
            const stsCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
              OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION,
              options.catalogDirectory
            ));
            stsExistingMediaService = new OwnerElevenLabsStsExistingMediaService({
              binding: authBinding,
              linkService,
              resolveChatClient: resolveElevenLabsChatClient,
              now
            });
            originalReferenceService = new OwnerElevenLabsStsOriginalReferenceService({
              ffprobePath: options.ownerElevenLabsStsFfprobePath,
              destination: options.ownerElevenLabsStsUploadDestination,
              binding: authBinding,
              linkService,
              resolveClient: resolveElevenLabsChatClient,
              now
            });
            stsPreparer = createOwnerElevenLabsStsRequestPreparer({ originalReferenceService, voiceReferenceService, now });
            stsGenerationService = new OwnerElevenLabsStsGenerationService({
              binding: authBinding,
              linkService,
              catalog: stsCatalog,
              catalog_version: OWNER_ELEVENLABS_STS_PUBLIC_CATALOG_VERSION,
              preparer: stsPreparer,
              resolveChatClient: resolveElevenLabsChatClient,
              createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
              createModelAccessService: (attemptId: string) => new ModelAccessService(stsCatalog, createReadClient(attemptId), now),
              now
            });
          }
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => stsExistingMediaService?.close(), () => stsGenerationService?.close(),
              () => stsGenerationService === undefined ? stsPreparer?.close() : undefined,
              () => generationService?.close(), () => dialogueService?.close(),
              () => originalReferenceService?.close(), () => voiceReferenceService?.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "ElevenLabs media startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const pendingInvalidations = new Map<string, Promise<void>>();
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const pending = pendingInvalidations.get(attemptId);
            if (pending !== undefined) return pending;
            const operation = Promise.resolve().then(async () => {
            const errors: unknown[] = [];
            for (const invalidate of [
              () => stsExistingMediaService?.invalidateAttempt(attemptId),
              () => stsGenerationService?.invalidateAttempt(attemptId),
              () => generationService?.invalidateAttempt(attemptId),
              () => dialogueService?.invalidateAttempt(attemptId),
              () => originalReferenceService?.invalidateAttempt(attemptId),
              () => voiceReferenceService!.invalidateAttempt(attemptId)
            ]) {
              try { await invalidate(); } catch (error) { errors.push(error); }
            }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "ElevenLabs media attempt drain failed.");
            });
            pendingInvalidations.set(attemptId, operation);
            try { await operation; }
            catch (error) { pendingInvalidations.delete(attemptId); throw error; }
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => stsExistingMediaService?.close(), () => stsGenerationService?.close(), () => generationService?.close(), () => dialogueService?.close(),
              () => originalReferenceService?.close(), () => voiceReferenceService!.close()]) {
              try { await close(); } catch (error) { errors.push(error); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "ElevenLabs media services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ voiceReferenceService, generationService, dialogueService, originalReferenceService,
          stsExistingMediaService, stsGenerationService, lifecycle });
      })()
    : undefined;
  const ownerElevenLabsTts = ownerElevenLabsShared?.generationService === undefined ? undefined : Object.freeze({
    voiceReferenceService: ownerElevenLabsShared.voiceReferenceService!, generationService: ownerElevenLabsShared.generationService,
    lifecycle: ownerElevenLabsShared.lifecycle
  });
  const ownerElevenLabsDialogue = ownerElevenLabsShared?.dialogueService === undefined ? undefined : Object.freeze({
    voiceReferenceService: ownerElevenLabsShared.voiceReferenceService!, generationService: ownerElevenLabsShared.dialogueService,
    lifecycle: ownerElevenLabsShared.lifecycle
  });
  const ownerElevenLabsSts = ownerElevenLabsShared?.stsGenerationService === undefined ? undefined : Object.freeze({
    originalReferenceService: ownerElevenLabsShared.originalReferenceService!,
    voiceReferenceService: ownerElevenLabsShared.voiceReferenceService!,
    generationService: ownerElevenLabsShared.stsGenerationService,
    existingMediaService: ownerElevenLabsShared.stsExistingMediaService!,
    lifecycle: ownerElevenLabsShared.lifecycle
  });
  const ownerSunoGeneration = options.ownerSunoGenerationEnabled === true
    ? (() => {
        const sunoCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_SUNO_GENERATION_PUBLIC_VERSION,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveSunoChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_SUNO_GENERATION_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerSunoGenerationService | undefined;
        try {
          generationService = new OwnerSunoGenerationService({
            binding: authBinding,
            linkService,
            catalog: sunoCatalog,
            catalog_version: OWNER_SUNO_GENERATION_PUBLIC_VERSION,
            resolveChatClient: resolveSunoChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(sunoCatalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerTopazAstra = options.ownerTopazAstraEnabled === true
    ? (() => {
        if (typeof options.ownerTopazAstraFfprobePath !== "string" || !isAbsolute(options.ownerTopazAstraFfprobePath) ||
            (options.ownerTopazAstraUploadDestination !== "uploaded" && options.ownerTopazAstraUploadDestination !== "hidden")) {
          throw new Error("OWNER_TOPAZ_ASTRA_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const topazCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_TOPAZ_ASTRA_GENERATION_CATALOG_VERSION,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveTopazChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_TOPAZ_ASTRA_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const originalReferenceService = new OwnerTopazAstraOriginalReferenceService({
          ffprobePath: options.ownerTopazAstraFfprobePath,
          destination: options.ownerTopazAstraUploadDestination,
          binding: authBinding,
          linkService,
          resolveClient: resolveTopazChatClient,
          now
        });
        const preparer = createOwnerTopazAstraOwnedRequestPreparer({ originalReferenceService, now });
        let existingMediaService: OwnerTopazAstraExistingMediaService | undefined;
        let generationService: OwnerTopazAstraGenerationService;
        try {
          existingMediaService = new OwnerTopazAstraExistingMediaService({
            binding: authBinding,
            genuinePerUserLinkService: linkService,
            resolveChatClient: resolveTopazChatClient,
            now
          });
          generationService = new OwnerTopazAstraGenerationService({
            binding: authBinding,
            linkService,
            catalog: topazCatalog,
            catalog_version: OWNER_TOPAZ_ASTRA_GENERATION_CATALOG_VERSION,
            preparer,
            originalReferenceService,
            resolveChatClient: resolveTopazChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(topazCatalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => existingMediaService?.close(), () => preparer.close(), () => originalReferenceService.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Topaz Astra startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await existingMediaService!.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await generationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try {
              await originalReferenceService.invalidateAttempt(attemptId);
            } catch (error) { errors.push(error); }
            finally { clientsByAttempt.delete(attemptId); }
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) {
              throw new AggregateError(errors, "Topaz Astra attempt invalidation drain failed.");
            }
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await existingMediaService!.close(); } catch (error) { errors.push(error); }
              try { await generationService.close(); } catch (error) { errors.push(error); }
              try { await originalReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "Topaz Astra services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ originalReferenceService, generationService, existingMediaService: existingMediaService!, lifecycle });
      })()
    : undefined;
  const ownerTopazEnhance = options.ownerTopazEnhanceEnabled === true
    ? (() => {
        if (typeof options.ownerTopazEnhanceFfprobePath !== "string" || !isAbsolute(options.ownerTopazEnhanceFfprobePath) ||
            (options.ownerTopazEnhanceUploadDestination !== "uploaded" && options.ownerTopazEnhanceUploadDestination !== "hidden")) {
          throw new Error("OWNER_TOPAZ_ENHANCE_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const enhanceCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_TOPAZ_ENHANCE_GENERATION_CATALOG_VERSION,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveEnhanceChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_TOPAZ_ENHANCE_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const originalReferenceService = new OwnerTopazEnhanceOriginalReferenceService({
          ffprobePath: options.ownerTopazEnhanceFfprobePath,
          destination: options.ownerTopazEnhanceUploadDestination,
          binding: authBinding,
          linkService,
          resolveClient: resolveEnhanceChatClient,
          now
        });
        let preparer: ReturnType<typeof createOwnerTopazEnhanceOwnedRequestPreparer> | undefined;
        let generationService: OwnerTopazEnhanceGenerationService;
        try {
          preparer = createOwnerTopazEnhanceOwnedRequestPreparer({ originalReferenceService, now });
          generationService = new OwnerTopazEnhanceGenerationService({
            binding: authBinding,
            linkService,
            catalog: enhanceCatalog,
            catalog_version: OWNER_TOPAZ_ENHANCE_GENERATION_CATALOG_VERSION,
            preparer,
            originalReferenceService,
            resolveChatClient: resolveEnhanceChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(enhanceCatalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => generationService?.close(), () => preparer?.close(), () => originalReferenceService.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Topaz Enhance startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await generationService.close(); } catch (error) { errors.push(error); }
              try { await originalReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "Topaz Enhance services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ originalReferenceService, generationService, lifecycle });
      })()
    : undefined;
  const ownerFlux3Videos = options.ownerFlux3VideosEnabled === true
    ? (() => {
        if (typeof options.ownerFlux3FfprobePath !== "string" || !isAbsolute(options.ownerFlux3FfprobePath) ||
            (options.ownerFlux3UploadDestination !== "uploaded" && options.ownerFlux3UploadDestination !== "hidden")) {
          throw new Error("OWNER_FLUX3_VIDEO_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const flux3Catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_FLUX3_VIDEO_GENERATION_CATALOG_VERSION,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveFlux3ChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_FLUX3_VIDEO_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const referenceService = new OwnerFlux3MediaReferenceService({
          ffprobePath: options.ownerFlux3FfprobePath,
          destination: options.ownerFlux3UploadDestination,
          binding: authBinding,
          linkService,
          resolveClient: resolveFlux3ChatClient,
          now
        });
        let preparer: ReturnType<typeof createOwnerFlux3VideoOwnedRequestPreparer> | undefined;
        let generationService: ReturnType<typeof createOwnerFlux3VideoGenerationService> | undefined;
        try {
          preparer = createOwnerFlux3VideoOwnedRequestPreparer({ referenceService, now });
          generationService = createOwnerFlux3VideoGenerationService({
            binding: authBinding,
            linkService,
            catalog: flux3Catalog,
            catalog_version: OWNER_FLUX3_VIDEO_GENERATION_CATALOG_VERSION,
            preparer,
            referenceService,
            resolveChatClient: resolveFlux3ChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(flux3Catalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => generationService?.close(), () => preparer?.close(), () => referenceService.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Flux3 video startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await generationService!.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await referenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Flux3 video attempt invalidation failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              for (const close of [() => generationService!.close(), () => referenceService.close()]) {
                try { await close(); } catch (error) { errors.push(error); }
              }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "Flux3 video services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ generationService, referenceService, lifecycle });
      })()
    : undefined;
  const ownerGrokV2v = options.ownerGrokV2vEnabled === true
    ? (() => {
        if (typeof options.ownerGrokV2vFfprobePath !== "string" || !isAbsolute(options.ownerGrokV2vFfprobePath) ||
            (options.ownerGrokV2vUploadDestination !== "uploaded" && options.ownerGrokV2vUploadDestination !== "hidden")) {
          throw new Error("OWNER_GROK_V2V_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const grokCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_GROK_V2V_GENERATION_CATALOG_VERSION, options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveGrokClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_GROK_V2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const referenceService = new OwnerGrokV2vOriginalReferenceService({
          ffprobePath: options.ownerGrokV2vFfprobePath, destination: options.ownerGrokV2vUploadDestination,
          binding: authBinding, linkService, resolveClient: resolveGrokClient, now
        });
        let preparer: ReturnType<typeof createOwnerGrokV2vOwnedRequestPreparer> | undefined;
        let generationService: OwnerGrokV2vGenerationService | undefined;
        try {
          preparer = createOwnerGrokV2vOwnedRequestPreparer({ referenceService, now });
          generationService = new OwnerGrokV2vGenerationService({
            binding: authBinding, linkService, catalog: grokCatalog,
            catalog_version: OWNER_GROK_V2V_GENERATION_CATALOG_VERSION, preparer, referenceService,
            resolveChatClient: resolveGrokClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(grokCatalog, createReadClient(attemptId), now), now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => generationService?.close(), () => preparer?.close(), () => referenceService.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Grok V2V startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await generationService!.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await referenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Grok V2V invalidation failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              for (const close of [() => generationService!.close(), () => referenceService.close()]) {
                try { await close(); } catch (error) { errors.push(error); }
              }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "Grok V2V shutdown failed.");
            })();
            return closing;
          }
        });
        return Object.freeze({ referenceService, generationService, lifecycle });
      })()
    : undefined;
  const ownerWan27R2v = options.ownerWan27R2vEnabled === true
    ? (() => {
        if (typeof options.ownerWan27R2vFfprobePath !== "string" || !isAbsolute(options.ownerWan27R2vFfprobePath) ||
            typeof options.ownerWan27R2vFfmpegPath !== "string" || !isAbsolute(options.ownerWan27R2vFfmpegPath)) {
          throw new Error("OWNER_WAN27_R2V_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveWan27R2vChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN27_R2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const referenceService = new OwnerWan27R2vReferenceService({
          binding: authBinding, linkService, resolveClient: resolveWan27R2vChatClient, now
        });
        const uploadService = new OwnerWan27R2vReferenceUploadService({
          referenceService, ffprobePath: options.ownerWan27R2vFfprobePath, ffmpegPath: options.ownerWan27R2vFfmpegPath
        });
        const preparer = createOwnerWan27R2vRequestPreparer({ binding: authBinding, linkService, referenceService, now });
        const generationCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION, options.catalogDirectory
        ));
        let generationService: OwnerWan27R2vGenerationService;
        try {
          generationService = new OwnerWan27R2vGenerationService({ binding: authBinding, linkService, catalog: generationCatalog,
            catalog_version: OWNER_WAN27_R2V_GENERATION_CATALOG_VERSION, preparer, referenceService,
            resolveChatClient: resolveWan27R2vChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(generationCatalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try { await preparer.close(); } catch (closeError) { errors.push(closeError); }
            try { await uploadService.close(); } catch (closeError) { errors.push(closeError); }
            try { await referenceService.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.7 R2V startup cleanup failed.");
          })();
          OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await generationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await uploadService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await referenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.7 R2V attempt invalidation drain failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await generationService.close(); } catch (error) { errors.push(error); }
              try { await uploadService.close(); } catch (error) { errors.push(error); }
              try { await referenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "WAN 2.7 R2V services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ referenceService, uploadService, generationService, lifecycle });
      })()
    : undefined;
  const ownerWan26I2v = options.ownerWan26I2vEnabled === true
    ? (() => {
        const ffprobePath = options.ownerWan26I2vFfprobePath;
        if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || !isAbsolute(ffprobePath) || ffprobePath.includes("\0")) {
          throw new Error("OWNER_WAN26_I2V_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveWan26I2vChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN26_I2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let referenceService: OwnerWan26I2vReferenceService | undefined;
        let preparer: ReturnType<typeof createOwnerWan26I2vRequestPreparer> | undefined;
        let generationService: OwnerWan26I2vGenerationService | undefined;
        try {
          // These components share the default performance.now() origin for reference TTLs.
          referenceService = new OwnerWan26I2vReferenceService({ binding: authBinding, linkService,
            resolveClient: resolveWan26I2vChatClient, ffprobePath });
          preparer = createOwnerWan26I2vRequestPreparer({ referenceService });
          const generationCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
            OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION, options.catalogDirectory
          ));
          generationService = new OwnerWan26I2vGenerationService({ binding: authBinding, linkService, catalog: generationCatalog,
            catalog_version: OWNER_WAN26_I2V_GENERATION_CATALOG_VERSION, preparer,
            resolveChatClient: resolveWan26I2vChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(generationCatalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try { await generationService?.close(); } catch (closeError) { errors.push(closeError); }
            if (generationService === undefined) {
              try { await preparer?.close(); } catch (closeError) { errors.push(closeError); }
            }
            try { await referenceService?.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 I2V startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const ownedReferenceService = referenceService;
        const ownedGenerationService = generationService;
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await ownedGenerationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await ownedReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 I2V attempt invalidation drain failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await ownedGenerationService.close(); } catch (error) { errors.push(error); }
              try { await ownedReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 I2V services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ referenceService: ownedReferenceService, generationService: ownedGenerationService, lifecycle });
      })()
    : undefined;
  const ownerWan26R2v = options.ownerWan26R2vEnabled === true
    ? (() => {
        const ffprobePath = options.ownerWan26R2vFfprobePath;
        const ffmpegPath = options.ownerWan26R2vFfmpegPath;
        if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || !isAbsolute(ffprobePath) || ffprobePath.includes("\0") ||
            typeof ffmpegPath !== "string" || ffmpegPath.length === 0 || !isAbsolute(ffmpegPath) || ffmpegPath.includes("\0")) {
          throw new Error("OWNER_WAN26_R2V_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveWan26R2vChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN26_R2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let referenceService: OwnerWan26R2vReferenceService | undefined;
        let preparer: ReturnType<typeof createOwnerWan26R2vRequestPreparer> | undefined;
        let generationService: OwnerWan26R2vGenerationService | undefined;
        try {
          // Reference/preparer keep their shared default monotonic performance.now() TTL origin.
          referenceService = new OwnerWan26R2vReferenceService({ binding: authBinding, linkService,
            resolveClient: resolveWan26R2vChatClient, ffprobePath, ffmpegPath });
          preparer = createOwnerWan26R2vRequestPreparer({ binding: authBinding, linkService, referenceService });
          const generationCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
            OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION, options.catalogDirectory
          ));
          generationService = new OwnerWan26R2vGenerationService({ binding: authBinding, linkService,
            catalog: generationCatalog, catalog_version: OWNER_WAN26_R2V_GENERATION_CATALOG_VERSION,
            preparer, referenceService, resolveChatClient: resolveWan26R2vChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(generationCatalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try { await generationService?.close(); } catch (closeError) { errors.push(closeError); }
            if (generationService === undefined) {
              try { await preparer?.close(); } catch (closeError) { errors.push(closeError); }
            }
            try { await referenceService?.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 R2V startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const ownedReferenceService = referenceService;
        const ownedGenerationService = generationService;
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await ownedGenerationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await ownedReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 R2V attempt invalidation drain failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await ownedGenerationService.close(); } catch (error) { errors.push(error); }
              try { await ownedReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "WAN 2.6 R2V services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ referenceService: ownedReferenceService, generationService: ownedGenerationService, lifecycle });
      })()
    : undefined;
  const ownerWan25I2vPreview = options.ownerWan25I2vPreviewEnabled === true
    ? (() => {
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveWan25I2vPreviewChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_WAN25_I2V_PREVIEW_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let referenceService: OwnerWan25I2vReferenceService | undefined;
        let preparer: ReturnType<typeof createOwnerWan25I2vRequestPreparer> | undefined;
        let generationService: OwnerWan25I2vGenerationService | undefined;
        try {
          // Reference/preparer TTL clocks share the default performance.now() origin; the service uses wall time for freshness.
          referenceService = new OwnerWan25I2vReferenceService({ binding: authBinding, linkService,
            resolveClient: resolveWan25I2vPreviewChatClient });
          preparer = createOwnerWan25I2vRequestPreparer({ referenceService });
          const generationCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
            OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION, options.catalogDirectory
          ));
          generationService = new OwnerWan25I2vGenerationService({ binding: authBinding, linkService, catalog: generationCatalog,
            catalog_version: OWNER_WAN25_I2V_GENERATION_CATALOG_VERSION, preparer,
            resolveChatClient: resolveWan25I2vPreviewChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(generationCatalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try { await generationService?.close(); } catch (closeError) { errors.push(closeError); }
            if (generationService === undefined) {
              try { await preparer?.close(); } catch (closeError) { errors.push(closeError); }
            }
            try { await referenceService?.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.5 I2V preview startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const ownedReferenceService = referenceService;
        const ownedPreparer = preparer;
        const ownedGenerationService = generationService;
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await ownedGenerationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await ownedPreparer.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await ownedReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "WAN 2.5 I2V preview attempt invalidation drain failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await ownedGenerationService.close(); } catch (error) { errors.push(error); }
              try { await ownedPreparer.close(); } catch (error) { errors.push(error); }
              try { await ownedReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "WAN 2.5 I2V preview services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ referenceService: ownedReferenceService, preparer: ownedPreparer,
          generationService: ownedGenerationService, lifecycle });
      })()
    : undefined;
  const ownerLumaT2v = options.ownerLumaT2vEnabled === true
    ? (() => {
        const registry = loadGenerationContractRegistryV2(OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION, options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveLumaChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_LUMA_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const generationService = new OwnerLumaT2vContractService({
          registry,
          registryVersion: OWNER_LUMA_T2V_CONTRACT_REGISTRY_VERSION,
          catalog,
          binding: authBinding,
          linkService,
          resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
          resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
            new ModelAccessService(catalog, createReadClient(attemptId), now).getModelAccess({
              model_id: modelId,
              cost_parameters: costParameters
            }, signal),
          resolveChatClient: resolveLumaChatClient,
          now
        });
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ generationService, lifecycle });
      })()
    : undefined;
  const ownerHailuo01T2v = options.ownerHailuo01T2vEnabled === true
    ? (() => {
        const profile = createOwnerHailuo01T2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuo01ChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO01_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerReviewedNoReferenceT2vService;
        try {
          generationService = new OwnerReviewedNoReferenceT2vService({
            profile,
            binding: authBinding,
            linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId,
                cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveHailuo01ChatClient,
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerHailuo01DirectorT2v = options.ownerHailuo01DirectorT2vEnabled === true
    ? (() => {
        const profile = createOwnerHailuo01DirectorT2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuo01DirectorChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO01_DIRECTOR_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerHailuo01DirectorT2vGenerationService;
        try {
          generationService = new OwnerHailuo01DirectorT2vGenerationService({
            profile,
            binding: authBinding,
            linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId,
                cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveHailuo01DirectorChatClient,
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerHailuo23T2v = options.ownerHailuo23T2vEnabled === true
    ? (() => {
        const profile = createOwnerHailuo23T2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuo23ChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO23_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerHailuo23T2vGenerationService;
        try {
          generationService = new OwnerHailuo23T2vGenerationService({
            profile, binding: authBinding, linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveHailuo23ChatClient, now
          });
        } catch (error) { clientsByAttempt.clear(); throw error; }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerHailuo02T2v = options.ownerHailuo02T2vEnabled === true
    ? (() => {
        const profile = createOwnerHailuo02T2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuo02ChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO02_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerHailuo02T2vGenerationService;
        try {
          generationService = new OwnerHailuo02T2vGenerationService({
            profile, binding: authBinding, linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveHailuo02ChatClient, now
          });
        } catch (error) { clientsByAttempt.clear(); throw error; }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerSeedance20T2v = options.ownerSeedance20T2vEnabled === true
    ? (() => {
        const profile = createOwnerSeedance20T2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveSeedance20ChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_SEEDANCE20_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerSeedance20T2vGenerationService;
        try {
          generationService = new OwnerSeedance20T2vGenerationService({
            profile, binding: authBinding, linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveSeedance20ChatClient, now
          });
        } catch (error) { clientsByAttempt.clear(); throw error; }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerKlingT2v = options.ownerKlingT2vEnabled === true
    ? (() => {
        const profile = createOwnerKlingT2vProfile("kling_text2video", options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveKlingChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_KLING_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerKlingT2vGenerationService;
        try {
          generationService = new OwnerKlingT2vGenerationService({
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            binding: authBinding,
            linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveKlingChatClient,
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerKlingI2v = options.ownerKlingI2vEnabled === true
    ? (() => {
        const klingI2vCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_KLING_I2V_SOURCE_PINS.public_catalog_version,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveKlingI2vChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_KLING_I2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const referenceService = new OwnerKlingI2VImageReferenceService({
          binding: authBinding,
          linkService,
          resolveClient: resolveKlingI2vChatClient,
          destination: "uploaded",
          now
        });
        let generationService: OwnerKlingI2vGenerationService;
        try {
          generationService = new OwnerKlingI2vGenerationService({
            binding: authBinding,
            linkService,
            catalog: klingI2vCatalog,
            referenceService,
            resolveChatClient: resolveKlingI2vChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(klingI2vCatalog, createReadClient(attemptId), now),
            now
          });
        } catch (error) {
          const cleanup = (async () => {
            try { await referenceService.close(); }
            finally { clientsByAttempt.clear(); }
          })();
          OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const results = await Promise.allSettled([
              generationService.invalidateAttempt(attemptId),
              referenceService.invalidateAttempt(attemptId)
            ]);
            const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
            if (errors.length === 0) clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Owner Kling I2V attempt cleanup failed.");
          },
          async close(): Promise<void> {
            const results = await Promise.allSettled([generationService.close(), referenceService.close()]);
            const errors = results.flatMap((result) => result.status === "rejected" ? [result.reason] : []);
            if (errors.length === 0) clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Owner Kling I2V services did not close cleanly.");
          }
        });
        return Object.freeze({ referenceService, generationService, lifecycle });
      })()
    : undefined;
  const ownerKlingKeyframes = options.ownerKlingKeyframesEnabled === true
    ? (() => {
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveKlingKeyframesChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_KLING_KEYFRAMES_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const referenceService = new OwnerKlingKeyframesReferenceService({
          binding: authBinding, linkService, resolveClient: resolveKlingKeyframesChatClient, now
        });
        const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_KLING_KEYFRAMES_GENERATION_CATALOG_VERSION, options.catalogDirectory
        ));
        const preparer = createOwnerKlingKeyframesRequestPreparer({ referenceService, now });
        let generationService: OwnerKlingKeyframesGenerationService | undefined;
        try {
          generationService = new OwnerKlingKeyframesGenerationService({ binding: authBinding, linkService, catalog,
            catalog_version: OWNER_KLING_KEYFRAMES_GENERATION_CATALOG_VERSION, preparer,
            resolveChatClient: resolveKlingKeyframesChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try {
              if (generationService !== undefined) await generationService.close();
              else await preparer.close();
            } catch (closeError) { errors.push(closeError); }
            try { await referenceService.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Kling Keyframes startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { try { await referenceService.invalidateAttempt(attemptId); }
              finally { clientsByAttempt.delete(attemptId); } }
          },
          async close(): Promise<void> {
            try { await generationService!.close(); }
            finally { try { await referenceService.close(); }
              finally { clientsByAttempt.clear(); } }
          }
        });
        return Object.freeze({ referenceService, generationService, lifecycle });
      })()
    : undefined;
  const ownerKlingMotionControl = options.ownerKlingMotionControlEnabled === true
    ? (() => {
        const ffprobePath = options.ownerKlingMotionControlFfprobePath;
        if (typeof ffprobePath !== "string" || ffprobePath.length === 0 || !isAbsolute(ffprobePath) || ffprobePath.includes("\0")) {
          throw new Error("OWNER_KLING_MOTION_CONTROL_OPERATOR_CONFIGURATION_REQUIRED");
        }
        const catalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION, options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveKlingMotionControlChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_KLING_MOTION_CONTROL_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let referenceService: OwnerKlingMotionControlReferenceService | undefined;
        let presetReferenceService: OwnerKlingMotionControlPresetReferenceService | undefined;
        let preparer: ReturnType<typeof createOwnerKlingMotionControlRequestPreparer> | undefined;
        let generationService: OwnerKlingMotionControlGenerationService | undefined;
        try {
          referenceService = new OwnerKlingMotionControlReferenceService({ binding: authBinding, linkService,
            resolveClient: resolveKlingMotionControlChatClient, ffprobePath, now });
          presetReferenceService = new OwnerKlingMotionControlPresetReferenceService({ binding: authBinding, linkService,
            resolveClient: resolveKlingMotionControlChatClient, ffprobePath, fetchImpl: options.fetchImpl, now });
          preparer = createOwnerKlingMotionControlRequestPreparer({ referenceService, presetReferenceService, now });
          generationService = new OwnerKlingMotionControlGenerationService({ binding: authBinding, linkService, catalog,
            catalog_version: OWNER_KLING_MOTION_CONTROL_GENERATION_CATALOG_VERSION, preparer,
            resolveChatClient: resolveKlingMotionControlChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(catalog, createReadClient(attemptId), now), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            if (generationService !== undefined) {
              try { await generationService.close(); } catch (closeError) { errors.push(closeError); }
            } else if (preparer !== undefined) {
              try { await preparer.close(); } catch (closeError) { errors.push(closeError); }
            }
            for (const service of [presetReferenceService, referenceService]) {
              try { await service?.close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Kling Motion Control startup cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService!.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            const errors: unknown[] = [];
            try { await generationService!.close(); } catch (error) { errors.push(error); }
            for (const service of [presetReferenceService!, referenceService!]) {
              try { await service.close(); } catch (error) { errors.push(error); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Owner Kling Motion Control services did not close cleanly.");
          }
        });
        return Object.freeze({ referenceService: referenceService!, presetReferenceService: presetReferenceService!, generationService: generationService!, lifecycle });
      })()
    : undefined;
  const ownerHailuo02I2v = options.ownerHailuo02I2vEnabled === true
    ? (() => {
        const hailuoCatalog = new DiscoveryCatalogRepository(loadPublicCatalogVersion(
          OWNER_HAILUO02_I2V_SOURCE_PINS.public_catalog_version,
          options.catalogDirectory
        ));
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuoChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO02_I2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        const imageReferenceService = new OwnerHailuo02I2vImageReferenceService({
          binding: authBinding, linkService, resolveClient: resolveHailuoChatClient, now
        });
        const preparer = createOwnerHailuo02I2vRequestPreparer({ imageReferenceService, now });
        let generationService: OwnerHailuo02I2vGenerationService;
        try {
          generationService = new OwnerHailuo02I2vGenerationService({
            binding: authBinding, linkService, catalog: hailuoCatalog,
            catalog_version: OWNER_HAILUO02_I2V_GENERATION_CATALOG_VERSION,
            preparer, imageReferenceService, resolveChatClient: resolveHailuoChatClient,
            createAccountStatusService: (attemptId: string) => new AccountStatusService(createReadClient(attemptId), now),
            createModelAccessService: (attemptId: string) => new ModelAccessService(hailuoCatalog, createReadClient(attemptId), now), now
          });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            try { await preparer.close(); } catch (closeError) { errors.push(closeError); }
            try { await imageReferenceService.close(); } catch (closeError) { errors.push(closeError); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Hailuo-02 I2V startup cleanup failed.");
          })();
          OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          throw error;
        }
        let closing: Promise<void> | undefined;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await generationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await imageReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Hailuo-02 I2V attempt cleanup failed.");
          },
          close(): Promise<void> {
            if (closing !== undefined) return closing;
            closing = (async () => {
              const errors: unknown[] = [];
              try { await generationService.close(); } catch (error) { errors.push(error); }
              try { await preparer.close(); } catch (error) { errors.push(error); }
              try { await imageReferenceService.close(); } catch (error) { errors.push(error); }
              clientsByAttempt.clear();
              if (errors.length === 1) throw errors[0];
              if (errors.length > 1) throw new AggregateError(errors, "Hailuo-02 I2V services did not close cleanly.");
            })();
            return closing;
          }
        });
        return Object.freeze({ imageReferenceService, generationService, lifecycle });
      })()
    : undefined;
  const ownerVeoOmniReferences = options.ownerVeoOmniReferencesEnabled === true
    ? (() => {
        try {
          return createOwnerVeoOmniReferenceRuntime({
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            binding: authBinding, linkService, createReadClient, createChatClient, now,
            ffprobePath: options.ownerVeoOmniReferencesFfprobePath ?? "",
            ...(options.ownerVeoOmniReferencesMaxFileBytes === undefined ? {} : { maxFileBytes: options.ownerVeoOmniReferencesMaxFileBytes })
          });
        } catch (error) {
          const cleanup = getOwnerVeoOmniReferenceRuntimeStartupCleanup(error);
          if (cleanup && error && typeof error === "object") OWNER_RUNTIME_STARTUP_CLEANUPS.set(error, cleanup);
          throw error;
        }
      })()
    : undefined;
  const ownerVeoOmniT2v = options.ownerVeoOmniT2vEnabled === true
    ? createOwnerVeoOmniT2vRuntime({
        ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
        binding: authBinding, linkService, createReadClient, createChatClient, now
      })
    : undefined;
  const ownerVeoT2v = options.ownerVeoT2vEnabled === true
    ? (() => {
        const profile = createOwnerVeoT2vProfile("veo3", options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveVeoChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_VEO_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerVeoT2vGenerationService;
        try {
          generationService = new OwnerVeoT2vGenerationService({
            ...(options.catalogDirectory === undefined ? {} : { catalogDirectory: options.catalogDirectory }),
            binding: authBinding,
            linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveVeoChatClient,
            now
          });
        } catch (error) {
          clientsByAttempt.clear();
          throw error;
        }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerGrokT2v = options.ownerGrokT2vEnabled === true
    ? (() => {
        const profile = createOwnerGrokT2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveGrokT2vChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_GROK_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerGrokT2vGenerationService;
        try {
          generationService = new OwnerGrokT2vGenerationService({
            profile, binding: authBinding, linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveGrokT2vChatClient, now
          });
        } catch (error) { clientsByAttempt.clear(); throw error; }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerHailuoLiveT2v = options.ownerHailuoLiveT2vEnabled === true
    ? (() => {
        const profile = createOwnerHailuoLiveT2vProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveHailuoLiveChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_HAILUO_LIVE_T2V_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let generationService: OwnerHailuoLiveT2vGenerationService;
        try {
          generationService = new OwnerHailuoLiveT2vGenerationService({
            profile, binding: authBinding, linkService,
            resolveSubscription: (attemptId, signal) => createReadClient(attemptId).getSubscription(signal),
            resolveModelAccess: (attemptId, modelId, costParameters, signal) =>
              new ModelAccessService(profile.catalog, createReadClient(attemptId), now).getModelAccess({
                model_id: modelId, cost_parameters: costParameters
              }, signal),
            resolveChatClient: resolveHailuoLiveChatClient, now
          });
        } catch (error) { clientsByAttempt.clear(); throw error; }
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            try { await generationService.invalidateAttempt(attemptId); }
            finally { clientsByAttempt.delete(attemptId); }
          },
          async close(): Promise<void> {
            try { await generationService.close(); }
            finally { clientsByAttempt.clear(); }
          }
        });
        return Object.freeze({ profile, generationService, lifecycle });
      })()
    : undefined;
  const ownerVideo2Audio = options.ownerVideo2AudioEnabled === true
    ? (() => {
        const profile = createOwnerVideo2AudioSourceProfile(options.catalogDirectory);
        const clientsByAttempt = new Map<string, SyntxChatHttpClient>();
        const resolveVideo2AudioChatClient = (attemptId: string): SyntxChatHttpClient => {
          const existing = clientsByAttempt.get(attemptId);
          if (existing !== undefined) return existing;
          if (clientsByAttempt.size >= 128) throw new Error("OWNER_VIDEO2AUDIO_CLIENT_CAPACITY_EXCEEDED");
          const client = createChatClient(attemptId);
          clientsByAttempt.set(attemptId, client);
          return client;
        };
        let originalReferenceService: OwnerVideo2AudioOriginalReferenceService | undefined;
        let preparer: ReturnType<typeof createOwnerVideo2AudioRequestPreparer> | undefined;
        let generationService: OwnerVideo2AudioGenerationService | undefined;
        try {
          originalReferenceService = new OwnerVideo2AudioOriginalReferenceService({ profile, binding: authBinding, linkService,
            resolveClient: resolveVideo2AudioChatClient, now });
          preparer = createOwnerVideo2AudioRequestPreparer({ profile, originalReferenceService, now });
          generationService = new OwnerVideo2AudioGenerationService({ profile, preparer, binding: authBinding, linkService,
            resolveCurrentAccountLimits: (attemptId: string, signal?: AbortSignal) => new AccountStatusService(createReadClient(attemptId), now).getAccountStatus(signal),
            resolveModelAccess: (attemptId: string, request: Readonly<{ model_id: "video2audio";
              cost_parameters: Readonly<Record<string, never>> }>, signal?: AbortSignal) => new ModelAccessService(profile.catalog, createReadClient(attemptId), now)
              .getModelAccess({ model_id: request.model_id, cost_parameters: request.cost_parameters }, signal), now });
        } catch (error) {
          const cleanup = (async () => {
            const errors: unknown[] = [];
            for (const close of [() => generationService?.close(), () => preparer?.close(), () => originalReferenceService?.close()]) {
              try { await close(); } catch (closeError) { errors.push(closeError); }
            }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Video2Audio runtime constructor cleanup failed.");
          })();
          if (error !== null && (typeof error === "object" || typeof error === "function")) {
            OWNER_RUNTIME_STARTUP_CLEANUPS.set(error as object, cleanup);
          }
          throw error;
        }
        const ownedOriginalReferenceService = originalReferenceService;
        const ownedGenerationService = generationService;
        const lifecycle = Object.freeze({
          async invalidateAttempt(attemptId: string): Promise<void> {
            const errors: unknown[] = [];
            try { await ownedGenerationService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            try { await ownedOriginalReferenceService.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            clientsByAttempt.delete(attemptId);
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Video2Audio attempt cleanup failed.");
          },
          async close(): Promise<void> {
            const errors: unknown[] = [];
            try { await ownedGenerationService.close(); } catch (error) { errors.push(error); }
            try { await ownedOriginalReferenceService.close(); } catch (error) { errors.push(error); }
            clientsByAttempt.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Video2Audio service shutdown was incomplete.");
          }
        });
        return Object.freeze({ profile, originalReferenceService: ownedOriginalReferenceService,
          generationService: ownedGenerationService, lifecycle });
      })()
    : undefined;
  const ownerAuthLinkService: Pick<PerUserLinkService, "createAttempt" | "issueHandoff" | "checkAttempt" | "revoke"> =
    ownerSoulImageReferences === undefined && ownerGrokT2iImageReferences === undefined && ownerWanT2iImageReferences === undefined &&
    ownerWanT2vVideos === undefined && ownerWan30FirstLastVideos === undefined && ownerWan30ReferenceVideos === undefined && ownerWan30OmniVideos === undefined && ownerWan30EditVideos === undefined && ownerFlux3Videos === undefined && ownerGrokV2v === undefined && ownerWan27R2v === undefined && ownerWan26I2v === undefined && ownerWan26R2v === undefined && ownerWan25I2vPreview === undefined && ownerElevenLabsTts === undefined && ownerElevenLabsDialogue === undefined && ownerElevenLabsSts === undefined && ownerSunoGeneration === undefined &&
      ownerLumaT2v === undefined &&
      ownerHailuo01T2v === undefined &&
      ownerHailuo01DirectorT2v === undefined &&
      ownerHailuo23T2v === undefined &&
      ownerHailuo02T2v === undefined &&
      ownerSeedance20T2v === undefined &&
      ownerKlingT2v === undefined &&
      ownerKlingI2v === undefined &&
      ownerKlingKeyframes === undefined &&
      ownerKlingMotionControl === undefined &&
      ownerHailuo02I2v === undefined &&
      ownerVeoT2v === undefined &&
      ownerVeoOmniT2v === undefined &&
      ownerVeoOmniReferences === undefined &&
      ownerGrokT2v === undefined &&
      ownerHailuoLiveT2v === undefined &&
      ownerVideo2Audio === undefined &&
      ownerUniImageReferences === undefined && ownerWanImageReferences === undefined && ownerStandardImageReferences === undefined &&
      ownerRunwayImageReferences === undefined && ownerSeedreamImageReferences === undefined &&
      ownerSeedreamEditorImageReferences === undefined &&
      ownerFluxImageReferences === undefined && ownerIdeogramImageReferences === undefined && ownerBananaInpaintImageReferences === undefined
      ? linkService
      : Object.freeze({
          createAttempt: linkService.createAttempt.bind(linkService),
          issueHandoff: linkService.issueHandoff.bind(linkService),
          checkAttempt: linkService.checkAttempt.bind(linkService),
          async revoke(binding, attemptId) {
            if (ownerBananaInpaintImageReferences !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerBananaInpaintImageReferences.generationService.invalidateAttempt(attemptId);
            }
            if (ownerSeedreamEditorImageReferences !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerSeedreamEditorImageReferences.invalidateAttempt(attemptId);
            }
            if (ownerWanT2vVideos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWanT2vVideos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan30FirstLastVideos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan30FirstLastVideos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan30ReferenceVideos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan30ReferenceVideos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan30OmniVideos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan30OmniVideos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan30EditVideos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan30EditVideos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerFlux3Videos !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerFlux3Videos.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerGrokV2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerGrokV2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan27R2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan27R2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan26I2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan26I2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan26R2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan26R2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerWan25I2vPreview !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerWan25I2vPreview.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerElevenLabsShared !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerElevenLabsShared.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerSunoGeneration !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerSunoGeneration.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerLumaT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerLumaT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuo01T2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuo01T2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuo01DirectorT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuo01DirectorT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuo23T2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuo23T2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuo02T2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuo02T2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerSeedance20T2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerSeedance20T2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerKlingT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerKlingT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerKlingI2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerKlingI2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerKlingKeyframes !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerKlingKeyframes.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerKlingMotionControl !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerKlingMotionControl.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuo02I2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuo02I2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerVeoT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerVeoT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerVeoOmniT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerVeoOmniT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerVeoOmniReferences !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerVeoOmniReferences.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerGrokT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerGrokT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerHailuoLiveT2v !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerHailuoLiveT2v.lifecycle.invalidateAttempt(attemptId);
            }
            if (ownerVideo2Audio !== undefined) {
              await linkService.getStatus(binding, attemptId);
              await ownerVideo2Audio.lifecycle.invalidateAttempt(attemptId);
            }
            const errors: unknown[] = [];
            for (const service of [ownerSoulImageReferences?.generationService, ownerGrokT2iImageReferences?.generationService,
              ownerWanT2iImageReferences?.generationService,
              ownerUniImageReferences?.generationService, ownerWanImageReferences?.generationService,
              ownerStandardImageReferences?.generationService, ownerRunwayImageReferences?.generationService,
              ownerSeedreamImageReferences?.generationService, ownerFluxImageReferences?.generationService,
              ownerIdeogramImageReferences?.generationService]) {
              if (service === undefined) continue;
              try { await service.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
            }
            if (errors.length === 1) throw errors[0];
            if (errors.length > 1) throw new AggregateError(errors, "Owner paid-generation revocation drain failed.");
            return linkService.revoke(binding, attemptId);
          }
        });
  const serverOptions: CreateMcpServerOptions = {
    auth: {
      linkService: ownerAuthLinkService,
      binding: authBinding,
      ...((ownerImageReferences === undefined && ownerGrokImageReferences === undefined && ownerGrokT2iImageReferences === undefined &&
        ownerWanT2iImageReferences === undefined && ownerUniImageReferences === undefined &&
        ownerWanT2vVideos === undefined &&
        ownerElevenLabsShared === undefined &&
        ownerSunoGeneration === undefined &&
        ownerLumaT2v === undefined &&
        ownerHailuo01T2v === undefined &&
        ownerHailuo01DirectorT2v === undefined &&
        ownerHailuo23T2v === undefined &&
        ownerHailuo02T2v === undefined &&
        ownerSeedance20T2v === undefined &&
        ownerKlingT2v === undefined &&
        ownerKlingI2v === undefined &&
        ownerKlingKeyframes === undefined &&
        ownerKlingMotionControl === undefined &&
        ownerHailuo02I2v === undefined &&
        ownerVeoT2v === undefined &&
        ownerVeoOmniT2v === undefined &&
        ownerVeoOmniReferences === undefined &&
        ownerGrokT2v === undefined &&
        ownerHailuoLiveT2v === undefined &&
        ownerVideo2Audio === undefined &&
        ownerWan30FirstLastVideos === undefined && ownerWan30ReferenceVideos === undefined && ownerWan30OmniVideos === undefined && ownerWan30EditVideos === undefined && ownerFlux3Videos === undefined && ownerGrokV2v === undefined && ownerWan27R2v === undefined && ownerWan26I2v === undefined && ownerWan26R2v === undefined && ownerWan25I2vPreview === undefined &&
        ownerTopazAstra === undefined && ownerTopazEnhance === undefined &&
        ownerSoulCatalogShape === undefined && ownerSoulStyleOptions === undefined && ownerClarityUpscale === undefined &&
        ownerMagnificUpscale === undefined && ownerKontextImageReferences === undefined &&
        ownerStandardImageReferences === undefined && ownerRunwayImageReferences === undefined &&
        ownerSeedreamImageReferences === undefined && ownerSeedreamEditorImageReferences === undefined && ownerFluxImageReferences === undefined &&
        ownerIdeogramImageReferences === undefined && ownerBananaInpaintImageReferences === undefined) ? {} : {
        onRevoked: async (attemptId: string) => {
          const errors: unknown[] = [];
          if (ownerSeedreamEditorImageReferences !== undefined) {
            try { await ownerSeedreamEditorImageReferences.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWanT2vVideos !== undefined) {
            try { await ownerWanT2vVideos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan30FirstLastVideos !== undefined) {
            try { await ownerWan30FirstLastVideos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan30ReferenceVideos !== undefined) {
            try { await ownerWan30ReferenceVideos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan30OmniVideos !== undefined) {
            try { await ownerWan30OmniVideos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan30EditVideos !== undefined) {
            try { await ownerWan30EditVideos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan27R2v !== undefined) {
            try { await ownerWan27R2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan26I2v !== undefined) {
            try { await ownerWan26I2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan26R2v !== undefined) {
            try { await ownerWan26R2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerWan25I2vPreview !== undefined) {
            try { await ownerWan25I2vPreview.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerElevenLabsShared !== undefined) {
            try { await ownerElevenLabsShared.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerSunoGeneration !== undefined) {
            try { await ownerSunoGeneration.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerTopazAstra !== undefined) {
            try { await ownerTopazAstra.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerTopazEnhance !== undefined) {
            try { await ownerTopazEnhance.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerFlux3Videos !== undefined) {
            try { await ownerFlux3Videos.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerGrokV2v !== undefined) {
            try { await ownerGrokV2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerLumaT2v !== undefined) {
            try { await ownerLumaT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuo01T2v !== undefined) {
            try { await ownerHailuo01T2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuo01DirectorT2v !== undefined) {
            try { await ownerHailuo01DirectorT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuo23T2v !== undefined) {
            try { await ownerHailuo23T2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuo02T2v !== undefined) {
            try { await ownerHailuo02T2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerSeedance20T2v !== undefined) {
            try { await ownerSeedance20T2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerKlingT2v !== undefined) {
            try { await ownerKlingT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerKlingI2v !== undefined) {
            try { await ownerKlingI2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerKlingKeyframes !== undefined) {
            try { await ownerKlingKeyframes.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerKlingMotionControl !== undefined) {
            try { await ownerKlingMotionControl.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuo02I2v !== undefined) {
            try { await ownerHailuo02I2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerVeoT2v !== undefined) {
            try { await ownerVeoT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerVeoOmniT2v !== undefined) {
            try { await ownerVeoOmniT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerVeoOmniReferences !== undefined) {
            try { await ownerVeoOmniReferences.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerGrokT2v !== undefined) {
            try { await ownerGrokT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerHailuoLiveT2v !== undefined) {
            try { await ownerHailuoLiveT2v.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (ownerVideo2Audio !== undefined) {
            try { await ownerVideo2Audio.lifecycle.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          for (const service of [ownerImageReferences, ownerGrokImageReferences, ownerSoulImageReferences?.generationService,
            ownerGrokT2iImageReferences?.generationService,
            ownerWanT2iImageReferences?.generationService,
            ownerUniImageReferences?.generationService,
            ownerSoulCatalogShape, ...(ownerSoulImageReferences === undefined ? [ownerSoulStyleOptions] : []),
            ownerClarityUpscale?.generationService, ownerMagnificUpscale?.generationService,
            ownerKontextImageReferences?.generationService, ownerStandardImageReferences?.generationService,
            ownerRunwayImageReferences?.generationService, ownerSeedreamImageReferences?.generationService,
            ownerFluxImageReferences?.generationService, ownerIdeogramImageReferences?.generationService,
            ownerBananaInpaintImageReferences?.generationService]) {
            if (service === undefined) continue;
            try { await service.invalidateAttempt(attemptId); } catch (error) { errors.push(error); }
          }
          if (errors.length === 1) throw errors[0];
          if (errors.length > 1) throw new AggregateError(errors, "Owner read-service revocation cleanup failed.");
        }
      })
    },
    modelAccess: {
      catalog,
      resolveClient: createReadClient,
      now
    },
    ...(options.accountStatusEnabled === true ? {
      accountStatus: {
        resolveClient: createReadClient,
        now
      }
    } : {}),
    ...(options.uploadedFilesEnabled === true ? {
      uploadedFiles: {
        resolveClient: createReadClient
      }
    } : {}),
    ...(options.uploadFileEnabled === true ? {
      uploadFile: {
        catalog,
        resolveClient: createReadClient
      }
    } : {}),
    ...(options.reconcileUploadedFileEnabled === true ? {
      reconcileUploadedFile: {
        resolveClient: createReadClient
      }
    } : {}),
    ...(options.generateImageEnabled === true ? {
      ownerGenerateImage: {
        resolveChatClient: createChatClient,
        assertGenerationAllowed,
        recoveryStore: options.imageRecoveryStore ?? new OwnerImageRecoveryStore({ now })
      }
    } : {}),
    ...(options.generateVideoEnabled === true ? {
      ownerGenerateVideo: {
        resolveChatClient: createChatClient,
        assertGenerationAllowed,
        ...(options.videoRecoveryStore === undefined ? {} : { recoveryStore: options.videoRecoveryStore })
      }
    } : {}),
    ...(ownerContractMedia === undefined ? {} : {
      ownerContractMedia,
      ...(ownerContractMediaRegistry?.schema_version === "2.0.0"
        ? { generationContractRegistryV2: ownerContractMediaRegistry }
        : { generationContractRegistry: ownerContractMediaRegistry })
    }),
    ...(ownerImageReferences === undefined ? {} : { ownerImageReferences }),
    ...(ownerGrokImageReferences === undefined ? {} : { ownerGrokImageReferences }),
    ...(ownerGrokT2iImageReferences === undefined ? {} : { ownerGrokT2iImageReferences }),
    ...(ownerUniImageReferences === undefined ? {} : { ownerUniImageReferences }),
    ...(ownerWanT2iImageReferences === undefined ? {} : { ownerWanT2iImageReferences }),
    ...(ownerWanT2vVideos === undefined ? {} : { ownerWanT2vVideos: { generationService: ownerWanT2vVideos.generationService } }),
    ...(ownerWan30FirstLastVideos === undefined ? {} : {
      ownerWan30FirstLastVideos: { generationService: ownerWan30FirstLastVideos.generationService }
    }),
    ...(ownerWan30ReferenceVideos === undefined ? {} : {
      ownerWan30ReferenceVideos: { generationService: ownerWan30ReferenceVideos.generationService }
    }),
    ...(ownerWan30OmniVideos === undefined ? {} : {
      ownerWan30OmniVideos: { generationService: ownerWan30OmniVideos.generationService }
    }),
    ...(ownerWan30EditVideos === undefined ? {} : {
      ownerWan30EditVideos: { generationService: ownerWan30EditVideos.generationService }
    }),
    ...(ownerFlux3Videos === undefined ? {} : {
      ownerFlux3Videos: {
        generationService: ownerFlux3Videos.generationService,
        referenceService: ownerFlux3Videos.referenceService
      }
    }),
    ...(ownerGrokV2v === undefined ? {} : {
      ownerGrokV2v: { generationService: ownerGrokV2v.generationService, referenceService: ownerGrokV2v.referenceService }
    }),
    ...(ownerElevenLabsTts === undefined ? {} : {
      ownerElevenLabsTts: {
        voiceReferenceService: ownerElevenLabsTts.voiceReferenceService,
        generationService: ownerElevenLabsTts.generationService
      }
    }),
    ...(ownerElevenLabsDialogue === undefined ? {} : { ownerElevenLabsDialogue: {
      voiceReferenceService: ownerElevenLabsDialogue.voiceReferenceService,
      generationService: ownerElevenLabsDialogue.generationService
    } }),
    ...(ownerElevenLabsSts === undefined ? {} : { ownerElevenLabsSts: {
      originalReferenceService: ownerElevenLabsSts.originalReferenceService,
      voiceReferenceService: ownerElevenLabsSts.voiceReferenceService,
      generationService: ownerElevenLabsSts.generationService,
      existingMediaService: ownerElevenLabsSts.existingMediaService
    } }),
    ...(ownerSunoGeneration === undefined ? {} : {
      ownerSunoGeneration: { generationService: ownerSunoGeneration.generationService }
    }),
    ...(ownerTopazAstra === undefined ? {} : {
      ownerTopazAstra: {
        originalReferenceService: ownerTopazAstra.originalReferenceService,
        generationService: ownerTopazAstra.generationService,
        existingMediaService: ownerTopazAstra.existingMediaService
      }
    }),
    ...(ownerTopazEnhance === undefined ? {} : {
      ownerTopazEnhance: {
        originalReferenceService: ownerTopazEnhance.originalReferenceService,
        generationService: ownerTopazEnhance.generationService
      }
    }),
    ...(ownerLumaT2v === undefined ? {} : { ownerLumaT2v: { generationService: ownerLumaT2v.generationService } }),
    ...(ownerHailuo01T2v === undefined ? {} : { ownerHailuo01T2v: { generationService: ownerHailuo01T2v.generationService } }),
    ...(ownerHailuo01DirectorT2v === undefined ? {} : { ownerHailuo01DirectorT2v: { generationService: ownerHailuo01DirectorT2v.generationService } }),
    ...(ownerHailuo23T2v === undefined ? {} : { ownerHailuo23T2v: { generationService: ownerHailuo23T2v.generationService } }),
    ...(ownerHailuo02T2v === undefined ? {} : { ownerHailuo02T2v: { generationService: ownerHailuo02T2v.generationService } }),
    ...(ownerSeedance20T2v === undefined ? {} : { ownerSeedance20T2v: { generationService: ownerSeedance20T2v.generationService } }),
    ...(ownerKlingT2v === undefined ? {} : { ownerKlingT2v: { generationService: ownerKlingT2v.generationService } }),
    ...(ownerKlingI2v === undefined ? {} : { ownerKlingI2v: { referenceService: ownerKlingI2v.referenceService,
      generationService: ownerKlingI2v.generationService } }),
    ...(ownerKlingKeyframes === undefined ? {} : { ownerKlingKeyframes: {
      referenceService: ownerKlingKeyframes.referenceService, generationService: ownerKlingKeyframes.generationService, now
    } }),
    ...(ownerKlingMotionControl === undefined ? {} : { ownerKlingMotionControl: {
      referenceService: ownerKlingMotionControl.referenceService,
      presetReferenceService: ownerKlingMotionControl.presetReferenceService,
      generationService: ownerKlingMotionControl.generationService,
      now
    } }),
    ...(ownerHailuo02I2v === undefined ? {} : { ownerHailuo02I2v: {
      imageReferenceService: ownerHailuo02I2v.imageReferenceService, generationService: ownerHailuo02I2v.generationService
    } }),
    ...(ownerVeoT2v === undefined ? {} : { ownerVeoT2v: { generationService: ownerVeoT2v.generationService } }),
    ...(ownerVeoOmniT2v === undefined ? {} : { ownerVeoOmniT2v: { generationService: ownerVeoOmniT2v.generationService } }),
    ...(ownerVeoOmniReferences === undefined ? {} : { ownerVeoOmniReferences: { referenceService: ownerVeoOmniReferences.referenceService,
      generationService: ownerVeoOmniReferences.generationService, maxFileBytes: ownerVeoOmniReferences.maxFileBytes } }),
    ...(ownerGrokT2v === undefined ? {} : { ownerGrokT2v: { generationService: ownerGrokT2v.generationService } }),
    ...(ownerHailuoLiveT2v === undefined ? {} : { ownerHailuoLiveT2v: { generationService: ownerHailuoLiveT2v.generationService } }),
    ...(ownerVideo2Audio === undefined ? {} : { ownerVideo2Audio }),
    ...(ownerWan27R2v === undefined ? {} : { ownerWan27R2v: { referenceUploadService: ownerWan27R2v.uploadService, generationService: ownerWan27R2v.generationService } }),
    ...(ownerWan26I2v === undefined ? {} : { ownerWan26I2v: { referenceService: ownerWan26I2v.referenceService, generationService: ownerWan26I2v.generationService } }),
    ...(ownerWan26R2v === undefined ? {} : { ownerWan26R2v: { referenceService: ownerWan26R2v.referenceService, generationService: ownerWan26R2v.generationService } }),
    ...(ownerWan25I2vPreview === undefined ? {} : { ownerWan25I2vPreview: {
      referenceService: ownerWan25I2vPreview.referenceService, generationService: ownerWan25I2vPreview.generationService
    } }),
    ...(ownerSoulCatalogShape === undefined ? {} : { ownerSoulCatalogShape }),
    ...(ownerSoulStyleOptions === undefined ? {} : { ownerSoulStyleOptions }),
    ...(ownerSoulImageReferences === undefined ? {} : { ownerSoulImageReferences }),
    ...(ownerClarityUpscale === undefined ? {} : { ownerClarityUpscale }),
    ...(ownerMagnificUpscale === undefined ? {} : { ownerMagnificUpscale }),
    ...(ownerKontextImageReferences === undefined ? {} : { ownerKontextImageReferences }),
    ...(ownerWanImageReferences === undefined ? {} : { ownerWanImageReferences }),
    ...(ownerStandardImageReferences === undefined ? {} : { ownerStandardImageReferences }),
    ...(ownerRunwayImageReferences === undefined ? {} : { ownerRunwayImageReferences }),
    ...(ownerSeedreamImageReferences === undefined ? {} : { ownerSeedreamImageReferences }),
    ...(ownerSeedreamEditorImageReferences === undefined ? {} : {
      ownerSeedreamEditorImageReferences: {
        originalReferenceService: ownerSeedreamEditorImageReferences.originalReferenceService,
        drawingReferenceService: ownerSeedreamEditorImageReferences.drawingReferenceService,
        generationService: ownerSeedreamEditorImageReferences.generationService
      }
    }),
    ...(ownerFluxImageReferences === undefined ? {} : { ownerFluxImageReferences }),
    ...(ownerIdeogramImageReferences === undefined ? {} : { ownerIdeogramImageReferences }),
    ...(ownerBananaInpaintImageReferences === undefined ? {} : { ownerBananaInpaintImageReferences })
  };
  return {
    application,
    serverOptions,
    createChatClient,
    createReadClient,
    authStore: store,
    linkService,
    catalog,
    authBinding,
    catalogVersion,
    ...(ownerSeedreamEditorImageReferences === undefined ? {} : {
      ownerSeedreamEditorImageReferencesLifecycle: ownerSeedreamEditorImageReferences.lifecycle
    }),
    ...(ownerWanT2vVideos === undefined ? {} : { ownerWanT2vVideosLifecycle: ownerWanT2vVideos.lifecycle }),
    ...(ownerWan30FirstLastVideos === undefined ? {} : {
      ownerWan30FirstLastVideosLifecycle: ownerWan30FirstLastVideos.lifecycle
    }),
    ...(ownerWan30ReferenceVideos === undefined ? {} : {
      ownerWan30ReferenceVideosLifecycle: ownerWan30ReferenceVideos.lifecycle
    }),
    ...(ownerWan30OmniVideos === undefined ? {} : {
      ownerWan30OmniVideosLifecycle: ownerWan30OmniVideos.lifecycle
    }),
    ...(ownerWan30EditVideos === undefined ? {} : {
      ownerWan30EditVideosLifecycle: ownerWan30EditVideos.lifecycle
    }),
    ...(ownerElevenLabsTts === undefined ? {} : { ownerElevenLabsTtsLifecycle: ownerElevenLabsTts.lifecycle }),
    ...(ownerElevenLabsDialogue === undefined ? {} : { ownerElevenLabsDialogueLifecycle: ownerElevenLabsDialogue.lifecycle }),
    ...(ownerElevenLabsSts === undefined ? {} : { ownerElevenLabsStsLifecycle: ownerElevenLabsSts.lifecycle }),
    ...(ownerSunoGeneration === undefined ? {} : { ownerSunoGenerationLifecycle: ownerSunoGeneration.lifecycle }),
    ...(ownerTopazAstra === undefined ? {} : { ownerTopazAstraLifecycle: ownerTopazAstra.lifecycle }),
    ...(ownerTopazEnhance === undefined ? {} : { ownerTopazEnhanceLifecycle: ownerTopazEnhance.lifecycle }),
    ...(ownerFlux3Videos === undefined ? {} : { ownerFlux3VideosLifecycle: ownerFlux3Videos.lifecycle }),
    ...(ownerGrokV2v === undefined ? {} : { ownerGrokV2vLifecycle: ownerGrokV2v.lifecycle }),
    ...(ownerLumaT2v === undefined ? {} : { ownerLumaT2vLifecycle: ownerLumaT2v.lifecycle }),
    ...(ownerHailuo01T2v === undefined ? {} : { ownerHailuo01T2vLifecycle: ownerHailuo01T2v.lifecycle }),
    ...(ownerHailuo01DirectorT2v === undefined ? {} : { ownerHailuo01DirectorT2vLifecycle: ownerHailuo01DirectorT2v.lifecycle }),
    ...(ownerHailuo23T2v === undefined ? {} : { ownerHailuo23T2vLifecycle: ownerHailuo23T2v.lifecycle }),
    ...(ownerHailuo02T2v === undefined ? {} : { ownerHailuo02T2vLifecycle: ownerHailuo02T2v.lifecycle }),
    ...(ownerSeedance20T2v === undefined ? {} : { ownerSeedance20T2vLifecycle: ownerSeedance20T2v.lifecycle }),
    ...(ownerKlingT2v === undefined ? {} : { ownerKlingT2vLifecycle: ownerKlingT2v.lifecycle }),
    ...(ownerKlingI2v === undefined ? {} : { ownerKlingI2vLifecycle: ownerKlingI2v.lifecycle }),
    ...(ownerKlingKeyframes === undefined ? {} : { ownerKlingKeyframesLifecycle: ownerKlingKeyframes.lifecycle }),
    ...(ownerKlingMotionControl === undefined ? {} : { ownerKlingMotionControlLifecycle: ownerKlingMotionControl.lifecycle }),
    ...(ownerHailuo02I2v === undefined ? {} : { ownerHailuo02I2vLifecycle: ownerHailuo02I2v.lifecycle }),
    ...(ownerVeoT2v === undefined ? {} : { ownerVeoT2vLifecycle: ownerVeoT2v.lifecycle }),
    ...(ownerVeoOmniT2v === undefined ? {} : { ownerVeoOmniT2vLifecycle: ownerVeoOmniT2v.lifecycle }),
    ...(ownerVeoOmniReferences === undefined ? {} : { ownerVeoOmniReferencesLifecycle: ownerVeoOmniReferences.lifecycle }),
    ...(ownerGrokT2v === undefined ? {} : { ownerGrokT2vLifecycle: ownerGrokT2v.lifecycle }),
    ...(ownerHailuoLiveT2v === undefined ? {} : { ownerHailuoLiveT2vLifecycle: ownerHailuoLiveT2v.lifecycle }),
    ...(ownerVideo2Audio === undefined ? {} : { ownerVideo2AudioLifecycle: ownerVideo2Audio.lifecycle }),
    ...(ownerWan27R2v === undefined ? {} : { ownerWan27R2vLifecycle: ownerWan27R2v.lifecycle }),
    ...(ownerWan26I2v === undefined ? {} : { ownerWan26I2vLifecycle: ownerWan26I2v.lifecycle }),
    ...(ownerWan26R2v === undefined ? {} : { ownerWan26R2vLifecycle: ownerWan26R2v.lifecycle }),
    ...(ownerWan25I2vPreview === undefined ? {} : { ownerWan25I2vPreviewLifecycle: ownerWan25I2vPreview.lifecycle })
  };
}

function createOwnerGrokImageReferenceService(input: {
  profileSet: OwnerGrokImageReferenceProfileSet | undefined;
  catalog: ReturnType<typeof loadSelectedDiscoveryCatalog>["discoveryCatalog"];
  catalogVersion: string;
  binding: AuthBinding;
  linkService: PerUserLinkService;
  createChatClient: (attemptId: string) => SyntxChatHttpClient;
  createReadClient: (attemptId: string) => SyntxHttpClient;
  now: () => number;
}): OwnerGrokImageReferenceService {
  const { profileSet } = input;
  if (profileSet === undefined) throw new Error("OWNER_GROK_REFERENCE_PROFILE_SET_REQUIRED");
  // Profile access verifies the private WeakMap brand and exact profile policy.
  for (const profileId of profileSet.profile_ids) {
    const profile = getOwnerGrokImageReferenceProfile(profileSet, profileId);
    const model = input.catalog.getModel(profile.model_id);
    if (!model.active || model.id !== profile.model_id || model.ai_name !== profile.ai_name ||
        model.upstream_id !== profile.model_type || profile.catalog_version !== profileSet.catalog_version ||
        profile.catalog_version !== input.catalogVersion) {
      throw new Error("OWNER_GROK_REFERENCE_MODEL_BINDING_MISMATCH");
    }
  }
  return new OwnerGrokImageReferenceService({
    profile_set: profileSet,
    binding: input.binding,
    linkService: input.linkService,
    createChatClient: input.createChatClient,
    preflight: {
      verifyFreshSubscription: async (attemptId, principal, modelId, signal) => {
        await assertGrokPrincipal(input.binding, attemptId, principal, input.linkService);
        assertGrokModel(input.catalog, profileSet, modelId);
        const subscription = await input.createReadClient(attemptId).getSubscription(signal);
        if (subscription.active !== true || typeof subscription.plan_type !== "string" ||
            subscription.plan_type.trim().length === 0 ||
            subscription.plan_type.trim().toLocaleUpperCase("en-US") === "FREE") {
          throw new Error("OWNER_GROK_REFERENCE_SUBSCRIPTION_REQUIRED");
        }
      },
      verifyModelAccess: async (attemptId, principal, modelId, signal) => {
        await assertGrokPrincipal(input.binding, attemptId, principal, input.linkService);
        assertGrokModel(input.catalog, profileSet, modelId);
        const model = input.catalog.getModel(modelId);
        // This is only the fixed read-only availability query. It is not the
        // requested generation batch or a cost authorization; authorizeCost
        // below always performs a separate fresh read from the candidate.
        const costParameters = ownerImageReferenceCostParameters(
          model.settings?.get_cost_params,
          { batch_size: 1 }
        );
        if (costParameters.batch_size !== 1 || Object.keys(costParameters).length !== 1) {
          throw new Error("OWNER_GROK_REFERENCE_AVAILABILITY_QUERY_UNAVAILABLE");
        }
        await assertGrokModelAccess({ ...input, attemptId, modelId, signal, costParameters });
      },
      authorizeCost: async (attemptId, principal, candidate, signal) => {
        const profileId = (candidate as OwnerGrokImageReferencePreparedCandidate).profile_id;
        const binding = getOwnerGrokImageReferenceCandidateBinding(
          candidate, profileSet, profileId, principal, attemptId
        );
        if (!binding || binding.model_id !== candidate.model_id || binding.model_type !== candidate.model_type ||
            binding.profile_set_sha256 !== profileSet.profile_set_sha256 || binding.profile_schema_hash !== candidate.profile_schema_hash ||
            binding.variant_id !== candidate.variant_id || binding.catalog_version !== candidate.catalog_version ||
            candidate.catalog_version !== DEFAULT_DISCOVERY_PUBLIC_CATALOG_VERSION) {
          throw new Error("OWNER_GROK_REFERENCE_CANDIDATE_BINDING_MISMATCH");
        }
        const profile = getOwnerGrokImageReferenceProfile(profileSet, profileId as OwnerGrokImageReferenceProfileId);
        if (profile.model_id !== candidate.model_id || profile.model_type !== candidate.model_type ||
            profile.schema_hash !== candidate.profile_schema_hash || profile.variant_id !== candidate.variant_id ||
            profile.catalog_version !== candidate.profile_catalog_version || profile.catalog_version !== profileSet.catalog_version ||
            profile.catalog_version !== input.catalogVersion ||
            candidate.operation_id !== "generate-image" || candidate.modality !== "image") {
          throw new Error("OWNER_GROK_REFERENCE_CANDIDATE_BINDING_MISMATCH");
        }
        const model = input.catalog.getModel(profile.model_id);
        const costSettings = Object.freeze({ ...candidate.request.settings, model_type: profile.model_type });
        const costParameters = ownerImageReferenceCostParameters(
          model.settings?.get_cost_params,
          costSettings
        );
        await assertGrokPrincipal(input.binding, attemptId, principal, input.linkService);
        await assertGrokModelAccess({ ...input, attemptId, modelId: profile.model_id, signal, costParameters });
      }
    },
    now: input.now
  });
}

function assertGrokModel(
  catalog: ReturnType<typeof loadSelectedDiscoveryCatalog>["discoveryCatalog"],
  profileSet: OwnerGrokImageReferenceProfileSet,
  modelId: string
): void {
  for (const profileId of profileSet.profile_ids) {
    const profile = getOwnerGrokImageReferenceProfile(profileSet, profileId);
    if (profile.model_id !== modelId) continue;
    const model = catalog.getModel(modelId);
    if (!model.active || model.ai_name !== profile.ai_name || model.upstream_id !== profile.model_type) {
      throw new Error("OWNER_GROK_REFERENCE_MODEL_BINDING_MISMATCH");
    }
    return;
  }
  throw new Error("OWNER_GROK_REFERENCE_MODEL_BINDING_MISMATCH");
}

async function assertGrokPrincipal(
  binding: AuthBinding,
  attemptId: string,
  principal: GenerationPrincipalRef,
  linkService: Pick<PerUserLinkService, "getStatus">
): Promise<void> {
  if (principal.tenant_id !== binding.tenant_id || principal.subject_id !== binding.subject ||
      principal.connection_id !== attemptId) throw new Error("OWNER_GROK_REFERENCE_PRINCIPAL_MISMATCH");
  const current = await resolveOwnerReferencePrincipal({ binding, attemptId, linkService });
  if (!sameGenerationPrincipal(current, principal)) throw new Error("OWNER_GROK_REFERENCE_PRINCIPAL_MISMATCH");
}

async function assertGrokModelAccess(input: {
  catalog: ReturnType<typeof loadSelectedDiscoveryCatalog>["discoveryCatalog"];
  catalogVersion: string;
  createReadClient: (attemptId: string) => SyntxHttpClient;
  now: () => number;
  attemptId: string;
  modelId: string;
  signal: AbortSignal;
  costParameters: Readonly<Record<string, SyntxCostParameter>>;
}): Promise<void> {
  const model = input.catalog.getModel(input.modelId);
  if (!model.active) throw new Error("OWNER_GROK_REFERENCE_MODEL_BINDING_MISMATCH");
  const result = await new ModelAccessService(input.catalog, input.createReadClient(input.attemptId), input.now)
    .getModelAccess({ model_id: input.modelId, cost_parameters: input.costParameters }, input.signal);
  assertOwnerImageReferenceModelAccess(result, {
    model_id: input.modelId,
    ai_name: model.ai_name,
    model_type: model.upstream_id,
    catalog_kind: input.catalog.catalog_kind,
    catalog_version: input.catalogVersion,
    parameter_keys: Object.keys(input.costParameters).sort()
  });
}

/** Select only bounded scalar model-info keys allowed by the selected public model. */
export function ownerImageReferenceCostParameters(
  allowedKeys: readonly string[] | undefined,
  settings: Readonly<Record<string, unknown>>
): Readonly<Record<string, SyntxCostParameter>> {
  const allowed = new Set((allowedKeys ?? []).filter(isSyntxModelInfoCallerParameterKey));
  const result: Record<string, SyntxCostParameter> = Object.create(null) as Record<string, SyntxCostParameter>;
  for (const [key, value] of Object.entries(settings)) {
    if (!allowed.has(key)) continue;
    if (typeof value === "string" && value.length <= 500) result[key] = value;
    else if (typeof value === "boolean") result[key] = value;
    else if (typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1_000_000_000) result[key] = value;
  }
  return Object.freeze(result);
}

export function assertOwnerImageReferenceModelAccess(
  result: Awaited<ReturnType<ModelAccessService["getModelAccess"]>>,
  expected: {
    model_id: string;
    ai_name: string;
    model_type: string;
    catalog_kind: string;
    catalog_version: string;
    parameter_keys: readonly string[];
  }
): void {
  if (result.account_read_live !== true || result.access !== true || result.parameters_redacted !== true ||
      result.model_id !== expected.model_id || result.ai_name !== expected.ai_name ||
      result.model_type !== expected.model_type || result.catalog_kind !== expected.catalog_kind ||
      result.catalog_version !== expected.catalog_version ||
      JSON.stringify(result.parameter_keys) !== JSON.stringify(expected.parameter_keys) ||
      typeof result.cost !== "number" || !Number.isFinite(result.cost) || result.cost < 0 ||
      (result.discount_cost !== null &&
        (typeof result.discount_cost !== "number" || !Number.isFinite(result.discount_cost) || result.discount_cost < 0))) {
    throw new Error("OWNER_REFERENCE_MODEL_ACCESS_UNAVAILABLE");
  }
}

function selectOwnerContractMediaRegistry(
  registry: GenerationContractRegistry | GenerationContractRegistryV2 | null | undefined
): GenerationContractRegistry | GenerationContractRegistryV2 {
  if (registry == null) throw new Error("OWNER_CONTRACT_MEDIA_REGISTRY_REQUIRED");
  return registry.schema_version === "2.0.0"
    ? generationContractRegistryV2Schema.parse(registry)
    : generationContractRegistrySchema.parse(registry);
}
