/**
 * Advisor fallback chain orchestration, isolated from ctx so it is unit
 * testable. `callOne` performs one model call (streaming deltas through the
 * callback); this module owns the order, the failure bookkeeping, and the
 * stop conditions.
 */

export interface ChainAttemptTarget {
  label?: string;
  provider: string;
  model: string;
  [key: string]: unknown;
}

export interface StreamResult {
  content: string;
  thinking: string;
  /** set when the stream ended because of the per-entry timeout */
  truncated?: { reason: "timeout"; atMs: number };
}

export interface ChainCallbacks {
  /** called once before each attempt */
  onAttempt?: (index: number, target: ChainAttemptTarget) => void;
  /** streaming deltas from the current attempt */
  onDelta?: (index: number, target: ChainAttemptTarget, delta: { text?: string; thinking?: string }) => void;
  /** the attempt finished successfully */
  onDone?: (index: number, target: ChainAttemptTarget, result: StreamResult) => void;
  /** the attempt failed; the chain continues with the next entry */
  onFail?: (index: number, target: ChainAttemptTarget, error: string) => void;
}

export interface ChainOutcome<T extends ChainAttemptTarget> {
  result?: StreamResult;
  winner?: T;
  winnerIndex?: number;
  failures: Array<{ target: T; error: string }>;
}

export class AllEntriesFailedError extends Error {
  constructor(public readonly failures: Array<{ target: ChainAttemptTarget; error: string }>) {
    super(`所有顾问模型均调用失败：${failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}`);
    this.name = "AllEntriesFailedError";
  }
}

export function entryName(target: ChainAttemptTarget): string {
  const label = typeof target.label === "string" && target.label.trim() ? target.label.trim() : "";
  return label || `${target.provider}/${target.model}`;
}

/**
 * Try entries in order. An attempt succeeds when it resolves with non-empty
 * content (a timeout with partial content counts as a truncated success; a
 * timeout with no content counts as a failure). Caller-signal aborts always
 * propagate.
 */
export async function runAdvisorChain<T extends ChainAttemptTarget>(
  entries: T[],
  callOne: (target: T, signal: AbortSignal) => Promise<StreamResult>,
  callbacks: ChainCallbacks,
  signal?: AbortSignal,
): Promise<ChainOutcome<T>> {
  const failures: ChainOutcome<T>["failures"] = [];
  for (let index = 0; index < entries.length; index++) {
    if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
    const target = entries[index];
    callbacks.onAttempt?.(index, target);
    let result: StreamResult;
    try {
      result = await callOne(target, signal ?? new AbortController().signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ target, error: message });
      callbacks.onFail?.(index, target, message);
      continue;
    }
    if (!result.content.trim()) {
      const message = result.truncated ? "超时且无内容产出" : "空响应";
      failures.push({ target, error: message });
      callbacks.onFail?.(index, target, message);
      continue;
    }
    callbacks.onDone?.(index, target, result);
    return { result, winner: target, winnerIndex: index, failures };
  }
  throw new AllEntriesFailedError(failures);
}
