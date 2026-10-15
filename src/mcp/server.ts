import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type {
  CallToolResult,
  ToolAnnotations
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod/v4";
import type { ApplicationCore } from "../application/core.js";
import type { MaplessSettingsInventory } from "../catalog/mapless-settings-inventory.js";
import { loadMaplessSettingsInventoryVersion } from "../catalog/mapless-settings-inventory.js";
import type { StaticGenerationParameterSchemaCatalog } from "../catalog/static-generation-parameter-schema.js";
import {
  loadPinnedStaticParameterProjection,
  type LoadedStaticParameterProjection
} from "../catalog/static-form-control-history.js";
import type { GenerationContractRegistry } from "../domain/generation-contract.js";
import type { GenerationContractRegistryV2 } from "../domain/generation-contract-v2.js";
import {
  JOB_STATUSES,
  MODALITIES
} from "../domain/types.js";
import type { GenerationResult } from "../domain/types.js";
import { ApplicationError } from "../errors.js";
import type { ApplicationErrorCode } from "../errors.js";
import {
  registerSyntxAuthTools,
  type RegisterSyntxAuthToolsOptions
} from "./auth-tools.js";
import {
  registerSyntxModelAccessTool,
  type RegisterSyntxModelAccessToolOptions
} from "./model-access-tool.js";
import {
  registerSyntxAccountStatusTool,
  type RegisterSyntxAccountStatusToolOptions
} from "./account-status-tool.js";
import {
  registerSyntxOwnerGenerateImageTool,
  registerSyntxOwnerReconcileImageTool,
  type RegisterSyntxOwnerGenerateImageToolOptions
} from "./owner-generate-image-tool.js";
import { OwnerImageRecoveryStore } from "../application/owner-image-recovery.js";
import {
  registerSyntxVideoEvidenceTool,
  type RegisterSyntxVideoEvidenceToolOptions
} from "./video-evidence-tool.js";
import {
  registerSyntxOwnerGenerateVideoTool,
  registerSyntxOwnerReconcileVideoTool,
  type RegisterSyntxOwnerGenerateVideoToolOptions
} from "./owner-generate-video-tool.js";
import { OwnerVideoRecoveryStore } from "../application/owner-video-recovery.js";
import { registerSyntxRuntimeCoverageTool } from "./runtime-coverage-tool.js";
import { registerSyntxSettingsEvidenceTool } from "./settings-evidence-tool.js";
import { registerSyntxMaintenanceTools } from "./maintenance-tools.js";
import { registerSyntxMaintenanceSkillResources } from "./maintenance-skill-resources.js";
import {
  registerSyntxListUploadedFilesTool,
  type RegisterSyntxListUploadedFilesToolOptions
} from "./uploaded-files-tool.js";
import { registerSyntxUploadFileTool, type RegisterSyntxUploadFileToolOptions } from "./upload-file-tool.js";
import {
  registerSyntxReconcileUploadedFileTool,
  type RegisterSyntxReconcileUploadedFileToolOptions
} from "./reconcile-uploaded-file-tool.js";
import {
  DEFAULT_MAPLESS_SETTINGS_INVENTORY_VERSION,
  registerSyntxGenerationContractTools
} from "./generation-contract-tools.js";
import {
  registerSyntxOwnerContractMediaTools,
  type RegisterSyntxOwnerContractMediaToolsOptions
} from "./owner-contract-media-tool.js";
import { registerSyntxOwnerDurableGenerationTools } from "./owner-durable-live-generation-tools.js";
import type { OwnerDurableLiveGenerationServicePort } from "../application/owner-durable-live-generation-service.js";
import { registerSyntxOwnerImageReferenceTools } from "./owner-image-reference-tools.js";
import type { OwnerImageReferenceServicePort } from "../application/owner-image-reference-service.js";
import type { OwnerGrokImageReferenceService } from "../application/owner-grok-image-reference-service.js";
import {
  registerSyntxOwnerGrokImageReferenceTools
} from "./owner-grok-image-reference-tools.js";
import { registerSyntxOwnerSoulCatalogShapeTools } from "./owner-soul-catalog-shape-tools.js";
import type { OwnerSoulCatalogShapeService } from "../application/owner-soul-catalog-shape-service.js";
import type { OwnerSoulStyleOptionsServicePort } from "../application/owner-soul-style-options-service.js";
import { registerSyntxOwnerSoulStyleOptionsTool } from "./owner-soul-style-options-tool.js";
import {
  registerSyntxOwnerClarityUpscaleTools,
  type RegisterSyntxOwnerClarityUpscaleToolsOptions
} from "./owner-clarity-upscale-tools.js";
import type { OwnerClarityUpscaleGenerationService } from "../application/owner-clarity-upscale-generation-service.js";
import type { OwnerClarityUpscaleUploadService } from "../application/owner-clarity-upscale-upload-service.js";
import {
  registerSyntxOwnerMagnificUpscaleTools,
  type RegisterSyntxOwnerMagnificUpscaleToolsOptions
} from "./owner-magnific-upscale-tools.js";
import type { OwnerMagnificUpscaleGenerationService } from "../application/owner-magnific-upscale-generation-service.js";
import type { OwnerMagnificUpscaleUploadService } from "../application/owner-magnific-upscale-upload-service.js";
import {
  registerSyntxOwnerKontextImageTools,
  type RegisterSyntxOwnerKontextImageToolsOptions
} from "./owner-kontext-image-tools.js";
import type { OwnerKontextImageGenerationService } from "../application/owner-kontext-image-generation-service.js";
import type { OwnerKontextImageUploadService } from "../application/owner-kontext-image-upload-service.js";
import {
  registerSyntxOwnerWanImageTools,
  type RegisterSyntxOwnerWanImageToolsOptions
} from "./owner-wan-image-tools.js";
import type { OwnerWanImageGenerationService } from "../application/owner-wan-image-generation-service.js";
import type { OwnerWanImageUploadService } from "../application/owner-wan-image-upload-service.js";
import {
  registerSyntxOwnerStandardImageTools,
  type RegisterSyntxOwnerStandardImageToolsOptions
} from "./owner-standard-image-tools.js";
import type { OwnerStandardImageGenerationService } from "../application/owner-standard-image-generation-service.js";
import type { OwnerStandardImageUploadService } from "../application/owner-standard-image-upload-service.js";
import {
  registerSyntxOwnerRunwayImageTools,
  type RegisterSyntxOwnerRunwayImageToolsOptions
} from "./owner-runway-image-tools.js";
import type { OwnerRunwayImageGenerationService } from "../application/owner-runway-image-generation-service.js";
import type { OwnerRunwayImageUploadService } from "../application/owner-runway-image-upload-service.js";
import type { OwnerSeedreamImageGenerationService } from "../application/owner-seedream-image-generation-service.js";
import type { OwnerSeedreamImageUploadService } from "../application/owner-seedream-image-upload-service.js";
import { registerSyntxOwnerSeedreamImageTools, type RegisterSyntxOwnerSeedreamImageToolsOptions } from "./owner-seedream-image-tools.js";
import type { OwnerFluxImageUploadService } from "../application/owner-flux-image-upload-service.js";
import type { OwnerFluxImageAssetService } from "../application/owner-flux-image-asset-service.js";
import type { OwnerFluxImageGenerationService } from "../application/owner-flux-image-generation-service.js";
import { registerSyntxOwnerFluxImageTools, type RegisterSyntxOwnerFluxImageToolsOptions } from "./owner-flux-image-tools.js";
import type { OwnerIdeogramImageUploadService } from "../application/owner-ideogram-image-upload-service.js";
import type { OwnerIdeogramImageMaskUploadService } from "../application/owner-ideogram-image-mask-upload-service.js";
import type { OwnerIdeogramImageGenerationService } from "../application/owner-ideogram-image-generation-service.js";
import { registerSyntxOwnerIdeogramImageTools, type RegisterSyntxOwnerIdeogramImageToolsOptions } from "./owner-ideogram-image-tools.js";
import type { OwnerGrokT2iImageUploadService } from "../application/owner-grok-t2i-image-upload-service.js";
import type { OwnerGrokT2iGenerationService } from "../application/owner-grok-t2i-generation-service.js";
import { registerSyntxOwnerGrokT2iImageTools, type RegisterSyntxOwnerGrokT2iImageToolsOptions } from "./owner-grok-t2i-image-tools.js";
import type { OwnerUniImageUploadService } from "../application/owner-uni-image-upload-service.js";
import type { OwnerUniImageGenerationService } from "../application/owner-uni-image-generation-service.js";
import { registerSyntxOwnerUniImageTools, type RegisterSyntxOwnerUniImageToolsOptions } from "./owner-uni-image-tools.js";
import type { OwnerBananaInpaintOriginalReferenceService } from "../application/owner-banana-inpaint-original-reference-service.js";
import type { OwnerBananaInpaintPaintedCompositeReferenceService } from "../application/owner-banana-inpaint-painted-composite-reference-service.js";
import type { OwnerBananaInpaintAuxiliaryReferenceService } from "../application/owner-banana-inpaint-auxiliary-reference-service.js";
import type { OwnerBananaInpaintImageGenerationService } from "../application/owner-banana-inpaint-image-generation-service.js";
import {
  registerSyntxOwnerBananaInpaintImageTools,
  type RegisterSyntxOwnerBananaInpaintImageToolsOptions
} from "./owner-banana-inpaint-image-tools.js";
import type { OwnerSeedreamEditorOriginalReferenceService } from "../application/owner-seedream-editor-original-reference-service.js";
import type { OwnerSeedreamEditorDrawingReferenceService } from "../application/owner-seedream-editor-drawing-reference-service.js";
import type { OwnerSeedreamEditorImageGenerationService } from "../application/owner-seedream-editor-image-generation-service.js";
import {
  registerSyntxOwnerSeedreamEditorImageTools,
  type RegisterSyntxOwnerSeedreamEditorImageToolsOptions
} from "./owner-seedream-editor-image-tools.js";
import type { OwnerSoulCharacterOptionsService } from "../application/owner-soul-character-options-service.js";
import type { OwnerSoulImageGenerationService } from "../application/owner-soul-image-generation-service.js";
import { registerSyntxOwnerSoulImageTools, type RegisterSyntxOwnerSoulImageToolsOptions } from "./owner-soul-image-tools.js";
import type { OwnerWanT2iGenerationService } from "../application/owner-wan-t2i-generation-service.js";
import { registerSyntxOwnerWanT2iTools, type RegisterSyntxOwnerWanT2iToolsOptions } from "./owner-wan-t2i-tools.js";
import type { OwnerWanT2vGenerationService } from "../application/owner-wan-t2v-generation-service.js";
import { registerSyntxOwnerWanT2vVideoTools, type RegisterSyntxOwnerWanT2vVideoToolsOptions } from "./owner-wan-t2v-video-tools.js";
import type { OwnerElevenLabsTtsGenerationService } from "../application/owner-elevenlabs-tts-generation-service.js";
import type { OwnerElevenLabsDialogueGenerationService } from "../application/owner-elevenlabs-dialogue-generation-service.js";
import { registerSyntxOwnerElevenLabsDialogueTools } from "./owner-elevenlabs-dialogue-tools.js";
import { registerSyntxOwnerElevenLabsVoiceTools } from "./owner-elevenlabs-voice-tools.js";
import type { OwnerElevenLabsVoiceReferenceService } from "../application/owner-elevenlabs-voice-reference-service.js";
import type { OwnerElevenLabsStsGenerationService } from "../application/owner-elevenlabs-sts-generation-service.js";
import type { OwnerElevenLabsStsOriginalReferenceService } from "../application/owner-elevenlabs-sts-original-reference-service.js";
import type { OwnerElevenLabsStsExistingMediaService } from "../application/owner-elevenlabs-sts-existing-media-service.js";
import {
  registerSyntxOwnerElevenLabsTtsTools,
  type RegisterSyntxOwnerElevenLabsTtsToolsOptions
} from "./owner-elevenlabs-tts-tools.js";
import { registerSyntxOwnerElevenLabsStsTools } from "./owner-elevenlabs-sts-tools.js";
import { registerSyntxOwnerElevenLabsStsExistingMediaTools } from "./owner-elevenlabs-sts-existing-media-tools.js";
import { registerSyntxOwnerTopazAstraTools, type OwnerTopazAstraServiceComposition } from "./owner-topaz-astra-tools.js";
import type { OwnerTopazAstraExistingMediaService } from "../application/owner-topaz-astra-existing-media-service.js";
import { registerSyntxOwnerTopazAstraExistingMediaTools } from "./owner-topaz-astra-existing-media-tools.js";
import { registerSyntxOwnerHailuo02I2vTools, type OwnerHailuo02I2vServiceComposition } from "./owner-hailuo02-i2v-tools.js";
import type { OwnerSunoGenerationService } from "../application/owner-suno-generation-service.js";
import {
  registerSyntxOwnerSunoGenerationTools,
  type RegisterSyntxOwnerSunoGenerationToolsOptions
} from "./owner-suno-generation-tools.js";
import { registerSyntxOwnerSunoTrackTools } from "./owner-suno-track-tools.js";
import { registerSyntxOwnerSunoTrackOperationTools } from "./owner-suno-track-operation-tools.js";
import { registerSyntxOwnerSunoExistingTrackTools } from "./owner-suno-existing-track-tools.js";
import type { OwnerLumaT2vContractService } from "../application/owner-luma-t2v-contract-service.js";
import { registerSyntxOwnerLumaT2vTools } from "./owner-luma-t2v-tool.js";
import type { OwnerReviewedNoReferenceT2vService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerHailuo01T2vTools } from "./owner-hailuo01-t2v-tool.js";
import type { OwnerHailuo01DirectorT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerHailuo01DirectorT2vTools } from "./owner-hailuo01-director-t2v-tool.js";
import type { OwnerHailuo23T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerHailuo23T2vTools } from "./owner-hailuo23-t2v-tool.js";
import type { OwnerHailuo02T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerHailuo02T2vTools } from "./owner-hailuo02-t2v-tools.js";
import type { OwnerSeedance20T2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerSeedance20T2vTools } from "./owner-seedance20-t2v-tools.js";
import type { OwnerKlingT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerKlingT2vTools } from "./owner-kling-t2v-tools.js";
import type { OwnerKlingI2VImageReferenceService } from "../application/owner-kling-i2v-reference-service.js";
import type { OwnerKlingI2vGenerationService } from "../application/owner-kling-i2v-generation-service.js";
import type { OwnerKlingKeyframesReferenceService } from "../application/owner-kling-keyframes-reference-service.js";
import { registerSyntxOwnerKlingKeyframesTools } from "./owner-kling-keyframes-tools.js";
import { registerSyntxOwnerKlingKeyframesGenerationTools } from "./owner-kling-keyframes-generation-tools.js";
import type { OwnerKlingKeyframesGenerationService } from "../application/owner-kling-keyframes-generation-service.js";
import {
  registerSyntxOwnerKlingI2vTools,
  type RegisterSyntxOwnerKlingI2vToolsOptions
} from "./owner-kling-i2v-tools.js";
import type { OwnerVeoT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerVeoT2vTools } from "./owner-veo-t2v-tools.js";
import type { OwnerGrokT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerGrokT2vTools } from "./owner-grok-t2v-tools.js";
import type { OwnerHailuoLiveT2vGenerationService } from "../application/owner-reviewed-no-reference-t2v-service.js";
import { registerSyntxOwnerHailuoLiveT2vTools } from "./owner-hailuo-live-t2v-tools.js";
import type { OwnerReviewedVideoRecoveryDiagnostic } from "../application/owner-reviewed-video-recovery-diagnostic.js";
import {
  registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools,
  type OwnerReviewedVideoRecoveryDiagnosticModelId
} from "./owner-reviewed-video-recovery-diagnostic-tools.js";
import type { OwnerVideo2AudioSourceProfile } from "../application/owner-video2audio-source-profile.js";
import type { OwnerVideo2AudioOriginalReferenceService } from "../application/owner-video2audio-original-reference-service.js";
import type { OwnerVideo2AudioGenerationService } from "../application/owner-video2audio-generation-service.js";
import { registerSyntxOwnerVideo2AudioTools } from "./owner-video2audio-tools.js";
import {
  registerSyntxOwnerWan27R2vReferenceTools,
  type OwnerWan27R2vReferenceToolComposition
} from "./owner-wan27-r2v-reference-tools.js";
import { registerSyntxOwnerWan27R2vGenerationTools } from "./owner-wan27-r2v-generation-tools.js";
import type { OwnerWan27R2vGenerationToolComposition } from "./owner-wan27-r2v-generation-tools.js";

export const SERVER_NAME = "syntx-mcp";
export const SERVER_VERSION = "0.2.0";

export const TOOL_NAMES = [
  "syntx_get_runtime_coverage",
  "syntx_get_settings_evidence",
  "syntx_list_update_versions",
  "syntx_plan_mcp_update",
  "syntx_get_generation_schema",
  "syntx_validate_generation",
  "syntx_search_models",
  "syntx_get_model",
  "syntx_get_balance",
  "syntx_estimate_generation",
  "syntx_start_generation",
  "syntx_get_job",
  "syntx_cancel_job",
  "syntx_get_result"
] as const;

/** The MCP-facing service pair plus lifecycle methods retained by owner stdio. */
export interface OwnerClarityUpscaleServiceComposition extends RegisterSyntxOwnerClarityUpscaleToolsOptions {
  readonly uploadService: Pick<OwnerClarityUpscaleUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerClarityUpscaleGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Magnific tools with explicit lifecycle ownership. */
export interface OwnerMagnificUpscaleServiceComposition extends RegisterSyntxOwnerMagnificUpscaleToolsOptions {
  readonly uploadService: Pick<OwnerMagnificUpscaleUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerMagnificUpscaleGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Kontext tools with one generation-owned upload lifecycle. */
export interface OwnerKontextImageServiceComposition extends RegisterSyntxOwnerKontextImageToolsOptions {
  readonly uploadService: Pick<OwnerKontextImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerKontextImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local WAN image tools with one generation-owned upload lifecycle. */
export interface OwnerWanImageServiceComposition extends RegisterSyntxOwnerWanImageToolsOptions {
  readonly uploadService: Pick<OwnerWanImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerWanImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Banana/GPT Image tools with one generation-owned upload lifecycle. */
export interface OwnerStandardImageServiceComposition extends RegisterSyntxOwnerStandardImageToolsOptions {
  readonly uploadService: Pick<OwnerStandardImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerStandardImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Runway Frames tools with one generation-owned upload lifecycle. */
export interface OwnerRunwayImageServiceComposition extends RegisterSyntxOwnerRunwayImageToolsOptions {
  readonly uploadService: Pick<OwnerRunwayImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerRunwayImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Seedream image tools with one generation-owned upload lifecycle. */
export interface OwnerSeedreamImageServiceComposition extends RegisterSyntxOwnerSeedreamImageToolsOptions {
  readonly uploadService: Pick<OwnerSeedreamImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerSeedreamImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Editor upload and generation group; omitted by default and from HTTP servers. */
export interface OwnerSeedreamEditorImageServiceComposition extends RegisterSyntxOwnerSeedreamEditorImageToolsOptions {
  readonly originalReferenceService: Pick<OwnerSeedreamEditorOriginalReferenceService, "upload" | "invalidateAttempt" | "close">;
  readonly drawingReferenceService: Pick<OwnerSeedreamEditorDrawingReferenceService, "uploadDrawing" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerSeedreamEditorImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Flux image tools; generation owns the asset-service/uploader close chain. */
export interface OwnerFluxImageServiceComposition extends RegisterSyntxOwnerFluxImageToolsOptions {
  readonly uploadService: Pick<OwnerFluxImageUploadService, "upload">;
  readonly assetService: Pick<OwnerFluxImageAssetService, "registerPublicLora">;
  readonly generationService: Pick<OwnerFluxImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Optional owner-local Ideogram tools; generation owns the attempt-scoped upload lifecycle. */
export interface OwnerIdeogramImageServiceComposition extends RegisterSyntxOwnerIdeogramImageToolsOptions {
  readonly uploadService: Pick<OwnerIdeogramImageUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly maskUploadService?: Pick<OwnerIdeogramImageMaskUploadService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerIdeogramImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Explicit owner-local full-four Grok T2I tools; the generation service owns uploader and preparer cleanup. */
export interface OwnerGrokT2iImageServiceComposition extends RegisterSyntxOwnerGrokT2iImageToolsOptions {
  readonly generationService: Pick<OwnerGrokT2iGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
  readonly uploadService: Pick<OwnerGrokT2iImageUploadService, "upload">;
}

/** Explicit owner-local Uni image tools; generation owns uploader and preparer cleanup. */
export interface OwnerUniImageServiceComposition extends RegisterSyntxOwnerUniImageToolsOptions {
  readonly generationService: Pick<OwnerUniImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
  readonly uploadService: Pick<OwnerUniImageUploadService, "upload">;
}

/** Explicit owner-local Inpaint tools; generation owns all three source-bound upload-service lifecycles. */
export interface OwnerBananaInpaintImageServiceComposition extends RegisterSyntxOwnerBananaInpaintImageToolsOptions {
  readonly generationService: Pick<OwnerBananaInpaintImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
  readonly originalReferenceService: Pick<OwnerBananaInpaintOriginalReferenceService, "upload">;
  readonly paintedCompositeReferenceService: Pick<OwnerBananaInpaintPaintedCompositeReferenceService, "uploadPaintedComposite">;
  readonly auxiliaryReferenceService: Pick<OwnerBananaInpaintAuxiliaryReferenceService, "upload">;
}

/** Explicit owner-local Soul image tools; generation owns its preparer and both selector-service lifecycles. */
export interface OwnerSoulImageServiceComposition extends RegisterSyntxOwnerSoulImageToolsOptions {
  readonly generationService: Pick<OwnerSoulImageGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
  readonly characterOptionsService: Pick<OwnerSoulCharacterOptionsService, "listOptions">;
}

/** Explicit owner-local WAN T2I generation/recovery tools; omitted from default and HTTP servers. */
export interface OwnerWanT2iImageServiceComposition extends RegisterSyntxOwnerWanT2iToolsOptions {
  readonly generationService: Pick<OwnerWanT2iGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "invalidateAttempt" | "close">;
}

/** Explicit owner-local WAN T2V generation/result tools; omitted from default and HTTP servers. */
export interface OwnerWanT2vVideoServiceComposition extends RegisterSyntxOwnerWanT2vVideoToolsOptions {
  readonly generationService: Pick<OwnerWanT2vGenerationService,
    "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
}

/** Explicit owner-local ElevenLabs TTS and voice-reference tools; omitted from default and HTTP servers. */
export interface OwnerElevenLabsTtsServiceComposition extends RegisterSyntxOwnerElevenLabsTtsToolsOptions {
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly generationService: OwnerElevenLabsTtsGenerationService;
}

/** Dialogue and TTS share owner-bound voice references; no duplicate voice-list tool. */
export interface OwnerElevenLabsDialogueServiceComposition {
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly generationService: OwnerElevenLabsDialogueGenerationService;
}

/** Explicit owner-local ElevenLabs STS original, generation, and recovery tools; omitted from default and HTTP servers. */
export interface OwnerElevenLabsStsServiceComposition {
  readonly originalReferenceService: OwnerElevenLabsStsOriginalReferenceService;
  readonly voiceReferenceService: OwnerElevenLabsVoiceReferenceService;
  readonly generationService: OwnerElevenLabsStsGenerationService;
  readonly existingMediaService?: OwnerElevenLabsStsExistingMediaService;
}

/** Optional owner-local GET-only Topaz Astra history reader, alongside the existing generation/original services. */
export interface OwnerTopazAstraComposition extends OwnerTopazAstraServiceComposition {
  readonly existingMediaService?: OwnerTopazAstraExistingMediaService;
}

/** Explicit owner-local Suno generate and recovery tools; omitted from default and HTTP servers. */
export interface OwnerSunoGenerationServiceComposition extends RegisterSyntxOwnerSunoGenerationToolsOptions {
  readonly generationService: OwnerSunoGenerationService;
}

/** Optional owner-local reviewed Luma T2V contract tools; omitted from default and HTTP servers. */
export interface OwnerLumaT2vServiceComposition {
  readonly generationService: Pick<OwnerLumaT2vContractService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries">;
}

/** Optional owner-local reviewed Hailuo-01 T2V tools; omitted from default and HTTP servers. */
export interface OwnerHailuo01T2vServiceComposition {
  readonly generationService: Pick<OwnerReviewedNoReferenceT2vService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Optional owner-local reviewed Hailuo-01 Director T2V tools; omitted from default and HTTP servers. */
export interface OwnerHailuo01DirectorT2vServiceComposition {
  readonly generationService: Pick<OwnerHailuo01DirectorT2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Optional owner-local reviewed Hailuo 2.3 T2V tools; omitted from default and HTTP servers. */
export interface OwnerHailuo23T2vServiceComposition {
  readonly generationService: Pick<OwnerHailuo23T2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Source-reviewed Hailuo-02 no-reference video tools, explicitly opted in on owner stdio. */
export interface OwnerHailuo02T2vServiceComposition {
  readonly generationService: Pick<OwnerHailuo02T2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Source-reviewed Seedance 2.0 mini/no-reference video tools, explicit owner-stdio opt-in. */
export interface OwnerSeedance20T2vServiceComposition {
  readonly generationService: Pick<OwnerSeedance20T2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Source-reviewed Kling T2V and O1 family tools, explicitly opted in by owner stdio. */
export interface OwnerKlingT2vServiceComposition {
  readonly generationService: Pick<OwnerKlingT2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Explicit owner-local Kling I2V source, owned upload, generation, and recovery tools; omitted by default and HTTP hosts. */
export interface OwnerKlingI2vServiceComposition extends RegisterSyntxOwnerKlingI2vToolsOptions {
  readonly referenceService: Pick<OwnerKlingI2VImageReferenceService, "upload" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerKlingI2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "list" | "invalidateAttempt" | "close">;
}

/** Explicit owner-local Keyframes input and generation tools; omitted by default and HTTP servers. */
export interface OwnerKlingKeyframesServiceComposition {
  readonly referenceService: Pick<OwnerKlingKeyframesReferenceService, "upload" | "resolvePair" | "invalidateAttempt" | "close">;
  readonly generationService: Pick<OwnerKlingKeyframesGenerationService, "generate" | "reconcile" | "listRecoveries" | "getResultPage" | "invalidateAttempt" | "close">;
  readonly now?: () => number;
}

/** Explicit owner-local Veo T2V tools, enabled only by owner stdio opt-in. */
export interface OwnerVeoT2vServiceComposition {
  readonly generationService: Pick<OwnerVeoT2vGenerationService,
    "getParametersSource" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Explicit owner-local Grok T2V tools, enabled only by owner stdio opt-in. */
export interface OwnerGrokT2vServiceComposition {
  readonly generationService: Pick<OwnerGrokT2vGenerationService,
    "getParametersSource" | "getReviewedContract" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Explicit owner-local Hailuo-01 Live T2V tools, enabled only by owner stdio opt-in. */
export interface OwnerHailuoLiveT2vServiceComposition {
  readonly generationService: Pick<OwnerHailuoLiveT2vGenerationService,
    "getParametersSource" | "getReviewedContract" | "generate" | "reconcile" | "listRecoveries" | "getRecoveryDiagnostic">;
}

/** Explicit owner-local Video2Audio original upload and generation/recovery lifecycle. */
export interface OwnerVideo2AudioServiceComposition {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly originalReferenceService: OwnerVideo2AudioOriginalReferenceService;
  readonly generationService: OwnerVideo2AudioGenerationService;
}

export interface CreateMcpServerOptions {
  /** Optional and request-scoped; the default eight-tool server has no login surface. */
  auth?: RegisterSyntxAuthToolsOptions | undefined;
  /** Optional account-scoped read; requires a tenant-bound credential resolver. */
  modelAccess?: RegisterSyntxModelAccessToolOptions | undefined;
  /** Optional account balance/subscription read; never enables paid operations. */
  accountStatus?: RegisterSyntxAccountStatusToolOptions | undefined;
  /** Optional account-scoped read of stored file metadata; never mutates storage. */
  uploadedFiles?: RegisterSyntxListUploadedFilesToolOptions | undefined;
  /** Optional owner-only upload; stores one bounded file hidden and returns a redacted receipt. */
  uploadFile?: RegisterSyntxUploadFileToolOptions | undefined;
  /** Optional owner-only read-only reconciliation of one opaque uploaded-file id. */
  reconcileUploadedFile?: RegisterSyntxReconcileUploadedFileToolOptions | undefined;
  /** Optional real, billed generation; only ever set by an explicit owner-live composition. */
  ownerGenerateImage?: RegisterSyntxOwnerGenerateImageToolOptions | undefined;
  ownerGenerateVideo?: RegisterSyntxOwnerGenerateVideoToolOptions | undefined;
  /** Explicit owner-local generation guarded by a pinned live contract; never on default/HTTP hosts. */
  ownerContractMedia?: RegisterSyntxOwnerContractMediaToolsOptions | undefined;
  /** Explicit private-profile durable generation tools; only injected by opted-in owner stdio. */
  ownerDurableGeneration?: OwnerDurableLiveGenerationServicePort | undefined;
  /** Explicit local-owner image-reference flow; only injected by opted-in owner stdio. */
  ownerImageReferences?: OwnerImageReferenceServicePort | undefined;
  /** Explicit source-reviewed Grok reference tools; only injected by opted-in owner stdio. */
  ownerGrokImageReferences?: OwnerGrokImageReferenceService | undefined;
  /** Explicit owner-local opt-in to a read-only Soul list shape diagnostic. */
  ownerSoulCatalogShape?: Pick<OwnerSoulCatalogShapeService, "inspect" | "close" | "invalidateAttempt"> | undefined;
  /** Explicit owner-local read-only Soul style option capability. */
  ownerSoulStyleOptions?: OwnerSoulStyleOptionsServicePort | undefined;
  /** Explicit owner-local Clarity upscale tools; only injected by opted-in owner stdio. */
  ownerClarityUpscale?: OwnerClarityUpscaleServiceComposition | undefined;
  /** Explicit owner-local Magnific upscale tools; only injected by opted-in owner stdio. */
  ownerMagnificUpscale?: OwnerMagnificUpscaleServiceComposition | undefined;
  /** Explicit owner-local Kontext reference-image tools; only injected by opted-in owner stdio. */
  ownerKontextImageReferences?: OwnerKontextImageServiceComposition | undefined;
  /** Explicit owner-local WAN reference-image tools; only injected by opted-in owner stdio. */
  ownerWanImageReferences?: OwnerWanImageServiceComposition | undefined;
  /** Explicit owner-local Banana/GPT Image tools; omitted from default and HTTP servers. */
  ownerStandardImageReferences?: OwnerStandardImageServiceComposition | undefined;
  /** Explicit owner-local Runway image tools; omitted from default and HTTP servers. */
  ownerRunwayImageReferences?: OwnerRunwayImageServiceComposition | undefined;
  /** Explicit owner-local Seedream image tools; omitted from default and HTTP servers. */
  ownerSeedreamImageReferences?: OwnerSeedreamImageServiceComposition | undefined;
  /** Explicit owner-local Seedream Editor upload, generation, and recovery tools; omitted from default and HTTP servers. */
  ownerSeedreamEditorImageReferences?: OwnerSeedreamEditorImageServiceComposition | undefined;
  /** Explicit owner-local full Flux image tools; omitted from default and HTTP servers. */
  ownerFluxImageReferences?: OwnerFluxImageServiceComposition | undefined;
  /** Explicit owner-local Ideogram image tools; omitted from default and HTTP servers. */
  ownerIdeogramImageReferences?: OwnerIdeogramImageServiceComposition | undefined;
  /** Explicit owner-local full-four Grok T2I tools; omitted from default and HTTP servers. */
  ownerGrokT2iImageReferences?: OwnerGrokT2iImageServiceComposition | undefined;
  /** Explicit owner-local Uni image tools; omitted from default and HTTP servers. */
  ownerUniImageReferences?: OwnerUniImageServiceComposition | undefined;
  /** Explicit owner-local Banana Inpaint upload, generation and recovery tools; omitted by default and from HTTP servers. */
  ownerBananaInpaintImageReferences?: OwnerBananaInpaintImageServiceComposition | undefined;
  /** Explicit owner-local Soul image tools; omitted from default and HTTP servers. */
  ownerSoulImageReferences?: OwnerSoulImageServiceComposition | undefined;
  /** Explicit owner-local WAN T2I tools; omitted from default and HTTP servers. */
  ownerWanT2iImageReferences?: OwnerWanT2iImageServiceComposition | undefined;
  /** Explicit owner-local WAN T2V tools; omitted from default and HTTP servers. */
  ownerWanT2vVideos?: OwnerWanT2vVideoServiceComposition | undefined;
  /** Explicit owner-local ElevenLabs TTS and voice-reference tools; omitted from default and HTTP servers. */
  ownerElevenLabsTts?: OwnerElevenLabsTtsServiceComposition | undefined;
  ownerElevenLabsDialogue?: OwnerElevenLabsDialogueServiceComposition | undefined;
  ownerElevenLabsSts?: OwnerElevenLabsStsServiceComposition | undefined;
  /** Explicit owner-local Topaz Astra upload, generation, and recovery tools; omitted from default and HTTP servers. */
  ownerTopazAstra?: OwnerTopazAstraComposition | undefined;
  /** Explicit owner-local Suno generate and recovery tools; omitted from default and HTTP servers. */
  ownerSunoGeneration?: OwnerSunoGenerationServiceComposition | undefined;
  /** Explicit owner-local reviewed Luma T2V tools; omitted from default and HTTP servers. */
  ownerLumaT2v?: OwnerLumaT2vServiceComposition | undefined;
  /** Explicit owner-local sealed Hailuo-01 T2V tools; omitted from default and HTTP servers. */
  ownerHailuo01T2v?: OwnerHailuo01T2vServiceComposition | undefined;
  /** Explicit owner-local sealed Hailuo-01 Director T2V tools; omitted from default and HTTP servers. */
  ownerHailuo01DirectorT2v?: OwnerHailuo01DirectorT2vServiceComposition | undefined;
  /** Explicit owner-local reviewed Hailuo 2.3 T2V tools; only injected by opted-in owner stdio. */
  ownerHailuo23T2v?: OwnerHailuo23T2vServiceComposition | undefined;
  ownerHailuo02T2v?: OwnerHailuo02T2vServiceComposition | undefined;
  /** Explicit owner-local Hailuo-02 I2V image upload, generation, and recovery tools; omitted by default and HTTP servers. */
  ownerHailuo02I2v?: OwnerHailuo02I2vServiceComposition | undefined;
  ownerSeedance20T2v?: OwnerSeedance20T2vServiceComposition | undefined;
  /** Explicit owner-local Kling T2V and O1 tools; omitted from default and HTTP servers. */
  ownerKlingT2v?: OwnerKlingT2vServiceComposition | undefined;
  /** Explicit owner-local Kling I2V tools; omitted from default and HTTP servers. */
  ownerKlingI2v?: OwnerKlingI2vServiceComposition | undefined;
  /** Explicit owner-local Kling Keyframes input tools only; omitted from default and HTTP servers. */
  ownerKlingKeyframes?: OwnerKlingKeyframesServiceComposition | undefined;
  /** Explicit owner-local Veo T2V tools; omitted from default and HTTP servers. */
  ownerVeoT2v?: OwnerVeoT2vServiceComposition | undefined;
  ownerGrokT2v?: OwnerGrokT2vServiceComposition | undefined;
  ownerHailuoLiveT2v?: OwnerHailuoLiveT2vServiceComposition | undefined;
  /** Explicit owner-local Video2Audio tools; omitted from default and HTTP servers. */
  ownerVideo2Audio?: OwnerVideo2AudioServiceComposition | undefined;
  /** Explicit owner-local WAN 2.7 R2V reference uploads; omitted from default and HTTP servers. */
  ownerWan27R2v?: OwnerWan27R2vReferenceToolComposition & Partial<OwnerWan27R2vGenerationToolComposition> | undefined;
  /** Optional host-supplied, version-bound static evidence; never reads files or contacts SYNTX. */
  videoEvidence?: RegisterSyntxVideoEvidenceToolOptions | undefined;
  /** Explicitly validated, catalog-bound schema contracts; omission leaves validation unavailable. */
  generationContractRegistry?: GenerationContractRegistry | null | undefined;
  /** Explicit schema-v2 registry in its separate hash-pinned namespace. */
  generationContractRegistryV2?: GenerationContractRegistryV2 | null | undefined;
  /** Optional preloaded immutable mapless inventory; omission loads the pinned current artifact. */
  maplessSettingsInventory?: MaplessSettingsInventory | null | undefined;
  /** Version label for an injected settings inventory, not a model-callable argument. */
  maplessSettingsInventoryVersion?: string | null | undefined;
  /** Trusted, hash-pinned static UI evidence; never executable or a validation schema. */
  staticParameterProjection?: StaticGenerationParameterSchemaCatalog | null | undefined;
  /** Immutable projection artifact identity for an injected projection. */
  staticParameterProjectionVersion?: string | null | undefined;
  staticParameterProjectionSha256?: string | null | undefined;
  staticParameterProjectionSourceSchemaVersion?: "1.1.0" | "1.2.0" | null | undefined;
  staticParameterProjectionMigrationStatus?: "CURRENT" | "LEGACY_V1_1_DEFAULTED_UNKNOWN" | "SCHEMA_MIGRATION_REQUIRED" | null | undefined;
}

const modelIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/)
  .describe("Stable model id returned by syntx_search_models.");
const operationIdSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .describe("Operation id listed by syntx_get_model.");
const parametersInputSchema = z
  .record(z.string(), z.unknown())
  .describe("Parameters for the selected model operation; public settings alone are not an executable generation schema.");
const jobIdSchema = z
  .string()
  .regex(/^(?:job_[A-Za-z0-9_-]{8,64}|generation_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/)
  .describe("Generation job id returned by syntx_start_generation.");

const coverageOutputSchema = z.enum(["FULL", "PARTIAL", "OPEN", "REMOVED"]);
const modalityOutputSchema = z.enum(MODALITIES);
const jobStatusOutputSchema = z.enum(JOB_STATUSES);
const sourceHashOutputSchema = z.string().regex(/^sha256:[a-f0-9]{64}$/);
const catalogMetadataOutputSchema = z
  .object({
    fetched_at: z.iso.datetime(),
    source_hashes: z.object({
      ai: sourceHashOutputSchema,
      llm_models: sourceHashOutputSchema,
      models: sourceHashOutputSchema
    }).strict(),
    sources: z.object({
      ai: z.object({ url: z.url(), canonical_sha256: sourceHashOutputSchema }).strict(),
      llm_models: z.object({ url: z.url(), canonical_sha256: sourceHashOutputSchema }).strict(),
      models: z.object({ url: z.url(), canonical_sha256: sourceHashOutputSchema }).strict()
    }).strict(),
    summary: z.object({
      ai_active: z.number().int().nonnegative(),
      ai_inactive: z.number().int().nonnegative(),
      ai_total: z.number().int().nonnegative(),
      ai_without_models: z.number().int().nonnegative(),
      llm_model_disabled: z.number().int().nonnegative(),
      llm_model_enabled: z.number().int().nonnegative(),
      llm_model_free: z.number().int().nonnegative(),
      llm_model_total: z.number().int().nonnegative(),
      model_active: z.number().int().nonnegative(),
      model_ai_names_without_ai: z.number().int().nonnegative(),
      model_defaults: z.number().int().nonnegative(),
      model_inactive: z.number().int().nonnegative(),
      model_total: z.number().int().nonnegative(),
      models_with_features: z.number().int().nonnegative(),
      models_with_settings: z.number().int().nonnegative(),
      unique_llm_ai_names: z.number().int().nonnegative(),
      unique_model_ai_names: z.number().int().nonnegative()
    }).strict(),
    public_settings_coverage: z.literal("ALLOWLISTED_PUBLIC_API_FIELDS")
  })
  .strict();

const jobOutputSchema = z
  .object({
    id: z.string(),
    model_id: z.string(),
    operation_id: z.string(),
    catalog_version: z.string(),
    status: jobStatusOutputSchema,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime()
  })
  .strict();

const estimateOutputSchema = z
  .object({
    estimate_id: z.string(),
    request_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    model_id: z.string(),
    operation_id: z.string(),
    catalog_version: z.string(),
    parameter_keys: z.array(z.string()),
    parameters_redacted: z.literal(true),
    parameters_valid: z.literal(true),
    cost: z
      .object({
        unit: z.literal("tokens"),
        exact: z.number().nonnegative().nullable(),
        minimum: z.number().nonnegative().nullable(),
        maximum: z.number().nonnegative()
      })
      .strict(),
    expires_at: z.iso.datetime(),
    notes: z.array(z.string()),
    approval: z
      .object({
        purpose: z.literal("start_generation"),
        status: z.enum(["unavailable", "test_only", "available"]),
        reference: z.string().startsWith("urn:syntx-mcp:"),
        approval_url: z
          .url()
          .nullable()
          .describe("Optional authenticated approval URL; null when no browser handoff is available."),
        binding_hash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
        message: z.string()
      })
      .strict()
  })
  .strict();

export function createMcpServer(
  application: ApplicationCore,
  options: CreateMcpServerOptions = {}
): McpServer {
  if (options.ownerDurableGeneration &&
      (options.ownerGenerateImage || options.ownerGenerateVideo || options.ownerContractMedia || options.ownerImageReferences ||
        options.ownerGrokImageReferences || options.ownerClarityUpscale || options.ownerMagnificUpscale ||
        options.ownerKontextImageReferences || options.ownerWanImageReferences || options.ownerStandardImageReferences ||
        options.ownerRunwayImageReferences || options.ownerSeedreamImageReferences || options.ownerSeedreamEditorImageReferences || options.ownerFluxImageReferences ||
        options.ownerIdeogramImageReferences || options.ownerGrokT2iImageReferences || options.ownerUniImageReferences ||
        options.ownerBananaInpaintImageReferences || options.ownerSoulImageReferences || options.ownerWanT2iImageReferences ||
        options.ownerWanT2vVideos || options.ownerElevenLabsTts || options.ownerElevenLabsDialogue || options.ownerElevenLabsSts || options.ownerTopazAstra || options.ownerSunoGeneration || options.ownerLumaT2v || options.ownerHailuo01T2v ||
        options.ownerHailuo01DirectorT2v || options.ownerHailuo23T2v || options.ownerHailuo02T2v || options.ownerHailuo02I2v || options.ownerSeedance20T2v ||
        options.ownerKlingT2v || options.ownerKlingI2v || options.ownerKlingKeyframes || options.ownerVeoT2v || options.ownerGrokT2v || options.ownerHailuoLiveT2v || options.ownerVideo2Audio)) {
    throw new Error("OWNER_DURABLE_GENERATION_COMPOSITION_CONFLICT");
  }
  if (options.generationContractRegistry != null && options.generationContractRegistryV2 != null) {
    throw new Error("GENERATION_CONTRACT_REGISTRY_SELECTION_AMBIGUOUS");
  }
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    {
      instructions:
        "This server exposes a dated official-public SYNTX catalog snapshot. Public records are not account entitlement; paid upstream operations remain fail-closed in the default profile."
    }
  );

  // Stable, read-only capability surface. This registry is static and does
  // not authenticate, contact SYNTX, mutate chats, or start paid work.
  registerSyntxRuntimeCoverageTool(server, { resolveCurrentModel: (modelId) => application.getModel(modelId) });
  registerSyntxSettingsEvidenceTool(server);
  registerSyntxMaintenanceTools(server);
  registerSyntxMaintenanceSkillResources(server);
  const maplessSettingsInventory = options.maplessSettingsInventory === undefined
    ? loadMaplessSettingsInventoryVersion(DEFAULT_MAPLESS_SETTINGS_INVENTORY_VERSION)
    : options.maplessSettingsInventory;
  const loadedStaticProjection: LoadedStaticParameterProjection | null = options.staticParameterProjection === undefined
    ? loadPinnedStaticParameterProjection()
    : null;
  const staticParameterProjection = options.staticParameterProjection === undefined
    ? loadedStaticProjection?.projection ?? null
    : options.staticParameterProjection;
  registerSyntxGenerationContractTools(server, {
    resolveModel(modelId) {
      const response = application.getModel(modelId);
      if (!("ai_name" in response.model) || !("upstream_id" in response.model)) {
        throw new ApplicationError("MODEL_NOT_FOUND", "The requested public catalog model was not found.");
      }
      return { ...response.model, catalog_version: response.catalog_version };
    },
    ...(options.generationContractRegistry === undefined ? {} : { registry: options.generationContractRegistry }),
    ...(options.generationContractRegistryV2 === undefined ? {} : { registryV2: options.generationContractRegistryV2 }),
    maplessSettingsInventory,
    maplessSettingsInventoryVersion: options.maplessSettingsInventoryVersion === undefined
      ? (options.maplessSettingsInventory === undefined ? DEFAULT_MAPLESS_SETTINGS_INVENTORY_VERSION : null)
      : options.maplessSettingsInventoryVersion,
    staticParameterProjection,
    staticParameterProjectionVersion: options.staticParameterProjectionVersion === undefined
      ? (loadedStaticProjection?.version ?? null)
      : options.staticParameterProjectionVersion,
    staticParameterProjectionSha256: options.staticParameterProjectionSha256 === undefined
      ? (loadedStaticProjection?.sha256 ?? null)
      : options.staticParameterProjectionSha256,
    staticParameterProjectionSourceSchemaVersion: options.staticParameterProjectionSourceSchemaVersion === undefined
      ? (loadedStaticProjection?.source_schema_version ?? null)
      : options.staticParameterProjectionSourceSchemaVersion,
    staticParameterProjectionMigrationStatus: options.staticParameterProjectionMigrationStatus === undefined
      ? (loadedStaticProjection?.migration_status ?? null)
      : options.staticParameterProjectionMigrationStatus
  });

  server.registerTool(
    "syntx_search_models",
    {
      title: "Search models",
      description:
        "Search the dated local snapshot of SYNTX public API records by text, modality, or operation. Supports cursor pagination and optional inactive history; it does not contact an upstream service.",
      inputSchema: z
        .object({
          query: z
            .string()
            .trim()
            .min(1)
            .max(200)
            .optional()
            .describe("Optional words matched against model and operation names."),
          modality: z
            .enum(MODALITIES)
            .optional()
            .describe("Optional output-modality filter."),
          operation: operationIdSchema
            .optional()
            .describe("Optional exact operation id filter."),
          include_inactive: z
            .boolean()
            .default(false)
            .describe("Include inactive historical public model records."),
          limit: z
            .number()
            .int()
            .min(1)
            .max(100)
            .default(20)
            .describe("Maximum models per page; hard limit 100."),
          cursor: z
            .string()
            .min(1)
            .max(1024)
            .regex(/^[A-Za-z0-9_-]+$/)
            .optional()
            .describe("Opaque next_cursor from the previous page.")
        })
        .strict(),
      outputSchema: z
        .object({
          catalog_version: z.string(),
          catalog_kind: z.enum([
            "PUBLIC_SAMPLE",
            "OFFICIAL_PUBLIC_API_SNAPSHOT"
          ]),
          runtime_usable: z.literal(false),
          catalog_metadata: catalogMetadataOutputSchema.optional(),
          coverage_status: coverageOutputSchema,
          total: z.number().int().nonnegative(),
          next_cursor: z.string().nullable(),
          models: z.array(
            z
              .object({
                id: z.string(),
                display_name: z.string(),
                family: z.string(),
                modalities: z.array(modalityOutputSchema),
                coverage_status: coverageOutputSchema,
                active: z.boolean().optional(),
                default: z.boolean().optional(),
                scope: z.string().nullable().optional(),
                type: z.string().nullable().optional(),
                operations: z.array(
                  z
                    .object({ id: z.string(), display_name: z.string() })
                    .strict()
                )
              })
              .strict()
          )
        })
        .strict(),
      annotations: toolAnnotations("Search models", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false
      })
    },
    async (input) => asToolResult(application.searchModels(input))
  );

  server.registerTool(
    "syntx_get_model",
    {
      title: "Get model schema",
      description:
        "Get one public model variant with all allowlisted settings, features, lifecycle status, source hashes, optional LLM enrichment, and its explicit runtime-contract status. Public settings are not silently treated as an executable generation schema.",
      inputSchema: z
        .object({
          model_id: modelIdSchema,
          operation_id: operationIdSchema.optional()
        })
        .strict(),
      outputSchema: z
        .object({
          catalog_version: z.string(),
          catalog_kind: z.enum([
            "PUBLIC_SAMPLE",
            "OFFICIAL_PUBLIC_API_SNAPSHOT"
          ]),
          runtime_usable: z.literal(false),
          catalog_metadata: catalogMetadataOutputSchema.optional(),
          coverage_status: coverageOutputSchema,
          model: z.record(z.string(), z.unknown())
        })
        .strict(),
      annotations: toolAnnotations("Get model schema", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: false
      })
    },
    async ({ model_id, operation_id }) =>
      handleToolCall(() => application.getModel(model_id, operation_id))
  );

  server.registerTool(
    "syntx_get_balance",
    {
      title: "Get balance",
      description:
        "Read the current upstream token balance for the linked tenant. The default compliance-blocked adapter returns an error and performs no network I/O.",
      inputSchema: z.object({}).strict(),
      outputSchema: z
        .object({
          unit: z.literal("tokens"),
          available: z.number().nonnegative(),
          as_of: z.iso.datetime()
        })
        .strict(),
      annotations: toolAnnotations("Get balance", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: true
      })
    },
    async () => handleToolCall(() => application.getBalance())
  );

  server.registerTool(
    "syntx_estimate_generation",
    {
      title: "Estimate generation",
      description:
        "Use the same model and operation ids as search/get to request a time-limited estimate. An executable generation contract is required; public settings alone are insufficient. It does not authorize or start generation.",
      inputSchema: generationInputSchema(),
      outputSchema: estimateOutputSchema,
      annotations: toolAnnotations("Estimate generation", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: true
      })
    },
    async (input) =>
      handleToolCall(() => application.estimateGeneration(input))
  );

  server.registerTool(
    "syntx_start_generation",
    {
      title: "Start generation",
      description:
        "Start one generation for the same model and operation ids as search/get, only with an executable contract and an authenticated one-time confirmation created outside MCP. Requires an idempotency key to prevent duplicate spend.",
      inputSchema: generationInputSchema().extend({
        idempotency_key: z
          .string()
          .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
          .describe("Caller-generated key reused unchanged when retrying the same request."),
        confirmation_id: z
          .string()
          .regex(/^confirm_[A-Za-z0-9_-]{8,120}$/)
          .describe("One-time approval id created by an authenticated out-of-band flow.")
      }),
      outputSchema: z
        .object({ job: jobOutputSchema, replayed: z.boolean() })
        .strict(),
      annotations: toolAnnotations("Start generation", {
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: true
      })
    },
    async (input) => handleToolCall(() => application.startGeneration(input))
  );

  server.registerTool(
    "syntx_get_job",
    {
      title: "Get generation job",
      description:
        "Poll a generation job by id. Returns its current portable queued, running, terminal, or canceled status.",
      inputSchema: z.object({ job_id: jobIdSchema }).strict(),
      outputSchema: jobOutputSchema,
      annotations: toolAnnotations("Get generation job", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: true
      })
    },
    async ({ job_id }) => handleToolCall(() => application.getJob(job_id))
  );

  server.registerTool(
    "syntx_cancel_job",
    {
      title: "Cancel generation job",
      description:
        "Request cancellation of a queued or running generation job. The first attempt requires explicit confirmation evidence; the same key reconciles without repeating the request. An acknowledgement does not prove cancellation completed; the returned job can remain queued or running.",
      inputSchema: z
        .object({
          job_id: jobIdSchema,
          idempotency_key: z
            .string()
            .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/)
            .describe(
              "Caller-generated key reused unchanged for every retry of this cancellation."
            ),
          confirmation_id: z
            .string()
            .regex(/^confirm_[A-Za-z0-9_-]{8,120}$/)
            .describe(
              "One-time cancellation approval id for the first attempt; omit on a retry that can be reconciled."
            )
            .optional()
        })
        .strict(),
      outputSchema: z
        .object({ job: jobOutputSchema, replayed: z.boolean() })
        .strict(),
      annotations: toolAnnotations("Cancel generation job", {
        readOnly: false,
        destructive: true,
        idempotent: true,
        openWorld: true
      })
    },
    async (input) => handleToolCall(() => application.cancelJob(input))
  );

  server.registerTool(
    "syntx_get_result",
    {
      title: "Get generation result",
      description:
        "Get result metadata after a job succeeds. Large artifacts are represented by authorized links when an adapter provides them.",
      inputSchema: z.object({ job_id: jobIdSchema }).strict(),
      outputSchema: z
        .object({
          id: z.string(),
          job_id: z.string(),
          model_id: z.string(),
          operation_id: z.string(),
          catalog_version: z.string(),
          completed_at: z.iso.datetime(),
          summary: z.string().max(500),
          artifacts: z.array(
            z
              .object({
                id: z.string(),
                kind: modalityOutputSchema,
                mime_type: z.string(),
                size_bytes: z.number().int().nonnegative().nullable(),
                download_url: z.null()
              })
              .strict()
          )
        })
        .strict(),
      annotations: toolAnnotations("Get generation result", {
        readOnly: true,
        destructive: false,
        idempotent: true,
        openWorld: true
      })
    },
    async ({ job_id }) =>
      handleToolCall(async () => {
        const result = await application.getResult(job_id);
        return asResultToolResult(result);
      }, true)
  );

  if (options.auth) {
    registerSyntxAuthTools(server, options.auth);
  }
  if (options.modelAccess) {
    registerSyntxModelAccessTool(server, options.modelAccess);
  }
  if (options.accountStatus) {
    registerSyntxAccountStatusTool(server, options.accountStatus);
  }
  if (options.uploadedFiles) {
    registerSyntxListUploadedFilesTool(server, options.uploadedFiles);
  }
  if (options.uploadFile) {
    registerSyntxUploadFileTool(server, options.uploadFile);
  }
  if (options.reconcileUploadedFile) {
    registerSyntxReconcileUploadedFileTool(server, options.reconcileUploadedFile);
  }
  if (options.ownerGenerateImage) {
    const recoveryStore = options.ownerGenerateImage.recoveryStore ?? new OwnerImageRecoveryStore();
    const ownerImageOptions = { ...options.ownerGenerateImage, recoveryStore };
    registerSyntxOwnerGenerateImageTool(server, ownerImageOptions);
    registerSyntxOwnerReconcileImageTool(server, ownerImageOptions);
  }
  if (options.ownerGenerateVideo) {
    const recoveryStore = options.ownerGenerateVideo.recoveryStore ?? new OwnerVideoRecoveryStore();
    registerSyntxOwnerGenerateVideoTool(server, { ...options.ownerGenerateVideo, recoveryStore });
    registerSyntxOwnerReconcileVideoTool(server, {
      resolveChatClient: options.ownerGenerateVideo.resolveChatClient,
      recoveryStore
    });
  }
  if (options.ownerContractMedia) {
    registerSyntxOwnerContractMediaTools(server, options.ownerContractMedia);
  }
  if (options.ownerDurableGeneration) {
    registerSyntxOwnerDurableGenerationTools(server, options.ownerDurableGeneration);
  }
  if (options.ownerImageReferences) {
    registerSyntxOwnerImageReferenceTools(server, { service: options.ownerImageReferences });
  }
  if (options.ownerGrokImageReferences) {
    registerSyntxOwnerGrokImageReferenceTools(server, { service: options.ownerGrokImageReferences });
  }
  if (options.ownerSoulCatalogShape) {
    registerSyntxOwnerSoulCatalogShapeTools(server, { service: options.ownerSoulCatalogShape });
  }
  if (options.ownerSoulStyleOptions) {
    registerSyntxOwnerSoulStyleOptionsTool(server, { service: options.ownerSoulStyleOptions });
  }
  if (options.ownerClarityUpscale) {
    registerSyntxOwnerClarityUpscaleTools(server, options.ownerClarityUpscale);
  }
  if (options.ownerMagnificUpscale) {
    registerSyntxOwnerMagnificUpscaleTools(server, options.ownerMagnificUpscale);
  }
  if (options.ownerKontextImageReferences) {
    registerSyntxOwnerKontextImageTools(server, options.ownerKontextImageReferences);
  }
  if (options.ownerWanImageReferences) {
    registerSyntxOwnerWanImageTools(server, options.ownerWanImageReferences);
  }
  if (options.ownerStandardImageReferences) {
    registerSyntxOwnerStandardImageTools(server, options.ownerStandardImageReferences);
  }
  if (options.ownerRunwayImageReferences) {
    registerSyntxOwnerRunwayImageTools(server, options.ownerRunwayImageReferences);
  }
  if (options.ownerSeedreamImageReferences) {
    registerSyntxOwnerSeedreamImageTools(server, options.ownerSeedreamImageReferences);
  }
  if (options.ownerSeedreamEditorImageReferences) {
    registerSyntxOwnerSeedreamEditorImageTools(server, options.ownerSeedreamEditorImageReferences);
  }
  if (options.ownerFluxImageReferences) {
    registerSyntxOwnerFluxImageTools(server, options.ownerFluxImageReferences);
  }
  if (options.ownerIdeogramImageReferences) {
    registerSyntxOwnerIdeogramImageTools(server, options.ownerIdeogramImageReferences);
  }
  if (options.ownerGrokT2iImageReferences) {
    registerSyntxOwnerGrokT2iImageTools(server, options.ownerGrokT2iImageReferences);
  }
  if (options.ownerUniImageReferences) {
    registerSyntxOwnerUniImageTools(server, options.ownerUniImageReferences);
  }
  if (options.ownerBananaInpaintImageReferences) {
    registerSyntxOwnerBananaInpaintImageTools(server, options.ownerBananaInpaintImageReferences);
  }
  if (options.ownerSoulImageReferences) {
    registerSyntxOwnerSoulImageTools(server, options.ownerSoulImageReferences);
  }
  if (options.ownerWanT2iImageReferences) {
    registerSyntxOwnerWanT2iTools(server, options.ownerWanT2iImageReferences);
  }
  if (options.ownerWanT2vVideos) {
    registerSyntxOwnerWanT2vVideoTools(server, options.ownerWanT2vVideos);
  }
  if (options.ownerElevenLabsTts) {
    registerSyntxOwnerElevenLabsTtsTools(server, options.ownerElevenLabsTts);
  }
  if (options.ownerElevenLabsDialogue) {
    if (!options.ownerElevenLabsTts) registerSyntxOwnerElevenLabsVoiceTools(server, options.ownerElevenLabsDialogue.voiceReferenceService);
    registerSyntxOwnerElevenLabsDialogueTools(server, options.ownerElevenLabsDialogue.generationService);
  }
  if (options.ownerElevenLabsSts) {
    if (!options.ownerElevenLabsTts && !options.ownerElevenLabsDialogue) {
      registerSyntxOwnerElevenLabsVoiceTools(server, options.ownerElevenLabsSts.voiceReferenceService);
    }
    registerSyntxOwnerElevenLabsStsTools(server, {
      originalReferenceService: options.ownerElevenLabsSts.originalReferenceService,
      voiceReferenceService: options.ownerElevenLabsSts.voiceReferenceService,
      generationService: options.ownerElevenLabsSts.generationService
    });
    if (options.ownerElevenLabsSts.existingMediaService) {
      registerSyntxOwnerElevenLabsStsExistingMediaTools(server, options.ownerElevenLabsSts.existingMediaService);
    }
  }
  if (options.ownerTopazAstra) {
    registerSyntxOwnerTopazAstraTools(server, options.ownerTopazAstra);
    if (options.ownerTopazAstra.existingMediaService) {
      registerSyntxOwnerTopazAstraExistingMediaTools(server, options.ownerTopazAstra.existingMediaService);
    }
  }
  if (options.ownerSunoGeneration) {
    registerSyntxOwnerSunoGenerationTools(server, options.ownerSunoGeneration);
    registerSyntxOwnerSunoTrackTools(server, { generationService: options.ownerSunoGeneration.generationService });
    registerSyntxOwnerSunoTrackOperationTools(server, { generationService: options.ownerSunoGeneration.generationService });
    registerSyntxOwnerSunoExistingTrackTools(server, { generationService: options.ownerSunoGeneration.generationService });
  }
  if (options.ownerLumaT2v) {
    registerSyntxOwnerLumaT2vTools(server, { service: options.ownerLumaT2v.generationService });
  }
  if (options.ownerHailuo01T2v) {
    registerSyntxOwnerHailuo01T2vTools(server, { service: options.ownerHailuo01T2v.generationService });
  }
  if (options.ownerHailuo01DirectorT2v) {
    registerSyntxOwnerHailuo01DirectorT2vTools(server, { service: options.ownerHailuo01DirectorT2v.generationService });
  }
  if (options.ownerHailuo23T2v) {
    registerSyntxOwnerHailuo23T2vTools(server, { service: options.ownerHailuo23T2v.generationService });
  }
  if (options.ownerHailuo02T2v) {
    registerSyntxOwnerHailuo02T2vTools(server, { service: options.ownerHailuo02T2v.generationService });
  }
  if (options.ownerHailuo02I2v) registerSyntxOwnerHailuo02I2vTools(server, options.ownerHailuo02I2v);
  if (options.ownerSeedance20T2v) {
    registerSyntxOwnerSeedance20T2vTools(server, { service: options.ownerSeedance20T2v.generationService });
  }
  if (options.ownerKlingT2v) {
    registerSyntxOwnerKlingT2vTools(server, { service: options.ownerKlingT2v.generationService });
  }
  if (options.ownerKlingI2v) {
    registerSyntxOwnerKlingI2vTools(server, options.ownerKlingI2v);
  }
  if (options.ownerKlingKeyframes) {
    registerSyntxOwnerKlingKeyframesTools(server, { referenceService: options.ownerKlingKeyframes.referenceService,
      ...(options.ownerKlingKeyframes.now === undefined ? {} : { now: options.ownerKlingKeyframes.now }) });
    registerSyntxOwnerKlingKeyframesGenerationTools(server, options.ownerKlingKeyframes.generationService as OwnerKlingKeyframesGenerationService);
  }
  if (options.ownerVeoT2v) {
    registerSyntxOwnerVeoT2vTools(server, { service: options.ownerVeoT2v.generationService });
  }
  if (options.ownerGrokT2v) {
    registerSyntxOwnerGrokT2vTools(server, { service: options.ownerGrokT2v.generationService });
  }
  if (options.ownerHailuoLiveT2v) {
    registerSyntxOwnerHailuoLiveT2vTools(server, { service: options.ownerHailuoLiveT2v.generationService });
  }
  if (options.ownerVideo2Audio) {
    registerSyntxOwnerVideo2AudioTools(server, options.ownerVideo2Audio);
  }
  if (options.ownerWan27R2v) {
    registerSyntxOwnerWan27R2vReferenceTools(server, { referenceUploadService: options.ownerWan27R2v.referenceUploadService });
    if (options.ownerWan27R2v.generationService !== undefined) {
      registerSyntxOwnerWan27R2vGenerationTools(server, { generationService: options.ownerWan27R2v.generationService });
    }
  }
  if (options.videoEvidence) {
    registerSyntxVideoEvidenceTool(server, options.videoEvidence);
  }

  const ownerVideoRecoveryDiagnostics = createOwnerVideoRecoveryDiagnosticMap(options);
  if (ownerVideoRecoveryDiagnostics.size > 0) {
    registerSyntxOwnerReviewedVideoRecoveryDiagnosticTools(server, { diagnostics: ownerVideoRecoveryDiagnostics });
  }

  return server;
}

type OwnerVideoRecoveryDiagnosticInput = Readonly<{ attemptId: string; recovery_id: string }>;
type OwnerVideoRecoveryDiagnosticGetter = (input: OwnerVideoRecoveryDiagnosticInput) => Promise<OwnerReviewedVideoRecoveryDiagnostic>;
type OwnerVideoRecoveryDiagnosticService = Readonly<{
  getRecoveryDiagnostic(input: unknown): Promise<OwnerReviewedVideoRecoveryDiagnostic>;
}>;

function createOwnerVideoRecoveryDiagnosticMap(
  options: CreateMcpServerOptions
): ReadonlyMap<OwnerReviewedVideoRecoveryDiagnosticModelId, OwnerVideoRecoveryDiagnosticGetter> {
  const diagnostics = new Map<OwnerReviewedVideoRecoveryDiagnosticModelId, OwnerVideoRecoveryDiagnosticGetter>();
  const addSingleModel = (modelId: OwnerReviewedVideoRecoveryDiagnosticModelId, service: OwnerVideoRecoveryDiagnosticService | undefined) => {
    if (service) {
      diagnostics.set(modelId, (input) => service.getRecoveryDiagnostic({
        attemptId: input.attemptId,
        recovery_id: input.recovery_id
      }));
    }
  };
  const addFamilyModel = (modelId: OwnerReviewedVideoRecoveryDiagnosticModelId, service: OwnerVideoRecoveryDiagnosticService | undefined) => {
    if (service) {
      diagnostics.set(modelId, (input) => service.getRecoveryDiagnostic({
        model_id: modelId,
        attemptId: input.attemptId,
        recovery_id: input.recovery_id
      }));
    }
  };

  addSingleModel("hailuo-01", options.ownerHailuo01T2v?.generationService);
  addSingleModel("hailuo-01-director", options.ownerHailuo01DirectorT2v?.generationService);
  addSingleModel("hailuo-02", options.ownerHailuo02T2v?.generationService);
  addSingleModel("hailuo-2.3", options.ownerHailuo23T2v?.generationService);
  addSingleModel("hailuo-01-live", options.ownerHailuoLiveT2v?.generationService);
  addSingleModel("seedance-2.0", options.ownerSeedance20T2v?.generationService);
  addFamilyModel("kling_text2video", options.ownerKlingT2v?.generationService);
  addFamilyModel("kling_o1_text2video", options.ownerKlingT2v?.generationService);
  addFamilyModel("veo3", options.ownerVeoT2v?.generationService);
  addFamilyModel("veo3fast", options.ownerVeoT2v?.generationService);
  addFamilyModel("veo3fast_r", options.ownerVeoT2v?.generationService);
  addSingleModel("grok_t2v", options.ownerGrokT2v?.generationService);

  return diagnostics;
}

function generationInputSchema() {
  return z
    .object({
      model_id: modelIdSchema,
      operation_id: operationIdSchema,
      parameters: parametersInputSchema
    })
    .strict();
}

function toolAnnotations(
  title: string,
  options: {
    readOnly: boolean;
    destructive: boolean;
    idempotent: boolean;
    openWorld: boolean;
  }
): ToolAnnotations {
  return {
    title,
    readOnlyHint: options.readOnly,
    destructiveHint: options.destructive,
    idempotentHint: options.idempotent,
    openWorldHint: options.openWorld
  };
}

async function handleToolCall<T extends object>(
  operation: () => T | Promise<T> | CallToolResult | Promise<CallToolResult>,
  operationReturnsToolResult = false
): Promise<CallToolResult> {
  try {
    const result = await operation();
    return operationReturnsToolResult
      ? (result as CallToolResult)
      : asToolResult(result as T);
  } catch (error) {
    return asToolError(error);
  }
}

function asToolResult<T extends object>(result: T): CallToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(result) }],
    structuredContent: result as Record<string, unknown>
  };
}

function asResultToolResult(result: GenerationResult): CallToolResult {
  const links = result.artifacts.flatMap((artifact) => {
    if (artifact.download_url === null) return [];
    const parsed = parseHttpsArtifactUrl(artifact.id, artifact.download_url);
    return [
      {
        type: "resource_link" as const,
        uri: parsed.href,
        name: artifact.id,
        description: `Generated ${artifact.kind} artifact`,
        mimeType: artifact.mime_type
      }
    ];
  });
  const safeResult = {
    ...result,
    summary: safeResultSummary(),
    artifacts: result.artifacts.map((artifact) => ({
      ...artifact,
      download_url: null
    }))
  };
  const content: CallToolResult["content"] = [
    { type: "text", text: JSON.stringify(safeResult) },
    ...links
  ];
  return {
    content,
    structuredContent: safeResult as unknown as Record<string, unknown>
  };
}

function parseHttpsArtifactUrl(artifactId: string, value: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw unsafeArtifactUrlError(artifactId);
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.hostname.length === 0 ||
    parsed.username.length > 0 ||
    parsed.password.length > 0
  ) {
    throw unsafeArtifactUrlError(artifactId);
  }
  return parsed;
}

function unsafeArtifactUrlError(artifactId: string): ApplicationError {
  return new ApplicationError(
    "UNSAFE_ARTIFACT_URL",
    `Artifact ${artifactId} did not provide an acceptable HTTPS link.`
  );
}

function safeResultSummary(): string {
  return "Result metadata is available; inspect artifact metadata and resource links.";
}

function asToolError(error: unknown): CallToolResult {
  const payload =
    error instanceof ApplicationError
      ? {
          error: {
            code: error.code,
            message: safeApplicationErrorMessage(error.code)
          }
        }
      : {
          error: {
            code: "INTERNAL_ERROR",
            message: "The operation failed without exposing internal details."
          }
        };
  return {
    isError: true,
    content: [{ type: "text", text: JSON.stringify(payload) }]
  };
}

/** Do not serialize upstream messages or error details: either may contain user data or signed URLs. */
function safeApplicationErrorMessage(code: ApplicationErrorCode): string {
  const messages: Record<ApplicationErrorCode, string> = {
    COMPLIANCE_GATE_BLOCKED: "This operation is unavailable in the current runtime profile.",
    MODEL_NOT_FOUND: "The requested model is not available in the active catalog.",
    OPERATION_NOT_FOUND: "The requested operation is not available for that model.",
    GENERATION_CONTRACT_UNAVAILABLE: "The selected model and operation are known, but no executable generation contract is available.",
    INVALID_PARAMETERS: "Generation parameters do not match the active schema.",
    IDEMPOTENCY_CONFLICT: "The idempotency key conflicts with an earlier request.",
    COST_CAP_EXCEEDED: "The request exceeds the approved cost cap.",
    CONFIRMATION_REQUIRED: "A valid out-of-band confirmation is required.",
    CONFIRMATION_EXPIRED: "The confirmation has expired; obtain a fresh confirmation.",
    CONFIRMATION_MISMATCH: "The confirmation does not match this request.",
    CONFIRMATION_ALREADY_USED: "The confirmation was already used.",
    UPSTREAM_START_FAILED: "The upstream operation failed before a confirmed result; reconcile before retrying.",
    UPSTREAM_OUTCOME_UNKNOWN: "The upstream outcome is unknown; reconcile before retrying.",
    UPSTREAM_CAPABILITY_NOT_RESEARCHED: "This capability has no verified upstream contract yet and cannot be called.",
    JOB_NOT_FOUND: "The requested job is not available for this tenant.",
    JOB_NOT_READY: "The requested result is not ready.",
    JOB_NOT_CANCELABLE: "The requested job cannot be canceled in its current state.",
    UNSAFE_ARTIFACT_URL: "The adapter returned an unsafe artifact link."
  };
  return messages[code];
}
