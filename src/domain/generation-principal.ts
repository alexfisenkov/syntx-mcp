import type { GenerationPrincipalRef } from "./generation-operation.js";
import { isProxy } from "node:util/types";
import { ApplicationError } from "../errors.js";

/** Internal server identity, never a tool input. Snapshot before any await. */
export function snapshotGenerationPrincipal(
  input: GenerationPrincipalRef
): Readonly<GenerationPrincipalRef> {
  try {
    if (!input || typeof input !== "object" || isProxy(input) || Array.isArray(input)) throw null;
    const fields = Object.getOwnPropertyDescriptors(input);
    if (Reflect.ownKeys(fields).length !== 3) throw null;
    const read = (key: keyof GenerationPrincipalRef, maximum: number): string => {
      const descriptor = fields[key];
      if (!descriptor || !("value" in descriptor)) throw null;
      const value: unknown = descriptor.value;
      if (typeof value !== "string" || value.length === 0 ||
          value.length > maximum || /[\u0000-\u001f\u007f]/u.test(value)) throw null;
      return value;
    };
    const tenant_id = read("tenant_id", 256);
    const subject_id = read("subject_id", 512);
    const connection_id = read("connection_id", 192);
    if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/u.test(connection_id)) throw null;
    return Object.freeze({ tenant_id, subject_id, connection_id });
  } catch {
    throw new ApplicationError("INVALID_PARAMETERS", "A valid server-resolved generation principal is required.");
  }
}

/** Tuple encoding avoids delimiter collisions in caches and approval scopes. */
export function generationPrincipalKey(principal: GenerationPrincipalRef): string {
  const value = snapshotGenerationPrincipal(principal);
  return JSON.stringify([value.tenant_id, value.subject_id, value.connection_id]);
}

export function sameGenerationPrincipal(
  left: GenerationPrincipalRef, right: GenerationPrincipalRef
): boolean {
  return left.tenant_id === right.tenant_id && left.subject_id === right.subject_id &&
    left.connection_id === right.connection_id;
}
