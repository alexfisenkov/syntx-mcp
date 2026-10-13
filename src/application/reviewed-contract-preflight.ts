import { types } from "node:util";
import type { GenerationContractExecutor } from "../adapter/syntx/generation-contract-executor.js";
import {
  GenerationContractExecutorV2,
  type GenerationContractV2Request,
  type PreparedSyntxMediaRequestV2
} from "../adapter/syntx/generation-contract-executor-v2.js";
import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import type { PreparedSyntxMediaRequest } from "../adapter/syntx/upstream-adapter.js";
import type { GenerationRequest } from "../domain/types.js";
import { OwnerGenerationPreflightError } from "./owner-generation-preflight.js";

export interface CreateReviewedContractPreflightOptions {
  readonly resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
}

export type CreateReviewedContractPreflightV1Options = CreateReviewedContractPreflightOptions & {
  readonly executor: GenerationContractExecutor;
};
export type CreateReviewedContractPreflightV2Options = CreateReviewedContractPreflightOptions & {
  readonly executor: GenerationContractExecutorV2;
};

export type ReviewedContractRequest = GenerationRequest | GenerationContractV2Request;
export type PreparedReviewedContractRequest = PreparedSyntxMediaRequest | PreparedSyntxMediaRequestV2;

/** Validate the exact reviewed contract/request, then the exact linked attempt's subscription. */
export function createReviewedContractPreflight(options: CreateReviewedContractPreflightV2Options): (
  attemptId: string, request: GenerationContractV2Request, signal?: AbortSignal
) => Promise<PreparedSyntxMediaRequestV2>;
export function createReviewedContractPreflight(options: CreateReviewedContractPreflightV1Options): (
  attemptId: string, request: GenerationRequest, signal?: AbortSignal
) => Promise<PreparedSyntxMediaRequest>;
export function createReviewedContractPreflight(options: CreateReviewedContractPreflightV1Options | CreateReviewedContractPreflightV2Options) {
  return async (attemptId: string, request: ReviewedContractRequest, signal?: AbortSignal): Promise<PreparedReviewedContractRequest> => {
    // This pure preparation binds model, operation, active status, schema and
    // source hashes to the selected catalog before any account or HTTP access.
    const prepared = options.executor instanceof GenerationContractExecutorV2
      ? options.executor.prepare(request as GenerationContractV2Request)
      : options.executor.prepare(request as GenerationRequest);

    let subscription: SyntxSubscription;
    try { subscription = await options.resolveSubscription(attemptId, signal); }
    catch (error) {
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") throw error;
      throw new OwnerGenerationPreflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    }

    const status = readSubscriptionStatus(subscription);
    if (!status) throw new OwnerGenerationPreflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    if (status.active === false || isFreePlan(status.plan_type)) {
      throw new OwnerGenerationPreflightError("SUBSCRIPTION_REQUIRED");
    }
    if (status.active !== true || typeof status.plan_type !== "string" || status.plan_type.trim().length === 0) {
      throw new OwnerGenerationPreflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    }
    return prepared;
  };
}

function readSubscriptionStatus(value: unknown): Pick<SyntxSubscription, "active" | "plan_type"> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const active = Object.getOwnPropertyDescriptor(value, "active");
  const planType = Object.getOwnPropertyDescriptor(value, "plan_type");
  if (!active || !("value" in active) || !active.enumerable || !planType || !("value" in planType) || !planType.enumerable) return null;
  if (!(active.value === true || active.value === false || active.value === null) ||
      !(planType.value === null || typeof planType.value === "string")) return null;
  return { active: active.value, plan_type: planType.value };
}

function isFreePlan(planType: string | null): boolean {
  return typeof planType === "string" && planType.trim().toLocaleUpperCase("en-US") === "FREE";
}
