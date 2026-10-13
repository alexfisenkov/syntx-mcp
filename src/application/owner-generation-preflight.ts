import type { SyntxSubscription } from "../adapter/syntx/account-decoder.js";
import { SyntxHttpError } from "../adapter/syntx/http-client.js";
import { types } from "node:util";
import {
  canonicalizeRuntimeCoverageModelId,
  getRuntimeCoverageProfile
} from "../catalog/runtime-coverage-registry.js";

export type OwnerGenerationPreflightErrorCode =
  | "MODEL_UNAVAILABLE"
  | "SUBSCRIPTION_REQUIRED"
  | "SUBSCRIPTION_STATUS_UNVERIFIED";

export class OwnerGenerationPreflightError extends Error {
  constructor(readonly code: OwnerGenerationPreflightErrorCode) {
    super("The owner generation request is unavailable under the current model or subscription status.");
    this.name = "OwnerGenerationPreflightError";
  }
}

export interface OwnerGenerationPreflightCatalogModel {
  readonly id: string;
  readonly active: boolean;
  readonly ai_name: string;
  readonly operations: readonly { readonly id: string; readonly output_modality: string }[];
}

export interface OwnerGenerationPreflightCatalogPort {
  getModel(modelId: string): OwnerGenerationPreflightCatalogModel;
}

export type OwnerGenerationPreflight = (
  attemptId: string,
  modelId: string,
  signal?: AbortSignal
) => Promise<void>;

export interface CreateOwnerGenerationPreflightOptions {
  /** The exact currently selected discovery snapshot; never a model-callable input. */
  catalog: OwnerGenerationPreflightCatalogPort;
  /** Must resolve the subscription for this exact linked attempt. */
  resolveSubscription: (attemptId: string, signal?: AbortSignal) => Promise<SyntxSubscription>;
}

/** Check local model eligibility before reading account status; does no generation or persistence. */
export function createOwnerGenerationPreflight(
  options: CreateOwnerGenerationPreflightOptions
): OwnerGenerationPreflight {
  return async (attemptId, modelId, signal) => {
    const canonicalModelId = canonicalizeRuntimeCoverageModelId(modelId);
    const profile = getRuntimeCoverageProfile(canonicalModelId);
    if (!profile) throw preflightError("MODEL_UNAVAILABLE");

    let model: OwnerGenerationPreflightCatalogModel;
    try { model = options.catalog.getModel(canonicalModelId); }
    catch { throw preflightError("MODEL_UNAVAILABLE"); }
    const operationId = profile.modality === "image" ? "generate-image" : "generate-video";
    const operation = model.operations.find((candidate) => candidate.id === operationId);
    if (!model.active || model.id !== canonicalModelId || model.ai_name !== profile.ai_name ||
        operation?.output_modality !== profile.modality) {
      throw preflightError("MODEL_UNAVAILABLE");
    }

    let subscription: SyntxSubscription;
    try { subscription = await options.resolveSubscription(attemptId, signal); }
    catch (error) {
      if (error instanceof SyntxHttpError && error.code === "AUTH_REQUIRED") throw error;
      throw preflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    }

    const status = readSubscriptionStatus(subscription);
    if (!status) throw preflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    if (status.active === false || isFreePlan(status.plan_type)) {
      throw preflightError("SUBSCRIPTION_REQUIRED");
    }
    if (status.active !== true || typeof status.plan_type !== "string" || status.plan_type.trim().length === 0) {
      throw preflightError("SUBSCRIPTION_STATUS_UNVERIFIED");
    }
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

function preflightError(code: OwnerGenerationPreflightErrorCode): OwnerGenerationPreflightError {
  return new OwnerGenerationPreflightError(code);
}
