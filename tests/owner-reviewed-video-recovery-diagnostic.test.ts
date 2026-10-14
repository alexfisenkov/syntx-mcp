import assert from "node:assert/strict";
import test from "node:test";
import { buildOwnerReviewedVideoRecoveryDiagnostic } from "../src/application/owner-reviewed-video-recovery-diagnostic.js";

const BASE = {
  phase: "RESULT_GET",
  post_disposition: "VALID_ECHO_OBSERVED",
  ack_observation: "VALID_ECHO_OBSERVED",
  history_observation: "READ_UNIQUE_BINDING",
  result_binding_observation: "READ_NO_VERIFIED_ARTIFACT",
  last_safe_error_code: "OUTCOME_UNKNOWN",
  no_artifact_reason: "RESULT_POLL_BUDGET_EXHAUSTED",
  poll_usage: { history_get_calls: 1, in_progress_get_calls: 4, result_get_calls: 7 }
} as const;

test("builds a closed, redacted snapshot without upgrading a possible POST to provider acceptance", () => {
  const result = buildOwnerReviewedVideoRecoveryDiagnostic(BASE);
  assert.deepEqual(result, {
    phase: "RESULT_GET",
    post_disposition: "VALID_ECHO_OBSERVED",
    ack_observation: "VALID_ECHO_OBSERVED",
    history_observation: "READ_UNIQUE_BINDING",
    result_binding_observation: "READ_NO_VERIFIED_ARTIFACT",
    last_safe_error_code: "OUTCOME_UNKNOWN",
    no_artifact_reason: "RESULT_POLL_BUDGET_EXHAUSTED",
    poll_usage: {
      history_get_calls: { count: 1, capped: false },
      in_progress_get_calls: { count: 4, capped: false },
      result_get_calls: { count: 7, capped: false }
    }
  });
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.poll_usage), true);
  assert.equal("provider_accepted" in result, false);
});

test("bounds poll counts while preserving whether the source count was capped", () => {
  const result = buildOwnerReviewedVideoRecoveryDiagnostic({
    ...BASE,
    poll_usage: { history_get_calls: 2_147_483_647, in_progress_get_calls: 0, result_get_calls: 256 }
  });
  assert.deepEqual(result.poll_usage, {
    history_get_calls: { count: 256, capped: true },
    in_progress_get_calls: { count: 0, capped: false },
    result_get_calls: { count: 256, capped: false }
  });
});

test("rejects unknown error codes and unrecognized diagnostic fields without echoing them", () => {
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic({ ...BASE, last_safe_error_code: "PRIVATE_RAW_ERROR" }),
    { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic({ ...BASE, prompt: "private prompt" }),
    { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
});

test("rejects contradictory POST and ACK observations", () => {
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic({ ...BASE, post_disposition: "MAY_HAVE_BEEN_SENT" }),
    { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic({ ...BASE, post_disposition: "NOT_REACHED" }),
    { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
});

test("does not execute getters or proxy traps on a snapshot", () => {
  let getterCalls = 0;
  let proxyTrapCalls = 0;
  const accessor = { ...BASE } as Record<string, unknown>;
  Object.defineProperty(accessor, "phase", { enumerable: true, get() { getterCalls += 1; return "RESULT_GET"; } });
  const proxy = new Proxy({ ...BASE }, { getPrototypeOf() { proxyTrapCalls += 1; throw new Error("must not run"); } });
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic(accessor), { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic(proxy), { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
  assert.equal(getterCalls, 0);
  assert.equal(proxyTrapCalls, 0);
});

test("does not inspect arbitrary nested error code or message fields", () => {
  let codeGetterCalls = 0;
  let messageGetterCalls = 0;
  const arbitraryError = Object.defineProperties({}, {
    code: { enumerable: true, get() { codeGetterCalls += 1; throw new Error("private code"); } },
    message: { enumerable: true, get() { messageGetterCalls += 1; throw new Error("private message"); } }
  });
  assert.throws(() => buildOwnerReviewedVideoRecoveryDiagnostic({ ...BASE, error: arbitraryError }),
    { message: "OWNER_VIDEO_RECOVERY_DIAGNOSTIC_INVALID" });
  assert.equal(codeGetterCalls, 0);
  assert.equal(messageGetterCalls, 0);
});
