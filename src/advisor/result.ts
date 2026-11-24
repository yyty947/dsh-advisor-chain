import { SubagentError } from "@deepseek-ai/dsh-subagent";
import type { SubagentResult, SubagentStopReason } from "@deepseek-ai/dsh-subagent";
import type { LlmFailure } from "@deepseek-ai/dsh-llm";
import { contentText, type ChildObservation } from "./observe";
import { t, type HostKey, type Lang } from "../i18n";

/** How a failure should route the chain. */
export type FailureClass = "infrastructure" | "authorization" | "model" | "other";

const INFRASTRUCTURE_CODES = new Set([
  "ACTIVATION_LIMIT_REACHED", "ACTIVATION_CLOSING", "ACTIVATION_TEARDOWN_FAILED", "DEPTH_EXCEEDED", "INVALID_DEPTH",
  "DRAINING", "WORKING_DIRECTORY_UNAVAILABLE", "INVALID_CWD", "NO_PROVIDER", "PROVIDER_CHANGED", "UNSUPPORTED_CAPABILITY",
  "DUPLICATE_PROVIDER", "DUPLICATE_CHILD", "PRESET_UNAVAILABLE", "PRESET_SELECTION_DISABLED", "PRESET_NOT_ALLOWED",
  "CONTINUATION_UNAVAILABLE", "PERSISTENCE_UNAVAILABLE", "NOT_RESUMABLE", "NOT_CONTINUABLE", "INPUT_CLOSED",
  "SUBAGENT_CONTROL_QUERY_UNAVAILABLE", "SUBAGENT_CONTROL_PROJECTIONS_UNAVAILABLE", "SUBAGENT_CONTROL_SESSION_STORE_UNAVAILABLE",
  "INVALID_AGENT_NAME", "DUPLICATE_AGENT_NAME", "AGENT_NAME_NOT_FOUND",
]);
const AUTHORIZATION_CODES = new Set(["UNAUTHORIZED", "MODEL_ROUTE_NOT_ALLOWED", "MODEL_SELECTION_DISABLED", "INVALID_MODEL_SELECTION_SETTINGS"]);
const CANCELLED_CODES = new Set(["CANCELLED"]);

export interface ClassifiedError {
  kind: FailureClass;
  code?: string;
  message: string;
}

/** Route a thrown error: only model-class failures may fall through to the next chain entry. */
export function classifySubagentError(error: unknown): ClassifiedError {
  if (error instanceof SubagentError) {
    const message = error.message || error.code;
    if (CANCELLED_CODES.has(error.code)) return { kind: "other", code: error.code, message };
    if (AUTHORIZATION_CODES.has(error.code)) return { kind: "authorization", code: error.code, message };
    if (INFRASTRUCTURE_CODES.has(error.code)) return { kind: "infrastructure", code: error.code, message };
    return { kind: "model", code: error.code, message };
  }
  return { kind: "other", message: error instanceof Error ? error.message : String(error) };
}

/** Provider failure code → dictionary key of its readable category. */
const FAILURE_CATEGORIES: Array<[RegExp, HostKey]> = [
  [/CONTEXT_WINDOW_EXCEEDED/i, "failure.contextWindow"],
  [/RATE_LIMIT/i, "failure.rateLimit"],
  [/TIMEOUT/i, "failure.timeout"],
  [/TRANSPORT|ECONNRESET|EOF/i, "failure.transport"],
  [/SERVER|PI_AI_ERROR/i, "failure.server"],
  [/AUTH|CREDENTIAL|ACCOUNT_|SIGN_IN/i, "failure.auth"],
  [/QUOTA/i, "failure.quota"],
  [/CONTENT_REFUSED|refusal/i, "failure.refused"],
  [/EMPTY_RESPONSE/i, "failure.empty"],
  [/MODEL_UNSUPPORTED|INVALID_MODEL|MODEL_DOES_NOT/i, "failure.modelUnavailable"],
  [/INVALID_REQUEST|INVALID_RESPONSE|MALFORMED_RESPONSE/i, "failure.invalidRequest"],
];

