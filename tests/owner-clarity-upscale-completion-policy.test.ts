import assert from "node:assert/strict";
import test from "node:test";
import {
  createOwnerClarityUpscaleCompletionPolicy,
  decideOwnerClarityUpscaleCompletion
} from "../src/application/owner-clarity-upscale-completion-policy.js";

function start() {
  return createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: 10_000 });
}

function pending(state: ReturnType<typeof start>, nowMs: number, extra: Record<string, unknown> = {}) {
  return decideOwnerClarityUpscaleCompletion({
    state, nowMs, aborted: false, echoAckKnown: true, exactBotMessageBound: true,
    historyBinding: "VALID", queueState: "MATCHED", resultState: "PENDING",
    unverifiedReason: "NO_IMAGE_OBJECTS", ...extra
  });
}

test("first eligible pending observation waits 2 seconds and advances one bounded round", () => {
  const decision = pending(start(), 10_100);
  assert.deepEqual(decision, {
    decision: "WAIT",
    nextDelayMs: 2_000,
    nextRead: "EXACT_RESULT",
    state: {
      startedAtMs: 10_000, lastObservedAtMs: 10_100, rounds: 1, emptyQueueRounds: 0,
      previousDelayMs: 2_000, initialDelayMs: 2_000, maxRounds: 32
    }
  });
});

test("unsafe or cardinality mismatch remains permanent even if a caller labels the result complete", () => {
  const decision = pending(start(), 10_100, {
    resultState: "COMPLETE", unverifiedReason: "RESULT_URL_UNSAFE"
  });
  assert.deepEqual(decision, { decision: "UNKNOWN", reason: "RESULT_INVALID" });
});

test("literal deterministic delay sequence follows the local 1.2 multiplier and 40 second cap", () => {
  let state = start();
  const delays: number[] = [];
  let nowMs = 10_100;
  for (let index = 0; index < 8; index += 1) {
    const decision = pending(state, nowMs);
    assert.equal(decision.decision, "WAIT");
    if (decision.decision !== "WAIT") return;
    delays.push(decision.nextDelayMs);
    state = decision.state;
    nowMs += decision.nextDelayMs;
  }
  assert.deepEqual(delays, [2_000, 2_400, 2_880, 3_456, 4_148, 4_978, 5_974, 7_169]);
});

test("delay growth never exceeds 40 seconds", () => {
  let state = start();
  let nowMs = 10_001;
  let lastDelay = 0;
  for (let index = 0; index < 18; index += 1) {
    const decision = pending(state, nowMs);
    assert.equal(decision.decision, "WAIT");
    if (decision.decision !== "WAIT") return;
    state = decision.state;
    lastDelay = decision.nextDelayMs;
    nowMs += 1;
  }
  assert.equal(lastDelay, 40_000);
});

test("the 25th consecutive empty queue round is terminal and does not permit a search", () => {
  let state = start();
  let nowMs = 10_001;
  for (let index = 0; index < 24; index += 1) {
    const decision = pending(state, nowMs, { queueState: "EMPTY" });
    assert.equal(decision.decision, "WAIT");
    if (decision.decision !== "WAIT") return;
    state = decision.state;
    nowMs += 1;
  }
  const terminal = pending(state, nowMs, { queueState: "EMPTY" });
  assert.deepEqual(terminal, { decision: "UNKNOWN", reason: "EMPTY_QUEUE_LIMIT" });
});

test("a fully bound completed result does not depend on a later queue read", () => {
  const decision = pending(start(), 10_100, {
    queueState: "UNKNOWN", resultState: "COMPLETE", unverifiedReason: null
  });
  assert.deepEqual(decision, { decision: "COMPLETE" });
});

test("without a known post acknowledgement or exact bot binding the policy never waits", () => {
  assert.deepEqual(pending(start(), 10_100, { echoAckKnown: false }), { decision: "UNKNOWN", reason: "NO_ACK" });
  assert.deepEqual(pending(start(), 10_100, { exactBotMessageBound: false }), { decision: "UNKNOWN", reason: "UNBOUND_MESSAGE" });
  assert.deepEqual(pending(start(), 10_100, { historyBinding: "INVALID" }), { decision: "UNKNOWN", reason: "INVALID_BINDING" });
});

