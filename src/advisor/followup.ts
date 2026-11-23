import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SessionEvent } from "@deepseek-ai/dsh-session";
import type { SessionId } from "@deepseek-ai/dsh-session";
import { finalAssistantOutput, foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { ADVISOR_LABEL_PREFIX, type AdvisorRegistry } from "./identify";
import { contentText } from "./observe";
import { buildFollowUpMessage } from "./preamble";
import { classifySubagentError, settleOutcome, waitWithTimeout, type AbortReason, type AdvisorOutcome, type TimeoutPolicy } from "./result";
import type { Refusal } from "./start";
import type { ChildObservation } from "./observe";
import type { HostServices } from "./types";

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

function eventsOf(host: HostServices, childId: string): { events: readonly EventLike[]; live: boolean } | undefined {
  const live = host.agents.get(childId as SessionId);
  if (live) {
    try {
      return { events: live.session.snapshotEvents() as readonly EventLike[], live: true };
    } catch {
      return undefined;
    }
  }
  return undefined;
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
}

export type FollowupBegin =
  | { ok: true; childId: string; round: number; gate: { minEpoch: number; minTurnEnds: number }; fromSeq: number }
  | Refusal;

/** Validate the thread, count rounds, deliver the follow-up to the existing advisor child. */
export async function beginFollowUp(host: HostServices, registry: AdvisorRegistry, input: FollowupInput): Promise<FollowupBegin> {
  const childId = input.consultId;
  const live = eventsOf(host, childId);
  const events = live?.events ?? (await coldEvents(host, childId));
  if (!events) {
    return {
      ok: false,
      kind: "other",
      message: "未找到该 consult_id 对应的咨询记录（可能属于旧版本、其他会话，或记录已不存在）。请开新咨询。",
    };
  }
  const facts = threadFactsFromEvents(events);
  if (!facts || typeof facts.label !== "string" || !facts.label.startsWith(ADVISOR_LABEL_PREFIX)) {
    return {
      ok: false,
      kind: "other",
      message: "该 consult_id 不是本插件建立的咨询线程（旧版本的 consult_id 不再支持）。请开新咨询。",
    };
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
    return { ok: false, kind: "other", message: "顾问仍在回答，请等它完成后再追问。" };
  }
  if (record.dual) {
    return { ok: false, kind: "other", message: "双意见咨询不支持追问；请基于单一模型开新咨询。" };
  }
  const round = facts.followUps + 1;
  if (round > input.maxRounds) {
    return { ok: false, kind: "other", message: `该咨询线程已达 ${input.maxRounds} 轮追问上限，请开新咨询。` };
  }
  const gate =
    live && observation
      ? { minEpoch: record.epoch, minTurnEnds: observation.turnEnds + 1 }
      : { minEpoch: record.epoch + 1, minTurnEnds: 1 };

  try {
    await host.subagents.sendMessage(input.parent, childId as SessionId, [{ type: "text", text: buildFollowUpMessage(input.followUp, round) }], {
      signal: input.signal,
    });
  } catch (error) {
    const classified = classifySubagentError(error);
    if (classified.code === "UNAUTHORIZED") {
      return { ok: false, kind: "authorization", message: "该咨询属于另一个会话（会话被 fork 后旧线程不在当前子代理树中），无法追问。请开新咨询。" };
    }
    return { ok: false, kind: classified.kind, message: `追问发送失败：${classified.message}` };
  }
  return { ok: true, childId, round, gate, fromSeq: events.length };
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
  const { childId } = begin;
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
      await waitWithTimeout({
        run: turnDone,
        observation: () => registry.observation(childId),
        policy,
        abort: interrupt,
        signal,
      })
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
      text = contentText(finalAssistantOutput(live.session.snapshotEvents().slice(begin.fromSeq)));
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
    onTurnEnd: () => () => {},
    ended: true,
    dispose: () => {},
  };
  const outcome = settleOutcome({ observation: obs, abortedBy });
  // A warm follow-up ends its turn without a `subagent/end` record, so no
  // stop reason exists; a turn that ended on its own with answer text is a
  // success.
  if (!abortedBy && text && !outcome.ok) return { ...outcome, ok: true, content: text, failure: undefined };
  return outcome;
}
