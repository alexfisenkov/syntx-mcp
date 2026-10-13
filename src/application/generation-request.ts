import { createHash } from "node:crypto";
import type { GenerationRequest } from "../domain/types.js";

export function normalizeParameters(
  parameters: Record<string, unknown>
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(parameters)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => [key, normalizeValue(value)])
  );
}

export function hashGenerationRequest(request: GenerationRequest): string {
  return `sha256:${createHash("sha256")
    .update(canonicalJson(request))
    .digest("hex")}`;
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => `${JSON.stringify(key)}:${canonicalJson(nested)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizeValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(normalizeValue);
  }
  if (value && typeof value === "object") {
    return normalizeParameters(value as Record<string, unknown>);
  }
  return value;
}
