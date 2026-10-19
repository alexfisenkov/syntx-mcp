import { types } from "node:util";
import { ACCOUNT_CONTRACT_EVIDENCE, ACCOUNT_SOURCE_BUILD } from "../adapter/syntx/account-decoder.js";
const COST_KEYS = Object.freeze(["video_duration"] as const);
const FRESH_MS = 15_000;
const MAX_DECIMAL_LENGTH = 128;
const MAX_DECIMAL_EXPONENT = 100;
const ACCESS_KEYS = Object.freeze(["catalog_kind", "catalog_version", "model_id", "ai_name", "model_type", "account_read_live",
  "parameter_keys", "parameters_redacted", "access", "cost", "discount_cost", "free_remaining_generations", "limit", "show_warning", "observed_at"] as const);
const ACCOUNT_KEYS = Object.freeze(["balance", "subscription", "contract_evidence", "source_build", "observed_at"] as const);

export interface OwnerActTwoBudgetResult {
  readonly status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY";
  readonly model_id: "acttwo";
  readonly selected_price: number;
  readonly cost_cap_enforced: false;
  readonly dispatch_allowed: false;
}
export class OwnerActTwoBudgetError extends Error {
  constructor(readonly code: "OWNER_ACTTWO_BUDGET_UNAVAILABLE") {
    super("A fresh ActTwo quote and token balance could not be verified.");
    this.name = "OwnerActTwoBudgetError";
  }
}

/** Checks freshness, access, paid subscription and affordability; this is not a provider spending cap. */
export function evaluateOwnerActTwoBudget(input: unknown): Readonly<OwnerActTwoBudgetResult> {
  try {
    const row = exact(input, ["expected_catalog_version", "now", "cost_parameters", "access", "account"]);
    if (typeof row.expected_catalog_version !== "string" ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\.[a-f0-9]{12}$/u.test(row.expected_catalog_version) ||
        !Number.isSafeInteger(row.now) || (row.now as number) < 0) fail();
    const now = row.now as number, cost = exact(row.cost_parameters, COST_KEYS);
    if (cost.video_duration !== 5) fail();
    const access = exact(row.access, ACCESS_KEYS), keys = stringArray(access.parameter_keys);
    if (access.catalog_kind !== "OFFICIAL_PUBLIC_API_SNAPSHOT" || access.catalog_version !== row.expected_catalog_version ||
        access.model_id !== "acttwo" || access.model_type !== "acttwo" || access.ai_name !== "runway" ||
        access.account_read_live !== true || access.parameters_redacted !== true || access.access !== true ||
        keys.length !== 1 || keys[0] !== "video_duration" || !fresh(access.observed_at, now) ||
        !nullablePrice(access.cost) || !nullablePrice(access.discount_cost) ||
        !(access.free_remaining_generations === null || safeNonnegativeInt(access.free_remaining_generations)) ||
        !nullablePrice(access.limit) || !(access.show_warning === null || typeof access.show_warning === "boolean")) fail();
    const price = access.discount_cost ?? access.cost;
    if (typeof price !== "number" || !Number.isFinite(price) || price < 0) fail();
    const account = exact(row.account, ACCOUNT_KEYS);
    if (account.contract_evidence !== ACCOUNT_CONTRACT_EVIDENCE || account.source_build !== ACCOUNT_SOURCE_BUILD || !fresh(account.observed_at, now)) fail();
    const balance = exact(account.balance, ["unit", "available"]), subscription = exact(account.subscription,
      ["active", "plan_type", "end_date", "end_date_kind"]);
    if (balance.unit !== "tokens" || typeof balance.available !== "string" || balance.available.length > MAX_DECIMAL_LENGTH ||
        !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u.test(balance.available) || subscription.active !== true ||
        typeof subscription.plan_type !== "string" || !subscription.plan_type || subscription.plan_type.toUpperCase() === "FREE" ||
        !(subscription.end_date === null || typeof subscription.end_date === "string") ||
        !(subscription.end_date_kind === null || ["DATE_ONLY", "LOCAL_DATETIME", "OFFSET_DATETIME"].includes(subscription.end_date_kind as string)) ||
        !decimalLte(String(price), balance.available)) fail();
    return Object.freeze({ status: "FRESH_AND_AFFORDABLE_QUOTE_ONLY", model_id: "acttwo", selected_price: price,
      cost_cap_enforced: false, dispatch_allowed: false });
  } catch { return fail(); }
}

function exact(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || types.isProxy(value)) fail();
  try {
    const prototype = Object.getPrototypeOf(value), descriptors = Object.getOwnPropertyDescriptors(value), own = Reflect.ownKeys(descriptors);
    if ((prototype !== Object.prototype && prototype !== null) || own.length !== keys.length ||
        keys.some(key => !Object.hasOwn(descriptors, key)) || own.some(key => typeof key !== "string" || !keys.includes(key) ||
          !Object.hasOwn(descriptors[key]!, "value") || descriptors[key]!.enumerable !== true)) fail();
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    for (const key of own as string[]) out[key] = descriptors[key]!.value;
    return out;
  } catch { return fail(); }
}
function stringArray(value: unknown): string[] {
  if (!Array.isArray(value) || types.isProxy(value) || Object.getPrototypeOf(value) !== Array.prototype) fail();
  try {
    const descriptors = Object.getOwnPropertyDescriptors(value), length = Object.getOwnPropertyDescriptor(value, "length");
    if (!length || !Object.hasOwn(length, "value") || length.value !== 1 || Reflect.ownKeys(descriptors).length !== 2) fail();
    const item = descriptors["0"];
    if (!item || !Object.hasOwn(item, "value") || item.enumerable !== true || typeof item.value !== "string") fail();
    return [item.value];
  } catch { return fail(); }
}
function fresh(value: unknown, now: number): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString() === value && timestamp <= now && now - timestamp <= FRESH_MS;
}
function nullablePrice(value: unknown): boolean { return value === null || (typeof value === "number" && Number.isFinite(value) && value >= 0); }
function safeNonnegativeInt(value: unknown): boolean { return Number.isSafeInteger(value) && (value as number) >= 0; }
function decimalLte(left: string, right: string): boolean {
  const parse = (value: string): { digits: bigint; scale: number } | null => {
    if (value.length > MAX_DECIMAL_LENGTH) return null;
    const match = /^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/iu.exec(value);
    if (!match) return null;
    const fraction = match[2] ?? "", exponent = Number(match[3] ?? 0);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > MAX_DECIMAL_EXPONENT) return null;
    let digits = BigInt(match[1]! + fraction), scale = fraction.length - exponent;
    if (scale < 0) { digits *= 10n ** BigInt(-scale); scale = 0; }
    return { digits, scale };
  };
  const a = parse(left), b = parse(right); if (!a || !b) return false;
  const scale = Math.max(a.scale, b.scale), leftScaled = a.digits * 10n ** BigInt(scale - a.scale), rightScaled = b.digits * 10n ** BigInt(scale - b.scale);
  return leftScaled <= rightScaled;
}
function fail(): never { throw new OwnerActTwoBudgetError("OWNER_ACTTWO_BUDGET_UNAVAILABLE"); }
