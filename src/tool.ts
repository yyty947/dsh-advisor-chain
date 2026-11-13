import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { entryName, runAdvisorChain, AllEntriesFailedError, type ChainAttemptTarget, type StreamResult } from "./chain";
import { appendAdvisorDelta, appendAdvisorEnd, appendAdvisorMessage, appendAdvisorStart, type SessionLogLike } from "./events";
import { buildAdvisorUserPrompt, buildTranscript, type DerivedMessageLike } from "./transcript";
import type { AdvisorConfig, ChainEntry } from "./config";

/** Combine an optional caller signal with a hard timeout; the pair keeps the
 *  timeout signal reachable so an aborted stream can be classified:
 *  timeout fired → graceful truncation; caller signal → cancellation. */
function timeoutSignalPair(ms: number, signal?: AbortSignal) {
  const timeout = AbortSignal.timeout(ms);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    isTimeout: () => timeout.aborted,
  };
}

interface ToolExecSession extends SessionLogLike {
  deriveMessages?: () => DerivedMessageLike[];
}

function sessionLogOf(exec: ToolRunContext): ToolExecSession | undefined {
  const agent = (exec as unknown as { agent?: { session?: unknown } }).agent;
  const session = (agent as { session?: unknown } | undefined)?.session;
  return (session as ToolExecSession | undefined) ?? undefined;
}

export interface AdvisorAskDeps {
  ctx: {
    llm: {
      stream: (options: Record<string, unknown>) => AsyncIterable<{ type: string; text?: string }>;
    };
  };
  getConfig: () => AdvisorConfig;
}

