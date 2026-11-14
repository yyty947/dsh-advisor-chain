import { randomUUID } from "node:crypto";
import { createUserMessage } from "@deepseek-ai/dsh-llm";
import { defineTool } from "@deepseek-ai/dsh-tools";
import type { ToolRunContext } from "@deepseek-ai/dsh-tools";
import { entryName, runAdvisorChain, AllEntriesFailedError, type ChainAttemptTarget, type StreamResult } from "./chain";
import { appendAdvisorDelta, appendAdvisorEnd, appendAdvisorFollowup, appendAdvisorMessage, appendAdvisorStart, type SessionLogLike } from "./events";
import { buildAdvisorUserPrompt, buildTranscript, type DerivedMessageLike } from "./transcript";
import { BLIND_REVIEW_MODIFIER, type AdvisorConfig, type ChainEntry } from "./config";
import { rebuildThread, threadCapacityError, threadToMessages, type ThreadEventLike } from "./threads";

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

interface ToolArgs {
  question?: string;
  context?: string;
  mode?: string;
  consult_id?: string;
  follow_up?: string;
  dual_opinions?: boolean;
}

interface CallEntry {
  provider: string;
  model: string;
  reasoningEffort?: "off" | "low" | "high" | "max";
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

const HINT_FOLLOWUP = (consultId: string) =>
  `\n\n（consult_id: ${consultId} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。）`;
const HINT_DUAL = "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）";

export function createSecondOpinionTool(deps: AdvisorAskDeps) {
  return defineTool({
    name: "second_opinion",
    description:
      "向配置的顾问模型链征求第二意见。默认自动继承当前会话的完整对话（不要在问题中复述背景）；支持追问（consult_id + follow_up）、盲审模式（mode=standalone，顾问不看对话只依据问题与背景独立判断）与双意见对比（dual_opinions，并行听取链上前两位顾问）。适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。",
    parameters: {
      question: {
        type: "string",
        description: "新咨询的问题，例如「方案 A 在 X 约束下是否成立」。与 consult_id 二选一：提供 consult_id 时改用 follow_up。",
      },
      context: {
        type: "string",
        description: "可选。仅补充对话记录中不存在的信息：你的私有推理意图、未说出口的约束、或来自更早被省略历史的要点。没有就省略。",
      },
      mode: {
        type: "string",
        description: "可选，按次覆盖默认咨询模式。inherited：继承完整对话（默认）；standalone：盲审——顾问不看对话，只依据问题与 context 独立判断，适合需要不受主对话思路影响的场景。",
      },
      consult_id: {
        type: "string",
        description: "可选。之前咨询结果返回的 consult_id；提供后进入追问模式，本次 follow_up 会由原顾问带着该线程上下文作答。",
      },
      follow_up: {
        type: "string",
        description: "追问内容；仅在提供 consult_id 时使用，例如「你提到的 X 展开讲讲」「如果换成 Y 会怎样」。",
      },
      dual_opinions: {
        type: "boolean",
        description: "可选。true 时并行咨询链上前两位顾问（互不可见对方；链上仅一个模型时，同一模型独立采样两次），返回两份独立意见；不支持追问。",
      },
    },
    output: {
      schema: {
        type: "object",
        additionalProperties: false,
        properties: {
          advice: { type: "string", required: true },
          model: { type: "string" },
          consultId: { type: "string" },
          dual: { type: "boolean" },
          truncated: { type: "boolean" },
        },
      },
      render: (_args: unknown, value: { advice: string; consultId?: string; dual?: boolean }) => [
        {
          type: "text",
          text:
            value.advice +
            (value.consultId
              ? HINT_FOLLOWUP(value.consultId)
              : value.dual
                ? HINT_DUAL
                : ""),
        },
      ],
    },
    async execute(args: ToolArgs, exec: ToolRunContext) {
      const cfg = deps.getConfig();
      const fail = (advice: string) => ({ advice, model: "", consultId: "", dual: false, truncated: false });
      if (!cfg.enabled) return fail("Second Opinion 当前已停用（设置中可开启）。");
      if (cfg.chain.length === 0) {
        return fail("顾问链尚未配置任何模型。请先到 设置 → Second Opinion 添加顾问模型。");
      }
      const sessionLog = sessionLogOf(exec);
      const mode: "inherited" | "standalone" =
        args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
      const system = mode === "standalone" ? `${cfg.advisorPrompt}\n\n${BLIND_REVIEW_MODIFIER}` : cfg.advisorPrompt;

      const failWithLog = (consultId: string, attempts: Array<{ label: string; ok: boolean; error?: string }>, advice: string) => {
        appendAdvisorEnd(sessionLog ?? {}, { consultId, status: "failed", attempts });
        return { advice, model: "", consultId: "", dual: false, truncated: false };
      };

      // ---------- follow-up branch ----------
      if (args.consult_id) {
        if (args.dual_opinions) return fail("双意见咨询不支持追问；请基于单一模型开新咨询。");
        if (typeof args.follow_up !== "string" || !args.follow_up.trim()) {
          return fail("追问需要提供 follow_up 参数（要继续追问的内容）。");
        }
        if (!sessionLog) return fail("当前会话不支持追问（无会话日志）。请开新咨询。");
        let events: ThreadEventLike[] = [];
        try {
          events = (sessionLog.snapshotEvents?.() ?? []) as unknown as ThreadEventLike[];
        } catch {
          events = [];
        }
        const thread = rebuildThread(events, args.consult_id);
        if (!thread) {
          return fail("未找到该 consult_id 对应的咨询记录（可能属于其他会话，或记录已不存在）。请开新咨询。");
        }
        const followUp = args.follow_up.trim();
        const capErr = threadCapacityError(thread, followUp.length);
        if (capErr) return fail(capErr);
        const provider = thread.usedProvider;
        const model = thread.usedModel;
        if (!provider || !model) return fail("该线程缺少可用的顾问模型记录，请开新咨询。");
        const followRound = thread.rounds + 1;
        const consultId = args.consult_id;
        appendAdvisorFollowup(sessionLog, { consultId, round: followRound, followUp, provider, model });
        try {
          const result = await streamOnce(deps, cfg, sessionLog, {
            consultId,
            entry: { provider, model },
            system,
            messages: threadToMessages(thread, followUp),
            attemptIndex: 0,
            round: followRound,
            label: `${provider}/${model}`,
            signal: exec.signal,
          });
          if (!result.content.trim()) {
            return failWithLog(consultId, [{ label: `${provider}/${model}`, ok: false, error: "空响应" }], `顾问本轮返回为空，请换个问法追问或开新咨询。`);
          }
          appendAdvisorMessage(sessionLog, {
            consultId,
            attemptIndex: 0,
            round: followRound,
            label: `${provider}/${model}`,
            provider,
            model,
            content: result.content,
            ...result.thinking ? { thinking: result.thinking } : {},
            ...result.truncated ? { truncated: true } : {},
          });
          appendAdvisorEnd(sessionLog, {
            consultId,
            status: "done",
            usedModel: `${provider}/${model}`,
            attempts: [{ label: `${provider}/${model}`, ok: true }],
            ...result.truncated ? { truncated: true } : {},
          });
          return {
            advice: result.content,
            model: `${provider}/${model}`,
            consultId,
            dual: false,
            truncated: result.truncated !== undefined,
          };
        } catch (error) {
          if (exec.signal?.aborted) throw error;
          return failWithLog(
            consultId,
            [{ label: `${provider}/${model}`, ok: false, error: error instanceof Error ? error.message : String(error) }],
            `追问调用失败：${error instanceof Error ? error.message : String(error)}。可开新咨询重试。`,
          );
        }
      }

      // ---------- new consultation: dual or single ----------
      if (typeof args.question !== "string" || !args.question.trim()) {
        return fail("缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。");
      }
      const question = args.question.trim();
      const consultId = randomUUID();
      const userPrompt =
        mode === "standalone"
          ? [question, ...args.context && args.context.trim() ? [args.context.trim()] : []].join("\n\n")
          : buildAdvisorUserPrompt({
              transcriptText: (() => {
                let history: DerivedMessageLike[] = [];
                try {
                  history = sessionLog?.deriveMessages?.() ?? [];
                } catch {
                  history = [];
                }
                return buildTranscript(history, {
                  maxChars: cfg.limits.transcriptMaxChars,
                  perEntryMaxChars: cfg.limits.perEntryMaxChars,
                }).text;
              })(),
              question,
              context: args.context,
            });

      if (args.dual_opinions) {
        // Two independent samples: the first two chain entries — or, when the
        // chain has a single model, the same model asked twice independently.
        const pair = cfg.chain.slice(0, 2);
        if (pair.length === 1) pair.push(pair[0]);
        appendAdvisorStart(sessionLog ?? {}, {
          consultId,
          question,
          ...args.context === undefined ? {} : { context: args.context },
          mode,
          chain: pair,
        });
        const settled = await Promise.allSettled(
          pair.map((entry, attemptIndex) =>
            streamOnce(deps, cfg, sessionLog, {
              consultId,
              entry,
              system,
              messages: [{ role: "user" as const, text: userPrompt }],
              attemptIndex,
              label: entryName(entry),
              signal: exec.signal,
            }),
          ),
        );
        const sections: string[] = [];
        const models: string[] = [];
        const attempts: Array<{ label: string; ok: boolean; error?: string }> = [];
        let anyTruncated = false;
        let anyContent = false;
        settled.forEach((outcome, i) => {
          const label = entryName(pair[i]);
          if (outcome.status === "fulfilled" && outcome.value.content.trim()) {
            anyContent = true;
            if (outcome.value.truncated) anyTruncated = true;
            models.push(`${pair[i].provider}/${pair[i].model}`);
            attempts.push({ label, ok: true });
            if (sessionLog) {
              appendAdvisorMessage(sessionLog, {
                consultId,
                attemptIndex: i,
                label,
                provider: pair[i].provider,
                model: pair[i].model,
                content: outcome.value.content,
                ...outcome.value.thinking ? { thinking: outcome.value.thinking } : {},
                ...outcome.value.truncated ? { truncated: true } : {},
              });
            }
            sections.push(`【意见一/二 · ${label}${outcome.value.truncated ? " · 已截断" : ""}】\n${outcome.value.content}`);
          } else {
            const reason =
              outcome.status === "rejected"
                ? outcome.reason instanceof Error
                  ? outcome.reason.message
                  : String(outcome.reason)
                : "空响应";
            attempts.push({ label, ok: false, error: reason });
            sections.push(`【意见一/二 · ${label}】本次未返回可用内容：${reason}`);
          }
        });
        appendAdvisorEnd(sessionLog ?? {}, {
          consultId,
          status: anyContent ? "done" : "failed",
          usedModel: models.join(" + "),
          attempts,
          ...anyTruncated ? { truncated: true } : {},
        });
        if (!anyContent) {
          return { advice: `双意见咨询全部失败：${attempts.filter((a) => !a.ok).map((a) => `${a.label}（${a.error}）`).join("；")}。请基于自己的判断继续。`, model: "", consultId, dual: true, truncated: false };
        }
        const failedNote = attempts.some((a) => !a.ok)
          ? `\n\n（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）`
          : "";
        return {
          advice: sections.join("\n\n———\n\n") + failedNote,
          model: models.join(" + "),
          consultId,
          dual: true,
          truncated: anyTruncated,
        };
      }

      // ---------- single new consultation (inherited chain) ----------
      appendAdvisorStart(sessionLog ?? {}, {
        consultId,
        question,
        ...args.context === undefined ? {} : { context: args.context },
        mode,
        chain: cfg.chain,
      });
      const attempts: Array<{ label: string; ok: boolean; error?: string }> = [];
      try {
        const outcome = await runAdvisorChain(
          cfg.chain,
          (entry: ChainEntry, signal: AbortSignal) =>
            streamOnce(deps, cfg, sessionLog, {
              consultId,
              entry,
              system,
              messages: [{ role: "user" as const, text: userPrompt }],
              attemptIndex: cfg.chain.indexOf(entry),
              label: entryName(entry),
              signal,
            }),
          {
            onFail: (_index, target, error) => {
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
          consultId,
          dual: false,
          truncated: outcome.result?.truncated !== undefined,
        };
      } catch (error) {
        if (error instanceof AllEntriesFailedError) {
          return failWithLog(
            consultId,
            attempts,
            `顾问链全部调用失败：${error.failures.map((f) => `${entryName(f.target)}（${f.error}）`).join("；")}。请基于自己的判断继续，或稍后重试。`,
          );
        }
        appendAdvisorEnd(sessionLog ?? {}, { consultId, status: "failed", attempts });
        throw error;
      }
    },
  });
}

/** One throttled, durable-streaming model call shared by every consult shape.
 *  Deltas batch into advisor/delta events (200ms), timeouts degrade into
 *  truncated results instead of throwing (caller signal still throws). */
async function streamOnce(
  deps: AdvisorAskDeps,
  cfg: AdvisorConfig,
  sessionLog: SessionLogLike | undefined,
  input: {
    consultId: string;
    entry: CallEntry;
    system: string;
    messages: Array<{ role: "user" | "assistant"; text: string }>;
    attemptIndex: number;
    round?: number;
    label: string;
    signal?: AbortSignal;
  },
): Promise<StreamResult> {
  const timeoutMs = input.entry.timeoutMs ?? cfg.limits.defaultTimeoutMs;
  const pair = timeoutSignalPair(timeoutMs, input.signal);
  const options: Record<string, unknown> = {
    provider: input.entry.provider,
    model: input.entry.model,
    system: input.system,
    messages: input.messages.map((m) =>
      m.role === "user"
        ? createUserMessage({ content: [{ type: "text", text: m.text }], source: { kind: "user" } })
        : { role: "assistant", content: [{ type: "text", text: m.text }], source: { kind: "assistant" } }),
    maxTokens: input.entry.maxTokens ?? 16384,
    signal: pair.signal,
    ...input.entry.reasoningEffort === undefined ? {} : { reasoningEffort: input.entry.reasoningEffort },
    ...input.entry.temperature === undefined ? {} : { temperature: input.entry.temperature },
  };
  let text = "";
  let thinking = "";
  let pendingText = "";
  let pendingThinking = "";
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  const flush = () => {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    if (!pendingText && !pendingThinking) return;
    if (sessionLog) {
      appendAdvisorDelta(sessionLog, {
        consultId: input.consultId,
        attemptIndex: input.attemptIndex,
        ...input.round === undefined ? {} : { round: input.round },
        label: input.label,
        ...pendingText ? { text: pendingText } : {},
        ...pendingThinking ? { thinking: pendingThinking } : {},
      });
    }
    pendingText = "";
    pendingThinking = "";
  };
  try {
    for await (const chunk of deps.ctx.llm.stream(options)) {
      if (chunk.type === "text-delta" && typeof chunk.text === "string") {
        text += chunk.text;
        pendingText += chunk.text;
      } else if (chunk.type === "reasoning-delta" && typeof chunk.text === "string") {
        thinking += chunk.text;
        pendingThinking += chunk.text;
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
  if (input.signal?.aborted) throw new DOMException("Aborted", "AbortError");
  return { content: text, thinking };
}
