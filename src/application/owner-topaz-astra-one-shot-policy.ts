import type { OwnerTopazAstraPreparedCandidate } from "./owner-topaz-astra-request-preparer.js";

export interface OwnerTopazAstraOneShotDecision {
  readonly decision: "BLOCK";
  readonly reason: "TOPAZ_OWNED_UPLOAD_AND_PROMPT_BINDINGS_UNPROVEN";
  readonly dispatch_allowed: false;
  readonly replay_allowed: false;
}

/** A nominal candidate never authorizes a paid attempt; this policy remains closed until source/owner joins exist. */
export function evaluateOwnerTopazAstraOneShotPolicy(candidate: OwnerTopazAstraPreparedCandidate | unknown): Readonly<OwnerTopazAstraOneShotDecision> {
  if (!candidate || typeof candidate !== "object" || (candidate as OwnerTopazAstraPreparedCandidate).status !== "blocked" ||
      (candidate as OwnerTopazAstraPreparedCandidate).dispatch_allowed !== false) {
    throw new OwnerTopazAstraOneShotPolicyError("CANDIDATE_INVALID");
  }
  return Object.freeze({ decision: "BLOCK", reason: "TOPAZ_OWNED_UPLOAD_AND_PROMPT_BINDINGS_UNPROVEN",
    dispatch_allowed: false, replay_allowed: false });
}

export class OwnerTopazAstraOneShotPolicyError extends Error {
  constructor(readonly code: "CANDIDATE_INVALID") {
    super("Topaz Astra candidate is not eligible for one-shot dispatch.");
    this.name = "OwnerTopazAstraOneShotPolicyError";
  }
}
