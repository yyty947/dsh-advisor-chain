import type { Agent } from "@deepseek-ai/dsh-agent";
import { foldSubagentDescriptor, delegationDepthOf } from "@deepseek-ai/dsh-subagent";
import type { SubagentRunEndInfo, SubagentRunInfo } from "@deepseek-ai/dsh-subagent";
import { attachObservation, type ChildObservation } from "./observe";
import type { SessionEventLog } from "./eventlog";
import { noopLogger, type HostServices, type Logger, type SandboxControls } from "./types";

/**
 * Advisor children are recognized by the durable label the manager writes
 * into each child's `subagent/descriptor` event during setup — which lands
 * before `subagent/start` fires. The label prefix is the contract; an
 * in-flight start counter is only a fallback for a child whose descriptor
 * cannot be read yet.
 */
export const ADVISOR_LABEL_PREFIX = "second-opinion:";

export function advisorLabel(entryLabel: string): string {
  return `${ADVISOR_LABEL_PREFIX}${entryLabel}`;
}

export type SandboxState = "unknown" | "read-only" | "failed";

export interface AdvisorChildRecord {
  readonly childId: string;
  readonly parentSessionId: string;
  consultId: string;
  readonly label: string;
  provider: string;
  model: string;
  /** Set when the child was one half of a dual consultation (not follow-up-able). */
  dual?: boolean;
  readonly createdAt: number;
  /** Activation epochs seen for this child (initial start + each cold resume). */
  epoch: number;
  sandbox: SandboxState;
  observation?: ChildObservation;
}

/** Records kept in memory; older ones stay reachable through the durable log. */
const MAX_RECORDS = 64;

export interface RegistryDeps {
  host: HostServices;
  sandbox: SandboxControls;
  log?: Logger;
  /** Depth of an agent in its subagent tree; the real one reads session meta. */
  depthOf?: (agent: Agent) => number;
  /** Descriptor reader; the real one folds the child's own log. */
  descriptorOf?: (child: Agent) => { label?: string } | undefined;
  /** Live session-log tracker fed by `session/event`; preferred over the deprecated `snapshotEvents()`. */
  events?: SessionEventLog;
  now?: () => number;
}

interface TurnWaiter {
  childId: string;
  minEpoch: number;
  minTurnEnds: number;
  resolve: () => void;
  reject: (error: unknown) => void;
  signal?: AbortSignal;
}

export class AdvisorRegistry {
  private readonly records = new Map<string, AdvisorChildRecord>();
  private readonly pendingParents = new Map<string, number>();
  private readonly turnWaiters: TurnWaiter[] = [];
  private readonly host: HostServices;
  private readonly sandbox: SandboxControls;
  private readonly log: Logger;
  readonly depthOf: (agent: Agent) => number;
  private readonly descriptorOf: (child: Agent) => { label?: string } | undefined;
  readonly events: SessionEventLog | undefined;
  private readonly now: () => number;

  constructor(deps: RegistryDeps) {
    this.host = deps.host;
    this.sandbox = deps.sandbox;
    this.log = deps.log ?? noopLogger;
    this.depthOf = deps.depthOf ?? defaultDepthOf;
    this.events = deps.events;
    this.descriptorOf = deps.descriptorOf ?? ((child) => this.events?.descriptorOf(String(child.id)) ?? defaultDescriptorOf(child));
    this.now = deps.now ?? Date.now;
  }

  /** Register the `subagent/start` / `subagent/end` listeners; returns a disposer. */
  install(): () => void {
    const offStart = this.host.on("subagent/start", (info) => this.onStart(info));
    const offEnd = this.host.on("subagent/end", (info) => this.onEnd(info));
    return () => {
      offStart();
      offEnd();
    };
  }

  /** Announce an in-flight start so a child without a readable descriptor is still recognized. */
  notePendingStart(parentSessionId: string): void {
    this.pendingParents.set(parentSessionId, (this.pendingParents.get(parentSessionId) ?? 0) + 1);
  }

  clearPendingStart(parentSessionId: string): void {
    const left = (this.pendingParents.get(parentSessionId) ?? 1) - 1;
    if (left <= 0) this.pendingParents.delete(parentSessionId);
    else this.pendingParents.set(parentSessionId, left);
  }

  isAdvisor(childId: string): boolean {
    return this.records.has(childId);
  }

  get(childId: string): AdvisorChildRecord | undefined {
    return this.records.get(childId);
  }

  observation(childId: string): ChildObservation | undefined {
    return this.records.get(childId)?.observation;
  }

  /** Create the record for a child we started, or fill in what `onStart` could not know. */
  record(input: { childId: string; parentSessionId: string; consultId: string; label: string; provider: string; model: string; dual?: boolean }): AdvisorChildRecord {
    const existing = this.records.get(input.childId);
    if (existing) {
      if (!existing.consultId) existing.consultId = input.consultId;
      if (!existing.provider) existing.provider = input.provider;
      if (!existing.model) existing.model = input.model;
      if (input.dual) existing.dual = true;
      this.records.delete(input.childId);
      this.records.set(input.childId, existing);
      return existing;
    }
    const record: AdvisorChildRecord = { ...input, createdAt: this.now(), epoch: 0, sandbox: "unknown" };
    this.records.set(input.childId, record);
    // Bound memory: the oldest records are evicted; their threads remain
    // readable through the durable child log (cold follow-up path).
    while (this.records.size > MAX_RECORDS) {
      const oldest = this.records.keys().next().value;
      if (oldest === undefined) break;
      const evicted = this.records.get(oldest);
      evicted?.observation?.dispose();
      this.records.delete(oldest);
    }
    return record;
  }

