/**
 * Field names were observed in public frontend build 1789134564, not an
 * authenticated API response. Accepted wire types below are a conservative
 * local policy, not a published or live-verified upstream contract.
 */
export const ACCOUNT_SOURCE_BUILD = "1789134564" as const;
export const ACCOUNT_CONTRACT_EVIDENCE = "PUBLIC_FRONTEND_OBSERVED" as const;
export const ACCOUNT_DATE_KINDS = [
  "DATE_ONLY",
  "LOCAL_DATETIME",
  "OFFSET_DATETIME"
] as const;

export interface SyntxAccountBalance {
  available: string | null;
}

export interface SyntxSubscription {
  active: boolean | null;
  plan_type: string | null;
  end_date: string | null;
  end_date_kind: (typeof ACCOUNT_DATE_KINDS)[number] | null;
}

export class SyntxAccountDecodeError extends Error {
  constructor() {
    super("SYNTX returned an unsupported account response.");
    this.name = "SyntxAccountDecodeError";
  }
}

export function decodeAccountBalance(raw: unknown): SyntxAccountBalance {
  const record = requireRecord(raw);
  return { available: decodeDecimal(readField(record, "balance")) };
}

export function decodeSubscription(raw: unknown): SyntxSubscription {
  const record = requireRecord(raw);
  const active = readField(record, "active");
  if (active !== undefined && active !== null && typeof active !== "boolean") {
    throw new SyntxAccountDecodeError();
  }
  const type = readField(record, "type");
  if (
    type !== undefined && type !== null &&
    (typeof type !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(type))
  ) {
    throw new SyntxAccountDecodeError();
  }
  const date = decodeDate(readField(record, "end_date"));
  // last_subscription is historical and must never supply current expiry.
  return {
    active: active ?? null,
    plan_type: type as string | null | undefined ?? null,
    ...date
  };
}

function requireRecord(raw: unknown): Record<string, unknown> {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new SyntxAccountDecodeError();
  }
  const prototype = Object.getPrototypeOf(raw);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new SyntxAccountDecodeError();
  }
  return raw as Record<string, unknown>;
}

function readField(record: Record<string, unknown>, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!("value" in descriptor)) throw new SyntxAccountDecodeError();
  return descriptor.value as unknown;
}

function decodeDecimal(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "string") {
    // Never pass decimal strings through Number: their digits are retained.
    if (value.length > 128 || !/^[+-]?\d+(?:\.\d+)?$/u.test(value)) {
      throw new SyntxAccountDecodeError();
    }
    return value;
  }
  if (
    typeof value !== "number" || !Number.isFinite(value) ||
    Math.abs(value) > Number.MAX_SAFE_INTEGER
  ) {
    throw new SyntxAccountDecodeError();
  }
  const serialized = String(value);
  // JSON.parse has already produced a JS number. This policy cannot recover
  // digits rounded during JSON parsing; only string inputs retain wire digits.
  const significantDigits = serialized.split(/[eE]/u, 1)[0]!
    .replace(/^[+-]/u, "").replace(/^0\.?0*/u, "").replace(/\./gu, "").length;
  if (!Number.isInteger(value) && significantDigits > 15) {
    throw new SyntxAccountDecodeError();
  }
  const decimal = expandExponent(serialized);
  if (decimal.length > 128) throw new SyntxAccountDecodeError();
  return decimal;
}

function expandExponent(value: string): string {
  if (!/[eE]/u.test(value)) return value;
  const [mantissa, exponent] = value.toLowerCase().split("e") as [string, string];
  const negative = mantissa.startsWith("-");
  const unsigned = negative ? mantissa.slice(1) : mantissa;
  const point = unsigned.includes(".") ? unsigned.indexOf(".") : unsigned.length;
  const digits = unsigned.replace(".", "");
  const position = point + Number(exponent);
  const decimal = position <= 0
    ? `0.${"0".repeat(-position)}${digits}`
    : position >= digits.length
      ? `${digits}${"0".repeat(position - digits.length)}`
      : `${digits.slice(0, position)}.${digits.slice(position)}`;
  return negative ? `-${decimal}` : decimal;
}

function decodeDate(value: unknown): Pick<SyntxSubscription, "end_date" | "end_date_kind"> {
  if (value === undefined || value === null) {
    return { end_date: null, end_date_kind: null };
  }
  if (typeof value !== "string" || value.length > 40) throw new SyntxAccountDecodeError();
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?(Z|[+-]\d{2}:\d{2})?)?$/u.exec(value);
  if (!match) throw new SyntxAccountDecodeError();
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (year === 0 || month < 1 || month > 12 || day < 1 || day > days[month - 1]!) {
    throw new SyntxAccountDecodeError();
  }
  if (match[4] === undefined) return { end_date: value, end_date_kind: "DATE_ONLY" };
  if (Number(match[4]) > 23 || Number(match[5]) > 59 || Number(match[6]) > 59) {
    throw new SyntxAccountDecodeError();
  }
  const offset = match[8];
  if (offset !== undefined && offset !== "Z") {
    const hours = Number(offset.slice(1, 3));
    const minutes = Number(offset.slice(4, 6));
    if (offset === "-00:00" || hours > 14 || minutes > 59 || (hours === 14 && minutes !== 0)) {
      throw new SyntxAccountDecodeError();
    }
  }
  return {
    end_date: value,
    end_date_kind: offset === undefined ? "LOCAL_DATETIME" : "OFFSET_DATETIME"
  };
}
