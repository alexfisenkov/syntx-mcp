import { types } from "node:util";
import {
  ACCOUNT_CONTRACT_EVIDENCE,
  ACCOUNT_SOURCE_BUILD
} from "../adapter/syntx/account-decoder.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import { OWNER_VEO_OMNI_T2V_MODEL_ID } from "./owner-veo-omni-t2v-profile.js";

const MAX_DECIMAL_BYTES = 128;
const MAX_DECIMAL_EXPONENT = 100;
const PREFLIGHT_FRESHNESS_MS = 5 * 60_000;
const MODEL_ID = OWNER_VEO_OMNI_T2V_MODEL_ID;
const AI_NAME = "veo3";
const COST_PARAMETER_KEYS = Object.freeze(["upscale", "video_duration"] as const);
const VIDEO_REFERENCE_COST_PARAMETER_KEYS = Object.freeze(["mode", "upscale", "video_duration"] as const);
const ACCESS_KEYS = Object.freeze([
  "catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
  "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost",
  "free_remaining_generations", "limit", "show_warning", "observed_at"
] as const);
const ACCOUNT_KEYS = Object.freeze(["balance", "subscription", "contract_evidence", "source_build", "observed_at"] as const);
const BALANCE_KEYS = Object.freeze(["unit", "available"] as const);
const SUBSCRIPTION_KEYS = Object.freeze(["active", "plan_type", "end_date", "end_date_kind"] as const);

export type OwnerVeoOmniT2vModelAccessResolver = (
  attemptId: string,
  modelId: string,
  costParameters: Readonly<Record<string, SyntxCostParameter>>,
  signal?: AbortSignal
) => Promise<ModelAccessResult>;

export type OwnerVeoOmniT2vAccountStatusResolver = (
  attemptId: string,
  signal?: AbortSignal
) => Promise<AccountStatusResult>;

export interface OwnerVeoOmniT2vBudgetPreflightOptions {
  readonly catalog: DiscoveryCatalogRepository;
  readonly resolveAccountStatus: OwnerVeoOmniT2vAccountStatusResolver;
  readonly resolveModelAccess: OwnerVeoOmniT2vModelAccessResolver;
  readonly now?: () => number;
}

/** Adds a fail-closed quote-vs-balance check while preserving the existing resolver ABI. */
export function createOwnerVeoOmniT2vBudgetedModelAccessResolver(
  options: OwnerVeoOmniT2vBudgetPreflightOptions
): OwnerVeoOmniT2vModelAccessResolver {
  return createBudgetedModelAccessResolver(options, false);
}

/** Separate source-bound price branch; video_ref is not a generation setting. */
export function createOwnerVeoOmniVideoReferenceBudgetedModelAccessResolver(
  options: OwnerVeoOmniT2vBudgetPreflightOptions
): OwnerVeoOmniT2vModelAccessResolver {
  return createBudgetedModelAccessResolver(options, true);
}

function createBudgetedModelAccessResolver(
  options: OwnerVeoOmniT2vBudgetPreflightOptions,
  videoReference: boolean
): OwnerVeoOmniT2vModelAccessResolver {
  if (!options || typeof options !== "object" ||
      !(options.catalog instanceof DiscoveryCatalogRepository) ||
      typeof options.resolveAccountStatus !== "function" ||
      typeof options.resolveModelAccess !== "function" ||
      (options.now !== undefined && typeof options.now !== "function")) {
    throw new Error("OWNER_VEO_OMNI_T2V_BUDGET_PREFLIGHT_INVALID");
  }
  const now = options.now ?? Date.now;
  const expectedCatalogVersion = `${options.catalog.fetched_at}.${options.catalog.source_hashes.models.slice(7, 19)}`;

  return async (attemptId, modelId, costParameters, signal) => {
    signal?.throwIfAborted();
    if (modelId !== MODEL_ID || !exactCostParameters(costParameters, videoReference)) unavailable();

    let accessSnapshot: ModelAccessResult;
    try {
      const rawAccess = await Reflect.apply(options.resolveModelAccess, undefined, [attemptId, modelId, costParameters, signal]);
      accessSnapshot = snapshotModelAccess(rawAccess);
    } catch { unavailable(); }

    signal?.throwIfAborted();
    let accountSnapshot: AccountStatusResult;
    try {
      const rawAccount = await Reflect.apply(options.resolveAccountStatus, undefined, [attemptId, signal]);
      accountSnapshot = snapshotAccountStatus(rawAccount);
    } catch { unavailable(); }

    const currentTime = readNow(now);
    const selectedPrice = accessSnapshot.discount_cost ?? accessSnapshot.cost;
    if (!validModelAccess(accessSnapshot, expectedCatalogVersion, costParameters, selectedPrice, currentTime) ||
        !validAccountStatus(accountSnapshot, currentTime) ||
        !lessThanOrEqualDecimal(String(selectedPrice), accountSnapshot.balance.available!)) {
      unavailable();
    }
    signal?.throwIfAborted();
    return accessSnapshot;
  };
}

