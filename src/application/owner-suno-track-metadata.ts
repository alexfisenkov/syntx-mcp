import { types } from "node:util";

const IDENTIFIER_MAX_UTF16 = 256;
const NON_PRINTABLE = /[\p{Cc}\p{Cf}\p{Cs}\p{Zl}\p{Zp}]/u;

export interface OwnerSunoTrackMetadata {
  readonly clip_id: string;
  readonly task_id: string;
}

/**
 * Projects the two observed Suno track identifiers from a payload.
 *
 * This does not establish ownership or authorize a lookup. Callers must obtain
 * the payload from an already owner-bound bot audio result. Other payload keys
 * are deliberately ignored; their names and values are not copied or traversed.
 * The provider's identifier grammar is unconfirmed, so validation only applies
 * conservative local bounds and printable-string checks.
 */
export function readOwnerSunoTrackMetadata(payload: unknown): OwnerSunoTrackMetadata | null {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload) || types.isProxy(payload)) return null;

  let prototype: object | null;
  try {
    prototype = Object.getPrototypeOf(payload);
  } catch {
    return null;
  }
  if (prototype !== Object.prototype && prototype !== null) return null;

  let clipDescriptor: PropertyDescriptor | undefined;
  let taskDescriptor: PropertyDescriptor | undefined;
  try {
    clipDescriptor = Object.getOwnPropertyDescriptor(payload, "clip_id");
    taskDescriptor = Object.getOwnPropertyDescriptor(payload, "task_id");
  } catch {
    return null;
  }

  if (!isEnumerableDataDescriptor(clipDescriptor) || !isEnumerableDataDescriptor(taskDescriptor)) return null;
  if (!isBoundedPrintableIdentifier(clipDescriptor.value) || !isBoundedPrintableIdentifier(taskDescriptor.value)) return null;

  return Object.freeze({ clip_id: clipDescriptor.value, task_id: taskDescriptor.value });
}

function isEnumerableDataDescriptor(value: PropertyDescriptor | undefined): value is PropertyDescriptor & { value: unknown } {
  return value !== undefined && value.enumerable === true && Object.hasOwn(value, "value");
}

function isBoundedPrintableIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= IDENTIFIER_MAX_UTF16 &&
    value.trim() === value && !NON_PRINTABLE.test(value) && isWellFormedUnicode(value);
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}