export function createAdvisorAskTool(deps: AdvisorAskDeps) {
  return defineTool({
    name: "advisor_ask",
    description:
      "向配置的顾问模型征求第二意见。顾问会自动看到当前会话的完整对话记录，不要在问题中复述对话已有的内容。适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。返回顾问的回答文本。",
    parameters: {
      question: {
        type: "string",
        description: "要征求第二意见的具体问题，例如「方案 A 在 X 约束下是否成立」。无需包含对话已有的背景。",
      },
      context: {
        type: "string",
        description: "可选。仅补充对话记录中不存在的信息：你的私有推理意图、未说出口的约束、或来自更早被省略历史的要点。没有就省略。",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          advice: { type: "string", required: true },
          model: { type: "string" },
          truncated: { type: "boolean" },
        },
      },
      render: (_args: unknown, value: { advice: string }) => [{ type: "text", text: value.advice }],
    },
    async execute(args: { question?: string; context?: string }, exec: ToolRunContext) {
      const cfg = deps.getConfig();
      if (typeof args.question !== "string" || !args.question.trim()) {
        return { advice: "缺少 question 参数：请提供要征求第二意见的具体问题。", model: "", truncated: false };
      }
      if (!cfg.enabled) {
        return { advice: "顾问插件当前已停用（设置中可开启）。", model: "", truncated: false };
      }
      if (cfg.chain.length === 0) {
        return { advice: "顾问链尚未配置任何模型。请先到 设置 → 插件 → Advisor 添加顾问模型。", model: "", truncated: false };
      }
      const sessionLog = sessionLogOf(exec);
      let history: DerivedMessageLike[] = [];
      try {
        history = sessionLog?.deriveMessages?.() ?? [];
      } catch {
        history = [];
      }
      const transcript = buildTranscript(history, {
        maxChars: cfg.limits.transcriptMaxChars,
        perEntryMaxChars: cfg.limits.perEntryMaxChars,
      });
      const userPrompt = buildAdvisorUserPrompt({
        transcriptText: transcript.text,
        question: args.question.trim(),
        context: args.context,
      });
      const consultId = randomUUID();
      appendAdvisorStart(sessionLog ?? {}, {
        consultId,
        question: args.question.trim(),
        ...args.context === undefined ? {} : { context: args.context },
        chain: cfg.chain,
      });

      // Throttled durable delta events (200ms batch), advisor-group pattern.
      let pendingText = "";
      let pendingThinking = "";
      let flushTimer: ReturnType<typeof setTimeout> | null = null;
      let currentAttempt = 0;
      const flush = () => {
        if (flushTimer) {
          clearTimeout(flushTimer);
          flushTimer = null;
        }
        if (!pendingText && !pendingThinking) return;
        if (sessionLog) {
          appendAdvisorDelta(sessionLog, {
            consultId,
            attemptIndex: currentAttempt,
            label: entryName(cfg.chain[currentAttempt] as ChainAttemptTarget),
            ...pendingText ? { text: pendingText } : {},
            ...pendingThinking ? { thinking: pendingThinking } : {},
          });
        }
        pendingText = "";
        pendingThinking = "";
      };
      const emitDelta = (delta: { text?: string; thinking?: string }) => {
        if (delta.text) pendingText += delta.text;
        if (delta.thinking) pendingThinking += delta.thinking;
        if (!flushTimer) flushTimer = setTimeout(flush, 200);
      };

      const attempts: Array<{ label: string; ok: boolean; error?: string }> = [];
      try {
        const callOne = async (entry: ChainEntry, signal: AbortSignal): Promise<StreamResult> => {
          const timeoutMs = entry.timeoutMs ?? cfg.limits.defaultTimeoutMs;
          const pair = timeoutSignalPair(timeoutMs, signal);
          const options: Record<string, unknown> = {
            provider: entry.provider,
            model: entry.model,
            system: cfg.advisorPrompt,
            messages: [
              createUserMessage({
                content: [{ type: "text", text: userPrompt }],
                source: { kind: "user" },
              }),
            ],
            maxTokens: entry.maxTokens ?? 16384,
            signal: pair.signal,
            ...entry.reasoningEffort === undefined ? {} : { reasoningEffort: entry.reasoningEffort },
            ...entry.temperature === undefined ? {} : { temperature: entry.temperature },
          };
          let text = "";
          let thinking = "";
          try {
            for await (const chunk of deps.ctx.llm.stream(options)) {
              if (chunk.type === "text-delta" && typeof chunk.text === "string") {
                text += chunk.text;
                emitDelta({ text: chunk.text });
              } else if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
                thinking += chunk.text;
                emitDelta({ thinking: chunk.text });
              }
            }
          } catch (error) {
            flush();
            if (pair.isTimeout()) {
              return { content: text, thinking, truncated: { reason: "timeout", atMs: Date.now() } };
            }
            throw error;
          }
          flush();
          if (pair.isTimeout()) {
            return { content: text, thinking, truncated: { reason: "timeout", atMs: Date.now() } };
          }
          if (signal.aborted) throw new DOMException("Aborted", "AbortError");
          return { content: text, thinking };
        };

        const outcome = await runAdvisorChain(
          cfg.chain,
          callOne,
          {
            onAttempt: (index) => {
              flush();
              currentAttempt = index;
            },
            onFail: (index, target, error) => {
              attempts.push({ label: entryName(target), ok: false, error });
            },
            onDone: (index, target, result) => {
              attempts.push({ label: entryName(target), ok: true });
              if (sessionLog) {
                appendAdvisorMessage(sessionLog, {
                  consultId,
                  attemptIndex: index,
                  label: entryName(target),
                  provider: target.provider,
                  model: target.model,
                  content: result.content,
                  ...result.thinking ? { thinking: result.thinking } : {},
                  ...result.truncated ? { truncated: true } : {},
                });
              }
            },
          },
          exec.signal,
        );
        appendAdvisorEnd(sessionLog ?? {}, {
          consultId,
          status: "done",
          usedModel: `${outcome.winner!.provider}/${outcome.winner!.model}`,
          attempts,
          ...outcome.result?.truncated ? { truncated: true } : {},
        });
        return {
          advice: outcome.result!.content,
          model: `${outcome.winner!.provider}/${outcome.winner!.model}`,
          truncated: outcome.result?.truncated !== undefined,
        };
      } catch (error) {
        flush();
        if (error instanceof AllEntriesFailedError) {
          appendAdvisorEnd(sessionLog ?? {}, {
            consultId,
            status: "failed",
            attempts,
          });
          return {
            advice: `顾问链全部调用失败：${error.failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}。请基于自己的判断继续，或稍后重试。`,
            model: "",
            truncated: false,
          };
        }
        appendAdvisorEnd(sessionLog ?? {}, {
          consultId,
          status: "failed",
          attempts,
        });
        throw error;
      }
    },
  });
}
