import { types } from "node:util";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";

export interface OwnerSeedanceEditorBudgetObservation {
  readonly status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY";
  readonly selected_price: number;
  readonly cost_cap_enforced: false;
  readonly dispatch_allowed: false;
}

const COST_KEYS = ["duration", "mode", "resolution", "size", "video_duration"] as const;
const ACCESS_KEYS = ["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
  "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit",
  "show_warning", "observed_at"] as const;
const ACCOUNT_KEYS = ["balance", "subscription", "contract_evidence", "source_build", "observed_at"] as const;

export class OwnerSeedanceEditorBudgetError extends Error {
  readonly code = "OWNER_SEEDANCE_EDITOR_BUDGET_UNAVAILABLE";
  constructor() {
    super("The fresh Seedance Editor quote and token balance could not be verified.");
    this.name = "OwnerSeedanceEditorBudgetError";
  }
}

/**
 * Evaluates already obtained read-only observations, never credentials or dispatch permission.
 * The caller must obtain a fresh observation again at each native mutation boundary.
 * Subscription eligibility remains a separate decision: this is affordability only.
 */
export function evaluateOwnerSeedanceEditorBudget(input: unknown): Readonly<OwnerSeedanceEditorBudgetObservation> {
  try {
    const row = record(input, ["expected_catalog_version", "now", "cost_parameters", "access", "account"]);
    if (typeof row.expected_catalog_version !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[a-f0-9]{12}$/u.test(row.expected_catalog_version) ||
        !Number.isSafeInteger(row.now) || (row.now as number) < 0) fail();
    const now = row.now as number;
    const parameters = record(row.cost_parameters, COST_KEYS);
    if (parameters.video_duration !== 0 || parameters.mode !== "edit" || parameters.size !== "adaptive" ||
        !["480p", "720p", "1080p"].includes(parameters.resolution as string) ||
        typeof parameters.duration !== "string" || !/^(?:[4-9]|[12][0-9]|30)\.\d{2}$/u.test(parameters.duration) ||
        Number(parameters.duration) < 4 || Number(parameters.duration) > 30) fail();

    const access = record(row.access, ACCESS_KEYS);
    if (access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== row.expected_catalog_version ||
        access.model_id !== "seedance-2.5" || access.model_type !== "seedance-2.5" || access.ai_name !== "seedance" ||
        access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
        !sameKeys(access.parameter_keys) || !fresh(access.observed_at, now) ||
        !nullableFinite(access.cost) || !nullableFinite(access.discount_cost) ||
        !(access.free_remaining_generations === null ||
          (Number.isSafeInteger(access.free_remaining_generations) && (access.free_remaining_generations as number) >= 0)) ||
        !nullableFinite(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail();
    const price = access.discount_cost ?? access.cost;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) fail();

    const account = record(row.account, ACCOUNT_KEYS);
    const balance = record(account.balance, ["unit", "available"]);
    const subscription = record(account.subscription, ["active", "plan_type", "end_date", "end_date_kind"]);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD ||
        !fresh(account.observed_at, now) || balance.unit !== "tokens" || typeof balance.available !== "string" ||
        balance.available.length > 128 || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance.available) ||
        !(subscription.active === null || typeof subscription.active === "boolean") ||
        !(subscription.plan_type === null || typeof subscription.plan_type === "string") ||
        !(subscription.end_date === null || typeof subscription.end_date === "string") ||
        !(subscription.end_date_kind === null ||
          ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(subscription.end_date_kind as string))) fail();
    if (!decimalLte(String(price), balance.available)) fail();
    return Object.freeze({ status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", selected_price: price,
      cost_cap_enforced: false, dispatch_allowed: false });
  } catch { return fail(); }
}

function record(input: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || types.isProxy(input)) fail();
  const proto = Object.getPrototypeOf(input);
  if (proto !== Object.prototype && proto !== null) fail();
  const descriptors = Object.getOwnPropertyDescriptors(input), ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || keys.some(key => !Object.hasOwn(descriptors, key)) ||
      ownKeys.some(key => typeof key !== "string" || !keys.includes(key) ||
        !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail();
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys) result[key] = descriptors[key]!.value;
  return result;
}

function sameKeys(input: unknown): boolean {
  if (!Array.isArray(input) || types.isProxy(input) || Object.getPrototypeOf(input) !== Array.prototype) return false;
  const d = Object.getOwnPropertyDescriptors(input) as unknown as PropertyDescriptorMap;
  if (d.length?.value !== COST_KEYS.length || Reflect.ownKeys(d).length !== COST_KEYS.length + 1) return false;
  return COST_KEYS.every((key, index) => {
    const item = d[String(index)];
    return item?.enumerable === true && Object.hasOwn(item, "value") && item.value === key;
  });
}

function fresh(input: unknown, now: number): boolean {
  if (typeof input !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(input)) return false;
  const stamp = Date.parse(input);
  return Number.isFinite(stamp) && new Date(stamp).toISOString() === input && stamp <= now && now - stamp <= 300_000;
}

function nullableFinite(value: unknown): boolean {
  return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0);
}

/** Bounded decimal comparison avoids rounding a string token balance to binary Number. */
function decimalLte(left: string, right: string): boolean {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    if (value.length > 128) return null;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 100) return null;
    let digits = BigInt(match[1]! + fraction), scale = fraction.length - exponent;
    if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
    return { digits, scale };
  };
  const a = parse(left), b = parse(right);
  if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale);
  return a.digits * 10n ** BigInt(scale - a.scale) <= b.digits * 10n ** BigInt(scale - b.scale);
}

function fail(): never { throw new OwnerSeedanceEditorBudgetError(); }

