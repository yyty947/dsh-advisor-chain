import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEvent, SessionId } from "@deepseek-ai/dsh-session";
import { finalAssistantOutput, foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { ADVISOR_LABEL_PREFIX, type AdvisorRegistry } from "./identify";
import type { SessionEventLog } from "./eventlog";
import { contentText, emptyUsage, type ChildObservation } from "./observe";
import { buildFollowUpMessage } from "./preamble";
import { classifySubagentError, settleOutcome, waitWithTimeout, type AbortReason, type AdvisorOutcome, type TimeoutPolicy } from "./result";
import type { Refusal } from "./start";
import type { HostServices } from "./types";
import { t, type Lang } from "../i18n";

/** What the child's own durable log says about the consultation thread. */
export interface ThreadFacts {
  label?: string;
  provider?: string;
  model?: string;
  /** Follow-up rounds already answered (the initial prompt is not one). */
  followUps: number;
}

type EventLike = { type?: string; data?: unknown };

export function threadFactsFromEvents(events: readonly EventLike[]): ThreadFacts | undefined {
  let descriptor: ReturnType<typeof foldSubagentDescriptor>;
  try {
    descriptor = foldSubagentDescriptor(events as readonly SessionEvent[]);
  } catch {
    return undefined;
  }
  if (!descriptor) return undefined;
  const userMessages = events.filter((e) => e.type === "user/message").length;
  return {
    label: descriptor.label,
    provider: "agentProvider" in descriptor ? descriptor.agentProvider : undefined,
    model: "agentModel" in descriptor ? descriptor.agentModel : undefined,
    followUps: Math.max(0, userMessages - 1),
  };
}

interface SessionQueryLike {
  readSession(id: string): Promise<{ events: readonly unknown[] }>;
}

/** The child's log for a live child: the tracker's copy when it is complete, else the deprecated `snapshotEvents()` while it exists. */
function eventsOf(host: HostServices, events: SessionEventLog | undefined, childId: string): { events: readonly EventLike[]; live: boolean } | undefined {
  const live = host.agents.get(childId as SessionId);
  if (!live) return undefined;
  if (events?.has(childId) && events.isComplete(childId)) return { events: events.eventsOf(childId) as readonly EventLike[], live: true };
  const session = live.session as { snapshotEvents?: () => readonly unknown[] };
  if (typeof session.snapshotEvents !== "function") {
    return events?.has(childId) ? { events: events.eventsOf(childId) as readonly EventLike[], live: true } : undefined;
  }
  try {
    return { events: session.snapshotEvents() as readonly EventLike[], live: true };
  } catch {
    return undefined;
  }
}

async function coldEvents(host: HostServices, childId: string): Promise<readonly EventLike[] | undefined> {
  const query = host.optional<SessionQueryLike>("sessionQuery");
  if (!query || typeof query.readSession !== "function") return undefined;
  try {
    const snapshot = await query.readSession(childId);
    return snapshot.events as readonly EventLike[];
  } catch {
    return undefined;
  }
}

export interface FollowupInput {
  parent: Agent;
  signal: AbortSignal;
  consultId: string;
  followUp: string;
  maxRounds: number;
  lang?: Lang;
}

export type FollowupBegin =
  | { ok: true; childId: string; round: number; gate: { minEpoch: number; minTurnEnds: number }; fromSeq: number; lang: Lang }
  | Refusal;

/** Validate the thread, count rounds, deliver the follow-up to the existing advisor child. */
export async function beginFollowUp(host: HostServices, registry: AdvisorRegistry, input: FollowupInput): Promise<FollowupBegin> {
  const childId = input.consultId;
  const lang = input.lang ?? "zh";
  const live = eventsOf(host, registry.events, childId);
  const events = live?.events ?? (await coldEvents(host, childId));
  if (!events) return { ok: false, kind: "other", message: t(lang, "followup.notFound") };
  const facts = threadFactsFromEvents(events);
  if (!facts || typeof facts.label !== "string" || !facts.label.startsWith(ADVISOR_LABEL_PREFIX)) {
    return { ok: false, kind: "other", message: t(lang, "followup.foreign") };
  }
  let record = registry.get(childId);
  if (!record) {
    record = registry.record({
      childId,
      parentSessionId: String(input.parent.id),
      consultId: childId,
      label: facts.label,
      provider: facts.provider ?? "",
      model: facts.model ?? "",
    });
  }
  const observation = registry.observation(childId);
  const liveAgent = live ? host.agents.get(childId as SessionId) : undefined;
  // A running child would fold the follow-up into its current turn as steering;
  // wait for it to go idle instead (warm follow-ups are rare — the host
  // usually settles an idle child's activation right after its answer).
  if (liveAgent && (liveAgent.status !== "idle" || (observation && observation.turnEnds === 0 && !observation.ended))) {
    return { ok: false, kind: "other", message: t(lang, "followup.busy") };
  }
  if (record.dual) return { ok: false, kind: "other", message: t(lang, "followup.dualNoFollowUp") };
  const round = facts.followUps + 1;
  if (round > input.maxRounds) return { ok: false, kind: "other", message: t(lang, "followup.roundCap", { max: input.maxRounds }) };
  const gate =
    live && observation
      ? { minEpoch: record.epoch, minTurnEnds: observation.turnEnds + 1 }
      : { minEpoch: record.epoch + 1, minTurnEnds: 1 };

  try {
    await host.subagents.sendMessage(
      input.parent,
      childId as SessionId,
      [{ type: "text", text: buildFollowUpMessage(input.followUp, round, lang) }],
      { signal: input.signal },
    );
  } catch (error) {
    const classified = classifySubagentError(error);
    if (classified.code === "UNAUTHORIZED") return { ok: false, kind: "authorization", message: t(lang, "followup.otherTree") };
    return { ok: false, kind: classified.kind, message: t(lang, "followup.sendFailed", { message: classified.message }) };
  }
  return { ok: true, childId, round, gate, fromSeq: events.length, lang };
}

/** Wait for the follow-up turn under the timeout rule and read the child's answer. */
export async function finishFollowUp(
  host: HostServices,
  registry: AdvisorRegistry,
  begin: Extract<FollowupBegin, { ok: true }>,
  policy: TimeoutPolicy,
  parent: Agent,
  signal: AbortSignal,
): Promise<AdvisorOutcome> {
  const { childId, lang } = begin;
  const turnDone = registry.waitForTurnEnd(childId, begin.gate, signal);
  const interrupt = () => {
    try {
      host.subagents.interrupt(childId as SessionId, { kind: "ancestor", agent: parent });
    } catch {
      // Interruption is best-effort; the bounded settle wait in waitWithTimeout covers a child that ignores it.
    }
  };
  const onAbort = () => interrupt();
  signal.addEventListener("abort", onAbort, { once: true });
  let abortedBy: AbortReason | undefined;
  try {
    abortedBy = (
      await waitWithTimeout({ run: turnDone, observation: () => registry.observation(childId), policy, abort: interrupt, signal, lang })
    ).abortedBy;
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
  // The child is live again after the turn; read the answer from its own log.
  const observation = registry.observation(childId);
  const live = host.agents.get(childId as SessionId);
  let text = "";
  if (live) {
    try {
      const since = registry.events?.has(childId) ? registry.events.since(childId, begin.fromSeq) : undefined;
      const session = live.session as { snapshotEvents?: () => readonly unknown[] };
      const tail = since && since.length > 0 ? since : session.snapshotEvents ? (session.snapshotEvents().slice(begin.fromSeq) as readonly EventLike[]) : [];
      text = contentText(finalAssistantOutput(tail as never));
    } catch {
      text = "";
    }
  } else if (observation?.endInfo) {
    text = contentText(observation.endInfo.lastAssistantMessage);
  }
  const obs: ChildObservation = observation ?? {
    childId,
    failures: [],
    answerTextStarted: false,
    lastAnswerTextAt: 0,
    text,
    toolCalls: 0,
    turnEnds: 0,
    usage: emptyUsage(),
    onTurnEnd: () => () => {},
    ended: true,
    dispose: () => {},
  };
  const outcome = settleOutcome({ observation: obs, abortedBy, lang });
  // A warm follow-up ends its turn without a `subagent/end` record, so no
  // stop reason exists; a turn that ended on its own with answer text is a
  // success.
  if (!abortedBy && text && !outcome.ok) return { ...outcome, ok: true, content: text, failure: undefined };
  return outcome;
}
