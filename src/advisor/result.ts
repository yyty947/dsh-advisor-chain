import { SubagentError } from "@deepseek-ai/dsh-subagent";
import type { SubagentResult, SubagentStopReason } from "@deepseek-ai/dsh-subagent";
import type { LlmFailure } from "@deepseek-ai/dsh-llm";
import { contentText, type ChildObservation } from "./observe";

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

const FAILURE_CATEGORIES: Array<[RegExp, string]> = [
  [/CONTEXT_WINDOW_EXCEEDED/i, "上下文超限"],
  [/RATE_LIMIT/i, "限流"],
  [/TIMEOUT/i, "超时"],
  [/TRANSPORT|ECONNRESET|EOF/i, "网络错误"],
  [/SERVER|PI_AI_ERROR/i, "服务端错误"],
  [/AUTH|CREDENTIAL|ACCOUNT_|SIGN_IN/i, "鉴权失败"],
  [/QUOTA/i, "额度不足"],
  [/CONTENT_REFUSED|refusal/i, "内容被拒"],
  [/EMPTY_RESPONSE/i, "空响应"],
  [/MODEL_UNSUPPORTED|INVALID_MODEL|MODEL_DOES_NOT/i, "模型不可用"],
  [/INVALID_REQUEST|INVALID_RESPONSE|MALFORMED_RESPONSE/i, "请求或响应无效"],
];

export function describeFailureCode(code: string): string {
  for (const [pattern, label] of FAILURE_CATEGORIES) if (pattern.test(code)) return label;
  return code;
}

function clipMessage(text: string, max = 300): string {
  const t = text.trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

/** Human-readable reason from the child's own request failures; the last one wins. */
export function describeFailures(failures: readonly LlmFailure[]): string | undefined {
  const last = failures[failures.length - 1];
  if (!last) return undefined;
  const category = describeFailureCode(last.code);
  const status = typeof last.status === "number" ? `（HTTP ${last.status}）` : "";
  const detail = clipMessage(last.message ?? "");
  return detail && detail !== category ? `${category}${status}：${detail}` : `${category}${status}`;
}

const STOP_REASON_LABELS: Record<string, string> = {
  error: "顾问运行出错",
  aborted: "顾问被中止",
  "max-tokens": "顾问输出达到 maxTokens 上限",
  refusal: "顾问拒绝回答",
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

export function settleOutcome(input: { result?: SubagentResult; observation: ChildObservation; abortedBy?: AbortReason }): AdvisorOutcome {
  const { result, observation, abortedBy } = input;
  const settledText = result ? contentText(result.output) : "";
  const text = settledText || observation.text.trim();
  const stopReason = result?.stopReason ?? observation.endInfo?.stopReason;
  if (abortedBy && text) {
    return {
      ok: true,
      content: text,
      stopReason,
      truncated: true,
      failures: observation.failures,
    };
  }
  if (stopReason === "completed" && text && !abortedBy) {
    return { ok: true, content: text, stopReason, truncated: false, failures: observation.failures };
  }
  // The stop reason is the authoritative account of how the run ended; a
  // recorded request failure (e.g. a 429 that was then retried successfully)
  // is appended as detail, never promoted above it.
  const stopLabel = stopReason ? STOP_REASON_LABELS[stopReason] ?? stopReason : undefined;
  const requestFailure = describeFailures(observation.failures);
  const timeoutLabel =
    abortedBy === "deadline" ? "超时：到点时尚未开始输出回答正文" : abortedBy === "idle" ? "超时：回答中断后长时间无新输出" : abortedBy === "hard-cap" ? "超时：超过总时长上限" : undefined;
  let reason: string;
  if (timeoutLabel) reason = requestFailure ? `${timeoutLabel}（最后一次请求错误：${requestFailure}）` : timeoutLabel;
  else if (stopReason === "completed") reason = "顾问正常结束但未返回任何内容（空响应）";
  else if (stopLabel && stopReason !== "error") reason = requestFailure ? `${stopLabel}（最后一次请求错误：${requestFailure}）` : stopLabel;
  else reason = requestFailure ?? stopLabel ?? "未知原因（顾问未返回内容）";
  if (/上下文超限/.test(reason)) reason += "。可在设置里调低抄本预算，或改用盲审模式并在 context 里只写要点";
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
 * Await `run` under the advisor timeout rule (design §6): the deadline is hard
 * while the child has produced no answer text; once answer text exists the
 * rule switches to an idle timer; a hard cap bounds the total. `abort` is
 * invoked once and `run` is still awaited so the settled result (partial
 * output) is available.
 */
export async function waitWithTimeout<T>(input: WaitInput<T>): Promise<WaitResult<T>> {
  const now = input.now ?? Date.now;
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
    const t = now();
    if (abortedBy === undefined) {
      if (t >= hardCap) {
        abortNow("hard-cap");
      } else if (t >= deadline) {
        if (input.observation()?.answerTextStarted) {
          // Answer text has begun: only a quiet period may end it now.
          const idleAt = (input.observation()?.lastAnswerTextAt ?? t) + grace;
          if (t >= idleAt) abortNow("idle");
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
      throw new Error(`顾问中止后 ${ABORT_SETTLE_GRACE_MS / 1000} 秒内未结束`);
    }
  }
  // The run itself failed (infrastructure fault): surface it unchanged.
  if (rejected) throw rejected.error;
  return { value: settled!.value, abortedBy };
}

/** How long a disposed/interrupted child may take to settle before the wait gives up. */
export const ABORT_SETTLE_GRACE_MS = 5_000;
