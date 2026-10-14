import { createHash, randomUUID } from "node:crypto";
import { TextDecoder, isDeepStrictEqual, types } from "node:util";
import { z } from "zod/v4";
import { schemaHash } from "../../domain/generation-contract.js";
import type { GenerationPrincipalRef } from "../../domain/generation-operation.js";
import { sameGenerationPrincipal, snapshotGenerationPrincipal } from "../../domain/generation-principal.js";
import {
  isOwnerElevenLabsTtsRequestPreparer,
  type OwnerElevenLabsTtsCandidateBinding,
  type OwnerElevenLabsTtsPreparedCandidate,
  type OwnerElevenLabsTtsPrivateRequest,
  type OwnerElevenLabsTtsRequestPreparer
} from "../../application/owner-elevenlabs-tts-request-preparer.js";
import {
  OwnerElevenLabsTtsOneShotPolicy,
  type OwnerElevenLabsTtsOneShotPermit,
  type OwnerElevenLabsTtsOneShotReceipt
} from "../../application/owner-elevenlabs-tts-one-shot-policy.js";
import {
  getOwnerElevenLabsDialogueSourceProfile,
  getOwnerElevenLabsDialoguePrivateRequestForPolicy,
  isOwnerElevenLabsDialogueRequestPreparer,
  type OwnerElevenLabsDialogueCandidateBinding,
  type OwnerElevenLabsDialoguePreparedCandidate,
  type OwnerElevenLabsDialoguePrivateRequest,
  type OwnerElevenLabsDialogueRequestPreparer
} from "../../application/owner-elevenlabs-dialogue-request-preparer.js";
import {
  OwnerElevenLabsDialogueOneShotPolicy,
  type OwnerElevenLabsDialogueOneShotPermit,
  type OwnerElevenLabsDialogueOneShotReceipt
} from "../../application/owner-elevenlabs-dialogue-one-shot-policy.js";
import {
  OWNER_ELEVENLABS_TTS_MODEL_IDS,
  OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS,
  OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
  OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
  type OwnerElevenLabsDialogueModel,
  type OwnerElevenLabsTtsModel
} from "../../application/owner-elevenlabs-generation-parameters.js";
import {
  decodeOwnerElevenLabsAudioResult,
  type OwnerElevenLabsAudioResult,
  type OwnerElevenLabsAudioResultReadContext
} from "./owner-elevenlabs-audio-result.js";
import {
  isOwnerSunoGenerationRequestPreparer,
  OwnerSunoGenerationRequestPreparer,
  type OwnerSunoGenerationCandidateBinding,
  type OwnerSunoGenerationPreparedCandidate,
  type OwnerSunoGenerationPrivateRequest
} from "../../application/owner-suno-generation-request-preparer.js";
import {
  isOwnerSunoGenerationOneShotPolicy,
  OwnerSunoGenerationOneShotPolicy,
  type OwnerSunoGenerationOneShotPermit,
  type OwnerSunoGenerationOneShotReceipt
} from "../../application/owner-suno-generation-one-shot-policy.js";
import { OWNER_SUNO_GENERATION_MODEL_IDS, OWNER_SUNO_GENERATION_PUBLIC_VERSION,
  OWNER_SUNO_GENERATION_SETTINGS_VERSION, type OwnerSunoGenerationModel,
  type OwnerSunoGenerationSourcePins } from "../../application/owner-suno-generation-parameters.js";
import {
  OWNER_SUNO_TRACK_OPERATION_MODEL_IDS,
  getOwnerSunoTrackOperationParameterSource,
  type OwnerSunoTrackOperationModel,
  type OwnerSunoTrackOperationMode,
  type OwnerSunoTrackOperationSourcePins
} from "../../application/owner-suno-track-operation-parameters.js";
import type {
  OwnerSunoTrackOperationCandidateBinding,
  OwnerSunoTrackOperationPreparedCandidate,
  OwnerSunoTrackOperationPrivateRequest,
  OwnerSunoTrackOperationRequestPreparer
} from "../../application/owner-suno-track-operation-request-preparer.js";
import type {
  OwnerSunoTrackOperationOneShotPermit,
  OwnerSunoTrackOperationOneShotPolicy,
  OwnerSunoTrackOperationOneShotReceipt
} from "../../application/owner-suno-track-operation-one-shot-policy.js";
import { decodeOwnerSunoAudioResult, type OwnerSunoAudioResult, type OwnerSunoAudioResultReadContext } from "./owner-suno-audio-result.js";
import {
  OWNER_SUNO_EXISTING_CONTEXT_CAPACITY,
  OWNER_SUNO_EXISTING_HISTORY_MAX_MESSAGES,
  OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES,
  OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE,
  OWNER_SUNO_EXISTING_INDEX_MAX_PAGE,
  OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE,
  OwnerSunoExistingTrackCodecError,
  decodeOwnerSunoExistingTrackHistoryPage,
  decodeOwnerSunoExistingTrackIndex,
  deriveOwnerSunoExistingTrackIntentFingerprint,
  existingOwnerSunoSourceBinding,
  readOwnerSunoExistingTrackMetadata,
  validateOwnerSunoExistingTrackResultEnvelope,
  validateOwnerSunoExistingTrackResultJoin,
  type OwnerSunoExistingTrackHistoryRow,
  type OwnerSunoExistingTrackIndexChat,
  type OwnerSunoExistingTrackMetadata,
  type OwnerSunoExistingTrackResultContextFields,
  type OwnerSunoExistingTrackTitleFamily
} from "./owner-suno-existing-track.js";
import {
  listOwnedElevenLabsStsExistingChats as readElevenLabsStsExistingChats,
  listOwnedElevenLabsStsExistingCandidates as readElevenLabsStsExistingCandidates,
  getOwnedElevenLabsStsExistingResult as readElevenLabsStsExistingResult,
  type OwnerElevenLabsStsExistingChatPage,
  type OwnerElevenLabsStsExistingCandidates,
  type OwnerElevenLabsStsExistingChatContext,
  type OwnerElevenLabsStsExistingResultContext
} from "./owner-elevenlabs-sts-existing-media.js";
import { readOwnerSunoTrackMetadata } from "../../application/owner-suno-track-metadata.js";
import {
  getOwnerClarityUpscaleSourceProfile,
  isOwnerClarityUpscalePreparedCandidateForPrincipal,
  type OwnerClarityUpscalePreparedCandidate
} from "../../application/owner-clarity-upscale-request-preparer.js";
import {
  isOwnerMagnificUpscalePreparedCandidateForPrincipal,
  type OwnerMagnificUpscalePreparedCandidate
} from "../../application/owner-magnific-upscale-request-preparer.js";
import type { OwnerMagnificUpscaleVariant } from "../../application/owner-magnific-upscale-parameters.js";
import {
  consumeOwnerMagnificUpscaleOneShotPermit,
  type OwnerMagnificUpscaleOneShotPermit
} from "../../application/owner-magnific-upscale-one-shot-policy.js";
import type { OwnerClarityImageMimeType } from "../../application/owner-clarity-upscale-input-validator.js";
import { inspectBoundedOwnerImageBytes } from "../../application/owner-image-reference-input-validator.js";
import { inspectBoundedOwnerClarityAvifBytes } from "../../application/owner-clarity-upscale-input-validator.js";
import type { OwnerMagnificUpscaleImageMimeType } from "../../application/owner-magnific-upscale-input-validator.js";
import type { OwnerKontextCanonicalImageMimeType } from "../../application/owner-kontext-image-input-validator.js";
import {
  validateOwnerStandardImageUploadData,
  type OwnerStandardImageInputVariant
} from "../../application/owner-standard-image-input-validator.js";
import {
  validateOwnerBananaInpaintOriginalUploadData,
  type OwnerBananaInpaintOriginalMimeType
} from "../../application/owner-banana-inpaint-original-validator.js";
import { validateOwnerBananaInpaintPaintedCompositeUploadData } from "../../application/owner-banana-inpaint-painted-composite-input-validator.js";
import { validateOwnerKlingI2VImageBytes } from "../../application/owner-kling-i2v-input-policy.js";
import {
  readValidatedOwnerHailuo02I2vImageUpload,
  type OwnerHailuo02I2vCanonicalMimeType,
  type ValidatedOwnerHailuo02I2vImageUpload
} from "../../application/owner-hailuo02-i2v-image-policy.js";
import type { OwnerHailuo02I2vImageUploadContext } from "./hailuo02-i2v-upload-context.js";
import {
  consumeOwnerKlingI2vGenerationContext,
  withCapturedOwnerKlingI2vGenerationContext
} from "../../application/owner-kling-i2v-generation-context.js";
import { readOwnerKlingI2VUploadReferenceForClient, type OwnerKlingI2VUploadContext } from "./kling-i2v-upload-context.js";
import { validateOwnerSeedreamEditorDrawingUploadData } from "../../application/owner-seedream-editor-drawing-input-validator.js";
import {
  type OwnerSeedreamEditorImageCandidateBinding,
  type OwnerSeedreamEditorImagePreparedCandidate,
  type OwnerSeedreamEditorImageRequestPreparer
} from "../../application/owner-seedream-editor-image-request-preparer.js";
import type { OwnerSeedreamEditorImageOneShotPermit } from "../../application/owner-seedream-editor-image-one-shot-policy.js";
import {
  correlateOwnerSeedreamEditorImageHistoryBinding,
} from "../../application/owner-seedream-editor-image-history-binding.js";
import {
  decodeOwnerSeedreamEditorImageResult,
  type OwnerSeedreamEditorImageResult,
  type OwnerSeedreamEditorImageResultReadContext
} from "./owner-seedream-editor-image-result.js";
import {
  decodeOwnerWanT2vVideoResult,
  type OwnerWanT2vVideoResult,
  type OwnerWanT2vVideoResultReadContext
} from "./owner-wan-t2v-video-result.js";
import {
  validateOwnerBananaInpaintAuxiliaryUploadData,
  type OwnerBananaInpaintAuxiliaryVariant,
  type OwnerBananaInpaintAuxiliaryCanonicalMimeType
} from "../../application/owner-banana-inpaint-auxiliary-input-validator.js";
import {
  decodeOwnerBananaInpaintImageResult,
  type OwnerBananaInpaintImageResult,
  type OwnerBananaInpaintImageResultReadContext
} from "./owner-banana-inpaint-image-result.js";
import { validateOwnerStandardImageAuxUploadData } from "../../application/owner-standard-image-aux-input-validator.js";
import {
  validateOwnerRunwayFluxImageUploadData
} from "../../application/owner-runway-flux-image-input-validator.js";
import {
  validateOwnerSeedreamImageUploadData
} from "../../application/owner-seedream-image-input-validator.js";
import {
  validateOwnerSeedreamEditorOriginalUploadData
} from "../../application/owner-seedream-editor-original-validator.js";
import {
  createOwnerVideo2AudioSourceProfile,
  isAuthenticOwnerVideo2AudioSourceProfile,
  type OwnerVideo2AudioSourceProfile
} from "../../application/owner-video2audio-source-profile.js";
import { normalizeOwnerVideo2AudioPrompt } from "../../application/owner-video2audio-input-parameters.js";
import {
  parseOwnerVideo2AudioOriginalUploadReceipt,
  validateOwnerVideo2AudioOriginalUploadRequest
} from "./video2audio-original-codec.js";
import type {
  OwnerVideo2AudioCandidateBinding,
  OwnerVideo2AudioPreparedCandidate,
  OwnerVideo2AudioPreparedRequest,
  OwnerVideo2AudioRequestPreparer
} from "../../application/owner-video2audio-request-preparer.js";
import type {
  OwnerVideo2AudioOneShotPermit
} from "../../application/owner-video2audio-one-shot-policy.js";
import {
  correlateOwnerVideo2AudioHistory,
  decodeOwnerVideo2AudioResult,
  type OwnerVideo2AudioHistoryGapCode,
  type OwnerVideo2AudioResult,
  type OwnerVideo2AudioResultReadContext
} from "../../application/owner-video2audio-result-codec.js";
import {
  validateOwnerIdeogramImageUploadData,
  type OwnerIdeogramImageModelId
} from "../../application/owner-ideogram-image-input.js";
import {
  validateOwnerGrokT2iImageUploadData,
  type OwnerGrokT2iImageCanonicalMimeType,
  type OwnerGrokT2iImageModelId,
  type OwnerGrokT2iImageSourceMimeType
} from "../../application/owner-grok-t2i-image-input-validator.js";
import {
  validateOwnerUniImageReferenceUploadRequest,
  type OwnerUniImageReferenceUploadRequest
} from "./owner-uni-image-upload.js";
import { OWNER_GROK_T2I_MODELS, type OwnerGrokT2iModel } from "../../application/owner-grok-t2i-parameters.js";
import type { OwnerGrokT2iPreparedCandidate, OwnerGrokT2iRequestPreparer } from "../../application/owner-grok-t2i-request-preparer.js";
import type { OwnerGrokT2iOneShotPermit } from "../../application/owner-grok-t2i-one-shot-policy.js";
import type { OwnerUniImagePreparedCandidate, OwnerUniImageRequestPreparer } from "../../application/owner-uni-image-request-preparer.js";
import type { OwnerUniImageOneShotPermit } from "../../application/owner-uni-image-one-shot-policy.js";
import type { OwnerUniImageModel, OwnerUniImageSourceParameters } from "../../application/owner-uni-image-parameters.js";
import type {
  OwnerBananaInpaintImagePreparedCandidate,
  OwnerBananaInpaintImageRequest,
  OwnerBananaInpaintImageRequestPreparer
} from "../../application/owner-banana-inpaint-image-request-preparer.js";
import type { OwnerBananaInpaintImageOneShotPermit } from "../../application/owner-banana-inpaint-image-one-shot-policy.js";
import type { OwnerSoulImagePreparedCandidate, OwnerSoulImageRequestPreparer } from "../../application/owner-soul-image-request-preparer.js";
import type { OwnerSoulImageOneShotPermit } from "../../application/owner-soul-image-one-shot-policy.js";
import type { OwnerWanT2iPreparedCandidate, OwnerWanT2iRequestPreparer } from "../../application/owner-wan-t2i-request-preparer.js";
import type { OwnerWanT2iOneShotPermit } from "../../application/owner-wan-t2i-one-shot-policy.js";
import type { OwnerWanT2iResultReadContext } from "../../application/owner-wan-t2i-history-binding.js";
import {
  decodeOwnerWanT2iImageResult,
  snapshotOwnerWanT2iResultReadContext,
  type InternalOwnerWanT2iImageResult
} from "./owner-wan-t2i-result.js";
import {
  validateOwnerIdeogramPaintedMaskVariantBytes
} from "../../application/owner-ideogram-painted-mask-codec.js";
import {
  OWNER_IDEOGRAM_IMAGE_CONTEXTS
} from "../../application/owner-ideogram-image-parameters.js";
import type { OwnerIdeogramImagePreparedCandidate } from "../../application/owner-ideogram-image-request-preparer.js";
import type { OwnerIdeogramImageOneShotPermit } from "../../application/owner-ideogram-image-one-shot-policy.js";
import {
  isOwnerFluxImagePreparedCandidateForPrincipal,
  type OwnerFluxImagePreparedCandidate
} from "../../application/owner-flux-image-request-preparer.js";
import {
  consumeOwnerFluxImageOneShotPermit,
  type OwnerFluxImageOneShotPermit
} from "../../application/owner-flux-image-one-shot-policy.js";
import { OWNER_FLUX_IMAGE_MODELS, type OwnerFluxImageModel } from "../../application/owner-flux-image-parameters.js";
import {
  isOwnerSeedreamImagePreparedCandidateForPrincipal,
  type OwnerSeedreamImagePreparedCandidate
} from "../../application/owner-seedream-image-request-preparer.js";
import {
  consumeOwnerSeedreamImageOneShotPermit,
  type OwnerSeedreamImageOneShotPermit
} from "../../application/owner-seedream-image-one-shot-policy.js";
import { OWNER_SEEDREAM_IMAGE_VARIANTS, type OwnerSeedreamImageVariant } from "../../application/owner-seedream-image-parameters.js";
import {
  isOwnerRunwayImagePreparedCandidateForPrincipal,
  type OwnerRunwayImagePreparedCandidate
} from "../../application/owner-runway-image-request-preparer.js";
import {
  consumeOwnerRunwayImageOneShotPermit,
  type OwnerRunwayImageOneShotPermit
} from "../../application/owner-runway-image-one-shot-policy.js";
import {
  OWNER_STANDARD_IMAGE_VARIANTS,
  isOwnerStandardImagePreparedCandidateForPrincipal,
  type OwnerStandardImagePreparedCandidate,
  type OwnerStandardImageVariant
} from "../../application/owner-standard-image-request-preparer.js";
import {
  consumeOwnerStandardImageOneShotPermit,
  type OwnerStandardImageOneShotPermit
} from "../../application/owner-standard-image-one-shot-policy.js";
import {
  validateOwnerWanImageInput,
  type OwnerWanCanonicalImageMimeType,
  type OwnerWanImageVariant
} from "../../application/owner-wan-image-input-validator.js";
import {
  isOwnerWanImagePreparedCandidateForPrincipal,
  type OwnerWanImagePreparedCandidate
} from "../../application/owner-wan-image-request-preparer.js";
import {
  consumeOwnerWanImageOneShotPermit,
  type OwnerWanImageOneShotPermit
} from "../../application/owner-wan-image-one-shot-policy.js";
import {
  isOwnerKontextImagePreparedCandidateForPrincipal,
  type OwnerKontextImagePreparedCandidate
} from "../../application/owner-kontext-image-request-preparer.js";
import {
  consumeOwnerKontextImageOneShotPermit,
  type OwnerKontextImageOneShotPermit
} from "../../application/owner-kontext-image-one-shot-policy.js";
import type { OwnerKontextImageVariant } from "../../application/owner-kontext-image-parameters.js";
import {
  consumeOwnerClarityUpscaleOneShotPermit,
  type OwnerClarityUpscaleOneShotPermit
} from "../../application/owner-clarity-upscale-one-shot-policy.js";
import {
  SyntxHttpError,
  type SyntxCredentialBroker
} from "./http-client.js";
import {
  AbsoluteRequestDeadline,
  type RequestAbortSource
} from "./request-deadline.js";
import {
  parseInternalUploadReferences,
  isSafeUploadReferenceUrl,
  type InternalUploadReference
} from "./upload-reference-bridge.js";
import {
  decodeRunwayImageResult,
  snapshotRunwayImageResultReadContext,
  type InternalRunwayImageResult,
  type RunwayImageResultReadContext
} from "./runway-image-result.js";
import {
  decodeSeedreamImageResult,
  snapshotSeedreamImageResultReadContext,
  type InternalSeedreamImageResult,
  type SeedreamImageResultReadContext
} from "./seedream-image-result.js";
import {
  decodeOwnerFluxImageResult,
  snapshotOwnerFluxImageResultReadContext,
  type InternalOwnerFluxImageResult,
  type OwnerFluxImageResultReadContext
} from "./flux-image-result.js";
import {
  decodeOwnerIdeogramImageResult,
  snapshotOwnerIdeogramImageResultReadContext,
  type InternalOwnerIdeogramImageResult,
  type OwnerIdeogramImageResultReadContext
} from "./ideogram-image-result.js";
import {
  decodeOwnerUniImageResult,
  snapshotOwnerUniImageResultReadContext,
  type InternalOwnerUniImageResult,
  type OwnerUniImageResultReadContext
} from "./owner-uni-image-result.js";
import {
  decodeOwnerSoulImageResult,
  snapshotOwnerSoulImageResultReadContext,
  type InternalOwnerSoulImageResult,
  type OwnerSoulImageResultReadContext
} from "./owner-soul-image-result.js";
import {
  parseOwnerTopazAstraOriginalUploadReceipt,
  validateOwnerTopazAstraOriginalProbeForUpload,
  type OwnerTopazAstraOriginalUploadContext
} from "./topaz-astra-original-upload.js";
import {
  parseOwnerElevenLabsStsOriginalUploadReceipt,
  validateOwnerElevenLabsStsOriginalProbeForUpload,
  type OwnerElevenLabsStsOriginalUploadReference
} from "./owner-elevenlabs-sts-original-upload.js";
import type { OwnerElevenLabsStsResult } from "./owner-elevenlabs-sts-result-codec.js";

const V1_BASE_URL = new URL("https://api.syntx.ai/api/v1/");
const OWNER_VIDEO2AUDIO_NATIVE_CHAT_LIMIT = 128;
const OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE = 10;
const OWNER_VIDEO2AUDIO_HISTORY_MESSAGE_LIMIT = 64;
const OWNER_VIDEO2AUDIO_HISTORY_PAGE_LIMIT = 7;
const OWNER_TOPAZ_ASTRA_UPLOAD_CONTEXTS = new WeakMap<object, Readonly<{
  client: SyntxChatHttpClient;
  url: string;
  model_id: OwnerTopazAstraOriginalUploadContext["model_id"];
  destination: SyntxUploadDestination;
  source_sha256: string;
  source_size: number;
  source_mime_type: OwnerTopazAstraOriginalUploadContext["source_mime_type"];
  width: number;
  height: number;
  duration_seconds: number;
  decoded_frame_count: number;
}>>();
const OWNER_ELEVENLABS_STS_UPLOAD_CONTEXTS = new WeakMap<object, Readonly<{
  client: SyntxChatHttpClient;
  url: string;
  destination: SyntxUploadDestination;
  model_type: "eleven_multilingual_sts_v2";
  source_sha256: string;
  size: number;
  mime_type: "audio/mpeg";
  duration_seconds: number;
}>>();
const OWNER_VIDEO2AUDIO_HISTORY_PAGE_SCHEMA = z.object({
  messages: z.array(z.unknown()).max(OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(1_000_000),
    page_size: z.literal(OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE),
    total_count: z.number().int().min(0).max(1_000_000_000),
    total_pages: z.number().int().min(0).max(1_000_000),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).passthrough()
}).passthrough();
const SAFE_PATH_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_MODEL_IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SAFE_SETTING_KEY = /^[A-Za-z][A-Za-z0-9._-]{0,63}$/u;
const SAFE_RESPONSE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const FORBIDDEN_OBJECT_KEYS = new Set([
  "__proto__",
  "prototype",
  "constructor"
]);

const MAX_TITLE_BYTES = 1024;
const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_SYSTEM_VALUE_BYTES = 32 * 1024;
const MAX_REQUEST_BYTES = 256 * 1024;
const MAX_SETTINGS_DEPTH = 8;
const MAX_SETTINGS_NODES = 2048;
const MAX_OBJECT_KEYS = 128;
const MAX_ARRAY_ITEMS = 64;
const MAX_FILES = 16;
const MAX_URL_LENGTH = 4096;
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
// Mirrors the observed Magnific FileUpload UI fallback; this is not a provider limit.
const MAX_MAGNIFIC_UPLOAD_BYTES = 10 * 1024 * 1024;
// Local bounded-resource guard for the validated Kontext input; not a provider limit.
const MAX_KONTEXT_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_CLARITY_UPLOAD_BYTES = 25 * 1024 * 1024;
const MAX_WAN_UPLOAD_BYTES = 20 * 1024 * 1024;
const MAX_STANDARD_IMAGE_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_IDEOGRAM_IMAGE_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_GROK_IMAGINE_IMAGE_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_BANANA_INPAINT_ORIGINAL_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_BANANA_INPAINT_PAINTED_COMPOSITE_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_BANANA_INPAINT_AUXILIARY_UPLOAD_BYTES = 50 * 1024 * 1024;
const MAX_SEEDREAM_EDITOR_ORIGINAL_UPLOAD_BYTES = 30 * 1024 * 1024;
const MAX_SEEDREAM_EDITOR_DRAWING_UPLOAD_BYTES = 32 * 1024 * 1024;
const MAX_KLING_I2V_IMAGE_UPLOAD_BYTES = 30 * 1024 * 1024;
const HAILUO02_I2V_UPLOAD_CONTEXTS = new WeakMap<object, Readonly<Hailuo02I2vUploadContextState>>();
const BANANA_INPAINT_ORIGINAL_VARIANTS = new Set(["banana", "banana2", "banana3", "banana3_light"]);
const BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS = new Set(["banana", "banana2", "banana3", "banana3_light"]);
const BANANA_INPAINT_AUXILIARY_VARIANTS = new Set(["banana", "banana2", "banana3", "banana3_light"]);
const CLARITY_UPLOAD_MIME_TYPES = new Set<OwnerClarityImageMimeType>([
  "image/jpeg", "image/png", "image/avif", "image/webp"
]);
const MAGNIFIC_UPLOAD_MIME_TYPES = new Set<OwnerMagnificUpscaleImageMimeType>([
  "image/jpeg", "image/png", "image/avif", "image/webp"
]);
const MAGNIFIC_UPLOAD_MODEL_TYPES = new Set(["creative", "precision_v1", "precision_v2"]);
const KONTEXT_UPLOAD_MIME_TYPES = new Set<OwnerKontextCanonicalImageMimeType>(["image/jpeg", "image/png", "image/avif", "image/webp"]);
const KONTEXT_UPLOAD_MODEL_TYPES = new Set(["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"]);
const MAGNIFIC_UPSCALE_VARIANTS = new Set<OwnerMagnificUpscaleVariant>(["creative", "precision_v1", "precision_v2"]);
const KONTEXT_IMAGE_VARIANTS = new Set<OwnerKontextImageVariant>(["flux-kontext-pro", "flux-kontext-max", "flux-kontext-multi"]);
const WAN_IMAGE_VARIANTS = new Set<OwnerWanImageVariant>([
  "wan_25_i2i_preview", "wan_26_image", "wan_27_image", "wan_27_image_pro"
]);
const SEEDREAM_EDITOR_ORIGINAL_VARIANTS = new Set<OwnerSeedreamImageVariant>(OWNER_SEEDREAM_IMAGE_VARIANTS);
const WAN_CANONICAL_IMAGE_MIME_TYPES = new Set<OwnerWanCanonicalImageMimeType>([
  "image/jpeg", "image/png", "image/bmp", "image/webp"
]);
const GROK_IMAGE_MODEL_TYPES = new Set<GrokImageModelType>(["grok_i2i", "grok_i2i_pro"]);
const GROK_T2I_IMAGE_MODEL_TYPES = new Set<OwnerGrokT2iModel>(OWNER_GROK_T2I_MODELS);
const GROK_IMAGE_REFERENCE_RATIOS = new Set(["1:1", "1:2", "2:1", "2:3", "3:2", "3:4", "4:3", "9:16", "16:9"]);
const SAFE_UPLOAD_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._ -]{0,127}$/u;
const KONTEXT_FILENAME_DELIMITERS = /[<>:"/\\|?*]/u;
const KONTEXT_RESERVED_FILENAME = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/iu;
const UPLOAD_MIME_TYPES = new Set([
  "image/jpeg", "image/png", "image/webp",
  "video/mp4", "video/quicktime",
  "audio/mpeg", "audio/wav"
]);

const providerIdSchema = z
  .union([
    z.string().regex(SAFE_RESPONSE_TOKEN),
    z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
  ])
  .transform(String);

const createChatResponseSchema = z
  .object({ uuid: z.string().regex(SAFE_PATH_IDENTIFIER) })
  .strip();

const textStartResponseSchema = z
  .object({
    job_id: providerIdSchema,
    stream_url: z.string().min(1).max(MAX_URL_LENGTH),
    message_id: providerIdSchema
  })
  .strip();

const mediaStartResponseSchema = z
  .object({ id: providerIdSchema })
  .strip();

const uploadResponseSchema = z.object({
  id: providerIdSchema.optional(),
  file_id: providerIdSchema.optional(),
  filename: z.string().max(256).optional(),
  mime_type: z.string().max(128).optional(),
  type: z.string().max(128).optional(),
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES).optional(),
  status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
}).strip().refine((value) => value.id !== undefined || value.file_id !== undefined || value.status !== undefined, {
  message: "Upload response has no supported metadata."
});

const clarityUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_CLARITY_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();

const magnificUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128),
    size: z.number().int().nonnegative().max(MAX_MAGNIFIC_UPLOAD_BYTES),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();

const kontextUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128),
    size: z.number().int().nonnegative().max(MAX_KONTEXT_UPLOAD_BYTES),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();

const wanUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128),
    size: z.number().int().nonnegative().max(MAX_WAN_UPLOAD_BYTES),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();

const standardImageUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_STANDARD_IMAGE_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const hailuo02I2vUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    filename: z.string().max(256).optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const ideogramImageUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_IDEOGRAM_IMAGE_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const grokImagineImageUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_GROK_IMAGINE_IMAGE_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const bananaInpaintOriginalUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_BANANA_INPAINT_ORIGINAL_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const bananaInpaintPaintedCompositeUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_BANANA_INPAINT_PAINTED_COMPOSITE_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const bananaInpaintAuxiliaryUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_BANANA_INPAINT_AUXILIARY_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const seedreamEditorOriginalUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_SEEDREAM_EDITOR_ORIGINAL_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();
const seedreamEditorDrawingUploadResponseSchema = z.object({
  files: z.array(z.object({
    id: providerIdSchema.optional(),
    file_id: providerIdSchema.optional(),
    url: z.string().min(1).max(MAX_URL_LENGTH),
    mime_type: z.string().max(128).optional(),
    size: z.number().int().nonnegative().max(MAX_SEEDREAM_EDITOR_DRAWING_UPLOAD_BYTES).optional(),
    status: z.string().regex(SAFE_RESPONSE_TOKEN).optional()
  }).strip()).length(1)
}).strip();


const inProgressEntrySchema = z
  .object({
    message_id: providerIdSchema,
    message_object_id: providerIdSchema.nullable(),
    object_type: z.string().regex(SAFE_RESPONSE_TOKEN),
    model_type: z.string().regex(SAFE_RESPONSE_TOKEN)
  })
  .strip();

const inProgressResponseSchema = z.array(inProgressEntrySchema).max(256);

const chatHistoryPaginationSchema = z.object({
  page: z.number().int().min(1).max(1),
  page_size: z.number().int().min(1).max(10),
  total_count: z.number().int().min(0).max(20),
  total_pages: z.number().int().min(0).max(20),
  has_next: z.boolean(),
  has_previous: z.boolean()
}).strip();
const chatHistoryObjectSchema = z.object({
  id: providerIdSchema,
  message_id: providerIdSchema,
  object_type: z.string().regex(SAFE_RESPONSE_TOKEN),
  model_type: z.string().regex(SAFE_RESPONSE_TOKEN).nullable().optional()
}).strip();
const chatHistoryRowSchema = z.object({
  id: providerIdSchema,
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(chatHistoryObjectSchema).max(64)
}).strip();
const chatHistoryResponseSchema = z.object({
  messages: z.array(chatHistoryRowSchema).max(20),
  pagination: chatHistoryPaginationSchema
}).strip();
const OWNER_SEEDREAM_EDITOR_HISTORY_MESSAGE_LIMIT = 64;
const ownerSeedreamEditorHistoryResponseSchema = z.object({
  messages: z.array(chatHistoryRowSchema).max(10),
  pagination: z.object({
    page: z.number().int().min(1).max(7),
    page_size: z.literal(10),
    total_count: z.number().int().min(0).max(OWNER_SEEDREAM_EDITOR_HISTORY_MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(7),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).strip()
}).strip();
const OWNER_WAN_T2V_HISTORY_MESSAGE_LIMIT = 64;
const OWNER_WAN_T2V_HISTORY_PAGE_SIZE = 10;
const OWNER_WAN_T2V_HISTORY_PAGE_LIMIT = Math.ceil(OWNER_WAN_T2V_HISTORY_MESSAGE_LIMIT / OWNER_WAN_T2V_HISTORY_PAGE_SIZE);
const ownerWanT2vHistoryResponseSchema = z.object({
  messages: z.array(chatHistoryRowSchema).max(OWNER_WAN_T2V_HISTORY_PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(OWNER_WAN_T2V_HISTORY_PAGE_LIMIT),
    page_size: z.literal(OWNER_WAN_T2V_HISTORY_PAGE_SIZE),
    total_count: z.number().int().min(0).max(OWNER_WAN_T2V_HISTORY_MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(OWNER_WAN_T2V_HISTORY_PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).strip()
}).strip();

export type SyntxChatScope = "text" | "image" | "video" | "audio";

export interface SyntxChatHttpClientOptions {
  credentialBroker: SyntxCredentialBroker;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  maxResponseBytes?: number;
}

export interface SyntxTextFileReference {
  object_type: "image" | "file";
  object_url: string;
}

export interface StartTextRequest {
  ai_name: string;
  chat_uuid: string;
  text: string;
  model: string;
  thinking?: boolean;
  plan?: boolean;
  deep_research?: boolean;
  files?: readonly SyntxTextFileReference[];
}

export interface StartImageRequest {
  ai_name: string;
  chat_uuid: string;
  prompt: string;
  settings: Readonly<Record<string, unknown>>;
}

export interface StartVideoRequest {
  ai_name: string;
  chat_id: string;
  prompt: string;
  settings: Readonly<Record<string, unknown>>;
}

export interface StartAudioRequest {
  ai_name: string;
  chat_uuid: string;
  prompt: string;
  settings: Readonly<Record<string, unknown>>;
}

export interface OwnerElevenLabsTtsChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsTtsModel;
  readonly voice_epoch: number;
  readonly expires_at: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly public_catalog_version: typeof OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateOwnerElevenLabsTtsChatInput {
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly permit: OwnerElevenLabsTtsOneShotPermit;
  readonly preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly oneShotPolicy: OwnerElevenLabsTtsOneShotPolicy;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface StartElevenLabsTtsWithOwnedCandidateInput extends CreateOwnerElevenLabsTtsChatInput {
  readonly chat: OwnerElevenLabsTtsChatContext;
}

export interface OwnerElevenLabsTtsAudioResultMessageContext extends OwnerElevenLabsAudioResultReadContext {
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_epoch: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly public_catalog_version: typeof OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION;
  readonly settings_inventory_version: typeof OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION;
}

export interface OwnerElevenLabsTtsMessageCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerElevenLabsTtsAudioResultMessageContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerElevenLabsDialogueChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly voice_epoch: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly profile_id: string;
  readonly source_profile_schema_hash: string;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateOwnerElevenLabsDialogueChatInput {
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly permit: OwnerElevenLabsDialogueOneShotPermit;
  readonly preparer: OwnerElevenLabsDialogueRequestPreparer;
  readonly oneShotPolicy: OwnerElevenLabsDialogueOneShotPolicy;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface StartOwnerElevenLabsDialogueWithOwnedCandidateInput extends CreateOwnerElevenLabsDialogueChatInput {
  readonly chat: OwnerElevenLabsDialogueChatContext;
}

export interface OwnerElevenLabsDialogueAudioResultMessageContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerElevenLabsDialogueModel;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly voice_epoch: number;
  readonly intent_fingerprint: string;
  readonly profile_schema_hash: string;
  readonly source_profile_schema_hash: string;
}

export interface OwnerElevenLabsDialogueMessageCandidates {
  readonly status: "PENDING" | "COMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH" | "UNKNOWN";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly history_get_calls: number;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerElevenLabsDialogueAudioResultMessageContext[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerElevenLabsDialogueResultObject {
  readonly object_index: number;
  readonly message_object_id: string;
  readonly object_type: "audio";
  readonly object_url: string;
}

export interface OwnerElevenLabsDialogueResult {
  readonly message_binding: "BOUND" | "UNVERIFIED";
  readonly model_echo: "MATCHED" | "UNKNOWN" | "MISMATCH";
  readonly objects: readonly OwnerElevenLabsDialogueResultObject[];
  readonly gaps: readonly string[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface OwnerSunoGenerationChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerSunoGenerationModel;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_pins: Readonly<OwnerSunoGenerationSourcePins>;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateOwnerSunoGenerationChatInput {
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly permit: OwnerSunoGenerationOneShotPermit;
  readonly preparer: OwnerSunoGenerationRequestPreparer;
  readonly oneShotPolicy: OwnerSunoGenerationOneShotPolicy;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface StartSunoWithOwnedCandidateInput extends CreateOwnerSunoGenerationChatInput {
  readonly chat: OwnerSunoGenerationChatContext;
}

export interface OwnerSunoGenerationResultMessageContext extends OwnerSunoAudioResultReadContext {
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_pins: Readonly<OwnerSunoGenerationSourcePins>;
}

export type OwnerSunoGenerationNativeGap =
  | "HISTORY_UNVERIFIED" | "HISTORY_INCOMPLETE" | "HISTORY_EMPTY" | "OWNER_ACK_MISSING"
  | "OWNER_ACK_MISMATCH" | "OWNER_ACK_AMBIGUOUS" | "BOT_RESULT_NOT_OBSERVED"
  | "AUDIO_OBJECT_IDS_INVALID" | "AUDIO_MODEL_ECHO_MISMATCH";

export interface OwnerSunoGenerationResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_binding_status: "BOUND" | "PARTIAL" | "UNVERIFIED";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerSunoGenerationResultMessageContext[];
  readonly gaps: readonly OwnerSunoGenerationNativeGap[];
  readonly backend_acceptance: "UNPROVEN";
}

/** A distinct imported owner context. It is not a generation or recovery context. */
export interface OwnerSunoExistingTrackChatContext {
  readonly status: "indexed";
  readonly source_kind: "EXISTING_OWNER_TRACK";
  readonly chat_uuid: string;
  readonly provider_chat_id: string;
  readonly title_family: OwnerSunoExistingTrackTitleFamily;
  readonly index_page: number;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
}

/** Internal bounded history summary with native result contexts; contains no prompt values or audio URLs. */
export interface OwnerSunoExistingTrackCandidates {
  readonly status: "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string;
  readonly contexts: readonly OwnerSunoExistingTrackResultMessageContext[];
  readonly gaps: readonly OwnerSunoExistingTrackGap[];
}

export interface OwnerSunoExistingTrackChatPage {
  readonly page: number;
  readonly page_size: typeof OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE;
  readonly total_count: number;
  readonly total_pages: number;
  readonly has_next: boolean;
  readonly has_previous: boolean;
  readonly chats: readonly OwnerSunoExistingTrackChatContext[];
}

export type OwnerSunoExistingTrackGap =
  | "HISTORY_UNVERIFIED" | "OWNER_ACK_MISSING" | "OWNER_ACK_AMBIGUOUS"
  | "BOT_RESULT_MISSING" | "BOT_RESULT_AMBIGUOUS" | "AUDIO_OBJECT_UNVERIFIED";

export interface OwnerSunoExistingTrackResultMessageContext extends OwnerSunoExistingTrackResultContextFields {}

export interface OwnerSunoExistingTrackVerifiedResult {
  readonly audio_result: OwnerSunoAudioResult;
  readonly artifacts: readonly Readonly<OwnerSunoExistingTrackMetadata>[];
}

export class OwnerSunoExistingTrackNativeError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "REQUEST_ABORTED" | "INDEX_UNVERIFIED" | "INDEX_GET_FAILED" |
    "CHAT_CONTEXT_INVALID" | "HISTORY_UNVERIFIED" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_FAILED" |
    "RESULT_UNVERIFIED" | "CAPACITY_EXCEEDED") {
    super("The existing owner Suno track could not be read safely.");
    this.name = "OwnerSunoExistingTrackNativeError";
  }
}

/** A separate native capability for one source-bound Cover or Extend request. */
export interface OwnerSunoTrackOperationChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: OwnerSunoTrackOperationModel;
  readonly mode: OwnerSunoTrackOperationMode;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_pins: Readonly<OwnerSunoTrackOperationSourcePins>;
  readonly track_context_fingerprint: string;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateOwnerSunoTrackOperationChatInput {
  readonly candidate: OwnerSunoTrackOperationPreparedCandidate;
  readonly permit: OwnerSunoTrackOperationOneShotPermit;
  readonly preparer: OwnerSunoTrackOperationRequestPreparer;
  readonly oneShotPolicy: OwnerSunoTrackOperationOneShotPolicy;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface StartSunoTrackOperationWithOwnedCandidateInput extends CreateOwnerSunoTrackOperationChatInput {
  readonly chat: OwnerSunoTrackOperationChatContext;
}

export interface OwnerSunoTrackOperationResultMessageContext extends OwnerSunoAudioResultReadContext {
  readonly owner_echo_message_id: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly intent_fingerprint: string;
  readonly source_profile_schema_hash: string;
  readonly source_pins: Readonly<OwnerSunoTrackOperationSourcePins>;
  readonly track_context_fingerprint: string;
  readonly mode: OwnerSunoTrackOperationMode;
}

export type OwnerSunoTrackOperationNativeGap = OwnerSunoGenerationNativeGap | "BOT_ERROR_OBSERVED";

export interface OwnerSunoTrackOperationResultCandidates {
  readonly status: OwnerSunoGenerationResultCandidates["status"];
  readonly owner_ack_status: OwnerSunoGenerationResultCandidates["owner_ack_status"];
  readonly history_binding_status: OwnerSunoGenerationResultCandidates["history_binding_status"];
  readonly history_page_status: OwnerSunoGenerationResultCandidates["history_page_status"];
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerSunoTrackOperationResultMessageContext[];
  readonly gaps: readonly OwnerSunoTrackOperationNativeGap[];
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateChatReceipt {
  chat_uuid: string;
}

export interface ChatMutationReceipt {
  chat_uuid: string;
  accepted: true;
}

export interface CancelMessageReceipt extends ChatMutationReceipt {
  message_id: string;
}

export interface TextGenerationReceipt {
  chat_uuid: string;
  provider_job_id: string;
  message_id: string;
}

export interface MediaGenerationReceipt {
  chat_uuid: string;
  message_id: string;
}

export interface OwnerVideo2AudioChatContext {
  readonly status: "created";
  readonly chat_uuid: string;
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly model_id: "video2audio";
  readonly source_profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly request_fingerprint: string;
  readonly original_sha256: string;
  readonly original_size: number;
  readonly duration_seconds: number;
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}

export interface CreateVideo2AudioChatInput {
  readonly preparer: OwnerVideo2AudioRequestPreparer;
  readonly candidate: OwnerVideo2AudioPreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}

export interface StartVideo2AudioWithOwnedCandidateInput extends CreateVideo2AudioChatInput {
  readonly permit: OwnerVideo2AudioOneShotPermit;
  readonly chat: OwnerVideo2AudioChatContext;
}

export interface OwnerVideo2AudioResultMessageContext extends OwnerVideo2AudioResultReadContext {
  readonly attempt_id: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly source_profile_schema_hash: string;
  readonly intent_fingerprint: string;
  readonly original_sha256: string;
}

export type OwnerVideo2AudioNativeGap =
  | OwnerVideo2AudioHistoryGapCode | "POST_ACK_UNKNOWN" | "HISTORY_UNAVAILABLE" | "HISTORY_PAGE_INVALID"
  | "HISTORY_PAGE_LIMIT" | "RESULT_CONTEXT_INVALID";

export interface OwnerVideo2AudioResultCandidates {
  readonly status: "PENDING" | "COMPLETE" | "INCOMPLETE" | "UNVERIFIED";
  readonly owner_ack_status: "MATCHED" | "MISSING" | "AMBIGUOUS" | "MISMATCH";
  readonly history_page_status: "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
  readonly history_get_calls: number;
  readonly total_count: number | null;
  readonly total_pages: number | null;
  readonly provider_chat_id: string | null;
  readonly owner_echo_message_id: string | null;
  readonly contexts: readonly OwnerVideo2AudioResultMessageContext[];
  readonly gaps: readonly OwnerVideo2AudioNativeGap[];
  readonly backend_acceptance: "UNPROVEN";
}

export type OwnerVideo2AudioAuthorizeGet = (signal?: AbortSignal) => Promise<void>;
export interface ListOwnedVideo2AudioResultCandidatesInput {
  readonly chat: OwnerVideo2AudioChatContext;
  readonly authorizeGet: OwnerVideo2AudioAuthorizeGet;
}
export interface GetOwnedVideo2AudioResultInput {
  readonly context: OwnerVideo2AudioResultMessageContext;
  readonly authorizeGet: OwnerVideo2AudioAuthorizeGet;
}

export type OwnerVideo2AudioNativeErrorCode =
  | "INVALID_REQUEST" | "REQUEST_ABORTED" | "CAPACITY_EXCEEDED" | "CHAT_CREATE_UNKNOWN" | "CHAT_CONTEXT_INVALID"
  | "CHAT_NOT_DISPATCHED" | "CHAT_ALREADY_CREATED" | "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID"
  | "OUTCOME_UNKNOWN" | "HISTORY_UNAVAILABLE" | "GET_AUTHORIZATION_FAILED" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_UNAVAILABLE";

export class OwnerVideo2AudioNativeError extends Error {
  constructor(readonly code: OwnerVideo2AudioNativeErrorCode) {
    super(code === "OUTCOME_UNKNOWN"
      ? "The Video2Audio request may have been dispatched; reconcile the same native chat and do not retry."
      : "The native Video2Audio operation could not be completed safely.");
    this.name = "OwnerVideo2AudioNativeError";
  }
}

export type SyntxUploadDestination = "uploaded" | "hidden";
export interface UploadFileRequest {
  bytes: Uint8Array;
  filename: string;
  mime_type: string;
  destination: SyntxUploadDestination;
  check_duplicates: true;
  model_type: string;
}
export interface OwnerVideo2AudioOriginalReference {
  readonly status: "OWNER_VIDEO2AUDIO_ORIGINAL_UPLOADED";
  readonly profile_schema_hash: string;
  readonly sha256: string;
  readonly mime_type: "video/mp4";
  readonly size: number;
  readonly duration_seconds: number;
}
export interface OwnerVideo2AudioOriginalReferenceDetails extends OwnerVideo2AudioOriginalReference {
  readonly url: string;
}
export interface BananaInpaintAuxiliaryImageUploadRequest {
  readonly variant: OwnerBananaInpaintAuxiliaryVariant;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerBananaInpaintAuxiliaryCanonicalMimeType;
}
export interface ClarityUpscaleImageUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerClarityImageMimeType;
}
export interface MagnificUpscaleImageUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerMagnificUpscaleImageMimeType;
  readonly model_type: "creative" | "precision_v1" | "precision_v2";
}
/** A canonical, structurally validated single Kontext image; the client consumes and zeroes the provided bytes. */
export interface KontextImageUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerKontextCanonicalImageMimeType;
  readonly model_type: "flux-kontext-pro" | "flux-kontext-max" | "flux-kontext-multi";
}
/** Internal WAN upload bridge; bytes must be structurally valid for the exact selected WAN variant. */
export interface WanImageUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerWanCanonicalImageMimeType;
  readonly model_type: OwnerWanImageVariant;
}
export interface StandardImageReferenceUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly variant: OwnerStandardImageInputVariant;
}
export interface RunwayImageReferenceUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly variant: "runway_frames";
}
export interface FluxImageReferenceUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly variant: "flux-1";
}
export interface GrokImagineImageReferenceUploadRequest {
  readonly model_id: OwnerGrokT2iImageModelId;
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerGrokT2iImageSourceMimeType;
}
export interface IdeogramImageReferenceUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly model_id: OwnerIdeogramImageModelId;
}
/** One canonical local mask PNG variant; role/polarity are bound by the owning application service. */
export interface IdeogramPaintedMaskVariantUploadRequest {
  readonly bytes: Buffer;
  readonly filename: string;
}
export interface SeedreamImageReferenceUploadRequest {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: string;
  readonly variant: OwnerSeedreamImageVariant;
}
export interface StartMagnificUpscaleWithOwnedCandidateInput {
  readonly candidate: OwnerMagnificUpscalePreparedCandidate;
  readonly permit: OwnerMagnificUpscaleOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartKontextImageWithOwnedCandidateInput {
  readonly candidate: OwnerKontextImagePreparedCandidate;
  readonly permit: OwnerKontextImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartWanImageWithOwnedCandidateInput {
  readonly candidate: OwnerWanImagePreparedCandidate;
  readonly permit: OwnerWanImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartStandardImageWithOwnedCandidateInput {
  readonly candidate: OwnerStandardImagePreparedCandidate;
  readonly permit: OwnerStandardImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartRunwayImageWithOwnedCandidateInput {
  readonly candidate: OwnerRunwayImagePreparedCandidate;
  readonly permit: OwnerRunwayImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartSeedreamImageWithOwnedCandidateInput {
  readonly candidate: OwnerSeedreamImagePreparedCandidate;
  readonly permit: OwnerSeedreamImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartFluxImageWithOwnedCandidateInput {
  readonly candidate: OwnerFluxImagePreparedCandidate;
  readonly permit: OwnerFluxImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartIdeogramImageWithOwnedCandidateInput {
  readonly candidate: OwnerIdeogramImagePreparedCandidate;
  readonly permit: OwnerIdeogramImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartBananaInpaintImageWithOwnedCandidateInput {
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly permit: OwnerBananaInpaintImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface ListBananaInpaintImageResultCandidatesInput {
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartSeedreamEditorImageWithOwnedCandidateInput {
  readonly preparer: OwnerSeedreamEditorImageRequestPreparer;
  readonly candidate: OwnerSeedreamEditorImagePreparedCandidate;
  readonly permit: OwnerSeedreamEditorImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface ListSeedreamEditorImageResultCandidatesInput {
  readonly preparer: OwnerSeedreamEditorImageRequestPreparer;
  readonly candidate: OwnerSeedreamEditorImagePreparedCandidate;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
/** Client-minted evidence that this exact Editor chat crossed the native one-shot POST boundary. */
export interface OwnerSeedreamEditorImagePostDispatchWitness {
  readonly status: "POST_DISPATCH_WITNESS";
  readonly dispatch_allowed: false;
  readonly backend_acceptance: "UNPROVEN";
}
export interface OwnerSeedreamEditorImageResultMessageContext extends OwnerSeedreamEditorImageResultReadContext {
  readonly owner_echo_message_id?: string;
}
export type OwnerSeedreamEditorImageNativeGap =
  | "POST_OUTCOME_UNKNOWN" | "OWNER_ACK_UNAVAILABLE" | "IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ"
  | "IN_PROGRESS_DUPLICATE_MESSAGE_ID" | "HISTORY_SHAPE_UNVERIFIED" | "HISTORY_READ_INCOMPLETE"
  | "HISTORY_METADATA_MISMATCH" | "HISTORY_CHAT_ID_MISMATCH" | "HISTORY_MESSAGE_ID_INVALID"
  | "HISTORY_UNEXPECTED_OWNER_MESSAGE"
  | "HISTORY_OBJECT_ID_INVALID" | "HISTORY_EMPTY" | "HISTORY_BINDING_PENDING" | "HISTORY_BINDING_INVALID"
  | "HISTORY_LOCAL_LIMIT" | "BOT_RESULT_NOT_OBSERVED";
export type OwnerSeedreamEditorImageNativeBindingStatus = "BOUND" | "PARTIAL" | "UNVERIFIED";
export type OwnerSeedreamEditorImageNativeHistoryPageStatus = "NOT_READ" | "COMPLETE" | "INCOMPLETE" | "UNPROVEN";
export interface OwnerSeedreamEditorImageResultCandidates {
  readonly chat_uuid: string;
  readonly candidate_source: "IN_PROGRESS" | "HISTORY";
  readonly owner_echo_message_id?: string;
  readonly history_binding_status: OwnerSeedreamEditorImageNativeBindingStatus;
  readonly history_page_status: OwnerSeedreamEditorImageNativeHistoryPageStatus;
  readonly gaps: readonly OwnerSeedreamEditorImageNativeGap[];
  readonly contexts: readonly OwnerSeedreamEditorImageResultMessageContext[];
}
export type OwnerBananaInpaintImageHistoryBindingStatus = "BOUND" | "PARTIAL" | "UNVERIFIED";
export type OwnerBananaInpaintImageHistoryPageStatus = "NOT_READ" | "COMPLETE" | "MORE_PAGES" | "UNPROVEN";
export type OwnerBananaInpaintImageHistoryGap =
  | "IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ" | "IN_PROGRESS_DUPLICATE_MESSAGE_ID"
  | "HISTORY_SHAPE_UNVERIFIED" | "HISTORY_CHAT_ID_MISMATCH" | "HISTORY_MESSAGE_ID_INVALID"
  | "HISTORY_OBJECT_ID_INVALID" | "HISTORY_EMPTY" | "HISTORY_HAS_MORE_PAGES"
  | "ACK_MESSAGE_NOT_FOUND" | "ACK_MESSAGE_NOT_IN_FIRST_PAGE" | "ACK_AUTHOR_UNBOUND" | "BOT_RESULT_NOT_OBSERVED"
  | "POST_OUTCOME_UNKNOWN" | "OWNER_ACK_ID_UNAVAILABLE";
export interface OwnerBananaInpaintImageResultMessageContext extends OwnerBananaInpaintImageResultReadContext {
  readonly owner_echo_message_id?: string;
  readonly message_object_ids: readonly string[];
}
export interface OwnerBananaInpaintImageResultCandidates {
  readonly chat_uuid: string;
  readonly candidate_source: "IN_PROGRESS" | "HISTORY";
  readonly owner_echo_message_id?: string;
  readonly history_binding_status: OwnerBananaInpaintImageHistoryBindingStatus;
  readonly history_page_status: OwnerBananaInpaintImageHistoryPageStatus;
  readonly gaps: readonly OwnerBananaInpaintImageHistoryGap[];
  readonly contexts: readonly OwnerBananaInpaintImageResultMessageContext[];
}
export interface StartGrokT2iImageWithOwnedCandidateInput {
  readonly preparer: OwnerGrokT2iRequestPreparer;
  readonly candidate: OwnerGrokT2iPreparedCandidate;
  readonly permit: OwnerGrokT2iOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartUniImageWithOwnedCandidateInput {
  readonly preparer: OwnerUniImageRequestPreparer;
  readonly candidate: OwnerUniImagePreparedCandidate;
  readonly permit: OwnerUniImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartSoulImageWithOwnedCandidateInput {
  readonly preparer: OwnerSoulImageRequestPreparer;
  readonly candidate: OwnerSoulImagePreparedCandidate;
  readonly permit: OwnerSoulImageOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface StartWanT2iImageWithOwnedCandidateInput {
  readonly preparer: OwnerWanT2iRequestPreparer;
  readonly candidate: OwnerWanT2iPreparedCandidate;
  readonly permit: OwnerWanT2iOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}
export interface FluxImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerFluxImageModel;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string];
}
export interface MagnificUpscaleResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerMagnificUpscaleVariant;
  readonly provider_chat_id: string;
  readonly message_object_id: string;
}
export interface KontextImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerKontextImageVariant;
  readonly provider_chat_id: string;
  readonly message_object_id: string;
}
export interface WanImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerWanImageVariant;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly requested_batch_size: number;
}
export interface StandardImageResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly variant: OwnerStandardImageVariant;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly [string];
}
export type { InternalRunwayImageResult, RunwayImageResultReadContext } from "./runway-image-result.js";
export type { InternalSeedreamImageResult, SeedreamImageResultReadContext } from "./seedream-image-result.js";
export type { InternalOwnerFluxImageResult, OwnerFluxImageResultReadContext } from "./flux-image-result.js";
export type { InternalOwnerIdeogramImageResult, OwnerIdeogramImageResultReadContext } from "./ideogram-image-result.js";
export type { InternalOwnerUniImageResult, OwnerUniImageResultReadContext } from "./owner-uni-image-result.js";
export type StandardImageResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED";
export type StandardImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH" | "NOT_BOT_MESSAGE"
  | "RESULT_OBJECT_CARDINALITY_INVALID" | "RESULT_OBJECT_SHAPE_INVALID" | "OBJECT_ID_MISMATCH"
  | "OBJECT_MESSAGE_MISMATCH" | "OBJECT_TYPE_MISMATCH" | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH"
  | "RESULT_URL_UNSAFE";
export interface InternalStandardImageResultArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: OwnerStandardImageVariant;
  readonly completed: true;
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}
export type InternalStandardImageResult =
  | (StandardImageResultReadContext & Readonly<{
      status: "COMPLETE"; model_type: OwnerStandardImageVariant; completed: true;
      artifact: InternalStandardImageResultArtifact;
    }>)
  | (StandardImageResultReadContext & Readonly<{ status: "PENDING"; reason: StandardImageResultPendingReason }>)
  | (StandardImageResultReadContext & Readonly<{ status: "UNVERIFIED"; reason: StandardImageResultUnverifiedReason }>);
export type WanImageResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED" | "RESULT_BATCH_PENDING";
export type WanImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID"
  | "OUTER_MESSAGE_MISMATCH"
  | "PROVIDER_CHAT_MISMATCH"
  | "NOT_BOT_MESSAGE"
  | "RESULT_OBJECT_CARDINALITY_INVALID"
  | "RESULT_OBJECT_SHAPE_INVALID"
  | "OBJECT_ID_MISMATCH"
  | "OBJECT_MESSAGE_MISMATCH"
  | "OBJECT_TYPE_MISMATCH"
  | "MODEL_TYPE_UNAVAILABLE"
  | "MODEL_TYPE_MISMATCH"
  | "RESULT_URL_UNSAFE"
  | "RESULT_OBJECT_DUPLICATE";
export interface InternalWanImageResultArtifact {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: OwnerWanImageVariant;
  readonly completed: true;
  readonly url: string;
  readonly mime_type: string | null;
  readonly mime_source: "URL_EXTENSION" | "UNKNOWN";
}
export type InternalWanImageResult =
  | (WanImageResultReadContext & Readonly<{
      status: "COMPLETE";
      model_type: OwnerWanImageVariant;
      completed: true;
      artifacts: readonly InternalWanImageResultArtifact[];
    }>)
  | (WanImageResultReadContext & Readonly<{
      status: "PENDING";
      reason: WanImageResultPendingReason;
    }>)
  | (WanImageResultReadContext & Readonly<{
      status: "UNVERIFIED";
      reason: WanImageResultUnverifiedReason;
    }>);
export type KontextImageResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED";
export type KontextImageResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID"
  | "OUTER_MESSAGE_MISMATCH"
  | "PROVIDER_CHAT_MISMATCH"
  | "NOT_BOT_MESSAGE"
  | "RESULT_OBJECT_CARDINALITY_INVALID"
  | "RESULT_OBJECT_SHAPE_INVALID"
  | "OBJECT_ID_MISMATCH"
  | "OBJECT_MESSAGE_MISMATCH"
  | "OBJECT_TYPE_MISMATCH"
  | "MODEL_TYPE_UNAVAILABLE"
  | "MODEL_TYPE_MISMATCH"
  | "RESULT_URL_UNSAFE"
  | "RESULT_MIME_UNKNOWN";
export type InternalKontextImageResult =
  | (KontextImageResultReadContext & Readonly<{
      status: "COMPLETE";
      model_type: OwnerKontextImageVariant;
      completed: true;
      artifact: Readonly<{ url: string; mime_type: string; mime_source: "URL_EXTENSION" }>;
    }>)
  | (KontextImageResultReadContext & Readonly<{
      status: "PENDING";
      reason: KontextImageResultPendingReason;
    }>)
  | (KontextImageResultReadContext & Readonly<{
      status: "UNVERIFIED";
      reason: KontextImageResultUnverifiedReason;
      model_eq_requested?: boolean;
      model_eq_family?: boolean;
    }>);
export type MagnificUpscaleResultPendingReason = "NO_RESULT_OBJECTS" | "RESULT_NOT_COMPLETED";
export type MagnificUpscaleResultUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID"
  | "OUTER_MESSAGE_MISMATCH"
  | "PROVIDER_CHAT_MISMATCH"
  | "NOT_BOT_MESSAGE"
  | "RESULT_OBJECT_CARDINALITY_INVALID"
  | "RESULT_OBJECT_SHAPE_INVALID"
  | "OBJECT_ID_MISMATCH"
  | "OBJECT_MESSAGE_MISMATCH"
  | "OBJECT_TYPE_MISMATCH"
  | "MODEL_TYPE_UNAVAILABLE"
  | "MODEL_TYPE_MISMATCH"
  | "RESULT_URL_UNSAFE"
  | "RESULT_MIME_UNKNOWN";
export type InternalMagnificUpscaleResult =
  | (MagnificUpscaleResultReadContext & Readonly<{
      status: "COMPLETE";
      model_type: OwnerMagnificUpscaleVariant;
      completed: true;
      artifact: Readonly<{ url: string; mime_type: string; mime_source: "URL_EXTENSION" }>;
    }>)
  | (MagnificUpscaleResultReadContext & Readonly<{
      status: "PENDING";
      reason: MagnificUpscaleResultPendingReason;
    }>)
  | (MagnificUpscaleResultReadContext & Readonly<{
      status: "UNVERIFIED";
      reason: MagnificUpscaleResultUnverifiedReason;
      model_eq_requested?: boolean;
      model_eq_family?: boolean;
    }>);
export interface UploadFileReceipt {
  file_id: string | null;
  filename?: string;
  mime_type?: string;
  type?: string;
  size: number;
  status: string;
}

export interface InProgressMessage {
  message_id: string;
  message_object_id: string | null;
  object_type: string;
  model_type: string;
}

export interface ChatMessageHistoryObject {
  message_object_id: string;
  object_type: string;
  model_type: string | null;
}

export interface ChatMessageHistoryCandidate {
  message_id: string;
  provider_chat_id: string;
  author_role: "owner" | "bot" | "other";
  objects: readonly ChatMessageHistoryObject[];
}

export interface ChatMessageHistorySnapshot {
  complete: true;
  page: 1;
  page_size: 10;
  total_count: number;
  total_pages: number;
  has_next: false;
  has_previous: boolean;
  /** Exact requested chat UUID/path scope; separate from provider numeric chat_id. */
  requested_chat_uuid?: string;
  provider_chat_id: string;
  messages: readonly ChatMessageHistoryCandidate[];
}

export interface SafeArtifactMetadata {
  url: string;
  mime_type?: string;
  byte_size?: number;
  width?: number;
  height?: number;
  duration_seconds?: number;
}

export interface RedactedMessageEnvelope {
  chat_uuid: string;
  message_id: string;
  message_object_id?: string;
  object_type?: string;
  model_type?: string;
  status?: string;
  artifacts: SafeArtifactMetadata[];
}

export type GrokImageModelType = "grok_i2i" | "grok_i2i_pro";
export type GrokImageBatchUnverifiedReason =
  | "NOT_BOT_MESSAGE"
  | "NO_IMAGE_OBJECTS"
  | "RESULT_COUNT_OUT_OF_RANGE"
  | "RESULT_OBJECT_INCOMPLETE"
  | "RESULT_OBJECT_MISMATCH"
  | "RESULT_OBJECT_DUPLICATE"
  | "RESULT_URL_UNSAFE"
  | "RESULT_MIME_UNKNOWN";

export type ClarityUpscaleResultUnverifiedReason =
  | "OUTER_MESSAGE_MISMATCH"
  | "NOT_BOT_MESSAGE"
  | "NO_IMAGE_OBJECTS"
  | "RESULT_COUNT_OUT_OF_RANGE"
  | "RESULT_OBJECT_INCOMPLETE"
  | "RESULT_OBJECT_MISMATCH"
  | "RESULT_URL_UNSAFE"
  | "RESULT_MIME_UNKNOWN";

/** Private exact-result decoder output; MIME is inferred from the object URL extension only. */
export type InternalClarityUpscaleResult =
  | Readonly<{
      status: "COMPLETE";
      chat_uuid: string;
      message_id: string;
      message_object_id: string;
      object_type: "image";
      model_type: "clarity";
      completed: true;
      artifact: Readonly<{ url: string; mime_type: string; mime_source: "URL_EXTENSION" }>;
    }>
  | Readonly<{
      status: "UNVERIFIED";
      chat_uuid: string;
      message_id: string;
      model_type: "clarity";
      reason: ClarityUpscaleResultUnverifiedReason;
      objects: readonly [];
    }>;

export interface StartClarityUpscaleWithOwnedCandidateInput {
  readonly candidate: OwnerClarityUpscalePreparedCandidate;
  readonly permit: OwnerClarityUpscaleOneShotPermit;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
  readonly chat_uuid: string;
}

/** Private decoder output. MIME is inferred from the safe URL extension, not provider headers or bytes. */
export interface InternalGrokImageBatchObject {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_type: GrokImageModelType;
  readonly completed: true;
  readonly object_url: string;
  readonly mime_type: string;
  readonly mime_source: "URL_EXTENSION";
}

export type InternalGrokImageBatchEnvelope =
  | {
      readonly status: "COMPLETE";
      readonly chat_uuid: string;
      readonly message_id: string;
      readonly model_type: GrokImageModelType;
      readonly objects: readonly InternalGrokImageBatchObject[];
    }
  | {
      readonly status: "UNVERIFIED";
      readonly chat_uuid: string;
      readonly message_id: string;
      readonly model_type: GrokImageModelType;
      readonly reason: GrokImageBatchUnverifiedReason;
      readonly objects: readonly [];
    };

export interface GrokT2iImageBatchResultReadContext {
  readonly chat_uuid: string;
  readonly message_id: string;
  readonly model_id: OwnerGrokT2iModel;
  readonly provider_chat_id: string;
  readonly message_object_ids: readonly string[];
  readonly requested_batch_size: number;
}

export type GrokT2iImageBatchPendingReason = "NO_IMAGE_OBJECTS" | "RESULT_OBJECTS_PENDING";
export type GrokT2iImageBatchUnverifiedReason =
  | "RESPONSE_SHAPE_INVALID" | "OUTER_MESSAGE_MISMATCH" | "PROVIDER_CHAT_MISMATCH" | "NOT_BOT_MESSAGE"
  | "OUTPUT_COUNT_INVALID" | "RESULT_OBJECT_SHAPE_INVALID" | "OBJECT_ID_MISMATCH" | "OBJECT_MESSAGE_MISMATCH"
  | "OBJECT_TYPE_MISMATCH" | "MODEL_TYPE_UNAVAILABLE" | "MODEL_TYPE_MISMATCH" | "RESULT_URL_UNSAFE"
  | "RESULT_MIME_UNKNOWN" | "RESULT_OBJECT_DUPLICATE";

export interface InternalGrokT2iImageBatchObject {
  readonly message_object_id: string;
  readonly message_id: string;
  readonly object_type: "image";
  readonly model_id: OwnerGrokT2iModel;
  readonly completed: true;
  readonly object_url: string;
  readonly mime_type: string;
  readonly mime_source: "URL_EXTENSION";
  readonly width: null;
  readonly height: null;
  readonly geometry_verified: false;
}

interface GrokT2iImageResultProvenance {
  readonly namespace_confidence: "SOURCE_SHAPED_UNVERIFIED";
  readonly backend_acceptance: "UNPROVEN";
}

interface GrokT2iImageResultContext extends GrokT2iImageBatchResultReadContext {}

export type InternalGrokT2iImageBatchResult = GrokT2iImageResultProvenance & GrokT2iImageResultContext & (
  | Readonly<{ status: "PENDING"; reason: GrokT2iImageBatchPendingReason }>
  | Readonly<{ status: "UNVERIFIED"; reason: GrokT2iImageBatchUnverifiedReason }>
  | Readonly<{ status: "COMPLETE"; actual_result_count: number; batch_count_matches_requested: true; objects: readonly InternalGrokT2iImageBatchObject[] }>
  | Readonly<{ status: "PARTIAL"; actual_result_count: number; batch_count_matches_requested: false; objects: readonly InternalGrokT2iImageBatchObject[] }>
);

type JsonScalar = string | number | boolean | null;
type JsonValue = JsonScalar | JsonValue[] | { [key: string]: JsonValue };
type ResponseMode = "JSON_REQUIRED" | "ACK";

type OwnerBananaInpaintChatPhase = "AVAILABLE" | "RESERVED" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED" | "DELETED";
interface OwnerBananaInpaintStartReservation {
  readonly preparer: OwnerBananaInpaintImageRequestPreparer;
  readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly request_fingerprint: string;
}
interface OwnerBananaInpaintChatState {
  readonly chat_uuid: string;
  phase: OwnerBananaInpaintChatPhase;
  reservation?: Readonly<OwnerBananaInpaintStartReservation>;
  started?: Readonly<{
    readonly preparer: OwnerBananaInpaintImageRequestPreparer;
    readonly candidate: OwnerBananaInpaintImagePreparedCandidate;
    readonly principal: Readonly<GenerationPrincipalRef>;
    readonly attemptId: string;
    readonly request_fingerprint: string;
    readonly owner_echo_message_id: string;
  }>;
}
const OWNER_BANANA_INPAINT_CHAT_LIMIT = 128;
const ownerBananaInpaintChats = new WeakMap<object, Map<string, OwnerBananaInpaintChatState>>();
interface OwnerBananaInpaintResultContextState {
  readonly client: object;
  readonly context: OwnerBananaInpaintImageResultMessageContext;
  readonly chat: OwnerBananaInpaintChatState;
  readonly operation: Readonly<OwnerBananaInpaintStartReservation>;
}
const ownerBananaInpaintResultContexts = new WeakMap<object, OwnerBananaInpaintResultContextState>();
type OwnerSeedreamEditorChatPhase = "AVAILABLE" | "RESERVED" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED" | "DELETED";
interface OwnerSeedreamEditorStartReservation {
  readonly preparer: OwnerSeedreamEditorImageRequestPreparer;
  readonly candidate: OwnerSeedreamEditorImagePreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
  readonly binding: Readonly<OwnerSeedreamEditorImageCandidateBinding>;
  readonly request_fingerprint: string;
}
interface OwnerSeedreamEditorChatState {
  readonly chat_uuid: string;
  readonly attemptId?: string;
  phase: OwnerSeedreamEditorChatPhase;
  epoch: number;
  reservation?: Readonly<OwnerSeedreamEditorStartReservation>;
  started?: Readonly<OwnerSeedreamEditorStartReservation & { owner_echo_message_id: string }>;
  recoveryWitness?: OwnerSeedreamEditorImagePostDispatchWitness;
}
const OWNER_SEEDREAM_EDITOR_CHAT_LIMIT = 128;
const ownerSeedreamEditorChats = new WeakMap<object, Map<string, OwnerSeedreamEditorChatState>>();
interface OwnerSeedreamEditorPostDispatchWitnessState {
  readonly client: object; readonly chat: OwnerSeedreamEditorChatState;
  readonly operation: Readonly<OwnerSeedreamEditorStartReservation>; readonly epoch: number;
}
const ownerSeedreamEditorPostDispatchWitnesses = new WeakMap<object, OwnerSeedreamEditorPostDispatchWitnessState>();
interface OwnerSeedreamEditorResultContextState {
  readonly client: object;
  readonly context: OwnerSeedreamEditorImageResultMessageContext;
  readonly chat: OwnerSeedreamEditorChatState;
  readonly operation: Readonly<OwnerSeedreamEditorStartReservation>;
  readonly binding: Readonly<OwnerSeedreamEditorImageCandidateBinding>;
  readonly epoch: number;
  readonly witness?: OwnerSeedreamEditorImagePostDispatchWitness;
}
const ownerSeedreamEditorResultContexts = new WeakMap<object, OwnerSeedreamEditorResultContextState>();

type OwnerElevenLabsTtsChatPhase = "AVAILABLE" | "RESERVED" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface OwnerElevenLabsTtsStartInput {
  readonly candidate: OwnerElevenLabsTtsPreparedCandidate;
  readonly permit: OwnerElevenLabsTtsOneShotPermit;
  readonly preparer: OwnerElevenLabsTtsRequestPreparer;
  readonly oneShotPolicy: OwnerElevenLabsTtsOneShotPolicy;
  readonly principal: GenerationPrincipalRef;
  readonly attemptId: string;
}
interface OwnerElevenLabsTtsChatState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerElevenLabsTtsChatContext;
  readonly operation: Readonly<OwnerElevenLabsTtsStartInput>;
  readonly modelId: OwnerElevenLabsTtsModel;
  phase: OwnerElevenLabsTtsChatPhase;
  ownerEchoMessageId?: string;
  privatePrompt?: string;
  readonly resultContexts: Map<string, OwnerElevenLabsTtsAudioResultMessageContext>;
}
interface OwnerElevenLabsTtsResultContextState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerElevenLabsTtsChatState;
  readonly context: OwnerElevenLabsTtsAudioResultMessageContext;
}
type OwnerElevenLabsDialogueChatPhase = "AVAILABLE" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface OwnerElevenLabsDialogueStartInput {
  readonly candidate: OwnerElevenLabsDialoguePreparedCandidate;
  readonly permit: OwnerElevenLabsDialogueOneShotPermit;
  readonly preparer: OwnerElevenLabsDialogueRequestPreparer;
  readonly oneShotPolicy: OwnerElevenLabsDialogueOneShotPolicy;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
}
interface OwnerElevenLabsDialogueChatState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerElevenLabsDialogueChatContext;
  readonly operation: Readonly<OwnerElevenLabsDialogueStartInput>;
  readonly modelId: OwnerElevenLabsDialogueModel;
  phase: OwnerElevenLabsDialogueChatPhase;
  ownerEchoMessageId?: string;
  readonly resultContexts: Map<string, OwnerElevenLabsDialogueAudioResultMessageContext>;
}
interface OwnerElevenLabsDialogueResultContextState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerElevenLabsDialogueChatState;
  readonly context: OwnerElevenLabsDialogueAudioResultMessageContext;
}
const OWNER_ELEVENLABS_TTS_CHAT_LIMIT = 128;
const OWNER_ELEVENLABS_TTS_HISTORY_MESSAGE_LIMIT = 64;
const OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE = 10;
const OWNER_ELEVENLABS_TTS_HISTORY_PAGE_LIMIT = Math.ceil(OWNER_ELEVENLABS_TTS_HISTORY_MESSAGE_LIMIT / OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE);
const OWNER_ELEVENLABS_TTS_MODELS = new Set<string>(OWNER_ELEVENLABS_TTS_MODEL_IDS);
const OWNER_ELEVENLABS_TTS_CHATS = new WeakMap<object, Map<string, OwnerElevenLabsTtsChatState>>();
const OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS = new WeakMap<object, OwnerElevenLabsTtsChatState>();
const OWNER_ELEVENLABS_TTS_CHAT_BY_PERMIT = new WeakMap<object, OwnerElevenLabsTtsChatState>();
const OWNER_ELEVENLABS_TTS_RESULT_CONTEXTS = new WeakMap<object, OwnerElevenLabsTtsResultContextState>();
const OWNER_ELEVENLABS_DIALOGUE_CHAT_LIMIT = 128;
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_MESSAGE_LIMIT = 64;
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE = 10;
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_LIMIT = Math.ceil(
  OWNER_ELEVENLABS_DIALOGUE_HISTORY_MESSAGE_LIMIT / OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE
);
const OWNER_ELEVENLABS_DIALOGUE_MODELS = new Set<string>(OWNER_ELEVENLABS_DIALOGUE_MODEL_IDS);
const OWNER_ELEVENLABS_DIALOGUE_CHATS = new WeakMap<object, Map<string, OwnerElevenLabsDialogueChatState>>();
const OWNER_ELEVENLABS_DIALOGUE_CHAT_CONTEXTS = new WeakMap<object, OwnerElevenLabsDialogueChatState>();
const OWNER_ELEVENLABS_DIALOGUE_CHAT_BY_PERMIT = new WeakMap<object, OwnerElevenLabsDialogueChatState>();
const OWNER_ELEVENLABS_DIALOGUE_PENDING_PERMITS = new WeakSet<object>();
const OWNER_ELEVENLABS_DIALOGUE_CREATE_ATTEMPTED = new WeakSet<object>();
const OWNER_ELEVENLABS_DIALOGUE_RESULT_CONTEXTS = new WeakMap<object, OwnerElevenLabsDialogueResultContextState>();
const OWNER_ELEVENLABS_TTS_HISTORY_OBJECT_SCHEMA = z.object({
  id: providerIdSchema,
  message_id: providerIdSchema,
  object_type: z.string().regex(SAFE_RESPONSE_TOKEN),
  model_type: z.string().regex(SAFE_RESPONSE_TOKEN).nullable().optional(),
  object_text: z.string().max(MAX_PROMPT_BYTES).optional()
}).strip();
const OWNER_ELEVENLABS_TTS_HISTORY_ROW_SCHEMA = z.object({
  id: providerIdSchema,
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(OWNER_ELEVENLABS_TTS_HISTORY_OBJECT_SCHEMA).max(64)
}).strip();
const OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SCHEMA = z.object({
  messages: z.array(OWNER_ELEVENLABS_TTS_HISTORY_ROW_SCHEMA).max(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_LIMIT),
    page_size: z.literal(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE),
    total_count: z.number().int().min(0).max(OWNER_ELEVENLABS_TTS_HISTORY_MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).strip()
}).strip();
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_OBJECT_SCHEMA = z.object({
  id: providerIdSchema,
  message_id: providerIdSchema,
  object_type: z.string().regex(SAFE_RESPONSE_TOKEN),
  model_type: z.string().regex(SAFE_RESPONSE_TOKEN).nullable().optional()
}).strip();
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_ROW_SCHEMA = z.object({
  id: providerIdSchema,
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(OWNER_ELEVENLABS_DIALOGUE_HISTORY_OBJECT_SCHEMA).max(64)
}).strip();
const OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SCHEMA = z.object({
  messages: z.array(OWNER_ELEVENLABS_DIALOGUE_HISTORY_ROW_SCHEMA).max(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_LIMIT),
    page_size: z.literal(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE),
    total_count: z.number().int().min(0).max(OWNER_ELEVENLABS_DIALOGUE_HISTORY_MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).strip()
}).strip();

const OWNER_SUNO_GENERATION_CHAT_LIMIT = 128;
const OWNER_SUNO_GENERATION_HISTORY_MESSAGE_LIMIT = 64;
const OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE = 10;
const OWNER_SUNO_GENERATION_HISTORY_PAGE_LIMIT = Math.ceil(
  OWNER_SUNO_GENERATION_HISTORY_MESSAGE_LIMIT / OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE
);
const OWNER_SUNO_GENERATION_MODELS = new Set<string>(OWNER_SUNO_GENERATION_MODEL_IDS);
const OWNER_SUNO_GENERATION_HISTORY_OBJECT_SCHEMA = z.object({
  id: providerIdSchema,
  message_id: providerIdSchema,
  object_type: z.string().regex(SAFE_RESPONSE_TOKEN),
  model_type: z.string().regex(SAFE_RESPONSE_TOKEN).nullable().optional(),
  object_text: z.string().max(MAX_PROMPT_BYTES).optional(),
  object_url: z.string().max(4096).optional(),
  completed: z.boolean().optional()
}).strip();
const OWNER_SUNO_GENERATION_HISTORY_ROW_SCHEMA = z.object({
  id: providerIdSchema,
  chat_id: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  author_id: z.number().int().min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER),
  message_object: z.array(OWNER_SUNO_GENERATION_HISTORY_OBJECT_SCHEMA).max(64)
}).strip();
const OWNER_SUNO_GENERATION_HISTORY_PAGE_SCHEMA = z.object({
  messages: z.array(OWNER_SUNO_GENERATION_HISTORY_ROW_SCHEMA).max(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE),
  pagination: z.object({
    page: z.number().int().min(1).max(OWNER_SUNO_GENERATION_HISTORY_PAGE_LIMIT),
    page_size: z.literal(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE),
    total_count: z.number().int().min(0).max(OWNER_SUNO_GENERATION_HISTORY_MESSAGE_LIMIT),
    total_pages: z.number().int().min(0).max(OWNER_SUNO_GENERATION_HISTORY_PAGE_LIMIT),
    has_next: z.boolean(),
    has_previous: z.boolean()
  }).strip()
}).strip();

type OwnerSunoGenerationChatPhase = "AVAILABLE" | "RESERVED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED";
interface OwnerSunoGenerationStartInput {
  readonly candidate: OwnerSunoGenerationPreparedCandidate;
  readonly permit: OwnerSunoGenerationOneShotPermit;
  readonly preparer: OwnerSunoGenerationRequestPreparer;
  readonly oneShotPolicy: OwnerSunoGenerationOneShotPolicy;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
}
interface OwnerSunoGenerationChatState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerSunoGenerationChatContext;
  readonly operation: Readonly<OwnerSunoGenerationStartInput>;
  readonly modelId: OwnerSunoGenerationModel;
  phase: OwnerSunoGenerationChatPhase;
  ownerEchoMessageId?: string;
  privatePrompt?: string;
  readonly resultContexts: Map<string, OwnerSunoGenerationResultMessageContext>;
}
interface OwnerSunoGenerationResultContextState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerSunoGenerationChatState;
  readonly context: OwnerSunoGenerationResultMessageContext;
  trackMetadata: readonly InternalOwnerSunoGenerationTrackMetadata[];
}
interface OwnerSunoExistingTrackChatState {
  readonly client: SyntxChatHttpClient;
  readonly context: OwnerSunoExistingTrackChatContext;
  readonly source: Readonly<OwnerSunoExistingTrackIndexChat>;
  readonly attemptId: string;
  readonly principal: Readonly<GenerationPrincipalRef>;
  candidates?: OwnerSunoExistingTrackCandidates;
}
interface OwnerSunoExistingTrackResultContextState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerSunoExistingTrackChatState;
  readonly context: OwnerSunoExistingTrackResultMessageContext;
  result?: OwnerSunoAudioResult;
  artifacts: readonly Readonly<OwnerSunoExistingTrackMetadata>[];
}
interface InternalOwnerSunoGenerationTrackMetadata {
  readonly message_object_id: string;
  readonly clip_id: string;
  readonly task_id: string;
  readonly model_id: OwnerSunoGenerationModel;
}
const OWNER_SUNO_GENERATION_CHATS = new WeakMap<object, Map<string, OwnerSunoGenerationChatState>>();
const OWNER_SUNO_GENERATION_CHAT_CONTEXTS = new WeakMap<object, OwnerSunoGenerationChatState>();
const OWNER_SUNO_GENERATION_USED_PERMITS = new WeakSet<object>();
const OWNER_SUNO_GENERATION_RESULT_CONTEXTS = new WeakMap<object, OwnerSunoGenerationResultContextState>();
const OWNER_SUNO_EXISTING_TRACK_CHATS = new WeakMap<object, Map<string, OwnerSunoExistingTrackChatState>>();
const OWNER_SUNO_EXISTING_TRACK_CHAT_CONTEXTS = new WeakMap<object, OwnerSunoExistingTrackChatState>();
const OWNER_SUNO_EXISTING_TRACK_RESULT_CONTEXTS = new WeakMap<object, OwnerSunoExistingTrackResultContextState>();
type OwnerSunoTrackOperationChatPhase = OwnerSunoGenerationChatPhase;
interface OwnerSunoTrackOperationStartInput {
  readonly candidate: OwnerSunoTrackOperationPreparedCandidate;
  readonly permit: OwnerSunoTrackOperationOneShotPermit;
  readonly preparer: OwnerSunoTrackOperationRequestPreparer;
  readonly oneShotPolicy: OwnerSunoTrackOperationOneShotPolicy;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
}
interface OwnerSunoTrackOperationChatState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerSunoTrackOperationChatContext;
  readonly operation: Readonly<OwnerSunoTrackOperationStartInput>;
  readonly binding: Readonly<OwnerSunoTrackOperationCandidateBinding>;
  readonly modelId: OwnerSunoTrackOperationModel;
  readonly mode: OwnerSunoTrackOperationMode;
  phase: OwnerSunoTrackOperationChatPhase;
  ownerEchoMessageId?: string;
  privatePrompt?: string;
  readonly resultContexts: Map<string, OwnerSunoTrackOperationResultMessageContext>;
}
interface OwnerSunoTrackOperationResultContextState {
  readonly client: SyntxChatHttpClient;
  readonly chat: OwnerSunoTrackOperationChatState;
  readonly context: OwnerSunoTrackOperationResultMessageContext;
}
const OWNER_SUNO_TRACK_OPERATION_MODELS = new Set<string>(OWNER_SUNO_TRACK_OPERATION_MODEL_IDS);
const OWNER_SUNO_TRACK_OPERATION_CHATS = new WeakMap<object, Map<string, OwnerSunoTrackOperationChatState>>();
const OWNER_SUNO_TRACK_OPERATION_CHAT_CONTEXTS = new WeakMap<object, OwnerSunoTrackOperationChatState>();
const OWNER_SUNO_TRACK_OPERATION_USED_PERMITS = new WeakSet<object>();
const OWNER_SUNO_TRACK_OPERATION_RESULT_CONTEXTS = new WeakMap<object, OwnerSunoTrackOperationResultContextState>();
interface OwnerVideo2AudioOriginalReferenceWitness {
  readonly client: SyntxChatHttpClient;
  readonly profileSchemaHash: string;
  readonly sha256: string;
  readonly mimeType: "video/mp4";
  readonly size: number;
  readonly durationSeconds: number;
  readonly url: string;
}
const OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCES = new WeakMap<object, OwnerVideo2AudioOriginalReferenceWitness>();
type OwnerVideo2AudioNativePhase = "AVAILABLE" | "RESERVED" | "PRE_DISPATCH_FAILED" | "OUTCOME_UNKNOWN" | "ACKNOWLEDGED" | "INVALIDATED";
interface OwnerVideo2AudioNativeOperationInput {
  readonly preparer: OwnerVideo2AudioRequestPreparer;
  readonly candidate: OwnerVideo2AudioPreparedCandidate;
  readonly principal: Readonly<GenerationPrincipalRef>;
  readonly attemptId: string;
}
interface OwnerVideo2AudioNativeOperation extends OwnerVideo2AudioNativeOperationInput {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly binding: Readonly<OwnerVideo2AudioCandidateBinding>;
}
interface OwnerVideo2AudioNativeChatState {
  client: SyntxChatHttpClient | undefined;
  readonly chat: OwnerVideo2AudioChatContext;
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly profileHash: string;
  readonly resultContexts: Map<string, OwnerVideo2AudioResultMessageContext>;
  operation: Readonly<OwnerVideo2AudioNativeOperation> | undefined;
  phase: OwnerVideo2AudioNativePhase;
  binding: Readonly<OwnerVideo2AudioCandidateBinding> | undefined;
  privatePrompt: string | undefined;
  ownerEchoMessageId: string | undefined;
  historyGetCalls: number;
}
interface OwnerVideo2AudioNativeResultContextState {
  client: SyntxChatHttpClient | undefined;
  readonly chat: OwnerVideo2AudioNativeChatState;
  readonly context: OwnerVideo2AudioResultMessageContext;
  readonly codecContext: OwnerVideo2AudioResultReadContext;
}
const OWNER_VIDEO2AUDIO_NATIVE_CHATS = new WeakMap<object, Map<string, OwnerVideo2AudioNativeChatState>>();
const OWNER_VIDEO2AUDIO_NATIVE_CHAT_CONTEXTS = new WeakMap<object, OwnerVideo2AudioNativeChatState>();
const OWNER_VIDEO2AUDIO_NATIVE_CANDIDATE_CHATS = new WeakMap<object, OwnerVideo2AudioNativeChatState>();
const OWNER_VIDEO2AUDIO_NATIVE_RESULT_CONTEXTS = new WeakMap<object, OwnerVideo2AudioNativeResultContextState>();
const OWNER_VIDEO2AUDIO_NATIVE_RESERVED_CANDIDATES = new WeakSet<object>();
const OWNER_VIDEO2AUDIO_NATIVE_PENDING_CREATES = new WeakMap<object, Set<object>>();

/**
 * Fixed-route gateway for the SYNTX chat and generation routes observed in the
 * first-party web client on 2026-09-02. It deliberately accepts neither an
 * upstream base URL nor an HTTP method/path from callers.
 */
export class SyntxChatHttpClient {
  readonly #credentialBroker: SyntxCredentialBroker;
  readonly #fetch: typeof fetch;
  readonly #requestTimeoutMs: number;
  readonly #maxResponseBytes: number;

  constructor(options: SyntxChatHttpClientOptions) {
    this.#credentialBroker = options.credentialBroker;
    this.#fetch = options.fetchImpl ?? globalThis.fetch;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
    this.#maxResponseBytes = options.maxResponseBytes ?? 256 * 1024;

    if (
      !Number.isInteger(this.#requestTimeoutMs) ||
      this.#requestTimeoutMs < 1 ||
      this.#requestTimeoutMs > 60_000 ||
      !Number.isInteger(this.#maxResponseBytes) ||
      this.#maxResponseBytes < 256 ||
      this.#maxResponseBytes > 4 * 1024 * 1024
    ) {
      throw invalidRequest();
    }
  }

  async createChat(
    scope: SyntxChatScope,
    title: string,
    signal?: AbortSignal
  ): Promise<CreateChatReceipt> {
    if (!(["text", "image", "video", "audio"] as const).includes(scope)) {
      throw invalidRequest();
    }
    validateBoundedText(title, MAX_TITLE_BYTES, true);
    const raw = await this.#request(
      new URL("chats", V1_BASE_URL),
      "POST",
      { title, scope },
      "JSON_REQUIRED",
      signal
    );
    const parsed = createChatResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    return { chat_uuid: parsed.data.uuid };
  }

  /** Fixed internal chat creation for the owner Kling Image-to-Video bridge. */
  async createOwnerKlingI2vVideoChat(signal?: AbortSignal): Promise<CreateChatReceipt> {
    return this.createChat("video", "Kling Image-to-Video", signal);
  }

  /** Fixed owner-image-upscaler chat scope; callers cannot choose a scope value. */
  async createImageUpscalerChat(
    title: string,
    signal?: AbortSignal
  ): Promise<CreateChatReceipt> {
    validateBoundedText(title, MAX_TITLE_BYTES, true);
    const raw = await this.#request(
      new URL("chats", V1_BASE_URL),
      "POST",
      { title, scope: "tool_image_upscaler" },
      "JSON_REQUIRED",
      signal
    );
    const parsed = createChatResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    return { chat_uuid: parsed.data.uuid };
  }

  /** Fixed owner-video-upscaler chat scope; callers cannot choose a scope value. */
  async createVideoUpscalerChat(
    title: string,
    signal?: AbortSignal
  ): Promise<CreateChatReceipt> {
    validateBoundedText(title, MAX_TITLE_BYTES, true);
    const raw = await this.#request(
      new URL("chats", V1_BASE_URL),
      "POST",
      { title, scope: "tool_video_upscaler" },
      "JSON_REQUIRED",
      signal
    );
    const parsed = createChatResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    return { chat_uuid: parsed.data.uuid };
  }

  /** Fixed image-inpaint session constructor; callers cannot choose scope or folder. */
  async createImageInpaintChat(
    title: string,
    signal?: AbortSignal
  ): Promise<CreateChatReceipt> {
    validateBoundedText(title, MAX_TITLE_BYTES, true);
    const chats = ownerBananaInpaintChatMap(this);
    if (chats.size >= OWNER_BANANA_INPAINT_CHAT_LIMIT) throw invalidRequest();
    const raw = await this.#request(
      new URL("chats", V1_BASE_URL),
      "POST",
      { title, scope: "tool_image_inpaint" },
      "JSON_REQUIRED",
      signal
    );
    const parsed = createChatResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    const chatUuid = parsed.data.uuid;
    if (chats.has(chatUuid)) throw protocolError();
    chats.set(chatUuid, { chat_uuid: chatUuid, phase: "AVAILABLE" });
    return { chat_uuid: chatUuid };
  }

  /** Fixed fresh Editor chat. Its private state is separate from every other inpaint workflow. */
  async createSeedreamEditorChat(title: string, signal?: AbortSignal, attemptId?: string): Promise<CreateChatReceipt> {
    validateBoundedText(title, MAX_TITLE_BYTES, true);
    if (attemptId !== undefined && (typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId))) throw invalidRequest();
    const chats = ownerSeedreamEditorChatMap(this);
    if (chats.size >= OWNER_SEEDREAM_EDITOR_CHAT_LIMIT) throw invalidRequest();
    const raw = await this.#request(new URL("chats", V1_BASE_URL), "POST",
      { title, scope: "tool_image_inpaint" }, "JSON_REQUIRED", signal);
    const parsed = createChatResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    const chatUuid = parsed.data.uuid;
    if (chats.has(chatUuid)) throw protocolError();
    chats.set(chatUuid, { chat_uuid: chatUuid, ...(attemptId === undefined ? {} : { attemptId }), phase: "AVAILABLE", epoch: 0 });
    return { chat_uuid: chatUuid };
  }

  /** Fixed Banana Inpaint POST; a nominal one-shot permit and this client's fresh tool chat are required. */
  async startBananaInpaintImageWithOwnedCandidate(
    input: StartBananaInpaintImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    if (signal?.aborted) throw abortError("external");
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    const chatUuid = fields.chat_uuid;
    validatePathIdentifier(chatUuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();

    const chats = ownerBananaInpaintChats.get(this);
    const ownedChat = chats?.get(fields.chat_uuid);
    if (!chats || !ownedChat || ownedChat.chat_uuid !== fields.chat_uuid || ownedChat.phase !== "AVAILABLE") throw invalidRequest();

    const [{ isOwnerBananaInpaintImageRequestPreparer }, policy] = await Promise.all([
      import("../../application/owner-banana-inpaint-image-request-preparer.js"),
      import("../../application/owner-banana-inpaint-image-one-shot-policy.js")
    ]);
    const preparer = fields.preparer as OwnerBananaInpaintImageRequestPreparer;
    const candidate = fields.candidate as OwnerBananaInpaintImagePreparedCandidate;
    if (!isOwnerBananaInpaintImageRequestPreparer(preparer)) throw invalidRequest();
    let binding: ReturnType<OwnerBananaInpaintImageRequestPreparer["inspectCandidate"]>;
    let privateRequest: OwnerBananaInpaintImageRequest;
    try {
      binding = Reflect.apply(preparer.inspectCandidate, preparer, [candidate]);
      if (!binding) throw invalidRequest();
      privateRequest = Reflect.apply(preparer.getPrivateRequest, preparer, [candidate]);
    } catch { throw invalidRequest(); }
    if (binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        binding.variant !== candidate.variant || binding.profile_id !== candidate.profile_id ||
        binding.profile_schema_hash !== candidate.profile_schema_hash ||
        !isDeepStrictEqual(binding.source_binding, candidate.source_binding) ||
        candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.ai_name !== "banana" || candidate.form_ai_name !== "banana_inpaint" || candidate.form_id !== "banana-inpaint" ||
        candidate.scope !== "tool_image_inpaint" || candidate.model_type !== candidate.variant ||
        !["banana", "banana2", "banana3", "banana3_light"].includes(candidate.variant)) throw invalidRequest();

    const requestFields = readExactDataRecord(privateRequest, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof requestFields.prompt !== "string") throw invalidRequest();
    const settings = readExactDataRecord(requestFields.settings,
      ["editor", "model_type", "image_size", "file_urls"], ["editor", "model_type", "image_size", "file_urls"]);
    if (settings.editor !== true || settings.model_type !== candidate.variant || settings.image_size !== candidate.image_size ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) ||
        settings.file_urls.length !== candidate.reference_count ||
        (settings.file_urls.length !== 2 && settings.file_urls.length !== 3) ||
        !Array.isArray(candidate.references) || candidate.references.length !== settings.file_urls.length) throw invalidRequest();
    const expectedFileTypes = settings.file_urls.length === 2 ? ["image", "mask"] : ["image", "mask", "image"];
    for (let index = 0; index < settings.file_urls.length; index += 1) {
      const file = readExactDataRecord(settings.file_urls[index], ["type", "url"], ["type", "url"]);
      if (file.type !== expectedFileTypes[index] || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) throw invalidRequest();
    }
    const safeSettings = sanitizeSettings(settings);
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      prompt: requestFields.prompt,
      settings: safeSettings
    };

    if (ownedChat.phase !== "AVAILABLE" || chats.get(fields.chat_uuid) !== ownedChat) throw invalidRequest();
    ownedChat.phase = "RESERVED";
    let permitConsumed = false;
    try {
      await policy.revalidateOwnerBananaInpaintImageOneShotPermit({
        permit: fields.permit as OwnerBananaInpaintImageOneShotPermit,
        candidate,
        preparer,
        principal,
        attemptId: fields.attemptId
      });
      if (signal?.aborted) throw abortError("external");
      if (ownedChat.phase !== "RESERVED" || chats.get(fields.chat_uuid) !== ownedChat) throw invalidRequest();
      const consumed = policy.consumeOwnerBananaInpaintImageOneShotPermit({
        permit: fields.permit as OwnerBananaInpaintImageOneShotPermit,
        candidate,
        preparer,
        principal,
        attemptId: fields.attemptId
      });
      if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
          consumed.request_fingerprint !== candidate.request_fingerprint) throw invalidRequest();
      permitConsumed = true;
      const reservation: Readonly<OwnerBananaInpaintStartReservation> = Object.freeze({ preparer, candidate, principal,
        attemptId: fields.attemptId, request_fingerprint: consumed.request_fingerprint });
      ownedChat.reservation = reservation;
      ownedChat.phase = "OUTCOME_UNKNOWN";
      const receipt = await this.#startMedia("design/generate", "banana", fields.chat_uuid, body, signal);
      if (ownedChat.phase !== "OUTCOME_UNKNOWN" || chats.get(fields.chat_uuid) !== ownedChat) throw invalidRequest();
      ownedChat.phase = "ACKNOWLEDGED";
      ownedChat.started = Object.freeze({ ...reservation, owner_echo_message_id: receipt.message_id });
      return receipt;
    } catch (error) {
      if (!permitConsumed && ownedChat.phase === "RESERVED" && chats.get(fields.chat_uuid) === ownedChat) {
        ownedChat.phase = "AVAILABLE";
      }
      throw error;
    }
  }

  /** Returns bounded in-progress IDs, or owned bot-message candidates from exact chat history if progress is empty. */
  async listBananaInpaintImageResultCandidates(
    input: ListBananaInpaintImageResultCandidatesInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerBananaInpaintImageResultCandidates> {
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    const chatUuid = fields.chat_uuid;
    validatePathIdentifier(chatUuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const chat = ownerBananaInpaintChats.get(this)?.get(chatUuid);
    const operation = chat?.started ?? chat?.reservation;
    if (!chat || (chat.phase !== "ACKNOWLEDGED" && chat.phase !== "OUTCOME_UNKNOWN") || !operation ||
        operation.preparer !== fields.preparer || operation.candidate !== fields.candidate ||
        operation.attemptId !== fields.attemptId || !sameGenerationPrincipal(operation.principal, principal)) throw invalidRequest();
    const ownerEchoMessageId = chat.started?.owner_echo_message_id;
    const baseResultFields = { chat_uuid: chatUuid,
      ...(ownerEchoMessageId === undefined ? {} : { owner_echo_message_id: ownerEchoMessageId }) };

    const progress = await Reflect.apply(NATIVE_INPAINT_LIST_IN_PROGRESS, this, [chatUuid, signal]) as InProgressMessage[];
    if (progress.length > 0) {
      const contexts: OwnerBananaInpaintImageResultMessageContext[] = [];
      const gaps: OwnerBananaInpaintImageHistoryGap[] = [
        ...(ownerEchoMessageId === undefined ? ["POST_OUTCOME_UNKNOWN" as const] : []),
        "IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ"
      ];
      const messageIds = new Set<string>();
      for (const entry of progress) {
        if (messageIds.has(entry.message_id)) {
          gaps.push("IN_PROGRESS_DUPLICATE_MESSAGE_ID");
          continue;
        }
        messageIds.add(entry.message_id);
        contexts.push(mintOwnerBananaInpaintImageResultMessageContext(this, chat, operation, {
          chat_uuid: chatUuid, ...(ownerEchoMessageId === undefined ? {} : { owner_echo_message_id: ownerEchoMessageId }),
          message_id: entry.message_id,
          message_object_ids: entry.message_object_id === null ? Object.freeze([]) : Object.freeze([entry.message_object_id])
        }));
      }
      return Object.freeze({ chat_uuid: chatUuid, candidate_source: "IN_PROGRESS" as const,
        ...(ownerEchoMessageId === undefined ? {} : { owner_echo_message_id: ownerEchoMessageId }),
        history_binding_status: ownerEchoMessageId === undefined ? "UNVERIFIED" : "PARTIAL",
        history_page_status: "NOT_READ", gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
    }

    const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "10");
    const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
    const parsed = chatHistoryResponseSchema.safeParse(raw);
    if (!parsed.success) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
      history_binding_status: "UNVERIFIED", history_page_status: "UNPROVEN", gaps: Object.freeze(["HISTORY_SHAPE_UNVERIFIED"] as const),
      contexts: Object.freeze([]) });
    const { messages, pagination } = parsed.data;
    const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / pagination.page_size);
    const validPage = pagination.page === 1 && pagination.page_size === 10 && pagination.total_pages === expectedPages &&
      !pagination.has_previous && pagination.has_next === (expectedPages > 1) && messages.length <= pagination.page_size &&
      (expectedPages !== 1 || pagination.total_count === messages.length) &&
      (expectedPages <= 1 || messages.length === pagination.page_size);
    if (!validPage) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
      history_binding_status: "UNVERIFIED", history_page_status: "UNPROVEN", gaps: Object.freeze(["HISTORY_SHAPE_UNVERIFIED"] as const),
      contexts: Object.freeze([]) });
    const pageStatus: OwnerBananaInpaintImageHistoryPageStatus = expectedPages > 1 ? "MORE_PAGES" : "COMPLETE";
    const pageGap: OwnerBananaInpaintImageHistoryGap[] = expectedPages > 1 ? ["HISTORY_HAS_MORE_PAGES"] : [];
    if (messages.length === 0) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
      history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
      gaps: Object.freeze([...(ownerEchoMessageId === undefined ? ["POST_OUTCOME_UNKNOWN" as const] : []),
        ...pageGap, "HISTORY_EMPTY" as const]), contexts: Object.freeze([]) });

    const providerChatId = String(messages[0]!.chat_id);
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    for (const row of messages) {
      if (String(row.chat_id) !== providerChatId) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
        history_binding_status: "UNVERIFIED",
        history_page_status: pageStatus, gaps: Object.freeze([...pageGap, "HISTORY_CHAT_ID_MISMATCH" as const]), contexts: Object.freeze([]) });
      if (messageIds.has(row.id)) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
        history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
        gaps: Object.freeze([...pageGap, "HISTORY_MESSAGE_ID_INVALID" as const]), contexts: Object.freeze([]) });
      messageIds.add(row.id);
      for (const object of row.message_object) {
        if (object.message_id !== row.id || objectIds.has(object.id)) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
          history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
          gaps: Object.freeze([...pageGap, "HISTORY_OBJECT_ID_INVALID" as const]), contexts: Object.freeze([]) });
        objectIds.add(object.id);
      }
    }
    if (ownerEchoMessageId === undefined) {
      const contexts = messages.filter((row) => row.author_id === BOT_AUTHOR_ID).map((row) =>
        mintOwnerBananaInpaintImageResultMessageContext(this, chat, operation, { chat_uuid: chatUuid,
          message_id: row.id, provider_chat_id: providerChatId,
          message_object_ids: Object.freeze(row.message_object.map((object) => object.id)) }));
      const gaps: OwnerBananaInpaintImageHistoryGap[] = ["POST_OUTCOME_UNKNOWN", "OWNER_ACK_ID_UNAVAILABLE", ...pageGap];
      if (contexts.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
      return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
        history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
        gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
    }
    const ackIndexes = messages.map((row, index) => row.id === ownerEchoMessageId ? index : -1).filter((index) => index >= 0);
    if (ackIndexes.length !== 1) {
      const gap: OwnerBananaInpaintImageHistoryGap = ackIndexes.length === 0
        ? (expectedPages > 1 ? "ACK_MESSAGE_NOT_IN_FIRST_PAGE" : "ACK_MESSAGE_NOT_FOUND")
        : "ACK_MESSAGE_NOT_FOUND";
      return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
        history_binding_status: expectedPages > 1 && ackIndexes.length === 0 ? "PARTIAL" : "UNVERIFIED",
        history_page_status: pageStatus, gaps: Object.freeze([...pageGap, gap]), contexts: Object.freeze([]) });
    }
    const ackIndex = ackIndexes[0]!;
    const ackRow = messages[ackIndex]!;
    const resultRows: (typeof messages)[number][] | null = ackRow.author_id === BOT_AUTHOR_ID
      ? [ackRow]
      : ackRow.author_id > 0
        ? messages.slice(ackIndex + 1).filter((row) => row.author_id === BOT_AUTHOR_ID)
        : null;
    if (resultRows === null) return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
      history_binding_status: "UNVERIFIED", history_page_status: pageStatus,
      gaps: Object.freeze([...pageGap, "ACK_AUTHOR_UNBOUND" as const]), contexts: Object.freeze([]) });
    const contexts = resultRows.map((row) => mintOwnerBananaInpaintImageResultMessageContext(this, chat, operation, {
      chat_uuid: chatUuid, owner_echo_message_id: ownerEchoMessageId, message_id: row.id,
      provider_chat_id: providerChatId, message_object_ids: Object.freeze(row.message_object.map((object) => object.id))
    }));
    const gaps: OwnerBananaInpaintImageHistoryGap[] = [...pageGap];
    if (contexts.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
    const status: OwnerBananaInpaintImageHistoryBindingStatus = expectedPages > 1 || contexts.length === 0 ? "PARTIAL" : "BOUND";
    return Object.freeze({ ...baseResultFields, candidate_source: "HISTORY" as const,
      history_binding_status: status, history_page_status: pageStatus, gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
  }

  /** GET-only result read; only contexts minted from this client's owned inpaint progress/history can be used. */
  async getBananaInpaintImageResult(
    contextInput: OwnerBananaInpaintImageResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerBananaInpaintImageResult> {
    if (!contextInput || typeof contextInput !== "object" || Array.isArray(contextInput) || types.isProxy(contextInput)) throw invalidRequest();
    const contextState = ownerBananaInpaintResultContexts.get(contextInput as object);
    if (!contextState || contextState.context !== contextInput) throw invalidRequest();
    const { context, chat, operation } = contextState;
    const currentOperation = chat.started ?? chat.reservation;
    if (contextState.client !== this || ownerBananaInpaintChats.get(this)?.get(context.chat_uuid) !== chat ||
        (chat.phase !== "ACKNOWLEDGED" && chat.phase !== "OUTCOME_UNKNOWN") || currentOperation !== operation ||
        context.owner_echo_message_id !== chat.started?.owner_echo_message_id) throw invalidRequest();
    const raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
      "GET", undefined, "JSON_REQUIRED", signal);
    if (contextState.client !== this || ownerBananaInpaintChats.get(this)?.get(context.chat_uuid) !== chat ||
        (chat.phase !== "ACKNOWLEDGED" && chat.phase !== "OUTCOME_UNKNOWN") || (chat.started ?? chat.reservation) !== operation) {
      throw invalidRequest();
    }
    const decoderContext: OwnerBananaInpaintImageResultReadContext = Object.freeze({ chat_uuid: context.chat_uuid,
      message_id: context.message_id, ...(context.provider_chat_id === undefined ? {} : { provider_chat_id: context.provider_chat_id }) });
    return decodeOwnerBananaInpaintImageResult(raw, decoderContext);
  }

  async deleteChat(
    chatUuid: string,
    signal?: AbortSignal
  ): Promise<ChatMutationReceipt> {
    validatePathIdentifier(chatUuid);
    await this.#request(
      new URL(`chats/${chatUuid}`, V1_BASE_URL),
      "DELETE",
      undefined,
      "ACK",
      signal
    );
    const inpaintChat = ownerBananaInpaintChats.get(this)?.get(chatUuid);
    if (inpaintChat) {
      inpaintChat.phase = "DELETED";
      ownerBananaInpaintChats.get(this)?.delete(chatUuid);
    }
    const editorChat = ownerSeedreamEditorChats.get(this)?.get(chatUuid);
    if (editorChat) {
      editorChat.phase = "DELETED";
      editorChat.epoch += 1;
      ownerSeedreamEditorChats.get(this)?.delete(chatUuid);
    }
    return { chat_uuid: chatUuid, accepted: true };
  }

  async listInProgress(
    chatUuid: string,
    signal?: AbortSignal
  ): Promise<InProgressMessage[]> {
    validatePathIdentifier(chatUuid);
    const raw = await this.#request(
      new URL(`chats/${chatUuid}/inprogress`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    const parsed = inProgressResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    return parsed.data;
  }

  async getMessage(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<RedactedMessageEnvelope> {
    validatePathIdentifier(chatUuid);
    validatePathIdentifier(messageId);
    const raw = await this.#request(
      new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    if (!isRecord(raw)) throw protocolError();
    // The observed response identifies the message with its top-level `id`.
    // Do not redact a body returned for a different message route.
    if (optionalProviderId(raw.id) !== messageId) throw protocolError();
    return redactMessage(raw, chatUuid, messageId);
  }

  /** Fixed Clarity-only exact single-image GET; never falls back to generic redaction. */
  async getClarityUpscaleResult(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<InternalClarityUpscaleResult> {
    validatePathIdentifier(chatUuid);
    validatePathIdentifier(messageId);
    const raw = await this.#request(
      new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    if (!isRecord(raw) || optionalProviderId(raw.id) !== messageId) {
      return clarityUpscaleUnverified(chatUuid, messageId, "OUTER_MESSAGE_MISMATCH");
    }
    if (raw.author_id !== BOT_AUTHOR_ID) return clarityUpscaleUnverified(chatUuid, messageId, "NOT_BOT_MESSAGE");
    if (!Array.isArray(raw.message_object) || raw.message_object.length === 0) {
      return clarityUpscaleUnverified(chatUuid, messageId, "NO_IMAGE_OBJECTS");
    }
    if (raw.message_object.length !== 1) {
      return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_COUNT_OUT_OF_RANGE");
    }
    const object = raw.message_object[0];
    if (!isRecord(object)) return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_OBJECT_INCOMPLETE");
    let fields: Record<string, unknown>;
    try {
      fields = readExactDataRecord(object,
        ["id", "message_id", "object_type", "model_type", "completed", "object_url"],
        ["id", "message_id", "object_type", "model_type", "completed", "object_url"]);
    } catch { return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_OBJECT_INCOMPLETE"); }
    const objectId = optionalProviderId(fields.id);
    if (objectId === undefined || optionalProviderId(fields.message_id) !== messageId ||
        fields.object_type !== "image" || fields.model_type !== "clarity" || fields.completed !== true) {
      return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_OBJECT_MISMATCH");
    }
    if (typeof fields.object_url !== "string" || !isSafeArtifactUrl(fields.object_url)) {
      return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_URL_UNSAFE");
    }
    const mimeType = inferArtifactMimeType(fields.object_url);
    if (mimeType === undefined || !mimeType.startsWith("image/")) {
      return clarityUpscaleUnverified(chatUuid, messageId, "RESULT_MIME_UNKNOWN");
    }
    return Object.freeze({
      status: "COMPLETE",
      chat_uuid: chatUuid,
      message_id: messageId,
      message_object_id: objectId,
      object_type: "image",
      model_type: "clarity",
      completed: true,
      artifact: Object.freeze({ url: fields.object_url, mime_type: mimeType, mime_source: "URL_EXTENSION" as const })
    });
  }

  /** Internal GET-only Magnific result decoder bound to the exact requested variant and verified history IDs. */
  async getMagnificUpscaleResult(
    context: MagnificUpscaleResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalMagnificUpscaleResult> {
    const request = snapshotMagnificResultReadContext(context);
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return redactMagnificUpscaleResult(raw, request);
  }

  /** Internal GET-only Kontext result decoder bound to exact history IDs and one requested source variant. */
  async getKontextImageResult(
    context: KontextImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalKontextImageResult> {
    const request = snapshotKontextImageResultReadContext(context);
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return redactKontextImageResult(raw, request);
  }

  /** Internal GET-only WAN batch result decoder bound to an exact normalized-history object order. */
  async getWanImageResult(
    context: WanImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalWanImageResult> {
    const request = snapshotWanImageResultReadContext(context);
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return redactWanImageResult(raw, request);
  }

  /** Internal GET-only WAN T2I result decoder bound to one exact T2I model, profile, history message, and observed IDs. */
  async getWanT2iImageResult(
    context: OwnerWanT2iResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalOwnerWanT2iImageResult> {
    let request: Readonly<OwnerWanT2iResultReadContext>;
    try { request = snapshotOwnerWanT2iResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerWanT2iImageResult(raw, request);
  }

  /** Internal GET-only standard image result decoder bound to one exact history object ID and variant. */
  async getStandardImageResult(
    context: StandardImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalStandardImageResult> {
    const request = snapshotStandardImageResultReadContext(context);
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return redactStandardImageResult(raw, request);
  }

  /** Internal GET-only Runway result decoder bound to one exact history object ID. */
  async getRunwayImageResult(
    context: RunwayImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalRunwayImageResult> {
    let request: Readonly<RunwayImageResultReadContext>;
    try { request = snapshotRunwayImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeRunwayImageResult(raw, request);
  }

  /** Internal GET-only Seedream result decoder bound to one exact history object ID and source variant. */
  async getSeedreamImageResult(
    context: SeedreamImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalSeedreamImageResult> {
    let request: Readonly<SeedreamImageResultReadContext>;
    try { request = snapshotSeedreamImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeSeedreamImageResult(raw, request);
  }

  /** Internal GET-only Flux result decoder bound to exact history IDs and one requested model. */
  async getFluxImageResult(
    context: OwnerFluxImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalOwnerFluxImageResult> {
    let request: Readonly<OwnerFluxImageResultReadContext>;
    try { request = snapshotOwnerFluxImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerFluxImageResult(raw, request);
  }

  /** Internal GET-only Ideogram result decoder bound to exact ordered batch IDs and private mode intent. */
  async getIdeogramImageResult(
    context: OwnerIdeogramImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalOwnerIdeogramImageResult> {
    let request: Readonly<OwnerIdeogramImageResultReadContext>;
    try { request = snapshotOwnerIdeogramImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerIdeogramImageResult(raw, request);
  }

  /** Internal GET-only Uni result decoder bound to one exact observed bot history row; no requested count is assumed. */
  async getUniImageResult(
    context: OwnerUniImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalOwnerUniImageResult> {
    let request: Readonly<OwnerUniImageResultReadContext>;
    try { request = snapshotOwnerUniImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerUniImageResult(raw, request);
  }

  /** Internal GET-only Soul result reader bound to exact batch size and observed ordered message-object IDs. */
  async getSoulImageBatchResult(
    context: OwnerSoulImageResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalOwnerSoulImageResult> {
    let request: Readonly<OwnerSoulImageResultReadContext>;
    try { request = snapshotOwnerSoulImageResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerSoulImageResult(raw, request);
  }

  /** Internal GET-only Grok plural-result decoder; never used as a dispatch fallback. */
  async getGrokImageBatchMessage(
    chatUuid: string,
    messageId: string,
    modelType: GrokImageModelType,
    signal?: AbortSignal
  ): Promise<InternalGrokImageBatchEnvelope> {
    validatePathIdentifier(chatUuid);
    validatePathIdentifier(messageId);
    if (!isGrokImageModelType(modelType)) throw invalidRequest();
    const raw = await this.#request(
      new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    if (!isRecord(raw) || optionalProviderId(raw.id) !== messageId) throw protocolError();
    return redactGrokImageBatchMessage(raw, chatUuid, messageId, modelType);
  }

  /** Internal GET-only full-four Grok T2I batch reader bound to exact history IDs and provider chat. */
  async getGrokT2iBatchMessage(
    context: GrokT2iImageBatchResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<InternalGrokT2iImageBatchResult> {
    let request: GrokT2iImageResultContext;
    try { request = snapshotGrokT2iImageBatchResultReadContext(context); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${request.chat_uuid}/${request.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return redactGrokT2iImageBatchMessage(raw, request);
  }

  async listMessageCandidates(
    chatUuid: string,
    ownerEchoMessageId: string,
    signal?: AbortSignal
  ): Promise<ChatMessageHistorySnapshot> {
    validatePathIdentifier(chatUuid);
    validatePathIdentifier(ownerEchoMessageId);
    const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
    url.searchParams.set("page", "1");
    url.searchParams.set("page_size", "10");
    const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
    const parsed = chatHistoryResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();

    const { messages, pagination } = parsed.data;
    const expectedPages = pagination.total_count === 0
      ? 0
      : Math.ceil(pagination.total_count / pagination.page_size);
    if (
      pagination.page !== 1 || pagination.page_size !== 10 ||
      pagination.total_pages !== expectedPages || pagination.total_pages !== 1 ||
      messages.length > pagination.page_size || pagination.has_previous ||
      pagination.has_next || pagination.total_count !== messages.length ||
      messages.length === 0
    ) {
      throw protocolError();
    }

    const providerChatId = String(messages[0]!.chat_id);
    const candidates: ChatMessageHistoryCandidate[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    for (const row of messages) {
      const messageId = row.id;
      if (String(row.chat_id) !== providerChatId || messageIds.has(messageId)) throw protocolError();
      messageIds.add(messageId);
      const objects: ChatMessageHistoryObject[] = row.message_object.map((object) => {
        if (object.message_id !== messageId || objectIds.has(object.id)) throw protocolError();
        objectIds.add(object.id);
        return {
          message_object_id: object.id,
          object_type: object.object_type,
          model_type: object.model_type ?? null
        };
      });
      const authorRole = row.author_id === BOT_AUTHOR_ID
        ? "bot"
        : messageId === ownerEchoMessageId && row.author_id > 0
          ? "owner"
          : "other";
      candidates.push({
        message_id: messageId,
        provider_chat_id: providerChatId,
        author_role: authorRole,
        objects
      });
    }

    return {
      complete: true,
      page: 1,
      page_size: 10,
      total_count: pagination.total_count,
      total_pages: pagination.total_pages,
      has_next: false,
      has_previous: pagination.has_previous,
      requested_chat_uuid: chatUuid,
      provider_chat_id: providerChatId,
      messages: candidates
    };
  }

  /** Internal bounded GET-only WAN T2V history reader; complete means every source page was read. */
  async listWanT2vMessageCandidates(
    chatUuid: string,
    ownerEchoMessageId: string | null,
    signal?: AbortSignal
  ): Promise<ChatMessageHistorySnapshot> {
    validatePathIdentifier(chatUuid);
    if (ownerEchoMessageId !== null) validatePathIdentifier(ownerEchoMessageId);
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    const messages: ChatMessageHistoryCandidate[] = [];
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;

    for (let page = 1; page <= OWNER_WAN_T2V_HISTORY_PAGE_LIMIT; page += 1) {
      const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", String(OWNER_WAN_T2V_HISTORY_PAGE_SIZE));
      const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
      const parsed = ownerWanT2vHistoryResponseSchema.safeParse(raw);
      if (!parsed.success) throw protocolError();

      const { messages: rows, pagination } = parsed.data;
      const expectedTotalPages = pagination.total_count === 0
        ? 0
        : Math.ceil(pagination.total_count / OWNER_WAN_T2V_HISTORY_PAGE_SIZE);
      const expectedRows = Math.min(OWNER_WAN_T2V_HISTORY_PAGE_SIZE,
        Math.max(0, pagination.total_count - (page - 1) * OWNER_WAN_T2V_HISTORY_PAGE_SIZE));
      if (pagination.page !== page || pagination.total_pages !== expectedTotalPages ||
          pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedTotalPages) ||
          rows.length !== expectedRows || expectedTotalPages === 0) throw protocolError();
      if (totalCount === undefined) {
        totalCount = pagination.total_count;
        totalPages = pagination.total_pages;
      } else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) {
        throw protocolError();
      }

      for (const row of rows) {
        const rowProviderChatId = String(row.chat_id);
        if (providerChatId === undefined) providerChatId = rowProviderChatId;
        if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw protocolError();
        messageIds.add(row.id);
        const objects: ChatMessageHistoryObject[] = row.message_object.map((object) => {
          if (object.message_id !== row.id || objectIds.has(object.id)) throw protocolError();
          objectIds.add(object.id);
          return { message_object_id: object.id, object_type: object.object_type, model_type: object.model_type ?? null };
        });
        const authorRole = row.author_id === BOT_AUTHOR_ID
          ? "bot"
          : ownerEchoMessageId !== null && row.id === ownerEchoMessageId && row.author_id > 0
            ? "owner"
            : "other";
        messages.push({ message_id: row.id, provider_chat_id: rowProviderChatId, author_role: authorRole, objects });
      }

      if (page === expectedTotalPages) {
        if (messages.length !== totalCount || providerChatId === undefined) throw protocolError();
        return {
          complete: true,
          page: 1,
          page_size: OWNER_WAN_T2V_HISTORY_PAGE_SIZE,
          total_count: totalCount,
          total_pages: expectedTotalPages,
          has_next: false,
          has_previous: false,
          requested_chat_uuid: chatUuid,
          provider_chat_id: providerChatId,
          messages
        };
      }
    }
    throw protocolError();
  }

  /** Internal fixed-route GET-only WAN T2V result read bound to the exact history context. */
  async getWanT2vVideoResultMessage(
    contextInput: OwnerWanT2vVideoResultReadContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerWanT2vVideoResult> {
    let context: Readonly<OwnerWanT2vVideoResultReadContext>;
    try { context = snapshotOwnerWanT2vVideoResultReadContext(contextInput); }
    catch { throw invalidRequest(); }
    const raw = await this.#request(
      new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
      "GET",
      undefined,
      "JSON_REQUIRED",
      signal
    );
    return decodeOwnerWanT2vVideoResult(raw, context);
  }

  async startText(
    request: StartTextRequest,
    signal?: AbortSignal
  ): Promise<TextGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_uuid);
    validateBoundedText(request.text, MAX_PROMPT_BYTES, true);
    validateModelIdentifier(request.model);

    const body: Record<string, JsonValue> = {
      chat_uuid: request.chat_uuid,
      text: request.text,
      model: request.model
    };
    validateOptionalBoolean(request.thinking);
    validateOptionalBoolean(request.plan);
    validateOptionalBoolean(request.deep_research);
    if (request.thinking !== undefined) body.thinking = request.thinking;
    if (request.plan !== undefined) body.plan = request.plan;
    if (request.deep_research !== undefined) {
      body.deep_research = request.deep_research;
    }
    if (request.files !== undefined) {
      body.files = sanitizeTextFiles(request.files);
    }

    const raw = await this.#request(
      generationUrl("llm/generate", request.ai_name),
      "POST",
      body,
      "JSON_REQUIRED",
      signal
    );
    const parsed = textStartResponseSchema.safeParse(raw);
    if (!parsed.success || !isSafeStreamUrl(parsed.data.stream_url)) {
      throw protocolError();
    }
    return {
      chat_uuid: request.chat_uuid,
      provider_job_id: parsed.data.job_id,
      message_id: parsed.data.message_id
    };
  }

  async startImage(
    request: StartImageRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_uuid);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = sanitizeSettings(request.settings);
    assertNoUnverifiedExternalReferences(settings);
    return this.#startMedia(
      "design/generate",
      request.ai_name,
      request.chat_uuid,
      { chat_uuid: request.chat_uuid, prompt: request.prompt, settings },
      signal
    );
  }

  /** Internal Clarity-only bridge; candidate + one-shot permit are required before one fixed POST. */
  async startClarityUpscaleWithOwnedCandidate(
    input: StartClarityUpscaleWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    const principal = snapshotClarityPrincipal(fields.principal, fields.attemptId);
    const prepared = snapshotClarityCandidate(fields.candidate, principal, fields.attemptId);
    const settings = sanitizeSettings(prepared.settings);
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      settings
    };
    if (prepared.prompt !== undefined) body.prompt = prepared.prompt;

    // No await or external action can occur between the one-shot check and claim.
    consumeOwnerClarityUpscaleOneShotPermit({
      permit: fields.permit as OwnerClarityUpscaleOneShotPermit,
      candidate: fields.candidate as OwnerClarityUpscalePreparedCandidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "clarity", fields.chat_uuid, body, signal);
  }

  /** Internal Magnific generation boundary: one nominal candidate/permit authorizes one fixed POST. */
  async startMagnificUpscaleWithOwnedCandidate(
    input: StartMagnificUpscaleWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    const principal = snapshotMagnificPrincipal(fields.principal, fields.attemptId);
    const candidate = fields.candidate;
    if (!isOwnerMagnificUpscalePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now())) {
      throw invalidRequest();
    }

    const prepared = candidate as OwnerMagnificUpscalePreparedCandidate;
    const request = readExactDataRecord(prepared.request, ["prompt", "settings"], ["settings"]);
    const prompt = request.prompt;
    if (prompt !== undefined && (typeof prompt !== "string" || prompt.length === 0 ||
        Buffer.byteLength(prompt, "utf8") > 5_000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(prompt))) {
      throw invalidRequest();
    }
    const settings = sanitizeSettings(request.settings as Readonly<Record<string, unknown>>);
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      settings,
      ...(prompt === undefined ? {} : { prompt })
    };

    // Consume synchronously after candidate/body validation and immediately before the sole dispatch path.
    consumeOwnerMagnificUpscaleOneShotPermit({
      permit: fields.permit as OwnerMagnificUpscaleOneShotPermit,
      candidate: prepared,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "magnific", fields.chat_uuid, body, signal);
  }

  /** Internal Kontext boundary: only a prepared nominal candidate plus its one-shot permit can dispatch. */
  async startKontextImageWithOwnedCandidate(
    input: StartKontextImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerKontextImagePreparedCandidateForPrincipal(fields.candidate, principal, fields.attemptId, Date.now())) {
      throw invalidRequest();
    }

    const candidate = fields.candidate as OwnerKontextImagePreparedCandidate;
    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string") throw invalidRequest();
    validateBoundedText(request.prompt, 65_536, true);
    const settings = readExactDataRecord(request.settings,
      ["n", "model_type", "workflow_type", "civitai_loras", "resolution", "cfg", "steps", "image_strength", "file_urls"],
      ["n", "model_type", "workflow_type", "civitai_loras", "resolution", "cfg", "steps", "image_strength", "file_urls"]);
    const safeSettings = sanitizeSettings(settings);
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      prompt: request.prompt,
      settings: safeSettings
    };

    // Candidate validation/body construction happen before the synchronous irreversible one-shot claim.
    consumeOwnerKontextImageOneShotPermit({
      permit: fields.permit as OwnerKontextImageOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "flux", fields.chat_uuid, body, signal);
  }

  /** Fixed WAN image POST; only a source-bound prepared candidate and nominal one-shot permit can reach it. */
  async startWanImageWithOwnedCandidate(
    input: StartWanImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const candidate = fields.candidate;
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerWanImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now())) throw invalidRequest();

    const prepared = candidate as OwnerWanImagePreparedCandidate;
    const request = readExactDataRecord((prepared as OwnerWanImagePreparedCandidate & { readonly request: unknown }).request,
      ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || prepared.prompt !== request.prompt) throw invalidRequest();
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = readExactDataRecord(request.settings,
      ["n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"],
      ["n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings })) throw invalidRequest();
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      prompt: request.prompt as string,
      settings: safeSettings
    };

    if (signal?.aborted) throw abortError("external");
    // The candidate, complete settings and request body are checked before the synchronous one-shot claim.
    consumeOwnerWanImageOneShotPermit({
      permit: fields.permit as OwnerWanImageOneShotPermit,
      candidate: prepared,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "wan_image", fields.chat_uuid, body, signal);
  }

  /** Fixed WAN T2I POST; the source-bound candidate and one-shot permit authorize one native dispatch. */
  async startWanT2iImageWithOwnedCandidate(
    input: StartWanT2iImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);

    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();

    const { OwnerWanT2iRequestPreparer } = await import("../../application/owner-wan-t2i-request-preparer.js");
    const { normalizeOwnerWanT2iParameters } = await import("../../application/owner-wan-t2i-parameters.js");
    const { consumeOwnerWanT2iOneShotPermit } = await import("../../application/owner-wan-t2i-one-shot-policy.js");

    const preparer = fields.preparer;
    if (!preparer || typeof preparer !== "object" || types.isProxy(preparer) ||
        !(preparer instanceof OwnerWanT2iRequestPreparer) ||
        Object.getPrototypeOf(preparer) !== OwnerWanT2iRequestPreparer.prototype ||
        Object.hasOwn(preparer, "isPreparedCandidateForPrincipal")) throw invalidRequest();
    const candidate = fields.candidate as OwnerWanT2iPreparedCandidate;
    const guard = OwnerWanT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal;
    let candidateIsCurrent = false;
    try {
      candidateIsCurrent = Reflect.apply(guard, preparer, [candidate, { attemptId: fields.attemptId, principal }]) === true;
    } catch { candidateIsCurrent = false; }
    if (!candidateIsCurrent || !candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) ||
        !Object.isFrozen(candidate) || candidate.status !== "PREPARED_SOURCE_SHAPED" || candidate.dispatch_allowed !== false ||
        candidate.backend_acceptance !== "UNPROVEN" || candidate.provider_execution !== false ||
        candidate.ai_name !== "wan_image" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
        candidate.profile_id !== "owner-wan-t2i-source-profile-v1" ||
        candidate.source_projection_confidence !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
        candidate.defaults_injected !== false || !Number.isSafeInteger(candidate.expires_at_ms) ||
        !/^sha256:[a-f0-9]{64}$/u.test(candidate.profile_schema_hash)) throw invalidRequest();

    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable !== false ||
        requestDescriptor.writable !== false || requestDescriptor.configurable !== false) throw invalidRequest();
    const request = readExactDataRecord(requestDescriptor.value, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string") throw invalidRequest();

    let normalized: ReturnType<typeof normalizeOwnerWanT2iParameters>;
    try {
      normalized = normalizeOwnerWanT2iParameters({ model_id: candidate.model_id, prompt: request.prompt,
        parameters: candidate.parameters });
    } catch { throw invalidRequest(); }
    if (!isDeepStrictEqual(candidate.parameters, normalized.source_bound_intent.parameters) ||
        !isDeepStrictEqual(candidate.cost_routing, normalized.cost_routing) ||
        !isDeepStrictEqual(candidate.cost_inputs, normalized.cost_inputs) ||
        candidate.cost_input_confidence !== "SOURCE_JOINED_COST2_QUERY_INPUTS_NOT_QUOTE_BILLING_OR_HARDCAP" ||
        candidate.catalog_version !== "sha256-e5517ee56db2cf5939de51b2e1d835249ec201eefc80d8a805487b82063c1989.json") {
      throw invalidRequest();
    }
    const expectedSettings = {
      n: 1, model_type: candidate.model_id, ...normalized.source_bound_intent.parameters, file_urls: []
    };
    const settings = readExactDataRecord(request.settings,
      ["n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"],
      ["n", "model_type", "aspect_ratio", "resolution", "batch_size", "prompt_extend", "seed", "color_palette", "bbox_list", "file_urls"]);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, expectedSettings)) throw invalidRequest();
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerWanT2iOneShotPermit({ permit: fields.permit as OwnerWanT2iOneShotPermit,
      candidate, principal, attemptId: fields.attemptId });
    return this.#startMedia("design/generate", "wan_image", fields.chat_uuid, body, signal);
  }

  /** Fixed image-family POST; an owned source-bound candidate and one-use nominal permit are required. */
  async startStandardImageWithOwnedCandidate(
    input: StartStandardImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const candidate = fields.candidate;
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerStandardImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now())) throw invalidRequest();

    const prepared = candidate as OwnerStandardImagePreparedCandidate;
    const request = readExactDataRecord(prepared.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || prepared.prompt !== request.prompt) throw invalidRequest();
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = readExactDataRecord(request.settings,
      ["n", "model_type", "aspect_ratio", "image_size", "thinking_level", "quality", "details_quality", "file_urls"],
      ["n", "model_type", "aspect_ratio", "file_urls"]);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings })) throw invalidRequest();
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      prompt: request.prompt,
      settings: safeSettings
    };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerStandardImageOneShotPermit({
      permit: fields.permit as OwnerStandardImageOneShotPermit,
      candidate: prepared,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", prepared.ai_name, fields.chat_uuid, body, signal);
  }

  /** Fixed Runway Frames POST; the exact owned candidate and nominal one-shot permit bind the sole dispatch. */
  async startRunwayImageWithOwnedCandidate(
    input: StartRunwayImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const candidate = fields.candidate as OwnerRunwayImagePreparedCandidate;
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerRunwayImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now())) throw invalidRequest();

    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || candidate.prompt !== request.prompt) throw invalidRequest();
    validateBoundedText(request.prompt, 65_536, true);
    const settings = readExactDataRecord(request.settings, ["n", "model_type", "resolution", "temperature", "file_urls"],
      ["n", "model_type", "resolution", "temperature", "file_urls"]);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings }) || settings.n !== 1 || settings.model_type !== "runway_frames" ||
        typeof settings.resolution !== "string" || typeof settings.temperature !== "number" || !Array.isArray(settings.file_urls)) {
      throw invalidRequest();
    }
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };
    if (signal?.aborted) throw abortError("external");
    consumeOwnerRunwayImageOneShotPermit({
      permit: fields.permit as OwnerRunwayImageOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "runway-frames", fields.chat_uuid, body, signal);
  }

  /** Fixed Seedream POST; a private source-issued candidate and nominal permit bind the sole dispatch. */
  async startSeedreamImageWithOwnedCandidate(
    input: StartSeedreamImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const candidate = fields.candidate as OwnerSeedreamImagePreparedCandidate;
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerSeedreamImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now()) ||
        candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.ai_name !== "seedream" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
        candidate.model_id !== candidate.variant || candidate.model_type !== candidate.variant ||
        !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(candidate.variant)) throw invalidRequest();

    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || candidate.prompt !== request.prompt) throw invalidRequest();
    validateBoundedText(request.prompt, 65_536, true);
    const flash = candidate.variant === "seedream-5.0-flash";
    const settingsKeys = ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls",
      ...(flash ? ["output_format", "background"] : [])];
    const settings = readExactDataRecord(request.settings, settingsKeys, settingsKeys);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings }) || settings.n !== 1 || settings.stream !== false ||
        settings.model_type !== candidate.variant || typeof settings.aspect_ratio !== "string" ||
        typeof settings.resolution !== "string" || !Array.isArray(settings.file_urls) ||
        settings.file_urls.length !== candidate.reference_count) throw invalidRequest();
    if (flash) {
      if ((settings.output_format !== "jpeg" && settings.output_format !== "png") ||
          (settings.background !== "opaque" && settings.background !== "transparent")) throw invalidRequest();
    } else if (Object.hasOwn(settings, "output_format") || Object.hasOwn(settings, "background")) throw invalidRequest();
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerSeedreamImageOneShotPermit({
      permit: fields.permit as OwnerSeedreamImageOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "seedream", fields.chat_uuid, body, signal);
  }

  /** One fixed Editor POST on this client's dedicated fresh chat, bound to genuine source candidate and permit. */
  async startSeedreamEditorImageWithOwnedCandidate(
    input: StartSeedreamEditorImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    if (signal?.aborted) throw abortError("external");
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();
    const chats = ownerSeedreamEditorChats.get(this);
    const chat = chats?.get(fields.chat_uuid);
    if (!chats || !chat || chat.chat_uuid !== fields.chat_uuid || chat.phase !== "AVAILABLE" ||
        (chat.attemptId !== undefined && chat.attemptId !== fields.attemptId)) throw invalidRequest();

    const [{ isOwnerSeedreamEditorImageRequestPreparer }, policy] = await Promise.all([
      import("../../application/owner-seedream-editor-image-request-preparer.js"),
      import("../../application/owner-seedream-editor-image-one-shot-policy.js")
    ]);
    const preparer = fields.preparer as OwnerSeedreamEditorImageRequestPreparer;
    const candidate = fields.candidate as OwnerSeedreamEditorImagePreparedCandidate;
    if (!isOwnerSeedreamEditorImageRequestPreparer(preparer)) throw invalidRequest();
    let binding: Readonly<OwnerSeedreamEditorImageCandidateBinding> | undefined;
    let privateRequest: unknown;
    try {
      binding = Reflect.apply(preparer.inspectCandidate, preparer, [candidate]);
      if (!binding) throw invalidRequest();
      privateRequest = Reflect.apply(preparer.getPrivateRequest, preparer, [candidate]);
    } catch { throw invalidRequest(); }
    if (binding.attempt_id !== fields.attemptId || !sameGenerationPrincipal(binding.principal, principal) ||
        binding.variant !== candidate.variant || binding.profile_id !== candidate.profile_id ||
        binding.profile_schema_hash !== candidate.profile_schema_hash ||
        !isDeepStrictEqual(binding.source_binding, candidate.source_binding) ||
        candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.profile_id !== "seedream-editor-generation-source-profile-v1" ||
        candidate.source_readiness !== "SOURCE_JOINED_GENUINE_EDITOR_REFERENCES_AND_EXPLICIT_CONTROLS" ||
        candidate.cost_route.family !== "seedream" || candidate.cost_route.variant !== candidate.variant ||
        !OWNER_SEEDREAM_IMAGE_VARIANTS.includes(candidate.variant) || candidate.variant !== binding.variant) throw invalidRequest();

    const request = readExactDataRecord(privateRequest, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0) throw invalidRequest();
    const parameters = readExactDataRecord(candidate.parameters, ["aspect_ratio", "resolution"], ["aspect_ratio", "resolution"]);
    const settings = readExactDataRecord(request.settings,
      ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls"],
      ["n", "stream", "model_type", "aspect_ratio", "resolution", "file_urls"]);
    if (settings.n !== 1 || settings.stream !== false || settings.model_type !== candidate.variant ||
        settings.aspect_ratio !== parameters.aspect_ratio || settings.resolution !== parameters.resolution ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) ||
        settings.file_urls.length < 1 || settings.file_urls.length > 2 ||
        (settings.file_urls.length !== candidate.references.length && !(candidate.references.length === 2 && settings.file_urls.length === 1)) ||
        candidate.references.length !== (binding.drawing_handle === null ? 1 : 2) ||
        candidate.references[0]?.role !== "original" ||
        (candidate.references.length === 2 && candidate.references[1]?.role !== "drawing")) throw invalidRequest();
    const seenUrls = new Set<string>();
    for (const fileInput of settings.file_urls) {
      const file = readExactDataRecord(fileInput, ["type", "url"], ["type", "url"]);
      if (file.type !== "image" || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) || seenUrls.has(file.url)) throw invalidRequest();
      seenUrls.add(file.url);
    }
    const expectedCost = candidate.variant === "seedream-5.0-pro"
      ? { batch_size: binding.drawing_handle === null ? 1 : 2, resolution: parameters.resolution }
      : {};
    if (!isDeepStrictEqual(candidate.cost_inputs, expectedCost)) throw invalidRequest();
    const safeSettings = sanitizeSettings(settings);
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };

    if (chat.phase !== "AVAILABLE" || chats.get(fields.chat_uuid) !== chat) throw invalidRequest();
    chat.phase = "RESERVED";
    let permitConsumed = false;
    try {
      await policy.revalidateOwnerSeedreamEditorImageOneShotPermit({ permit: fields.permit as OwnerSeedreamEditorImageOneShotPermit,
        candidate, preparer, principal, attemptId: fields.attemptId });
      if (signal?.aborted) throw abortError("external");
      if (chat.phase !== "RESERVED" || chats.get(fields.chat_uuid) !== chat) throw invalidRequest();
      const consumed = policy.consumeOwnerSeedreamEditorImageOneShotPermit({ permit: fields.permit as OwnerSeedreamEditorImageOneShotPermit,
        candidate, preparer, principal, attemptId: fields.attemptId });
      if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
          consumed.request_fingerprint !== candidate.request_fingerprint ||
          consumed.request_fingerprint !== binding.request_fingerprint) throw invalidRequest();
      permitConsumed = true;
      const reservation: Readonly<OwnerSeedreamEditorStartReservation> = Object.freeze({ preparer, candidate, principal,
        attemptId: fields.attemptId, binding, request_fingerprint: consumed.request_fingerprint });
      chat.reservation = reservation;
      chat.phase = "OUTCOME_UNKNOWN";
      chat.recoveryWitness = mintOwnerSeedreamEditorPostDispatchWitness(this, chat, reservation);
      const receipt = await this.#startMedia("design/generate", "seedream", fields.chat_uuid, body, signal);
      if (chat.phase !== "OUTCOME_UNKNOWN" || chats.get(fields.chat_uuid) !== chat) throw invalidRequest();
      chat.phase = "ACKNOWLEDGED";
      chat.started = Object.freeze({ ...reservation, owner_echo_message_id: receipt.message_id });
      return receipt;
    } catch (error) {
      if (!permitConsumed && chat.phase === "RESERVED" && chats.get(fields.chat_uuid) === chat) chat.phase = "AVAILABLE";
      throw error;
    }
  }

  /** Retrieves only the native witness minted at the exact one-shot POST boundary for this private Editor chat. */
  getSeedreamEditorImagePostDispatchWitness(
    input: Readonly<{ attemptId: string; chat_uuid: string }> | unknown
  ): OwnerSeedreamEditorImagePostDispatchWitness {
    const fields = readExactDataRecord(input, ["attemptId", "chat_uuid"], ["attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    const chat = ownerSeedreamEditorChats.get(this)?.get(fields.chat_uuid);
    const witness = chat?.recoveryWitness;
    const state = witness && ownerSeedreamEditorPostDispatchWitnesses.get(witness);
    if (!chat || !witness || !state || state.client !== this || state.chat !== chat || state.epoch !== chat.epoch ||
        state.operation.attemptId !== fields.attemptId || !assertEditorPostDispatchWitnessCurrent(witness, state) ||
        (chat.phase !== "OUTCOME_UNKNOWN" && chat.phase !== "ACKNOWLEDGED")) throw invalidRequest();
    return witness;
  }

  /** Revokes this client's private Editor chats and post-dispatch read witnesses for one link attempt. */
  invalidateSeedreamEditorImageAttempt(attemptId: string): void {
    if (typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) throw invalidRequest();
    const chats = ownerSeedreamEditorChats.get(this); if (!chats) return;
    for (const [chatUuid, chat] of chats) {
      const operation = chat.started ?? chat.reservation;
      if ((operation?.attemptId ?? chat.attemptId) !== attemptId) continue;
      chat.phase = "DELETED";
      if (chat.recoveryWitness) ownerSeedreamEditorPostDispatchWitnesses.delete(chat.recoveryWitness);
      delete chat.recoveryWitness;
      chats.delete(chatUuid);
    }
  }

  /** Reads only this client's owned Editor chat; incomplete history never becomes a complete canonical snapshot. */
  async listSeedreamEditorImageResultCandidates(
    input: ListSeedreamEditorImageResultCandidatesInput | OwnerSeedreamEditorImagePostDispatchWitness | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSeedreamEditorImageResultCandidates> {
    let chat: OwnerSeedreamEditorChatState | undefined;
    let operation: Readonly<OwnerSeedreamEditorStartReservation> | undefined;
    let witness: OwnerSeedreamEditorImagePostDispatchWitness | undefined;
    const witnessState = input && typeof input === "object" && !types.isProxy(input) && !Array.isArray(input)
      ? ownerSeedreamEditorPostDispatchWitnesses.get(input as object) : undefined;
    if (witnessState) {
      witness = input as OwnerSeedreamEditorImagePostDispatchWitness;
      chat = witnessState.chat; operation = chat.started ?? chat.reservation;
      if (witnessState.client !== this || !assertEditorPostDispatchWitnessCurrent(witness, witnessState) ||
          !operation || !assertEditorOperationCurrent(this, chat, operation) || chat.recoveryWitness !== witness ||
          (chat.phase !== "ACKNOWLEDGED" && chat.phase !== "OUTCOME_UNKNOWN")) throw invalidRequest();
    } else {
      const fields = readExactDataRecord(input,
        ["preparer", "candidate", "principal", "attemptId", "chat_uuid"],
        ["preparer", "candidate", "principal", "attemptId", "chat_uuid"]);
      if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
          typeof fields.chat_uuid !== "string") throw invalidRequest();
      validatePathIdentifier(fields.chat_uuid);
      let principal: Readonly<GenerationPrincipalRef>;
      try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
      catch { throw invalidRequest(); }
      chat = ownerSeedreamEditorChats.get(this)?.get(fields.chat_uuid);
      operation = chat?.started ?? chat?.reservation;
      if (!chat || (chat.phase !== "ACKNOWLEDGED" && chat.phase !== "OUTCOME_UNKNOWN") || !operation ||
          operation.preparer !== fields.preparer || operation.candidate !== fields.candidate || operation.attemptId !== fields.attemptId ||
          !sameGenerationPrincipal(operation.principal, principal) || !sameEditorCandidateBinding(operation)) throw invalidRequest();
    }
    if (!chat || !operation) throw invalidRequest();
    const ownerEcho = chat.started?.owner_echo_message_id;
    const gaps: OwnerSeedreamEditorImageNativeGap[] = ownerEcho === undefined ? ["POST_OUTCOME_UNKNOWN", "OWNER_ACK_UNAVAILABLE"] : [];

    let progress: InProgressMessage[] = [];
    try {
      progress = await Reflect.apply(NATIVE_LIST_IN_PROGRESS, this, [chat.chat_uuid, signal]) as InProgressMessage[];
    } catch {
      gaps.push("HISTORY_READ_INCOMPLETE");
    }
    if (!assertEditorOperationCurrent(this, chat, operation)) throw invalidRequest();
    const uniqueProgress: InProgressMessage[] = [];
    const progressMessageIds = new Set<string>();
    for (const entry of progress) {
      if (progressMessageIds.has(entry.message_id)) { gaps.push("IN_PROGRESS_DUPLICATE_MESSAGE_ID"); continue; }
      progressMessageIds.add(entry.message_id);
      uniqueProgress.push(entry);
    }

    const history = await this.#readSeedreamEditorHistory(chat.chat_uuid, signal,
      () => assertEditorOperationCurrent(this, chat, operation));
    if (!assertEditorOperationCurrent(this, chat, operation)) throw invalidRequest();
    gaps.push(...history.gaps);

    const mintProgressContexts = (providerChatId?: string): OwnerSeedreamEditorImageResultMessageContext[] => {
      return uniqueProgress.map((entry) => mintOwnerSeedreamEditorResultContext(this, chat, operation, {
        chat_uuid: chat.chat_uuid, message_id: entry.message_id, variant: operation.candidate.variant,
        ...(providerChatId === undefined ? {} : { provider_chat_id: providerChatId }),
        ...(ownerEcho === undefined ? {} : { owner_echo_message_id: ownerEcho })
      }, witness));
    };
    const addProgressPendingGap = (): void => {
      if (progress.length > 0) gaps.push("IN_PROGRESS_ENTRIES_AWAITING_MESSAGE_READ");
    };
    const hasUnexpectedOwner = history.messages.some((row) => row.author_id > 0 &&
      (ownerEcho === undefined || row.id !== ownerEcho));

    if (!history.complete) {
      addProgressPendingGap();
      if (hasUnexpectedOwner) gaps.push("HISTORY_UNEXPECTED_OWNER_MESSAGE");
      const historyWasUnavailable = !history.unproven && history.gaps.length > 0 &&
        history.gaps.every((code) => code === "HISTORY_READ_INCOMPLETE");
      if (progress.length > 0 && historyWasUnavailable && !hasUnexpectedOwner) {
        const contexts = mintProgressContexts();
        return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "IN_PROGRESS" as const,
          ...(ownerEcho === undefined ? {} : { owner_echo_message_id: ownerEcho }),
          history_binding_status: ownerEcho === undefined ? "UNVERIFIED" as const : "PARTIAL" as const,
          history_page_status: "INCOMPLETE" as const, gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
      }
      const partialHistoryContexts = progress.length === 0 && ownerEcho === undefined && history.provider_chat_id !== undefined &&
        !history.unproven && !hasUnexpectedOwner
        ? history.messages.filter((row) => row.author_id === BOT_AUTHOR_ID).map((row) =>
          mintOwnerSeedreamEditorResultContext(this, chat, operation, { chat_uuid: chat.chat_uuid,
            message_id: row.id, variant: operation.candidate.variant, provider_chat_id: history.provider_chat_id! }, witness))
        : [];
      return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "HISTORY" as const,
        ...(ownerEcho === undefined ? {} : { owner_echo_message_id: ownerEcho }),
        history_binding_status: "UNVERIFIED" as const,
        history_page_status: history.unproven ? "UNPROVEN" as const : "INCOMPLETE" as const,
        gaps: Object.freeze(gaps), contexts: Object.freeze(partialHistoryContexts) });
    }

    const providerChatId = history.provider_chat_id;
    if (!providerChatId || history.messages.length === 0) {
      addProgressPendingGap();
      return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "HISTORY" as const,
        ...(ownerEcho === undefined ? {} : { owner_echo_message_id: ownerEcho }), history_binding_status: "UNVERIFIED" as const,
        history_page_status: "COMPLETE" as const, gaps: Object.freeze([...gaps, "HISTORY_EMPTY" as const]), contexts: Object.freeze([]) });
    }
    if (hasUnexpectedOwner) {
      addProgressPendingGap();
      return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "HISTORY" as const,
        ...(ownerEcho === undefined ? {} : { owner_echo_message_id: ownerEcho }),
        history_binding_status: "UNVERIFIED" as const, history_page_status: "COMPLETE" as const,
        gaps: Object.freeze([...gaps, "HISTORY_UNEXPECTED_OWNER_MESSAGE" as const]), contexts: Object.freeze([]) });
    }
    if (ownerEcho === undefined) {
      const botRows = history.messages.filter((row) => row.author_id === BOT_AUTHOR_ID);
      if (botRows.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
      addProgressPendingGap();
      const contexts = botRows.map((row) => mintOwnerSeedreamEditorResultContext(this, chat, operation, {
        chat_uuid: chat.chat_uuid, message_id: row.id, variant: operation.candidate.variant, provider_chat_id: providerChatId
      }, witness));
      return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "HISTORY" as const,
        history_binding_status: "UNVERIFIED" as const, history_page_status: "COMPLETE" as const,
        gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
    }

    const snapshot = Object.freeze({ complete: true as const, page: 1 as const, page_size: 10 as const,
      total_count: history.messages.length, total_pages: history.messages.length === 0 ? 0 : Math.ceil(history.messages.length / 10),
      has_next: false as const, has_previous: false as const, requested_chat_uuid: chat.chat_uuid,
      provider_chat_id: providerChatId, messages: history.messages.map((row) => Object.freeze({ message_id: row.id,
        provider_chat_id: providerChatId, author_role: row.id === ownerEcho && row.author_id > 0 ? "owner" as const :
          row.author_id === BOT_AUTHOR_ID ? "bot" as const : "other" as const,
        objects: Object.freeze(row.message_object.map((object) => Object.freeze({ message_object_id: object.id,
          object_type: object.object_type, model_type: object.model_type ?? null }))) })) });
    const binding = correlateOwnerSeedreamEditorImageHistoryBinding({ snapshot, requested_chat_uuid: chat.chat_uuid,
      owner_echo_message_id: ownerEcho, variant: operation.candidate.variant });
    const contexts = binding.status === "BOUND" ? binding.candidate_message_ids.map((messageId) => mintOwnerSeedreamEditorResultContext(this, chat, operation, {
      chat_uuid: chat.chat_uuid, message_id: messageId, variant: operation.candidate.variant, provider_chat_id: binding.provider_chat_id,
      owner_echo_message_id: ownerEcho
    }, witness)) : [];
    addProgressPendingGap();
    if (binding.status === "PENDING") gaps.push("HISTORY_BINDING_PENDING");
    if (binding.status === "INVALID") gaps.push("HISTORY_BINDING_INVALID");
    if (binding.status === "BOUND" && contexts.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
    return Object.freeze({ chat_uuid: chat.chat_uuid, candidate_source: "HISTORY" as const, owner_echo_message_id: ownerEcho,
      history_binding_status: binding.status === "BOUND" ? "BOUND" as const : binding.status === "PENDING" ? "PARTIAL" as const : "UNVERIFIED" as const,
      history_page_status: "COMPLETE" as const, gaps: Object.freeze(gaps), contexts: Object.freeze(contexts) });
  }

  /** Fixed GET for a nominal context minted from this client's private Editor chat. */
  async getSeedreamEditorImageResult(
    contextInput: OwnerSeedreamEditorImageResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSeedreamEditorImageResult> {
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput) || Array.isArray(contextInput)) throw invalidRequest();
    const state = ownerSeedreamEditorResultContexts.get(contextInput as object);
    if (!state || state.context !== contextInput || state.client !== this ||
        !assertEditorOperationCurrent(this, state.chat, state.operation) || state.chat.epoch !== state.epoch ||
        !(state.witness ? assertEditorPostDispatchWitnessCurrent(state.witness,
          ownerSeedreamEditorPostDispatchWitnesses.get(state.witness)) : sameEditorCandidateBinding(state.operation))) throw invalidRequest();
    const context = state.context;
    const raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
      "GET", undefined, "JSON_REQUIRED", signal);
    if (!assertEditorOperationCurrent(this, state.chat, state.operation) || state.chat.epoch !== state.epoch ||
        !(state.witness ? assertEditorPostDispatchWitnessCurrent(state.witness,
          ownerSeedreamEditorPostDispatchWitnesses.get(state.witness)) : sameEditorCandidateBinding(state.operation))) throw invalidRequest();
    const decoderContext: OwnerSeedreamEditorImageResultReadContext = Object.freeze({ chat_uuid: context.chat_uuid,
      message_id: context.message_id, variant: context.variant,
      ...(context.provider_chat_id === undefined ? {} : { provider_chat_id: context.provider_chat_id }) });
    return decodeOwnerSeedreamEditorImageResult(raw, decoderContext);
  }

  /** Fixed Flux POST; source-shaped owned candidate and nominal one-shot permit bind the sole dispatch. */
  async startFluxImageWithOwnedCandidate(
    input: StartFluxImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    const candidate = fields.candidate as OwnerFluxImagePreparedCandidate;
    if (principal.connection_id !== fields.attemptId ||
        !isOwnerFluxImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, Date.now()) ||
        candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.ai_name !== "flux" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
        candidate.model_id !== candidate.variant || candidate.model_type !== candidate.variant ||
        !(OWNER_FLUX_IMAGE_MODELS as readonly string[]).includes(candidate.variant)) throw invalidRequest();

    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || candidate.prompt !== request.prompt) throw invalidRequest();
    validateBoundedText(request.prompt, 65_536, true);
    const settingsKeys = ["model_type", "resolution", "cfg", "steps", "image_strength", "workflow_type", "n", "file_urls",
      ...(candidate.variant === "flux-1" ? ["civitai_loras"] : []),
      ...(candidate.variant === "flux-pro-1.1-ultra" ? ["raw"] : [])];
    const settings = readExactDataRecord(request.settings, settingsKeys, settingsKeys);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings }) || settings.model_type !== candidate.variant || settings.n !== 1 ||
        typeof settings.resolution !== "string" || typeof settings.cfg !== "number" || typeof settings.steps !== "number" ||
        typeof settings.image_strength !== "number" || (settings.workflow_type !== "default" && settings.workflow_type !== "civitai") ||
        !Array.isArray(settings.file_urls) || settings.file_urls.length !== candidate.reference_count ||
        (candidate.variant !== "flux-1" && settings.workflow_type !== "default") ||
        (candidate.variant === "flux-pro-1.1-ultra" && settings.raw !== false)) throw invalidRequest();
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerFluxImageOneShotPermit({
      permit: fields.permit as OwnerFluxImageOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "flux", fields.chat_uuid, body, signal);
  }

  /** Fixed Grok T2I POST; the actual 773 candidate and 775 nominal permit bind the sole dispatch. */
  async startGrokT2iImageWithOwnedCandidate(
    input: StartGrokT2iImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);

    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();

    const { OwnerGrokT2iRequestPreparer } = await import("../../application/owner-grok-t2i-request-preparer.js");
    const { consumeOwnerGrokT2iOneShotPermit } = await import("../../application/owner-grok-t2i-one-shot-policy.js");
    const { normalizeOwnerGrokT2iParameters } = await import("../../application/owner-grok-t2i-parameters.js");
    const { projectOwnerGrokT2iCostParameters } = await import("../../application/owner-grok-t2i-cost-parameters.js");

    const preparer = fields.preparer;
    if (!preparer || typeof preparer !== "object" || types.isProxy(preparer) ||
        !(preparer instanceof OwnerGrokT2iRequestPreparer) || Object.getPrototypeOf(preparer) !== OwnerGrokT2iRequestPreparer.prototype ||
        Object.hasOwn(preparer, "isPreparedCandidateForPrincipal")) throw invalidRequest();
    const guard = OwnerGrokT2iRequestPreparer.prototype.isPreparedCandidateForPrincipal;
    const candidate = fields.candidate as OwnerGrokT2iPreparedCandidate;
    let candidateIsCurrent = false;
    try { candidateIsCurrent = Reflect.apply(guard, preparer, [candidate, principal, fields.attemptId]) === true; }
    catch { candidateIsCurrent = false; }
    if (!candidateIsCurrent || !candidate || typeof candidate !== "object" || types.isProxy(candidate) ||
        candidate.status !== "blocked" || candidate.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" ||
        candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" || candidate.ai_name !== "grok_image" ||
        candidate.scope !== "image" || candidate.operation_id !== "generate-image" || candidate.model_id !== candidate.model_type ||
        !GROK_T2I_IMAGE_MODEL_TYPES.has(candidate.model_id) || candidate.reference_count !== candidate.references.length ||
        !Number.isSafeInteger(candidate.expires_at)) throw invalidRequest();

    let normalized: ReturnType<typeof normalizeOwnerGrokT2iParameters>;
    let cost: ReturnType<typeof projectOwnerGrokT2iCostParameters>;
    try {
      normalized = normalizeOwnerGrokT2iParameters({ model_id: candidate.model_id,
        reference_count: candidate.reference_count, parameters: candidate.parameters });
      cost = projectOwnerGrokT2iCostParameters({ model_id: candidate.model_id,
        reference_count: candidate.reference_count, parameters: candidate.parameters });
    } catch { throw invalidRequest(); }
    if (!isDeepStrictEqual(candidate.parameters, normalized.parameters) ||
        !isDeepStrictEqual(candidate.cost_routing, cost.routing) || !isDeepStrictEqual(candidate.cost_inputs, cost.cost_inputs) ||
        !isDeepStrictEqual(candidate.source_cost_binding, cost.source_binding) || candidate.cost_input_confidence !== cost.confidence) {
      throw invalidRequest();
    }
    const sourceWire = readExactDataRecord(candidate.source_wire_binding,
      ["helper", "build_id", "sha256", "confidence"], ["helper", "build_id", "sha256", "confidence"]);
    if (sourceWire.helper !== "video.js" || sourceWire.build_id !== "1791467421" ||
        sourceWire.sha256 !== "sha256:de1f4d8ddb8f79a909aad5a0e62c876995dbaada01946e395d62a3da7e62b2ae" ||
        sourceWire.confidence !== "SOURCE_MAPPED_ORDINARY_EXPLICIT_NOT_RENDERED_GROK_SUBMIT") throw invalidRequest();
    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
        /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(request.prompt) ||
        request.prompt.length + (request.prompt.match(/\n/gu)?.length ?? 0) > candidate.prompt_local_max_utf16_units ||
        candidate.prompt_local_max_utf16_units !== (candidate.model_id === "grok_t2i" || candidate.model_id === "grok_t2i_pro" ? 5_000 : 1_000) ||
        candidate.prompt_limit_confidence !== "SOURCE_UI_BUDGET_LOCAL_REJECTION_NOT_PROVIDER_LIMIT") throw invalidRequest();
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settingsKeys = ["n", "model_type", "aspect_ratio", "resolution", "batch_size",
      ...(candidate.model_id === "grok_imagine_2" ? ["details_quality"] : []), "file_urls"];
    const settings = readExactDataRecord(request.settings, settingsKeys, settingsKeys);
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings }) || settings.n !== 1 || settings.model_type !== candidate.model_id ||
        settings.aspect_ratio !== candidate.parameters.aspect_ratio || settings.resolution !== candidate.parameters.resolution ||
        settings.batch_size !== candidate.parameters.batch_size ||
        (candidate.model_id === "grok_imagine_2" && settings.details_quality !== candidate.parameters.details_quality)) throw invalidRequest();
    const files = snapshotGrokT2iImageFileUrls(settings.file_urls, candidate.reference_count);
    if (!Array.isArray(candidate.references) || types.isProxy(candidate.references) ||
        Object.getPrototypeOf(candidate.references) !== Array.prototype || !Object.isFrozen(candidate.references) ||
        candidate.references.length !== files.length) throw invalidRequest();

    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };
    if (signal?.aborted) throw abortError("external");
    consumeOwnerGrokT2iOneShotPermit({
      permit: fields.permit as OwnerGrokT2iOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "grok_image", fields.chat_uuid, body, signal);
  }

  /** Fixed Soul POST; an actual 821 candidate and 822 nominal permit bind the single native dispatch. */
  async startSoulImageWithOwnedCandidate(
    input: StartSoulImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);

    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();

    const { OwnerSoulImageRequestPreparer } = await import("../../application/owner-soul-image-request-preparer.js");
    const { consumeOwnerSoulImageOneShotPermit } = await import("../../application/owner-soul-image-one-shot-policy.js");

    const preparer = fields.preparer;
    if (!preparer || typeof preparer !== "object" || types.isProxy(preparer) ||
        !(preparer instanceof OwnerSoulImageRequestPreparer) || Object.getPrototypeOf(preparer) !== OwnerSoulImageRequestPreparer.prototype ||
        Object.hasOwn(preparer, "isPreparedCandidateForPrincipal")) throw invalidRequest();
    const candidate = fields.candidate as OwnerSoulImagePreparedCandidate;
    const guard = OwnerSoulImageRequestPreparer.prototype.isPreparedCandidateForPrincipal;
    let candidateIsCurrent = false;
    try { candidateIsCurrent = Reflect.apply(guard, preparer, [candidate, { attemptId: fields.attemptId, principal }]) === true; }
    catch { candidateIsCurrent = false; }
    if (!candidateIsCurrent || !candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) ||
        !Object.isFrozen(candidate) || candidate.status !== "PREPARED_SOURCE_SHAPED" || candidate.dispatch_allowed !== false ||
        candidate.backend_acceptance !== "UNPROVEN" || candidate.provider_execution !== false ||
        candidate.model_id !== "higgsfield-soul" || candidate.ai_name !== "higgsfield-soul" || candidate.model_type !== "higgsfield-soul" ||
        !/^sha256:[a-f0-9]{64}$/u.test(candidate.profile_schema_hash) ||
        candidate.profile_id !== "owner-soul-image-source-profile-v1" || !Number.isSafeInteger(candidate.expires_at_ms) ||
        candidate.source_projection_confidence !== "EXPLICIT_SOURCE_UI_CONTROL_PROJECTION_NOT_CURRENT_CACHED_UI_REQUEST_REPLAY" ||
        (candidate.reference_strength !== "UNRESOLVED_UNCONTROLLED_WIRE_FIELD" &&
          candidate.reference_strength !== "EXPLICIT_SOURCE_FIXED_0_7_BACKEND_UNPROVEN")) throw invalidRequest();

    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable !== false ||
        requestDescriptor.writable !== false || requestDescriptor.configurable !== false) throw invalidRequest();
    const request = readExactDataRecord(requestDescriptor.value, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string") throw invalidRequest();
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = readExactDataRecord(request.settings,
      ["n", "model_type", "quality", "resolution", "batch_size", "enhance_prompt", "seed", "style_id", "reference_id", "file_urls", "style_strength", "reference_strength"],
      ["n", "model_type", "quality", "resolution", "batch_size", "enhance_prompt", "seed", "style_id", "reference_id", "file_urls"]);
    if (settings.n !== 1 || settings.model_type !== "higgsfield-soul" ||
        !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) ||
        Object.getPrototypeOf(settings.file_urls) !== Array.prototype || settings.file_urls.length !== 0 ||
        Object.hasOwn(settings, "version")) throw invalidRequest();
    const hasReferenceStrength = candidate.reference_strength === "EXPLICIT_SOURCE_FIXED_0_7_BACKEND_UNPROVEN";
    if (Object.hasOwn(settings, "reference_strength") !== hasReferenceStrength ||
        Object.hasOwn(candidate.parameters, "reference_strength") !== hasReferenceStrength ||
        (hasReferenceStrength && (settings.reference_strength !== 0.7 || candidate.parameters.reference_strength !== 0.7))) throw invalidRequest();
    const safeSettings = sanitizeSettings(settings);
    if (!isDeepStrictEqual(safeSettings, { ...settings })) throw invalidRequest();
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt, settings: safeSettings };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerSoulImageOneShotPermit({ permit: fields.permit as OwnerSoulImageOneShotPermit,
      candidate, principal, attemptId: fields.attemptId });
    return this.#startMedia("design/generate", "higgsfield-soul", fields.chat_uuid, body, signal);
  }

  /** Fixed Uni POST; a real 803 candidate and 807 one-shot permit bind the single native dispatch. */
  async startUniImageWithOwnedCandidate(
    input: StartUniImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["preparer", "candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);

    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();

    const { OwnerUniImageRequestPreparer } = await import("../../application/owner-uni-image-request-preparer.js");
    const { consumeOwnerUniImageOneShotPermit } = await import("../../application/owner-uni-image-one-shot-policy.js");
    const { OWNER_UNI_IMAGE_MODELS, getOwnerUniImageSourceParameters } = await import("../../application/owner-uni-image-parameters.js");

    const preparer = fields.preparer;
    if (!preparer || typeof preparer !== "object" || types.isProxy(preparer) ||
        !(preparer instanceof OwnerUniImageRequestPreparer) || Object.getPrototypeOf(preparer) !== OwnerUniImageRequestPreparer.prototype ||
        Object.hasOwn(preparer, "isPreparedCandidateForPrincipal")) throw invalidRequest();
    const candidate = fields.candidate as OwnerUniImagePreparedCandidate;
    const guard = OwnerUniImageRequestPreparer.prototype.isPreparedCandidateForPrincipal;
    let candidateIsCurrent = false;
    try { candidateIsCurrent = Reflect.apply(guard, preparer, [candidate, principal, fields.attemptId]) === true; }
    catch { candidateIsCurrent = false; }
    if (!candidateIsCurrent || !candidate || typeof candidate !== "object" || Array.isArray(candidate) || types.isProxy(candidate) ||
        !Object.isFrozen(candidate) || candidate.status !== "blocked" ||
        candidate.source_readiness !== "SOURCE_JOINED_FULL_SETTINGS_OWNED_REFERENCES_AND_PROMPT" ||
        candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        candidate.ai_name !== "luma_image" || candidate.scope !== "image" || candidate.operation_id !== "generate-image" ||
        candidate.model_id !== candidate.model_type || !(OWNER_UNI_IMAGE_MODELS as readonly string[]).includes(candidate.model_id) ||
        !Number.isSafeInteger(candidate.expires_at) || !/^sha256:[a-f0-9]{64}$/u.test(candidate.profile_schema_hash) ||
        candidate.defaults_injected !== false || candidate.prompt_local_max_utf16_units !== 6_000 ||
        candidate.prompt_limit_confidence !== "SOURCE_UI_LOCAL_INPUT_RULE_NOT_PROVIDER_LIMIT" ||
        candidate.cost_input_confidence !== "ROUTING_ONLY_NOT_QUOTE_BILLING_OR_ADMISSION") throw invalidRequest();

    const source = getOwnerUniImageSourceParameters();
    const modelId = candidate.model_id;
    const modelSource = source.models_by_id[modelId];
    const referenceCount = candidate.reference_count;
    if (!Number.isSafeInteger(referenceCount) || referenceCount < modelSource.reference_count.minimum ||
        referenceCount > modelSource.reference_count.maximum || !Array.isArray(candidate.references) ||
        types.isProxy(candidate.references) || Object.getPrototypeOf(candidate.references) !== Array.prototype ||
        !Object.isFrozen(candidate.references) || candidate.references.length !== referenceCount) throw invalidRequest();

    const requestDescriptor = Object.getOwnPropertyDescriptor(candidate, "request");
    if (!requestDescriptor || !("value" in requestDescriptor) || requestDescriptor.enumerable !== false ||
        requestDescriptor.writable !== false || requestDescriptor.configurable !== false) throw invalidRequest();
    const request = readExactDataRecord(requestDescriptor.value, ["prompt", "settings"], ["prompt", "settings"]);
    validateOwnerUniPrompt(request.prompt, modelId, referenceCount, candidate.prompt_local_max_utf16_units);

    const parameterKeys = modelId === "uni-1" ? ["aspect_ratio", "seed", "mode"]
      : modelId === "uni-1.1-modify-image" ? ["seed", "mode"] : ["invert_mask"];
    const parameters = readExactDataRecord(candidate.parameters, parameterKeys, parameterKeys);
    validateOwnerUniParameters(parameters, modelId, source);
    const customKeys = source.custom_settings_fields_by_model[modelId] as readonly string[];
    if (customKeys[0] !== "model_type" || customKeys.includes("file_urls")) throw invalidRequest();
    const expectedCustomSettings = { model_type: modelId, ...parameters };
    const customSettings = readExactDataRecord(candidate.custom_settings, customKeys, customKeys);
    if (!isDeepStrictEqual({ ...customSettings }, expectedCustomSettings)) throw invalidRequest();

    const routing = readExactDataRecord(candidate.cost_routing,
      ["ai_name", "model_type", "declared_parameter_keys", "confidence"],
      ["ai_name", "model_type", "declared_parameter_keys", "confidence"]);
    const expectedRouting = { ai_name: "luma_image", model_type: modelId, declared_parameter_keys: ["model_type"],
      confidence: "RESERVED_ROUTING_ONLY_NOT_QUOTE_OR_ADMISSION" };
    const costInputs = readExactDataRecord(candidate.cost_inputs, [], []);
    if (!isDeepStrictEqual({ ...routing }, expectedRouting) || Object.keys(costInputs).length !== 0) throw invalidRequest();

    const settingsKeys = [...customKeys, "file_urls"];
    const settings = readExactDataRecord(request.settings, settingsKeys, settingsKeys);
    const fileUrls = snapshotOwnerUniImageFileUrls(settings.file_urls, referenceCount, modelSource.reference_count.maximum);
    if (settings.model_type !== modelId || !isDeepStrictEqual(fileUrls, settings.file_urls)) throw invalidRequest();
    const safeSettings = sanitizeSettings(settings);
    const expectedSettings = { ...expectedCustomSettings, file_urls: fileUrls };
    if (!isDeepStrictEqual(safeSettings, expectedSettings)) throw invalidRequest();
    const body: Record<string, JsonValue> = { chat_uuid: fields.chat_uuid, prompt: request.prompt as string, settings: safeSettings };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerUniImageOneShotPermit({ permit: fields.permit as OwnerUniImageOneShotPermit,
      candidate, principal, attemptId: fields.attemptId });
    return this.#startMedia("design/generate", "luma_image", fields.chat_uuid, body, signal);
  }

  /** Fixed Ideogram POST; the actual 698 nominal permit is consumed once immediately before dispatch. */
  async startIdeogramImageWithOwnedCandidate(
    input: StartIdeogramImageWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const fields = readExactDataRecord(input,
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"],
      ["candidate", "permit", "principal", "attemptId", "chat_uuid"]);
    const { getOwnerIdeogramImagePreparedCandidateState, isOwnerIdeogramImagePreparedCandidateForPrincipal } =
      await import("../../application/owner-ideogram-image-request-preparer.js");
    const { consumeOwnerIdeogramImageOneShotPermit } = await import("../../application/owner-ideogram-image-one-shot-policy.js");
    if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
        typeof fields.chat_uuid !== "string") throw invalidRequest();
    validatePathIdentifier(fields.chat_uuid);
    let principal: Readonly<GenerationPrincipalRef>;
    try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
    catch { throw invalidRequest(); }
    if (principal.connection_id !== fields.attemptId) throw invalidRequest();
    const candidate = fields.candidate as OwnerIdeogramImagePreparedCandidate;
    const now = Date.now();
    if (!isOwnerIdeogramImagePreparedCandidateForPrincipal(candidate, principal, fields.attemptId, now) ||
        candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "UNPROVEN" ||
        typeof candidate.mask_present !== "boolean" ||
        (candidate.mask_present && (candidate.model_id !== "ideogram_45" || candidate.mode !== "precise_edit")) ||
        candidate.mask_present !== (candidate.mask_binding !== undefined) ||
        candidate.ai_name !== "ideogram" || candidate.scope !== "image" ||
        candidate.operation_id !== "generate-image" || candidate.model_type !== candidate.model_id ||
        !OWNER_IDEOGRAM_IMAGE_CONTEXTS.some((context) => context.model_id === candidate.model_id && context.mode === candidate.mode)) {
      throw invalidRequest();
    }
    const candidateState = getOwnerIdeogramImagePreparedCandidateState(candidate);
    if (!candidateState || candidateState.candidate !== candidate || candidateState.attemptId !== fields.attemptId ||
        !sameGenerationPrincipal(candidateState.principal, principal) || candidateState.request !== candidate.request ||
        candidateState.expiresAt !== candidate.expires_at || candidateState.profile.model_id !== candidate.model_id ||
        candidateState.profile.mode !== candidate.mode || candidateState.profile.profile_schema_hash !== candidate.profile_schema_hash) {
      throw invalidRequest();
    }
    if (candidate.mask_present) {
      if (!candidateState.maskService || !candidateState.maskHandle || !candidateState.maskResolution || !candidateState.maskBinding ||
          !isDeepStrictEqual(candidate.mask_binding, candidateState.maskBinding)) throw invalidRequest();
    } else if (candidate.mask_binding !== undefined || candidateState.maskHandle !== undefined || candidateState.maskResolution !== undefined ||
        candidateState.maskBinding !== undefined) {
      throw invalidRequest();
    }
    const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["prompt", "settings"]);
    if (typeof request.prompt !== "string") throw invalidRequest();
    if (candidate.prompt_policy === "disabled") {
      if (candidate.mode !== "reframe" || candidate.prompt !== null || request.prompt !== "" ||
          candidate.native_wire_status !== "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE" ||
          candidate.request_prompt_confidence !== "LOCAL_EXPLICIT_EMPTY_SERIALIZATION_NOT_PROVIDER_ACCEPTANCE") throw invalidRequest();
    } else {
      if (candidate.prompt_policy !== "required" || typeof candidate.prompt !== "string" || !candidate.prompt.trim() ||
          request.prompt !== candidate.prompt || candidate.native_wire_status !== "SOURCE_MAPPED" ||
          candidate.request_prompt_confidence !== "SOURCE_REQUIRED_PROMPT") throw invalidRequest();
      validateBoundedText(request.prompt, 10_000, true);
    }
    const sourceMapping = candidate.source_json_mapping;
    if (!isPlainRecord(sourceMapping) || Object.hasOwn(sourceMapping, "file_urls") || Object.hasOwn(sourceMapping, "n")) throw invalidRequest();
    const sourceKeys = Object.keys(sourceMapping);
    const settingsInput = readExactDataRecord(request.settings, [...sourceKeys, "file_urls"], [...sourceKeys, "file_urls"]);
    const files = validateIdeogramImageFileUrls(settingsInput.file_urls, candidate.reference_count, candidate.mask_present);
    if (candidate.reference_count !== candidate.references.length || typeof settingsInput.num_images !== "number" ||
        candidate.parameters.num_images !== settingsInput.num_images || !Number.isInteger(settingsInput.num_images) ||
        settingsInput.num_images < 1 || settingsInput.num_images > 8 ||
        settingsInput.model_type !== candidate.model_id || Object.hasOwn(settingsInput, "mask") || Object.hasOwn(settingsInput, "image_url")) {
      throw invalidRequest();
    }
    const safeSettings = sanitizeSettings(settingsInput);
    const expectedSettings = { ...sourceMapping, file_urls: files };
    if (!isDeepStrictEqual(safeSettings, expectedSettings)) throw invalidRequest();
    if (candidate.mask_present) {
      const originalMask = candidateState.maskResolution;
      if (!originalMask || !candidateState.maskService || !candidateState.maskHandle || !candidate.mask_binding) throw invalidRequest();
      const currentMask = await candidateState.maskService!.resolveMask({ attemptId: fields.attemptId,
        mask_handle: candidateState.maskHandle!, base_reference_handle: candidate.mask_binding!.base_reference_handle,
        ...(signal === undefined ? {} : { signal }) });
      const binding = readExactDataRecord(candidate.mask_binding, ["role", "mask_handle", "base_reference_handle", "base_sha256",
        "pair_sha256", "normal_sha256", "inverse_sha256", "width", "height", "expires_at", "geometry_verified", "epoch", "base_epoch", "confidence_scope"],
      ["role", "mask_handle", "base_reference_handle", "base_sha256", "pair_sha256", "normal_sha256", "inverse_sha256",
        "width", "height", "expires_at", "geometry_verified", "epoch", "base_epoch", "confidence_scope"]);
      const expectedMaskUrl = files[files.length - 1]?.url;
      if (binding.role !== "mask" || binding.confidence_scope !== "LOCAL_MASK_BYTES_ONLY_NOT_PROVIDER_ACCEPTANCE" ||
          binding.geometry_verified !== false ||
          typeof binding.mask_handle !== "string" || typeof binding.base_reference_handle !== "string" ||
          typeof binding.base_sha256 !== "string" || typeof binding.pair_sha256 !== "string" ||
          typeof binding.normal_sha256 !== "string" || typeof binding.inverse_sha256 !== "string" ||
          !Number.isSafeInteger(binding.width) || !Number.isSafeInteger(binding.height) ||
          !Number.isSafeInteger(binding.expires_at) || !Number.isSafeInteger(binding.epoch) || !Number.isSafeInteger(binding.base_epoch) ||
          candidateState.maskHandle !== binding.mask_handle || originalMask.mask_handle !== binding.mask_handle ||
          originalMask.base_reference_handle !== binding.base_reference_handle || originalMask.base_sha256 !== binding.base_sha256 ||
          originalMask.pair_sha256 !== binding.pair_sha256 || originalMask.normal_sha256 !== binding.normal_sha256 ||
          originalMask.inverse_sha256 !== binding.inverse_sha256 || originalMask.width !== binding.width || originalMask.height !== binding.height ||
          originalMask.expires_at !== binding.expires_at || originalMask.epoch !== binding.epoch || originalMask.base_epoch !== binding.base_epoch ||
          currentMask.role !== "mask" || currentMask.attempt_id !== fields.attemptId || currentMask.model_id !== "ideogram_45" ||
          currentMask.mode !== "precise_edit" || currentMask.catalog_version !== candidateState.catalogVersion ||
          currentMask.profile_schema_hash !== candidate.profile_schema_hash || currentMask.mask_handle !== binding.mask_handle ||
          currentMask.base_reference_handle !== binding.base_reference_handle || currentMask.base_sha256 !== binding.base_sha256 ||
          currentMask.pair_sha256 !== binding.pair_sha256 || currentMask.normal_sha256 !== binding.normal_sha256 ||
          currentMask.inverse_sha256 !== binding.inverse_sha256 || currentMask.width !== binding.width || currentMask.height !== binding.height ||
          currentMask.expires_at !== binding.expires_at || currentMask.epoch !== binding.epoch || currentMask.base_epoch !== binding.base_epoch ||
          currentMask.metadata_confidence !== "CONTAINER_METADATA_ONLY" || currentMask.geometry_verified !== false ||
          currentMask.generation_permit !== false || currentMask.primary_url !== currentMask.normal_url ||
          currentMask.primary_url !== expectedMaskUrl || !isSafeUploadReferenceUrl(currentMask.primary_url) ||
          !isDeepStrictEqual(currentMask, originalMask)) throw invalidRequest();
    }
    const body: Record<string, JsonValue> = {
      chat_uuid: fields.chat_uuid,
      prompt: request.prompt,
      settings: safeSettings
    };

    if (signal?.aborted) throw abortError("external");
    consumeOwnerIdeogramImageOneShotPermit({
      permit: fields.permit as OwnerIdeogramImageOneShotPermit,
      candidate,
      principal,
      attemptId: fields.attemptId
    });
    return this.#startMedia("design/generate", "ideogram", fields.chat_uuid, body, signal);
  }

  /** Source-only image-reference bridge. It accepts one owned internal reference, never caller settings URLs. */
  async startImageWithInternalReferences(
    request: StartImageRequest,
    references: readonly InternalUploadReference[],
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_uuid);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const internalReferences = validateOneInternalImageReference(references);
    const settings = sanitizeSettings(request.settings);
    assertNoUnverifiedExternalReferences(settings);
    if (!isEmptyReferenceList(settings.file_urls)) throw invalidRequest();
    const bridgedSettings: JsonValue = {
      ...settings,
      file_urls: [{ type: "image", url: internalReferences[0]!.url }]
    };
    return this.#startMedia(
      "design/generate",
      request.ai_name,
      request.chat_uuid,
      { chat_uuid: request.chat_uuid, prompt: request.prompt, settings: bridgedSettings },
      signal
    );
  }

  /** Internal-only Grok image bridge; public caller URLs and ordinary fallback remain forbidden. */
  async startGrokImageWithInternalReferences(
    request: StartImageRequest,
    references: readonly InternalUploadReference[],
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    if (request.ai_name !== "grok_image") throw invalidRequest();
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_uuid);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = sanitizeSettings(request.settings);
    assertNoUnverifiedExternalReferences(settings);
    if (!isEmptyReferenceList(settings.file_urls)) throw invalidRequest();
    const modelType = readGrokImageModelType(settings.model_type);
    const internalReferences = validateGrokInternalImageReferences(references, modelType);
    validateGrokImageTransportSettings(settings, modelType, internalReferences.length);
    const bridgedSettings: JsonValue = {
      ...settings,
      file_urls: internalReferences.map((reference) => ({ type: "image", url: reference.url }))
    };
    return this.#startMedia(
      "design/generate",
      request.ai_name,
      request.chat_uuid,
      { chat_uuid: request.chat_uuid, prompt: request.prompt, settings: bridgedSettings },
      signal
    );
  }

  async startVideo(
    request: StartVideoRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_id);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = sanitizeSettings(request.settings);
    assertNoUnverifiedExternalReferences(settings);
    return this.#startMedia(
      "video/generate",
      request.ai_name,
      request.chat_id,
      { chat_id: request.chat_id, prompt: request.prompt, settings },
      signal
    );
  }

  /**
   * Internal-only i2v bridge. References must come directly from
   * uploadFileReferences; callers cannot provide arbitrary URLs. The URLs
   * never cross an MCP/public result boundary.
   */
  async startVideoWithInternalReferences(
    request: StartVideoRequest,
    references: readonly InternalUploadReference[],
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_id);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    if (references.length < 1 || references.length > MAX_FILES) throw invalidRequest();
    for (const reference of references) {
      if (!isSafeUploadReferenceUrl(reference.url)) throw invalidRequest();
    }
    const settings = sanitizeSettings(request.settings);
    if (!isEmptyReferenceList(settings.file_urls)) throw invalidRequest();
    const bridgedSettings: JsonValue = {
      ...settings,
      file_urls: references.map((reference) => reference.url)
    };
    return this.#startMedia(
      "video/generate",
      request.ai_name,
      request.chat_id,
      { chat_id: request.chat_id, prompt: request.prompt, settings: bridgedSettings },
      signal
    );
  }

  /** Consumes a nominal one-shot owner context and binds its same-client image upload. */
  async startOwnerKlingI2vVideoWithContext(
    context: unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const outcome = await withCapturedOwnerKlingI2vGenerationContext(this, context, async (uploadContext, captureSignal) => {
      try {
        const request = consumeOwnerKlingI2vGenerationContext(this, context);
        if (request.uploadContext !== uploadContext) throw invalidRequest();
        const reference = readOwnerKlingI2VUploadReferenceForClient(this, uploadContext as OwnerKlingI2VUploadContext);
        if (!reference) throw invalidRequest();
        const settings = sanitizeSettings({ ...request.settings, file_urls: [{ type: "image", url: reference.url }] });
        return Object.freeze({ receipt: await this.#startMedia(
          "video/generate",
          "kling",
          request.chat_id,
          { chat_id: request.chat_id, prompt: request.prompt, settings },
          captureSignal
        ) });
      } catch (error) {
        return Object.freeze({ error });
      }
    }, signal);
    if ("error" in outcome) throw outcome.error;
    return outcome.receipt;
  }

  async startAudio(
    request: StartAudioRequest,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    validateModelIdentifier(request.ai_name);
    validatePathIdentifier(request.chat_uuid);
    validateBoundedText(request.prompt, MAX_PROMPT_BYTES, true);
    const settings = sanitizeSettings(request.settings);
    assertNoUnverifiedExternalReferences(settings);
    return this.#startMedia(
      "audio/generate",
      request.ai_name,
      request.chat_uuid,
      { chat_uuid: request.chat_uuid, prompt: request.prompt, settings },
      signal
    );
  }

  /** Creates one owner STS chat from a genuine preparer candidate and one-shot permit. */
  async createOwnerElevenLabsStsChat(input: unknown, signal?: AbortSignal): Promise<import("./owner-elevenlabs-sts-native-context.js").OwnerElevenLabsStsChatContext> {
    assertNativeOwnerElevenLabsStsClient(this);
    const native = await import("./owner-elevenlabs-sts-native-context.js");
    const packet = createOwnerElevenLabsStsNativeInvocation(this, "create", input,
      (scope: SyntxChatScope, title: string, requestSignal?: AbortSignal) =>
        Reflect.apply(NATIVE_OWNER_ELEVENLABS_STS_CREATE_CHAT, this, [scope, title, requestSignal]));
    return native.createOwnerElevenLabsStsNativeChat(input, packet, signal);
  }

  /** Revalidates and consumes one genuine permit before the sole fixed STS generation POST. */
  async startElevenLabsStsWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt> {
    assertNativeOwnerElevenLabsStsClient(this);
    const native = await import("./owner-elevenlabs-sts-native-context.js");
    const packet = createOwnerElevenLabsStsNativeInvocation(this, "start", input, async (chatUuid: string, body: Record<string, unknown>, requestSignal?: AbortSignal) => {
      const receipt = await this.#startMedia("audio/generate", "elevenlabs", chatUuid, body as Record<string, JsonValue>, requestSignal);
      return receipt;
    });
    return native.startOwnerElevenLabsStsNativeGeneration(input, packet, signal);
  }

  /** Bounded GET-only owned history read; contexts require the exact POST ACK and STS v2 bot object. */
  async listOwnedElevenLabsStsCandidates(input: unknown, signal?: AbortSignal): Promise<import("./owner-elevenlabs-sts-native-context.js").OwnerElevenLabsStsResultCandidates> {
    assertNativeOwnerElevenLabsStsClient(this);
    const native = await import("./owner-elevenlabs-sts-native-context.js");
    const packet = createOwnerElevenLabsStsNativeInvocation(this, "list", input, async (chatUuid: string, page: number, pageSize: number, requestSignal?: AbortSignal) => {
      const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
      url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(pageSize));
      return this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal);
    });
    return native.listOwnerElevenLabsStsNativeCandidates(input, packet, signal);
  }

  /** Reads only an exact result context minted by this client's bounded owned STS history. */
  async getOwnedElevenLabsStsResult(input: unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsResult> {
    assertNativeOwnerElevenLabsStsClient(this);
    const native = await import("./owner-elevenlabs-sts-native-context.js");
    const packet = createOwnerElevenLabsStsNativeInvocation(this, "get", input,
      (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => this.#request(new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", requestSignal));
    return native.getOwnerElevenLabsStsNativeResult(input, packet, signal);
  }

  /** Creates one owner Topaz Astra video-upscaler chat from a genuine candidate. */
  async createOwnerTopazAstraChat(input: unknown, signal?: AbortSignal): Promise<import("./owner-topaz-astra-native-context.js").OwnerTopazAstraChatContext> {
    assertNativeOwnerTopazAstra(this);
    const native = await import("./owner-topaz-astra-native-context.js");
    const packet = createOwnerTopazAstraNativeInvocation(this, "create", input,
      (title: string, requestSignal?: AbortSignal) => Reflect.apply(NATIVE_OWNER_TOPAZ_ASTRA_CREATE_CHAT, this, [title, requestSignal]));
    return native.createOwnerTopazAstraNativeChat(input, packet, signal);
  }

  /** Revalidates and consumes one owned Topaz receipt before its sole fixed generation POST. */
  async startTopazAstraWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt> {
    assertNativeOwnerTopazAstra(this);
    const native = await import("./owner-topaz-astra-native-context.js");
    const packet = createOwnerTopazAstraNativeInvocation(this, "start", input, async (chatUuid: string, body: Record<string, unknown>, requestSignal?: AbortSignal) =>
      this.#startMedia("video/generate", "topaz_astra", chatUuid, body as Record<string, JsonValue>, requestSignal));
    return native.startOwnerTopazAstraNativeGeneration(input, packet, signal);
  }

  /** Bounded GET-only owned Topaz history read. */
  async listOwnedTopazAstraCandidates(input: unknown, signal?: AbortSignal): Promise<import("./owner-topaz-astra-native-context.js").OwnerTopazAstraResultCandidates> {
    assertNativeOwnerTopazAstra(this);
    const native = await import("./owner-topaz-astra-native-context.js");
    const packet = createOwnerTopazAstraNativeInvocation(this, "list", input, async (chatUuid: string, page: number, pageSize: number, requestSignal?: AbortSignal) => {
      const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
      url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(pageSize));
      return this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal);
    });
    return native.listOwnerTopazAstraNativeCandidates(input, packet, signal);
  }

  /** Reads only an exact result context minted by this client's owned Topaz history. */
  async getOwnedTopazAstraResult(input: unknown, signal?: AbortSignal): Promise<import("./owner-topaz-astra-native-context.js").OwnerTopazAstraResult> {
    assertNativeOwnerTopazAstra(this);
    const native = await import("./owner-topaz-astra-native-context.js");
    const packet = createOwnerTopazAstraNativeInvocation(this, "get", input,
      (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => this.#request(new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", requestSignal));
    return native.getOwnerTopazAstraNativeResult(input, packet, signal);
  }

  /** Creates one owner Hailuo-02 I2V video chat from a genuine same-client image candidate. */
  async createOwnerHailuo02I2vChat(input: unknown, signal?: AbortSignal): Promise<import("./owner-hailuo02-i2v-native-context.js").OwnerHailuo02I2vChatContext> {
    assertNativeOwnerHailuo02I2v(this);
    const native = await import("./owner-hailuo02-i2v-native-context.js");
    const packet = createOwnerHailuo02I2vNativeInvocation(this, "create", input,
      (title: string, requestSignal?: AbortSignal) => Reflect.apply(NATIVE_OWNER_HAILUO02_I2V_CREATE_CHAT, this, ["video", title, requestSignal]));
    return native.createOwnerHailuo02I2vChat(input, packet, signal);
  }

  /** Revalidates and consumes one owned Hailuo-02 I2V permit before its sole fixed video POST. */
  async startOwnerHailuo02I2vWithOwnedCandidate(input: unknown, signal?: AbortSignal): Promise<MediaGenerationReceipt> {
    assertNativeOwnerHailuo02I2v(this);
    const native = await import("./owner-hailuo02-i2v-native-context.js");
    const packet = createOwnerHailuo02I2vNativeInvocation(this, "start", input,
      (chatUuid: string, body: Record<string, unknown>, requestSignal?: AbortSignal) =>
        this.#startMedia("video/generate", "hailuo-minimax", chatUuid, body as Record<string, JsonValue>, requestSignal));
    return native.startOwnerHailuo02I2vWithOwnedCandidate(input, packet, signal);
  }

  /** Bounded GET-only history read for the exact owner Hailuo-02 I2V chat and POST acknowledgement. */
  async listOwnedHailuo02I2vCandidates(input: unknown, signal?: AbortSignal): Promise<import("./owner-hailuo02-i2v-native-context.js").OwnerHailuo02I2vResultCandidates> {
    assertNativeOwnerHailuo02I2v(this);
    const native = await import("./owner-hailuo02-i2v-native-context.js");
    const packet = createOwnerHailuo02I2vNativeInvocation(this, "list", input,
      async (chatUuid: string, page: number, pageSize: number, requestSignal?: AbortSignal) => {
        const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page)); url.searchParams.set("page_size", String(pageSize));
        return this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal);
      });
    return native.listOwnerHailuo02I2vCandidates(input, packet, signal);
  }

  /** Reads only an exact result context minted by this client's owned Hailuo-02 I2V history. */
  async getOwnedHailuo02I2vResult(input: unknown, signal?: AbortSignal): Promise<import("./owner-hailuo02-i2v-native-context.js").OwnerHailuo02I2vResult> {
    assertNativeOwnerHailuo02I2v(this);
    const native = await import("./owner-hailuo02-i2v-native-context.js");
    const packet = createOwnerHailuo02I2vNativeInvocation(this, "get", input,
      (chatUuid: string, messageId: string, requestSignal?: AbortSignal) => this.#request(new URL(`chats/${chatUuid}/${messageId}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", requestSignal));
    return native.getOwnerHailuo02I2vResult(input, packet, signal);
  }

  /** Creates one native Video2Audio chat bound to an authentic candidate, before any one-shot permit is minted. */
  async createVideo2AudioChat(input: CreateVideo2AudioChatInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioChatContext> {
    assertNativeOwnerVideo2AudioClient(this);
    const preparerApi = await import("../../application/owner-video2audio-request-preparer.js");
    const operationInput = snapshotOwnerVideo2AudioCreateInput(input, preparerApi);
    validateOwnerVideo2AudioAbortSignal(signal);
    if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");

    let validated: ValidatedOwnerVideo2AudioNativeOperation;
    try { validated = validateOwnerVideo2AudioNativeOperation(this, operationInput, preparerApi); }
    catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
    const operation: Readonly<OwnerVideo2AudioNativeOperation> = Object.freeze({ ...operationInput,
      profile: validated.profile, binding: validated.binding });
    const chats = ownerVideo2AudioNativeChats(this);
    const pending = ownerVideo2AudioNativePendingCreates(this);
    if (OWNER_VIDEO2AUDIO_NATIVE_RESERVED_CANDIDATES.has(operation.candidate) ||
        OWNER_VIDEO2AUDIO_NATIVE_CANDIDATE_CHATS.has(operation.candidate)) {
      throw ownerVideo2AudioNativeError("CHAT_ALREADY_CREATED");
    }
    if (chats.size + pending.size >= OWNER_VIDEO2AUDIO_NATIVE_CHAT_LIMIT) throw ownerVideo2AudioNativeError("CAPACITY_EXCEEDED");
    OWNER_VIDEO2AUDIO_NATIVE_RESERVED_CANDIDATES.add(operation.candidate);
    pending.add(operation.candidate);
    let createPostPossible = false;
    try {
      await operation.preparer.revalidateCandidate(operation.candidate, signal);
      if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");
      assertSameOwnerVideo2AudioCandidateBinding(validated.binding, operation.preparer.inspectCandidate(operation.candidate));
      const privateRequest = validateOwnerVideo2AudioPrivateRequest(
        operation.preparer.getPrivateRequest(operation.candidate), validated.profile, validated.binding, validated.originalDetails
      );
      createPostPossible = true;
      let receipt: CreateChatReceipt;
      try {
        receipt = await Reflect.apply(NATIVE_OWNER_VIDEO2AUDIO_CREATE_CHAT, this,
          ["audio", `owner-video2audio-${randomUUID()}`, signal]) as CreateChatReceipt;
      } catch { throw ownerVideo2AudioNativeError("CHAT_CREATE_UNKNOWN"); }
      if (signal?.aborted) throw ownerVideo2AudioNativeError("CHAT_CREATE_UNKNOWN");
      try { validatePathIdentifier(receipt.chat_uuid); }
      catch { throw ownerVideo2AudioNativeError("CHAT_CREATE_UNKNOWN"); }
      if (chats.has(receipt.chat_uuid)) throw ownerVideo2AudioNativeError("CHAT_CREATE_UNKNOWN");

      const chat: OwnerVideo2AudioChatContext = Object.freeze({
        status: "created",
        chat_uuid: receipt.chat_uuid,
        attempt_id: operation.attemptId,
        principal: operation.principal,
        model_id: "video2audio",
        source_profile_schema_hash: validated.profile.profileSchemaHash,
        intent_fingerprint: operation.candidate.intent_fingerprint,
        request_fingerprint: operation.candidate.request_fingerprint,
        original_sha256: validated.binding.original_sha256,
        original_size: validated.binding.original_size,
        duration_seconds: validated.binding.duration_seconds,
        dispatch_allowed: false,
        backend_acceptance: "UNPROVEN"
      });
      const state: OwnerVideo2AudioNativeChatState = {
        client: this,
        chat,
        profile: validated.profile,
        profileHash: validated.profile.profileSchemaHash,
        binding: validated.binding,
        operation: Object.freeze(operation),
        resultContexts: new Map(),
        phase: "AVAILABLE",
        privatePrompt: privateRequest.prompt,
        ownerEchoMessageId: undefined,
        historyGetCalls: 0
      };
      chats.set(chat.chat_uuid, state);
      OWNER_VIDEO2AUDIO_NATIVE_CHAT_CONTEXTS.set(chat, state);
      OWNER_VIDEO2AUDIO_NATIVE_CANDIDATE_CHATS.set(operation.candidate, state);
      pending.delete(operation.candidate);
      return chat;
    } catch (error) {
      if (!createPostPossible) {
        OWNER_VIDEO2AUDIO_NATIVE_RESERVED_CANDIDATES.delete(operation.candidate);
        pending.delete(operation.candidate);
      }
      if (error instanceof OwnerVideo2AudioNativeError) throw error;
      throw ownerVideo2AudioNativeError(createPostPossible ? "CHAT_CREATE_UNKNOWN" : "CANDIDATE_INVALID");
    }
  }

  /** Consumes the genuine one-shot receipt synchronously before the sole fixed audio/generate POST. */
  async startVideo2AudioWithOwnedCandidate(
    input: StartVideo2AudioWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    assertNativeOwnerVideo2AudioClient(this);
    const [preparerApi, permitApi] = await Promise.all([
      import("../../application/owner-video2audio-request-preparer.js"),
      import("../../application/owner-video2audio-one-shot-policy.js")
    ]);
    const fields = snapshotOwnerVideo2AudioStartInput(input, preparerApi, permitApi);
    validateOwnerVideo2AudioAbortSignal(signal);
    const state = ownerVideo2AudioNativeChatState(this, fields.chat);
    if (state.phase !== "AVAILABLE") throw ownerVideo2AudioNativeError("CHAT_DISPATCH_ALREADY_STARTED");
    const operation = state.operation;
    if (!operation || operation.preparer !== fields.preparer || operation.candidate !== fields.candidate ||
        operation.attemptId !== fields.attemptId || !sameGenerationPrincipal(operation.principal, fields.principal) ||
        OWNER_VIDEO2AUDIO_NATIVE_CANDIDATE_CHATS.get(fields.candidate) !== state) {
      throw ownerVideo2AudioNativeError("CHAT_CONTEXT_INVALID");
    }
    if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");

    state.phase = "RESERVED";
    let dispatchPossible = false;
    try {
      const binding = state.binding;
      if (!binding) throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
      const details = readOwnerVideo2AudioOriginalDetails(this, state.profile, binding.captured_reference, binding);
      const firstPrivateRequest = validateOwnerVideo2AudioPrivateRequest(
        operation.preparer.getPrivateRequest(operation.candidate), state.profile, binding, details
      );
      const permitContext = Object.freeze({ permit: fields.permit, preparer: operation.preparer,
        candidate: operation.candidate, principal: operation.principal, attemptId: operation.attemptId });
      await permitApi.revalidateOwnerVideo2AudioOneShotPermit(permitContext);
      if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");

      const currentBinding = operation.preparer.inspectCandidate(operation.candidate);
      assertSameOwnerVideo2AudioCandidateBinding(binding, currentBinding);
      const privateRequest = validateOwnerVideo2AudioPrivateRequest(
        operation.preparer.getPrivateRequest(operation.candidate), state.profile, binding, details
      );
      if (!isDeepStrictEqual(firstPrivateRequest, privateRequest) || privateRequest.prompt !== state.privatePrompt) {
        throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
      }
      const body = buildOwnerVideo2AudioDispatchBody(state.chat.chat_uuid, privateRequest);
      const consumed = permitApi.consumeOwnerVideo2AudioOneShotPermit(permitContext);
      if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
          consumed.request_fingerprint !== state.chat.request_fingerprint) throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");

      // Detach every input-TTL-bound candidate/reference before possible POST. The following scope is GET-only.
      state.privatePrompt = privateRequest.prompt;
      state.operation = undefined;
      state.binding = undefined;
      state.phase = "OUTCOME_UNKNOWN";
      dispatchPossible = true;
      let receipt: MediaGenerationReceipt;
      try { receipt = await this.#startMedia("audio/generate", "video2audio", state.chat.chat_uuid, body, signal); }
      catch { throw ownerVideo2AudioNativeError("OUTCOME_UNKNOWN"); }
      if (signal?.aborted || receipt.chat_uuid !== state.chat.chat_uuid || !isSafeProviderId(receipt.message_id)) {
        throw ownerVideo2AudioNativeError("OUTCOME_UNKNOWN");
      }
      state.ownerEchoMessageId = receipt.message_id;
      state.phase = "ACKNOWLEDGED";
      return Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: receipt.message_id });
    } catch (error) {
      if (dispatchPossible || state.phase === "OUTCOME_UNKNOWN") {
        state.phase = "OUTCOME_UNKNOWN";
        if (error instanceof OwnerVideo2AudioNativeError && error.code === "OUTCOME_UNKNOWN") throw error;
        throw ownerVideo2AudioNativeError("OUTCOME_UNKNOWN");
      }
      state.phase = "PRE_DISPATCH_FAILED";
      state.operation = undefined;
      state.binding = undefined;
      if (error instanceof OwnerVideo2AudioNativeError) throw error;
      throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
    }
  }

  /** GET-only complete-history correlator; an unknown POST ACK never fabricates a history/result binding. */
  async listOwnedVideo2AudioResultCandidates(
    input: ListOwnedVideo2AudioResultCandidatesInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerVideo2AudioResultCandidates> {
    assertNativeOwnerVideo2AudioClient(this);
    validateOwnerVideo2AudioAbortSignal(signal);
    const { chat, authorizeGet } = snapshotOwnerVideo2AudioAuthorizeGetInput(input, "chat");
    const state = ownerVideo2AudioNativeChatState(this, chat);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") throw ownerVideo2AudioNativeError("CHAT_NOT_DISPATCHED");
    if (!state.privatePrompt) throw ownerVideo2AudioNativeError("CHAT_NOT_DISPATCHED");
    if (!state.ownerEchoMessageId) return emptyOwnerVideo2AudioCandidates(state, "UNVERIFIED", "MISSING", "NOT_READ", ["POST_ACK_UNKNOWN"]);
    if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");

    const pages: unknown[] = [];
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let pageNumber = 1; pageNumber <= Math.min(OWNER_VIDEO2AUDIO_HISTORY_PAGE_LIMIT, Math.max(1, totalPages ?? 1)); pageNumber += 1) {
        if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");
        const url = new URL(`chats/${state.chat.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(pageNumber));
        url.searchParams.set("page_size", String(OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE));
        getCalls += 1;
        state.historyGetCalls += 1;
        await authorizeOwnerVideo2AudioGet(authorizeGet, signal);
        let raw: unknown;
        try { raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal); }
        finally { await authorizeOwnerVideo2AudioGet(authorizeGet, signal); }
        const parsed = OWNER_VIDEO2AUDIO_HISTORY_PAGE_SCHEMA.safeParse(raw);
        if (!parsed.success) return emptyOwnerVideo2AudioCandidates(state, "UNVERIFIED", "MISSING", "UNPROVEN", ["HISTORY_PAGE_INVALID"], getCalls);
        const { messages, pagination } = parsed.data;
        const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE);
        const expectedRows = pagination.total_count === 0 ? 0 : Math.min(OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE,
          Math.max(0, pagination.total_count - (pageNumber - 1) * OWNER_VIDEO2AUDIO_HISTORY_PAGE_SIZE));
        if (expectedPages > OWNER_VIDEO2AUDIO_HISTORY_PAGE_LIMIT || pagination.total_count > OWNER_VIDEO2AUDIO_HISTORY_MESSAGE_LIMIT) {
          return emptyOwnerVideo2AudioCandidates(state, "INCOMPLETE", "MISSING", "INCOMPLETE", ["HISTORY_PAGE_LIMIT"], getCalls,
            pagination.total_count, expectedPages);
        }
        if (pagination.page !== pageNumber || pagination.total_pages !== expectedPages ||
            pagination.has_previous !== (pageNumber > 1) || pagination.has_next !== (pageNumber < expectedPages) ||
            messages.length !== expectedRows || (totalCount !== undefined &&
              (totalCount !== pagination.total_count || totalPages !== pagination.total_pages))) {
          return emptyOwnerVideo2AudioCandidates(state, "UNVERIFIED", "MISSING", "UNPROVEN", ["HISTORY_PAGE_INCONSISTENT"], getCalls,
            pagination.total_count, expectedPages);
        }
        totalCount ??= pagination.total_count;
        totalPages ??= pagination.total_pages;
        pages.push(raw);
        if (pageNumber === Math.max(1, expectedPages)) break;
      }
    } catch (error) {
      if (signal?.aborted || error instanceof OwnerVideo2AudioNativeError) throw error;
      return emptyOwnerVideo2AudioCandidates(state, "UNVERIFIED", "MISSING", "UNPROVEN", ["HISTORY_UNAVAILABLE"], getCalls,
        totalCount ?? null, totalPages ?? null);
    }

    const correlation = correlateOwnerVideo2AudioHistory({ chat_uuid: state.chat.chat_uuid, model_id: "video2audio",
      owner_echo_message_id: state.ownerEchoMessageId, prompt: state.privatePrompt, pages });
    const contexts: OwnerVideo2AudioResultMessageContext[] = [];
    if (correlation.status === "COMPLETE" && correlation.owner_ack_status === "MATCHED" &&
        correlation.history_page_status === "COMPLETE") {
      for (const codecContext of correlation.contexts) {
        const existing = state.resultContexts.get(codecContext.message_id);
        if (existing) {
          const existingState = OWNER_VIDEO2AUDIO_NATIVE_RESULT_CONTEXTS.get(existing);
          if (!existingState || !isDeepStrictEqual(existingState.codecContext, codecContext)) {
            return emptyOwnerVideo2AudioCandidates(state, "UNVERIFIED", "MISMATCH", "UNPROVEN", ["RESULT_CONTEXT_INVALID"], getCalls,
              correlation.contexts.length, pages.length);
          }
          contexts.push(existing);
          continue;
        }
        const context: OwnerVideo2AudioResultMessageContext = Object.freeze({ ...codecContext,
          attempt_id: state.chat.attempt_id,
          principal: state.chat.principal,
          source_profile_schema_hash: state.profileHash,
          intent_fingerprint: state.chat.intent_fingerprint,
          original_sha256: state.chat.original_sha256 });
        OWNER_VIDEO2AUDIO_NATIVE_RESULT_CONTEXTS.set(context, { client: this, chat: state, context, codecContext });
        state.resultContexts.set(context.message_id, context);
        contexts.push(context);
      }
    }
    return Object.freeze({ status: correlation.status, owner_ack_status: correlation.owner_ack_status,
      history_page_status: correlation.history_page_status, history_get_calls: getCalls,
      total_count: totalCount ?? 0, total_pages: totalPages ?? 0, provider_chat_id: correlation.provider_chat_id,
      owner_echo_message_id: correlation.owner_echo_message_id, contexts: Object.freeze(contexts),
      gaps: Object.freeze([...correlation.gaps]), backend_acceptance: "UNPROVEN" });
  }

  /** Reads one exact bot result message using a nominal context from the same native chat. */
  async getOwnedVideo2AudioResult(input: GetOwnedVideo2AudioResultInput | unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioResult> {
    assertNativeOwnerVideo2AudioClient(this);
    validateOwnerVideo2AudioAbortSignal(signal);
    const { context, authorizeGet } = snapshotOwnerVideo2AudioAuthorizeGetInput(input, "context");
    const state = ownerVideo2AudioNativeResultContext(this, context);
    if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");
    try {
      await authorizeOwnerVideo2AudioGet(authorizeGet, signal);
      let raw: unknown;
      try {
        raw = await this.#request(new URL(`chats/${state.codecContext.chat_uuid}/${state.codecContext.message_id}`, V1_BASE_URL),
          "GET", undefined, "JSON_REQUIRED", signal);
      } finally { await authorizeOwnerVideo2AudioGet(authorizeGet, signal); }
      return decodeOwnerVideo2AudioResult(raw, state.codecContext);
    } catch (error) {
      if (signal?.aborted || error instanceof OwnerVideo2AudioNativeError) throw error;
      throw ownerVideo2AudioNativeError("RESULT_GET_UNAVAILABLE");
    }
  }

  /** Clears this client's private V2A state after the trusted owner service has drained the attempt. */
  invalidateVideo2AudioAttempt(attemptId: string): number {
    assertNativeOwnerVideo2AudioClient(this);
    if (typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId)) {
      throw ownerVideo2AudioNativeError("INVALID_REQUEST");
    }
    const chats = OWNER_VIDEO2AUDIO_NATIVE_CHATS.get(this);
    if (!chats) return 0;
    let invalidated = 0;
    for (const [chatUuid, state] of chats) {
      if (state.chat.attempt_id !== attemptId) continue;
      state.operation = undefined;
      state.binding = undefined;
      state.privatePrompt = undefined;
      state.ownerEchoMessageId = undefined;
      state.phase = "INVALIDATED";
      state.client = undefined;
      for (const context of state.resultContexts.values()) {
        const resultState = OWNER_VIDEO2AUDIO_NATIVE_RESULT_CONTEXTS.get(context);
        if (resultState) resultState.client = undefined;
      }
      state.resultContexts.clear();
      chats.delete(chatUuid);
      invalidated += 1;
    }
    return invalidated;
  }

  /** Creates one fresh owner-only Suno audio chat bound to a genuine source candidate and permit. */
  async createOwnerSunoGenerationChat(
    input: CreateOwnerSunoGenerationChatInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoGenerationChatContext> {
    assertNativeOwnerSunoClient(this);
    const operation = snapshotOwnerSunoGenerationStartInput(input);
    validateOwnerSunoGenerationOperation(operation);
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");
    if (OWNER_SUNO_GENERATION_USED_PERMITS.has(operation.permit)) {
      throw ownerSunoGenerationError("CHAT_CONTEXT_ALREADY_CREATED");
    }
    const chats = ownerSunoGenerationChats(this);
    if (chats.size >= OWNER_SUNO_GENERATION_CHAT_LIMIT) throw ownerSunoGenerationError("CAPACITY_EXCEEDED");

    // Reserve before the free chat-create POST too; an uncertain create never authorizes a second chat.
    OWNER_SUNO_GENERATION_USED_PERMITS.add(operation.permit);
    let receipt: CreateChatReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_SUNO_CREATE_CHAT, this,
        ["audio", `owner-suno-generation-${randomUUID()}`, signal]) as CreateChatReceipt;
    } catch { throw ownerSunoGenerationError("CHAT_CREATE_FAILED"); }
    if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");
    try { validatePathIdentifier(receipt.chat_uuid); }
    catch { throw ownerSunoGenerationError("CHAT_CREATE_FAILED"); }

    const currentBinding = validateOwnerSunoGenerationOperation(operation);
    const context: OwnerSunoGenerationChatContext = Object.freeze({
      status: "created",
      chat_uuid: receipt.chat_uuid,
      attempt_id: operation.attemptId,
      principal: operation.principal,
      model_id: currentBinding.model_id,
      intent_fingerprint: currentBinding.intent_fingerprint,
      source_profile_schema_hash: currentBinding.source_profile_schema_hash,
      source_pins: Object.freeze({ ...currentBinding.source_pins }),
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: OwnerSunoGenerationChatState = {
      client: this, chat: context, operation, modelId: currentBinding.model_id,
      phase: "AVAILABLE", resultContexts: new Map()
    };
    chats.set(context.chat_uuid, state);
    OWNER_SUNO_GENERATION_CHAT_CONTEXTS.set(context, state);
    return context;
  }

  /** Consumes a genuine Suno permit synchronously before the sole fixed audio/generate POST. */
  async startSunoWithOwnedCandidate(
    input: StartSunoWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    assertNativeOwnerSunoClient(this);
    const fields = snapshotOwnerSunoGenerationStartInput(input, true);
    const chatContext = fields.chat;
    if (!chatContext) throw ownerSunoGenerationError("CHAT_CONTEXT_INVALID");
    const state = OWNER_SUNO_GENERATION_CHAT_CONTEXTS.get(chatContext);
    if (!state || state.client !== this || state.chat !== chatContext ||
        ownerSunoGenerationChats(this).get(chatContext.chat_uuid) !== state ||
        state.operation.candidate !== fields.candidate || state.operation.permit !== fields.permit ||
        state.operation.preparer !== fields.preparer || state.operation.oneShotPolicy !== fields.oneShotPolicy ||
        state.operation.attemptId !== fields.attemptId || !sameGenerationPrincipal(state.operation.principal, fields.principal)) {
      throw ownerSunoGenerationError("CHAT_CONTEXT_INVALID");
    }
    if (state.phase !== "AVAILABLE") throw ownerSunoGenerationError("CHAT_DISPATCH_ALREADY_STARTED");
    validateOwnerSunoGenerationOperation(state.operation);
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");

    state.phase = "RESERVED";
    let consumed: OwnerSunoGenerationOneShotReceipt;
    try {
      consumed = Reflect.apply(NATIVE_OWNER_SUNO_POLICY_CONSUME, state.operation.oneShotPolicy, [{
        candidate: state.operation.candidate, permit: state.operation.permit,
        attemptId: state.operation.attemptId, principal: state.operation.principal
      }]) as OwnerSunoGenerationOneShotReceipt;
    } catch {
      state.phase = "AVAILABLE";
      throw ownerSunoGenerationError("CANDIDATE_INVALID");
    }
    if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
        consumed.backend_acceptance !== "UNPROVEN" || !consumed.private_request ||
        consumed.intent_fingerprint !== state.chat.intent_fingerprint) {
      state.phase = "PRE_DISPATCH_FAILED";
      throw ownerSunoGenerationError("CANDIDATE_INVALID");
    }
    const privateRequest = validateOwnerSunoGenerationPrivateRequest(consumed.private_request, state);
    state.privatePrompt = privateRequest.prompt;
    const settings = sanitizeSettings({ ...privateRequest.settings, file_urls: [] });
    if (!isPlainRecord(settings) || !Array.isArray(settings.file_urls) || settings.file_urls.length !== 0) {
      state.phase = "PRE_DISPATCH_FAILED";
      throw ownerSunoGenerationError("CANDIDATE_INVALID");
    }
    assertNoUnverifiedExternalReferences(settings);

    // The local reservation begins before entering fetch. Any thrown/late POST outcome is GET-only.
    state.phase = "OUTCOME_UNKNOWN";
    let receipt: MediaGenerationReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_SUNO_START_AUDIO, this, [{
        ai_name: "suno", chat_uuid: state.chat.chat_uuid,
        prompt: privateRequest.prompt, settings
      }, signal]) as MediaGenerationReceipt;
    } catch { throw ownerSunoGenerationError("OUTCOME_UNKNOWN"); }
    if (signal?.aborted) throw ownerSunoGenerationError("OUTCOME_UNKNOWN");
    if (!receipt || receipt.chat_uuid !== state.chat.chat_uuid || !isSafeProviderId(receipt.message_id)) {
      throw ownerSunoGenerationError("OUTCOME_UNKNOWN");
    }
    state.ownerEchoMessageId = receipt.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: receipt.message_id });
  }

  /** Reads all bounded history pages before matching one exact positive owner prompt/model ACK. */
  async listOwnedSunoGenerationCandidates(
    chatInput: OwnerSunoGenerationChatContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoGenerationResultCandidates> {
    assertNativeOwnerSunoClient(this);
    const state = ownerSunoGenerationChatState(this, chatInput);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") {
      throw ownerSunoGenerationError("CHAT_NOT_DISPATCHED");
    }
    if (!state.privatePrompt) throw ownerSunoGenerationError("PRIVATE_REQUEST_UNAVAILABLE");
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");

    const messages: z.infer<typeof OWNER_SUNO_GENERATION_HISTORY_ROW_SCHEMA>[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let page = 1; page <= OWNER_SUNO_GENERATION_HISTORY_PAGE_LIMIT; page += 1) {
        const url = new URL(`chats/${state.chat.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE));
        getCalls += 1;
        const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
        const parsed = OWNER_SUNO_GENERATION_HISTORY_PAGE_SCHEMA.safeParse(raw);
        if (!parsed.success) throw protocolError();
        const { messages: rows, pagination } = parsed.data;
        const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(
          pagination.total_count / OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE);
        const expectedRows = Math.min(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE,
          Math.max(0, pagination.total_count - (page - 1) * OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE));
        if (pagination.page !== page || pagination.total_pages !== expectedPages ||
            pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedPages) ||
            rows.length !== expectedRows) throw protocolError();
        if (expectedPages === 0) {
          if (page !== 1 || pagination.total_count !== 0 || rows.length !== 0) throw protocolError();
          totalCount = 0;
          totalPages = 0;
          break;
        }
        if (totalCount === undefined) { totalCount = pagination.total_count; totalPages = pagination.total_pages; }
        else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) throw protocolError();
        for (const row of rows) {
          const rowProviderChatId = String(row.chat_id);
          if (providerChatId === undefined) providerChatId = rowProviderChatId;
          if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw protocolError();
          messageIds.add(row.id);
          for (const object of row.message_object) {
            if (object.message_id !== row.id || objectIds.has(object.id)) throw protocolError();
            objectIds.add(object.id);
          }
          messages.push(row);
        }
        if (page === expectedPages) {
          if (messages.length !== totalCount || providerChatId === undefined) throw protocolError();
          break;
        }
      }
    } catch {
      if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");
      return emptyOwnerSunoGenerationHistory("UNVERIFIED", getCalls, "HISTORY_UNVERIFIED");
    }

    if (messages.length === 0 || providerChatId === undefined) {
      return emptyOwnerSunoGenerationHistory("PENDING", getCalls, "HISTORY_EMPTY");
    }
    const ownerRows = messages.filter((row) => row.author_id > 0);
    const matchingAcks = ownerRows.filter((row) => isPositiveOwnerSunoAck(row, state.privatePrompt!, state.modelId));
    const ackRows = state.ownerEchoMessageId === undefined
      ? matchingAcks
      : ownerRows.filter((row) => row.id === state.ownerEchoMessageId &&
        isPositiveOwnerSunoAck(row, state.privatePrompt!, state.modelId));
    if (ackRows.length !== 1) {
      const ackStatus = ackRows.length > 1 ? "AMBIGUOUS" : ownerRows.length > 0 ? "MISMATCH" : "MISSING";
      const gapCode: OwnerSunoGenerationNativeGap = ackStatus === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS"
        : ackStatus === "MISMATCH" ? "OWNER_ACK_MISMATCH" : "OWNER_ACK_MISSING";
      return Object.freeze({ status: "INCOMPLETE", owner_ack_status: ackStatus, history_binding_status: "UNVERIFIED",
        history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
        total_pages: totalPages ?? null, provider_chat_id: providerChatId,
        owner_echo_message_id: state.ownerEchoMessageId ?? null, contexts: Object.freeze([]),
        gaps: Object.freeze([gapCode]), backend_acceptance: "UNPROVEN" });
    }
    const ownerEchoMessageId = ackRows[0]!.id;
    state.ownerEchoMessageId = ownerEchoMessageId;
    state.phase = "ACKNOWLEDGED";

    const contexts: OwnerSunoGenerationResultMessageContext[] = [];
    const gaps: OwnerSunoGenerationNativeGap[] = [];
    for (const row of messages) {
      if (row.author_id !== BOT_AUTHOR_ID) continue;
      const audioObjects = row.message_object.filter((object) => object.object_type === "audio");
      if (audioObjects.length === 0) continue;
      const ids = audioObjects.map((object) => object.id);
      if (ids.length > MAX_ARRAY_ITEMS || ids.some((id) => !isSafeProviderId(id)) || new Set(ids).size !== ids.length) {
        gaps.push("AUDIO_OBJECT_IDS_INVALID");
        continue;
      }
      contexts.push(this.#mintOwnerSunoGenerationResultContext(state, {
        chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: state.modelId,
        provider_chat_id: providerChatId, message_object_ids: ids,
        owner_echo_message_id: ownerEchoMessageId, attempt_id: state.chat.attempt_id,
        principal: state.chat.principal, intent_fingerprint: state.chat.intent_fingerprint,
        source_profile_schema_hash: state.chat.source_profile_schema_hash, source_pins: state.chat.source_pins
      }));
    }
    if (contexts.length === 0 && gaps.length === 0) {
      return ownerSunoGenerationHistoryReceipt({ status: "PENDING", ack: "MATCHED", calls: getCalls,
        totalCount: totalCount ?? null, totalPages: totalPages ?? null, providerChatId,
        ownerEchoMessageId, contexts: [], gaps: ["BOT_RESULT_NOT_OBSERVED"] });
    }
    return ownerSunoGenerationHistoryReceipt({ status: contexts.length > 0 ? "COMPLETE" : "UNVERIFIED",
      ack: "MATCHED", calls: getCalls, totalCount: totalCount ?? null, totalPages: totalPages ?? null,
      providerChatId, ownerEchoMessageId, contexts, gaps });
  }

  /** Reads one audio result only through a context minted by this exact client and owned history. */
  async getOwnedSunoGenerationResult(
    contextInput: OwnerSunoGenerationResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoAudioResult> {
    assertNativeOwnerSunoClient(this);
    const owned = ownerSunoGenerationResultContextState(this, contextInput);
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");
    const context = owned.context;
    let raw: unknown;
    try {
      raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", signal);
    } catch {
      if (signal?.aborted) throw ownerSunoGenerationError("REQUEST_ABORTED");
      throw ownerSunoGenerationError("RESULT_GET_FAILED");
    }
    const result = decodeOwnerSunoAudioResult(raw, {
      chat_uuid: context.chat_uuid, message_id: context.message_id, model_id: context.model_id,
      provider_chat_id: context.provider_chat_id, message_object_ids: context.message_object_ids
    });
    owned.trackMetadata = readValidatedOwnerSunoTrackMetadata(raw, result.ready_audio, context.model_id, context.message_id);
    return result;
  }

  /** Reads metadata projected during this exact owner's existing result GET; performs no network request. */
  getOwnedSunoGenerationTrackMetadata(
    contextInput: OwnerSunoGenerationResultMessageContext | unknown
  ): readonly InternalOwnerSunoGenerationTrackMetadata[] {
    assertNativeOwnerSunoClient(this);
    const owned = ownerSunoGenerationResultContextState(this, contextInput);
    return owned.trackMetadata;
  }

  /** Lists only indexed owner ElevenLabs STS chats through this native authenticated client. */
  async listOwnedElevenLabsStsExistingChats(input: unknown, signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingChatPage> {
    assertNativeOwnerElevenLabsStsExistingClient(this);
    const packet = createOwnerElevenLabsStsExistingInvocation(this, "index", input,
      (url, requestSignal) => this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal));
    return await readElevenLabsStsExistingChats(input, packet, signal);
  }

  /** Reads complete bounded history and mints opaque owner bound result contexts. */
  async listOwnedElevenLabsStsExistingCandidates(chat: OwnerElevenLabsStsExistingChatContext | unknown,
    signal?: AbortSignal): Promise<OwnerElevenLabsStsExistingCandidates> {
    assertNativeOwnerElevenLabsStsExistingClient(this);
    const packet = createOwnerElevenLabsStsExistingInvocation(this, "history", chat,
      (url, requestSignal) => this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal));
    return await readElevenLabsStsExistingCandidates(chat, packet, signal);
  }

  /** Reads one exact imported STS message; this surface cannot create a chat or dispatch generation. */
  async getOwnedElevenLabsStsExistingResult(context: OwnerElevenLabsStsExistingResultContext | unknown,
    signal?: AbortSignal): Promise<OwnerElevenLabsStsResult> {
    assertNativeOwnerElevenLabsStsExistingClient(this);
    const packet = createOwnerElevenLabsStsExistingInvocation(this, "result", context,
      (url, requestSignal) => this.#request(url, "GET", undefined, "JSON_REQUIRED", requestSignal));
    return await readElevenLabsStsExistingResult(context, packet, signal);
  }

  /** Reads one bounded page of current-owner MCP-created audio chats; it never creates chats or posts generation. */
  async listOwnedSunoExistingTrackChats(input: unknown, signal?: AbortSignal): Promise<OwnerSunoExistingTrackChatPage> {
    assertNativeOwnerSunoClient(this);
    const request = snapshotOwnerSunoExistingTrackIndexInput(input);
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");
    const url = new URL("chats", V1_BASE_URL);
    url.searchParams.set("scope", "audio");
    url.searchParams.set("page", String(request.page));
    url.searchParams.set("page_size", String(OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE));
    let index: ReturnType<typeof decodeOwnerSunoExistingTrackIndex>;
    try {
      const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
      index = decodeOwnerSunoExistingTrackIndex(raw, request.page);
    } catch (error) {
      if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");
      if (error instanceof OwnerSunoExistingTrackCodecError) throw ownerSunoExistingTrackError(error.code);
      throw ownerSunoExistingTrackError("INDEX_GET_FAILED");
    }

    const chats = ownerSunoExistingTrackChats(this);
    const contexts: OwnerSunoExistingTrackChatContext[] = [];
    for (const source of index.chats) {
      const existing = chats.get(source.chat_uuid);
      if (existing) {
        if (existing.source.provider_chat_id !== source.provider_chat_id || existing.source.title_family !== source.title_family ||
            existing.context.index_page !== index.page || existing.attemptId !== request.attemptId ||
            !sameGenerationPrincipal(existing.principal, request.principal)) throw ownerSunoExistingTrackError("INDEX_UNVERIFIED");
        contexts.push(existing.context);
        continue;
      }
      if (chats.size >= OWNER_SUNO_EXISTING_CONTEXT_CAPACITY) throw ownerSunoExistingTrackError("CAPACITY_EXCEEDED");
      const context: OwnerSunoExistingTrackChatContext = Object.freeze({
        status: "indexed", source_kind: "EXISTING_OWNER_TRACK", chat_uuid: source.chat_uuid,
        provider_chat_id: source.provider_chat_id, title_family: source.title_family,
        index_page: index.page, attempt_id: request.attemptId, principal: request.principal
      });
      const state: OwnerSunoExistingTrackChatState = { client: this, context, source,
        attemptId: request.attemptId, principal: request.principal };
      chats.set(context.chat_uuid, state);
      OWNER_SUNO_EXISTING_TRACK_CHAT_CONTEXTS.set(context, state);
      contexts.push(context);
    }
    return Object.freeze({ ...index, chats: Object.freeze(contexts) });
  }

  /** Validates bounded history and mints distinct imported-result contexts, never generation contexts. */
  async listOwnedSunoExistingTrackCandidates(chatInput: unknown, signal?: AbortSignal): Promise<OwnerSunoExistingTrackCandidates> {
    assertNativeOwnerSunoClient(this);
    const state = ownerSunoExistingTrackChatState(this, chatInput);
    if (state.candidates) return state.candidates;
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");

    const messages: OwnerSunoExistingTrackHistoryRow[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let page = 1; page <= OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES; page += 1) {
        const url = new URL(`chats/${state.context.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(OWNER_SUNO_EXISTING_HISTORY_PAGE_SIZE));
        getCalls += 1;
        const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
        const decoded = decodeOwnerSunoExistingTrackHistoryPage(raw, page, state.context.provider_chat_id);
        const pagination = decoded.pagination;
        if (totalCount === undefined) { totalCount = pagination.total_count; totalPages = pagination.total_pages; }
        else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) throw null;
        for (const row of decoded.messages) {
          const rowProviderChatId = String(row.chat_id);
          if (providerChatId === undefined) providerChatId = rowProviderChatId;
          if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw null;
          messageIds.add(row.id);
          for (const object of row.message_object) {
            if (object.message_id !== row.id || objectIds.has(object.id)) throw null;
            objectIds.add(object.id);
          }
          messages.push(row);
          if (messages.length > OWNER_SUNO_EXISTING_HISTORY_MAX_MESSAGES) throw null;
        }
        if (!pagination.has_next) {
          if (messages.length !== totalCount || (totalPages ?? 0) !== page && messages.length > 0) throw null;
          break;
        }
        if (page === OWNER_SUNO_EXISTING_HISTORY_MAX_PAGES) throw null;
      }
    } catch (error) {
      if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");
      if (error instanceof OwnerSunoExistingTrackNativeError) throw error;
      throw ownerSunoExistingTrackError("HISTORY_UNVERIFIED");
    }

    if (totalCount === undefined || totalPages === undefined) {
      throw ownerSunoExistingTrackError("HISTORY_UNVERIFIED");
    }
    if (messages.length === 0) return Object.freeze({
      status: "INCOMPLETE", owner_ack_status: "MISSING", history_get_calls: getCalls,
      total_count: totalCount, total_pages: totalPages, provider_chat_id: state.context.provider_chat_id,
      contexts: Object.freeze([]), gaps: Object.freeze(["OWNER_ACK_MISSING"] as const)
    });
    if (providerChatId !== state.context.provider_chat_id) throw ownerSunoExistingTrackError("HISTORY_UNVERIFIED");
    const ownerAcks = new Map<OwnerSunoGenerationModel, Array<Readonly<{ row: OwnerSunoExistingTrackHistoryRow; text: string }>>>([
      ["V6", []], ["V6_wild", []]
    ]);
    const botAudioRows = new Map<OwnerSunoGenerationModel, Array<Readonly<{
      row: OwnerSunoExistingTrackHistoryRow; objects: readonly OwnerSunoExistingTrackHistoryRow["message_object"][number][]
    }>>>([["V6", []], ["V6_wild", []]]);
    const gaps = new Set<OwnerSunoExistingTrackGap>();
    for (const row of messages) {
      if (row.author_id > 0 && row.message_object.length === 1) {
        const object = row.message_object[0]!;
        if (object.object_type === "text" && (object.model_type === "V6" || object.model_type === "V6_wild") &&
            typeof object.object_text === "string" && object.object_text.trim().length > 0) {
          ownerAcks.get(object.model_type)!.push({ row, text: object.object_text });
        }
      }
      if (row.author_id !== -1) continue;
      const audioObjects = row.message_object.filter((object) => object.object_type === "audio");
      if (audioObjects.length === 0) continue;
      const modelTypes = new Set(audioObjects.map((object) => object.model_type));
      if (modelTypes.size !== 1 || !["V6", "V6_wild"].includes(audioObjects[0]!.model_type ?? "") ||
          audioObjects.some((object) => object.completed !== true || object.message_id !== row.id || !isSafeProviderId(object.id))) {
        gaps.add("AUDIO_OBJECT_UNVERIFIED");
        continue;
      }
      const modelId = audioObjects[0]!.model_type as OwnerSunoGenerationModel;
      botAudioRows.get(modelId)!.push({ row, objects: Object.freeze(audioObjects) });
    }

    const contexts: OwnerSunoExistingTrackResultMessageContext[] = [];
    const source = existingOwnerSunoSourceBinding();
    let matchedAckCount = 0;
    for (const modelId of OWNER_SUNO_GENERATION_MODEL_IDS) {
      const acks = ownerAcks.get(modelId)!;
      const botRows = botAudioRows.get(modelId)!;
      if (acks.length === 0 && botRows.length === 0) continue;
      if (acks.length === 0) { gaps.add("OWNER_ACK_MISSING"); continue; }
      if (acks.length !== 1) { gaps.add("OWNER_ACK_AMBIGUOUS"); continue; }
      matchedAckCount += 1;
      if (botRows.length === 0) { gaps.add("BOT_RESULT_MISSING"); continue; }
      if (botRows.length !== 1) { gaps.add("BOT_RESULT_AMBIGUOUS"); continue; }
      const ack = acks[0]!;
      const bot = botRows[0]!;
      const intentFingerprint = deriveOwnerSunoExistingTrackIntentFingerprint({ chat_uuid: state.context.chat_uuid,
        owner_echo_message_id: ack.row.id, model_id: modelId, owner_ack_text: ack.text });
      const context: OwnerSunoExistingTrackResultMessageContext = Object.freeze({
        chat_uuid: state.context.chat_uuid, message_id: bot.row.id, model_id: modelId,
        provider_chat_id: state.context.provider_chat_id,
        message_object_ids: Object.freeze(bot.objects.map((object) => object.id)),
        source_kind: "EXISTING_OWNER_TRACK", owner_echo_message_id: ack.row.id,
        attempt_id: state.attemptId, principal: state.principal,
        intent_fingerprint: intentFingerprint, source_profile_schema_hash: source.source_profile_schema_hash,
        source_pins: source.source_pins
      });
      const resultState: OwnerSunoExistingTrackResultContextState = {
        client: this, chat: state, context, artifacts: Object.freeze([])
      };
      OWNER_SUNO_EXISTING_TRACK_RESULT_CONTEXTS.set(context, resultState);
      contexts.push(context);
    }
    if (matchedAckCount === 0 && !gaps.has("OWNER_ACK_AMBIGUOUS")) gaps.add("OWNER_ACK_MISSING");
    const gapsArray = Object.freeze([...gaps]);
    const result: OwnerSunoExistingTrackCandidates = Object.freeze({
      status: contexts.length === 0 ? "UNVERIFIED" : gapsArray.length === 0 ? "COMPLETE" : "INCOMPLETE",
      owner_ack_status: gaps.has("OWNER_ACK_AMBIGUOUS") ? "AMBIGUOUS" : matchedAckCount > 0 ? "MATCHED" : "MISSING",
      history_get_calls: getCalls, total_count: totalCount, total_pages: totalPages,
      provider_chat_id: state.context.provider_chat_id, contexts: Object.freeze(contexts), gaps: gapsArray
    });
    state.candidates = result;
    return result;
  }

  /** Reads and validates one exact imported result message. The first GET is cached on its native context. */
  async getOwnedSunoExistingTrackResult(contextInput: unknown, signal?: AbortSignal): Promise<OwnerSunoExistingTrackVerifiedResult> {
    assertNativeOwnerSunoClient(this);
    const owned = ownerSunoExistingTrackResultContextState(this, contextInput);
    if (owned.result) return Object.freeze({ audio_result: owned.result, artifacts: owned.artifacts });
    validateOwnerSunoAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");
    let raw: unknown;
    try {
      raw = await this.#request(new URL(`chats/${owned.context.chat_uuid}/${owned.context.message_id}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", signal);
      validateOwnerSunoExistingTrackResultEnvelope(raw);
      validateOwnerSunoExistingTrackResultJoin(raw, owned.context);
    } catch (error) {
      if (signal?.aborted) throw ownerSunoExistingTrackError("REQUEST_ABORTED");
      if (error instanceof OwnerSunoExistingTrackCodecError) throw ownerSunoExistingTrackError(error.code);
      throw ownerSunoExistingTrackError("RESULT_GET_FAILED");
    }
    const result = decodeOwnerSunoAudioResult(raw, {
      chat_uuid: owned.context.chat_uuid, message_id: owned.context.message_id,
      model_id: owned.context.model_id, provider_chat_id: owned.context.provider_chat_id,
      message_object_ids: owned.context.message_object_ids
    });
    if (result.message_binding !== "BOUND" || result.model_echo !== "MATCHED" ||
        result.ready_audio.length !== owned.context.message_object_ids.length) throw ownerSunoExistingTrackError("RESULT_UNVERIFIED");
    const readyIds = result.ready_audio.map((audio) => audio.message_object_id);
    if (new Set(readyIds).size !== readyIds.length || owned.context.message_object_ids.some((id) => !readyIds.includes(id))) {
      throw ownerSunoExistingTrackError("RESULT_UNVERIFIED");
    }
    owned.artifacts = readOwnerSunoExistingTrackMetadata(raw, result.ready_audio, owned.context.model_id, owned.context.message_id);
    owned.result = result;
    return Object.freeze({ audio_result: result, artifacts: owned.artifacts });
  }

  /** Synchronous, native-branded metadata/artifact association; empty until the exact result GET validates. */
  getOwnedSunoExistingTrackMetadata(contextInput: unknown): readonly Readonly<OwnerSunoExistingTrackMetadata>[] {
    assertNativeOwnerSunoClient(this);
    return ownerSunoExistingTrackResultContextState(this, contextInput).artifacts;
  }

  /** Creates one fresh private audio chat bound to a genuine source-bound Cover/Extend candidate. */
  async createOwnerSunoTrackOperationChat(
    input: CreateOwnerSunoTrackOperationChatInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoTrackOperationChatContext> {
    assertNativeOwnerSunoClient(this);
    const apis = await loadOwnerSunoTrackOperationModules();
    const operation = snapshotOwnerSunoTrackOperationStartInput(input, false, apis.preparer, apis.policy);
    validateOwnerSunoTrackOperationAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");
    if (OWNER_SUNO_TRACK_OPERATION_USED_PERMITS.has(operation.permit)) {
      throw ownerSunoTrackOperationError("CHAT_CONTEXT_ALREADY_CREATED");
    }
    const chats = ownerSunoTrackOperationChats(this);
    if (chats.size >= OWNER_SUNO_GENERATION_CHAT_LIMIT) throw ownerSunoTrackOperationError("CAPACITY_EXCEEDED");
    validateOwnerSunoTrackOperation(operation, apis.native);

    // Chat creation is one-shot too: a lost free-chat ACK never authorizes a second chat.
    OWNER_SUNO_TRACK_OPERATION_USED_PERMITS.add(operation.permit);
    let receipt: CreateChatReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_SUNO_CREATE_CHAT, this,
        ["audio", `owner-suno-track-operation-${randomUUID()}`, signal]) as CreateChatReceipt;
    } catch { throw ownerSunoTrackOperationError("CHAT_CREATE_FAILED"); }
    if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");
    try {
      validatePathIdentifier(receipt.chat_uuid);
      if (ownerSunoGenerationChats(this).has(receipt.chat_uuid) || chats.has(receipt.chat_uuid)) throw null;
    } catch { throw ownerSunoTrackOperationError("CHAT_CREATE_FAILED"); }

    const binding = validateOwnerSunoTrackOperation(operation, apis.native);
    const context: OwnerSunoTrackOperationChatContext = Object.freeze({
      status: "created", chat_uuid: receipt.chat_uuid, attempt_id: operation.attemptId,
      principal: operation.principal, model_id: binding.model_id, mode: binding.mode,
      intent_fingerprint: binding.intent_fingerprint,
      source_profile_schema_hash: binding.source_profile_schema_hash,
      source_pins: Object.freeze({ ...binding.source_pins }),
      track_context_fingerprint: binding.track_context_fingerprint,
      dispatch_allowed: false, backend_acceptance: "UNPROVEN"
    });
    const state: OwnerSunoTrackOperationChatState = {
      client: this, chat: context, operation, binding,
      modelId: binding.model_id, mode: binding.mode, phase: "AVAILABLE", resultContexts: new Map()
    };
    chats.set(context.chat_uuid, state);
    OWNER_SUNO_TRACK_OPERATION_CHAT_CONTEXTS.set(context, state);
    return context;
  }

  /** Consumes the genuine operation permit before its sole fixed `audio/generate` POST. */
  async startSunoTrackOperationWithOwnedCandidate(
    input: StartSunoTrackOperationWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    assertNativeOwnerSunoClient(this);
    const apis = await loadOwnerSunoTrackOperationModules();
    const fields = snapshotOwnerSunoTrackOperationStartInput(input, true, apis.preparer, apis.policy);
    const chatContext = fields.chat;
    if (!chatContext) throw ownerSunoTrackOperationError("CHAT_CONTEXT_INVALID");
    const state = OWNER_SUNO_TRACK_OPERATION_CHAT_CONTEXTS.get(chatContext);
    if (!state || state.client !== this || state.chat !== chatContext ||
        ownerSunoTrackOperationChats(this).get(chatContext.chat_uuid) !== state ||
        state.operation.candidate !== fields.candidate || state.operation.permit !== fields.permit ||
        state.operation.preparer !== fields.preparer || state.operation.oneShotPolicy !== fields.oneShotPolicy ||
        state.operation.attemptId !== fields.attemptId || !sameGenerationPrincipal(state.operation.principal, fields.principal)) {
      throw ownerSunoTrackOperationError("CHAT_CONTEXT_INVALID");
    }
    if (state.phase !== "AVAILABLE") throw ownerSunoTrackOperationError("CHAT_DISPATCH_ALREADY_STARTED");
    validateOwnerSunoTrackOperation(state.operation, apis.native);
    validateOwnerSunoTrackOperationAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");

    state.phase = "RESERVED";
    let consumed: OwnerSunoTrackOperationOneShotReceipt;
    try {
      consumed = Reflect.apply(apis.native.consume, state.operation.oneShotPolicy, [{
        candidate: state.operation.candidate, permit: state.operation.permit,
        attemptId: state.operation.attemptId, principal: state.operation.principal
      }]) as OwnerSunoTrackOperationOneShotReceipt;
    } catch {
      state.phase = "AVAILABLE";
      throw ownerSunoTrackOperationError("CANDIDATE_INVALID");
    }
    if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
        consumed.backend_acceptance !== "UNPROVEN" || !consumed.private_request ||
        consumed.intent_fingerprint !== state.chat.intent_fingerprint) {
      state.phase = "PRE_DISPATCH_FAILED";
      throw ownerSunoTrackOperationError("CANDIDATE_INVALID");
    }
    state.phase = "PRE_DISPATCH_FAILED";
    const privateRequest = validateOwnerSunoTrackOperationPrivateRequest(consumed.private_request, state);
    const settings = sanitizeSettings({ ...privateRequest.settings, file_urls: [] });
    if (!isPlainRecord(settings) || !Array.isArray(settings.file_urls) || settings.file_urls.length !== 0) {
      throw ownerSunoTrackOperationError("CANDIDATE_INVALID");
    }
    assertNoUnverifiedExternalReferences(settings);
    state.privatePrompt = privateRequest.prompt;

    // From this point, all failures are unknown: reconcile by GET and never repeat POST.
    state.phase = "OUTCOME_UNKNOWN";
    let receipt: MediaGenerationReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_SUNO_START_AUDIO, this, [{
        ai_name: "suno", chat_uuid: state.chat.chat_uuid, prompt: privateRequest.prompt, settings
      }, signal]) as MediaGenerationReceipt;
    } catch { throw ownerSunoTrackOperationError("OUTCOME_UNKNOWN"); }
    if (signal?.aborted) throw ownerSunoTrackOperationError("OUTCOME_UNKNOWN");
    if (!receipt || receipt.chat_uuid !== state.chat.chat_uuid || !isSafeProviderId(receipt.message_id)) {
      throw ownerSunoTrackOperationError("OUTCOME_UNKNOWN");
    }
    state.ownerEchoMessageId = receipt.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: receipt.message_id });
  }

  /** Reconciles a same-chat positive owner prompt/model ACK and mints bounded result GET contexts. */
  async listOwnedSunoTrackOperationCandidates(
    chatInput: OwnerSunoTrackOperationChatContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoTrackOperationResultCandidates> {
    assertNativeOwnerSunoClient(this);
    const state = ownerSunoTrackOperationChatState(this, chatInput);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") {
      throw ownerSunoTrackOperationError("CHAT_NOT_DISPATCHED");
    }
    if (!state.privatePrompt) throw ownerSunoTrackOperationError("PRIVATE_REQUEST_UNAVAILABLE");
    validateOwnerSunoTrackOperationAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");

    const messages: z.infer<typeof OWNER_SUNO_GENERATION_HISTORY_ROW_SCHEMA>[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let page = 1; page <= OWNER_SUNO_GENERATION_HISTORY_PAGE_LIMIT; page += 1) {
        const url = new URL(`chats/${state.chat.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE));
        getCalls += 1;
        const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
        const parsed = OWNER_SUNO_GENERATION_HISTORY_PAGE_SCHEMA.safeParse(raw);
        if (!parsed.success) throw protocolError();
        const { messages: rows, pagination } = parsed.data;
        const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(
          pagination.total_count / OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE);
        const expectedRows = Math.min(OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE,
          Math.max(0, pagination.total_count - (page - 1) * OWNER_SUNO_GENERATION_HISTORY_PAGE_SIZE));
        if (pagination.page !== page || pagination.total_pages !== expectedPages ||
            pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedPages) ||
            rows.length !== expectedRows) throw protocolError();
        if (expectedPages === 0) {
          if (page !== 1 || pagination.total_count !== 0 || rows.length !== 0) throw protocolError();
          totalCount = 0;
          totalPages = 0;
          break;
        }
        if (totalCount === undefined) { totalCount = pagination.total_count; totalPages = pagination.total_pages; }
        else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) throw protocolError();
        for (const row of rows) {
          const rowProviderChatId = String(row.chat_id);
          if (providerChatId === undefined) providerChatId = rowProviderChatId;
          if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw protocolError();
          messageIds.add(row.id);
          for (const object of row.message_object) {
            if (object.message_id !== row.id || objectIds.has(object.id)) throw protocolError();
            objectIds.add(object.id);
          }
          messages.push(row);
        }
        if (page === expectedPages) {
          if (messages.length !== totalCount || providerChatId === undefined) throw protocolError();
          break;
        }
      }
    } catch {
      if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");
      return emptyOwnerSunoTrackOperationHistory("UNVERIFIED", getCalls, "HISTORY_UNVERIFIED");
    }

    if (messages.length === 0 || providerChatId === undefined) {
      return emptyOwnerSunoTrackOperationHistory("PENDING", getCalls, "HISTORY_EMPTY");
    }
    const ownerRows = messages.filter((row) => row.author_id > 0);
    const matchingAcks = ownerRows.filter((row) => isPositiveOwnerSunoAck(row, state.privatePrompt!, state.modelId));
    const ackRows = state.ownerEchoMessageId === undefined
      ? matchingAcks
      : ownerRows.filter((row) => row.id === state.ownerEchoMessageId &&
        isPositiveOwnerSunoAck(row, state.privatePrompt!, state.modelId));
    if (ackRows.length !== 1) {
      const ackStatus = ackRows.length > 1 ? "AMBIGUOUS" : ownerRows.length > 0 ? "MISMATCH" : "MISSING";
      const gapCode: OwnerSunoTrackOperationNativeGap = ackStatus === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS"
        : ackStatus === "MISMATCH" ? "OWNER_ACK_MISMATCH" : "OWNER_ACK_MISSING";
      return Object.freeze({ status: "INCOMPLETE", owner_ack_status: ackStatus, history_binding_status: "UNVERIFIED",
        history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
        total_pages: totalPages ?? null, provider_chat_id: providerChatId,
        owner_echo_message_id: state.ownerEchoMessageId ?? null, contexts: Object.freeze([]),
        gaps: Object.freeze([gapCode]), backend_acceptance: "UNPROVEN" });
    }
    const ownerEchoMessageId = ackRows[0]!.id;
    state.ownerEchoMessageId = ownerEchoMessageId;
    state.phase = "ACKNOWLEDGED";

    const contexts: OwnerSunoTrackOperationResultMessageContext[] = [];
    const gaps: OwnerSunoTrackOperationNativeGap[] = [];
    for (const row of messages) {
      if (row.author_id !== BOT_AUTHOR_ID) continue;
      if (row.message_object.some((object) => object.object_type === "error" && object.model_type === state.modelId) &&
          !gaps.includes("BOT_ERROR_OBSERVED")) {
        gaps.push("BOT_ERROR_OBSERVED");
      }
      const audioObjects = row.message_object.filter((object) => object.object_type === "audio");
      if (audioObjects.length === 0) continue;
      const ids = audioObjects.map((object) => object.id);
      if (ids.length > MAX_ARRAY_ITEMS || ids.some((id) => !isSafeProviderId(id)) || new Set(ids).size !== ids.length) {
        gaps.push("AUDIO_OBJECT_IDS_INVALID");
        continue;
      }
      contexts.push(this.#mintOwnerSunoTrackOperationResultContext(state, {
        chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: state.modelId,
        provider_chat_id: providerChatId, message_object_ids: ids,
        owner_echo_message_id: ownerEchoMessageId, attempt_id: state.chat.attempt_id,
        principal: state.chat.principal, intent_fingerprint: state.chat.intent_fingerprint,
        source_profile_schema_hash: state.chat.source_profile_schema_hash,
        source_pins: state.chat.source_pins, track_context_fingerprint: state.chat.track_context_fingerprint,
        mode: state.mode
      }));
    }
    if (contexts.length === 0 && gaps.includes("BOT_ERROR_OBSERVED")) {
      return Object.freeze({ status: "INCOMPLETE", owner_ack_status: "MATCHED", history_binding_status: "BOUND",
        history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
        total_pages: totalPages ?? null, provider_chat_id: providerChatId, owner_echo_message_id: ownerEchoMessageId,
        contexts: Object.freeze([]), gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
    }
    if (contexts.length === 0 && gaps.length === 0) {
      return ownerSunoTrackOperationHistoryReceipt({ status: "PENDING", ack: "MATCHED", calls: getCalls,
        totalCount: totalCount ?? null, totalPages: totalPages ?? null, providerChatId,
        ownerEchoMessageId, contexts: [], gaps: ["BOT_RESULT_NOT_OBSERVED"] });
    }
    return ownerSunoTrackOperationHistoryReceipt({ status: contexts.length > 0 ? "COMPLETE" : "UNVERIFIED",
      ack: "MATCHED", calls: getCalls, totalCount: totalCount ?? null, totalPages: totalPages ?? null,
      providerChatId, ownerEchoMessageId, contexts, gaps });
  }

  /** Reads one audio result only through a same-client context minted by bounded operation history. */
  async getOwnedSunoTrackOperationResult(
    contextInput: OwnerSunoTrackOperationResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerSunoAudioResult> {
    assertNativeOwnerSunoClient(this);
    const owned = ownerSunoTrackOperationResultContextState(this, contextInput);
    validateOwnerSunoTrackOperationAbortSignal(signal);
    if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");
    const context = owned.context;
    let raw: unknown;
    try {
      raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
        "GET", undefined, "JSON_REQUIRED", signal);
    } catch {
      if (signal?.aborted) throw ownerSunoTrackOperationError("REQUEST_ABORTED");
      throw ownerSunoTrackOperationError("RESULT_GET_FAILED");
    }
    return decodeOwnerSunoAudioResult(raw, {
      chat_uuid: context.chat_uuid, message_id: context.message_id, model_id: context.model_id,
      provider_chat_id: context.provider_chat_id, message_object_ids: context.message_object_ids
    });
  }

  #mintOwnerSunoTrackOperationResultContext(state: OwnerSunoTrackOperationChatState,
    fields: OwnerSunoTrackOperationResultMessageContext): OwnerSunoTrackOperationResultMessageContext {
    const existing = state.resultContexts.get(fields.message_id);
    if (existing) {
      if (schemaHash(existing) !== schemaHash(fields)) throw ownerSunoTrackOperationError("HISTORY_UNVERIFIED");
      return existing;
    }
    const context = Object.freeze({ ...fields,
      principal: Object.freeze({ ...fields.principal }),
      source_pins: Object.freeze({ ...fields.source_pins }),
      message_object_ids: Object.freeze([...fields.message_object_ids]) });
    OWNER_SUNO_TRACK_OPERATION_RESULT_CONTEXTS.set(context, { client: this, chat: state, context });
    state.resultContexts.set(context.message_id, context);
    return context;
  }

  #mintOwnerSunoGenerationResultContext(state: OwnerSunoGenerationChatState,
    fields: OwnerSunoGenerationResultMessageContext): OwnerSunoGenerationResultMessageContext {
    const existing = state.resultContexts.get(fields.message_id);
    if (existing) {
      if (schemaHash(existing) !== schemaHash(fields)) throw ownerSunoGenerationError("HISTORY_UNVERIFIED");
      return existing;
    }
    const context = Object.freeze({ ...fields,
      principal: Object.freeze({ ...fields.principal }),
      source_pins: Object.freeze({ ...fields.source_pins }),
      message_object_ids: Object.freeze([...fields.message_object_ids]) });
    OWNER_SUNO_GENERATION_RESULT_CONTEXTS.set(context, { client: this, chat: state, context, trackMetadata: Object.freeze([]) });
    state.resultContexts.set(context.message_id, context);
    return context;
  }

  /** Creates one fresh owner TTS audio chat; only a genuine prepared candidate/permit can bind it. */
  async createOwnerElevenLabsTtsChat(
    input: CreateOwnerElevenLabsTtsChatInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsTtsChatContext> {
    assertNativeElevenLabsTtsClient(this);
    const operation = snapshotOwnerElevenLabsTtsStartInput(input);
    const binding = validateOwnerElevenLabsTtsOperation(operation);
    if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");
    const existing = OWNER_ELEVENLABS_TTS_CHAT_BY_PERMIT.get(operation.permit);
    if (existing) throw ownerElevenLabsTtsError("CHAT_CONTEXT_ALREADY_CREATED");
    const clientChats = ownerElevenLabsTtsChats(this);
    if (clientChats.size >= OWNER_ELEVENLABS_TTS_CHAT_LIMIT) throw ownerElevenLabsTtsError("CAPACITY_EXCEEDED");

    let receipt: CreateChatReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_ELEVENLABS_TTS_CREATE_CHAT, this,
        ["audio", `owner-elevenlabs-tts-${randomUUID()}`, signal]) as CreateChatReceipt;
    } catch { throw ownerElevenLabsTtsError("CHAT_CREATE_FAILED"); }
    if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");
    validatePathIdentifier(receipt.chat_uuid);
    // Chat creation is free; recheck reference epoch/TTL and the one-shot reservation before retaining it.
    validateOwnerElevenLabsTtsOperation(operation);
    const context: OwnerElevenLabsTtsChatContext = Object.freeze({
      status: "created",
      chat_uuid: receipt.chat_uuid,
      attempt_id: operation.attemptId,
      principal: operation.principal,
      model_id: binding.model_id,
      voice_epoch: binding.voice_epoch,
      expires_at: binding.expires_at,
      intent_fingerprint: binding.intent_fingerprint,
      profile_schema_hash: binding.profile_schema_hash,
      public_catalog_version: OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION,
      settings_inventory_version: OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION,
      dispatch_allowed: false,
      backend_acceptance: "UNPROVEN"
    });
    const state: OwnerElevenLabsTtsChatState = {
      client: this, chat: context, operation, modelId: binding.model_id,
      phase: "AVAILABLE", resultContexts: new Map()
    };
    clientChats.set(context.chat_uuid, state);
    OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS.set(context, state);
    OWNER_ELEVENLABS_TTS_CHAT_BY_PERMIT.set(operation.permit, state);
    return context;
  }

  /** Consumes the genuine one-shot synchronously before its sole fixed audio POST. */
  async startElevenLabsTtsWithOwnedCandidate(
    input: StartElevenLabsTtsWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    assertNativeElevenLabsTtsClient(this);
    const fields = snapshotOwnerElevenLabsTtsStartInput(input, true);
    const chatContext = fields.chat;
    if (!chatContext) throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID");
    const state = OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS.get(chatContext);
    if (!state || state.client !== this || state.chat !== chatContext || state.operation.candidate !== fields.candidate ||
        state.operation.permit !== fields.permit || state.operation.preparer !== fields.preparer ||
        state.operation.oneShotPolicy !== fields.oneShotPolicy || state.operation.attemptId !== fields.attemptId ||
        !sameGenerationPrincipal(state.operation.principal, fields.principal)) throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID");
    if (state.phase !== "AVAILABLE") throw ownerElevenLabsTtsError("CHAT_DISPATCH_ALREADY_STARTED");
    validateOwnerElevenLabsTtsOperation(state.operation);
    if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");

    state.phase = "RESERVED";
    let consumed: OwnerElevenLabsTtsOneShotReceipt;
    try {
      consumed = Reflect.apply(OwnerElevenLabsTtsOneShotPolicy.prototype.consume, state.operation.oneShotPolicy, [{
        candidate: state.operation.candidate, permit: state.operation.permit,
        attemptId: state.operation.attemptId, principal: state.operation.principal
      }]) as OwnerElevenLabsTtsOneShotReceipt;
    } catch (error) {
      state.phase = "AVAILABLE";
      throw ownerElevenLabsTtsError("CANDIDATE_INVALID", error);
    }
    if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false || consumed.backend_acceptance !== "UNPROVEN" ||
        !consumed.private_request || consumed.intent_fingerprint !== state.chat.intent_fingerprint) {
      state.phase = "OUTCOME_UNKNOWN";
      throw ownerElevenLabsTtsError("CANDIDATE_INVALID");
    }
    const privateRequest = validateOwnerElevenLabsTtsPrivateRequest(consumed.private_request, state);
    state.privatePrompt = privateRequest.prompt;
    // Reserve the chat before entering the fetch layer: thrown/late POST outcomes can only be reconciled by GET.
    state.phase = "OUTCOME_UNKNOWN";
    let receipt: MediaGenerationReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_ELEVENLABS_TTS_START_AUDIO, this, [{
        ai_name: "elevenlabs", chat_uuid: state.chat.chat_uuid,
        prompt: privateRequest.prompt, settings: privateRequest.settings
      }, signal]) as MediaGenerationReceipt;
    } catch { throw ownerElevenLabsTtsError("OUTCOME_UNKNOWN"); }
    if (signal?.aborted) throw ownerElevenLabsTtsError("OUTCOME_UNKNOWN");
    if (!receipt || receipt.chat_uuid !== state.chat.chat_uuid || !isSafeProviderId(receipt.message_id)) {
      throw ownerElevenLabsTtsError("OUTCOME_UNKNOWN");
    }
    state.ownerEchoMessageId = receipt.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: receipt.message_id });
  }

  /** GET-only bounded history reader requiring an exact nonempty owner text ACK before minting audio contexts. */
  async listOwnedElevenLabsTtsCandidates(
    chatInput: OwnerElevenLabsTtsChatContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsTtsMessageCandidates> {
    assertNativeElevenLabsTtsClient(this);
    const state = ownerElevenLabsTtsChatState(this, chatInput);
    validateOwnerElevenLabsTtsChatStillBound(state);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") throw ownerElevenLabsTtsError("CHAT_NOT_DISPATCHED");
    if (!state.privatePrompt) throw ownerElevenLabsTtsError("PRIVATE_REQUEST_UNAVAILABLE");
    if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");

    const messages: z.infer<typeof OWNER_ELEVENLABS_TTS_HISTORY_ROW_SCHEMA>[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let page = 1; page <= OWNER_ELEVENLABS_TTS_HISTORY_PAGE_LIMIT; page += 1) {
        const url = new URL(`chats/${state.chat.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE));
        getCalls += 1;
        const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
        const parsed = OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SCHEMA.safeParse(raw);
        if (!parsed.success) throw protocolError();
        const { messages: rows, pagination } = parsed.data;
        const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE);
        const expectedRows = Math.min(OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE,
          Math.max(0, pagination.total_count - (page - 1) * OWNER_ELEVENLABS_TTS_HISTORY_PAGE_SIZE));
        if (pagination.page !== page || pagination.total_pages !== expectedPages || pagination.has_previous !== (page > 1) ||
            pagination.has_next !== (page < expectedPages) || rows.length !== expectedRows) throw protocolError();
        if (expectedPages === 0) {
          if (page !== 1 || pagination.total_count !== 0 || rows.length !== 0) throw protocolError();
          totalCount = 0; totalPages = 0;
          break;
        }
        if (totalCount === undefined) { totalCount = pagination.total_count; totalPages = pagination.total_pages; }
        else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) throw protocolError();
        for (const row of rows) {
          const rowProviderChatId = String(row.chat_id);
          if (providerChatId === undefined) providerChatId = rowProviderChatId;
          if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw protocolError();
          messageIds.add(row.id);
          for (const object of row.message_object) {
            if (object.message_id !== row.id || objectIds.has(object.id)) throw protocolError();
            objectIds.add(object.id);
          }
          messages.push(row);
        }
        if (page === expectedPages) {
          if (messages.length !== totalCount || providerChatId === undefined) throw protocolError();
          break;
        }
      }
    } catch (error) {
      if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");
      return emptyOwnerElevenLabsTtsHistory("UNVERIFIED", getCalls, "HISTORY_UNVERIFIED");
    }

    if (messages.length === 0 || providerChatId === undefined) {
      return emptyOwnerElevenLabsTtsHistory("PENDING", getCalls, "HISTORY_EMPTY");
    }
    const ownerRows = messages.filter((row) => row.author_id > 0);
    const matchingAckRows = ownerRows.filter((row) => isPositiveElevenLabsTtsAck(row, state.privatePrompt!, state.modelId));
    const ackById = state.ownerEchoMessageId === undefined
      ? matchingAckRows
      : ownerRows.filter((row) => row.id === state.ownerEchoMessageId && isPositiveElevenLabsTtsAck(row, state.privatePrompt!, state.modelId));
    if (ackById.length !== 1) {
      const ownerAckStatus = ackById.length > 1 ? "AMBIGUOUS" : ownerRows.length > 0 ? "MISMATCH" : "MISSING";
      return emptyOwnerElevenLabsTtsHistory("INCOMPLETE", getCalls,
        ownerAckStatus === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS" : ownerAckStatus === "MISMATCH" ? "OWNER_ACK_MISMATCH" : "OWNER_ACK_MISSING",
        ownerAckStatus);
    }
    const ownerEchoMessageId = ackById[0]!.id;
    state.ownerEchoMessageId = ownerEchoMessageId;
    state.phase = "ACKNOWLEDGED";
    const contexts: OwnerElevenLabsTtsAudioResultMessageContext[] = [];
    const gaps: string[] = [];
    for (const row of messages) {
      if (row.author_id !== BOT_AUTHOR_ID) continue;
      const audioObjects = row.message_object.filter((object) => object.object_type === "audio");
      if (!audioObjects.length) continue;
      if (audioObjects.some((object) => object.model_type !== state.modelId)) {
        gaps.push("AUDIO_MODEL_ECHO_MISMATCH");
        continue;
      }
      const ids = audioObjects.map((object) => object.id);
      if (!ids.length || ids.length > 64 || new Set(ids).size !== ids.length) {
        gaps.push("AUDIO_OBJECT_IDS_INVALID");
        continue;
      }
      const context = this.#mintOwnerElevenLabsTtsResultContext(state, {
        chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: state.modelId,
        provider_chat_id: providerChatId, message_object_ids: ids,
        owner_echo_message_id: ownerEchoMessageId, attempt_id: state.chat.attempt_id,
        principal: state.chat.principal, voice_epoch: state.chat.voice_epoch,
        intent_fingerprint: state.chat.intent_fingerprint, profile_schema_hash: state.chat.profile_schema_hash,
        public_catalog_version: state.chat.public_catalog_version,
        settings_inventory_version: state.chat.settings_inventory_version
      });
      contexts.push(context);
    }
    if (contexts.length === 0 && gaps.length === 0) {
      return Object.freeze({ status: "PENDING", owner_ack_status: "MATCHED", history_binding_status: "BOUND",
        history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
        total_pages: totalPages ?? null, provider_chat_id: providerChatId, owner_echo_message_id: ownerEchoMessageId,
        contexts: Object.freeze([]), gaps: Object.freeze(["BOT_RESULT_NOT_OBSERVED"]), backend_acceptance: "UNPROVEN" });
    }
    if (contexts.length === 0 && gaps.length > 0) {
      return Object.freeze({ status: "UNVERIFIED", owner_ack_status: "MATCHED", history_binding_status: "PARTIAL",
        history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
        total_pages: totalPages ?? null, provider_chat_id: providerChatId, owner_echo_message_id: ownerEchoMessageId,
        contexts: Object.freeze([]), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
    }
    return Object.freeze({ status: "COMPLETE", owner_ack_status: "MATCHED", history_binding_status: "BOUND",
      history_page_status: "COMPLETE", history_get_calls: getCalls, total_count: totalCount ?? null,
      total_pages: totalPages ?? null, provider_chat_id: providerChatId, owner_echo_message_id: ownerEchoMessageId,
      contexts: Object.freeze(contexts), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  }

  /** Reads only a result message context minted by this exact client from the bound owner TTS chat/history. */
  async getOwnedElevenLabsTtsResult(
    contextInput: OwnerElevenLabsTtsAudioResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsAudioResult> {
    assertNativeElevenLabsTtsClient(this);
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) throw ownerElevenLabsTtsError("RESULT_CONTEXT_INVALID");
    const owned = OWNER_ELEVENLABS_TTS_RESULT_CONTEXTS.get(contextInput);
    if (!owned || owned.client !== this || owned.context !== contextInput ||
        !OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS.has(owned.chat.chat) || owned.chat.phase !== "ACKNOWLEDGED" ||
        owned.context.owner_echo_message_id !== owned.chat.ownerEchoMessageId ||
        owned.context.public_catalog_version !== OWNER_ELEVENLABS_GENERATION_PUBLIC_VERSION ||
        owned.context.settings_inventory_version !== OWNER_ELEVENLABS_GENERATION_SETTINGS_VERSION ||
        owned.context.profile_schema_hash !== owned.chat.chat.profile_schema_hash ||
        owned.context.intent_fingerprint !== owned.chat.chat.intent_fingerprint) throw ownerElevenLabsTtsError("RESULT_CONTEXT_INVALID");
    validateOwnerElevenLabsTtsChatStillBound(owned.chat);
    if (signal?.aborted) throw ownerElevenLabsTtsError("REQUEST_ABORTED");
    const context = owned.context;
    const raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
      "GET", undefined, "JSON_REQUIRED", signal);
    return decodeOwnerElevenLabsAudioResult(raw, {
      chat_uuid: context.chat_uuid, message_id: context.message_id, model_id: context.model_id,
      provider_chat_id: context.provider_chat_id, message_object_ids: context.message_object_ids
    });
  }

  #mintOwnerElevenLabsTtsResultContext(state: OwnerElevenLabsTtsChatState,
    input: OwnerElevenLabsTtsAudioResultMessageContext): OwnerElevenLabsTtsAudioResultMessageContext {
    const existing = state.resultContexts.get(input.message_id);
    if (existing) {
      if (schemaHash(existing) !== schemaHash(input)) throw protocolError();
      return existing;
    }
    const context = Object.freeze({ ...input,
      message_object_ids: Object.freeze([...input.message_object_ids]),
      principal: Object.freeze({ ...input.principal })
    });
    OWNER_ELEVENLABS_TTS_RESULT_CONTEXTS.set(context, { client: this, chat: state, context });
    state.resultContexts.set(context.message_id, context);
    return context;
  }

  /** Creates one fresh owner dialogue chat bound to its prepared candidate and one-shot reservation. */
  async createOwnerElevenLabsDialogueChat(
    input: CreateOwnerElevenLabsDialogueChatInput | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsDialogueChatContext> {
    assertNativeElevenLabsDialogueClient(this);
    const operation = snapshotOwnerElevenLabsDialogueStartInput(input);
    const binding = validateOwnerElevenLabsDialogueOperation(operation);
    if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");
    if (OWNER_ELEVENLABS_DIALOGUE_CHAT_BY_PERMIT.has(operation.permit) ||
        OWNER_ELEVENLABS_DIALOGUE_CREATE_ATTEMPTED.has(operation.permit) ||
        OWNER_ELEVENLABS_DIALOGUE_PENDING_PERMITS.has(operation.permit)) {
      throw ownerElevenLabsDialogueError("CHAT_CONTEXT_ALREADY_CREATED");
    }
    const chats = ownerElevenLabsDialogueChats(this);
    if (chats.size >= OWNER_ELEVENLABS_DIALOGUE_CHAT_LIMIT) throw ownerElevenLabsDialogueError("CAPACITY_EXCEEDED");
    OWNER_ELEVENLABS_DIALOGUE_PENDING_PERMITS.add(operation.permit);
    OWNER_ELEVENLABS_DIALOGUE_CREATE_ATTEMPTED.add(operation.permit);
    try {
      let receipt: CreateChatReceipt;
      try {
        receipt = await Reflect.apply(NATIVE_OWNER_ELEVENLABS_TTS_CREATE_CHAT, this,
          ["audio", `owner-elevenlabs-dialogue-${randomUUID()}`, signal]) as CreateChatReceipt;
      } catch { throw ownerElevenLabsDialogueError("CHAT_CREATE_FAILED"); }
      if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");
      validatePathIdentifier(receipt.chat_uuid);
      if (chats.has(receipt.chat_uuid)) throw protocolError();
      validateOwnerElevenLabsDialogueOperation(operation);
      const chat: OwnerElevenLabsDialogueChatContext = Object.freeze({
        status: "created",
        chat_uuid: receipt.chat_uuid,
        attempt_id: operation.attemptId,
        principal: operation.principal,
        model_id: binding.model_id,
        voice_epoch: binding.voice_epoch,
        intent_fingerprint: binding.intent_fingerprint,
        profile_schema_hash: binding.profile_schema_hash,
        profile_id: operation.candidate.profile_id,
        source_profile_schema_hash: binding.profile_schema_hash,
        dispatch_allowed: false,
        backend_acceptance: "UNPROVEN"
      });
      const state: OwnerElevenLabsDialogueChatState = {
        client: this, chat, operation, modelId: binding.model_id, phase: "AVAILABLE", resultContexts: new Map()
      };
      chats.set(chat.chat_uuid, state);
      OWNER_ELEVENLABS_DIALOGUE_CHAT_CONTEXTS.set(chat, state);
      OWNER_ELEVENLABS_DIALOGUE_CHAT_BY_PERMIT.set(operation.permit, state);
      return chat;
    } finally {
      OWNER_ELEVENLABS_DIALOGUE_PENDING_PERMITS.delete(operation.permit);
    }
  }

  /** Consumes the dialogue permit before its sole fixed audio POST; any possible POST outcome is GET-only. */
  async startOwnerElevenLabsDialogueWithOwnedCandidate(
    input: StartOwnerElevenLabsDialogueWithOwnedCandidateInput | unknown,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    assertNativeElevenLabsDialogueClient(this);
    const fields = snapshotOwnerElevenLabsDialogueStartInput(input, true);
    const chat = fields.chat;
    if (!chat) throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID");
    const state = OWNER_ELEVENLABS_DIALOGUE_CHAT_CONTEXTS.get(chat);
    if (!state || state.client !== this || state.chat !== chat || state.operation.candidate !== fields.candidate ||
        state.operation.permit !== fields.permit || state.operation.preparer !== fields.preparer ||
        state.operation.oneShotPolicy !== fields.oneShotPolicy || state.operation.attemptId !== fields.attemptId ||
        !sameGenerationPrincipal(state.operation.principal, fields.principal)) {
      throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID");
    }
    if (state.phase !== "AVAILABLE") throw ownerElevenLabsDialogueError("CHAT_DISPATCH_ALREADY_STARTED");
    validateOwnerElevenLabsDialogueOperation(state.operation);
    if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");

    let consumed: OwnerElevenLabsDialogueOneShotReceipt;
    try {
      consumed = Reflect.apply(OwnerElevenLabsDialogueOneShotPolicy.prototype.consume, state.operation.oneShotPolicy, [{
        candidate: state.operation.candidate, permit: state.operation.permit,
        attemptId: state.operation.attemptId, principal: state.operation.principal
      }]) as OwnerElevenLabsDialogueOneShotReceipt;
    } catch { throw ownerElevenLabsDialogueError("CANDIDATE_INVALID"); }
    if (consumed.status !== "consumed" || consumed.dispatch_allowed !== false ||
        consumed.backend_acceptance !== "UNPROVEN" || consumed.intent_fingerprint !== state.chat.intent_fingerprint ||
        !consumed.private_request) {
      state.phase = "OUTCOME_UNKNOWN";
      throw ownerElevenLabsDialogueError("CANDIDATE_INVALID");
    }

    let privateRequest: OwnerElevenLabsDialoguePrivateRequest;
    try { privateRequest = validateOwnerElevenLabsDialoguePrivateRequest(consumed.private_request, state); }
    catch { state.phase = "OUTCOME_UNKNOWN"; throw ownerElevenLabsDialogueError("CANDIDATE_INVALID"); }
    state.phase = "OUTCOME_UNKNOWN";
    let receipt: MediaGenerationReceipt;
    try {
      receipt = await Reflect.apply(NATIVE_OWNER_ELEVENLABS_TTS_START_AUDIO, this, [{
        ai_name: "elevenlabs", chat_uuid: state.chat.chat_uuid,
        prompt: privateRequest.prompt, settings: privateRequest.settings
      }, signal]) as MediaGenerationReceipt;
    } catch { throw ownerElevenLabsDialogueError("OUTCOME_UNKNOWN"); }
    if (signal?.aborted || !receipt || receipt.chat_uuid !== state.chat.chat_uuid || !isSafeProviderId(receipt.message_id)) {
      throw ownerElevenLabsDialogueError("OUTCOME_UNKNOWN");
    }
    state.ownerEchoMessageId = receipt.message_id;
    state.phase = "ACKNOWLEDGED";
    return Object.freeze({ chat_uuid: state.chat.chat_uuid, message_id: receipt.message_id });
  }

  /** Bounded GET-only history scan; ACK binding uses the known response ID and the fresh chat, never prompt text. */
  async listOwnedElevenLabsDialogueCandidates(
    chatInput: OwnerElevenLabsDialogueChatContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsDialogueMessageCandidates> {
    assertNativeElevenLabsDialogueClient(this);
    const state = ownerElevenLabsDialogueChatState(this, chatInput);
    validateOwnerElevenLabsDialogueChatStillBound(state);
    if (state.phase !== "ACKNOWLEDGED" && state.phase !== "OUTCOME_UNKNOWN") {
      throw ownerElevenLabsDialogueError("CHAT_NOT_DISPATCHED");
    }
    if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");

    const messages: z.infer<typeof OWNER_ELEVENLABS_DIALOGUE_HISTORY_ROW_SCHEMA>[] = [];
    const messageIds = new Set<string>();
    const objectIds = new Set<string>();
    let providerChatId: string | undefined;
    let totalCount: number | undefined;
    let totalPages: number | undefined;
    let getCalls = 0;
    try {
      for (let page = 1; page <= OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_LIMIT; page += 1) {
        const url = new URL(`chats/${state.chat.chat_uuid}/messages`, V1_BASE_URL);
        url.searchParams.set("page", String(page));
        url.searchParams.set("page_size", String(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE));
        getCalls += 1;
        const raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal);
        const parsed = OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SCHEMA.safeParse(raw);
        if (!parsed.success) throw protocolError();
        const { messages: rows, pagination } = parsed.data;
        const expectedPages = pagination.total_count === 0 ? 0 : Math.ceil(
          pagination.total_count / OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE
        );
        const expectedRows = Math.min(OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE,
          Math.max(0, pagination.total_count - (page - 1) * OWNER_ELEVENLABS_DIALOGUE_HISTORY_PAGE_SIZE));
        if (pagination.page !== page || pagination.total_pages !== expectedPages ||
            pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedPages) ||
            rows.length !== expectedRows) throw protocolError();
        if (expectedPages === 0) {
          if (page !== 1 || pagination.total_count !== 0 || rows.length !== 0) throw protocolError();
          totalCount = 0; totalPages = 0;
          break;
        }
        if (totalCount === undefined) { totalCount = pagination.total_count; totalPages = pagination.total_pages; }
        else if (totalCount !== pagination.total_count || totalPages !== pagination.total_pages) throw protocolError();
        for (const row of rows) {
          const rowProviderChatId = String(row.chat_id);
          if (providerChatId === undefined) providerChatId = rowProviderChatId;
          if (rowProviderChatId !== providerChatId || messageIds.has(row.id)) throw protocolError();
          messageIds.add(row.id);
          for (const object of row.message_object) {
            if (object.message_id !== row.id || objectIds.has(object.id)) throw protocolError();
            objectIds.add(object.id);
          }
          messages.push(row);
        }
        if (page === expectedPages) {
          if (messages.length !== totalCount || providerChatId === undefined) throw protocolError();
          break;
        }
      }
    } catch {
      if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");
      return emptyOwnerElevenLabsDialogueHistory("UNVERIFIED", getCalls, "HISTORY_UNVERIFIED");
    }

    if (messages.length === 0 || providerChatId === undefined) {
      return emptyOwnerElevenLabsDialogueHistory("PENDING", getCalls,
        state.ownerEchoMessageId === undefined ? "OWNER_ACK_UNKNOWN" : "HISTORY_EMPTY",
        state.ownerEchoMessageId === undefined ? "UNKNOWN" : "MISSING");
    }
    // A lost response has no trustworthy ACK identifier. Do not infer the owner ACK from prompt text or settings.
    if (state.ownerEchoMessageId === undefined) {
      return Object.freeze({ status: "UNVERIFIED", owner_ack_status: "UNKNOWN", history_binding_status: "UNVERIFIED",
        history_page_status: "COMPLETE", history_get_calls: getCalls, provider_chat_id: providerChatId, owner_echo_message_id: null,
        contexts: Object.freeze([]), gaps: Object.freeze(["OWNER_ACK_UNKNOWN"]), backend_acceptance: "UNPROVEN" });
    }
    const ownerRows = messages.filter((row) => row.author_id > 0);
    const ackRows = ownerRows.filter((row) => row.id === state.ownerEchoMessageId);
    if (ackRows.length !== 1) {
      const idRows = messages.filter((row) => row.id === state.ownerEchoMessageId);
      const ackStatus = ackRows.length > 1 ? "AMBIGUOUS" : idRows.length > 0 ? "MISMATCH" : "MISSING";
      return emptyOwnerElevenLabsDialogueHistory("UNVERIFIED", getCalls,
        ackStatus === "AMBIGUOUS" ? "OWNER_ACK_AMBIGUOUS" : ackStatus === "MISMATCH" ? "OWNER_ACK_AUTHOR_MISMATCH" : "OWNER_ACK_MISSING",
        ackStatus, providerChatId, "COMPLETE");
    }
    const ownerEchoMessageId = state.ownerEchoMessageId;
    const contexts: OwnerElevenLabsDialogueAudioResultMessageContext[] = [];
    const gaps: string[] = [];
    for (const row of messages) {
      if (row.author_id !== BOT_AUTHOR_ID) continue;
      const audioObjects = row.message_object.filter((object) => object.object_type === "audio");
      if (audioObjects.length === 0) continue;
      if (audioObjects.some((object) => object.model_type !== undefined && object.model_type !== null &&
          object.model_type !== state.modelId)) {
        gaps.push("AUDIO_MODEL_ECHO_MISMATCH");
        continue;
      }
      if (audioObjects.some((object) => object.model_type === undefined || object.model_type === null)) {
        gaps.push("AUDIO_MODEL_ECHO_UNKNOWN");
      }
      const ids = audioObjects.map((object) => object.id);
      if (ids.length > 64 || ids.some((id) => !isSafeProviderId(id)) || new Set(ids).size !== ids.length) {
        gaps.push("AUDIO_OBJECT_IDS_INVALID");
        continue;
      }
      contexts.push(this.#mintOwnerElevenLabsDialogueResultContext(state, {
        chat_uuid: state.chat.chat_uuid, message_id: row.id, model_id: state.modelId,
        provider_chat_id: providerChatId, message_object_ids: ids, owner_echo_message_id: ownerEchoMessageId,
        attempt_id: state.chat.attempt_id, principal: state.chat.principal, voice_epoch: state.chat.voice_epoch,
        intent_fingerprint: state.chat.intent_fingerprint, profile_schema_hash: state.chat.profile_schema_hash,
        source_profile_schema_hash: state.chat.source_profile_schema_hash
      }));
    }
    if (contexts.length === 0 && gaps.length === 0) gaps.push("BOT_RESULT_NOT_OBSERVED");
    return Object.freeze({ status: contexts.length > 0 ? "COMPLETE" : gaps.includes("BOT_RESULT_NOT_OBSERVED") ? "PENDING" : "UNVERIFIED",
      owner_ack_status: "MATCHED", history_binding_status: gaps.some((gap) => gap === "AUDIO_MODEL_ECHO_MISMATCH" ||
        gap === "AUDIO_OBJECT_IDS_INVALID") ? "PARTIAL" : "BOUND", history_page_status: "COMPLETE",
      history_get_calls: getCalls,
      provider_chat_id: providerChatId, owner_echo_message_id: ownerEchoMessageId,
      contexts: Object.freeze(contexts), gaps: Object.freeze(gaps), backend_acceptance: "UNPROVEN" });
  }

  /** Reads only a result context minted from the matching owner ACK and bot audio row. */
  async getOwnedElevenLabsDialogueResult(
    contextInput: OwnerElevenLabsDialogueAudioResultMessageContext | unknown,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsDialogueResult> {
    assertNativeElevenLabsDialogueClient(this);
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) {
      throw ownerElevenLabsDialogueError("RESULT_CONTEXT_INVALID");
    }
    const owned = OWNER_ELEVENLABS_DIALOGUE_RESULT_CONTEXTS.get(contextInput);
    if (!owned || owned.client !== this || owned.context !== contextInput || owned.chat.phase !== "ACKNOWLEDGED" ||
        owned.context.owner_echo_message_id !== owned.chat.ownerEchoMessageId ||
        owned.context.profile_schema_hash !== owned.chat.chat.profile_schema_hash ||
        owned.context.intent_fingerprint !== owned.chat.chat.intent_fingerprint ||
        owned.context.source_profile_schema_hash !== owned.chat.chat.source_profile_schema_hash) {
      throw ownerElevenLabsDialogueError("RESULT_CONTEXT_INVALID");
    }
    validateOwnerElevenLabsDialogueChatStillBound(owned.chat);
    if (signal?.aborted) throw ownerElevenLabsDialogueError("REQUEST_ABORTED");
    const context = owned.context;
    const raw = await this.#request(new URL(`chats/${context.chat_uuid}/${context.message_id}`, V1_BASE_URL),
      "GET", undefined, "JSON_REQUIRED", signal);
    const decoded = decodeOwnerElevenLabsAudioResult(raw, {
      chat_uuid: context.chat_uuid, message_id: context.message_id, model_id: context.model_id,
      provider_chat_id: context.provider_chat_id, message_object_ids: context.message_object_ids
    });
    return Object.freeze({ message_binding: decoded.message_binding, model_echo: decoded.model_echo,
      objects: Object.freeze(decoded.ready_audio.map(({ object_index, message_object_id, object_type, object_url }) =>
        Object.freeze({ object_index, message_object_id, object_type, object_url }))),
      gaps: Object.freeze(decoded.gaps.map((gap) => gap.code)), backend_acceptance: "UNPROVEN" });
  }

  #mintOwnerElevenLabsDialogueResultContext(state: OwnerElevenLabsDialogueChatState,
    input: OwnerElevenLabsDialogueAudioResultMessageContext): OwnerElevenLabsDialogueAudioResultMessageContext {
    const existing = state.resultContexts.get(input.message_id);
    if (existing) {
      if (schemaHash(existing) !== schemaHash(input)) throw protocolError();
      return existing;
    }
    const context = Object.freeze({ ...input, principal: Object.freeze({ ...input.principal }),
      message_object_ids: Object.freeze([...input.message_object_ids]) });
    OWNER_ELEVENLABS_DIALOGUE_RESULT_CONTEXTS.set(context, { client: this, chat: state, context });
    state.resultContexts.set(context.message_id, context);
    return context;
  }

  async uploadFile(
    request: UploadFileRequest,
    signal?: AbortSignal
  ): Promise<UploadFileReceipt> {
    validateUploadFileRequest(request);
    const bytes = new Uint8Array(request.bytes.byteLength);
    bytes.set(request.bytes);
    const raw = await this.#requestUpload(
      new URL("chats/upload-files", V1_BASE_URL),
      this.#buildUploadForm(request, bytes),
      signal
    );
    const parsed = uploadResponseSchema.safeParse(raw);
    if (parsed.success && (parsed.data.id !== undefined || parsed.data.file_id !== undefined)) {
      const result: UploadFileReceipt = {
        ...(parsed.data.filename === undefined ? {} : { filename: parsed.data.filename }),
        ...(parsed.data.mime_type === undefined ? { mime_type: request.mime_type } : { mime_type: parsed.data.mime_type }),
        ...(parsed.data.type === undefined ? {} : { type: parsed.data.type }),
        size: parsed.data.size ?? request.bytes.byteLength,
        status: parsed.data.status ?? "accepted",
        file_id: parsed.data.id ?? parsed.data.file_id ?? null
      };
      return result;
    }
    try {
      parseInternalUploadReferences(raw);
    } catch {
      throw protocolError();
    }
    return {
      file_id: null,
      mime_type: request.mime_type,
      size: request.bytes.byteLength,
      status: "accepted"
    };
  }

  /** Internal-only bridge for a future upload-to-generation composer. */
  async uploadFileReferences(
    request: UploadFileRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference[]> {
    validateUploadFileRequest(request);
    const bytes = new Uint8Array(request.bytes.byteLength);
    bytes.set(request.bytes);
    const raw = await this.#requestUpload(
      new URL("chats/upload-files", V1_BASE_URL),
      this.#buildUploadForm(request, bytes),
      signal
    );
    try {
      return parseInternalUploadReferences(raw);
    } catch {
      throw protocolError();
    }
  }

  /** Dedicated Kling I2V single-image upload; its 30 MiB guard does not widen the generic 10 MiB path. */
  async uploadKlingI2VImageReference(
    request: unknown,
    destination: SyntxUploadDestination,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    if (destination !== "uploaded" && destination !== "hidden") throw invalidRequest();
    let validated: ReturnType<typeof validateOwnerKlingI2VImageBytes>;
    try { validated = validateOwnerKlingI2VImageBytes(request); }
    catch { throw invalidRequest(); }
    if (validated.size > MAX_KLING_I2V_IMAGE_UPLOAD_BYTES) throw invalidRequest();
    const bytes = validated.bytes;
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination,
        check_duplicates: true,
        model_type: "kling_image2video"
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** One fixed Hailuo-02 I2V image upload. A genuine policy receipt is borrowed, never released. */
  async uploadHailuo02I2vImage(
    receiptInput: ValidatedOwnerHailuo02I2vImageUpload,
    signal?: AbortSignal
  ): Promise<OwnerHailuo02I2vImageUploadContext> {
    const owned = readValidatedOwnerHailuo02I2vImageUpload(receiptInput);
    if (!owned) throw invalidRequest();
    const bytes = owned.bytes;
    let form: FormData | undefined;
    try {
      if (owned.size !== bytes.byteLength || owned.size < 1 || owned.size > MAX_UPLOAD_BYTES ||
          !/^[a-f0-9]{64}$/u.test(owned.sha256) || createHash("sha256").update(bytes).digest("hex") !== owned.sha256 ||
          !isHailuo02I2vCanonicalMime(owned.mime_type) || !Number.isSafeInteger(owned.width) || owned.width < 1 ||
          !Number.isSafeInteger(owned.height) || owned.height < 1) throw invalidRequest();
      form = this.#buildUploadForm({
        bytes,
        filename: owned.filename,
        mime_type: owned.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: "hailuo-02"
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      const reference = parseHailuo02I2vUploadReference(raw, owned.filename, owned.mime_type, owned.size);
      const context: OwnerHailuo02I2vImageUploadContext = Object.freeze({
        status: "uploaded",
        model_id: "hailuo-02",
        mime_type: owned.mime_type,
        size: owned.size,
        sha256: owned.sha256,
        width: owned.width,
        height: owned.height
      });
      HAILUO02_I2V_UPLOAD_CONTEXTS.set(context, Object.freeze({ client: this, url: reference.url,
        modelId: "hailuo-02", mimeType: owned.mime_type, size: owned.size, sha256: owned.sha256,
        width: owned.width, height: owned.height }));
      return context;
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** One-shot native upload for one sealed Video2Audio MP4; the private URL is not returned as data. */
  async uploadVideo2AudioOriginal(request: unknown, signal?: AbortSignal): Promise<OwnerVideo2AudioOriginalReference> {
    let profile: OwnerVideo2AudioSourceProfile;
    let validated: ReturnType<typeof validateOwnerVideo2AudioOriginalUploadRequest>;
    try {
      profile = createOwnerVideo2AudioSourceProfile();
      validated = validateOwnerVideo2AudioOriginalUploadRequest(request, profile);
    } catch {
      throw invalidRequest();
    }
    const bytes = validated.bytes;
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: "video2audio"
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      let receipt: ReturnType<typeof parseOwnerVideo2AudioOriginalUploadReceipt>;
      try {
        receipt = parseOwnerVideo2AudioOriginalUploadReceipt(raw, validated, profile);
      } catch {
        throw protocolError();
      }
      const reference: OwnerVideo2AudioOriginalReference = Object.freeze({
        status: "OWNER_VIDEO2AUDIO_ORIGINAL_UPLOADED",
        profile_schema_hash: validated.profile_schema_hash,
        sha256: validated.sha256,
        mime_type: validated.mime_type,
        size: validated.size,
        duration_seconds: receipt.duration_seconds
      });
      OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCES.set(reference, Object.freeze({
        client: this,
        profileSchemaHash: validated.profile_schema_hash,
        sha256: validated.sha256,
        mimeType: validated.mime_type,
        size: validated.size,
        durationSeconds: receipt.duration_seconds,
        url: receipt.url
      }));
      return reference;
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** One native upload of a trusted Topaz Astra probe; its R2 URL stays in the private same-client context. */
  async uploadTopazAstraOriginal(
    genuineProbe: unknown,
    destination: SyntxUploadDestination,
    signal?: AbortSignal
  ): Promise<OwnerTopazAstraOriginalUploadContext> {
    if (destination !== "uploaded" && destination !== "hidden") throw invalidRequest();
    let validated: ReturnType<typeof validateOwnerTopazAstraOriginalProbeForUpload>;
    try { validated = validateOwnerTopazAstraOriginalProbeForUpload(genuineProbe); }
    catch { throw invalidRequest(); }
    const bytes = validated.bytes;
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination,
        check_duplicates: true,
        model_type: validated.model_id
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      let reference: Readonly<{ url: string }>;
      try {
        reference = parseOwnerTopazAstraOriginalUploadReceipt(raw, validated);
      } catch {
        throw protocolError();
      }
      const context: OwnerTopazAstraOriginalUploadContext = Object.freeze({
        status: "OWNER_TOPAZ_ASTRA_ORIGINAL_UPLOADED",
        model_id: validated.model_id,
        destination,
        source_sha256: validated.sha256,
        source_size: validated.size,
        source_mime_type: validated.mime_type,
        width: validated.width,
        height: validated.height,
        duration_seconds: validated.duration_seconds,
        decoded_frame_count: validated.decoded_frame_count
      });
      OWNER_TOPAZ_ASTRA_UPLOAD_CONTEXTS.set(context, Object.freeze({ client: this, url: reference.url,
        model_id: context.model_id, destination, source_sha256: context.source_sha256,
        source_size: context.source_size, source_mime_type: context.source_mime_type,
        width: context.width, height: context.height, duration_seconds: context.duration_seconds,
        decoded_frame_count: context.decoded_frame_count }));
      return context;
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** One native upload of a trusted STS MP3; only a same-client private witness retains its R2 URL. */
  async uploadElevenLabsStsOriginal(
    genuineProbe: unknown,
    destination: SyntxUploadDestination,
    signal?: AbortSignal
  ): Promise<OwnerElevenLabsStsOriginalUploadReference> {
    if (destination !== "uploaded" && destination !== "hidden") throw invalidRequest();
    let validated: ReturnType<typeof validateOwnerElevenLabsStsOriginalProbeForUpload>;
    try { validated = validateOwnerElevenLabsStsOriginalProbeForUpload(genuineProbe); }
    catch { throw invalidRequest(); }
    const bytes = validated.bytes;
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes,
        filename: validated.filename,
        mime_type: "audio/mpeg",
        destination,
        check_duplicates: true,
        model_type: "eleven_multilingual_sts_v2"
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      let receipt: Readonly<{ url: string }>;
      try { receipt = parseOwnerElevenLabsStsOriginalUploadReceipt(raw, validated); }
      catch { throw protocolError(); }
      const reference: OwnerElevenLabsStsOriginalUploadReference = Object.freeze({
        status: "OWNER_ELEVENLABS_STS_ORIGINAL_UPLOADED",
        source_sha256: validated.sha256,
        size: validated.size,
        mime_type: "audio/mpeg",
        duration_seconds: validated.duration_seconds
      });
      OWNER_ELEVENLABS_STS_UPLOAD_CONTEXTS.set(reference, Object.freeze({
        client: this,
        url: receipt.url,
        destination,
        model_type: "eleven_multilingual_sts_v2",
        source_sha256: reference.source_sha256,
        size: reference.size,
        mime_type: reference.mime_type,
        duration_seconds: reference.duration_seconds
      }));
      return reference;
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Internal Clarity-only upload boundary with its source-declared image size and MIME policy. */
  async uploadClarityUpscaleImageReference(
    request: ClarityUpscaleImageUploadRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const validated = validateClarityUploadFileRequest(request);
    const bytes = new Uint8Array(validated.bytes.byteLength);
    bytes.set(validated.bytes);
    try {
      const raw = await this.#requestUpload(
        new URL("chats/upload-files", V1_BASE_URL),
        this.#buildUploadForm({
          bytes,
          filename: validated.filename,
          mime_type: validated.mime_type,
          destination: "uploaded",
          check_duplicates: true,
          model_type: "clarity"
        }, bytes),
        signal
      );
      return parseClarityUploadReference(raw, validated.mime_type, bytes.byteLength);
    } finally {
      bytes.fill(0);
    }
  }

  /** Internal Magnific-only upload with a local source-derived 10 MiB input boundary. */
  async uploadMagnificUpscaleImageReference(
    request: MagnificUpscaleImageUploadRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const validated = validateMagnificUploadFileRequest(request);
    const bytes = validated.bytes;
    try {
      const raw = await this.#requestUpload(
        new URL("chats/upload-files", V1_BASE_URL),
        this.#buildUploadForm({
          bytes,
          filename: validated.filename,
          mime_type: validated.mime_type,
          destination: "uploaded",
          check_duplicates: true,
          model_type: validated.model_type
        }, bytes),
        signal
      );
      return parseMagnificUploadReference(raw, validated.mime_type, bytes.byteLength);
    } finally {
      bytes.fill(0);
    }
  }

  /** Fixed native upload for one already validated Kontext image reference; no retries or caller-selected route fields. */
  async uploadKontextImageReference(
    request: KontextImageUploadRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const validated = validateKontextUploadFileRequest(request);
    try {
      const raw = await this.#requestUpload(
        new URL("chats/upload-files", V1_BASE_URL),
        this.#buildUploadForm({
          bytes: validated.bytes,
          filename: validated.filename,
          mime_type: validated.mime_type,
          destination: "uploaded",
          check_duplicates: true,
          model_type: validated.model_type
        }, validated.bytes),
        signal
      );
      return parseKontextUploadReference(raw, validated.mime_type, validated.bytes.byteLength);
    } finally {
      validated.bytes.fill(0);
      validated.source_bytes.fill(0);
    }
  }

  /** Fixed native WAN upload for one source-validated image; no caller route or receipt fallback. */
  async uploadWanImageReference(
    request: WanImageUploadRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const validated = validateWanUploadFileRequest(request);
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.model_type
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseWanUploadReference(raw, validated.mime_type, validated.bytes.byteLength);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed native upload for one source-validated standard image-family input; no caller route or retry. */
  async uploadStandardImageReference(
    request: StandardImageReferenceUploadRequest,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["bytes", "filename", "mime_type", "variant"],
      ["bytes", "filename", "mime_type", "variant"]);
    const uploadInput = {
      variant: record.variant,
      bytes: record.bytes,
      filename: record.filename,
      mime_type: record.mime_type
    };
    let validated: ReturnType<typeof validateOwnerStandardImageUploadData> |
      ReturnType<typeof validateOwnerStandardImageAuxUploadData>;
    try {
      validated = record.variant === "banana-2.1" && typeof record.mime_type === "string" && !record.mime_type.startsWith("image/")
        ? validateOwnerStandardImageAuxUploadData(uploadInput)
        : validateOwnerStandardImageUploadData(uploadInput);
    } catch {
      throw invalidRequest();
    }

    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed Banana Inpaint original upload; its local 50 MiB source-UI cap is independent of standard-image uploads. */
  async uploadBananaInpaintOriginal(
    request: unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (typeof record.variant !== "string" || !BANANA_INPAINT_ORIGINAL_VARIANTS.has(record.variant)) {
      throw invalidRequest();
    }
    let validated: ReturnType<typeof validateOwnerBananaInpaintOriginalUploadData>;
    try {
      validated = validateOwnerBananaInpaintOriginalUploadData({
        bytes: record.bytes,
        filename: record.filename,
        mime_type: record.mime_type
      });
    } catch {
      throw invalidRequest();
    }

    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "hidden",
        check_duplicates: true,
        model_type: record.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseBananaInpaintOriginalUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed hidden upload for a Banana painted composite under its own local resource bound. */
  async uploadBananaInpaintPaintedComposite(
    request: unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (typeof record.variant !== "string" || !BANANA_INPAINT_PAINTED_COMPOSITE_VARIANTS.has(record.variant)) {
      throw invalidRequest();
    }
    let validated: ReturnType<typeof validateOwnerBananaInpaintPaintedCompositeUploadData>;
    try {
      validated = validateOwnerBananaInpaintPaintedCompositeUploadData({
        bytes: record.bytes,
        filename: record.filename,
        mime_type: record.mime_type
      });
    } catch {
      throw invalidRequest();
    }

    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "hidden",
        check_duplicates: true,
        model_type: record.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseBananaInpaintPaintedCompositeUploadReference(raw, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed uploaded auxiliary-image path; its 50 MiB ceiling is local resource policy, not source/provider acceptance. */
  async uploadBananaInpaintAuxiliaryImage(
    request: unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (typeof record.variant !== "string" || !BANANA_INPAINT_AUXILIARY_VARIANTS.has(record.variant)) {
      throw invalidRequest();
    }
    let validated: ReturnType<typeof validateOwnerBananaInpaintAuxiliaryUploadData>;
    try {
      validated = validateOwnerBananaInpaintAuxiliaryUploadData({
        variant: record.variant, bytes: record.bytes, filename: record.filename, mime_type: record.mime_type
      });
    } catch { throw invalidRequest(); }

    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: record.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseBananaInpaintAuxiliaryUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed ordinary Ideogram image upload; it returns only an internal receipt, not an owner handle or mask grant. */
  async uploadIdeogramImageReference(
    request: IdeogramImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["model_id", "bytes", "filename", "mime_type"],
      ["model_id", "bytes", "filename", "mime_type"]);
    let validated: ReturnType<typeof validateOwnerIdeogramImageUploadData>;
    try { validated = validateOwnerIdeogramImageUploadData(record); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.model_id
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseIdeogramImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed hidden Ideogram mask upload; the receipt is an internal R2 reference, never an owner mask grant. */
  async uploadIdeogramPaintedMaskVariant(
    request: IdeogramPaintedMaskVariantUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["bytes", "filename"], ["bytes", "filename"]);
    if (typeof record.filename !== "string" || !SAFE_UPLOAD_FILENAME.test(record.filename) || /[\\/]/u.test(record.filename)) {
      throw invalidRequest();
    }
    let validated: ReturnType<typeof validateOwnerIdeogramPaintedMaskVariantBytes>;
    try { validated = validateOwnerIdeogramPaintedMaskVariantBytes(record.bytes); }
    catch { throw invalidRequest(); }
    const bytes = validated.bytes;
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes,
        filename: record.filename,
        mime_type: "image/png",
        destination: "hidden",
        check_duplicates: true,
        model_type: "ideogram_45"
      }, bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseIdeogramMaskUploadReference(raw, validated.size);
    } finally {
      bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed native Runway Frames upload for one source-validated image reference. */
  async uploadRunwayImageReference(
    request: RunwayImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    let validated: ReturnType<typeof validateOwnerRunwayFluxImageUploadData>;
    try { validated = validateOwnerRunwayFluxImageUploadData(record); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: "runway_frames"
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed native Seedream upload using only the full source-profile validator and one private receipt. */
  async uploadSeedreamImageReference(
    request: SeedreamImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    let validated: ReturnType<typeof validateOwnerSeedreamImageUploadData>;
    try { validated = validateOwnerSeedreamImageUploadData(record); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed uploaded native path for a Seedream Editor original; its source UI caps do not alter ordinary Seedream uploads. */
  async uploadSeedreamEditorOriginal(
    request: unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (typeof record.variant !== "string" || !SEEDREAM_EDITOR_ORIGINAL_VARIANTS.has(record.variant as OwnerSeedreamImageVariant)) {
      throw invalidRequest();
    }
    let validated: ReturnType<typeof validateOwnerSeedreamEditorOriginalUploadData>;
    try { validated = validateOwnerSeedreamEditorOriginalUploadData(record); }
    catch { throw invalidRequest(); }

    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.variant
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseSeedreamEditorOriginalUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed hidden drawing upload; its independent 32 MiB guard is local resource policy only. */
  async uploadSeedreamEditorDrawing(request: unknown, signal?: AbortSignal): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (typeof record.variant !== "string" || !SEEDREAM_EDITOR_ORIGINAL_VARIANTS.has(record.variant as OwnerSeedreamImageVariant)) throw invalidRequest();
    let validated: ReturnType<typeof validateOwnerSeedreamEditorDrawingUploadData>;
    try { validated = validateOwnerSeedreamEditorDrawingUploadData({ bytes: record.bytes, filename: record.filename, mime_type: record.mime_type }); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({ bytes: validated.bytes, filename: validated.filename, mime_type: "image/png",
        destination: "hidden", check_duplicates: true, model_type: record.variant }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseSeedreamEditorDrawingUploadReference(raw, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed native Flux-1 upload; Pro variants are source-declared non-uploadable. */
  async uploadFluxImageReference(
    request: FluxImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    const record = readExactDataRecord(request, ["variant", "bytes", "filename", "mime_type"],
      ["variant", "bytes", "filename", "mime_type"]);
    if (record.variant !== "flux-1") throw invalidRequest();
    let validated: ReturnType<typeof validateOwnerRunwayFluxImageUploadData>;
    try { validated = validateOwnerRunwayFluxImageUploadData(record); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: "flux-1"
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed ordinary upload for the two public-uploadable Grok Imagine models; this does not issue an owned handle. */
  async uploadGrokImagineImageReference(
    request: GrokImagineImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    let validated: ReturnType<typeof validateOwnerGrokT2iImageUploadData>;
    try { validated = validateOwnerGrokT2iImageUploadData(request); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.model_id
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseGrokImagineImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  /** Fixed ordinary Uni image upload; this returns only an internal receipt, not an owned handle or generation grant. */
  async uploadUniImageReference(
    request: OwnerUniImageReferenceUploadRequest | unknown,
    signal?: AbortSignal
  ): Promise<InternalUploadReference> {
    let validated: ReturnType<typeof validateOwnerUniImageReferenceUploadRequest>;
    try { validated = validateOwnerUniImageReferenceUploadRequest(request); }
    catch { throw invalidRequest(); }
    let form: FormData | undefined;
    try {
      form = this.#buildUploadForm({
        bytes: validated.bytes,
        filename: validated.filename,
        mime_type: validated.mime_type,
        destination: "uploaded",
        check_duplicates: true,
        model_type: validated.model_id
      }, validated.bytes);
      const raw = await this.#requestUpload(new URL("chats/upload-files", V1_BASE_URL), form, signal);
      return parseStandardImageUploadReference(raw, validated.mime_type, validated.size);
    } finally {
      validated.bytes.fill(0);
      form?.delete("files");
    }
  }

  #buildUploadForm(request: UploadFileRequest, bytes: Uint8Array): FormData {
    const form = new FormData();
    form.append("files", new Blob([bytes.buffer as ArrayBuffer], { type: request.mime_type }), request.filename);
    form.append("destination", request.destination);
    form.append("check_duplicates", "true");
    form.append("model_type", request.model_type);
    return form;
  }

  async cancelMessage(
    chatUuid: string,
    messageId: string,
    signal?: AbortSignal
  ): Promise<CancelMessageReceipt> {
    validatePathIdentifier(chatUuid);
    validatePathIdentifier(messageId);
    await this.#request(
      new URL(`chats/${chatUuid}/messages/${messageId}/cancel`, V1_BASE_URL),
      "POST",
      undefined,
      "ACK",
      signal
    );
    return { chat_uuid: chatUuid, message_id: messageId, accepted: true };
  }

  async #readSeedreamEditorHistory(chatUuid: string, signal: AbortSignal | undefined,
    stillOwned: () => boolean): Promise<SeedreamEditorHistoryRead> {
    const messages: z.infer<typeof chatHistoryRowSchema>[] = [];
    const gaps: OwnerSeedreamEditorImageNativeGap[] = [];
    const messageIds = new Set<string>(), objectIds = new Set<string>();
    let totalCount: number | undefined, totalPages: number | undefined, providerChatId: string | undefined;
    for (let page = 1; page <= (totalPages ?? 1); page += 1) {
      const url = new URL(`chats/${chatUuid}/messages`, V1_BASE_URL);
      url.searchParams.set("page", String(page));
      url.searchParams.set("page_size", "10");
      let raw: unknown;
      try { raw = await this.#request(url, "GET", undefined, "JSON_REQUIRED", signal); }
      catch { return { complete: false, unproven: false, messages, ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps: [...gaps, "HISTORY_READ_INCOMPLETE"] }; }
      if (!stillOwned()) throw invalidRequest();
      const parsed = ownerSeedreamEditorHistoryResponseSchema.safeParse(raw);
      if (!parsed.success) return { complete: false, unproven: true, messages,
        ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps: [...gaps, "HISTORY_SHAPE_UNVERIFIED"] };
      const pagination = parsed.data.pagination;
      const expectedTotalPages = pagination.total_count === 0 ? 0 : Math.ceil(pagination.total_count / 10);
      if (pagination.page !== page || pagination.page_size !== 10 || pagination.total_pages !== expectedTotalPages ||
          pagination.has_previous !== (page > 1) || pagination.has_next !== (page < expectedTotalPages) ||
          (totalCount !== undefined && totalCount !== pagination.total_count) ||
          (totalPages !== undefined && totalPages !== pagination.total_pages)) {
        return { complete: false, unproven: true, messages,
          ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps: [...gaps, "HISTORY_METADATA_MISMATCH"] };
      }
      totalCount = pagination.total_count;
      totalPages = pagination.total_pages;
      const expectedRows = Math.min(10, Math.max(0, totalCount - (page - 1) * 10));
      if (parsed.data.messages.length !== expectedRows) return { complete: false, unproven: false, messages,
        ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps: [...gaps, "HISTORY_READ_INCOMPLETE"] };
      for (const row of parsed.data.messages) {
        const rowChatId = String(row.chat_id);
        if (!/^\d{1,16}$/u.test(rowChatId) || (providerChatId !== undefined && providerChatId !== rowChatId)) {
          return { complete: false, unproven: true, messages,
            ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps: [...gaps, "HISTORY_CHAT_ID_MISMATCH"] };
        }
        providerChatId ??= rowChatId;
        if (messageIds.has(row.id)) return { complete: false, unproven: true, messages,
          provider_chat_id: providerChatId, gaps: [...gaps, "HISTORY_MESSAGE_ID_INVALID"] };
        messageIds.add(row.id);
        for (const object of row.message_object) {
          if (object.message_id !== row.id || objectIds.has(object.id)) return { complete: false, unproven: true, messages,
            provider_chat_id: providerChatId, gaps: [...gaps, "HISTORY_OBJECT_ID_INVALID"] };
          objectIds.add(object.id);
        }
        messages.push(row);
      }
    }
    if ((totalCount ?? 0) !== messages.length || (totalPages ?? 0) !== (messages.length === 0 ? 0 : Math.ceil(messages.length / 10))) {
      return { complete: false, unproven: false, messages, ...(providerChatId ? { provider_chat_id: providerChatId } : {}),
        gaps: [...gaps, "HISTORY_READ_INCOMPLETE"] };
    }
    return { complete: true, unproven: false, messages, ...(providerChatId ? { provider_chat_id: providerChatId } : {}), gaps };
  }

  async #startMedia(
    route: "design/generate" | "video/generate" | "audio/generate",
    aiName: string,
    chatUuid: string,
    body: Record<string, JsonValue>,
    signal?: AbortSignal
  ): Promise<MediaGenerationReceipt> {
    const raw = await this.#request(
      generationUrl(route, aiName),
      "POST",
      body,
      "JSON_REQUIRED",
      signal
    );
    const parsed = mediaStartResponseSchema.safeParse(raw);
    if (!parsed.success) throw protocolError();
    return {
      chat_uuid: chatUuid,
      message_id: parsed.data.id
    };
  }

  async #request(
    url: URL,
    method: "GET" | "POST" | "DELETE",
    body: Record<string, JsonValue> | undefined,
    responseMode: ResponseMode,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    assertFixedUpstreamUrl(url);
    const serializedBody = serializeBoundedBody(body);
    let credentialCallbackEntered = false;
    const deadline = new AbsoluteRequestDeadline(
      this.#requestTimeoutMs,
      externalSignal,
      abortError
    );

    try {
      deadline.throwIfAborted();
      const brokerOperation = this.#credentialBroker.useCredential(
        async (credential) => {
          deadline.throwIfAborted();
          credentialCallbackEntered = true;
          validateCredential(credential);
          return this.#fetchResponse(
            url,
            method,
            serializedBody,
            credential,
            responseMode,
            deadline
          );
        }
      );
      return await deadline.waitFor(brokerOperation);
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (!credentialCallbackEntered) {
        throw new SyntxHttpError(
          "AUTH_REQUIRED",
          "A linked SYNTX account is required for this request."
        );
      }
      throw unavailableError();
    } finally {
      deadline.close();
    }
  }

  async #requestUpload(
    url: URL,
    form: FormData,
    externalSignal?: AbortSignal
  ): Promise<unknown> {
    assertFixedUpstreamUrl(url);
    let credentialCallbackEntered = false;
    const deadline = new AbsoluteRequestDeadline(this.#requestTimeoutMs, externalSignal, abortError);
    try {
      deadline.throwIfAborted();
      const brokerOperation = this.#credentialBroker.useCredential(async (credential) => {
        deadline.throwIfAborted();
        credentialCallbackEntered = true;
        validateCredential(credential);
        return this.#fetchUploadResponse(url, form, credential, deadline);
      });
      return await deadline.waitFor(brokerOperation);
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (!credentialCallbackEntered) throw new SyntxHttpError("AUTH_REQUIRED", "A linked SYNTX account is required for this request.");
      throw unavailableError();
    } finally {
      deadline.close();
    }
  }

  async #fetchResponse(
    url: URL,
    method: "GET" | "POST" | "DELETE",
    body: string | undefined,
    credential: string,
    responseMode: ResponseMode,
    deadline: AbsoluteRequestDeadline
  ): Promise<unknown> {
    try {
      deadline.throwIfAborted();
      const headers: Record<string, string> = {
        accept: "application/json",
        authorization: `Bearer ${credential}`
      };
      if (body !== undefined) headers["content-type"] = "application/json";

      const fetchPromise = this.#fetch(url, {
          method,
          headers,
          ...(body === undefined ? {} : { body }),
          cache: "no-store",
          redirect: "error",
          signal: deadline.signal
        })
        .then((response) => {
          if (deadline.signal.aborted) cancelResponseBody(response);
          return response;
        });
      const response = await deadline.waitFor(fetchPromise);

      if (
        response.redirected ||
        response.type === "opaqueredirect" ||
        (response.url.length > 0 && response.url !== url.href)
      ) {
        cancelResponseBody(response);
        throw protocolError();
      }
      if (!response.ok) {
        cancelResponseBody(response);
        throw mapHttpFailure(response.status);
      }
      return await deadline.waitFor(
        readJsonResponse(
          response,
          this.#maxResponseBytes,
          responseMode,
          deadline.signal
        )
      );
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (deadline.abortSource !== null) {
        throw abortError(deadline.abortSource);
      }
      throw unavailableError();
    }
  }

  async #fetchUploadResponse(
    url: URL,
    form: FormData,
    credential: string,
    deadline: AbsoluteRequestDeadline
  ): Promise<unknown> {
    try {
      deadline.throwIfAborted();
      const response = await deadline.waitFor(this.#fetch(url, {
        method: "POST",
        headers: { accept: "application/json", authorization: `Bearer ${credential}` },
        body: form,
        cache: "no-store",
        redirect: "error",
        signal: deadline.signal
      }).then((result) => {
        if (deadline.signal.aborted) cancelResponseBody(result);
        return result;
      }));
      if (response.redirected || response.type === "opaqueredirect" || (response.url.length > 0 && response.url !== url.href)) {
        cancelResponseBody(response); throw protocolError();
      }
      if (!response.ok) { cancelResponseBody(response); throw mapHttpFailure(response.status); }
      return await deadline.waitFor(readJsonResponse(response, this.#maxResponseBytes, "JSON_REQUIRED", deadline.signal));
    } catch (error) {
      if (error instanceof SyntxHttpError) throw error;
      if (deadline.abortSource !== null) throw abortError(deadline.abortSource);
      throw unavailableError();
    }
  }
}

const NATIVE_OWNER_TOPAZ_ASTRA_UPLOAD = SyntxChatHttpClient.prototype.uploadTopazAstraOriginal;
const NATIVE_OWNER_ELEVENLABS_STS_UPLOAD = SyntxChatHttpClient.prototype.uploadElevenLabsStsOriginal;
const NATIVE_OWNER_ELEVENLABS_STS_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_OWNER_ELEVENLABS_STS_NATIVE_CREATE = SyntxChatHttpClient.prototype.createOwnerElevenLabsStsChat;
const NATIVE_OWNER_ELEVENLABS_STS_NATIVE_START = SyntxChatHttpClient.prototype.startElevenLabsStsWithOwnedCandidate;
const NATIVE_OWNER_ELEVENLABS_STS_NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsCandidates;
const NATIVE_OWNER_ELEVENLABS_STS_NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedElevenLabsStsResult;
const NATIVE_OWNER_ELEVENLABS_STS_EXISTING_INDEX = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsExistingChats;
const NATIVE_OWNER_ELEVENLABS_STS_EXISTING_HISTORY = SyntxChatHttpClient.prototype.listOwnedElevenLabsStsExistingCandidates;
const NATIVE_OWNER_ELEVENLABS_STS_EXISTING_RESULT = SyntxChatHttpClient.prototype.getOwnedElevenLabsStsExistingResult;
const NATIVE_OWNER_TOPAZ_ASTRA_CREATE_CHAT = SyntxChatHttpClient.prototype.createVideoUpscalerChat;
const NATIVE_OWNER_HAILUO02_I2V_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_OWNER_HAILUO02_I2V_UPLOAD = SyntxChatHttpClient.prototype.uploadHailuo02I2vImage;
const NATIVE_OWNER_HAILUO02_I2V_NATIVE_CREATE = SyntxChatHttpClient.prototype.createOwnerHailuo02I2vChat;
const NATIVE_OWNER_HAILUO02_I2V_NATIVE_START = SyntxChatHttpClient.prototype.startOwnerHailuo02I2vWithOwnedCandidate;
const NATIVE_OWNER_HAILUO02_I2V_NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedHailuo02I2vCandidates;
const NATIVE_OWNER_HAILUO02_I2V_NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedHailuo02I2vResult;
type OwnerHailuo02I2vNativeMethod = "create" | "start" | "list" | "get";
interface OwnerHailuo02I2vNativeInvocation { readonly client: SyntxChatHttpClient; readonly method: OwnerHailuo02I2vNativeMethod; readonly input: unknown; readonly callback: Function }
const OWNER_HAILUO02_I2V_NATIVE_INVOCATIONS = new WeakMap<object, OwnerHailuo02I2vNativeInvocation>();

function createOwnerHailuo02I2vNativeInvocation(client: SyntxChatHttpClient, method: OwnerHailuo02I2vNativeMethod, input: unknown, callback: Function): object {
  const packet = Object.freeze(Object.create(null) as object);
  OWNER_HAILUO02_I2V_NATIVE_INVOCATIONS.set(packet, Object.freeze({ client, method, input, callback }));
  return packet;
}

/** One-use private bridge: only the fixed four native client methods can mint invocation packets. */
export function consumeOwnerHailuo02I2vNativeInvocation(input: unknown, packet: unknown,
  method: OwnerHailuo02I2vNativeMethod): Readonly<{ client: SyntxChatHttpClient; callback: Function }> {
  if (!packet || typeof packet !== "object" || types.isProxy(packet)) throw new Error("OWNER_HAILUO02_I2V_INVOCATION_INVALID");
  const invocation = OWNER_HAILUO02_I2V_NATIVE_INVOCATIONS.get(packet);
  if (!invocation || invocation.input !== input || invocation.method !== method || !isExactOwnerHailuo02I2vNativeClient(invocation.client)) {
    throw new Error("OWNER_HAILUO02_I2V_INVOCATION_INVALID");
  }
  OWNER_HAILUO02_I2V_NATIVE_INVOCATIONS.delete(packet);
  return Object.freeze({ client: invocation.client, callback: invocation.callback });
}

function assertNativeOwnerHailuo02I2v(client: unknown): asserts client is SyntxChatHttpClient {
  if (!isExactOwnerHailuo02I2vNativeClient(client)) throw new Error("OWNER_HAILUO02_I2V_NATIVE_CLIENT_INVALID");
}

function isExactOwnerHailuo02I2vNativeClient(client: unknown): client is SyntxChatHttpClient {
  try {
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      getDataMethod(client, "createChat") === NATIVE_OWNER_HAILUO02_I2V_CREATE_CHAT &&
      getDataMethod(client, "uploadHailuo02I2vImage") === NATIVE_OWNER_HAILUO02_I2V_UPLOAD &&
      getDataMethod(client, "createOwnerHailuo02I2vChat") === NATIVE_OWNER_HAILUO02_I2V_NATIVE_CREATE &&
      getDataMethod(client, "startOwnerHailuo02I2vWithOwnedCandidate") === NATIVE_OWNER_HAILUO02_I2V_NATIVE_START &&
      getDataMethod(client, "listOwnedHailuo02I2vCandidates") === NATIVE_OWNER_HAILUO02_I2V_NATIVE_LIST &&
      getDataMethod(client, "getOwnedHailuo02I2vResult") === NATIVE_OWNER_HAILUO02_I2V_NATIVE_GET &&
      SyntxChatHttpClient.prototype.uploadHailuo02I2vImage === NATIVE_OWNER_HAILUO02_I2V_UPLOAD &&
      Reflect.get(client, "uploadHailuo02I2vImage") === NATIVE_OWNER_HAILUO02_I2V_UPLOAD;
  } catch { return false; }
}

const NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_CREATE = SyntxChatHttpClient.prototype.createOwnerTopazAstraChat;
const NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_START = SyntxChatHttpClient.prototype.startTopazAstraWithOwnedCandidate;
const NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_LIST = SyntxChatHttpClient.prototype.listOwnedTopazAstraCandidates;
const NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_GET = SyntxChatHttpClient.prototype.getOwnedTopazAstraResult;
type OwnerTopazAstraNativeMethod = "create" | "start" | "list" | "get";
interface OwnerTopazAstraNativeInvocation { readonly client: SyntxChatHttpClient; readonly method: OwnerTopazAstraNativeMethod; readonly input: unknown; readonly callback: Function }
const OWNER_TOPAZ_ASTRA_NATIVE_INVOCATIONS = new WeakMap<object, OwnerTopazAstraNativeInvocation>();

function createOwnerTopazAstraNativeInvocation(client: SyntxChatHttpClient, method: OwnerTopazAstraNativeMethod, input: unknown, callback: Function): object {
  const packet = Object.freeze(Object.create(null) as object);
  OWNER_TOPAZ_ASTRA_NATIVE_INVOCATIONS.set(packet, Object.freeze({ client, method, input, callback }));
  return packet;
}

/** One-use packet bridge. Only the four concrete native client methods can mint a callback packet. */
export function consumeOwnerTopazAstraNativeInvocation(input: unknown, packet: unknown, method: OwnerTopazAstraNativeMethod): Readonly<{ client: SyntxChatHttpClient; callback: Function }> {
  if (!packet || typeof packet !== "object" || types.isProxy(packet)) throw new Error("OWNER_TOPAZ_ASTRA_INVOCATION_INVALID");
  const invocation = OWNER_TOPAZ_ASTRA_NATIVE_INVOCATIONS.get(packet);
  if (!invocation || invocation.input !== input || invocation.method !== method || !isExactOwnerTopazAstraNativeClient(invocation.client)) {
    throw new Error("OWNER_TOPAZ_ASTRA_INVOCATION_INVALID");
  }
  OWNER_TOPAZ_ASTRA_NATIVE_INVOCATIONS.delete(packet);
  return Object.freeze({ client: invocation.client, callback: invocation.callback });
}

function assertNativeOwnerTopazAstra(client: unknown): asserts client is SyntxChatHttpClient {
  if (!isExactOwnerTopazAstraNativeClient(client)) throw new Error("OWNER_TOPAZ_ASTRA_NATIVE_CLIENT_INVALID");
}

function isExactOwnerTopazAstraNativeClient(client: unknown): client is SyntxChatHttpClient {
  try {
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      getDataMethod(client, "createVideoUpscalerChat") === NATIVE_OWNER_TOPAZ_ASTRA_CREATE_CHAT &&
      getDataMethod(client, "createOwnerTopazAstraChat") === NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_CREATE &&
      getDataMethod(client, "startTopazAstraWithOwnedCandidate") === NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_START &&
      getDataMethod(client, "listOwnedTopazAstraCandidates") === NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_LIST &&
      getDataMethod(client, "getOwnedTopazAstraResult") === NATIVE_OWNER_TOPAZ_ASTRA_NATIVE_GET &&
      SyntxChatHttpClient.prototype.uploadTopazAstraOriginal === NATIVE_OWNER_TOPAZ_ASTRA_UPLOAD &&
      getDataMethod(client, "uploadTopazAstraOriginal") === NATIVE_OWNER_TOPAZ_ASTRA_UPLOAD;
  } catch { return false; }
}

type OwnerElevenLabsStsExistingMethod = "index" | "history" | "result";
interface OwnerElevenLabsStsExistingInvocation {
  readonly client: SyntxChatHttpClient;
  readonly method: OwnerElevenLabsStsExistingMethod;
  readonly input: unknown;
  readonly callback: (url: URL, signal?: AbortSignal) => Promise<unknown>;
}
const OWNER_ELEVENLABS_STS_EXISTING_INVOCATIONS = new WeakMap<object, OwnerElevenLabsStsExistingInvocation>();

function createOwnerElevenLabsStsExistingInvocation(client: SyntxChatHttpClient, method: OwnerElevenLabsStsExistingMethod,
  input: unknown, callback: (url: URL, signal?: AbortSignal) => Promise<unknown>): object {
  const packet = Object.freeze(Object.create(null) as object);
  OWNER_ELEVENLABS_STS_EXISTING_INVOCATIONS.set(packet, Object.freeze({ client, method, input, callback }));
  return packet;
}

/** One-use bridge: only the exact client's native GET methods can mint a packet. */
export function consumeOwnerElevenLabsStsExistingInvocation(input: unknown, packet: unknown,
  method: OwnerElevenLabsStsExistingMethod): Readonly<{ client: SyntxChatHttpClient; get: (url: URL, signal?: AbortSignal) => Promise<unknown> }> {
  if (!packet || typeof packet !== "object" || types.isProxy(packet)) throw new Error("OWNER_ELEVENLABS_STS_EXISTING_INVOCATION_INVALID");
  const invocation = OWNER_ELEVENLABS_STS_EXISTING_INVOCATIONS.get(packet);
  if (!invocation || invocation.input !== input || invocation.method !== method || !isExactOwnerElevenLabsStsExistingClient(invocation.client)) {
    throw new Error("OWNER_ELEVENLABS_STS_EXISTING_INVOCATION_INVALID");
  }
  OWNER_ELEVENLABS_STS_EXISTING_INVOCATIONS.delete(packet);
  return Object.freeze({ client: invocation.client, get: invocation.callback });
}

function assertNativeOwnerElevenLabsStsExistingClient(client: unknown): asserts client is SyntxChatHttpClient {
  if (!isExactOwnerElevenLabsStsExistingClient(client)) throw new Error("OWNER_ELEVENLABS_STS_EXISTING_CLIENT_INVALID");
}

function isExactOwnerElevenLabsStsExistingClient(client: unknown): client is SyntxChatHttpClient {
  try {
    return !!client && typeof client === "object" && !types.isProxy(client) && Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      Reflect.get(client, "listOwnedElevenLabsStsExistingChats") === NATIVE_OWNER_ELEVENLABS_STS_EXISTING_INDEX &&
      Reflect.get(client, "listOwnedElevenLabsStsExistingCandidates") === NATIVE_OWNER_ELEVENLABS_STS_EXISTING_HISTORY &&
      Reflect.get(client, "getOwnedElevenLabsStsExistingResult") === NATIVE_OWNER_ELEVENLABS_STS_EXISTING_RESULT &&
      isExactOwnerElevenLabsStsUploadClient(client);
  } catch { return false; }
}
type OwnerElevenLabsStsNativeMethod = "create" | "start" | "list" | "get";
interface OwnerElevenLabsStsNativeInvocation {
  readonly client: SyntxChatHttpClient;
  readonly method: OwnerElevenLabsStsNativeMethod;
  readonly input: unknown;
  readonly callback: Function;
}
const OWNER_ELEVENLABS_STS_NATIVE_INVOCATIONS = new WeakMap<object, OwnerElevenLabsStsNativeInvocation>();

function createOwnerElevenLabsStsNativeInvocation(client: SyntxChatHttpClient, method: OwnerElevenLabsStsNativeMethod,
  input: unknown, callback: Function): object {
  const packet = Object.freeze(Object.create(null) as object);
  OWNER_ELEVENLABS_STS_NATIVE_INVOCATIONS.set(packet, Object.freeze({ client, method, input, callback }));
  return packet;
}

/** Private invocation bridge for the adjacent adapter helper; packets are minted only inside the four native methods. */
export function consumeOwnerElevenLabsStsNativeInvocation(input: unknown, packet: unknown,
  method: OwnerElevenLabsStsNativeMethod): Readonly<{ client: SyntxChatHttpClient; callback: Function }> {
  if (!packet || typeof packet !== "object" || types.isProxy(packet)) throw new Error("OWNER_ELEVENLABS_STS_INVOCATION_INVALID");
  const invocation = OWNER_ELEVENLABS_STS_NATIVE_INVOCATIONS.get(packet);
  if (!invocation || invocation.input !== input || invocation.method !== method ||
      !isExactOwnerElevenLabsStsUploadClient(invocation.client)) throw new Error("OWNER_ELEVENLABS_STS_INVOCATION_INVALID");
  assertNativeOwnerElevenLabsStsClient(invocation.client);
  OWNER_ELEVENLABS_STS_NATIVE_INVOCATIONS.delete(packet);
  return Object.freeze({ client: invocation.client, callback: invocation.callback });
}

function assertNativeOwnerElevenLabsStsClient(client: unknown): asserts client is SyntxChatHttpClient {
  try {
    if (!client || typeof client !== "object" || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        getDataMethod(client, "createChat") !== NATIVE_OWNER_ELEVENLABS_STS_CREATE_CHAT ||
        Reflect.get(client, "createChat") !== NATIVE_OWNER_ELEVENLABS_STS_CREATE_CHAT ||
        getDataMethod(client, "createOwnerElevenLabsStsChat") !== NATIVE_OWNER_ELEVENLABS_STS_NATIVE_CREATE ||
        getDataMethod(client, "startElevenLabsStsWithOwnedCandidate") !== NATIVE_OWNER_ELEVENLABS_STS_NATIVE_START ||
        getDataMethod(client, "listOwnedElevenLabsStsCandidates") !== NATIVE_OWNER_ELEVENLABS_STS_NATIVE_LIST ||
        getDataMethod(client, "getOwnedElevenLabsStsResult") !== NATIVE_OWNER_ELEVENLABS_STS_NATIVE_GET ||
        !isExactOwnerElevenLabsStsUploadClient(client)) throw null;
  } catch { throw new Error("OWNER_ELEVENLABS_STS_NATIVE_CLIENT_INVALID"); }
}

export function isExactOwnerElevenLabsStsUploadClient(client: unknown): client is SyntxChatHttpClient {
  if (!client || typeof client !== "object" || types.isProxy(client)) return false;
  try {
    return Object.getPrototypeOf(client) === SyntxChatHttpClient.prototype &&
      SyntxChatHttpClient.prototype.uploadElevenLabsStsOriginal === NATIVE_OWNER_ELEVENLABS_STS_UPLOAD &&
      Reflect.get(client, "uploadElevenLabsStsOriginal") === NATIVE_OWNER_ELEVENLABS_STS_UPLOAD;
  } catch { return false; }
}

/** Private same-client bridge for native composition; never return this URL from an MCP DTO. */
export function readOwnerTopazAstraOriginalUploadForClient(
  client: unknown,
  contextInput: unknown
): (OwnerTopazAstraOriginalUploadContext & Readonly<{ url: string }>) | null {
  if (!client || typeof client !== "object" || types.isProxy(client) ||
      Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
      SyntxChatHttpClient.prototype.uploadTopazAstraOriginal !== NATIVE_OWNER_TOPAZ_ASTRA_UPLOAD ||
      !contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
  const witness = OWNER_TOPAZ_ASTRA_UPLOAD_CONTEXTS.get(contextInput);
  if (!witness || witness.client !== client || !isSafeUploadReferenceUrl(witness.url)) return null;
  const value = contextInput as OwnerTopazAstraOriginalUploadContext;
  if (value.status !== "OWNER_TOPAZ_ASTRA_ORIGINAL_UPLOADED" || value.model_id !== witness.model_id ||
      value.destination !== witness.destination || value.source_sha256 !== witness.source_sha256 ||
      value.source_size !== witness.source_size || value.source_mime_type !== witness.source_mime_type ||
      value.width !== witness.width || value.height !== witness.height ||
      value.duration_seconds !== witness.duration_seconds || value.decoded_frame_count !== witness.decoded_frame_count) return null;
  return Object.freeze({ status: value.status, model_id: witness.model_id, destination: witness.destination,
    source_sha256: witness.source_sha256, source_size: witness.source_size,
    source_mime_type: witness.source_mime_type, width: witness.width, height: witness.height,
    duration_seconds: witness.duration_seconds, decoded_frame_count: witness.decoded_frame_count, url: witness.url });
}

/** Private same-client bridge for STS composition; the URL never enters the DTO. */
export function readOwnerElevenLabsStsOriginalUploadForClient(
  client: unknown,
  referenceInput: unknown
): (OwnerElevenLabsStsOriginalUploadReference & Readonly<{ destination: SyntxUploadDestination; model_type: "eleven_multilingual_sts_v2"; url: string }>) | null {
  if (!isExactOwnerElevenLabsStsUploadClient(client) ||
      !referenceInput || typeof referenceInput !== "object" || types.isProxy(referenceInput)) return null;
  const witness = OWNER_ELEVENLABS_STS_UPLOAD_CONTEXTS.get(referenceInput);
  if (!witness || witness.client !== client || !isSafeUploadReferenceUrl(witness.url)) return null;
  const reference = referenceInput as OwnerElevenLabsStsOriginalUploadReference;
  if (reference.status !== "OWNER_ELEVENLABS_STS_ORIGINAL_UPLOADED" ||
      reference.source_sha256 !== witness.source_sha256 || reference.size !== witness.size ||
      reference.mime_type !== witness.mime_type || reference.duration_seconds !== witness.duration_seconds) return null;
  return Object.freeze({ status: reference.status, source_sha256: witness.source_sha256, size: witness.size,
    mime_type: witness.mime_type, duration_seconds: witness.duration_seconds, destination: witness.destination,
    model_type: witness.model_type, url: witness.url });
}

/** Checks a private upload witness against the same native client and authentic pinned source profile. */
export function isOwnerVideo2AudioOriginalReferenceForClient(
  client: unknown,
  profile: OwnerVideo2AudioSourceProfile,
  reference: unknown
): reference is OwnerVideo2AudioOriginalReference {
  if (!client || typeof client !== "object" || !isAuthenticOwnerVideo2AudioSourceProfile(profile) ||
      !reference || typeof reference !== "object") return false;
  const witness = OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCES.get(reference);
  if (!witness || witness.client !== client || witness.profileSchemaHash !== profile.profileSchemaHash) return false;
  const value = reference as OwnerVideo2AudioOriginalReference;
  return value.status === "OWNER_VIDEO2AUDIO_ORIGINAL_UPLOADED" &&
    value.profile_schema_hash === witness.profileSchemaHash && value.sha256 === witness.sha256 &&
    value.mime_type === witness.mimeType && value.size === witness.size && value.duration_seconds === witness.durationSeconds;
}

/** Reveals the private upload URL only to code holding the same genuine client/profile/reference tuple. */
export function readOwnerVideo2AudioOriginalReferenceForClient(
  client: unknown,
  profile: OwnerVideo2AudioSourceProfile,
  reference: unknown
): OwnerVideo2AudioOriginalReferenceDetails | null {
  if (!isOwnerVideo2AudioOriginalReferenceForClient(client, profile, reference)) return null;
  const witness = OWNER_VIDEO2AUDIO_ORIGINAL_REFERENCES.get(reference)!;
  return Object.freeze({
    status: reference.status,
    profile_schema_hash: witness.profileSchemaHash,
    sha256: witness.sha256,
    mime_type: witness.mimeType,
    size: witness.size,
    duration_seconds: witness.durationSeconds,
    url: witness.url
  });
}

const NATIVE_OWNER_VIDEO2AUDIO_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_OWNER_VIDEO2AUDIO_START_AUDIO = SyntxChatHttpClient.prototype.startAudio;

interface ValidatedOwnerVideo2AudioNativeOperation {
  readonly profile: OwnerVideo2AudioSourceProfile;
  readonly binding: Readonly<OwnerVideo2AudioCandidateBinding>;
  readonly originalDetails: OwnerVideo2AudioOriginalReferenceDetails;
}

function assertNativeOwnerVideo2AudioClient(client: unknown): asserts client is SyntxChatHttpClient {
  try {
    if (!client || typeof client !== "object" || types.isProxy(client) ||
        Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        getDataMethod(client, "createChat") !== NATIVE_OWNER_VIDEO2AUDIO_CREATE_CHAT ||
        getDataMethod(client, "startAudio") !== NATIVE_OWNER_VIDEO2AUDIO_START_AUDIO) throw null;
  } catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
}

function validateOwnerVideo2AudioAbortSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && (types.isProxy(signal) || !(signal instanceof AbortSignal))) {
    throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  }
}

function snapshotOwnerVideo2AudioAuthorizeGetInput<T extends "chat" | "context">(
  value: unknown,
  contextKey: T
): Readonly<{ readonly [K in T]: T extends "chat" ? OwnerVideo2AudioChatContext : OwnerVideo2AudioResultMessageContext } & {
  readonly authorizeGet: OwnerVideo2AudioAuthorizeGet;
}> {
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, [contextKey, "authorizeGet"], [contextKey, "authorizeGet"]); }
  catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
  const authorizeGet = fields.authorizeGet;
  if (typeof authorizeGet !== "function" || types.isProxy(authorizeGet)) throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  return Object.freeze({ [contextKey]: fields[contextKey], authorizeGet }) as Readonly<{
    readonly [K in T]: T extends "chat" ? OwnerVideo2AudioChatContext : OwnerVideo2AudioResultMessageContext;
  } & { readonly authorizeGet: OwnerVideo2AudioAuthorizeGet }>;
}

async function authorizeOwnerVideo2AudioGet(authorizeGet: OwnerVideo2AudioAuthorizeGet, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");
  try { await authorizeGet(signal); }
  catch { throw ownerVideo2AudioNativeError(signal?.aborted ? "REQUEST_ABORTED" : "GET_AUTHORIZATION_FAILED"); }
  if (signal?.aborted) throw ownerVideo2AudioNativeError("REQUEST_ABORTED");
}

function snapshotOwnerVideo2AudioCreateInput(
  value: unknown,
  preparerApi: typeof import("../../application/owner-video2audio-request-preparer.js")
): Readonly<OwnerVideo2AudioNativeOperationInput> {
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, ["preparer", "candidate", "principal", "attemptId"], ["preparer", "candidate", "principal", "attemptId"]); }
  catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
  if (!preparerApi.isOwnerVideo2AudioRequestPreparer(fields.preparer) || !preparerApi.isOwnerVideo2AudioPreparedCandidate(fields.candidate) ||
      typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId)) {
    throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  }
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer, candidate: fields.candidate, principal, attemptId: fields.attemptId });
}

interface OwnerVideo2AudioNativeStartFields extends OwnerVideo2AudioNativeOperationInput {
  readonly permit: OwnerVideo2AudioOneShotPermit;
  readonly chat: OwnerVideo2AudioChatContext;
}

function snapshotOwnerVideo2AudioStartInput(
  value: unknown,
  preparerApi: typeof import("../../application/owner-video2audio-request-preparer.js"),
  permitApi: typeof import("../../application/owner-video2audio-one-shot-policy.js")
): Readonly<OwnerVideo2AudioNativeStartFields> {
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value,
    ["preparer", "candidate", "permit", "principal", "attemptId", "chat"],
    ["preparer", "candidate", "permit", "principal", "attemptId", "chat"]); }
  catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
  if (!preparerApi.isOwnerVideo2AudioRequestPreparer(fields.preparer) || !preparerApi.isOwnerVideo2AudioPreparedCandidate(fields.candidate) ||
      !permitApi.isOwnerVideo2AudioOneShotPermit(fields.permit) || typeof fields.attemptId !== "string" ||
      !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !fields.chat || typeof fields.chat !== "object" || types.isProxy(fields.chat)) {
    throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  }
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerVideo2AudioNativeError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerVideo2AudioNativeError("INVALID_REQUEST");
  return Object.freeze({ preparer: fields.preparer, candidate: fields.candidate, permit: fields.permit,
    principal, attemptId: fields.attemptId, chat: fields.chat as OwnerVideo2AudioChatContext });
}

function validateOwnerVideo2AudioNativeOperation(
  client: SyntxChatHttpClient,
  operation: Readonly<OwnerVideo2AudioNativeOperationInput>,
  preparerApi: typeof import("../../application/owner-video2audio-request-preparer.js")
): ValidatedOwnerVideo2AudioNativeOperation {
  let profile: OwnerVideo2AudioSourceProfile;
  try { profile = createOwnerVideo2AudioSourceProfile(); }
  catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
  if (!isAuthenticOwnerVideo2AudioSourceProfile(profile)) throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  let binding: OwnerVideo2AudioCandidateBinding | undefined;
  let privateRequest: OwnerVideo2AudioPreparedRequest;
  try {
    if (!preparerApi.isOwnerVideo2AudioRequestPreparer(operation.preparer) ||
        !preparerApi.isOwnerVideo2AudioPreparedCandidate(operation.candidate)) throw null;
    binding = operation.preparer.inspectCandidate(operation.candidate);
    if (!binding) throw null;
    privateRequest = operation.preparer.getPrivateRequest(operation.candidate);
  } catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
  const candidate = operation.candidate;
  if (binding.attempt_id !== operation.attemptId || !sameGenerationPrincipal(binding.principal, operation.principal) ||
      binding.profile_id !== profile.profileId || binding.profile_schema_hash !== profile.profileSchemaHash ||
      binding.captured_client !== client || binding.original_size !== candidate.original.size ||
      binding.original_sha256 !== candidate.original.sha256 || binding.duration_seconds !== candidate.original.duration_seconds ||
      binding.intent_fingerprint !== candidate.intent_fingerprint || binding.request_fingerprint !== candidate.request_fingerprint ||
      binding.expires_at !== candidate.expires_at || candidate.status !== "blocked" || candidate.model_id !== "video2audio" ||
      candidate.operation_id !== "generate-audio" || candidate.profile_id !== profile.profileId ||
      candidate.profile_schema_hash !== profile.profileSchemaHash || candidate.dispatch_allowed !== false ||
      candidate.runtime_usable !== false || candidate.backend_acceptance !== "UNPROVEN" ||
      !isDeepStrictEqual(binding.source_binding, candidate.source_binding) ||
      binding.source_binding.public_catalog_version !== profile.source.source_pins.public_catalog_version ||
      binding.source_binding.settings_inventory_version !== profile.source.source_pins.settings_inventory_version ||
      binding.source_binding.form_sha256 !== profile.source.source_pins.form_sha256) {
    throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  }
  const originalDetails = readOwnerVideo2AudioOriginalDetails(client, profile, binding.captured_reference, binding);
  validateOwnerVideo2AudioPrivateRequest(privateRequest, profile, binding, originalDetails);
  return Object.freeze({ profile, binding, originalDetails });
}

function readOwnerVideo2AudioOriginalDetails(
  client: SyntxChatHttpClient,
  profile: OwnerVideo2AudioSourceProfile,
  reference: OwnerVideo2AudioOriginalReference,
  binding: Readonly<OwnerVideo2AudioCandidateBinding>
): OwnerVideo2AudioOriginalReferenceDetails {
  const details = readOwnerVideo2AudioOriginalReferenceForClient(client, profile, reference);
  if (!details || details.profile_schema_hash !== profile.profileSchemaHash || details.sha256 !== binding.original_sha256 ||
      details.mime_type !== "video/mp4" || details.size !== binding.original_size ||
      details.duration_seconds !== binding.duration_seconds || !isSafeUploadReferenceUrl(details.url)) {
    throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  }
  return details;
}

function validateOwnerVideo2AudioPrivateRequest(
  input: unknown,
  profile: OwnerVideo2AudioSourceProfile,
  binding: Readonly<OwnerVideo2AudioCandidateBinding>,
  original: OwnerVideo2AudioOriginalReferenceDetails
): OwnerVideo2AudioPreparedRequest {
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(input, ["prompt", "settings"], ["prompt", "settings"]); }
  catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
  if (typeof fields.prompt !== "string" || normalizeOwnerVideo2AudioPrompt(fields.prompt, profile) !== fields.prompt ||
      fields.prompt !== binding.prompt) throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  let settings: Record<string, unknown>;
  try {
    settings = readExactDataRecord(fields.settings,
      ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"],
      ["model_type", "mode", "duration", "negative_prompt", "seed", "file_urls"]);
  } catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
  if (settings.model_type !== "video2audio" || settings.mode !== "generate" ||
      settings.duration !== original.duration_seconds || settings.negative_prompt !== "" || settings.seed !== 0 ||
      !Array.isArray(settings.file_urls) || types.isProxy(settings.file_urls) || settings.file_urls.length !== 1) {
    throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  }
  let videoReference: Record<string, unknown>;
  try { videoReference = readExactDataRecord(settings.file_urls[0], ["type", "url"], ["type", "url"]); }
  catch { throw ownerVideo2AudioNativeError("CANDIDATE_INVALID"); }
  if (videoReference.type !== "video" || videoReference.url !== original.url || !isSafeUploadReferenceUrl(original.url)) {
    throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
  }
  return Object.freeze({ prompt: fields.prompt, settings: Object.freeze({
    model_type: "video2audio", mode: "generate", duration: original.duration_seconds,
    negative_prompt: "", seed: 0, file_urls: Object.freeze([Object.freeze({ type: "video" as const, url: original.url })])
  }) });
}

function assertSameOwnerVideo2AudioCandidateBinding(
  expected: Readonly<OwnerVideo2AudioCandidateBinding>,
  actual: OwnerVideo2AudioCandidateBinding | undefined
): asserts actual is OwnerVideo2AudioCandidateBinding {
  if (!actual || actual.attempt_id !== expected.attempt_id || !sameGenerationPrincipal(actual.principal, expected.principal) ||
      actual.original_handle !== expected.original_handle || actual.profile_id !== expected.profile_id ||
      actual.profile_schema_hash !== expected.profile_schema_hash || !isDeepStrictEqual(actual.source_binding, expected.source_binding) ||
      actual.original_sha256 !== expected.original_sha256 || actual.original_size !== expected.original_size ||
      actual.duration_seconds !== expected.duration_seconds || actual.original_epoch !== expected.original_epoch ||
      actual.original_expires_at !== expected.original_expires_at || actual.expires_at !== expected.expires_at ||
      actual.intent_fingerprint !== expected.intent_fingerprint || actual.request_fingerprint !== expected.request_fingerprint ||
      actual.prompt !== expected.prompt || actual.captured_client !== expected.captured_client ||
      actual.captured_reference !== expected.captured_reference) throw ownerVideo2AudioNativeError("CANDIDATE_INVALID");
}

function buildOwnerVideo2AudioDispatchBody(chatUuid: string, request: OwnerVideo2AudioPreparedRequest): Record<string, JsonValue> {
  validatePathIdentifier(chatUuid);
  return {
    chat_uuid: chatUuid,
    prompt: request.prompt,
    settings: {
      model_type: "video2audio",
      mode: "generate",
      duration: request.settings.duration,
      negative_prompt: "",
      seed: 0,
      file_urls: [{ type: "video", url: request.settings.file_urls[0]!.url }]
    }
  };
}

function ownerVideo2AudioNativeChats(client: SyntxChatHttpClient): Map<string, OwnerVideo2AudioNativeChatState> {
  let chats = OWNER_VIDEO2AUDIO_NATIVE_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_VIDEO2AUDIO_NATIVE_CHATS.set(client, chats); }
  return chats;
}

function ownerVideo2AudioNativePendingCreates(client: SyntxChatHttpClient): Set<object> {
  let pending = OWNER_VIDEO2AUDIO_NATIVE_PENDING_CREATES.get(client);
  if (!pending) { pending = new Set<object>(); OWNER_VIDEO2AUDIO_NATIVE_PENDING_CREATES.set(client, pending); }
  return pending;
}

function ownerVideo2AudioNativeChatState(client: SyntxChatHttpClient, value: unknown): OwnerVideo2AudioNativeChatState {
  if (!value || typeof value !== "object" || types.isProxy(value)) throw ownerVideo2AudioNativeError("CHAT_CONTEXT_INVALID");
  const state = OWNER_VIDEO2AUDIO_NATIVE_CHAT_CONTEXTS.get(value);
  let chatUuid: unknown;
  try { chatUuid = (value as OwnerVideo2AudioChatContext).chat_uuid; } catch { throw ownerVideo2AudioNativeError("CHAT_CONTEXT_INVALID"); }
  if (!state || state.client !== client || state.chat !== value || !isSafeProviderId(chatUuid) ||
      ownerVideo2AudioNativeChats(client).get(chatUuid) !== state) throw ownerVideo2AudioNativeError("CHAT_CONTEXT_INVALID");
  return state;
}

function ownerVideo2AudioNativeResultContext(client: SyntxChatHttpClient, value: unknown): OwnerVideo2AudioNativeResultContextState {
  if (!value || typeof value !== "object" || types.isProxy(value)) throw ownerVideo2AudioNativeError("RESULT_CONTEXT_INVALID");
  const owned = OWNER_VIDEO2AUDIO_NATIVE_RESULT_CONTEXTS.get(value);
  if (!owned || owned.client !== client || owned.context !== value || owned.chat.client !== client ||
      ownerVideo2AudioNativeChats(client).get(owned.chat.chat.chat_uuid) !== owned.chat ||
      owned.chat.phase !== "ACKNOWLEDGED" || owned.chat.ownerEchoMessageId !== owned.codecContext.owner_echo_message_id ||
      owned.chat.resultContexts.get(owned.context.message_id) !== owned.context) {
    throw ownerVideo2AudioNativeError("RESULT_CONTEXT_INVALID");
  }
  return owned;
}

function emptyOwnerVideo2AudioCandidates(
  state: OwnerVideo2AudioNativeChatState,
  status: OwnerVideo2AudioResultCandidates["status"],
  ownerAckStatus: OwnerVideo2AudioResultCandidates["owner_ack_status"],
  pageStatus: OwnerVideo2AudioResultCandidates["history_page_status"],
  gaps: readonly OwnerVideo2AudioNativeGap[],
  calls = 0,
  totalCount: number | null = null,
  totalPages: number | null = null
): OwnerVideo2AudioResultCandidates {
  return Object.freeze({ status, owner_ack_status: ownerAckStatus, history_page_status: pageStatus,
    history_get_calls: calls, total_count: totalCount, total_pages: totalPages,
    provider_chat_id: null, owner_echo_message_id: state.ownerEchoMessageId ?? null,
    contexts: Object.freeze([]), gaps: Object.freeze([...gaps]), backend_acceptance: "UNPROVEN" });
}

function ownerVideo2AudioNativeError(code: OwnerVideo2AudioNativeErrorCode): OwnerVideo2AudioNativeError {
  return new OwnerVideo2AudioNativeError(code);
}

type SeedreamEditorHistoryRead = Readonly<{
  complete: boolean; unproven: boolean; messages: readonly z.infer<typeof chatHistoryRowSchema>[];
  provider_chat_id?: string; gaps: readonly OwnerSeedreamEditorImageNativeGap[];
}>;

const NATIVE_INPAINT_LIST_IN_PROGRESS = SyntxChatHttpClient.prototype.listInProgress;
const NATIVE_LIST_IN_PROGRESS = SyntxChatHttpClient.prototype.listInProgress;

function ownerSeedreamEditorChatMap(client: SyntxChatHttpClient): Map<string, OwnerSeedreamEditorChatState> {
  let chats = ownerSeedreamEditorChats.get(client);
  if (!chats) { chats = new Map(); ownerSeedreamEditorChats.set(client, chats); }
  return chats;
}

function sameEditorCandidateBinding(operation: Readonly<OwnerSeedreamEditorStartReservation>): boolean {
  try {
    const current = Reflect.apply(operation.preparer.inspectCandidate, operation.preparer, [operation.candidate]);
    return !!current && isDeepStrictEqual(current, operation.binding) && current.request_fingerprint === operation.request_fingerprint;
  } catch { return false; }
}

function sameEditorCapturedBinding(operation: Readonly<OwnerSeedreamEditorStartReservation>): boolean {
  try {
    const { binding, candidate } = operation;
    return Object.isFrozen(operation) && Object.isFrozen(binding) && Object.isFrozen(candidate) &&
      binding.attempt_id === operation.attemptId && sameGenerationPrincipal(binding.principal, operation.principal) &&
      binding.variant === candidate.variant && binding.profile_id === candidate.profile_id &&
      binding.profile_schema_hash === candidate.profile_schema_hash &&
      isDeepStrictEqual(binding.source_binding, candidate.source_binding) &&
      binding.request_fingerprint === operation.request_fingerprint && candidate.request_fingerprint === operation.request_fingerprint;
  } catch { return false; }
}

function mintOwnerSeedreamEditorPostDispatchWitness(client: SyntxChatHttpClient, chat: OwnerSeedreamEditorChatState,
  operation: Readonly<OwnerSeedreamEditorStartReservation>): OwnerSeedreamEditorImagePostDispatchWitness {
  if (!sameEditorCapturedBinding(operation) || chat.phase !== "OUTCOME_UNKNOWN" || chat.reservation !== operation) throw invalidRequest();
  const witness: OwnerSeedreamEditorImagePostDispatchWitness = Object.freeze({ status: "POST_DISPATCH_WITNESS",
    dispatch_allowed: false, backend_acceptance: "UNPROVEN" });
  ownerSeedreamEditorPostDispatchWitnesses.set(witness, { client, chat, operation, epoch: chat.epoch });
  return witness;
}

function assertEditorPostDispatchWitnessCurrent(witness: OwnerSeedreamEditorImagePostDispatchWitness,
  state: OwnerSeedreamEditorPostDispatchWitnessState | undefined): boolean {
  try {
    const current = state && (state.chat.started ?? state.chat.reservation);
    const chats = state && ownerSeedreamEditorChats.get(state.client);
    return !!state && !!current && ownerSeedreamEditorPostDispatchWitnesses.get(witness) === state &&
      state.chat.recoveryWitness === witness && state.chat.epoch === state.epoch && chats?.get(state.chat.chat_uuid) === state.chat &&
      state.chat.phase !== "AVAILABLE" && state.chat.phase !== "DELETED" && sameEditorCapturedBinding(state.operation) &&
      sameEditorCapturedBinding(current) && current.attemptId === state.operation.attemptId &&
      current.candidate === state.operation.candidate && current.preparer === state.operation.preparer &&
      current.request_fingerprint === state.operation.request_fingerprint && isDeepStrictEqual(current.binding, state.operation.binding) &&
      witness.status === "POST_DISPATCH_WITNESS" && witness.dispatch_allowed === false && witness.backend_acceptance === "UNPROVEN";
  } catch { return false; }
}

function assertEditorOperationCurrent(client: SyntxChatHttpClient, chat: OwnerSeedreamEditorChatState,
  operation: Readonly<OwnerSeedreamEditorStartReservation>): boolean {
  const chats = ownerSeedreamEditorChats.get(client);
  return !!chats && chats.get(chat.chat_uuid) === chat && chat.phase !== "AVAILABLE" && chat.phase !== "DELETED" &&
    (chat.started ?? chat.reservation) === operation;
}

function mintOwnerSeedreamEditorResultContext(client: SyntxChatHttpClient, chat: OwnerSeedreamEditorChatState,
  operation: Readonly<OwnerSeedreamEditorStartReservation>, fields: OwnerSeedreamEditorImageResultMessageContext,
  witness?: OwnerSeedreamEditorImagePostDispatchWitness): OwnerSeedreamEditorImageResultMessageContext {
  const context = Object.freeze({ ...fields });
  ownerSeedreamEditorResultContexts.set(context, { client, context, chat, operation, binding: operation.binding, epoch: chat.epoch,
    ...(witness === undefined ? {} : { witness }) });
  return context;
}

function mintOwnerBananaInpaintImageResultMessageContext(client: SyntxChatHttpClient, chat: OwnerBananaInpaintChatState,
  operation: Readonly<OwnerBananaInpaintStartReservation>, fields: OwnerBananaInpaintImageResultMessageContext): OwnerBananaInpaintImageResultMessageContext {
  const context = Object.freeze({ ...fields, message_object_ids: Object.freeze([...fields.message_object_ids]) });
  ownerBananaInpaintResultContexts.set(context, { client, context, chat, operation });
  return context;
}

function ownerBananaInpaintChatMap(client: SyntxChatHttpClient): Map<string, OwnerBananaInpaintChatState> {
  let chats = ownerBananaInpaintChats.get(client);
  if (!chats) {
    chats = new Map();
    ownerBananaInpaintChats.set(client, chats);
  }
  return chats;
}

const NATIVE_OWNER_SUNO_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_OWNER_SUNO_START_AUDIO = SyntxChatHttpClient.prototype.startAudio;
const NATIVE_OWNER_SUNO_PREPARER_INSPECT = OwnerSunoGenerationRequestPreparer.prototype.inspectCandidate;
const NATIVE_OWNER_SUNO_PREPARER_REVALIDATE = OwnerSunoGenerationRequestPreparer.prototype.revalidateCandidate;
const NATIVE_OWNER_SUNO_POLICY_REVALIDATE = OwnerSunoGenerationOneShotPolicy.prototype.revalidate;
const NATIVE_OWNER_SUNO_POLICY_CONSUME = OwnerSunoGenerationOneShotPolicy.prototype.consume;
const NATIVE_OWNER_ELEVENLABS_TTS_CREATE_CHAT = SyntxChatHttpClient.prototype.createChat;
const NATIVE_OWNER_ELEVENLABS_TTS_START_AUDIO = SyntxChatHttpClient.prototype.startAudio;
const NATIVE_OWNER_ELEVENLABS_DIALOGUE_CREATE_CHAT = SyntxChatHttpClient.prototype.createOwnerElevenLabsDialogueChat;
const NATIVE_OWNER_ELEVENLABS_DIALOGUE_START = SyntxChatHttpClient.prototype.startOwnerElevenLabsDialogueWithOwnedCandidate;
const NATIVE_OWNER_ELEVENLABS_DIALOGUE_LIST = SyntxChatHttpClient.prototype.listOwnedElevenLabsDialogueCandidates;
const NATIVE_OWNER_ELEVENLABS_DIALOGUE_RESULT = SyntxChatHttpClient.prototype.getOwnedElevenLabsDialogueResult;

type OwnerSunoTrackOperationPreparerModule = typeof import("../../application/owner-suno-track-operation-request-preparer.js");
type OwnerSunoTrackOperationPolicyModule = typeof import("../../application/owner-suno-track-operation-one-shot-policy.js");
interface OwnerSunoTrackOperationNativeMethods {
  readonly inspect: OwnerSunoTrackOperationRequestPreparer["inspectCandidate"];
  readonly revalidateCandidate: OwnerSunoTrackOperationRequestPreparer["revalidateCandidate"];
  readonly revalidatePolicy: OwnerSunoTrackOperationOneShotPolicy["revalidate"];
  readonly consume: OwnerSunoTrackOperationOneShotPolicy["consume"];
}
let ownerSunoTrackOperationNativeMethods: OwnerSunoTrackOperationNativeMethods | undefined;

async function loadOwnerSunoTrackOperationModules(): Promise<{
  readonly preparer: OwnerSunoTrackOperationPreparerModule;
  readonly policy: OwnerSunoTrackOperationPolicyModule;
  readonly native: OwnerSunoTrackOperationNativeMethods;
}> {
  const [preparer, policy] = await Promise.all([
    import("../../application/owner-suno-track-operation-request-preparer.js"),
    import("../../application/owner-suno-track-operation-one-shot-policy.js")
  ]);
  ownerSunoTrackOperationNativeMethods ??= Object.freeze({
    inspect: preparer.OwnerSunoTrackOperationRequestPreparer.prototype.inspectCandidate,
    revalidateCandidate: preparer.OwnerSunoTrackOperationRequestPreparer.prototype.revalidateCandidate,
    revalidatePolicy: policy.OwnerSunoTrackOperationOneShotPolicy.prototype.revalidate,
    consume: policy.OwnerSunoTrackOperationOneShotPolicy.prototype.consume
  });
  return Object.freeze({ preparer, policy, native: ownerSunoTrackOperationNativeMethods });
}

export type OwnerSunoGenerationNativeErrorCode = "INVALID_REQUEST" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_ALREADY_CREATED"
  | "CHAT_CONTEXT_INVALID" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID"
  | "OUTCOME_UNKNOWN" | "REQUEST_ABORTED" | "PRIVATE_REQUEST_UNAVAILABLE" | "RESULT_CONTEXT_INVALID"
  | "RESULT_GET_FAILED" | "HISTORY_UNVERIFIED" | "CAPACITY_EXCEEDED";
export class OwnerSunoGenerationNativeError extends Error {
  constructor(readonly code: OwnerSunoGenerationNativeErrorCode) {
    super("The owner Suno generation native operation could not be completed safely.");
    this.name = "OwnerSunoGenerationNativeError";
  }
}

export type OwnerSunoTrackOperationNativeErrorCode = "INVALID_REQUEST" | "CHAT_CREATE_FAILED" |
  "CHAT_CONTEXT_ALREADY_CREATED" | "CHAT_CONTEXT_INVALID" | "CHAT_NOT_DISPATCHED" |
  "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID" | "OUTCOME_UNKNOWN" | "REQUEST_ABORTED" |
  "PRIVATE_REQUEST_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "RESULT_GET_FAILED" |
  "HISTORY_UNVERIFIED" | "CAPACITY_EXCEEDED";
export class OwnerSunoTrackOperationNativeError extends Error {
  constructor(readonly code: OwnerSunoTrackOperationNativeErrorCode) {
    super("The owner Suno track-operation native operation could not be completed safely.");
    this.name = "OwnerSunoTrackOperationNativeError";
  }
}

export function isOwnerSunoGenerationChatContext(value: unknown, client?: unknown): value is OwnerSunoGenerationChatContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_GENERATION_CHAT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerSunoGenerationResultMessageContext(value: unknown,
  client?: unknown): value is OwnerSunoGenerationResultMessageContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_GENERATION_RESULT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerSunoTrackOperationChatContext(
  value: unknown, client?: unknown
): value is OwnerSunoTrackOperationChatContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_TRACK_OPERATION_CHAT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerSunoTrackOperationResultMessageContext(
  value: unknown, client?: unknown
): value is OwnerSunoTrackOperationResultMessageContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_TRACK_OPERATION_RESULT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerSunoExistingTrackChatContext(value: unknown,
  client?: unknown): value is OwnerSunoExistingTrackChatContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_EXISTING_TRACK_CHAT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerSunoExistingTrackResultMessageContext(value: unknown,
  client?: unknown): value is OwnerSunoExistingTrackResultMessageContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_SUNO_EXISTING_TRACK_RESULT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

function ownerSunoGenerationError(code: OwnerSunoGenerationNativeErrorCode): OwnerSunoGenerationNativeError {
  return new OwnerSunoGenerationNativeError(code);
}

function ownerSunoTrackOperationError(code: OwnerSunoTrackOperationNativeErrorCode): OwnerSunoTrackOperationNativeError {
  return new OwnerSunoTrackOperationNativeError(code);
}

function ownerSunoExistingTrackError(code: ConstructorParameters<typeof OwnerSunoExistingTrackNativeError>[0]): OwnerSunoExistingTrackNativeError {
  return new OwnerSunoExistingTrackNativeError(code);
}

function snapshotOwnerSunoExistingTrackIndexInput(value: unknown): Readonly<{
  attemptId: string; principal: Readonly<GenerationPrincipalRef>; page: number;
}> {
  try {
    const fields = readExactDataRecord(value, ["attemptId", "principal", "page"], ["attemptId", "principal", "page"]);
    const attemptId = fields.attemptId;
    if (typeof attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(attemptId) ||
        !Number.isSafeInteger(fields.page) || (fields.page as number) < 1 ||
        (fields.page as number) > OWNER_SUNO_EXISTING_INDEX_MAX_PAGE) throw null;
    const principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef);
    if (principal.connection_id !== attemptId) throw null;
    return Object.freeze({ attemptId, principal, page: fields.page as number });
  } catch { throw ownerSunoExistingTrackError("INVALID_REQUEST"); }
}

function ownerSunoExistingTrackChats(client: SyntxChatHttpClient): Map<string, OwnerSunoExistingTrackChatState> {
  let chats = OWNER_SUNO_EXISTING_TRACK_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_SUNO_EXISTING_TRACK_CHATS.set(client, chats); }
  return chats;
}

function ownerSunoExistingTrackChatState(client: SyntxChatHttpClient,
  value: unknown): OwnerSunoExistingTrackChatState {
  if (!isOwnerSunoExistingTrackChatContext(value, client)) throw ownerSunoExistingTrackError("CHAT_CONTEXT_INVALID");
  const state = OWNER_SUNO_EXISTING_TRACK_CHAT_CONTEXTS.get(value);
  if (!state || state.client !== client || ownerSunoExistingTrackChats(client).get(state.context.chat_uuid) !== state ||
      state.context.source_kind !== "EXISTING_OWNER_TRACK" || state.context.attempt_id !== state.attemptId ||
      !sameGenerationPrincipal(state.context.principal, state.principal) ||
      state.context.provider_chat_id !== state.source.provider_chat_id || state.context.title_family !== state.source.title_family) {
    throw ownerSunoExistingTrackError("CHAT_CONTEXT_INVALID");
  }
  return state;
}

function ownerSunoExistingTrackResultContextState(client: SyntxChatHttpClient,
  value: unknown): OwnerSunoExistingTrackResultContextState {
  if (!isOwnerSunoExistingTrackResultMessageContext(value, client)) throw ownerSunoExistingTrackError("RESULT_CONTEXT_INVALID");
  const state = OWNER_SUNO_EXISTING_TRACK_RESULT_CONTEXTS.get(value);
  if (!state || state.client !== client || state.context.source_kind !== "EXISTING_OWNER_TRACK" ||
      state.context.attempt_id !== state.chat.attemptId || !sameGenerationPrincipal(state.context.principal, state.chat.principal) ||
      state.context.chat_uuid !== state.chat.context.chat_uuid || state.context.provider_chat_id !== state.chat.context.provider_chat_id) {
    throw ownerSunoExistingTrackError("RESULT_CONTEXT_INVALID");
  }
  return state;
}

function assertNativeOwnerSunoClient(client: unknown): asserts client is SyntxChatHttpClient {
  try {
    if (!client || typeof client !== "object" || types.isProxy(client) ||
        Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        getDataMethod(client, "createChat") !== NATIVE_OWNER_SUNO_CREATE_CHAT ||
        getDataMethod(client, "startAudio") !== NATIVE_OWNER_SUNO_START_AUDIO) throw null;
  } catch { throw ownerSunoGenerationError("INVALID_REQUEST"); }
}

function validateOwnerSunoAbortSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) {
    throw ownerSunoGenerationError("INVALID_REQUEST");
  }
}

function validateOwnerSunoTrackOperationAbortSignal(signal: AbortSignal | undefined): void {
  if (signal !== undefined && (!(signal instanceof AbortSignal) || types.isProxy(signal))) {
    throw ownerSunoTrackOperationError("INVALID_REQUEST");
  }
}

function snapshotOwnerSunoGenerationStartInput(value: unknown, includeChat = false):
  Readonly<OwnerSunoGenerationStartInput & { readonly chat?: OwnerSunoGenerationChatContext }> {
  const allowed = ["candidate", "permit", "preparer", "oneShotPolicy", "principal", "attemptId",
    ...(includeChat ? ["chat"] : [])];
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, allowed, allowed); }
  catch { throw ownerSunoGenerationError("INVALID_REQUEST"); }
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !isOwnerSunoGenerationRequestPreparer(fields.preparer) ||
      !isOwnerSunoGenerationOneShotPolicy(fields.oneShotPolicy)) throw ownerSunoGenerationError("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerSunoGenerationError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerSunoGenerationError("INVALID_REQUEST");
  if (includeChat && !isOwnerSunoGenerationChatContext(fields.chat)) throw ownerSunoGenerationError("CHAT_CONTEXT_INVALID");
  // Candidate/permit may already be consumed on a replay; the chat WeakMap/phase check
  // must classify that replay before candidate revalidation can change its outcome.
  return Object.freeze({ candidate: fields.candidate as OwnerSunoGenerationPreparedCandidate,
    permit: fields.permit as OwnerSunoGenerationOneShotPermit,
    preparer: fields.preparer, oneShotPolicy: fields.oneShotPolicy, principal, attemptId: fields.attemptId,
    ...(includeChat ? { chat: fields.chat as OwnerSunoGenerationChatContext } : {}) });
}

function snapshotOwnerSunoTrackOperationStartInput(value: unknown, includeChat: boolean,
  preparerApi: OwnerSunoTrackOperationPreparerModule, policyApi: OwnerSunoTrackOperationPolicyModule):
  Readonly<OwnerSunoTrackOperationStartInput & { readonly chat?: OwnerSunoTrackOperationChatContext }> {
  const allowed = ["candidate", "permit", "preparer", "oneShotPolicy", "principal", "attemptId",
    ...(includeChat ? ["chat"] : [])];
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, allowed, allowed); }
  catch { throw ownerSunoTrackOperationError("INVALID_REQUEST"); }
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !preparerApi.isOwnerSunoTrackOperationRequestPreparer(fields.preparer) ||
      !policyApi.isOwnerSunoTrackOperationOneShotPolicy(fields.oneShotPolicy)) throw ownerSunoTrackOperationError("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerSunoTrackOperationError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerSunoTrackOperationError("INVALID_REQUEST");
  if (includeChat && !isOwnerSunoTrackOperationChatContext(fields.chat)) {
    throw ownerSunoTrackOperationError("CHAT_CONTEXT_INVALID");
  }
  return Object.freeze({ candidate: fields.candidate as OwnerSunoTrackOperationPreparedCandidate,
    permit: fields.permit as OwnerSunoTrackOperationOneShotPermit, preparer: fields.preparer as OwnerSunoTrackOperationRequestPreparer,
    oneShotPolicy: fields.oneShotPolicy, principal, attemptId: fields.attemptId as string,
    ...(includeChat ? { chat: fields.chat as OwnerSunoTrackOperationChatContext } : {}) });
}

function validateOwnerSunoTrackOperation(input: Readonly<OwnerSunoTrackOperationStartInput>,
  native: OwnerSunoTrackOperationNativeMethods):
  Readonly<OwnerSunoTrackOperationCandidateBinding> {
  try {
    const source = getOwnerSunoTrackOperationParameterSource();
    const sourceHash = schemaHash(source);
    const binding = Reflect.apply(native.inspect, input.preparer,
      [input.candidate]) as OwnerSunoTrackOperationCandidateBinding | undefined;
    if (!binding || !OWNER_SUNO_TRACK_OPERATION_MODELS.has(binding.model_id) ||
        (binding.mode !== "cover" && binding.mode !== "extend") || binding.attempt_id !== input.attemptId ||
        !sameGenerationPrincipal(binding.principal, input.principal) ||
        binding.source_profile_id !== "owner-suno-track-operation-parameters-source-v1" ||
        binding.source_profile_schema_hash !== sourceHash ||
        !isDeepStrictEqual(binding.source_pins, source.source_pins) ||
        !/^sha256:[a-f0-9]{64}$/u.test(binding.track_context_fingerprint) ||
        input.candidate.status !== "prepared" || input.candidate.model_id !== binding.model_id ||
        input.candidate.mode !== binding.mode || input.candidate.attempt_id !== input.attemptId ||
        input.candidate.source_profile_id !== binding.source_profile_id ||
        input.candidate.source_profile_schema_hash !== binding.source_profile_schema_hash ||
        !isDeepStrictEqual(input.candidate.source_pins, binding.source_pins) ||
        input.candidate.expires_at !== binding.expires_at ||
        input.candidate.intent_fingerprint !== binding.intent_fingerprint ||
        input.candidate.runtime_usable !== false || input.candidate.dispatch_allowed !== false ||
        input.candidate.backend_acceptance !== "UNPROVEN" ||
        input.permit.status !== "nominal" || input.permit.attempt_id !== input.attemptId ||
        input.permit.model_id !== binding.model_id || input.permit.mode !== binding.mode ||
        input.permit.expires_at !== binding.expires_at ||
        input.permit.source_profile_schema_hash !== binding.source_profile_schema_hash ||
        input.permit.intent_fingerprint !== binding.intent_fingerprint ||
        input.permit.dispatch_allowed !== false || input.permit.backend_acceptance !== "UNPROVEN") throw null;
    Reflect.apply(native.revalidateCandidate, input.preparer, [{
      candidate: input.candidate, attemptId: input.attemptId, principal: input.principal
    }]);
    const permit = Reflect.apply(native.revalidatePolicy, input.oneShotPolicy, [{
      candidate: input.candidate, permit: input.permit, attemptId: input.attemptId, principal: input.principal
    }]) as OwnerSunoTrackOperationOneShotReceipt;
    if (permit.status !== "revalidated" || permit.dispatch_allowed !== false ||
        permit.backend_acceptance !== "UNPROVEN" || permit.intent_fingerprint !== binding.intent_fingerprint) throw null;
    return binding;
  } catch { throw ownerSunoTrackOperationError("CANDIDATE_INVALID"); }
}

function validateOwnerSunoTrackOperationPrivateRequest(value: unknown,
  state: OwnerSunoTrackOperationChatState): OwnerSunoTrackOperationPrivateRequest {
  try {
    const request = readExactDataRecord(value, ["ai_name", "prompt", "settings"], ["ai_name", "prompt", "settings"]);
    const isExtend = state.mode === "extend";
    const settingsKeys = ["model_type", "mode", "is_custom_mode", "is_instrumental", "negative_tags", "styles", "title",
      "source_clip_id", "source_task_id", ...(isExtend ? ["continue_at"] : [])];
    const settings = readExactDataRecord(request.settings, settingsKeys, settingsKeys);
    const promptLimit = settings.is_custom_mode === true ? 5_000 : 500;
    if (request.ai_name !== "suno" || typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
        request.prompt.length > promptLimit || settings.model_type !== state.modelId || settings.mode !== state.mode ||
        typeof settings.is_custom_mode !== "boolean" || typeof settings.is_instrumental !== "boolean" ||
        typeof settings.negative_tags !== "string" || settings.negative_tags.length > 5_000 ||
        typeof settings.styles !== "string" || settings.styles.length > 1_000 ||
        typeof settings.title !== "string" || settings.title.length > 80 ||
        !isBoundedPrintableOwnerSunoSourceId(settings.source_clip_id) ||
        !isBoundedPrintableOwnerSunoSourceId(settings.source_task_id)) throw null;
    if (isExtend) {
      const continueAt = settings.continue_at;
      if (typeof continueAt !== "number" || !Number.isFinite(continueAt) || continueAt < 0 ||
          Math.abs(continueAt * 10 - Math.round(continueAt * 10)) > Number.EPSILON * Math.max(1, Math.abs(continueAt * 10)) * 4) {
        throw null;
      }
    }
    const safeSettings = sanitizeSettings(settings);
    if (!isPlainRecord(safeSettings) || !isDeepStrictEqual(safeSettings, { ...settings })) throw null;
    return Object.freeze({ ai_name: "suno", prompt: request.prompt,
      settings: Object.freeze({ ...safeSettings }) as unknown as OwnerSunoTrackOperationPrivateRequest["settings"] });
  } catch { throw ownerSunoTrackOperationError("CANDIDATE_INVALID"); }
}

function isBoundedPrintableOwnerSunoSourceId(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 256 && value.trim() === value &&
    !/[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u.test(value) && isWellFormedOwnerSunoSourceId(value);
}

function isWellFormedOwnerSunoSourceId(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function validateOwnerSunoGenerationOperation(input: Readonly<OwnerSunoGenerationStartInput>):
  Readonly<OwnerSunoGenerationCandidateBinding> {
  try {
    const binding = Reflect.apply(NATIVE_OWNER_SUNO_PREPARER_INSPECT, input.preparer,
      [input.candidate]) as OwnerSunoGenerationCandidateBinding | undefined;
    if (!binding || !OWNER_SUNO_GENERATION_MODELS.has(binding.model_id) || binding.attempt_id !== input.attemptId ||
        !sameGenerationPrincipal(binding.principal, input.principal) || binding.mode !== "generate" ||
        binding.source_profile_id !== "owner-suno-generate-parameters-source-v1" ||
        binding.source_pins.public_catalog_version !== OWNER_SUNO_GENERATION_PUBLIC_VERSION ||
        binding.source_pins.settings_inventory_version !== OWNER_SUNO_GENERATION_SETTINGS_VERSION ||
        input.candidate.status !== "prepared" || input.candidate.model_id !== binding.model_id ||
        input.candidate.mode !== "generate" || input.candidate.attempt_id !== input.attemptId ||
        input.candidate.source_profile_id !== binding.source_profile_id ||
        input.candidate.source_profile_schema_hash !== binding.source_profile_schema_hash ||
        input.candidate.expires_at !== binding.expires_at || input.candidate.intent_fingerprint !== binding.intent_fingerprint ||
        input.candidate.runtime_usable !== false || input.candidate.dispatch_allowed !== false ||
        input.candidate.backend_acceptance !== "UNPROVEN" ||
        input.permit.status !== "nominal" || input.permit.attempt_id !== input.attemptId ||
        input.permit.model_id !== binding.model_id || input.permit.expires_at !== binding.expires_at ||
        input.permit.source_profile_schema_hash !== binding.source_profile_schema_hash ||
        input.permit.intent_fingerprint !== binding.intent_fingerprint || input.permit.dispatch_allowed !== false ||
        input.permit.backend_acceptance !== "UNPROVEN") throw null;
    Reflect.apply(NATIVE_OWNER_SUNO_PREPARER_REVALIDATE, input.preparer, [{
      candidate: input.candidate, attemptId: input.attemptId, principal: input.principal
    }]);
    const permit = Reflect.apply(NATIVE_OWNER_SUNO_POLICY_REVALIDATE, input.oneShotPolicy, [{
      candidate: input.candidate, permit: input.permit, attemptId: input.attemptId, principal: input.principal
    }]) as OwnerSunoGenerationOneShotReceipt;
    if (permit.status !== "revalidated" || permit.dispatch_allowed !== false ||
        permit.backend_acceptance !== "UNPROVEN" || permit.intent_fingerprint !== binding.intent_fingerprint) throw null;
    return binding;
  } catch { throw ownerSunoGenerationError("CANDIDATE_INVALID"); }
}

function validateOwnerSunoGenerationPrivateRequest(value: unknown,
  state: OwnerSunoGenerationChatState): OwnerSunoGenerationPrivateRequest {
  try {
    const request = readExactDataRecord(value, ["ai_name", "prompt", "settings"], ["ai_name", "prompt", "settings"]);
    const settings = readExactDataRecord(request.settings, ["model_type", "mode", "is_custom_mode", "is_instrumental",
      "negative_tags", "styles", "title"], ["model_type", "mode", "is_custom_mode", "is_instrumental",
      "negative_tags", "styles", "title"]);
    if (request.ai_name !== "suno" || typeof request.prompt !== "string" || request.prompt.trim().length === 0 ||
        request.prompt.length > MAX_PROMPT_BYTES || settings.model_type !== state.modelId || settings.mode !== "generate" ||
        typeof settings.is_custom_mode !== "boolean" || typeof settings.is_instrumental !== "boolean" ||
        typeof settings.negative_tags !== "string" || settings.negative_tags.length > 5_000 ||
        typeof settings.styles !== "string" || settings.styles.length > 1_000 ||
        typeof settings.title !== "string" || settings.title.length > 80) throw null;
    const safeSettings = sanitizeSettings(settings);
    if (!isPlainRecord(safeSettings) || !isDeepStrictEqual(safeSettings, { ...settings })) throw null;
    return Object.freeze({ ai_name: "suno", prompt: request.prompt,
      settings: Object.freeze({ ...safeSettings }) as unknown as OwnerSunoGenerationPrivateRequest["settings"] });
  } catch { throw ownerSunoGenerationError("CANDIDATE_INVALID"); }
}

function ownerSunoGenerationChats(client: SyntxChatHttpClient): Map<string, OwnerSunoGenerationChatState> {
  let chats = OWNER_SUNO_GENERATION_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_SUNO_GENERATION_CHATS.set(client, chats); }
  return chats;
}

function ownerSunoGenerationChatState(client: SyntxChatHttpClient, value: unknown): OwnerSunoGenerationChatState {
  if (!isOwnerSunoGenerationChatContext(value, client)) throw ownerSunoGenerationError("CHAT_CONTEXT_INVALID");
  const state = OWNER_SUNO_GENERATION_CHAT_CONTEXTS.get(value);
  if (!state || state.client !== client || state.chat !== value ||
      ownerSunoGenerationChats(client).get(value.chat_uuid) !== state) throw ownerSunoGenerationError("CHAT_CONTEXT_INVALID");
  return state;
}

function ownerSunoGenerationResultContextState(client: SyntxChatHttpClient,
  value: unknown): OwnerSunoGenerationResultContextState {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw ownerSunoGenerationError("RESULT_CONTEXT_INVALID");
  }
  const owned = OWNER_SUNO_GENERATION_RESULT_CONTEXTS.get(value as object);
  if (!owned || owned.client !== client || owned.context !== value || owned.chat.client !== client ||
      ownerSunoGenerationChats(client).get(owned.chat.chat.chat_uuid) !== owned.chat ||
      owned.chat.phase !== "ACKNOWLEDGED" || owned.context.owner_echo_message_id !== owned.chat.ownerEchoMessageId ||
      owned.context.attempt_id !== owned.chat.chat.attempt_id || owned.context.model_id !== owned.chat.modelId ||
      !sameGenerationPrincipal(owned.context.principal, owned.chat.chat.principal) ||
      owned.context.intent_fingerprint !== owned.chat.chat.intent_fingerprint ||
      owned.context.source_profile_schema_hash !== owned.chat.chat.source_profile_schema_hash) {
    throw ownerSunoGenerationError("RESULT_CONTEXT_INVALID");
  }
  return owned;
}

function ownerSunoTrackOperationChats(client: SyntxChatHttpClient): Map<string, OwnerSunoTrackOperationChatState> {
  let chats = OWNER_SUNO_TRACK_OPERATION_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_SUNO_TRACK_OPERATION_CHATS.set(client, chats); }
  return chats;
}

function ownerSunoTrackOperationChatState(client: SyntxChatHttpClient, value: unknown): OwnerSunoTrackOperationChatState {
  if (!isOwnerSunoTrackOperationChatContext(value, client)) throw ownerSunoTrackOperationError("CHAT_CONTEXT_INVALID");
  const state = OWNER_SUNO_TRACK_OPERATION_CHAT_CONTEXTS.get(value);
  if (!state || state.client !== client || state.chat !== value ||
      ownerSunoTrackOperationChats(client).get(value.chat_uuid) !== state) {
    throw ownerSunoTrackOperationError("CHAT_CONTEXT_INVALID");
  }
  return state;
}

function ownerSunoTrackOperationResultContextState(client: SyntxChatHttpClient,
  value: unknown): OwnerSunoTrackOperationResultContextState {
  if (!value || typeof value !== "object" || types.isProxy(value) || Array.isArray(value)) {
    throw ownerSunoTrackOperationError("RESULT_CONTEXT_INVALID");
  }
  const owned = OWNER_SUNO_TRACK_OPERATION_RESULT_CONTEXTS.get(value as object);
  if (!owned || owned.client !== client || owned.context !== value || owned.chat.client !== client ||
      ownerSunoTrackOperationChats(client).get(owned.chat.chat.chat_uuid) !== owned.chat ||
      owned.chat.phase !== "ACKNOWLEDGED" || owned.context.owner_echo_message_id !== owned.chat.ownerEchoMessageId ||
      owned.context.attempt_id !== owned.chat.chat.attempt_id || owned.context.model_id !== owned.chat.modelId ||
      !sameGenerationPrincipal(owned.context.principal, owned.chat.chat.principal) ||
      owned.context.intent_fingerprint !== owned.chat.chat.intent_fingerprint ||
      owned.context.source_profile_schema_hash !== owned.chat.chat.source_profile_schema_hash ||
      owned.context.track_context_fingerprint !== owned.chat.chat.track_context_fingerprint ||
      owned.context.mode !== owned.chat.mode || !isDeepStrictEqual(owned.context.source_pins, owned.chat.chat.source_pins)) {
    throw ownerSunoTrackOperationError("RESULT_CONTEXT_INVALID");
  }
  return owned;
}

function readValidatedOwnerSunoTrackMetadata(raw: unknown,
  readyAudio: OwnerSunoAudioResult["ready_audio"], modelId: OwnerSunoGenerationModel, messageId: string):
  readonly InternalOwnerSunoGenerationTrackMetadata[] {
  if (readyAudio.length === 0 || !raw || typeof raw !== "object" || types.isProxy(raw) || Array.isArray(raw)) {
    return Object.freeze([]);
  }
  try {
    const prototype = Object.getPrototypeOf(raw);
    if (prototype !== Object.prototype && prototype !== null) return Object.freeze([]);
    const objectsDescriptor = Object.getOwnPropertyDescriptor(raw, "message_object");
    if (!objectsDescriptor || !("value" in objectsDescriptor) || !objectsDescriptor.enumerable ||
        !Array.isArray(objectsDescriptor.value) || types.isProxy(objectsDescriptor.value) ||
        Object.getPrototypeOf(objectsDescriptor.value) !== Array.prototype || objectsDescriptor.value.length > 64) {
      return Object.freeze([]);
    }
    const objects = objectsDescriptor.value as unknown[];
    const projected: InternalOwnerSunoGenerationTrackMetadata[] = [];
    for (const audio of readyAudio) {
      const objectDescriptor = Object.getOwnPropertyDescriptor(objects, String(audio.object_index));
      if (!objectDescriptor || !("value" in objectDescriptor) || !objectDescriptor.enumerable ||
          !objectDescriptor.value || typeof objectDescriptor.value !== "object" || types.isProxy(objectDescriptor.value)) continue;
      const objectValue = objectDescriptor.value;
      const objectId = Object.getOwnPropertyDescriptor(objectValue, "id");
      const objectMessageId = Object.getOwnPropertyDescriptor(objectValue, "message_id");
      const objectType = Object.getOwnPropertyDescriptor(objectValue, "object_type");
      const objectModelId = Object.getOwnPropertyDescriptor(objectValue, "model_type");
      if (!isEnumerableDataDescriptor(objectId) || ownerSunoDecodedProviderId(objectId.value) !== audio.message_object_id ||
          !isEnumerableDataDescriptor(objectMessageId) || ownerSunoDecodedProviderId(objectMessageId.value) !== messageId ||
          !isEnumerableDataDescriptor(objectType) || objectType.value !== "audio" ||
          !isEnumerableDataDescriptor(objectModelId) || objectModelId.value !== modelId) continue;
      const metadataDescriptor = Object.getOwnPropertyDescriptor(objectValue, "metadata");
      if (!metadataDescriptor || !("value" in metadataDescriptor) || !metadataDescriptor.enumerable) continue;
      const metadataValue = metadataDescriptor.value;
      if (!metadataValue || typeof metadataValue !== "object" || types.isProxy(metadataValue) || Array.isArray(metadataValue)) continue;
      const payloadDescriptor = Object.getOwnPropertyDescriptor(metadataValue, "payload");
      if (!payloadDescriptor || !("value" in payloadDescriptor) || !payloadDescriptor.enumerable) continue;
      const metadata = readOwnerSunoTrackMetadata(payloadDescriptor.value);
      if (!metadata) continue;
      projected.push(Object.freeze({ message_object_id: audio.message_object_id, clip_id: metadata.clip_id,
        task_id: metadata.task_id, model_id: modelId }));
    }
    return Object.freeze(projected);
  } catch {
    return Object.freeze([]);
  }
}

function isEnumerableDataDescriptor(value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } {
  return value !== undefined && value.enumerable === true && Object.hasOwn(value, "value");
}

/** Mirrors the audio decoder's accepted provider-ID normalization for extraction comparisons only. */
function ownerSunoDecodedProviderId(value: unknown): string | undefined {
  if (typeof value === "string") return isSafeProviderId(value) ? value : undefined;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return undefined;
}

function isPositiveOwnerSunoAck(
  row: z.infer<typeof OWNER_SUNO_GENERATION_HISTORY_ROW_SCHEMA>, prompt: string, modelId: OwnerSunoGenerationModel
): boolean {
  return row.author_id > 0 && row.message_object.length === 1 && row.message_object[0]!.object_type === "text" &&
    row.message_object[0]!.object_text === prompt && row.message_object[0]!.object_text!.trim().length > 0 &&
    row.message_object[0]!.model_type === modelId;
}

function emptyOwnerSunoGenerationHistory(status: OwnerSunoGenerationResultCandidates["status"], calls: number,
  gapCode: OwnerSunoGenerationNativeGap): OwnerSunoGenerationResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED",
    history_page_status: status === "PENDING" ? "COMPLETE" : status === "UNVERIFIED" ? "UNPROVEN" : "INCOMPLETE",
    history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gapCode]), backend_acceptance: "UNPROVEN" });
}

function ownerSunoGenerationHistoryReceipt(input: {
  readonly status: OwnerSunoGenerationResultCandidates["status"];
  readonly ack: OwnerSunoGenerationResultCandidates["owner_ack_status"];
  readonly calls: number;
  readonly totalCount: number | null;
  readonly totalPages: number | null;
  readonly providerChatId: string | null;
  readonly ownerEchoMessageId: string | null;
  readonly contexts: readonly OwnerSunoGenerationResultMessageContext[];
  readonly gaps: readonly OwnerSunoGenerationNativeGap[];
}): OwnerSunoGenerationResultCandidates {
  return Object.freeze({ status: input.status, owner_ack_status: input.ack,
    history_binding_status: input.status === "COMPLETE" ? "BOUND" : input.status === "UNVERIFIED" ? "UNVERIFIED" : "PARTIAL",
    history_page_status: input.status === "UNVERIFIED" ? "UNPROVEN" : "COMPLETE",
    history_get_calls: input.calls, total_count: input.totalCount, total_pages: input.totalPages,
    provider_chat_id: input.providerChatId, owner_echo_message_id: input.ownerEchoMessageId,
    contexts: Object.freeze([...input.contexts]), gaps: Object.freeze([...input.gaps]), backend_acceptance: "UNPROVEN" });
}

function emptyOwnerSunoTrackOperationHistory(status: OwnerSunoTrackOperationResultCandidates["status"], calls: number,
  gapCode: OwnerSunoTrackOperationNativeGap): OwnerSunoTrackOperationResultCandidates {
  return Object.freeze({ status, owner_ack_status: "MISSING", history_binding_status: "UNVERIFIED",
    history_page_status: status === "PENDING" ? "COMPLETE" : status === "UNVERIFIED" ? "UNPROVEN" : "INCOMPLETE",
    history_get_calls: calls, total_count: null, total_pages: null, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gapCode]), backend_acceptance: "UNPROVEN" });
}

function ownerSunoTrackOperationHistoryReceipt(input: {
  readonly status: OwnerSunoTrackOperationResultCandidates["status"];
  readonly ack: OwnerSunoTrackOperationResultCandidates["owner_ack_status"];
  readonly calls: number;
  readonly totalCount: number | null;
  readonly totalPages: number | null;
  readonly providerChatId: string | null;
  readonly ownerEchoMessageId: string | null;
  readonly contexts: readonly OwnerSunoTrackOperationResultMessageContext[];
  readonly gaps: readonly OwnerSunoTrackOperationNativeGap[];
}): OwnerSunoTrackOperationResultCandidates {
  return Object.freeze({ status: input.status, owner_ack_status: input.ack,
    history_binding_status: input.status === "COMPLETE" ? "BOUND" : input.status === "UNVERIFIED" ? "UNVERIFIED" : "PARTIAL",
    history_page_status: input.status === "UNVERIFIED" ? "UNPROVEN" : "COMPLETE",
    history_get_calls: input.calls, total_count: input.totalCount, total_pages: input.totalPages,
    provider_chat_id: input.providerChatId, owner_echo_message_id: input.ownerEchoMessageId,
    contexts: Object.freeze([...input.contexts]), gaps: Object.freeze([...input.gaps]), backend_acceptance: "UNPROVEN" });
}

function generationUrl(route: string, aiName: string): URL {
  const url = new URL(route, V1_BASE_URL);
  url.searchParams.set("ai_name", aiName);
  return url;
}

export type OwnerElevenLabsTtsNativeErrorCode = "INVALID_REQUEST" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_ALREADY_CREATED"
  | "CHAT_CONTEXT_INVALID" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID"
  | "OUTCOME_UNKNOWN" | "REQUEST_ABORTED" | "PRIVATE_REQUEST_UNAVAILABLE" | "RESULT_CONTEXT_INVALID" | "CAPACITY_EXCEEDED";
export class OwnerElevenLabsTtsNativeError extends Error {
  constructor(readonly code: OwnerElevenLabsTtsNativeErrorCode) {
    super("The owner ElevenLabs TTS native operation could not be completed safely.");
    this.name = "OwnerElevenLabsTtsNativeError";
  }
}

export function isOwnerElevenLabsTtsChatContext(value: unknown, client?: unknown): value is OwnerElevenLabsTtsChatContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerElevenLabsTtsAudioResultMessageContext(value: unknown, client?: unknown): value is OwnerElevenLabsTtsAudioResultMessageContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_ELEVENLABS_TTS_RESULT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

function ownerElevenLabsTtsError(code: OwnerElevenLabsTtsNativeErrorCode, _cause?: unknown): OwnerElevenLabsTtsNativeError {
  return new OwnerElevenLabsTtsNativeError(code);
}

function assertNativeElevenLabsTtsClient(client: unknown): asserts client is SyntxChatHttpClient {
  try {
    if (!client || typeof client !== "object" || types.isProxy(client) || Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        getDataMethod(client, "createChat") !== NATIVE_OWNER_ELEVENLABS_TTS_CREATE_CHAT ||
        getDataMethod(client, "startAudio") !== NATIVE_OWNER_ELEVENLABS_TTS_START_AUDIO) throw null;
  } catch { throw ownerElevenLabsTtsError("INVALID_REQUEST"); }
}

export type OwnerElevenLabsDialogueNativeErrorCode = "INVALID_REQUEST" | "CHAT_CREATE_FAILED" | "CHAT_CONTEXT_ALREADY_CREATED"
  | "CHAT_CONTEXT_INVALID" | "CHAT_NOT_DISPATCHED" | "CHAT_DISPATCH_ALREADY_STARTED" | "CANDIDATE_INVALID"
  | "OUTCOME_UNKNOWN" | "REQUEST_ABORTED" | "RESULT_CONTEXT_INVALID" | "CAPACITY_EXCEEDED";
export class OwnerElevenLabsDialogueNativeError extends Error {
  constructor(readonly code: OwnerElevenLabsDialogueNativeErrorCode) {
    super("The owner ElevenLabs dialogue native operation could not be completed safely.");
    this.name = "OwnerElevenLabsDialogueNativeError";
  }
}

export function isOwnerElevenLabsDialogueChatContext(value: unknown, client?: unknown): value is OwnerElevenLabsDialogueChatContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_ELEVENLABS_DIALOGUE_CHAT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

export function isOwnerElevenLabsDialogueAudioResultMessageContext(
  value: unknown, client?: unknown
): value is OwnerElevenLabsDialogueAudioResultMessageContext {
  try {
    if (!value || typeof value !== "object" || types.isProxy(value) || !Object.isFrozen(value)) return false;
    const state = OWNER_ELEVENLABS_DIALOGUE_RESULT_CONTEXTS.get(value);
    return !!state && (client === undefined || state.client === client);
  } catch { return false; }
}

function ownerElevenLabsDialogueError(code: OwnerElevenLabsDialogueNativeErrorCode): OwnerElevenLabsDialogueNativeError {
  return new OwnerElevenLabsDialogueNativeError(code);
}

function assertNativeElevenLabsDialogueClient(client: unknown): asserts client is SyntxChatHttpClient {
  try {
    if (!client || typeof client !== "object" || types.isProxy(client) ||
        Object.getPrototypeOf(client) !== SyntxChatHttpClient.prototype ||
        getDataMethod(client, "createChat") !== NATIVE_OWNER_ELEVENLABS_TTS_CREATE_CHAT ||
        getDataMethod(client, "startAudio") !== NATIVE_OWNER_ELEVENLABS_TTS_START_AUDIO ||
        getDataMethod(client, "createOwnerElevenLabsDialogueChat") !== NATIVE_OWNER_ELEVENLABS_DIALOGUE_CREATE_CHAT ||
        getDataMethod(client, "startOwnerElevenLabsDialogueWithOwnedCandidate") !== NATIVE_OWNER_ELEVENLABS_DIALOGUE_START ||
        getDataMethod(client, "listOwnedElevenLabsDialogueCandidates") !== NATIVE_OWNER_ELEVENLABS_DIALOGUE_LIST ||
        getDataMethod(client, "getOwnedElevenLabsDialogueResult") !== NATIVE_OWNER_ELEVENLABS_DIALOGUE_RESULT) throw null;
  } catch { throw ownerElevenLabsDialogueError("INVALID_REQUEST"); }
}

function snapshotOwnerElevenLabsDialogueStartInput(
  value: unknown, includeChat = false
): Readonly<OwnerElevenLabsDialogueStartInput & { chat?: OwnerElevenLabsDialogueChatContext }> {
  const keys = ["candidate", "permit", "preparer", "oneShotPolicy", "principal", "attemptId", ...(includeChat ? ["chat"] : [])];
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, keys, keys); }
  catch { throw ownerElevenLabsDialogueError("INVALID_REQUEST"); }
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !isOwnerElevenLabsDialogueRequestPreparer(fields.preparer) || !isOwnerElevenLabsDialoguePolicy(fields.oneShotPolicy) ||
      !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) {
    throw ownerElevenLabsDialogueError("INVALID_REQUEST");
  }
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerElevenLabsDialogueError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerElevenLabsDialogueError("INVALID_REQUEST");
  if (includeChat && !isOwnerElevenLabsDialogueChatContext(fields.chat)) {
    throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID");
  }
  return Object.freeze({ candidate: fields.candidate as OwnerElevenLabsDialoguePreparedCandidate,
    permit: fields.permit as OwnerElevenLabsDialogueOneShotPermit,
    preparer: fields.preparer as OwnerElevenLabsDialogueRequestPreparer,
    oneShotPolicy: fields.oneShotPolicy as OwnerElevenLabsDialogueOneShotPolicy,
    principal, attemptId: fields.attemptId,
    ...(includeChat ? { chat: fields.chat as OwnerElevenLabsDialogueChatContext } : {}) });
}

function isOwnerElevenLabsDialoguePolicy(value: unknown): value is OwnerElevenLabsDialogueOneShotPolicy {
  try {
    return !!value && typeof value === "object" && !types.isProxy(value) &&
      Object.getPrototypeOf(value) === OwnerElevenLabsDialogueOneShotPolicy.prototype &&
      getDataMethod(value, "revalidate") === OwnerElevenLabsDialogueOneShotPolicy.prototype.revalidate &&
      getDataMethod(value, "consume") === OwnerElevenLabsDialogueOneShotPolicy.prototype.consume;
  } catch { return false; }
}

function validateOwnerElevenLabsDialogueOperation(
  input: Readonly<OwnerElevenLabsDialogueStartInput>
): OwnerElevenLabsDialogueCandidateBinding {
  try {
    const binding = input.preparer.inspectCandidate(input.candidate);
    const profile = getOwnerElevenLabsDialogueSourceProfile();
    if (!binding || !OWNER_ELEVENLABS_DIALOGUE_MODELS.has(binding.model_id) || binding.attempt_id !== input.attemptId ||
        !sameGenerationPrincipal(binding.principal, input.principal) || input.candidate.model_id !== binding.model_id ||
        input.candidate.mode !== "text_to_dialogue" || input.candidate.voice_epoch !== binding.voice_epoch ||
        input.candidate.expires_at !== binding.expires_at || input.candidate.intent_fingerprint !== binding.intent_fingerprint ||
        input.candidate.profile_schema_hash !== binding.profile_schema_hash ||
        input.candidate.profile_id !== profile.profile_id || input.candidate.profile_schema_hash !== schemaHash(profile) ||
        input.candidate.public_catalog_sha256 !== profile.source_binding.public_catalog_sha256 ||
        input.candidate.form_sha256 !== profile.source_binding.form_module.sha256 ||
        input.candidate.dispatch_allowed !== false || input.candidate.generation_allowed !== false ||
        input.candidate.backend_acceptance !== "UNPROVEN") throw null;
    input.preparer.revalidateCandidate({ candidate: input.candidate, attemptId: input.attemptId, principal: input.principal });
    const receipt = Reflect.apply(OwnerElevenLabsDialogueOneShotPolicy.prototype.revalidate, input.oneShotPolicy, [{
      candidate: input.candidate, permit: input.permit, attemptId: input.attemptId, principal: input.principal
    }]) as OwnerElevenLabsDialogueOneShotReceipt;
    if (receipt.status !== "revalidated" || receipt.dispatch_allowed !== false || receipt.backend_acceptance !== "UNPROVEN" ||
        receipt.intent_fingerprint !== binding.intent_fingerprint) throw null;
    return binding;
  } catch { throw ownerElevenLabsDialogueError("CANDIDATE_INVALID"); }
}

function validateOwnerElevenLabsDialoguePrivateRequest(
  value: unknown, state: OwnerElevenLabsDialogueChatState
): OwnerElevenLabsDialoguePrivateRequest {
  try {
    const request = readExactDataRecord(value, ["prompt", "settings"], ["prompt", "settings"]);
    const settings = readExactDataRecord(request.settings,
      ["model_type", "mode", "inputs", "chars_count", "stability", "similarity_boost", "language_code"],
      ["model_type", "mode", "inputs", "chars_count"]);
    const preparedRequest = getOwnerElevenLabsDialoguePrivateRequestForPolicy(state.operation.candidate);
    const expectedSettings = preparedRequest.settings;
    const inputs = settings.inputs as unknown[];
    let charsCount = 0;
    const expectedInputs = expectedSettings.inputs;
    if (typeof request.prompt !== "string" || request.prompt.length > MAX_PROMPT_BYTES ||
        request.prompt.length !== state.operation.candidate.prompt_length ||
        request.prompt !== preparedRequest.prompt ||
        settings.model_type !== state.modelId || settings.mode !== "text_to_dialogue" ||
        !Array.isArray(inputs) || types.isProxy(inputs) || inputs.length !== state.operation.candidate.line_count ||
        inputs.length !== expectedInputs.length || Reflect.ownKeys(settings).length !== Reflect.ownKeys(expectedSettings).length ||
        !Number.isSafeInteger(settings.chars_count) || settings.chars_count !== state.operation.candidate.chars_count ||
        !Object.isFrozen(inputs)) throw null;
    for (const key of ["model_type", "mode", "inputs", "chars_count", "stability", "similarity_boost", "language_code"] as const) {
      if (Object.hasOwn(settings, key) !== Object.hasOwn(expectedSettings, key) ||
          (key !== "inputs" && Object.hasOwn(settings, key) && settings[key] !== expectedSettings[key])) throw null;
    }
    for (let index = 0; index < inputs.length; index += 1) {
      const line = readExactDataRecord(inputs[index], ["name", "text", "voice_id"], ["name", "text", "voice_id"]);
      const expected = expectedInputs[index]!;
      if (line.name !== expected.name || line.text !== expected.text || line.voice_id !== expected.voice_id ||
          typeof line.text !== "string") throw null;
      charsCount += line.text.length;
    }
    if (settings.chars_count !== charsCount) throw null;
    return Object.freeze({ prompt: request.prompt, settings: settings as unknown as OwnerElevenLabsDialoguePrivateRequest["settings"] });
  } catch { throw ownerElevenLabsDialogueError("CANDIDATE_INVALID"); }
}

function ownerElevenLabsDialogueChats(client: SyntxChatHttpClient): Map<string, OwnerElevenLabsDialogueChatState> {
  let chats = OWNER_ELEVENLABS_DIALOGUE_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_ELEVENLABS_DIALOGUE_CHATS.set(client, chats); }
  return chats;
}

function ownerElevenLabsDialogueChatState(
  client: SyntxChatHttpClient, value: unknown
): OwnerElevenLabsDialogueChatState {
  if (!isOwnerElevenLabsDialogueChatContext(value)) throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID");
  const state = OWNER_ELEVENLABS_DIALOGUE_CHAT_CONTEXTS.get(value);
  if (!state || state.client !== client || state.chat !== value || ownerElevenLabsDialogueChats(client).get(value.chat_uuid) !== state) {
    throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID");
  }
  return state;
}

function validateOwnerElevenLabsDialogueChatStillBound(state: OwnerElevenLabsDialogueChatState): void {
  if (state.phase === "AVAILABLE") {
    try { validateOwnerElevenLabsDialogueOperation(state.operation); }
    catch { throw ownerElevenLabsDialogueError("CHAT_CONTEXT_INVALID"); }
  }
}

function emptyOwnerElevenLabsDialogueHistory(
  status: OwnerElevenLabsDialogueMessageCandidates["status"], calls: number, gap: string,
  ownerAck: OwnerElevenLabsDialogueMessageCandidates["owner_ack_status"] = "MISSING",
  providerChatId: string | null = null,
  pageStatus: OwnerElevenLabsDialogueMessageCandidates["history_page_status"] =
    status === "PENDING" ? "COMPLETE" : status === "UNVERIFIED" ? "UNVERIFIED" : "INCOMPLETE"
): OwnerElevenLabsDialogueMessageCandidates {
  return Object.freeze({ status, owner_ack_status: ownerAck, history_binding_status: "UNVERIFIED",
    history_page_status: pageStatus, history_get_calls: calls, provider_chat_id: providerChatId,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function snapshotOwnerElevenLabsTtsStartInput(value: unknown, includeChat = false): Readonly<OwnerElevenLabsTtsStartInput & { chat?: OwnerElevenLabsTtsChatContext }> {
  const keys = ["candidate", "permit", "preparer", "oneShotPolicy", "principal", "attemptId", ...(includeChat ? ["chat"] : [])];
  let fields: Record<string, unknown>;
  try { fields = readExactDataRecord(value, keys, keys); }
  catch { throw ownerElevenLabsTtsError("INVALID_REQUEST"); }
  if (typeof fields.attemptId !== "string" || !/^link_[A-Za-z0-9_-]{20,120}$/u.test(fields.attemptId) ||
      !isOwnerElevenLabsTtsRequestPreparer(fields.preparer) || !isOwnerElevenLabsTtsTtsPolicy(fields.oneShotPolicy) ||
      !fields.candidate || typeof fields.candidate !== "object" || types.isProxy(fields.candidate) ||
      !fields.permit || typeof fields.permit !== "object" || types.isProxy(fields.permit)) throw ownerElevenLabsTtsError("INVALID_REQUEST");
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(fields.principal as GenerationPrincipalRef); }
  catch { throw ownerElevenLabsTtsError("INVALID_REQUEST"); }
  if (principal.connection_id !== fields.attemptId) throw ownerElevenLabsTtsError("INVALID_REQUEST");
  if (includeChat && !isOwnerElevenLabsTtsChatContext(fields.chat)) throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID");
  return Object.freeze({ candidate: fields.candidate as OwnerElevenLabsTtsPreparedCandidate,
    permit: fields.permit as OwnerElevenLabsTtsOneShotPermit,
    preparer: fields.preparer as OwnerElevenLabsTtsRequestPreparer,
    oneShotPolicy: fields.oneShotPolicy as OwnerElevenLabsTtsOneShotPolicy,
    principal, attemptId: fields.attemptId, ...(includeChat ? { chat: fields.chat as OwnerElevenLabsTtsChatContext } : {}) });
}

function isOwnerElevenLabsTtsTtsPolicy(value: unknown): value is OwnerElevenLabsTtsOneShotPolicy {
  try { return !!value && typeof value === "object" && !types.isProxy(value) &&
    Object.getPrototypeOf(value) === OwnerElevenLabsTtsOneShotPolicy.prototype &&
    getDataMethod(value, "revalidate") === OwnerElevenLabsTtsOneShotPolicy.prototype.revalidate &&
    getDataMethod(value, "consume") === OwnerElevenLabsTtsOneShotPolicy.prototype.consume; }
  catch { return false; }
}

function validateOwnerElevenLabsTtsOperation(input: Readonly<OwnerElevenLabsTtsStartInput>): OwnerElevenLabsTtsCandidateBinding {
  let binding: OwnerElevenLabsTtsCandidateBinding | undefined;
  try {
    binding = input.preparer.inspectCandidate(input.candidate);
    if (!binding || !OWNER_ELEVENLABS_TTS_MODELS.has(binding.model_id) || binding.attempt_id !== input.attemptId ||
        !sameGenerationPrincipal(binding.principal, input.principal) ||
        input.candidate.model_id !== binding.model_id || input.candidate.mode !== "text_to_speech" ||
        input.candidate.voice_epoch !== binding.voice_epoch || input.candidate.expires_at !== binding.expires_at ||
        input.candidate.intent_fingerprint !== binding.intent_fingerprint || input.candidate.dispatch_allowed !== false ||
        input.candidate.generation_allowed !== false || input.candidate.backend_acceptance !== "UNPROVEN" ||
        input.candidate.public_catalog_version !== "sha256-b06698c84a002f5cc7d379e5d3ead94974b0e279fae45c8bb83fa803b0d895b9.json" ||
        input.candidate.settings_inventory_version !== "sha256-1b48c058362e847886f90dd733b8e4b28e598e16a0360f2b466916ef9a3e33c5.json") throw null;
    input.preparer.revalidateCandidate({ candidate: input.candidate, attemptId: input.attemptId, principal: input.principal });
    const permit = Reflect.apply(OwnerElevenLabsTtsOneShotPolicy.prototype.revalidate, input.oneShotPolicy, [{
      candidate: input.candidate, permit: input.permit, attemptId: input.attemptId, principal: input.principal
    }]) as OwnerElevenLabsTtsOneShotReceipt;
    if (permit.status !== "revalidated" || permit.dispatch_allowed !== false || permit.backend_acceptance !== "UNPROVEN" ||
        permit.intent_fingerprint !== binding.intent_fingerprint) throw null;
    return binding;
  } catch { throw ownerElevenLabsTtsError("CANDIDATE_INVALID"); }
}

function validateOwnerElevenLabsTtsPrivateRequest(value: unknown,
  state: OwnerElevenLabsTtsChatState): OwnerElevenLabsTtsPrivateRequest {
  try {
    const request = readExactDataRecord(value, ["prompt", "settings"], ["prompt", "settings"]);
    const settings = readExactDataRecord(request.settings, ["model_type", "mode", "voice_id", "chars_count", "stability",
      "similarity_boost", "file_urls", "language_code"], ["model_type", "mode", "voice_id", "chars_count", "stability",
      "similarity_boost", "file_urls"]);
    if (typeof request.prompt !== "string" || request.prompt.trim().length === 0 || request.prompt.length > MAX_PROMPT_BYTES ||
        settings.model_type !== state.modelId || settings.mode !== "text_to_speech" ||
        typeof settings.voice_id !== "string" || !SAFE_RESPONSE_TOKEN.test(settings.voice_id) ||
        settings.chars_count !== request.prompt.length || settings.chars_count !== state.operation.candidate.chars_count ||
        typeof settings.stability !== "number" || settings.stability !== state.operation.candidate.stability ||
        typeof settings.similarity_boost !== "number" || settings.similarity_boost !== state.operation.candidate.similarity_boost ||
        !Array.isArray(settings.file_urls) || settings.file_urls.length !== 0 ||
        (state.modelId === "eleven_v4" || state.modelId === "eleven_v4_turbo"
          ? settings.language_code !== "auto" || state.operation.candidate.language_code !== "auto"
          : Object.hasOwn(settings, "language_code") || Object.hasOwn(state.operation.candidate, "language_code"))) throw null;
    return Object.freeze({ prompt: request.prompt, settings: settings as unknown as OwnerElevenLabsTtsPrivateRequest["settings"] });
  } catch { throw ownerElevenLabsTtsError("CANDIDATE_INVALID"); }
}

function ownerElevenLabsTtsChats(client: SyntxChatHttpClient): Map<string, OwnerElevenLabsTtsChatState> {
  let chats = OWNER_ELEVENLABS_TTS_CHATS.get(client);
  if (!chats) { chats = new Map(); OWNER_ELEVENLABS_TTS_CHATS.set(client, chats); }
  return chats;
}

function ownerElevenLabsTtsChatState(client: SyntxChatHttpClient, value: unknown): OwnerElevenLabsTtsChatState {
  if (!isOwnerElevenLabsTtsChatContext(value)) throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID");
  const state = OWNER_ELEVENLABS_TTS_CHAT_CONTEXTS.get(value);
  if (!state || state.client !== client || state.chat !== value || ownerElevenLabsTtsChats(client).get(value.chat_uuid) !== state) {
    throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID");
  }
  return state;
}

function validateOwnerElevenLabsTtsChatStillBound(state: OwnerElevenLabsTtsChatState): void {
  if (state.phase === "AVAILABLE" || state.phase === "RESERVED") {
    try { state.operation.preparer.revalidateCandidate({ candidate: state.operation.candidate,
      attemptId: state.operation.attemptId, principal: state.operation.principal }); }
    catch { throw ownerElevenLabsTtsError("CHAT_CONTEXT_INVALID"); }
  }
  // After a POST starts, voice-reference TTL is not a result-read TTL; keep only the owned chat/source context for GET recovery.
}

function isPositiveElevenLabsTtsAck(
  row: z.infer<typeof OWNER_ELEVENLABS_TTS_HISTORY_ROW_SCHEMA>, prompt: string, modelId: OwnerElevenLabsTtsModel
): boolean {
  return row.author_id > 0 && row.message_object.length === 1 && row.message_object[0]!.object_type === "text" &&
    row.message_object[0]!.object_text === prompt && row.message_object[0]!.object_text!.trim().length > 0 &&
    row.message_object[0]!.model_type === modelId;
}

function emptyOwnerElevenLabsTtsHistory(status: OwnerElevenLabsTtsMessageCandidates["status"], calls: number, gap: string,
  ownerAck: OwnerElevenLabsTtsMessageCandidates["owner_ack_status"] = "MISSING"): OwnerElevenLabsTtsMessageCandidates {
  return Object.freeze({ status, owner_ack_status: ownerAck, history_binding_status: "UNVERIFIED",
    history_page_status: status === "PENDING" ? "COMPLETE" : status === "UNVERIFIED" ? "UNPROVEN" : "INCOMPLETE",
    history_get_calls: calls, total_count: 0, total_pages: 0, provider_chat_id: null,
    owner_echo_message_id: null, contexts: Object.freeze([]), gaps: Object.freeze([gap]), backend_acceptance: "UNPROVEN" });
}

function isSafeProviderId(value: unknown): value is string {
  return typeof value === "string" && SAFE_RESPONSE_TOKEN.test(value);
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}

function validateOwnerUniPrompt(value: unknown, modelId: OwnerUniImageModel, referenceCount: number, maximumUtf16Units: number): void {
  const source = modelId === "uni-1.1-remove-background" ? "optional_with_reference" : "required";
  if (typeof value !== "string" || maximumUtf16Units !== 6_000 ||
      (source === "required" && value.trim().length === 0) ||
      (source === "optional_with_reference" && referenceCount < 1) ||
      value.length + (value.match(/\n/gu)?.length ?? 0) > maximumUtf16Units ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(value)) {
    throw invalidRequest();
  }
  validateBoundedText(value, MAX_PROMPT_BYTES, source === "required");
}

function validateOwnerUniParameters(
  parameters: Record<string, unknown>,
  modelId: OwnerUniImageModel,
  source: OwnerUniImageSourceParameters
): void {
  const seed = parameters.seed;
  const validSeed = seed === null || (Number.isSafeInteger(seed) && typeof seed === "number" &&
    seed >= source.controls.seed.minimum && seed <= source.controls.seed.maximum);
  if (modelId === "uni-1") {
    const mode = parameters.mode;
    const ratio = parameters.aspect_ratio;
    if (!validSeed || typeof mode !== "string" || !source.controls.mode.values.includes(mode as never) ||
        typeof ratio !== "string" || !source.controls.aspect_ratio.values.includes(ratio as never) ||
        (mode === "manga" && !source.controls.aspect_ratio.manga_values.includes(ratio as never))) throw invalidRequest();
    return;
  }
  if (modelId === "uni-1.1-modify-image") {
    const mode = parameters.mode;
    if (!validSeed || typeof mode !== "string" || !source.controls.mode.values.includes(mode as never)) throw invalidRequest();
    return;
  }
  if (typeof parameters.invert_mask !== "boolean") throw invalidRequest();
}

function snapshotOwnerUniImageFileUrls(value: unknown, expectedCount: number, maximumCount: number): readonly { type: "image"; url: string }[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value) || value.length !== expectedCount || value.length > maximumCount) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== value.length + 1 || ownKeys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !(key in descriptors) || !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw invalidRequest();
  const urls = new Set<string>();
  const output: Array<{ type: "image"; url: string }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw invalidRequest();
    const fields = readExactDataRecord(descriptor.value, ["type", "url"], ["type", "url"]);
    if (fields.type !== "image" || typeof fields.url !== "string" || !isSafeUploadReferenceUrl(fields.url) || urls.has(fields.url)) {
      throw invalidRequest();
    }
    let url: URL;
    try { url = new URL(fields.url); } catch { throw invalidRequest(); }
    if (url.search || url.username || url.password || url.hash) throw invalidRequest();
    urls.add(fields.url);
    output.push(Object.freeze({ type: "image", url: fields.url }));
  }
  return Object.freeze(output);
}

function snapshotClarityPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { throw invalidRequest(); }
  if (principal.connection_id !== attemptId) throw invalidRequest();
  return principal;
}

function snapshotMagnificPrincipal(value: unknown, attemptId: string): Readonly<GenerationPrincipalRef> {
  let principal: Readonly<GenerationPrincipalRef>;
  try { principal = snapshotGenerationPrincipal(value as GenerationPrincipalRef); }
  catch { throw invalidRequest(); }
  if (principal.connection_id !== attemptId) throw invalidRequest();
  return principal;
}

function snapshotClarityCandidate(
  value: unknown,
  principal: Readonly<GenerationPrincipalRef>,
  attemptId: string
): Readonly<{ prompt?: string; settings: Readonly<Record<string, unknown>> }> {
  const profile = getOwnerClarityUpscaleSourceProfile();
  if (!isOwnerClarityUpscalePreparedCandidateForPrincipal(value, principal, attemptId)) throw invalidRequest();
  const candidate = readClarityCandidateRecord(value);
  const request = readExactDataRecord(candidate.request, ["prompt", "settings"], ["settings"]);
  const query = readExactDataRecord(candidate.query, ["ai_name"], ["ai_name"]);
  const settings = readExactDataRecord(request.settings,
    ["n", "model_type", "scale", "is_professional_mode", "strength", "cfg", "denoise", "file_urls"],
    ["n", "model_type", "scale", "is_professional_mode", "strength", "cfg", "denoise", "file_urls"]);
  const image = readExactDataRecord(candidate.image, ["mime_type", "width", "height"], ["mime_type", "width", "height"]);
  snapshotClarityFileUrl(settings.file_urls);
  const prompt = request.prompt;
  const profileSchemaHash = schemaHash(profile);
  if (candidate.status !== "blocked" || candidate.dispatch_allowed !== false || candidate.backend_acceptance !== "unproven" ||
      candidate.profile_id !== profile.profile_id || candidate.profile_schema_hash !== profileSchemaHash ||
      !isDeepStrictEqual(candidate.source_binding, profile.source_binding) ||
      candidate.model_id !== "clarity" || candidate.ai_name !== "clarity" || candidate.model_type !== "clarity" ||
      candidate.operation_id !== "upscale-image" || candidate.modality !== "image" || candidate.source_route !== "design/generate" ||
      candidate.mime_confidence !== "UPLOAD_DECLARED_NOT_SNIFFED" || query.ai_name !== "clarity" ||
      typeof candidate.request_fingerprint !== "string" || !/^sha256:[a-f0-9]{64}$/u.test(candidate.request_fingerprint) ||
      settings.n !== 1 || settings.model_type !== "clarity" || typeof settings.scale !== "number" || !Number.isFinite(settings.scale) ||
      typeof settings.is_professional_mode !== "boolean" || typeof settings.strength !== "number" ||
      typeof settings.cfg !== "number" || typeof settings.denoise !== "number" ||
      typeof image.mime_type !== "string" || !profile.input_mime_types.includes(image.mime_type as never) ||
      !Number.isSafeInteger(image.width) || (image.width as number) < 1 ||
      !Number.isSafeInteger(image.height) || (image.height as number) < 1 ||
      (prompt !== undefined && typeof prompt !== "string")) throw invalidRequest();

  if (prompt !== undefined) validateBoundedText(prompt, profile.prompt_policy.maximum_utf8_bytes, true);
  const scaleFactor = (settings.scale as number) * profile.settings.scale_base_coefficient;
  const maxProfessionalFactor = Math.min(
    profile.settings.professional_scale_factor.maximum,
    Math.floor(profile.settings.dimension_ceiling / Math.max(image.width as number, image.height as number) * 100) / 100
  );
  const scaleValid = settings.is_professional_mode
    ? isClarityStepValue(scaleFactor, profile.settings.professional_scale_factor.minimum, maxProfessionalFactor, profile.settings.professional_scale_factor.step)
    : profile.settings.ordinary_scale_factors.some((factor) => Math.abs(scaleFactor - factor) < 1e-9);
  if (!scaleValid ||
      !isClarityStepValue(settings.strength, profile.settings.strength.minimum, profile.settings.strength.maximum, profile.settings.strength.step) ||
      !Number.isInteger(settings.cfg) || settings.cfg < profile.settings.cfg.minimum || settings.cfg > profile.settings.cfg.maximum ||
      !isClarityStepValue(settings.denoise, profile.settings.denoise.minimum, profile.settings.denoise.maximum, profile.settings.denoise.step)) {
    throw invalidRequest();
  }
  const expectedFingerprint = schemaHash({
    profile_schema_hash: profileSchemaHash,
    principal,
    attempt_id: attemptId,
    prompt: prompt ?? null,
    query: { ai_name: "clarity" },
    settings: request.settings
  });
  if (expectedFingerprint !== candidate.request_fingerprint) throw invalidRequest();
  return Object.freeze({
    ...(prompt === undefined ? {} : { prompt }),
    settings: request.settings as Readonly<Record<string, unknown>>
  });
}

function readClarityCandidateRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value)) throw invalidRequest();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  const symbols = keys.filter((key): key is symbol => typeof key === "symbol");
  const strings = keys.filter((key): key is string => typeof key === "string");
  const expected = ["status", "dispatch_allowed", "backend_acceptance", "profile_id", "profile_schema_hash", "source_binding",
    "model_id", "ai_name", "model_type", "operation_id", "modality", "source_route", "mime_confidence",
    "image", "request_fingerprint", "query", "request"];
  if (symbols.length !== 1 || symbols[0]!.description !== "OwnerClarityUpscalePreparedCandidate" ||
      Object.getOwnPropertyDescriptor(value, symbols[0]!)?.value !== true || strings.length !== expected.length ||
      strings.some((key) => !expected.includes(key)) ||
      keys.some((key) => !("value" in descriptors[key as keyof typeof descriptors]!))) throw invalidRequest();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of strings) result[key] = descriptors[key]!.value;
  return result;
}

function snapshotClarityFileUrl(value: unknown): string {
  if (!Array.isArray(value) || types.isProxy(value) || !Object.isFrozen(value) || value.length !== 1) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== 2 || !Object.hasOwn(descriptors, "0") || descriptors["0"] === undefined ||
      !("value" in descriptors["0"]) || !descriptors["0"].enumerable) throw invalidRequest();
  const file = readExactDataRecord(descriptors["0"].value, ["type", "url"], ["type", "url"]);
  if (!Object.isFrozen(descriptors["0"].value) || file.type !== "image" || typeof file.url !== "string" ||
      !isSafeUploadReferenceUrl(file.url)) throw invalidRequest();
  return file.url;
}

function snapshotMagnificResultReadContext(value: unknown): Readonly<MagnificUpscaleResultReadContext> {
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_id"],
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_id"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      typeof fields.variant !== "string" || !MAGNIFIC_UPSCALE_VARIANTS.has(fields.variant as OwnerMagnificUpscaleVariant) ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id)) ||
      typeof fields.message_object_id !== "string" || !SAFE_RESPONSE_TOKEN.test(fields.message_object_id)) {
    throw invalidRequest();
  }
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);
  return Object.freeze({
    chat_uuid: fields.chat_uuid,
    message_id: fields.message_id,
    variant: fields.variant as OwnerMagnificUpscaleVariant,
    provider_chat_id: fields.provider_chat_id,
    message_object_id: fields.message_object_id
  });
}

function snapshotKontextImageResultReadContext(value: unknown): Readonly<KontextImageResultReadContext> {
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_id"],
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_id"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      typeof fields.variant !== "string" || !KONTEXT_IMAGE_VARIANTS.has(fields.variant as OwnerKontextImageVariant) ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id)) ||
      typeof fields.message_object_id !== "string" || !SAFE_RESPONSE_TOKEN.test(fields.message_object_id)) {
    throw invalidRequest();
  }
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);
  return Object.freeze({
    chat_uuid: fields.chat_uuid,
    message_id: fields.message_id,
    variant: fields.variant as OwnerKontextImageVariant,
    provider_chat_id: fields.provider_chat_id,
    message_object_id: fields.message_object_id
  });
}

function snapshotStandardImageResultReadContext(value: unknown): Readonly<StandardImageResultReadContext> {
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_ids"],
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_ids"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      typeof fields.variant !== "string" || !OWNER_STANDARD_IMAGE_VARIANTS.includes(fields.variant as OwnerStandardImageVariant) ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id))) throw invalidRequest();
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);
  const idsInput = fields.message_object_ids;
  if (!Array.isArray(idsInput) || types.isProxy(idsInput) || Object.getPrototypeOf(idsInput) !== Array.prototype || idsInput.length !== 1) {
    throw invalidRequest();
  }
  const descriptors = Object.getOwnPropertyDescriptors(idsInput);
  const keys = Reflect.ownKeys(descriptors);
  const idDescriptor = descriptors["0"];
  if (keys.length !== 2 || !keys.includes("length") || !idDescriptor || !("value" in idDescriptor) ||
      !idDescriptor.enumerable || typeof idDescriptor.value !== "string" || !SAFE_RESPONSE_TOKEN.test(idDescriptor.value)) {
    throw invalidRequest();
  }
  return Object.freeze({
    chat_uuid: fields.chat_uuid,
    message_id: fields.message_id,
    variant: fields.variant as OwnerStandardImageVariant,
    provider_chat_id: fields.provider_chat_id,
    message_object_ids: Object.freeze([idDescriptor.value]) as readonly [string]
  });
}

function snapshotWanImageResultReadContext(value: unknown): Readonly<WanImageResultReadContext> {
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_ids", "requested_batch_size"],
    ["chat_uuid", "message_id", "variant", "provider_chat_id", "message_object_ids", "requested_batch_size"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      typeof fields.variant !== "string" || !WAN_IMAGE_VARIANTS.has(fields.variant as OwnerWanImageVariant) ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id)) || !Number.isSafeInteger(fields.requested_batch_size) ||
      (fields.requested_batch_size as number) < 1 || (fields.requested_batch_size as number) > 4) {
    throw invalidRequest();
  }
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);

  const idsInput = fields.message_object_ids;
  if (!Array.isArray(idsInput) || types.isProxy(idsInput) || Object.getPrototypeOf(idsInput) !== Array.prototype ||
      idsInput.length !== fields.requested_batch_size) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(idsInput);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== idsInput.length + 1 || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= idsInput.length ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw invalidRequest();
  const ids: string[] = [];
  const unique = new Set<string>();
  for (let index = 0; index < idsInput.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable ||
        typeof descriptor.value !== "string" || !SAFE_RESPONSE_TOKEN.test(descriptor.value) || unique.has(descriptor.value)) {
      throw invalidRequest();
    }
    unique.add(descriptor.value);
    ids.push(descriptor.value);
  }
  return Object.freeze({
    chat_uuid: fields.chat_uuid,
    message_id: fields.message_id,
    variant: fields.variant as OwnerWanImageVariant,
    provider_chat_id: fields.provider_chat_id,
    message_object_ids: Object.freeze(ids),
    requested_batch_size: fields.requested_batch_size as number
  });
}

function snapshotOwnerWanT2vVideoResultReadContext(value: unknown): Readonly<OwnerWanT2vVideoResultReadContext> {
  if (types.isProxy(value)) throw invalidRequest();
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"],
    ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      (fields.model_id !== "wan_26_t2v" && fields.model_id !== "wan_27_t2v") ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id))) throw invalidRequest();
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);

  const idsInput = fields.message_object_ids;
  if (types.isProxy(idsInput) || !Array.isArray(idsInput) || Object.getPrototypeOf(idsInput) !== Array.prototype ||
      idsInput.length < 1 || idsInput.length > 64) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(idsInput);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== idsInput.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= idsInput.length ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) throw invalidRequest();
  const ids: string[] = [];
  const unique = new Set<string>();
  for (let index = 0; index < idsInput.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" ||
        !SAFE_RESPONSE_TOKEN.test(descriptor.value) || unique.has(descriptor.value)) throw invalidRequest();
    unique.add(descriptor.value);
    ids.push(descriptor.value);
  }
  return Object.freeze({ chat_uuid: fields.chat_uuid, message_id: fields.message_id,
    model_id: fields.model_id, provider_chat_id: fields.provider_chat_id, message_object_ids: Object.freeze(ids) });
}

function snapshotGrokT2iImageBatchResultReadContext(value: unknown): GrokT2iImageResultContext {
  const fields = readExactDataRecord(value,
    ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids", "requested_batch_size"],
    ["chat_uuid", "message_id", "model_id", "provider_chat_id", "message_object_ids", "requested_batch_size"]);
  if (typeof fields.chat_uuid !== "string" || typeof fields.message_id !== "string" ||
      typeof fields.model_id !== "string" || !GROK_T2I_IMAGE_MODEL_TYPES.has(fields.model_id as OwnerGrokT2iModel) ||
      typeof fields.provider_chat_id !== "string" || !/^\d{1,16}$/u.test(fields.provider_chat_id) ||
      !Number.isSafeInteger(Number(fields.provider_chat_id)) || !Number.isSafeInteger(fields.requested_batch_size) ||
      (fields.requested_batch_size as number) < 1 || (fields.requested_batch_size as number) > 5) throw invalidRequest();
  validatePathIdentifier(fields.chat_uuid);
  validatePathIdentifier(fields.message_id);

  const idsInput = fields.message_object_ids;
  if (!Array.isArray(idsInput) || types.isProxy(idsInput) || Object.getPrototypeOf(idsInput) !== Array.prototype ||
      idsInput.length !== fields.requested_batch_size) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(idsInput);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== idsInput.length + 1 || keys.some((key) => key !== "length" && (typeof key !== "string" ||
      !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= idsInput.length || !("value" in descriptors[key]!) ||
      descriptors[key]!.enumerable !== true))) throw invalidRequest();
  const ids: string[] = [];
  const unique = new Set<string>();
  for (let index = 0; index < idsInput.length; index += 1) {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || !descriptor.enumerable || typeof descriptor.value !== "string" ||
        !SAFE_RESPONSE_TOKEN.test(descriptor.value) || unique.has(descriptor.value)) throw invalidRequest();
    unique.add(descriptor.value);
    ids.push(descriptor.value);
  }
  return Object.freeze({ chat_uuid: fields.chat_uuid, message_id: fields.message_id,
    model_id: fields.model_id as OwnerGrokT2iModel, provider_chat_id: fields.provider_chat_id,
    message_object_ids: Object.freeze(ids), requested_batch_size: fields.requested_batch_size as number });
}

function redactMagnificUpscaleResult(
  raw: unknown,
  context: Readonly<MagnificUpscaleResultReadContext>
): InternalMagnificUpscaleResult {
  const unverified = (
    reason: MagnificUpscaleResultUnverifiedReason,
    modelFlags?: Readonly<{ model_eq_requested: false; model_eq_family: boolean }>
  ): InternalMagnificUpscaleResult => Object.freeze({
    ...context,
    status: "UNVERIFIED",
    reason,
    ...(modelFlags ?? {})
  });
  const pending = (reason: MagnificUpscaleResultPendingReason): InternalMagnificUpscaleResult => Object.freeze({
    ...context,
    status: "PENDING",
    reason
  });

  if (!isRecord(raw)) return unverified("RESPONSE_SHAPE_INVALID");
  if (optionalProviderId(raw.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  if (!Array.isArray(raw.message_object)) return unverified("RESPONSE_SHAPE_INVALID");
  if (raw.message_object.length === 0) return pending("NO_RESULT_OBJECTS");
  if (raw.message_object.length !== 1) return unverified("RESULT_OBJECT_CARDINALITY_INVALID");

  const object = raw.message_object[0];
  if (!isRecord(object)) return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (optionalProviderId(object.id) !== context.message_object_id) return unverified("OBJECT_ID_MISMATCH");
  if (optionalProviderId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
  if (optionalResponseToken(object.object_type) !== "image") return unverified("OBJECT_TYPE_MISMATCH");
  const actualModelType = optionalResponseToken(object.model_type);
  if (actualModelType === undefined) {
    return unverified("MODEL_TYPE_UNAVAILABLE", { model_eq_requested: false, model_eq_family: false });
  }
  if (actualModelType !== context.variant) {
    return unverified("MODEL_TYPE_MISMATCH", {
      model_eq_requested: false,
      model_eq_family: MAGNIFIC_UPSCALE_VARIANTS.has(actualModelType as OwnerMagnificUpscaleVariant)
    });
  }
  if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (!object.completed) return pending("RESULT_NOT_COMPLETED");
  if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) {
    return unverified("RESULT_URL_UNSAFE");
  }
  const mimeType = inferArtifactMimeType(object.object_url);
  if (mimeType === undefined || !mimeType.startsWith("image/")) return unverified("RESULT_MIME_UNKNOWN");

  return Object.freeze({
    ...context,
    status: "COMPLETE",
    model_type: context.variant,
    completed: true,
    artifact: Object.freeze({ url: object.object_url, mime_type: mimeType, mime_source: "URL_EXTENSION" as const })
  });
}

function redactKontextImageResult(
  raw: unknown,
  context: Readonly<KontextImageResultReadContext>
): InternalKontextImageResult {
  const unverified = (
    reason: KontextImageResultUnverifiedReason,
    modelFlags?: Readonly<{ model_eq_requested: false; model_eq_family: boolean }>
  ): InternalKontextImageResult => Object.freeze({ ...context, status: "UNVERIFIED", reason, ...(modelFlags ?? {}) });
  const pending = (reason: KontextImageResultPendingReason): InternalKontextImageResult =>
    Object.freeze({ ...context, status: "PENDING", reason });

  if (!isRecord(raw)) return unverified("RESPONSE_SHAPE_INVALID");
  if (optionalProviderId(raw.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  if (!Array.isArray(raw.message_object)) return unverified("RESPONSE_SHAPE_INVALID");
  if (raw.message_object.length === 0) return pending("NO_RESULT_OBJECTS");
  if (raw.message_object.length !== 1) return unverified("RESULT_OBJECT_CARDINALITY_INVALID");

  const object = raw.message_object[0];
  if (!isRecord(object)) return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (optionalProviderId(object.id) !== context.message_object_id) return unverified("OBJECT_ID_MISMATCH");
  if (optionalProviderId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
  if (optionalResponseToken(object.object_type) !== "image") return unverified("OBJECT_TYPE_MISMATCH");
  const actualModelType = optionalResponseToken(object.model_type);
  if (actualModelType === undefined) {
    return unverified("MODEL_TYPE_UNAVAILABLE", { model_eq_requested: false, model_eq_family: false });
  }
  if (actualModelType !== context.variant) {
    return unverified("MODEL_TYPE_MISMATCH", {
      model_eq_requested: false,
      model_eq_family: KONTEXT_IMAGE_VARIANTS.has(actualModelType as OwnerKontextImageVariant)
    });
  }
  if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (!object.completed) return pending("RESULT_NOT_COMPLETED");
  if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) {
    return unverified("RESULT_URL_UNSAFE");
  }
  const mimeType = inferArtifactMimeType(object.object_url);
  if (mimeType === undefined || !mimeType.startsWith("image/")) return unverified("RESULT_MIME_UNKNOWN");

  return Object.freeze({
    ...context,
    status: "COMPLETE",
    model_type: context.variant,
    completed: true,
    artifact: Object.freeze({ url: object.object_url, mime_type: mimeType, mime_source: "URL_EXTENSION" as const })
  });
}

function redactStandardImageResult(
  raw: unknown,
  context: Readonly<StandardImageResultReadContext>
): InternalStandardImageResult {
  const unverified = (reason: StandardImageResultUnverifiedReason): InternalStandardImageResult =>
    Object.freeze({ ...context, status: "UNVERIFIED", reason });
  const pending = (reason: StandardImageResultPendingReason): InternalStandardImageResult =>
    Object.freeze({ ...context, status: "PENDING", reason });
  if (!isRecord(raw)) return unverified("RESPONSE_SHAPE_INVALID");
  if (typeof raw.id !== "string" || raw.id !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  if (!Array.isArray(raw.message_object) || types.isProxy(raw.message_object) || raw.message_object.length > 64) {
    return unverified("RESPONSE_SHAPE_INVALID");
  }
  if (raw.message_object.length === 0) return pending("NO_RESULT_OBJECTS");
  if (raw.message_object.length !== 1) return unverified("RESULT_OBJECT_CARDINALITY_INVALID");
  const object = raw.message_object[0];
  if (!isRecord(object)) return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (typeof object.id !== "string" || object.id !== context.message_object_ids[0]) return unverified("OBJECT_ID_MISMATCH");
  if (typeof object.message_id !== "string" || object.message_id !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
  if (object.object_type !== "image") return unverified("OBJECT_TYPE_MISMATCH");
  if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
  if (object.model_type !== context.variant) return unverified("MODEL_TYPE_MISMATCH");
  if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
  if (!object.completed) return pending("RESULT_NOT_COMPLETED");
  if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
  const mimeType = inferWanArtifactMimeType(object.object_url);
  return Object.freeze({
    ...context,
    status: "COMPLETE",
    model_type: context.variant,
    completed: true,
    artifact: Object.freeze({
      message_object_id: context.message_object_ids[0], message_id: context.message_id,
      object_type: "image" as const, model_type: context.variant, completed: true as const,
      url: object.object_url, mime_type: mimeType, mime_source: mimeType === null ? "UNKNOWN" as const : "URL_EXTENSION" as const,
      width: null, height: null, geometry_verified: false as const
    })
  });
}

function redactWanImageResult(
  raw: unknown,
  context: Readonly<WanImageResultReadContext>
): InternalWanImageResult {
  const unverified = (reason: WanImageResultUnverifiedReason): InternalWanImageResult =>
    Object.freeze({ ...context, status: "UNVERIFIED", reason });
  const pending = (reason: WanImageResultPendingReason): InternalWanImageResult =>
    Object.freeze({ ...context, status: "PENDING", reason });

  if (!isRecord(raw)) return unverified("RESPONSE_SHAPE_INVALID");
  if (optionalProviderId(raw.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  if (!Array.isArray(raw.message_object) || types.isProxy(raw.message_object) || raw.message_object.length > 4) {
    return unverified("RESPONSE_SHAPE_INVALID");
  }
  if (raw.message_object.length === 0) return pending("NO_RESULT_OBJECTS");
  if (raw.message_object.length > context.requested_batch_size) return unverified("RESULT_OBJECT_CARDINALITY_INVALID");

  const objectIds = new Set<string>();
  const objectUrls = new Set<string>();
  const artifacts: InternalWanImageResultArtifact[] = [];
  for (let index = 0; index < raw.message_object.length; index += 1) {
    const object = raw.message_object[index];
    if (!isRecord(object)) return unverified("RESULT_OBJECT_SHAPE_INVALID");
    const objectId = optionalProviderId(object.id);
    if (objectId === undefined || objectId !== context.message_object_ids[index]) return unverified("OBJECT_ID_MISMATCH");
    if (objectIds.has(objectId)) return unverified("RESULT_OBJECT_DUPLICATE");
    objectIds.add(objectId);
    if (optionalProviderId(object.message_id) !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
    if (optionalResponseToken(object.object_type) !== "image") return unverified("OBJECT_TYPE_MISMATCH");
    const modelType = optionalResponseToken(object.model_type);
    if (modelType === undefined) return unverified("MODEL_TYPE_UNAVAILABLE");
    if (modelType !== context.variant) return unverified("MODEL_TYPE_MISMATCH");
    if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
    if (!object.completed) return pending("RESULT_NOT_COMPLETED");
    if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) {
      return unverified("RESULT_URL_UNSAFE");
    }
    if (objectUrls.has(object.object_url)) return unverified("RESULT_OBJECT_DUPLICATE");
    objectUrls.add(object.object_url);
    const mimeType = inferWanArtifactMimeType(object.object_url);
    artifacts.push(Object.freeze({
      message_object_id: objectId,
      message_id: context.message_id,
      object_type: "image",
      model_type: context.variant,
      completed: true,
      url: object.object_url,
      mime_type: mimeType,
      mime_source: mimeType === null ? "UNKNOWN" : "URL_EXTENSION"
    }));
  }
  if (artifacts.length !== context.requested_batch_size) return pending("RESULT_BATCH_PENDING");
  return Object.freeze({
    ...context,
    status: "COMPLETE",
    model_type: context.variant,
    completed: true,
    artifacts: Object.freeze(artifacts)
  });
}

function inferWanArtifactMimeType(url: string): string | null {
  let pathname: string;
  try { pathname = new URL(url).pathname; }
  catch { return null; }
  const match = /\.([A-Za-z0-9]{1,8})$/u.exec(pathname);
  switch (match?.[1]?.toLowerCase()) {
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "webp": return "image/webp";
    case "bmp": return "image/bmp";
    case "avif": return "image/avif";
    case "gif": return "image/gif";
    default: return null;
  }
}

function isClarityStepValue(value: unknown, minimum: number, maximum: number, step: number): boolean {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum - 1e-9 || value > maximum + 1e-9) return false;
  const offset = (value - minimum) / step;
  return Math.abs(offset - Math.round(offset)) < 1e-7;
}

function readExactDataRecord(value: unknown, allowed: readonly string[], required: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) throw invalidRequest();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      required.some((key) => !Object.hasOwn(descriptors, key))) throw invalidRequest();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function clarityUpscaleUnverified(
  chatUuid: string,
  messageId: string,
  reason: ClarityUpscaleResultUnverifiedReason
): InternalClarityUpscaleResult {
  return Object.freeze({ status: "UNVERIFIED", chat_uuid: chatUuid, message_id: messageId,
    model_type: "clarity", reason, objects: Object.freeze([]) as readonly [] });
}

function validateUploadFileRequest(request: UploadFileRequest): void {
  if (!(request.bytes instanceof Uint8Array) || request.bytes.byteLength < 1 || request.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw invalidRequest();
  }
  if (!SAFE_UPLOAD_FILENAME.test(request.filename) || /[\\/]/u.test(request.filename)) {
    throw invalidRequest();
  }
  if (!UPLOAD_MIME_TYPES.has(request.mime_type)) throw invalidRequest();
  if (request.destination !== "uploaded" && request.destination !== "hidden") throw invalidRequest();
  if (request.check_duplicates !== true) throw invalidRequest();
  validateModelIdentifier(request.model_type);
}

function validateMagnificUploadFileRequest(request: unknown): {
  readonly bytes: Uint8Array;
  readonly filename: string;
  readonly mime_type: OwnerMagnificUpscaleImageMimeType;
  readonly model_type: MagnificUpscaleImageUploadRequest["model_type"];
} {
  const record = readExactDataRecord(request, ["bytes", "filename", "mime_type", "model_type"],
    ["bytes", "filename", "mime_type", "model_type"]);
  const source = record.bytes;
  if (!(source instanceof Uint8Array) || types.isProxy(source) ||
      (!Buffer.isBuffer(source) && Object.getPrototypeOf(source) !== Uint8Array.prototype) ||
      source.byteLength < 1 || source.byteLength > MAX_MAGNIFIC_UPLOAD_BYTES ||
      typeof record.filename !== "string" || !SAFE_UPLOAD_FILENAME.test(record.filename) || /[\\/]/u.test(record.filename) ||
      typeof record.mime_type !== "string" || !MAGNIFIC_UPLOAD_MIME_TYPES.has(record.mime_type as OwnerMagnificUpscaleImageMimeType) ||
      typeof record.model_type !== "string" || !MAGNIFIC_UPLOAD_MODEL_TYPES.has(record.model_type)) {
    throw invalidRequest();
  }

  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  const mime = record.mime_type as OwnerMagnificUpscaleImageMimeType;
  try {
    const parsed = mime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytes(bytes, MAX_MAGNIFIC_UPLOAD_BYTES)
      : inspectBoundedOwnerImageBytes(bytes, MAX_MAGNIFIC_UPLOAD_BYTES);
    if (parsed.mime !== mime || !Number.isSafeInteger(parsed.width) || parsed.width < 1 ||
        !Number.isSafeInteger(parsed.height) || parsed.height < 1) throw invalidRequest();
    return Object.freeze({
      bytes,
      filename: record.filename,
      mime_type: mime,
      model_type: record.model_type as MagnificUpscaleImageUploadRequest["model_type"]
    });
  } catch {
    bytes.fill(0);
    throw invalidRequest();
  }
}

function validateClarityUploadFileRequest(request: unknown): ClarityUpscaleImageUploadRequest {
  const record = readExactDataRecord(request, ["bytes", "filename", "mime_type"], ["bytes", "filename", "mime_type"]);
  const bytes = record.bytes;
  if (!(bytes instanceof Uint8Array) || types.isProxy(bytes) ||
      (!Buffer.isBuffer(bytes) && Object.getPrototypeOf(bytes) !== Uint8Array.prototype) ||
      bytes.byteLength < 1 || bytes.byteLength > MAX_CLARITY_UPLOAD_BYTES ||
      typeof record.filename !== "string" || !SAFE_UPLOAD_FILENAME.test(record.filename) || /[\\/]/u.test(record.filename) ||
      typeof record.mime_type !== "string" || !CLARITY_UPLOAD_MIME_TYPES.has(record.mime_type as OwnerClarityImageMimeType)) {
    throw invalidRequest();
  }
  return Object.freeze({
    bytes,
    filename: record.filename,
    mime_type: record.mime_type as OwnerClarityImageMimeType
  });
}

function validateKontextUploadFileRequest(request: unknown): KontextImageUploadRequest & { readonly source_bytes: Uint8Array } {
  const record = readExactDataRecord(request, ["bytes", "filename", "mime_type", "model_type"], ["bytes", "filename", "mime_type", "model_type"]);
  const source = record.bytes;
  if (!(source instanceof Uint8Array) || types.isProxy(source) ||
      (!Buffer.isBuffer(source) && Object.getPrototypeOf(source) !== Uint8Array.prototype) ||
      source.byteLength < 1 || source.byteLength > MAX_KONTEXT_UPLOAD_BYTES ||
      typeof record.filename !== "string" || !isSafeKontextUploadFilename(record.filename) ||
      typeof record.mime_type !== "string" || !KONTEXT_UPLOAD_MIME_TYPES.has(record.mime_type as OwnerKontextCanonicalImageMimeType) ||
      typeof record.model_type !== "string" || !KONTEXT_UPLOAD_MODEL_TYPES.has(record.model_type)) {
    throw invalidRequest();
  }

  const bytes = new Uint8Array(source.byteLength);
  bytes.set(source);
  try {
    const mime = record.mime_type as OwnerKontextCanonicalImageMimeType;
    const image = mime === "image/avif"
      ? inspectBoundedOwnerClarityAvifBytes(bytes, MAX_KONTEXT_UPLOAD_BYTES)
      : inspectBoundedOwnerImageBytes(bytes, MAX_KONTEXT_UPLOAD_BYTES);
    if (image.mime !== mime || !Number.isSafeInteger(image.width) || image.width < 1 ||
        !Number.isSafeInteger(image.height) || image.height < 1) throw invalidRequest();
    return Object.freeze({
      bytes,
      source_bytes: source,
      filename: record.filename,
      mime_type: mime,
      model_type: record.model_type as KontextImageUploadRequest["model_type"]
    });
  } catch {
    bytes.fill(0);
    throw invalidRequest();
  }
}

function validateWanUploadFileRequest(request: unknown): WanImageUploadRequest & { readonly bytes: Uint8Array } {
  const record = readExactDataRecord(request, ["bytes", "filename", "mime_type", "model_type"],
    ["bytes", "filename", "mime_type", "model_type"]);
  const source = record.bytes;
  if (!(source instanceof Uint8Array) || types.isProxy(source) ||
      (!Buffer.isBuffer(source) && Object.getPrototypeOf(source) !== Uint8Array.prototype) ||
      source.byteLength < 1 || source.byteLength > MAX_WAN_UPLOAD_BYTES ||
      typeof record.model_type !== "string" || !WAN_IMAGE_VARIANTS.has(record.model_type as OwnerWanImageVariant) ||
      typeof record.mime_type !== "string" || !WAN_CANONICAL_IMAGE_MIME_TYPES.has(record.mime_type as OwnerWanCanonicalImageMimeType)) {
    throw invalidRequest();
  }

  const sourceCopy = new Uint8Array(source.byteLength);
  sourceCopy.set(source);
  let validatedBytes: Uint8Array | undefined;
  try {
    const validated = validateOwnerWanImageInput({
      variant: record.model_type,
      content_base64: Buffer.from(sourceCopy.buffer, sourceCopy.byteOffset, sourceCopy.byteLength).toString("base64"),
      filename: record.filename,
      mime_type: record.mime_type
    });
    validatedBytes = validated.bytes;
    if (validated.variant !== record.model_type || validated.mime_type !== record.mime_type) throw invalidRequest();
    return Object.freeze({
      bytes: validatedBytes,
      filename: validated.filename,
      mime_type: validated.mime_type,
      model_type: validated.variant
    });
  } catch {
    validatedBytes?.fill(0);
    throw invalidRequest();
  } finally {
    sourceCopy.fill(0);
  }
}

function isSafeKontextUploadFilename(value: string): boolean {
  if (value.length === 0 || value === "." || value === ".." || value !== value.trimEnd() ||
      /\p{Cc}/u.test(value) || KONTEXT_FILENAME_DELIMITERS.test(value) || KONTEXT_RESERVED_FILENAME.test(value) ||
      !isWellFormedKontextFilename(value)) return false;
  return Buffer.byteLength(value, "utf8") <= 255;
}

function isWellFormedKontextFilename(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) return false;
  }
  return true;
}

function parseClarityUploadReference(
  raw: unknown,
  expectedMimeType: OwnerClarityImageMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = clarityUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseMagnificUploadReference(
  raw: unknown,
  expectedMimeType: OwnerMagnificUpscaleImageMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = magnificUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" || receipt.mime_type !== expectedMimeType ||
      receipt.size !== expectedSize ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseKontextUploadReference(
  raw: unknown,
  expectedMimeType: OwnerKontextCanonicalImageMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = kontextUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" || receipt.mime_type !== expectedMimeType ||
      receipt.size !== expectedSize ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseWanUploadReference(
  raw: unknown,
  expectedMimeType: OwnerWanCanonicalImageMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = wanUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" || receipt.mime_type !== expectedMimeType ||
      receipt.size !== expectedSize ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseStandardImageUploadReference(
  raw: unknown,
  expectedMimeType: string,
  expectedSize: number
): InternalUploadReference {
  const parsed = standardImageUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

/** Internal composition read: the URL is available only for this genuine context and exact native client. */
export function readOwnerHailuo02I2vUploadReferenceForClient(
  clientInput: unknown,
  contextInput: unknown
): Readonly<{ readonly url: string }> | null {
  try {
    if (!clientInput || typeof clientInput !== "object" || types.isProxy(clientInput) ||
        Object.getPrototypeOf(clientInput) !== SyntxChatHttpClient.prototype ||
        Object.hasOwn(clientInput, "uploadHailuo02I2vImage") ||
        SyntxChatHttpClient.prototype.uploadHailuo02I2vImage !== NATIVE_HAILUO02_I2V_UPLOAD) return null;
    if (!contextInput || typeof contextInput !== "object" || types.isProxy(contextInput)) return null;
    const state = HAILUO02_I2V_UPLOAD_CONTEXTS.get(contextInput);
    if (!state || state.client !== clientInput) return null;
    const context = contextInput as OwnerHailuo02I2vImageUploadContext;
    if (context.status !== "uploaded" || context.model_id !== state.modelId || context.model_id !== "hailuo-02" ||
        context.mime_type !== state.mimeType || !isHailuo02I2vCanonicalMime(context.mime_type) ||
        context.size !== state.size || !Number.isSafeInteger(context.size) || context.size < 1 ||
        context.sha256 !== state.sha256 || !/^[a-f0-9]{64}$/u.test(context.sha256) ||
        context.width !== state.width || !Number.isSafeInteger(context.width) || context.width < 1 ||
        context.height !== state.height || !Number.isSafeInteger(context.height) || context.height < 1 ||
        !isSafeUploadReferenceUrl(state.url)) return null;
    return Object.freeze({ url: state.url });
  } catch { return null; }
}

const NATIVE_HAILUO02_I2V_UPLOAD = SyntxChatHttpClient.prototype.uploadHailuo02I2vImage;

function parseHailuo02I2vUploadReference(
  raw: unknown,
  expectedFilename: string,
  expectedMimeType: OwnerHailuo02I2vCanonicalMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = hailuo02I2vUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  const status = receipt?.status?.toLowerCase();
  if (!receipt || (status !== undefined && status !== "success") ||
      (receipt.filename !== undefined && receipt.filename !== expectedFilename) ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function isHailuo02I2vCanonicalMime(value: unknown): value is OwnerHailuo02I2vCanonicalMimeType {
  return value === "image/jpeg" || value === "image/png" || value === "image/webp";
}

interface Hailuo02I2vUploadContextState {
  readonly client: SyntxChatHttpClient;
  readonly url: string;
  readonly modelId: "hailuo-02";
  readonly mimeType: OwnerHailuo02I2vCanonicalMimeType;
  readonly size: number;
  readonly sha256: string;
  readonly width: number;
  readonly height: number;
}

function parseSeedreamEditorOriginalUploadReference(
  raw: unknown,
  expectedMimeType: string,
  expectedSize: number
): InternalUploadReference {
  const parsed = seedreamEditorOriginalUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseSeedreamEditorDrawingUploadReference(raw: unknown, expectedSize: number): InternalUploadReference {
  const parsed = seedreamEditorDrawingUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== "image/png") ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) throw protocolError();
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); } catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseBananaInpaintOriginalUploadReference(
  raw: unknown,
  expectedMimeType: OwnerBananaInpaintOriginalMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = bananaInpaintOriginalUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseBananaInpaintPaintedCompositeUploadReference(raw: unknown, expectedSize: number): InternalUploadReference {
  const parsed = bananaInpaintPaintedCompositeUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== "image/png") ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseBananaInpaintAuxiliaryUploadReference(
  raw: unknown,
  expectedMimeType: string,
  expectedSize: number
): InternalUploadReference {
  const parsed = bananaInpaintAuxiliaryUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseIdeogramImageUploadReference(
  raw: unknown,
  expectedMimeType: string,
  expectedSize: number
): InternalUploadReference {
  const parsed = ideogramImageUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseIdeogramMaskUploadReference(raw: unknown, expectedSize: number): InternalUploadReference {
  const parsed = ideogramImageUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== "image/png") ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function parseGrokImagineImageUploadReference(
  raw: unknown,
  expectedMimeType: OwnerGrokT2iImageCanonicalMimeType,
  expectedSize: number
): InternalUploadReference {
  const parsed = grokImagineImageUploadResponseSchema.safeParse(raw);
  if (!parsed.success) throw protocolError();
  const [receipt] = parsed.data.files;
  if (!receipt || receipt.status?.toLowerCase() === "error" ||
      (receipt.mime_type !== undefined && receipt.mime_type !== expectedMimeType) ||
      (receipt.size !== undefined && receipt.size !== expectedSize) ||
      (receipt.id !== undefined && receipt.file_id !== undefined && String(receipt.id) !== String(receipt.file_id))) {
    throw protocolError();
  }
  let references: InternalUploadReference[];
  try { references = parseInternalUploadReferences(raw); }
  catch { throw protocolError(); }
  if (references.length !== 1) throw protocolError();
  return Object.freeze(references[0]!);
}

function assertFixedUpstreamUrl(url: URL): void {
  const fixedPaths = [
    "/api/v1/chats",
    "/api/v1/llm/generate",
    "/api/v1/design/generate",
    "/api/v1/video/generate",
    "/api/v1/audio/generate",
    "/api/v1/chats/upload-files"
  ];
  const dynamicPath =
    /^\/api\/v1\/chats\/[A-Za-z0-9][A-Za-z0-9._~-]{0,159}(?:\/inprogress|\/messages|\/[A-Za-z0-9][A-Za-z0-9._~-]{0,159}|\/messages\/[A-Za-z0-9][A-Za-z0-9._~-]{0,159}\/cancel)?$/u;
  const isGeneration = url.pathname.endsWith("/generate");
  const isChatHistory = /\/chats\/[A-Za-z0-9][A-Za-z0-9._~-]{0,159}\/messages$/u.test(url.pathname);
  const isOwnerSunoAudioChatIndex = url.pathname === "/api/v1/chats" && url.search.length > 0;

  if (
    url.protocol !== "https:" ||
    url.origin !== V1_BASE_URL.origin ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    url.hash.length > 0 ||
    (!fixedPaths.includes(url.pathname) && !dynamicPath.test(url.pathname)) ||
    (isGeneration &&
      (url.searchParams.size !== 1 ||
        url.searchParams.getAll("ai_name").length !== 1)) ||
    (isChatHistory &&
      (url.searchParams.size !== 2 ||
        url.searchParams.getAll("page").length !== 1 ||
        !/^[1-7]$/u.test(url.searchParams.get("page") ?? "") ||
        url.searchParams.getAll("page_size").length !== 1 ||
        url.searchParams.get("page_size") !== "10")) ||
    (isOwnerSunoAudioChatIndex && (url.searchParams.size !== 3 ||
      url.searchParams.getAll("scope").length !== 1 || url.searchParams.get("scope") !== "audio" ||
      url.searchParams.getAll("page").length !== 1 || !/^(?:[1-9]|[1-9]\d|100)$/u.test(url.searchParams.get("page") ?? "") ||
      url.searchParams.getAll("page_size").length !== 1 ||
      url.searchParams.get("page_size") !== String(OWNER_SUNO_EXISTING_INDEX_PAGE_SIZE))) ||
    (!isGeneration && !isChatHistory && !isOwnerSunoAudioChatIndex && url.search.length > 0)
  ) {
    throw invalidRequest();
  }
}

function serializeBoundedBody(
  body: Record<string, JsonValue> | undefined
): string | undefined {
  if (body === undefined) return undefined;
  const serialized = JSON.stringify(body);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES) {
    throw invalidRequest();
  }
  return serialized;
}

async function readJsonResponse(
  response: Response,
  maxResponseBytes: number,
  mode: ResponseMode,
  signal: AbortSignal
): Promise<unknown> {
  const declaredLength = response.headers.get("content-length");
  if (declaredLength !== null) {
    const parsed = Number(declaredLength);
    if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > maxResponseBytes) {
      cancelResponseBody(response);
      throw protocolError();
    }
  }

  if (
    mode === "ACK" &&
    (response.status === 204 || declaredLength === "0")
  ) {
    cancelResponseBody(response);
    return null;
  }

  const mediaType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json" && !mediaType?.endsWith("+json")) {
    cancelResponseBody(response);
    throw protocolError();
  }

  const bytes = await readBoundedBody(response, maxResponseBytes, signal);
  if (bytes.byteLength === 0) {
    if (mode === "ACK") return null;
    throw protocolError();
  }
  try {
    return JSON.parse(
      new TextDecoder("utf-8", { fatal: true }).decode(bytes)
    ) as unknown;
  } catch {
    throw protocolError();
  }
}

async function readBoundedBody(
  response: Response,
  maxResponseBytes: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const cancelForAbort = () => {
    void reader.cancel().catch(() => undefined);
  };

  signal.addEventListener("abort", cancelForAbort, { once: true });
  if (signal.aborted) cancelForAbort();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const item = await reader.read();
      if (item.done) break;
      total += item.value.byteLength;
      if (total > maxResponseBytes) {
        void reader.cancel().catch(() => undefined);
        throw protocolError();
      }
      chunks.push(item.value);
    }
  } finally {
    signal.removeEventListener("abort", cancelForAbort);
    reader.releaseLock();
  }

  const joined = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return joined;
}

function cancelResponseBody(response: Response): void {
  try {
    void response.body?.cancel().catch(() => undefined);
  } catch {
    // Cleanup is best effort; the fixed protocol/status error must win.
  }
}

function sanitizeTextFiles(
  files: readonly SyntxTextFileReference[]
): JsonValue[] {
  if (!Array.isArray(files) || files.length > MAX_FILES) {
    throw invalidRequest();
  }
  if (files.length > 0) {
    // No trusted upload-id/reference contract has been live-verified yet.
    throw invalidRequest();
  }
  return files.map((file) => {
    if (!isPlainRecord(file)) throw invalidRequest();
    const descriptors = Object.getOwnPropertyDescriptors(file);
    const objectType = descriptors.object_type;
    const objectUrl = descriptors.object_url;
    if (
      !objectType ||
      !("value" in objectType) ||
      !objectUrl ||
      !("value" in objectUrl) ||
      (objectType.value !== "image" && objectType.value !== "file") ||
      typeof objectUrl.value !== "string"
    ) {
      throw invalidRequest();
    }
    return { object_type: objectType.value, object_url: objectUrl.value };
  });
}

function sanitizeSettings(
  settings: Readonly<Record<string, unknown>>
): { [key: string]: JsonValue } {
  if (!isPlainRecord(settings)) throw invalidRequest();
  const state = { nodes: 0 };
  const result = sanitizeJsonValue(settings, 0, state);
  if (!isRecord(result)) throw invalidRequest();
  const serialized = JSON.stringify(result);
  if (Buffer.byteLength(serialized, "utf8") > MAX_REQUEST_BYTES / 2) {
    throw invalidRequest();
  }
  return result;
}

function validateOneInternalImageReference(
  references: readonly InternalUploadReference[] | unknown
): readonly InternalUploadReference[] {
  if (!Array.isArray(references) || types.isProxy(references) || references.length !== 1) throw invalidRequest();
  const referenceDescriptors = Object.getOwnPropertyDescriptors(references);
  const referenceKeys = Reflect.ownKeys(referenceDescriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(references, "length");
  const itemDescriptor = referenceDescriptors["0"];
  if (referenceKeys.length !== 2 || !lengthDescriptor || lengthDescriptor.value !== 1 ||
      !itemDescriptor || !("value" in itemDescriptor) || !itemDescriptor.enumerable) throw invalidRequest();
  const value = itemDescriptor.value;
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value) || !isPlainRecord(value)) {
    throw invalidRequest();
  }
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some((key) => typeof key !== "string" || !["url", "file_id"].includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) ||
      typeof descriptors.url?.value !== "string" || !isSafeUploadReferenceUrl(descriptors.url.value) ||
      (descriptors.file_id !== undefined && (typeof descriptors.file_id.value !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(descriptors.file_id.value)))) {
    throw invalidRequest();
  }
  return Object.freeze([Object.freeze({
    ...(descriptors.file_id === undefined ? {} : { file_id: descriptors.file_id.value as string }),
    url: descriptors.url.value
  })]);
}

function validateIdeogramImageFileUrls(
  value: unknown,
  expectedReferenceCount: number,
  maskPresent: boolean
): readonly Readonly<{ type: "image" | "mask"; url: string }>[] {
  const expectedCount = expectedReferenceCount + (maskPresent ? 1 : 0);
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Number.isInteger(expectedReferenceCount) || expectedReferenceCount < (maskPresent ? 1 : 0) ||
      expectedReferenceCount > (maskPresent ? 4 : 5) || value.length !== expectedCount) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw invalidRequest();
  const seenUrlsByRole = new Map<"image" | "mask", Set<string>>();
  const files = Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw invalidRequest();
    const file = readExactDataRecord(descriptor.value, ["type", "url"], ["type", "url"]);
    const expectedRole = maskPresent && index === expectedReferenceCount ? "mask" : "image";
    if (file.type !== expectedRole || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url)) {
      throw invalidRequest();
    }
    const seenUrls = seenUrlsByRole.get(expectedRole) ?? new Set<string>();
    if (seenUrls.has(file.url)) throw invalidRequest();
    seenUrls.add(file.url);
    seenUrlsByRole.set(expectedRole, seenUrls);
    return Object.freeze({ type: expectedRole, url: file.url });
  });
  return Object.freeze(files);
}

function snapshotGrokT2iImageFileUrls(
  value: unknown,
  expectedReferenceCount: number
): readonly Readonly<{ type: "image"; url: string }>[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype ||
      !Object.isFrozen(value) || !Number.isSafeInteger(expectedReferenceCount) || expectedReferenceCount < 0 ||
      expectedReferenceCount > 5 || value.length !== expectedReferenceCount) throw invalidRequest();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || descriptors[key]!.enumerable !== true))) throw invalidRequest();
  const seen = new Set<string>();
  return Object.freeze(Array.from({ length: value.length }, (_, index) => {
    const descriptor = descriptors[String(index)];
    if (!descriptor || !("value" in descriptor) || descriptor.enumerable !== true) throw invalidRequest();
    const file = readExactDataRecord(descriptor.value, ["type", "url"], ["type", "url"]);
    if (file.type !== "image" || typeof file.url !== "string" || !isSafeUploadReferenceUrl(file.url) || seen.has(file.url)) {
      throw invalidRequest();
    }
    seen.add(file.url);
    return Object.freeze({ type: "image" as const, url: file.url });
  }));
}

function readGrokImageModelType(value: unknown): GrokImageModelType {
  if (typeof value !== "string" || !isGrokImageModelType(value)) throw invalidRequest();
  return value;
}

function isGrokImageModelType(value: unknown): value is GrokImageModelType {
  return typeof value === "string" && GROK_IMAGE_MODEL_TYPES.has(value as GrokImageModelType);
}

function validateGrokImageTransportSettings(
  settings: Readonly<Record<string, JsonValue>>,
  modelType: GrokImageModelType,
  referenceCount: number
): void {
  const modelReferenceLimit = modelType === "grok_i2i_pro" ? 1 : MAX_GROK_I2I_REFERENCE_COUNT;
  if (referenceCount < 1 || referenceCount > modelReferenceLimit ||
      (modelType === "grok_i2i_pro" && referenceCount !== 1) ||
      settings.resolution !== "1k" && settings.resolution !== "2k" ||
      typeof settings.batch_size !== "number" || !Number.isInteger(settings.batch_size) ||
      settings.batch_size < 1 || settings.batch_size > 5 || settings.n !== 1 ||
      Object.hasOwn(settings, "details_quality")) {
    throw invalidRequest();
  }

  const hasRatio = Object.hasOwn(settings, "aspect_ratio");
  if (modelType === "grok_i2i_pro" || referenceCount === 1) {
    if (hasRatio) throw invalidRequest();
    return;
  }
  if (typeof settings.aspect_ratio !== "string" || !GROK_IMAGE_REFERENCE_RATIOS.has(settings.aspect_ratio)) {
    throw invalidRequest();
  }
}

const MAX_GROK_I2I_REFERENCE_COUNT = 3;

function validateGrokInternalImageReferences(
  references: readonly InternalUploadReference[] | unknown,
  modelType: GrokImageModelType
): readonly InternalUploadReference[] {
  if (!Array.isArray(references) || types.isProxy(references) ||
      Object.getPrototypeOf(references) !== Array.prototype) throw invalidRequest();
  const count = references.length;
  const maximum = modelType === "grok_i2i_pro" ? 1 : MAX_GROK_I2I_REFERENCE_COUNT;
  if (count < 1 || count > maximum) throw invalidRequest();

  const descriptors = Object.getOwnPropertyDescriptors(references);
  const keys = Reflect.ownKeys(descriptors);
  const lengthDescriptor = Object.getOwnPropertyDescriptor(references, "length");
  if (!lengthDescriptor || lengthDescriptor.value !== count || keys.length !== count + 1) throw invalidRequest();

  const urls = new Set<string>();
  const fileIds = new Set<string>();
  const normalized = Array.from({ length: count }, (_, index) => {
    const item = descriptors[String(index)];
    if (!item || !("value" in item) || !item.enumerable) throw invalidRequest();
    const value = item.value;
    if (!isPlainRecord(value) || types.isProxy(value)) throw invalidRequest();
    const itemDescriptors = Object.getOwnPropertyDescriptors(value);
    const itemKeys = Reflect.ownKeys(itemDescriptors);
    if (itemKeys.some((key) => typeof key !== "string" || !["url", "file_id"].includes(key) ||
        !("value" in itemDescriptors[key]!) || !itemDescriptors[key]!.enumerable)) throw invalidRequest();
    const url = itemDescriptors.url?.value;
    const fileId = itemDescriptors.file_id?.value;
    if (typeof url !== "string" || !isSafeUploadReferenceUrl(url) || urls.has(url)) throw invalidRequest();
    if (fileId !== undefined && (typeof fileId !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/u.test(fileId) || fileIds.has(fileId))) throw invalidRequest();
    urls.add(url);
    if (typeof fileId === "string") fileIds.add(fileId);
    return Object.freeze({ ...(typeof fileId === "string" ? { file_id: fileId } : {}), url });
  });
  return Object.freeze(normalized);
}

function redactGrokImageBatchMessage(
  raw: Record<string, unknown>,
  chatUuid: string,
  messageId: string,
  modelType: GrokImageModelType
): InternalGrokImageBatchEnvelope {
  const unverified = (reason: GrokImageBatchUnverifiedReason): InternalGrokImageBatchEnvelope => Object.freeze({
    status: "UNVERIFIED", chat_uuid: chatUuid, message_id: messageId,
    model_type: modelType, reason, objects: Object.freeze([]) as readonly []
  });
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  if (!Array.isArray(raw.message_object) || raw.message_object.length === 0) return unverified("NO_IMAGE_OBJECTS");
  if (raw.message_object.length > 5) return unverified("RESULT_COUNT_OUT_OF_RANGE");

  const objectIds = new Set<string>();
  const objectUrls = new Set<string>();
  const normalized: InternalGrokImageBatchObject[] = [];
  for (const entry of raw.message_object) {
    if (!isRecord(entry) || entry.completed !== true) return unverified("RESULT_OBJECT_INCOMPLETE");
    const objectId = optionalProviderId(entry.id);
    const childMessageId = optionalProviderId(entry.message_id);
    const objectType = optionalResponseToken(entry.object_type);
    const childModelType = optionalResponseToken(entry.model_type);
    if (!objectId || childMessageId !== messageId || objectType !== "image" || childModelType !== modelType) {
      return unverified("RESULT_OBJECT_MISMATCH");
    }
    if (typeof entry.object_url !== "string" || !isSafeArtifactUrl(entry.object_url)) {
      return unverified("RESULT_URL_UNSAFE");
    }
    const mimeType = inferArtifactMimeType(entry.object_url);
    if (mimeType === undefined || !mimeType.startsWith("image/")) return unverified("RESULT_MIME_UNKNOWN");
    if (objectIds.has(objectId) || objectUrls.has(entry.object_url)) return unverified("RESULT_OBJECT_DUPLICATE");
    objectIds.add(objectId);
    objectUrls.add(entry.object_url);
    normalized.push(Object.freeze({
      message_object_id: objectId,
      message_id: childMessageId,
      object_type: "image",
      model_type: modelType,
      completed: true,
      object_url: entry.object_url,
      mime_type: mimeType,
      mime_source: "URL_EXTENSION"
    }));
  }
  return Object.freeze({
    status: "COMPLETE", chat_uuid: chatUuid, message_id: messageId,
    model_type: modelType, objects: Object.freeze(normalized)
  });
}

function redactGrokT2iImageBatchMessage(
  rawInput: unknown,
  context: GrokT2iImageResultContext
): InternalGrokT2iImageBatchResult {
  const provenance: GrokT2iImageResultProvenance = Object.freeze({
    namespace_confidence: "SOURCE_SHAPED_UNVERIFIED",
    backend_acceptance: "UNPROVEN"
  });
  const pending = (reason: GrokT2iImageBatchPendingReason): InternalGrokT2iImageBatchResult =>
    Object.freeze({ ...context, ...provenance, status: "PENDING", reason });
  const unverified = (reason: GrokT2iImageBatchUnverifiedReason): InternalGrokT2iImageBatchResult =>
    Object.freeze({ ...context, ...provenance, status: "UNVERIFIED", reason });

  const raw = readSafeProviderRecord(rawInput);
  if (!raw) return unverified("RESPONSE_SHAPE_INVALID");
  if (optionalProviderId(raw.id) !== context.message_id) return unverified("OUTER_MESSAGE_MISMATCH");
  if (typeof raw.chat_id !== "number" || !Number.isSafeInteger(raw.chat_id) || raw.chat_id < 0 ||
      String(raw.chat_id) !== context.provider_chat_id) return unverified("PROVIDER_CHAT_MISMATCH");
  if (raw.author_id !== BOT_AUTHOR_ID) return unverified("NOT_BOT_MESSAGE");
  const rawObjects = readSafeProviderArray(raw.message_object, 5);
  if (!rawObjects) return unverified("RESPONSE_SHAPE_INVALID");
  if (rawObjects.length === 0) return pending("NO_IMAGE_OBJECTS");
  if (rawObjects.length > context.requested_batch_size) return unverified("OUTPUT_COUNT_INVALID");

  const normalized: InternalGrokT2iImageBatchObject[] = [];
  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  for (let index = 0; index < rawObjects.length; index += 1) {
    const object = readSafeProviderRecord(rawObjects[index]);
    if (!object) return unverified("RESULT_OBJECT_SHAPE_INVALID");
    const objectId = optionalProviderId(object.id);
    const childMessageId = optionalProviderId(object.message_id);
    const objectType = optionalResponseToken(object.object_type);
    const modelType = optionalResponseToken(object.model_type);
    if (!objectId || objectId !== context.message_object_ids[index]) return unverified("OBJECT_ID_MISMATCH");
    if (childMessageId !== context.message_id) return unverified("OBJECT_MESSAGE_MISMATCH");
    if (objectType !== "image") return unverified("OBJECT_TYPE_MISMATCH");
    if (typeof object.model_type !== "string") return unverified("MODEL_TYPE_UNAVAILABLE");
    if (modelType !== context.model_id) return unverified("MODEL_TYPE_MISMATCH");
    if (typeof object.completed !== "boolean") return unverified("RESULT_OBJECT_SHAPE_INVALID");
    if (!object.completed) return pending("RESULT_OBJECTS_PENDING");
    if (typeof object.object_url !== "string" || !isSafeArtifactUrl(object.object_url)) return unverified("RESULT_URL_UNSAFE");
    const mimeType = inferArtifactMimeType(object.object_url);
    if (!mimeType?.startsWith("image/")) return unverified("RESULT_MIME_UNKNOWN");
    if (seenIds.has(objectId) || seenUrls.has(object.object_url)) return unverified("RESULT_OBJECT_DUPLICATE");
    seenIds.add(objectId);
    seenUrls.add(object.object_url);
    normalized.push(Object.freeze({ message_object_id: objectId, message_id: childMessageId, object_type: "image",
      model_id: context.model_id, completed: true, object_url: object.object_url, mime_type: mimeType,
      mime_source: "URL_EXTENSION", width: null, height: null, geometry_verified: false }));
  }
  if (rawObjects.length < context.requested_batch_size) return Object.freeze({
    ...context, ...provenance, status: "PARTIAL", actual_result_count: normalized.length,
    batch_count_matches_requested: false, objects: Object.freeze(normalized)
  });
  return Object.freeze({ ...context, ...provenance, status: "COMPLETE", actual_result_count: normalized.length,
    batch_count_matches_requested: true, objects: Object.freeze(normalized) });
}

function readSafeProviderRecord(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value) as unknown;
  if (prototype !== Object.prototype && prototype !== null) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const output: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !("value" in descriptors[key]!) || !descriptors[key]!.enumerable) return null;
    output[key] = descriptors[key]!.value;
  }
  return output;
}

function readSafeProviderArray(value: unknown, maximum: number): unknown[] | null {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== value.length + 1 || !keys.includes("length") || keys.some((key) => key !== "length" &&
      (typeof key !== "string" || !/^(?:0|[1-9]\d*)$/u.test(key) || Number(key) >= value.length ||
        !("value" in descriptors[key]!) || !descriptors[key]!.enumerable))) return null;
  return Array.from({ length: value.length }, (_, index) => descriptors[String(index)]?.value);
}

function sanitizeJsonValue(
  value: unknown,
  depth: number,
  state: { nodes: number }
): JsonValue {
  state.nodes += 1;
  if (depth > MAX_SETTINGS_DEPTH || state.nodes > MAX_SETTINGS_NODES) {
    throw invalidRequest();
  }
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value) || Math.abs(value) > 1_000_000_000_000) {
      throw invalidRequest();
    }
    return value;
  }
  if (typeof value === "string") {
    if (
      Buffer.byteLength(value, "utf8") > MAX_SYSTEM_VALUE_BYTES ||
      /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
    ) {
      throw invalidRequest();
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > MAX_ARRAY_ITEMS) throw invalidRequest();
    return value.map((item) => sanitizeJsonValue(item, depth + 1, state));
  }
  if (!isPlainRecord(value)) throw invalidRequest();

  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(value);
  if (
    keys.some((key) => typeof key !== "string") ||
    keys.length > MAX_OBJECT_KEYS
  ) {
    throw invalidRequest();
  }
  const result: { [key: string]: JsonValue } = {};
  for (const key of keys as string[]) {
    const descriptor = descriptors[key];
    if (
      !descriptor ||
      !descriptor.enumerable ||
      !("value" in descriptor) ||
      !SAFE_SETTING_KEY.test(key) ||
      FORBIDDEN_OBJECT_KEYS.has(key.toLowerCase())
    ) {
      throw invalidRequest();
    }
    result[key] = sanitizeJsonValue(descriptor.value, depth + 1, state);
  }
  return result;
}

function assertNoUnverifiedExternalReferences(value: JsonValue): void {
  if (typeof value === "string") {
    if (/^[A-Za-z][A-Za-z0-9+.-]*:/u.test(value)) throw invalidRequest();
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    for (const item of value) assertNoUnverifiedExternalReferences(item);
    return;
  }
  for (const [key, child] of Object.entries(value)) {
    const normalizedKey = key.toLowerCase();
    const isReferenceKey =
      normalizedKey === "url" ||
      normalizedKey === "uri" ||
      normalizedKey === "src" ||
      normalizedKey.endsWith("_url") ||
      normalizedKey.endsWith("_urls") ||
      normalizedKey.endsWith("_uri") ||
      normalizedKey.endsWith("_uris");
    if (
      isReferenceKey &&
      child !== null &&
      child !== "" &&
      (!Array.isArray(child) || child.length > 0)
    ) {
      throw invalidRequest();
    }
    assertNoUnverifiedExternalReferences(child);
  }
}

function isEmptyReferenceList(value: JsonValue | undefined): boolean {
  return value === undefined || (Array.isArray(value) && value.length === 0);
}

function isSafeStreamUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.hostname === "sse.syntx.ai" &&
      url.port === "" &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

// Image and video are now observed terminal bot object types. Audio remains
// deliberately excluded: a video result must still pass the same bot-author,
// completed, HTTPS and host checks before it is exposed. See the Seedance
// terminal observation recorded in docs/проект/текущий-handoff.md.
const ARTIFACT_OBJECT_TYPES = new Set(["image", "video"]);
const BOT_AUTHOR_ID = -1;
// The only host observed serving generated artifacts (image and video) so far
// is r2.syntx.ai. Keep this host allowlist independent from object type.
const SAFE_ARTIFACT_HOSTS = new Set(["r2.syntx.ai"]);

function redactMessage(
  raw: Record<string, unknown>,
  chatUuid: string,
  messageId: string
): RedactedMessageEnvelope {
  const result: RedactedMessageEnvelope = {
    chat_uuid: chatUuid,
    message_id: messageId,
    artifacts: []
  };
  const objects = Array.isArray(raw.message_object) ? raw.message_object : [];

  // The real response has no top-level object_type/model_type/status: those
  // live per-entry inside message_object[]. A single-object message surfaces
  // its own entry's fields for observability; an ambiguous multi-object one
  // does not guess which entry to surface. status is never populated: there
  // is no observed top-level terminal-status token, only a per-object
  // `completed` boolean (наблюдение-banana-generation-2026-09-06.md).
  if (objects.length === 1 && isRecord(objects[0])) {
    const only = objects[0];
    const messageObjectId = optionalProviderId(only.id);
    const objectType = optionalResponseToken(only.object_type);
    const modelType = optionalResponseToken(only.model_type);
    if (messageObjectId !== undefined) result.message_object_id = messageObjectId;
    if (objectType !== undefined) result.object_type = objectType;
    if (modelType !== undefined) result.model_type = modelType;
  }

  // Only the bot's own message ever carries generated output; the human's
  // echoed prompt message shares the exact same message_object[] shape and
  // must never be mistaken for a result — author_id === -1 is how the real
  // API marks a bot message (same doc).
  if (raw.author_id !== BOT_AUTHOR_ID) return result;

  for (const entry of objects) {
    if (!isRecord(entry) || entry.completed !== true) continue;
    const objectType = optionalResponseToken(entry.object_type);
    if (objectType === undefined || !ARTIFACT_OBJECT_TYPES.has(objectType)) continue;
    if (typeof entry.object_url !== "string" || !isSafeArtifactUrl(entry.object_url)) {
      continue;
    }
    const artifact: SafeArtifactMetadata = { url: entry.object_url };
    const mimeType = inferArtifactMimeType(entry.object_url);
    if (mimeType !== undefined) artifact.mime_type = mimeType;
    result.artifacts.push(artifact);
  }
  return result;
}

function isSafeArtifactUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_URL_LENGTH) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      SAFE_ARTIFACT_HOSTS.has(url.hostname) &&
      url.port.length === 0 &&
      url.username.length === 0 &&
      url.password.length === 0 &&
      url.hash.length === 0
    );
  } catch {
    return false;
  }
}

function inferArtifactMimeType(url: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,8})(?:[?#]|$)/.exec(url);
  const extension = match?.[1]?.toLowerCase();
  switch (extension) {
    case "png":
      return "image/png";
    case "jpg":
    case "jpeg":
      return "image/jpeg";
    case "webp":
      return "image/webp";
    case "gif":
      return "image/gif";
    case "mp4":
      return "video/mp4";
    case "mp3":
      return "audio/mpeg";
    case "wav":
      return "audio/wav";
    default:
      return undefined;
  }
}

function optionalProviderId(value: unknown): string | undefined {
  const parsed = providerIdSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

function optionalResponseToken(value: unknown): string | undefined {
  return typeof value === "string" && SAFE_RESPONSE_TOKEN.test(value)
    ? value
    : undefined;
}

function validateBoundedText(
  value: string,
  maxBytes: number,
  requireNonBlank: boolean
): void {
  if (
    typeof value !== "string" ||
    Buffer.byteLength(value, "utf8") > maxBytes ||
    (requireNonBlank && value.trim().length === 0) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value)
  ) {
    throw invalidRequest();
  }
}

function validateOptionalBoolean(value: unknown): void {
  if (value !== undefined && typeof value !== "boolean") {
    throw invalidRequest();
  }
}

function validatePathIdentifier(value: string): void {
  if (typeof value !== "string" || !SAFE_PATH_IDENTIFIER.test(value)) {
    throw invalidRequest();
  }
}

function validateModelIdentifier(value: string): void {
  if (typeof value !== "string" || !SAFE_MODEL_IDENTIFIER.test(value)) {
    throw invalidRequest();
  }
}

function validateCredential(value: string): void {
  if (
    typeof value !== "string" ||
    value.length < 16 ||
    value.length > 16_384 ||
    /[\s\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new SyntxHttpError(
      "AUTH_REQUIRED",
      "A linked SYNTX account is required for this request."
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  const prototype = Object.getPrototypeOf(value) as unknown;
  return prototype === Object.prototype || prototype === null;
}

function mapHttpFailure(status: number): SyntxHttpError {
  if (status === 401 || status === 403) {
    return new SyntxHttpError(
      "AUTH_OR_ACCESS_DENIED",
      "The linked SYNTX account did not authorize this request."
    );
  }
  if (status === 429) {
    return new SyntxHttpError(
      "UPSTREAM_RATE_LIMITED",
      "SYNTX temporarily rate-limited this request."
    );
  }
  if (status === 408 || status === 504) {
    return timeoutError();
  }
  return unavailableError();
}

function invalidRequest(): SyntxHttpError {
  return new SyntxHttpError(
    "INVALID_REQUEST",
    "The SYNTX request parameters are invalid."
  );
}

function protocolError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_PROTOCOL_ERROR",
    "SYNTX returned an unsupported response."
  );
}

function timeoutError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_TIMEOUT",
    "The SYNTX request did not complete within the allowed time."
  );
}

function requestAbortedError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_REQUEST_ABORTED",
    "The SYNTX request was canceled by the caller."
  );
}

function abortError(source: RequestAbortSource): SyntxHttpError {
  return source === "external" ? requestAbortedError() : timeoutError();
}

function unavailableError(): SyntxHttpError {
  return new SyntxHttpError(
    "UPSTREAM_UNAVAILABLE",
    "SYNTX is temporarily unavailable for this request."
  );
}
