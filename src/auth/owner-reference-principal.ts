import type { AuthBinding, PublicAuthLinkAttempt } from "./types.js";
import type { PerUserLinkService } from "./link-service.js";
import type { GenerationPrincipalRef } from "../domain/generation-operation.js";
import { snapshotGenerationPrincipal } from "../domain/generation-principal.js";
import { isProxy } from "node:util/types";

export interface ResolveOwnerReferencePrincipalInput {
  readonly binding: AuthBinding;
  readonly attemptId: string;
  readonly linkService: Pick<PerUserLinkService, "getStatus">;
}

export async function resolveOwnerReferencePrincipal(
  input: ResolveOwnerReferencePrincipalInput
): Promise<Readonly<GenerationPrincipalRef>> {
  let principal: Readonly<GenerationPrincipalRef>;
  let binding: Readonly<AuthBinding>;
  let linkService: Pick<PerUserLinkService, "getStatus">;
  let getStatus: PerUserLinkService["getStatus"];
  try {
    const inputFields = readPlainDataRecord(input, ["binding", "attemptId", "linkService"]);
    const bindingFields = readPlainDataRecord(inputFields.binding, ["tenant_id", "subject"]);
    linkService = inputFields.linkService as Pick<PerUserLinkService, "getStatus">;
    if (!linkService || typeof linkService !== "object" || isProxy(linkService)) throw null;
    getStatus = getDataMethod(linkService, "getStatus") as PerUserLinkService["getStatus"];
    if (typeof getStatus !== "function" || typeof inputFields.attemptId !== "string" ||
        !/^link_[A-Za-z0-9_-]{20,120}$/u.test(inputFields.attemptId)) throw null;
    principal = snapshotGenerationPrincipal({
      tenant_id: bindingFields.tenant_id as string,
      subject_id: bindingFields.subject as string,
      connection_id: inputFields.attemptId as string
    });
    binding = Object.freeze({ tenant_id: principal.tenant_id, subject: principal.subject_id });
  } catch {
    throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_INVALID");
  }

  let attempt: PublicAuthLinkAttempt;
  try {
    attempt = await Reflect.apply(getStatus, linkService, [binding, principal.connection_id]);
  } catch {
    throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
  }
  try {
    if (!attempt || typeof attempt !== "object" || isProxy(attempt) || Array.isArray(attempt)) throw null;
    const prototype = Object.getPrototypeOf(attempt);
    if (prototype !== Object.prototype && prototype !== null) throw null;
    const descriptors = Object.getOwnPropertyDescriptors(attempt);
    const keys = Reflect.ownKeys(descriptors);
    if (keys.length !== 5 || ["attempt_id", "authorization_profile", "status", "expires_at", "linked"]
      .some((key) => !Object.hasOwn(descriptors, key)) ||
        keys.some((key) => typeof key !== "string" || !("value" in descriptors[key]!))) throw null;
    const attemptId = descriptors.attempt_id;
    const profile = descriptors.authorization_profile;
    const status = descriptors.status;
    const linked = descriptors.linked;
    if (!attemptId || !("value" in attemptId) || attemptId.value !== principal.connection_id ||
        !profile || !("value" in profile) || profile.value !== "OBSERVED_OWNER_AUTHORIZED" ||
        !status || !("value" in status) || status.value !== "LINKED" ||
        !linked || !("value" in linked) || linked.value !== true) throw null;
  } catch {
    throw new OwnerReferencePrincipalError("REFERENCE_PRINCIPAL_NOT_LINKED");
  }
  return principal;
}

export class OwnerReferencePrincipalError extends Error {
  constructor(readonly code: "REFERENCE_PRINCIPAL_NOT_LINKED" | "REFERENCE_PRINCIPAL_INVALID") {
    super("A linked owner principal is required for media references.");
    this.name = "OwnerReferencePrincipalError";
  }
}

function readPlainDataRecord(input: unknown, expectedKeys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || isProxy(input)) throw null;
  const prototype = Object.getPrototypeOf(input);
  if (prototype !== Object.prototype && prototype !== null) throw null;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.length !== expectedKeys.length || keys.some((key) =>
    typeof key !== "string" || !expectedKeys.includes(key) || !("value" in descriptors[key]!))) throw null;
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of keys as string[]) result[key] = descriptors[key]!.value;
  return result;
}

function getDataMethod(target: object, key: string): unknown {
  let current: object | null = target;
  while (current !== null) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return "value" in descriptor ? descriptor.value : undefined;
    current = Object.getPrototypeOf(current) as object | null;
  }
  return undefined;
}