test("known ACK with no bot yet permits only bounded history and in-progress rereads", () => {
  const state = start();
  for (const queueState of ["EMPTY", "UNKNOWN", "PENDING"] as const) {
    const decision = decideOwnerClarityUpscaleCompletion({
      state, nowMs: 10_100, aborted: false, echoAckKnown: true, exactBotMessageBound: false,
      historyBinding: "NONE", queueState, resultState: "NOT_READ", unverifiedReason: null
    });
    assert.equal(decision.decision, "WAIT");
    if (decision.decision !== "WAIT") continue;
    assert.equal(decision.nextRead, "HISTORY_AND_IN_PROGRESS");
    assert.equal(decision.nextDelayMs, 2_000);
    assert.equal(decision.state.rounds, 1);
    assert.equal(decision.state.emptyQueueRounds, queueState === "EMPTY" ? 1 : 0);
  }
});

test("no-bot phase never permits a result read or waits on an unverified result", () => {
  const state = start();
  const base = {
    state, nowMs: 10_100, aborted: false, echoAckKnown: true, exactBotMessageBound: false,
    historyBinding: "NONE" as const, queueState: "EMPTY" as const, unverifiedReason: null
  };
  assert.deepEqual(decideOwnerClarityUpscaleCompletion({ ...base, resultState: "COMPLETE" }),
    { decision: "UNKNOWN", reason: "INVALID_BINDING" });
  assert.deepEqual(decideOwnerClarityUpscaleCompletion({ ...base, resultState: "PENDING", unverifiedReason: "NO_IMAGE_OBJECTS" }),
    { decision: "UNKNOWN", reason: "UNBOUND_MESSAGE" });
  assert.deepEqual(pending(state, 10_100, { exactBotMessageBound: true, historyBinding: "NONE" }),
    { decision: "UNKNOWN", reason: "INVALID_BINDING" });
});

test("known-ACK empty queue allows 24 no-bot rounds, then becomes terminal", () => {
  let state = start();
  for (let index = 0; index < 24; index += 1) {
    const decision = decideOwnerClarityUpscaleCompletion({
      state, nowMs: 10_001 + index, aborted: false, echoAckKnown: true, exactBotMessageBound: false,
      historyBinding: "NONE", queueState: "EMPTY", resultState: "NOT_READ", unverifiedReason: null
    });
    assert.equal(decision.decision, "WAIT");
    if (decision.decision !== "WAIT") return;
    assert.equal(decision.nextRead, "HISTORY_AND_IN_PROGRESS");
    state = decision.state;
  }
  assert.deepEqual(decideOwnerClarityUpscaleCompletion({
    state, nowMs: 10_025, aborted: false, echoAckKnown: true, exactBotMessageBound: false,
    historyBinding: "NONE", queueState: "EMPTY", resultState: "NOT_READ", unverifiedReason: null
  }), { decision: "UNKNOWN", reason: "EMPTY_QUEUE_LIMIT" });
});

test("deadline is absolute and clips the final delay to the remaining millisecond", () => {
  const state = createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: 0, initialDelayMs: 2_000 });
  const clipped = pending(state, 179_999);
  assert.equal(clipped.decision, "WAIT");
  if (clipped.decision === "WAIT") assert.equal(clipped.nextDelayMs, 1);
  assert.deepEqual(pending(state, 180_000), { decision: "UNKNOWN", reason: "DEADLINE_EXCEEDED" });
});

test("backwards clock and abort are terminal and do not request another observation", () => {
  assert.deepEqual(pending(start(), 9_999), { decision: "UNKNOWN", reason: "CLOCK_INVALID" });
  assert.deepEqual(pending(start(), 10_100, { aborted: true }), { decision: "UNKNOWN", reason: "ABORTED" });
  assert.deepEqual(pending(start(), 9_999, { aborted: true }), { decision: "UNKNOWN", reason: "ABORTED" });
});

test("small local test bounds and zero delay remain supported without an unbounded rounds override", () => {
  const state = createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: 10_000, initialDelayMs: 0, maxRounds: 1 });
  const first = pending(state, 10_000);
  assert.equal(first.decision, "WAIT");
  if (first.decision !== "WAIT") return;
  assert.equal(first.nextDelayMs, 0);
  assert.deepEqual(pending(first.state, 10_000), { decision: "UNKNOWN", reason: "ROUND_LIMIT" });
  assert.throws(() => createOwnerClarityUpscaleCompletionPolicy({ startedAtMs: 10_000, maxRounds: 33 }));
});

test("permanent model, cardinality, and unsafe URL reasons cannot be retried", () => {
  for (const unverifiedReason of ["RESULT_OBJECT_MISMATCH", "RESULT_COUNT_OUT_OF_RANGE", "RESULT_URL_UNSAFE"]) {
    assert.deepEqual(pending(start(), 10_100, { unverifiedReason }), { decision: "UNKNOWN", reason: "RESULT_INVALID" });
  }
});
