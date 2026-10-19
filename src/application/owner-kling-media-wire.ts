import { isSafeUploadReferenceUrl } from "../adapter/syntx/upload-reference-bridge.js";
import { schemaHash } from "../domain/generation-contract.js";
import { isOwnerKlingMediaModelId, normalizeOwnerKlingMediaParameters, type OwnerKlingMediaNormalizedParameters,
  type OwnerKlingMediaModelId } from "./owner-kling-media-parameters.js";

const SAFE_CHAT_ID = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u;
const SHA256 = /^[a-f0-9]{64}$/u;
export interface OwnerKlingMediaWireReference { readonly type: "image" | "video"; readonly url: string; readonly sha256: string }
export interface OwnerKlingMediaWireCandidate {
  readonly model_id: OwnerKlingMediaModelId; readonly ai_name: "kling"; readonly scope: "video";
  readonly profile_sha256: string; readonly intent_fingerprint: string; readonly reference_sha256: string;
  readonly body: Readonly<{ chat_id: string; prompt: string; settings: Readonly<Record<string, unknown>> }>;
}
export class OwnerKlingMediaWireError extends Error {
  constructor(readonly code: "INVALID_REQUEST" | "REFERENCE_UNAVAILABLE" | "MODEL_BINDING_MISMATCH") {
    super("The source-bound Kling media wire candidate is invalid."); this.name = "OwnerKlingMediaWireError";
  }
}

/** Builds the exact native candidate after the reference has been resolved from an owner-bound upload. */
export function buildOwnerKlingMediaWire(parameters: OwnerKlingMediaNormalizedParameters,
  input: Readonly<{ chat_uuid: string; reference: OwnerKlingMediaWireReference }>): Readonly<OwnerKlingMediaWireCandidate> {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length !== 2 ||
      !Object.hasOwn(input, "chat_uuid") || !Object.hasOwn(input, "reference") || typeof input.chat_uuid !== "string" || !SAFE_CHAT_ID.test(input.chat_uuid)) invalid("INVALID_REQUEST");
  const ref = input.reference;
  if (!ref || typeof ref !== "object" || Array.isArray(ref) || Object.keys(ref).length !== 3 || !Object.hasOwn(ref, "type") ||
      !Object.hasOwn(ref, "url") || !Object.hasOwn(ref, "sha256") || typeof ref.url !== "string" || !isSafeUploadReferenceUrl(ref.url) ||
      typeof ref.sha256 !== "string" || !SHA256.test(ref.sha256)) invalid("REFERENCE_UNAVAILABLE");
  if (!parameters || parameters.status !== "SOURCE_PARAMETERS_ONLY_NOT_DISPATCH_AUTHORITY" || parameters.dispatch_allowed !== false ||
      !isOwnerKlingMediaModelId(parameters.intent?.model_id)) invalid("INVALID_REQUEST");
  const normalized = normalizeOwnerKlingMediaParameters(parameters.intent), modelId = normalized.intent.model_id;
  if (parameters.source_profile_sha256 !== normalized.source_profile_sha256 || schemaHash(parameters.source_parameters) !== schemaHash(normalized.source_parameters)) invalid("MODEL_BINDING_MISMATCH");
  const expectedType = modelId === "kling_o1_video2video" ? "video" : "image";
  if (ref.type !== expectedType || normalized.source_parameters.model_type !== modelId) invalid("MODEL_BINDING_MISMATCH");
  const settings = Object.freeze({ ...normalized.source_parameters, file_urls: Object.freeze([Object.freeze({ type: expectedType, url: ref.url })]) });
  const body = Object.freeze({ chat_id: input.chat_uuid, prompt: normalized.intent.prompt, settings });
  const intent_fingerprint = schemaHash({ model_id: modelId, prompt: normalized.intent.prompt,
    settings: normalized.source_parameters, reference_sha256: ref.sha256 });
  return Object.freeze({ model_id: modelId, ai_name: "kling", scope: "video", profile_sha256: normalized.source_profile_sha256,
    intent_fingerprint, reference_sha256: ref.sha256, body });
}
function invalid(code: OwnerKlingMediaWireError["code"]): never { throw new OwnerKlingMediaWireError(code); }