function snapshotModelAccess(value: unknown): ModelAccessResult {
  const row = snapshotRecord(value, ACCESS_KEYS);
  const parameterKeys = snapshotStringArray(row.parameter_keys);
  if (row.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || typeof row.catalog_version !== "string" ||
      typeof row.model_id !== "string" || typeof row.ai_name !== "string" || typeof row.model_type !== "string" ||
      row.account_read_live !== true || row.parameters_redacted !== true ||
      !(row.access === null || typeof row.access === "boolean") || !nullableFinite(row.cost) || !nullableFinite(row.discount_cost) ||
      !(row.free_remaining_generations === null || nonnegativeInteger(row.free_remaining_generations)) ||
      !(row.limit === null || nonnegativeFinite(row.limit)) || !(row.show_warning === null || typeof row.show_warning === "boolean") ||
      typeof row.observed_at !== "string") invalidSnapshot();
  return Object.freeze({
    catalog_kind: "OFFICIAL_PUBLIC_API_SNAPSHOT",
    catalog_version: row.catalog_version,
    model_id: row.model_id,
    ai_name: row.ai_name,
    model_type: row.model_type,
    account_read_live: true,
    parameter_keys: Object.freeze(parameterKeys) as unknown as string[],
    parameters_redacted: true,
    access: row.access,
    cost: row.cost,
    discount_cost: row.discount_cost,
    free_remaining_generations: row.free_remaining_generations,
    limit: row.limit,
    show_warning: row.show_warning,
    observed_at: row.observed_at
  });
}

function snapshotAccountStatus(value: unknown): AccountStatusResult {
  const row = snapshotRecord(value, ACCOUNT_KEYS);
  const balance = snapshotRecord(row.balance, BALANCE_KEYS);
  const subscription = snapshotRecord(row.subscription, SUBSCRIPTION_KEYS);
  if (balance.unit !== "tokens" || !(balance.available === null || typeof balance.available === "string") ||
      !(subscription.active === null || typeof subscription.active === "boolean") ||
      !(subscription.plan_type === null || typeof subscription.plan_type === "string") ||
      !(subscription.end_date === null || typeof subscription.end_date === "string") ||
      !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(String(subscription.end_date_kind))) ||
      row.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || row.source_build !== ACCOUNT_SOURCE_BUILD ||
      typeof row.observed_at !== "string") invalidSnapshot();
  return Object.freeze({
    balance: Object.freeze({ unit: "tokens", available: balance.available }),
    subscription: Object.freeze({
      active: subscription.active,
      plan_type: subscription.plan_type,
      end_date: subscription.end_date,
      end_date_kind: subscription.end_date_kind as AccountStatusResult["subscription"]["end_date_kind"]
    }),
    contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
    source_build: ACCOUNT_SOURCE_BUILD,
    observed_at: row.observed_at
  });
}

function snapshotRecord(value: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidSnapshot();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== expectedKeys.length ||
        keys.some((key) => typeof key !== "string" || !expectedKeys.includes(key) ||
          descriptors[key]?.enumerable !== true || !Object.hasOwn(descriptors[key]!, "value"))) invalidSnapshot();
    const snapshot: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) snapshot[key] = descriptors[key]!.value;
    return snapshot;
  } catch { invalidSnapshot(); }
}

