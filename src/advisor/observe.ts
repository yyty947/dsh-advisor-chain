import type { Agent } from "@deepseek-ai/dsh-agent";
import type { LlmFailure } from "@deepseek-ai/dsh-llm";
import type { SubagentRunEndInfo } from "@deepseek-ai/dsh-subagent";

/**
 * Live observation of one advisor child over one activation epoch.
 *
 * Local subagent results carry no failure diagnostic, so the real reasons are
 * collected from the child's own `agent/request-error` events; the timeout
 * rule needs to know whether the child has started emitting ANSWER text
 * (reasoning and tool calls do not count), which only the live stream frames
 * reveal before the assistant message is committed.
 */
export interface ChildObservation {
  readonly childId: string;
  /** Normalized provider failures raised by the child's model requests. */
  readonly failures: LlmFailure[];
  /** Answer text has been emitted in the child's current step (reset by a tool call). */
  answerTextStarted: boolean;
  /** Timestamp of the last answer text delta; 0 until the first one. */
  lastAnswerTextAt: number;
  /** Accumulated answer text of the current step, for partial output on abort. */
  text: string;
  /** Number of tool-call streams the child started in this epoch. */
  toolCalls: number;
  /** `turn/end` events seen on the child's session since this observation attached. */
  turnEnds: number;
  /** Data of the most recent `turn/end`, for diagnostics. */
  lastTurnEnd?: unknown;
  /** Subscribe to `turn/end` on this child's session; returns an unsubscriber. */
  onTurnEnd(listener: () => void): () => void;
  ended: boolean;
  endInfo?: SubagentRunEndInfo;
  dispose(): void;
}

/** Partial text is only a fallback when the settled result carries none. */
const TEXT_CAP = 64 * 1024;

type ListenerContext = { on(name: string, listener: (...args: never[]) => unknown): () => unknown };

export function attachObservation(child: Agent, now: () => number = Date.now): ChildObservation {
  const obs: ChildObservation = {
    childId: String(child.id),
    failures: [],
    answerTextStarted: false,
    lastAnswerTextAt: 0,
    text: "",
    toolCalls: 0,
    turnEnds: 0,
    onTurnEnd: (listener) => {
      turnEndListeners.push(listener);
      return () => {
        const i = turnEndListeners.indexOf(listener);
        if (i >= 0) turnEndListeners.splice(i, 1);
      };
    },
    ended: false,
    dispose: () => {},
  };
  const turnEndListeners: Array<() => void> = [];
  const ctx = (child as unknown as { ctx: ListenerContext }).ctx;
  const disposers: Array<() => void> = [];
  const listen = (name: string, listener: (...args: never[]) => unknown) => {
    const off = ctx.on(name, listener);
    disposers.push(() => void off());
  };

  // Waterfall listener: returning undefined leaves the failure terminal, which
  // is what the child's own retry policy has already decided.
  listen("agent/request-error", (payload) => {
    const p = payload as { agent?: Agent; failure?: LlmFailure };
    if (p.agent && p.agent !== child) return undefined;
    if (p.failure) obs.failures.push(p.failure);
    return undefined;
  });
  listen("agent/assistant-stream", (payload) => {
    const p = payload as { agent?: Agent; frame?: { type?: string; chunk?: { type?: string; text?: string } } };
    if (p.agent && p.agent !== child) return;
    const frame = p.frame;
    if (!frame || frame.type !== "chunk" || !frame.chunk) return;
    if (frame.chunk.type === "text-delta" && typeof frame.chunk.text === "string") {
      obs.answerTextStarted = true;
      obs.lastAnswerTextAt = now();
      if (obs.text.length < TEXT_CAP) obs.text += frame.chunk.text;
    } else if (frame.chunk.type === "tool-call-delta") {
      obs.toolCalls += 1;
      // A tool call ends the current answer: only later text counts again.
      obs.answerTextStarted = false;
      obs.lastAnswerTextAt = 0;
    }
  });

  // `session/event` is the two-argument host event (session, event); it is the
  // completion signal shared by warm follow-ups (same activation epoch) and
  // cold resumes (new `subagent/start` epoch), so it is registered directly.
  const offSession = ctx.on("session/event", (session: unknown, event: { type?: string; data?: unknown }) => {    if (session !== child.session || event?.type !== "turn/end") return;
    obs.turnEnds += 1;
    obs.lastTurnEnd = event.data;
    obs.answerTextStarted = false;
    for (const listener of [...turnEndListeners]) listener();
  });
  disposers.push(() => void offSession());

  obs.dispose = () => {
    for (const off of disposers.splice(0)) off();
  };
  return obs;
}

/** Text of a subagent's final output blocks. */
export function contentText(blocks: readonly unknown[] | undefined): string {
  if (!Array.isArray(blocks)) return "";
  return blocks
    .map((b) => (b as { type?: string; text?: string })?.type === "text" && typeof (b as { text?: string }).text === "string" ? (b as { text: string }).text : "")
    .join("")
    .trim();
}
