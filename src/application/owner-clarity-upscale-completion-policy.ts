export const OWNER_CLARITY_COMPLETION_LIMITS = Object.freeze({
  initialDelayMs: 2_000,
  multiplier: 1.2,
  maximumDelayMs: 40_000,
  maximumEmptyQueueRounds: 24,
  maximumRounds: 32,
  operationTimeoutMs: 180_000
} as const);

const PENDING_REASONS = new Set(["NO_IMAGE_OBJECTS", "RESULT_OBJECT_INCOMPLETE"]);

export interface OwnerClarityUpscaleCompletionPolicyState {
  readonly startedAtMs: number;
  readonly lastObservedAtMs: number;
  readonly rounds: number;
  readonly emptyQueueRounds: number;
  readonly previousDelayMs: number;
  readonly initialDelayMs: number;
  readonly maxRounds: number;
}

export interface OwnerClarityUpscaleCompletionPolicyOptions {
  readonly startedAtMs: number;
  readonly initialDelayMs?: number;
  readonly maxRounds?: number;
}

export interface OwnerClarityUpscaleCompletionObservation {
  readonly state: OwnerClarityUpscaleCompletionPolicyState;
  readonly nowMs: number;
  readonly aborted: boolean;
  readonly echoAckKnown: boolean;
  readonly exactBotMessageBound: boolean;
  readonly historyBinding: "NONE" | "PENDING" | "VALID" | "INVALID";
  readonly queueState: "EMPTY" | "MATCHED" | "UNKNOWN" | "PENDING";
  readonly resultState: "NOT_READ" | "PENDING" | "COMPLETE" | "INVALID";
  readonly unverifiedReason: string | null;
}

export type OwnerClarityUpscaleCompletionDecision =
  | Readonly<{ decision: "WAIT"; nextDelayMs: number; nextRead: "HISTORY_AND_IN_PROGRESS" | "EXACT_RESULT"; state: OwnerClarityUpscaleCompletionPolicyState }>
  | Readonly<{ decision: "COMPLETE" }>
  | Readonly<{ decision: "UNKNOWN"; reason:
      "ABORTED" | "CLOCK_INVALID" | "DEADLINE_EXCEEDED" | "NO_ACK" | "INVALID_BINDING" |
      "UNBOUND_MESSAGE" | "QUEUE_UNVERIFIED" | "RESULT_INVALID" |
      "EMPTY_QUEUE_LIMIT" | "ROUND_LIMIT" }>;

export function createOwnerClarityUpscaleCompletionPolicy(
  options: OwnerClarityUpscaleCompletionPolicyOptions
): OwnerClarityUpscaleCompletionPolicyState {
  const fields = exactRecord(options, ["startedAtMs", "initialDelayMs", "maxRounds"]);
  const startedAtMs = fields.startedAtMs;
  const initialDelayMs = fields.initialDelayMs ?? OWNER_CLARITY_COMPLETION_LIMITS.initialDelayMs;
  const maxRounds = fields.maxRounds ?? OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds;
  if (!safeTime(startedAtMs) || !Number.isSafeInteger(initialDelayMs) || initialDelayMs < 0 || initialDelayMs > 2_000 ||
      !Number.isSafeInteger(maxRounds) || maxRounds < 1 || maxRounds > OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds) {
    throw new TypeError("Invalid Clarity completion policy options.");
  }
  return Object.freeze({
    startedAtMs, lastObservedAtMs: startedAtMs, rounds: 0, emptyQueueRounds: 0,
    previousDelayMs: initialDelayMs, initialDelayMs, maxRounds
  });
}

