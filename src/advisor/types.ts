import type { Agent } from "@deepseek-ai/dsh-agent";
import type { ContentBlock, LlmFailure, LlmResolvedModelInfo, MessageId } from "@deepseek-ai/dsh-llm";
import type { SessionId } from "@deepseek-ai/dsh-session";
import type { SubagentActivation, SubagentActivationSpec, SubagentRunEndInfo, SubagentRunInfo } from "@deepseek-ai/dsh-subagent";

/**
 * The narrow host surface the advisor engine needs. Production code adapts
 * the Cordis context to this shape; tests pass fakes.
 */
export interface SubagentsLike {
  startActivation(spec: SubagentActivationSpec): Promise<SubagentActivation>;
  sendMessage(sender: Agent, targetId: SessionId, content: ContentBlock[], options: { signal: AbortSignal }): Promise<MessageId>;
  interrupt(targetSessionId: SessionId, authority: { kind: "ancestor"; agent: Agent }): void;
}

export interface HostServices {
  subagents: SubagentsLike;
  agents: { get(id: SessionId): Agent | undefined };
  llm: { resolveModelInfo(provider: string, model: string): Promise<LlmResolvedModelInfo> };
  /** Optional host service (`ctx.get`); undefined when the host lacks it. */
  optional<T>(name: string): T | undefined;
  /** Diagnostic sink; absent in tests unless provided. */
  log?: (message: string) => void;
  on(name: "subagent/start", listener: (info: SubagentRunInfo) => void): () => void;
  on(name: "subagent/end", listener: (info: SubagentRunEndInfo) => void): () => void;
}

/** Read-only sandbox controls, injectable so tests never touch a real Session. */
export interface SandboxControls {
  setSandboxMode(session: unknown, mode: "read-only"): void;
  /** The deployment's PROJECTION of the session override. Eventually consistent:
   *  right after an append it may still report the previous mode. */
  overrideOf(session: unknown): string | undefined;
  /** Authoritative: the mode recorded by the LAST `sandbox/mode` event in the
   *  session log. The log is the source of truth the projection folds from. */
  lastModeOf?(session: unknown): string | undefined;
}

export interface Logger {
  (message: string): void;
}

export const noopLogger: Logger = () => {};
