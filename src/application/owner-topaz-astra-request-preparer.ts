import { getOwnerTopazAstraSourceProfile, type OwnerTopazAstraModelId } from "./owner-topaz-astra-source-profile.js";
import { normalizeOwnerTopazAstraParameters } from "./owner-topaz-astra-parameters.js";

export interface OwnerTopazAstraPreparedCandidate {
  readonly status: "blocked";
  readonly model_id: OwnerTopazAstraModelId;
  readonly source_build_id: "1791904852";
  readonly method: "POST";
  readonly path: "video/generate";
  readonly query: Readonly<{ ai_name: "topaz_astra" }>;
  readonly body_fields: readonly ["chat_id", "prompt", "settings"];
  readonly missing_evidence: readonly ["prompt_caller_binding", "genuine_topaz_owned_upload_binding", "trusted_duration_and_frame_probe"];
  readonly dispatch_allowed: false;
  readonly runtime_usable: false;
  readonly backend_acceptance: "UNPROVEN";
}

/** Source-grounded preparation boundary. It records known transport shape but deliberately emits no request body. */
export function prepareOwnerTopazAstraRequest(input: unknown): Readonly<OwnerTopazAstraPreparedCandidate> {
  const parameters = normalizeOwnerTopazAstraParameters(input);
  const profile = getOwnerTopazAstraSourceProfile(parameters.model_id);
  if (!profile) invalid();
  return Object.freeze({
    status: "blocked",
    model_id: parameters.model_id,
    source_build_id: profile.source_pins.source_build_id,
    method: profile.wire.method,
    path: profile.wire.path,
    query: profile.wire.query,
    body_fields: profile.wire.body_fields,
    missing_evidence: Object.freeze(["prompt_caller_binding", "genuine_topaz_owned_upload_binding", "trusted_duration_and_frame_probe"] as const),
    dispatch_allowed: false,
    runtime_usable: false,
    backend_acceptance: "UNPROVEN"
  });
}
function invalid(): never { throw new OwnerTopazAstraRequestPreparerError("INVALID_REQUEST"); }

export class OwnerTopazAstraRequestPreparerError extends Error {
  constructor(readonly code: "INVALID_REQUEST") {
    super("Topaz Astra request could not be prepared safely.");
    this.name = "OwnerTopazAstraRequestPreparerError";
  }
}