export function decideOwnerClarityUpscaleCompletion(
  observation: OwnerClarityUpscaleCompletionObservation
): OwnerClarityUpscaleCompletionDecision {
  const fields = exactRecord(observation, ["state", "nowMs", "aborted", "echoAckKnown", "exactBotMessageBound",
    "historyBinding", "queueState", "resultState", "unverifiedReason"]);
  const state = snapshotState(fields.state);
  const nowMs = fields.nowMs;
  if (typeof fields.aborted !== "boolean") return unknown("CLOCK_INVALID");
  if (fields.aborted) return unknown("ABORTED");
  if (!safeTime(nowMs) || nowMs < state.lastObservedAtMs || nowMs < state.startedAtMs ||
      typeof fields.echoAckKnown !== "boolean" ||
      typeof fields.exactBotMessageBound !== "boolean" ||
      !["NONE", "PENDING", "VALID", "INVALID"].includes(String(fields.historyBinding)) ||
      !["EMPTY", "MATCHED", "UNKNOWN", "PENDING"].includes(String(fields.queueState)) ||
      !["NOT_READ", "PENDING", "COMPLETE", "INVALID"].includes(String(fields.resultState)) ||
      !(fields.unverifiedReason === null || typeof fields.unverifiedReason === "string")) {
    return unknown("CLOCK_INVALID");
  }
  const elapsed = nowMs - state.startedAtMs;
  if (elapsed >= OWNER_CLARITY_COMPLETION_LIMITS.operationTimeoutMs) return unknown("DEADLINE_EXCEEDED");
  if (!fields.echoAckKnown) return unknown("NO_ACK");
  if (fields.historyBinding === "INVALID") return unknown("INVALID_BINDING");
  if (fields.resultState === "INVALID") return unknown("RESULT_INVALID");
  if (fields.unverifiedReason !== null && !PENDING_REASONS.has(fields.unverifiedReason)) return unknown("RESULT_INVALID");
  if (fields.resultState === "COMPLETE" && fields.unverifiedReason !== null) return unknown("RESULT_INVALID");

  if (fields.resultState === "COMPLETE") {
    return fields.exactBotMessageBound && fields.historyBinding === "VALID" ? Object.freeze({ decision: "COMPLETE" }) :
      unknown("INVALID_BINDING");
  }
  const waitingForBot = !fields.exactBotMessageBound && fields.historyBinding === "NONE" &&
    fields.resultState === "NOT_READ" && fields.queueState !== "MATCHED";
  if (!fields.exactBotMessageBound && !waitingForBot) return unknown("UNBOUND_MESSAGE");
  if (fields.exactBotMessageBound && fields.historyBinding !== "VALID") return unknown("INVALID_BINDING");

  const emptyQueueRounds = fields.queueState === "EMPTY" ? state.emptyQueueRounds + 1 : 0;
  if (emptyQueueRounds > OWNER_CLARITY_COMPLETION_LIMITS.maximumEmptyQueueRounds) return unknown("EMPTY_QUEUE_LIMIT");
  if (state.rounds >= state.maxRounds) return unknown("ROUND_LIMIT");
  const nextDelayMs = Math.min(
    OWNER_CLARITY_COMPLETION_LIMITS.maximumDelayMs,
    state.rounds === 0 ? state.initialDelayMs : Math.ceil(state.previousDelayMs * OWNER_CLARITY_COMPLETION_LIMITS.multiplier),
    OWNER_CLARITY_COMPLETION_LIMITS.operationTimeoutMs - elapsed
  );
  const nextState = Object.freeze({
    ...state,
    lastObservedAtMs: nowMs,
    rounds: state.rounds + 1,
    emptyQueueRounds,
    previousDelayMs: nextDelayMs
  });
  return Object.freeze({ decision: "WAIT", nextDelayMs,
    nextRead: waitingForBot ? "HISTORY_AND_IN_PROGRESS" : "EXACT_RESULT", state: nextState });
}

function snapshotState(value: unknown): OwnerClarityUpscaleCompletionPolicyState {
  const fields = exactRecord(value, ["startedAtMs", "lastObservedAtMs", "rounds", "emptyQueueRounds", "previousDelayMs", "initialDelayMs", "maxRounds"]);
  if (!safeTime(fields.startedAtMs) || !safeTime(fields.lastObservedAtMs) ||
      !Number.isSafeInteger(fields.rounds) || (fields.rounds as number) < 0 || (fields.rounds as number) > OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds ||
      !Number.isSafeInteger(fields.emptyQueueRounds) || (fields.emptyQueueRounds as number) < 0 || (fields.emptyQueueRounds as number) > OWNER_CLARITY_COMPLETION_LIMITS.maximumEmptyQueueRounds ||
      !Number.isSafeInteger(fields.previousDelayMs) || (fields.previousDelayMs as number) < 0 || (fields.previousDelayMs as number) > OWNER_CLARITY_COMPLETION_LIMITS.maximumDelayMs ||
      !Number.isSafeInteger(fields.initialDelayMs) || (fields.initialDelayMs as number) < 0 || (fields.initialDelayMs as number) > 2_000 ||
      !Number.isSafeInteger(fields.maxRounds) || (fields.maxRounds as number) < 1 || (fields.maxRounds as number) > OWNER_CLARITY_COMPLETION_LIMITS.maximumRounds ||
      (fields.rounds as number) > (fields.maxRounds as number) || fields.lastObservedAtMs < fields.startedAtMs) {
    throw new TypeError("Invalid Clarity completion policy state.");
  }
  return Object.freeze({
    startedAtMs: fields.startedAtMs as number, lastObservedAtMs: fields.lastObservedAtMs as number,
    rounds: fields.rounds as number, emptyQueueRounds: fields.emptyQueueRounds as number,
    previousDelayMs: fields.previousDelayMs as number, initialDelayMs: fields.initialDelayMs as number,
    maxRounds: fields.maxRounds as number
  });
}

function exactRecord(value: unknown, allowed: readonly string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Invalid Clarity completion policy record.");
  const prototype = Object.getPrototypeOf(value);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if ((prototype !== Object.prototype && prototype !== null) || keys.some((key) => typeof key !== "string" || !allowed.includes(key) ||
      !("value" in descriptors[key]!) || !descriptors[key]!.enumerable)) throw new TypeError("Invalid Clarity completion policy record.");
  const result: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
  for (const key of allowed) {
    const descriptor = descriptors[key];
    if (descriptor && "value" in descriptor) result[key] = descriptor.value;
  }
  return result;
}

function safeTime(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function unknown(reason: Extract<OwnerClarityUpscaleCompletionDecision, { decision: "UNKNOWN" }>['reason']) {
  return Object.freeze({ decision: "UNKNOWN" as const, reason });
}