export function describeFailureCode(code: string, lang: Lang = "zh"): string {
  for (const [pattern, key] of FAILURE_CATEGORIES) if (pattern.test(code)) return t(lang, key);
  return code;
}

function clipMessage(text: string, max = 300): string {
  const trimmed = text.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/** Human-readable reason from the child's own request failures; the last one wins. */
export function describeFailures(failures: readonly LlmFailure[], lang: Lang = "zh"): string | undefined {
  const last = failures[failures.length - 1];
  if (!last) return undefined;
  const category = describeFailureCode(last.code, lang);
  const withStatus = typeof last.status === "number" ? t(lang, "failure.withStatus", { category, status: last.status }) : category;
  const detail = clipMessage(last.message ?? "");
  return detail && detail !== category ? t(lang, "failure.withDetail", { category: withStatus, detail }) : withStatus;
}

const STOP_REASON_KEYS: Record<string, HostKey> = {
  error: "stop.error",
  aborted: "stop.aborted",
  "max-tokens": "stop.maxTokens",
  refusal: "stop.refusal",
};

export interface AdvisorOutcome {
  ok: boolean;
  /** Answer text; partial when `truncated`. */
  content: string;
  stopReason?: SubagentStopReason;
  /** Aborted by our timeout after answer text had started; `content` is partial. */
  truncated: boolean;
  /** Readable reason when `ok` is false. */
  failure?: string;
  failures: LlmFailure[];
}

export type AbortReason = "deadline" | "idle" | "hard-cap";

export function settleOutcome(input: { result?: SubagentResult; observation: ChildObservation; abortedBy?: AbortReason; lang?: Lang }): AdvisorOutcome {
  const { result, observation, abortedBy } = input;
  const lang = input.lang ?? "zh";
  const settledText = result ? contentText(result.output) : "";
  const text = settledText || observation.text.trim();
  const stopReason = result?.stopReason ?? observation.endInfo?.stopReason;
  if (abortedBy && text) {
    return { ok: true, content: text, stopReason, truncated: true, failures: observation.failures };
  }
  if (stopReason === "completed" && text && !abortedBy) {
    return { ok: true, content: text, stopReason, truncated: false, failures: observation.failures };
  }
  // The stop reason is the authoritative account of how the run ended; a
  // recorded request failure (e.g. a 429 that was then retried successfully)
  // is appended as detail, never promoted above it.
  const stopLabel = stopReason ? STOP_REASON_KEYS[stopReason] ?? undefined : undefined;
  const requestFailure = describeFailures(observation.failures, lang);
  const timeoutKey: HostKey | undefined =
    abortedBy === "deadline" ? "timeout.deadline" : abortedBy === "idle" ? "timeout.idle" : abortedBy === "hard-cap" ? "timeout.hardCap" : undefined;
  let reason: string;
  if (timeoutKey) reason = requestFailure ? t(lang, "timeout.withFailure", { reason: t(lang, timeoutKey), detail: requestFailure }) : t(lang, timeoutKey);
  else if (stopReason === "completed") reason = t(lang, "stop.empty");
  else if (stopLabel && stopReason !== "error") reason = requestFailure ? t(lang, "stop.withFailure", { reason: t(lang, stopLabel), detail: requestFailure }) : t(lang, stopLabel);
  else reason = requestFailure ?? (stopLabel ? t(lang, stopLabel) : t(lang, "stop.unknown"));
  if (reason.includes(t(lang, "failure.contextWindow"))) reason += t(lang, "stop.contextHint");
  return { ok: false, content: text, stopReason, truncated: false, failure: reason, failures: observation.failures };
}

export interface TimeoutPolicy {
  timeoutMs: number;
  /** After answer text has started at the deadline: abort when no new text for this long. */
  idleGraceMs?: number;
  /** Absolute cap regardless of progress. */
  hardCapMs?: number;
}

export const DEFAULT_IDLE_GRACE_MS = 30_000;
/** How long a disposed/interrupted child may take to settle before the wait gives up. */
export const ABORT_SETTLE_GRACE_MS = 5_000;

export function hardCapOf(timeoutMs: number): number {
  return Math.max(3 * timeoutMs, 10 * 60_000);
}

export interface WaitInput<T> {
  run: Promise<T>;
  /** Live observation of the child; re-read every tick because a cold resume swaps it. */
  observation: () => ChildObservation | undefined;
  policy: TimeoutPolicy;
  abort: (reason: AbortReason) => void;
  now?: () => number;
  /** Caller cancellation: abort the child, then rethrow. */
  signal?: AbortSignal;
  lang?: Lang;
}

export interface WaitResult<T> {
  value: T;
  abortedBy?: AbortReason;
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Await `run` under the advisor timeout rule (architecture §4): the deadline is
 * hard while the child has produced no answer text; once answer text exists the
 * rule switches to an idle timer; a hard cap bounds the total. `abort` is
 * invoked once and `run` is still awaited so the settled result (partial
 * output) is available.
 */
export async function waitWithTimeout<T>(input: WaitInput<T>): Promise<WaitResult<T>> {
  const now = input.now ?? Date.now;
  const lang = input.lang ?? "zh";
  const start = now();
  const deadline = start + input.policy.timeoutMs;
  const grace = input.policy.idleGraceMs ?? DEFAULT_IDLE_GRACE_MS;
  const hardCap = start + (input.policy.hardCapMs ?? hardCapOf(input.policy.timeoutMs));
  let abortedBy: AbortReason | undefined;
  let abortedAt = 0;
  let settled: { value: T } | undefined;
  let rejected: { error: unknown } | undefined;
  input.run.then(
    (value) => {
      settled = { value };
    },
    (error) => {
      rejected = { error };
    },
  );
  const abortNow = (reason: AbortReason) => {
    abortedBy = reason;
    abortedAt = now();
    input.abort(reason);
  };

  const wakeAt = (at: number) => sleep(Math.min(Math.max(0, at - now()), 1000), input.signal);
  // Sleep until `at`, but wake early as soon as the run settles.
  const wakeAtOrSettle = async (at: number) => {
    await Promise.race([wakeAt(at), input.run.then(() => undefined, () => undefined)]);
  };
  // Caller cancellation: abort the child, then let the abort error propagate.
  const cancelOnAbort = async (at: number) => {
    try {
      await wakeAtOrSettle(at);
    } catch (error) {
      abortedAt = now();
      input.abort("deadline");
      throw error;
    }
  };

  while (!settled && !rejected) {
    const time = now();
    if (abortedBy === undefined) {
      if (time >= hardCap) {
        abortNow("hard-cap");
      } else if (time >= deadline) {
        if (input.observation()?.answerTextStarted) {
          // Answer text has begun: only a quiet period may end it now.
          const idleAt = (input.observation()?.lastAnswerTextAt ?? time) + grace;
          if (time >= idleAt) abortNow("idle");
          else {
            await cancelOnAbort(Math.min(idleAt, hardCap));
            continue;
          }
        } else {
          abortNow("deadline");
        }
      } else {
        await cancelOnAbort(Math.min(deadline, hardCap));
        continue;
      }
    }
    // Aborted (or idle-aborted): wait for the run to settle after disposal,
    // bounded so a run that never settles (interrupt threw, teardown hung)
    // cannot hold the tool call forever; the caller's signal still applies.
    try {
      await Promise.race([input.run, sleep(ABORT_SETTLE_GRACE_MS, input.signal)]);
    } catch (error) {
      if (!settled) throw error;
    }
    if (!settled && !rejected && now() - abortedAt >= ABORT_SETTLE_GRACE_MS) {
      throw new Error(t(lang, "wait.neverSettled", { seconds: ABORT_SETTLE_GRACE_MS / 1000 }));
    }
  }
  // The run itself failed (infrastructure fault): surface it unchanged.
  if (rejected) throw rejected.error;
  return { value: settled!.value, abortedBy };
}
