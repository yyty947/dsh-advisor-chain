import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";

/**
 * In-memory copy of live session logs, fed by the host's `session/event`.
 *
 * The engine needs three facts from a session's own log — the subagent
 * descriptor (is this an advisor child?), the last `sandbox/mode` (did the
 * read-only confinement land?), and the final assistant message (a follow-up's
 * answer). `Session.snapshotEvents()` gives them but the host has deprecated
 * it; this tracker gives the same facts from the event stream every plugin
 * already sees, so the engine no longer depends on a deprecated read. The
 * tracker is bounded and best-effort: the head of each log is kept whole
 * (the descriptor is written during setup, before anything else), the tail is
 * a rolling window, and callers fall back to the durable `sessionQuery` read
 * or — while it still exists — `snapshotEvents()` when a fact is missing.
 */

export interface LogEvent {
  type?: string;
  seq?: number;
  data?: unknown;
  [key: string]: unknown;
}

interface Tracked {
  head: LogEvent[];
  tail: LogEvent[];
  /** Events seen in total; larger than head + tail means a gap in between. */
  total: number;
}

export class SessionEventLog {
  private readonly sessions = new Map<string, Tracked>();

  constructor(
    private readonly maxSessions = 48,
    private readonly headKeep = 32,
    private readonly tailKeep = 400,
  ) {}

  /** Record one appended event; unknown shapes and missing ids are ignored. */
  handleEvent(sessionId: string | undefined, event: LogEvent | undefined): void {
    if (!sessionId || !event || typeof event !== "object") return;
    let tracked = this.sessions.get(sessionId);
    if (tracked) this.sessions.delete(sessionId);
    else tracked = { head: [], tail: [], total: 0 };
    this.sessions.set(sessionId, tracked); // most-recent-first eviction
    tracked.total += 1;
    if (tracked.head.length < this.headKeep) tracked.head.push(event);
    else {
      tracked.tail.push(event);
      if (tracked.tail.length > this.tailKeep) tracked.tail.shift();
    }
    while (this.sessions.size > this.maxSessions) {
      const oldest = this.sessions.keys().next().value;
      if (oldest === undefined) break;
      this.sessions.delete(oldest);
    }
  }

  /** Whether anything was tracked for this session. */
  has(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** Tracked events in log order; undefined when nothing was tracked. */
  eventsOf(sessionId: string): LogEvent[] | undefined {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return undefined;
    return tracked.tail.length === 0 ? tracked.head : [...tracked.head, ...tracked.tail];
  }

  /** True when the tracked events are the complete log (no gap). */
  isComplete(sessionId: string): boolean {
    const tracked = this.sessions.get(sessionId);
    if (!tracked) return false;
    return tracked.total === tracked.head.length + tracked.tail.length;
  }

  /** The subagent descriptor folded from the tracked head, when there is one. */
  descriptorOf(sessionId: string): { label?: string } | undefined {
    const events = this.eventsOf(sessionId);
    if (!events || events.length === 0) return undefined;
    try {
      return foldSubagentDescriptor(events as never) as { label?: string } | undefined;
    } catch {
      return undefined;
    }
  }

  /** Mode of the last tracked `sandbox/mode` event. */
  lastModeOf(sessionId: string): string | undefined {
    const events = this.eventsOf(sessionId);
    if (!events) return undefined;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type === "sandbox/mode") {
        const mode = (event.data as { mode?: unknown } | undefined)?.mode;
        return typeof mode === "string" ? mode : undefined;
      }
    }
    return undefined;
  }

  /** Tracked events at or after a log sequence number. */
  since(sessionId: string, fromSeq: number): LogEvent[] {
    return (this.eventsOf(sessionId) ?? []).filter((event) => (typeof event.seq === "number" ? event.seq : 0) >= fromSeq);
  }

  /** Drop every tracked session (tests, teardown). */
  clear(): void {
    this.sessions.clear();
  }
}