function snapshotStringArray(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) invalidSnapshot();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value")) invalidSnapshot();
    const length = lengthDescriptor.value;
    if (!Number.isSafeInteger(length) || length < 0 || Reflect.ownKeys(descriptors).length !== length + 1) invalidSnapshot();
    const result: string[] = [];
    for (let index = 0; index < length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") invalidSnapshot();
      result.push(descriptor.value);
    }
    return result;
  } catch { invalidSnapshot(); }
}

function validModelAccess(
  access: ModelAccessResult,
  catalogVersion: string,
  costParameters: Readonly<Record<string, SyntxCostParameter>>,
  selectedPrice: number | null,
  now: number
): selectedPrice is number {
  return access.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" && access.catalog_version === catalogVersion &&
    access.model_id === MODEL_ID && access.ai_name === AI_NAME && access.model_type === MODEL_ID &&
    access.account_read_live === true && access.parameters_redacted === true && access.access === true &&
    sameStrings(access.parameter_keys, Object.keys(costParameters).sort()) &&
    typeof selectedPrice === "number" && Number.isFinite(selectedPrice) && selectedPrice >= 0 &&
    freshIso(access.observed_at, now);
}

function validAccountStatus(
  account: AccountStatusResult,
  now: number
): account is AccountStatusResult & { readonly balance: { readonly unit: "tokens"; readonly available: string } } {
  return account.contract_evidence === ACCOUNT_CONTRACT_EVIDENCE && account.source_build === ACCOUNT_SOURCE_BUILD &&
    account.balance.unit === "tokens" && finiteDecimal(account.balance.available) && freshIso(account.observed_at, now);
}

function exactCostParameters(value: unknown, videoReference: boolean): value is Readonly<Record<string, SyntxCostParameter>> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return false;
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const expected = videoReference ? VIDEO_REFERENCE_COST_PARAMETER_KEYS : COST_PARAMETER_KEYS;
    const mode = descriptors.mode;
    return (prototype === Object.prototype || prototype === null) && keys.every((key) => typeof key === "string") &&
      sameStrings((keys as string[]).sort(), expected) &&
      (!videoReference || (mode?.enumerable === true && Object.hasOwn(mode, "value") && mode.value === "video_ref")) &&
      COST_PARAMETER_KEYS.every((key) => {
        const descriptor = descriptors[key];
        return descriptor?.enumerable === true && Object.hasOwn(descriptor, "value") &&
          (typeof descriptor.value === "number" && Number.isFinite(descriptor.value));
      });
  } catch { return false; }
}

function finiteDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_DECIMAL_BYTES && /^(?:0|[1-9]\d*)(?:\.\d+)?$/u.test(value) && decimalParts(value) !== null;
}

function decimalParts(value: string): Readonly<{ digits: bigint; scale: number }> | null {
  if (value.length === 0 || value.length > MAX_DECIMAL_BYTES) return null;
  const match = /^(\d+)(?:\.(\d+))?(?:[eE]([+-]?\d+))?$/u.exec(value);
  if (!match) return null;
  const fraction = match[2] ?? "";
  const exponent = Number(match[3] ?? 0);
  if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;
  let digits: bigint;
  try { digits = BigInt(`${match[1]}${fraction}`); } catch { return null; }
  let scale = fraction.length - exponent;
  if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
  return Object.freeze({ digits, scale });
}

function lessThanOrEqualDecimal(left: string, right: string): boolean {
  const a = decimalParts(left), b = decimalParts(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}

function freshIso(value: string, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const observedAt = Date.parse(value);
  return Number.isFinite(observedAt) && new Date(observedAt).toISOString() === value && Math.abs(now - observedAt) <= PREFLIGHT_FRESHNESS_MS;
}

function nullableFinite(value: unknown): value is number | null {
  return value === null || nonnegativeFinite(value);
}

function nonnegativeFinite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function nonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function readNow(now: () => number): number {
  try {
    const value = Reflect.apply(now, undefined, []);
    if (!Number.isFinite(value)) unavailable();
    return value;
  } catch { unavailable(); }
}

function invalidSnapshot(): never {
  throw new Error("OWNER_VEO_OMNI_T2V_BUDGET_PREFLIGHT_INVALID");
}

function unavailable(): never {
  throw new Error("OWNER_VEO_OMNI_T2V_BUDGET_UNAVAILABLE");
}
