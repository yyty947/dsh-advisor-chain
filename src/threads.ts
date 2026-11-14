/**
 * Consultation-thread reconstruction from the durable session log (v2 design,
 * option A): the thread is NOT held in plugin memory — follow-ups re-read the
 * caller's session log and rebuild the conversation for the given consultId
 * from the advisor/* events we already persist for the chat card.
 *
 * Properties (per the confirmed design):
 * - Persistent: survives restarts and later days; consult_id stays usable as
 *   long as the session log exists.
 * - Session-scoped: a thread belongs to the session that created it.
 * - Capacity: MAX_ROUNDS answers / MAX_THREAD_CHARS per thread, enforced
 *   before a follow-up is accepted.
 */

export interface ThreadEventLike {
  type?: string;
  data?: {
    consultId?: string;
    question?: string;
    context?: string;
    mode?: string;
    followUp?: string;
    round?: number;
    provider?: string;
    model?: string;
    label?: string;
    content?: unknown;
    status?: string;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface ThreadTurn {
  role: "user" | "advisor";
  text: string;
}

export interface RebuiltThread {
  consultId: string;
  mode: "inherited" | "standalone";
  question: string;
  context?: string;
  /** Alternate user/advisor turns: question, answer1, followUp1, answer2, ... */
  turns: ThreadTurn[];
  /** The advisor model that won the original consultation (follow-ups lock to it). */
  usedProvider?: string;
  usedModel?: string;
  rounds: number;
  sizeChars: number;
}

export const MAX_THREAD_ROUNDS = 8;
export const MAX_THREAD_CHARS = 96 * 1024;

/**
 * Rebuild one consultation thread by scanning events chronologically.
 * Returns undefined when no events for the consultId exist (unknown id).
 */
export function rebuildThread(events: ThreadEventLike[], consultId: string): RebuiltThread | undefined {
  let thread: RebuiltThread | undefined;
  let followUpCount = 0;
  for (const event of events) {
    const data = event?.data;
    if (!data || data.consultId !== consultId) continue;
    if (event.type === "advisor/start") {
      thread = {
        consultId,
        mode: data.mode === "standalone" ? "standalone" : "inherited",
        question: typeof data.question === "string" ? data.question : "",
        context: typeof data.context === "string" ? data.context : undefined,
        turns: [],
        rounds: 0,
        sizeChars: 0,
      };
      if (thread.question) {
        thread.turns.push({ role: "user", text: thread.question });
        thread.sizeChars += thread.question.length + (thread.context?.length ?? 0);
      }
      continue;
    }
    if (!thread) continue;
    if (event.type === "advisor/followup") {
      followUpCount += 1;
      const text = typeof data.followUp === "string" ? data.followUp : "";
      thread.turns.push({ role: "user", text });
      thread.sizeChars += text.length;
      continue;
    }
    if (event.type === "advisor/message") {
      const text = typeof data.content === "string" ? data.content : "";
      thread.turns.push({ role: "advisor", text });
      thread.sizeChars += text.length;
      thread.rounds += 1;
      if (typeof data.provider === "string") thread.usedProvider = data.provider;
      if (typeof data.model === "string") thread.usedModel = data.model;
      continue;
    }
  }
  if (!thread) return undefined;
  // Follow-up rounds = advisor answers beyond the original one.
  thread.rounds = Math.max(thread.rounds - 1, 0);
  void followUpCount;
  return thread;
}

/** Capacity check per the confirmed design: 8 rounds / 96 KB per thread. */
export function threadCapacityError(thread: RebuiltThread, incomingChars: number): string | undefined {
  if (thread.rounds >= MAX_THREAD_ROUNDS) {
    return `该咨询线程已达 ${MAX_THREAD_ROUNDS} 轮追问上限，请开新咨询。`;
  }
  if (thread.sizeChars + incomingChars > MAX_THREAD_CHARS) {
    return `该咨询线程体积已达上限（${MAX_THREAD_CHARS / 1024} KB），请开新咨询。`;
  }
  return undefined;
}

/** Messages array for ctx.llm.stream: persona turns of the rebuilt thread,
 *  with the new follow-up as the final user message. Advisor turns map to
 *  assistant messages. */
export function threadToMessages(thread: RebuiltThread, followUp: string): Array<{ role: "user" | "assistant"; text: string }> {
  const messages = thread.turns.map((turn) => ({
    role: turn.role === "advisor" ? ("assistant" as const) : ("user" as const),
    text: turn.text,
  }));
  messages.push({ role: "user", text: followUp });
  return messages;
}
