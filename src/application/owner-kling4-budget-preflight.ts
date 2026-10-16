import { types } from "node:util";
import {
  ACCOUNT_CONTRACT_EVIDENCE,
  ACCOUNT_SOURCE_BUILD
} from "../adapter/syntx/account-decoder.js";
import type { SyntxCostParameter } from "../adapter/syntx/http-client.js";
import { DiscoveryCatalogRepository } from "../catalog/discovery-catalog.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { OwnerKling4ModelId } from "./owner-kling4-image-policy.js";

const MAX_DECIMAL_BYTES = 128;
const MAX_DECIMAL_EXPONENT = 100;
const PREFLIGHT_FRESHNESS_MS = 5 * 60_000;
const MODEL_IDS = Object.freeze(["kling_4_keyframes", "kling_4_omni"] as const);
const AI_NAME = "kling";
const KEYFRAMES_COST_KEYS = Object.freeze(["mode", "version", "video_duration"] as const);
const OMNI_COST_KEYS = Object.freeze(["duration", "mode", "version", "video_duration"] as const);
const ACCESS_KEYS = Object.freeze([
  "catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
  "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost",
  "free_remaining_generations", "limit", "show_warning", "observed_at"
] as const);
const ACCOUNT_KEYS = Object.freeze(["balance", "subscription", "contract_evidence", "source_build", "observed_at"] as const);
const BALANCE_KEYS = Object.freeze(["unit", "available"] as const);
const SUBSCRIPTION_KEYS = Object.freeze(["active", "plan_type", "end_date", "end_date_kind"] as const);
const DURATION_STRING = /^(?:0|[1-9][0-9]*)\.[0-9]{2}$/u;

export type OwnerKling4ModelAccessResolver = (
  attemptId: string,
  modelId: string,
  costParameters: Readonly<Record<string, SyntxCostParameter>>,
  signal?: AbortSignal
) => Promise<ModelAccessResult>;

export type OwnerKling4AccountStatusResolver = (
  attemptId: string,
  signal?: AbortSignal
) => Promise<AccountStatusResult>;

export interface OwnerKling4BudgetPreflightOptions {
  readonly catalog: DiscoveryCatalogRepository;
  readonly resolveAccountStatus: OwnerKling4AccountStatusResolver;
  readonly resolveModelAccess: OwnerKling4ModelAccessResolver;
  readonly now?: () => number;
}

/** Adds a fail-closed current-quote-versus-balance preflight; it is not a spending cap. */
export function createOwnerKling4BudgetedModelAccessResolver(
  optionsInput: OwnerKling4BudgetPreflightOptions | unknown
): OwnerKling4ModelAccessResolver {
  const options = readOptions(optionsInput);
  const now = options.now ?? Date.now;
  const expectedCatalogVersion = `${options.catalog.fetched_at}.${options.catalog.source_hashes.models.slice(7, 19)}`;

  return async (attemptId, modelId, costParameters, signal) => {
    signal?.throwIfAborted();
    if (typeof attemptId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,159}$/u.test(attemptId) || !isModelId(modelId)) unavailable();
    const normalizedParameters = snapshotCostParameters(costParameters, modelId);
    if (!normalizedParameters) unavailable();

    let accessSnapshot: ModelAccessResult;
    try {
      const rawAccess = await Reflect.apply(options.resolveModelAccess, undefined,
        [attemptId, modelId, normalizedParameters, signal]);
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
    if (!validModelAccess(accessSnapshot, expectedCatalogVersion, modelId, normalizedParameters, selectedPrice, currentTime) ||
        !validAccountStatus(accountSnapshot, currentTime) ||
        !lessThanOrEqualDecimal(String(selectedPrice), accountSnapshot.balance.available!)) unavailable();
    signal?.throwIfAborted();
    return accessSnapshot;
  };
}

