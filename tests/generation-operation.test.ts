import assert from "node:assert/strict";
import test from "node:test";
import {
  assertGenerationStateTransition,
  GenerationStateTransitionError,
  isTerminalGenerationState,
  recoveredGenerationState,
  type GenerationOperationState
} from "../src/domain/generation-operation.js";

test("durable generation state permits only monotonic safe transitions", () => {
  for (const [from, to] of [
    ["PREPARED", "CHAT_CREATING"],
    ["CHAT_CREATING", "CHAT_READY"],
    ["CHAT_READY", "GENERATION_DISPATCHING"],
    ["GENERATION_DISPATCHING", "PROVIDER_ACCEPTED"],
    ["PROVIDER_ACCEPTED", "QUEUED"],
    ["QUEUED", "RUNNING"],
    ["RUNNING", "SUCCEEDED"],
    ["CHAT_CREATING", "CHAT_CREATE_OUTCOME_UNKNOWN"],
    ["CHAT_CREATE_OUTCOME_UNKNOWN", "CHAT_RECONCILING"],
    ["CHAT_RECONCILING", "CHAT_READY"],
    ["GENERATION_DISPATCHING", "GENERATION_OUTCOME_UNKNOWN"],
    ["GENERATION_OUTCOME_UNKNOWN", "GENERATION_RECONCILING"],
    ["GENERATION_OUTCOME_UNKNOWN", "PROVIDER_ACCEPTED"],
    ["GENERATION_RECONCILING", "PROVIDER_ACCEPTED"]
  ] as const) {
    assert.doesNotThrow(() => assertGenerationStateTransition(from, to));
  }

  for (const [from, to] of [
    ["PREPARED", "SUCCEEDED"],
    ["CHAT_CREATE_OUTCOME_UNKNOWN", "CHAT_CREATING"],
    ["CHAT_CREATE_OUTCOME_UNKNOWN", "GENERATION_DISPATCHING"],
    ["GENERATION_OUTCOME_UNKNOWN", "GENERATION_DISPATCHING"],
    ["GENERATION_OUTCOME_UNKNOWN", "CHAT_RECONCILING"],
    ["SUCCEEDED", "RUNNING"],
    ["FAILED", "PREPARED"],
    ["CANCELED", "RUNNING"],
    ["TERMINAL_UNRESOLVED", "GENERATION_RECONCILING"],
    ["TERMINAL_UNRESOLVED", "PROVIDER_ACCEPTED"]
  ] as const) {
    assert.throws(
      () => assertGenerationStateTransition(from, to),
      GenerationStateTransitionError
    );
  }
});

test("unknown runtime states fail with the domain error, not a raw TypeError", () => {
  for (const [from, to] of [
    ["CORRUPTED_STATE", "RUNNING"],
    ["PREPARED", "CORRUPTED_STATE"]
  ] as const) {
    assert.throws(
      () =>
        assertGenerationStateTransition(
          from as GenerationOperationState,
          to as GenerationOperationState
        ),
      (error: unknown) =>
        error instanceof GenerationStateTransitionError &&
        !(error instanceof TypeError)
    );
  }
});

test("restart recovery never makes an interrupted write retryable", () => {
  assert.equal(
    recoveredGenerationState("CHAT_CREATING"),
    "CHAT_CREATE_OUTCOME_UNKNOWN"
  );
  assert.equal(
    recoveredGenerationState("GENERATION_DISPATCHING"),
    "GENERATION_OUTCOME_UNKNOWN"
  );
  assert.equal(
    recoveredGenerationState("CHAT_RECONCILING"),
    "CHAT_CREATE_OUTCOME_UNKNOWN"
  );
  assert.equal(
    recoveredGenerationState("GENERATION_RECONCILING"),
    "GENERATION_OUTCOME_UNKNOWN"
  );

  for (const state of [
    "PREPARED",
    "CHAT_READY",
    "PROVIDER_ACCEPTED",
    "QUEUED",
    "RUNNING",
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
    "REJECTED_NO_COMMIT",
    "CHAT_CREATE_OUTCOME_UNKNOWN",
    "GENERATION_OUTCOME_UNKNOWN",
    "TERMINAL_UNRESOLVED"
  ] as const) {
    assert.equal(recoveredGenerationState(state), state);
  }
});

test("terminal states are explicit and stage-specific unknown outcomes are not terminal", () => {
  for (const state of [
    "SUCCEEDED",
    "FAILED",
    "CANCELED",
    "REJECTED_NO_COMMIT",
    "TERMINAL_UNRESOLVED"
  ] as const) {
    assert.equal(isTerminalGenerationState(state), true);
  }
  assert.equal(isTerminalGenerationState("CHAT_CREATE_OUTCOME_UNKNOWN"), false);
  assert.equal(isTerminalGenerationState("GENERATION_OUTCOME_UNKNOWN"), false);
  assert.equal(isTerminalGenerationState("RUNNING"), false);
});
