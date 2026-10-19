import { types } from "node:util";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
import type { AccountStatusResult } from "./account-status.js";
import type { ModelAccessResult } from "./model-access.js";
import type { OwnerRunwayI2vModelId } from "./owner-runway-i2v-parameters.js";

const MODEL_IDS = Object.freeze(["4genfirstframeimage", "turbo4genfirstframeimage", "gen4.5i2v"] as const);
const COST_KEYS = Object.freeze(["video_duration"] as const);
const ACCESS_KEYS = Object.freeze([
  "catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
  "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations",
  "limit", "show_warning", "observed_at"
] as const);
const ACCOUNT_KEYS = Object.freeze(["balance", "subscription", "contract_evidence", "source_build", "observed_at"] as const);
const BALANCE_KEYS = Object.freeze(["unit", "available"] as const);
const SUBSCRIPTION_KEYS = Object.freeze(["active", "plan_type", "end_date", "end_date_kind"] as const);
const OBSERVATION_FRESHNESS_MS = 5 * 60_000;
const MAX_DECIMAL_BYTES = 128;
const MAX_DECIMAL_EXPONENT = 100;

export interface OwnerRunwayI2vBudgetObservation {
  readonly status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY";
  readonly model_id: OwnerRunwayI2vModelId;
  readonly selected_price: number;
  readonly cost_cap_enforced: false;
  readonly dispatch_allowed: false;
}

export interface OwnerRunwayI2vBudgetInput {
  readonly expected_catalog_version: string;
  readonly now: number;
  readonly model_id: OwnerRunwayI2vModelId;
  readonly cost_parameters: Readonly<{ readonly video_duration: "5.0" | "8.0" | "10.0" }>;
  readonly access: ModelAccessResult;
  readonly account: AccountStatusResult;
}

export class OwnerRunwayI2vBudgetError extends Error {
  readonly code = "OWNER_RUNWAY_I2V_BUDGET_UNAVAILABLE" as const;
  constructor() {
    super("The fresh Runway quote and token balance could not be verified.");
    this.name = "OwnerRunwayI2vBudgetError";
  }
}

/** Evaluates already-obtained quote and account snapshots; it is affordability evidence, never a cost cap. */
export function evaluateOwnerRunwayI2vBudget(input: unknown): Readonly<OwnerRunwayI2vBudgetObservation> {
  try {
    const row = exactRecord(input, ["expected_catalog_version", "now", "model_id", "cost_parameters", "access", "account"]);
    if (typeof row.expected_catalog_version !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[a-f0-9]{12}$/u.test(row.expected_catalog_version) ||
        !Number.isSafeInteger(row.now) || (row.now as number) < 0 || !isModelId(row.model_id)) fail();
    const now = row.now as number;
    const cost = exactRecord(row.cost_parameters, COST_KEYS);
    if (!isAllowedDuration(row.model_id as OwnerRunwayI2vModelId, cost.video_duration)) fail();

    const access = exactRecord(row.access, ACCESS_KEYS);
    const parameterKeys = exactStringArray(access.parameter_keys);
    if (access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== row.expected_catalog_version ||
        access.model_id !== row.model_id || access.model_type !== row.model_id || access.ai_name !== "runway" ||
        access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
        !sameStrings(parameterKeys, COST_KEYS) || !fresh(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null || nonnegativeInteger(access.free_remaining_generations)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail();
    const price = access.discount_cost ?? access.cost;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) fail();

    const account = exactRecord(row.account, ACCOUNT_KEYS);
    const balance = exactRecord(account.balance, BALANCE_KEYS);
    const subscription = exactRecord(account.subscription, SUBSCRIPTION_KEYS);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        !fresh(account.observed_at, now) || balance.unit !== "tokens" || typeof balance.available !== "string" ||
        balance.available.length > MAX_DECIMAL_BYTES || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance.available) ||
        !(subscription.active === null || typeof subscription.active === "boolean") ||
        !(subscription.plan_type === null || typeof subscription.plan_type === "string") ||
        !(subscription.end_date === null || typeof subscription.end_date === "string") ||
        !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(subscription.end_date_kind as string)) ||
        !decimalLte(String(price), balance.available)) fail();

    return Object.freeze({ status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", model_id: row.model_id,
      selected_price: price, cost_cap_enforced: false, dispatch_allowed: false });
  } catch { return fail(); }
}

function exactRecord(input: unknown, required: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail();
  try {
    const prototype = Object.getPrototypeOf(input);
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || keys.length !== required.length ||
        required.some((key) => !Object.hasOwn(descriptors, key)) || keys.some((key) =>
          typeof key !== "string" || !required.includes(key) || !Object.hasOwn(descriptors[key]!, "value") ||
          descriptors[key]!.enumerable !== true)) fail();
    const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of keys as string[]) result[key] = descriptors[key]!.value;
    return result;
  } catch { return fail(); }
}

function exactStringArray(input: unknown): string[] {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) fail();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(input) as unknown as PropertyDescriptorMap;
    const lengthDescriptor = descriptors.length;
    if (!lengthDescriptor || !Object.hasOwn(lengthDescriptor, "value") || lengthDescriptor.value !== COST_KEYS.length ||
        Reflect.ownKeys(descriptors).length !== COST_KEYS.length + 1) fail();
    const result: string[] = [];
    for (let index = 0; index < COST_KEYS.length; index += 1) {
      const descriptor = descriptors[String(index)];
      if (!descriptor || descriptor.enumerable !== true || !Object.hasOwn(descriptor, "value") || typeof descriptor.value !== "string") fail();
      result.push(descriptor.value);
    }
    return result;
  } catch { return fail(); }
}

function isModelId(value: unknown): value is OwnerRunwayI2vModelId {
  return typeof value === "string" && (MODEL_IDS as readonly string[]).includes(value);
}

function isAllowedDuration(modelId: OwnerRunwayI2vModelId, value: unknown): value is "5.0" | "8.0" | "10.0" {
  return modelId === "gen4.5i2v" ? value === "5.0" || value === "8.0" || value === "10.0" : value === "5.0" || value === "10.0";
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function fresh(value: unknown, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const stamp = Date.parse(value);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === value && stamp <= now && now - stamp <= OBSERVATION_FRESHNESS_MS;
}

function nullableFinite(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function nonnegativeInteger(value: unknown): boolean {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

/** Bounded decimal comparison avoids converting the token balance to binary floating point. */
function decimalLte(left: string, right: string): boolean {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    if (value.length > MAX_DECIMAL_BYTES) return null;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? "";
    const exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;
    let digits = BigInt(match[1]! + fraction);
    let scale = fraction.length - exponent;
    if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
    return { digits, scale };
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}

function fail(): never { throw new OwnerRunwayI2vBudgetError(); }