function readOptions(value: unknown): OwnerKling4BudgetPreflightOptions {
  const row = snapshotRecord(value, ["catalog", "resolveAccountStatus", "resolveModelAccess"], ["now"]);
  if (!(row.catalog instanceof DiscoveryCatalogRepository) || types.isProxy(row.catalog) ||
      typeof row.resolveAccountStatus !== "function" || types.isProxy(row.resolveAccountStatus) ||
      typeof row.resolveModelAccess !== "function" || types.isProxy(row.resolveModelAccess) ||
      (row.now !== undefined && (typeof row.now !== "function" || types.isProxy(row.now)))) invalidOptions();
  return Object.freeze({ catalog: row.catalog, resolveAccountStatus: row.resolveAccountStatus as OwnerKling4AccountStatusResolver,
    resolveModelAccess: row.resolveModelAccess as OwnerKling4ModelAccessResolver,
    ...(row.now === undefined ? {} : { now: row.now as () => number }) });
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
    balance: Object.freeze({ unit: "tokens", available: balance.available as string | null }),
    subscription: Object.freeze({ active: subscription.active as boolean | null, plan_type: subscription.plan_type as string | null,
      end_date: subscription.end_date as string | null,
      end_date_kind: subscription.end_date_kind as AccountStatusResult["subscription"]["end_date_kind"] }),
    contract_evidence: ACCOUNT_CONTRACT_EVIDENCE,
    source_build: ACCOUNT_SOURCE_BUILD,
    observed_at: row.observed_at as string
  });
}

function snapshotRecord(value: unknown, requiredKeys: readonly string[], optionalKeys: readonly string[] = []): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) invalidSnapshot();
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) ||
        requiredKeys.some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || (!requiredKeys.includes(key) && !optionalKeys.includes(key)) ||
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

function snapshotCostParameters(value: unknown, modelId: OwnerKling4ModelId): Readonly<Record<string, SyntxCostParameter>> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) return null;
  try {
    const prototype = Object.getPrototypeOf(value);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const keys = Reflect.ownKeys(descriptors);
    const expected = modelId === "kling_4_keyframes" ? KEYFRAMES_COST_KEYS : OMNI_COST_KEYS;
    if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string") ||
        !sameStrings((keys as string[]).sort(), [...expected].sort())) return null;
    const row = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) {
      const descriptor = descriptors[key];
      if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value")) return null;
      row[key] = descriptor.value;
    }
    if (row.version !== "4.0" || (row.mode !== "hd" && row.mode !== "standart") ||
        typeof row.video_duration !== "number" || !Number.isSafeInteger(row.video_duration) ||
        row.video_duration < 3 || row.video_duration > 30) return null;
    if (modelId === "kling_4_omni" && !validOmniSourceDuration(row.duration)) return null;
    return Object.freeze(row) as Readonly<Record<string, SyntxCostParameter>>;
  } catch { return null; }
}

function validOmniSourceDuration(value: unknown): boolean {
  if (typeof value === "number") return Number.isFinite(value) && value === 0;
  return typeof value === "string" && value.length <= MAX_DECIMAL_BYTES && DURATION_STRING.test(value) &&
    Number.isFinite(Number(value)) && Number(value) >= 0;
}

function validModelAccess(
  access: ModelAccessResult,
  catalogVersion: string,
  modelId: OwnerKling4ModelId,
  costParameters: Readonly<Record<string, SyntxCostParameter>>,
  selectedPrice: number | null,
  now: number
): selectedPrice is number {
  return access.catalog_kind === "OFFICIAL_PUBLIC_API_SNAPSHOT" && access.catalog_version === catalogVersion &&
    access.model_id === modelId && access.ai_name === AI_NAME && access.model_type === modelId &&
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

function finiteDecimal(value: unknown): value is string {
  return typeof value === "string" && value.length <= MAX_DECIMAL_BYTES &&
    /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(value) && decimalParts(value) !== null;
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

function isModelId(value: unknown): value is OwnerKling4ModelId {
  return typeof value === "string" && MODEL_IDS.includes(value as OwnerKling4ModelId);
}

function invalidOptions(): never { throw new Error("OWNER_KLING4_BUDGET_PREFLIGHT_INVALID"); }
function invalidSnapshot(): never { throw new Error("OWNER_KLING4_BUDGET_PREFLIGHT_INVALID"); }
function unavailable(): never { throw new Error("OWNER_KLING4_BUDGET_UNAVAILABLE"); }
