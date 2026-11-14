import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";

/**
 * Host-side registration for the advisor session event vocabulary.
 *
 * Same pragmatic workaround dsh-advisor-group uses: `Session.append()` only
 * accepts event types inside KNOWN_SESSION_EVENT_TYPES (or ignorable
 * envelopes, which the public append API cannot set), so we mutate the
 * runtime Set at module load to make our durable card events survive
 * restart/resume. Replace this when DSH ships an official plugin-event
 * registration surface.
 *
 * Note: the event type names (advisor/*) deliberately predate the package
 * rename to dsh-second-opinion and are kept — renaming stored event types
 * would orphan the card events already persisted in existing sessions, and
 * the names are session-local vocabulary with no namespace collision.
 */
export const ADVISOR_EVENT_TYPES = ["advisor/start", "advisor/delta", "advisor/message", "advisor/end", "advisor/followup"] as const;

export function ensureAdvisorEventTypes(): void {
  const known = KNOWN_SESSION_EVENT_TYPES as unknown as Set<string> | undefined;
  if (!known || typeof known !== "object" || typeof known.add !== "function" || Object.isFrozen(known)) {
    throw new Error("dsh-second-opinion: KNOWN_SESSION_EVENT_TYPES is not mutable. The plugin cannot register durable advisor events; please update it when DSH provides an official plugin-event registration API.");
  }
  for (const type of ADVISOR_EVENT_TYPES) known.add(type);
}

ensureAdvisorEventTypes();

export interface SessionLogLike {
  snapshotEvents?: () => Array<{ type?: string; data?: { turn?: number; step?: number } }>;
  append?: (type: string, data: unknown) => void;
  id?: string;
}

/**
 * Derive the latest turn/step coordinates from the durable log. The agent
 * loop logs turn/start and step/start before tool execution, so scanning
 * backwards gives the closest coordinates for card placement.
 */
export function latestTurnStep(log: SessionLogLike): { turn: number; step: number } {
  let events: Array<{ type?: string; data?: { turn?: number; step?: number } }> = [];
  try {
    events = log.snapshotEvents?.() ?? [];
  } catch {
    events = [];
  }
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i];
    if (event.type === "step/start") {
      return { turn: Number(event.data?.turn ?? 0), step: Number(event.data?.step ?? 0) };
    }
    if (event.type === "turn/start") {
      return { turn: Number(event.data?.turn ?? 0), step: 0 };
    }
  }
  return { turn: 0, step: 0 };
}

export function appendAdvisorStart(
  log: SessionLogLike,
  input: {
    consultId: string;
    question: string;
    context?: string;
    mode?: "inherited" | "standalone";
    chain: Array<{ label?: string; provider: string; model: string }>;
  },
): void {
  const { turn, step } = latestTurnStep(log);
  log.append?.("advisor/start", {
    consultId: input.consultId,
    turn,
    step,
    question: input.question,
    ...input.context === undefined ? {} : { context: input.context },
    ...input.mode === undefined ? {} : { mode: input.mode },
    chain: input.chain.map((entry) => ({
      label: entry.label ?? `${entry.provider}/${entry.model}`,
      provider: entry.provider,
      model: entry.model,
    })),
  });
}

/** One durable follow-up question inside an existing consultation thread. */
export function appendAdvisorFollowup(
  log: SessionLogLike,
  input: {
    consultId: string;
    round: number;
    followUp: string;
    provider: string;
    model: string;
  },
): void {
  const { turn, step } = latestTurnStep(log);
  log.append?.("advisor/followup", {
    consultId: input.consultId,
    turn,
    step,
    round: input.round,
    followUp: input.followUp,
    provider: input.provider,
    model: input.model,
  });
}

export function appendAdvisorDelta(
  log: SessionLogLike,
  input: {
    consultId: string;
    attemptIndex: number;
    round?: number;
    label: string;
    text?: string;
    thinking?: string;
  },
): void {
  const { turn, step } = latestTurnStep(log);
  log.append?.("advisor/delta", {
    consultId: input.consultId,
    turn,
    step,
    attemptIndex: input.attemptIndex,
    label: input.label,
    ...input.round === undefined ? {} : { round: input.round },
    ...input.text ? { contentDelta: input.text } : {},
    ...input.thinking ? { thinkingDelta: input.thinking } : {},
  });
}

export function appendAdvisorMessage(
  log: SessionLogLike,
  input: {
    consultId: string;
    attemptIndex: number;
    round?: number;
    label: string;
    provider: string;
    model: string;
    content: string;
    thinking?: string;
    truncated?: boolean;
  },
): void {
  const { turn, step } = latestTurnStep(log);
  log.append?.("advisor/message", {
    consultId: input.consultId,
    turn,
    step,
    attemptIndex: input.attemptIndex,
    label: input.label,
    provider: input.provider,
    model: input.model,
    content: input.content,
    ...input.round === undefined ? {} : { round: input.round },
    ...input.thinking ? { thinking: input.thinking } : {},
    ...input.truncated ? { truncated: true } : {},
  });
}

export interface AttemptSummary {
  label: string;
  ok: boolean;
  error?: string;
}

export function appendAdvisorEnd(
  log: SessionLogLike,
  input: {
    consultId: string;
    status: "done" | "failed";
    usedModel?: string;
    attempts: AttemptSummary[];
    truncated?: boolean;
  },
): void {
  const { turn, step } = latestTurnStep(log);
  log.append?.("advisor/end", {
    consultId: input.consultId,
    turn,
    step,
    status: input.status,
    ...input.usedModel ? { usedModel: input.usedModel } : {},
    attempts: input.attempts,
    ...input.truncated ? { truncated: true } : {},
  });
}