  /** Whether an advisor child currently has a live Agent (warm) or must be cold-resumed. */
  isLive(childId: string): boolean {
    return this.host.agents.get(childId as never) !== undefined;
  }

  /**
   * Resolve once the child has ended a turn at or after the given epoch and
   * turn count. Warm follow-ups keep the epoch and add a turn; a cold resume
   * starts a new epoch whose observation counts turns from zero.
   */
  waitForTurnEnd(childId: string, gate: { minEpoch: number; minTurnEnds: number }, signal?: AbortSignal): Promise<void> {
    if (this.turnGateOpen(childId, gate)) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const waiter: TurnWaiter = { childId, ...gate, resolve, reject, signal };
      this.turnWaiters.push(waiter);
      signal?.addEventListener(
        "abort",
        () => {
          const i = this.turnWaiters.indexOf(waiter);
          if (i >= 0) this.turnWaiters.splice(i, 1);
          reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        },
        { once: true },
      );
    });
  }

  private turnGateOpen(childId: string, gate: { minEpoch: number; minTurnEnds: number }): boolean {
    const record = this.records.get(childId);
    if (!record || record.epoch < gate.minEpoch) return false;
    return (record.observation?.turnEnds ?? 0) >= gate.minTurnEnds;
  }

  private settleTurnWaiters(childId: string): void {
    for (const waiter of [...this.turnWaiters]) {
      if (waiter.childId !== childId) continue;
      if (!this.turnGateOpen(childId, waiter)) continue;
      this.turnWaiters.splice(this.turnWaiters.indexOf(waiter), 1);
      waiter.resolve();
    }
  }

  /** `subagent/start`: recognize our child, confine it to the read-only sandbox, observe it. */
  onStart(info: SubagentRunInfo): void {
    if (!info.local) return;
    const child = this.host.agents.get(info.id);
    if (!child) return;
    const descriptor = this.descriptorOf(child);
    const childId = String(info.id);
    const parentSessionId = String(info.parentSessionId);
    const known = this.records.has(childId);
    const byLabel = typeof descriptor?.label === "string" && descriptor.label.startsWith(ADVISOR_LABEL_PREFIX);
    const byPending = !descriptor && (this.pendingParents.get(parentSessionId) ?? 0) > 0;
    if (!known && !byLabel && !byPending) return;
    if (!byLabel && !known) this.log(`advisor: child ${childId} recognized without a descriptor (pending-start fallback)`);

    const record =
      this.records.get(childId) ??
      this.record({ childId, parentSessionId, consultId: "", label: descriptor?.label ?? ADVISOR_LABEL_PREFIX, provider: "", model: "" });
    record.observation?.dispose();
    record.observation = attachObservation(child, this.now);
    record.observation.onTurnEnd(() => this.settleTurnWaiters(childId));
    record.epoch += 1;

    try {
      this.sandbox.setSandboxMode(child.session, "read-only");
      // Verify against the log, not the projection: the projection folds
      // asynchronously and may still report the delegated mode right after
      // the append. Tool layers resolve the mode per call, so by the child's
      // first tool call the projection has caught up with the logged event.
      // The tracked event stream is the log; `snapshotEvents()` is only a
      // fallback for a tracker that has not seen this session.
      const logged = this.sandbox.lastModeOf?.(child.session) ?? this.events?.lastModeOf(childId) ?? lastLoggedModeOf(child.session);
      const mode = logged !== undefined ? logged : this.sandbox.overrideOf(child.session);
      record.sandbox = mode === undefined ? "unknown" : mode === "read-only" ? "read-only" : "failed";
      if (record.sandbox === "failed") this.log(`advisor: child ${childId} sandbox is "${mode}" after requesting read-only`);
    } catch (error) {
      record.sandbox = "failed";
      this.log(`advisor: could not confine child ${childId} to read-only: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /** `subagent/end`: mark the epoch ended and release waiters whose gate is open. */
  onEnd(info: SubagentRunEndInfo): void {
    const childId = String(info.id);
    const record = this.records.get(childId);
    if (!record?.observation) return;
    record.observation.ended = true;
    record.observation.endInfo = info;
    // A run that ends without a committed turn/end still releases waiters of this epoch.
    for (const waiter of [...this.turnWaiters]) {
      if (waiter.childId !== childId || record.epoch < waiter.minEpoch) continue;
      if (waiter.minTurnEnds === 0) {
        this.turnWaiters.splice(this.turnWaiters.indexOf(waiter), 1);
        waiter.resolve();
      }
    }
  }
}

function defaultDepthOf(agent: Agent): number {
  try {
    const depth = delegationDepthOf(agent);
    return Number.isSafeInteger(depth) && depth >= 0 ? depth : 0;
  } catch {
    return 0;
  }
}

function defaultDescriptorOf(child: Agent): { label?: string } | undefined {
  const session = child.session as { snapshotEvents?: () => readonly unknown[] } | undefined;
  if (typeof session?.snapshotEvents !== "function") return undefined;
  try {
    return foldSubagentDescriptor(session.snapshotEvents!() as never);
  } catch {
    return undefined;
  }
}

/** Mode of the last `sandbox/mode` event in the session log, if the session still offers `snapshotEvents()`. */
export function lastLoggedModeOf(session: { snapshotEvents?: () => readonly unknown[] } | undefined): string | undefined {
  if (!session || typeof session.snapshotEvents !== "function") return undefined;
  try {
    const events = session.snapshotEvents() as Array<{ type?: string; data?: { mode?: unknown } }>;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i];
      if (event?.type === "sandbox/mode") {
        return typeof event.data?.mode === "string" ? event.data.mode : undefined;
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}
