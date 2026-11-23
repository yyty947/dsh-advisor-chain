import { defineTool, type ToolOutputDefinition, type ToolRunContext } from "@deepseek-ai/dsh-tools";
import type { Agent } from "@deepseek-ai/dsh-agent";
import type { SubagentActivation } from "@deepseek-ai/dsh-subagent";
import { foldSubagentDescriptor } from "@deepseek-ai/dsh-subagent";
import { buildTranscript } from "./transcript";
import type { AdvisorConfig, ChainEntry } from "./config";
import { entryName } from "./chain";
import { ADVISOR_LABEL_PREFIX, type AdvisorRegistry } from "./advisor/identify";
import { buildAdvisorPrompt } from "./advisor/preamble";
import { startAdvisor, type Refusal } from "./advisor/start";
import { beginFollowUp, finishFollowUp } from "./advisor/followup";
import { classifySubagentError, settleOutcome, waitWithTimeout, type AdvisorOutcome } from "./advisor/result";
import { noopLogger, type HostServices, type Logger } from "./advisor/types";

/** The JSON value type `presentationMeta` must return, without importing a transitive package. */
type JsonMeta = ReturnType<NonNullable<ToolOutputDefinition["presentationMeta"]>>;

/** Refusals carry a `kind`; outcomes never do (their optional `failure` is absent on success). */
const isRefusal = (r: AdvisorOutcome | Refusal | (AdvisorOutcome & { childId: string })): r is Refusal => "kind" in r && typeof (r as Refusal).kind === "string";

export const TOOL_NAME = "second_opinion";

export interface AdvisorDeps {
  host: HostServices;
  registry: AdvisorRegistry;
  getConfig: () => AdvisorConfig;
  log?: Logger;
}

interface ToolArgs {
  question?: string;
  context?: string;
  mode?: string;
  consult_id?: string;
  follow_up?: string;
  dual_opinions?: boolean;
}

export type AttemptRecord = {
  label: string;
  ok: boolean;
  reason?: string;
};

/** Canonical tool value (validated against `output.schema`). */
export interface ToolValue {
  advice: string;
  model: string;
  consultId: string;
  dual: boolean;
  truncated: boolean;
  attempts: AttemptRecord[];
  /** Facts the main model should know: ignored efforts, transcript truncation, timeouts. */
  notes: string[];
  /** Follow-up round this answer belongs to; absent on a new consultation. */
  round?: number;
}

const HINT_FOLLOWUP = (consultId: string) => `\n\n（consult_id: ${consultId} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。追问结果以本次工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。）`;
const HINT_DUAL = "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）";

function textOfAdvice(value: ToolValue): string {
  const notes = value.notes.length ? `\n\n（注：${value.notes.join("；")}）` : "";
  return value.advice + notes + (value.consultId ? (value.dual ? HINT_DUAL : HINT_FOLLOWUP(value.consultId)) : "");
}

function clipForMeta(text: string | undefined, max = 2000): string | undefined {
  if (typeof text !== "string") return undefined;
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function createSecondOpinionTool(deps: AdvisorDeps) {
  const log = deps.log ?? noopLogger;
  return defineTool({
    name: TOOL_NAME,
    description:
      "向配置的顾问模型链征求第二意见。顾问是一位只读的子代理：可以读文件、跑只读命令核实，但不能修改任何东西，回答只交给你。" +
      "默认继承模式：顾问会收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），不要在问题中复述背景；" +
      "问题若依赖对话外的信息（你的意图、没说出口的约束、被省略的早期细节）写进 context，若依赖某个大文件或长输出就给出路径让顾问自己去读。" +
      "盲审模式（mode=standalone）：顾问看不到对话，务必在 context 里写清目标、约束、已尝试的做法和相关文件路径。" +
      "支持追问（consult_id + follow_up，顾问说缺信息时也可这样补充）、双意见对比（dual_opinions，并行咨询链上前两位顾问）。" +
      "适用于重大方案决策前的复核、高风险判断、对自己结论把握不足、或同一问题连续受阻时；用户明确要求咨询顾问时也调用。",
    parameters: {
      question: {
        type: "string",
        description: "新咨询的问题，例如「方案 A 在 X 约束下是否成立」。与 consult_id 二选一：提供 consult_id 时改用 follow_up。",
      },
      context: {
        type: "string",
        description: "可选。对话记录里不存在的信息：你的私有推理意图、未说出口的约束、被抄本省略的早期要点。盲审模式下必须写清目标、约束、已尝试的做法和相关文件路径。",
      },
      mode: {
        type: "string",
        description: "可选，按次覆盖默认咨询模式。inherited：顾问获得会话抄本（默认）；standalone：盲审——顾问不看对话，只依据问题与 context 独立判断，适合需要不受主对话思路影响的场景。",
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
        description: "可选。true 时并行咨询链上前两位顾问（互不可见对方；链上仅一个模型时，同一模型独立咨询两次），返回两份独立意见；不支持追问。",
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
          round: { type: "number" },
          attempts: {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: { label: { type: "string", required: true }, ok: { type: "boolean", required: true }, reason: { type: "string" } },
            },
          },
          notes: { type: "array", items: { type: "string" } },
        },
      },
      render: (_args: unknown, value: unknown) => [{ type: "text", text: textOfAdvice(value as ToolValue) }],
      presentationMeta: (args: unknown, value: unknown) => {
        const a = (args ?? {}) as ToolArgs;
        const v = value as ToolValue;
        // JSON-safe: undefined members are omitted rather than emitted.
        const meta: Record<string, JsonMeta> = {
          kind: "second-opinion",
          model: v.model,
          consultId: v.consultId,
          dual: v.dual,
          truncated: v.truncated,
          attempts: v.attempts,
          notes: v.notes,
        };
        const optional: Record<string, JsonMeta | undefined> = {
          question: clipForMeta(a.question),
          context: clipForMeta(a.context),
          mode: typeof a.mode === "string" ? a.mode : undefined,
          followUp: clipForMeta(a.follow_up),
          round: v.round,
        };
        for (const [key, val] of Object.entries(optional)) if (val !== undefined) meta[key] = val;
        return meta as JsonMeta;
      },
    },
    async execute(args: ToolArgs, exec: ToolRunContext) {
      const cfg = deps.getConfig();
      const fail = (advice: string): ToolValue => ({ advice, model: "", consultId: "", dual: false, truncated: false, attempts: [], notes: [] });
      if (!cfg.enabled) return fail("Second Opinion 当前已停用（设置中可开启）。");
      if (cfg.chain.length === 0) return fail("顾问链尚未配置任何模型。请先到 设置 → 顾问设置 添加顾问模型。");

      const parent = exec.agent as Agent | undefined;
      if (!parent) return fail("当前执行环境没有会话上下文，无法咨询顾问。");
      if (deps.registry.isAdvisor(String(parent.id)) || isAdvisorChild(parent)) {
        return fail("你已经是顾问子代理：顾问不能再咨询 second_opinion，直接给出你的意见即可。");
      }

      // ---------- follow-up branch ----------
      if (args.consult_id) {
        if (args.dual_opinions) return fail("双意见咨询不支持追问；请基于单一模型开新咨询。");
        if (typeof args.follow_up !== "string" || !args.follow_up.trim()) return fail("追问需要提供 follow_up 参数（要继续追问的内容）。");
        const begin = await beginFollowUp(deps.host, deps.registry, {
          parent,
          signal: exec.signal,
          consultId: args.consult_id,
          followUp: args.follow_up,
          maxRounds: cfg.followup.maxRounds,
        });
        if (!begin.ok) return { ...fail(begin.message), consultId: args.consult_id };
        // The follow-up inherits the winning entry's timeout when it is still configured.
        const record = deps.registry.get(args.consult_id);
        const entryTimeout = record ? cfg.chain.find((e) => e.provider === record.provider && e.model === record.model)?.timeoutMs : undefined;
        const outcome = await finishFollowUp(deps.host, deps.registry, begin, { timeoutMs: entryTimeout ?? cfg.limits.defaultTimeoutMs }, parent, exec.signal);
        const attempts: AttemptRecord[] = [{ label: "追问", ok: outcome.ok, ...(outcome.failure ? { reason: outcome.failure } : {}) }];
        if (!outcome.ok) return { advice: `顾问本轮未返回可用回答：${outcome.failure}。可换个问法追问或开新咨询。`, model: "", consultId: args.consult_id, dual: false, truncated: false, attempts, notes: [], round: begin.round };
        const notes = outcome.truncated ? ["本轮追问超时被中止，以上为已输出的部分回答"] : [];
        return { advice: outcome.content, model: entryLabelOf(deps, args.consult_id), consultId: args.consult_id, dual: false, truncated: outcome.truncated, attempts, notes, round: begin.round };
      }

      // ---------- new consultation ----------
      if (typeof args.question !== "string" || !args.question.trim()) {
        return fail("缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。");
      }
      const question = args.question.trim();
      const mode: "inherited" | "standalone" = args.mode === "standalone" ? "standalone" : args.mode === "inherited" ? "inherited" : cfg.contextMode;
      const notes: string[] = [];
      const promptText = buildPromptText(deps, parent, cfg, mode, question, args.context, notes);
      const live: SubagentActivation[] = [];
      /** An attempt's outcome plus the child that produced it; `consult_id` is the child's session id so follow-ups can find the thread. */
      type RunResult = (AdvisorOutcome & { childId: string }) | Refusal;
      const runEntry = async (entry: ChainEntry, prompt: string): Promise<RunResult> => {
        const label = entryName(entry);
        const started = await startAdvisor(deps.host, deps.registry, { parent, signal: exec.signal, entry, entryLabel: label, promptText: prompt, consultId: "", mode });
        if (!started.ok) return started;
        live.push(started.activation);
        if (started.effortIgnored) notes.push(`推理档位「${entry.reasoningEffort}」未被模型 ${entry.provider}/${entry.model} 声明，已忽略`);
        const childId = String(started.activation.childId);
        try {
          const { value, abortedBy } = await waitWithTimeout({
            run: started.activation.result,
            observation: () => deps.registry.observation(childId) ?? started.observation,
            policy: { timeoutMs: entry.timeoutMs ?? cfg.limits.defaultTimeoutMs },
            abort: () => void started.activation.dispose().catch(() => {}),
            signal: exec.signal,
          });
          const outcome = settleOutcome({ result: value, observation: deps.registry.observation(childId) ?? started.observation, abortedBy });
          if (outcome.ok && outcome.truncated) notes.push(`${label}：超时后按已输出内容截断`);
          return { ...outcome, childId };
        } catch (error) {
          // Caller cancellation is not a failure of this entry.
          if (exec.signal.aborted) throw error;
          // A rejected activation result (infrastructure fault) or a child that
          // never settled: route it through the same classification table so the
          // chain can fall through (model class) or stop with an actionable message.
          const classified = classifySubagentError(error);
          return { ok: false, kind: classified.kind, message: `顾问运行中断（${label}）：${classified.message}` };
        } finally {
          live.splice(live.indexOf(started.activation), 1);
          // The streamed text was only a fallback for partial output; release it.
          started.observation.text = "";
        }
      };
      const isRun = (r: RunResult): r is AdvisorOutcome & { childId: string } => !isRefusal(r);

      try {
        if (args.dual_opinions) {
          const pair = cfg.chain.slice(0, 2);
          if (pair.length === 1) pair.push(pair[0]);
          const results = await Promise.all(pair.map((entry) => runEntry(entry, promptText)));
          const sections: string[] = [];
          const models: string[] = [];
          const attempts: AttemptRecord[] = [];
          let anyTruncated = false;
          results.forEach((result, i) => {
            const label = entryName(pair[i]);
            if (!isRefusal(result) && result.ok && result.content.trim()) {
              models.push(`${pair[i].provider}/${pair[i].model}`);
              attempts.push({ label, ok: true });
              if (result.truncated) anyTruncated = true;
              sections.push(`【意见一/二 · ${label}${result.truncated ? " · 已截断" : ""}】\n${result.content}`);
            } else {
              const reason = isRefusal(result) ? result.message : result.failure ?? "未返回可用内容";
              attempts.push({ label, ok: false, reason });
              sections.push(`【意见一/二 · ${label}】本次未返回可用内容：${reason}`);
            }
          });
          const okCount = attempts.filter((a) => a.ok).length;
          if (okCount === 0) {
            const hardStop = results.find((r) => isRefusal(r));
            return {
              ...fail(`双意见咨询全部失败：${attempts.filter((a) => !a.ok).map((a) => `${a.label}（${a.reason}）`).join("；")}。${hardStop && isRefusal(hardStop) ? hardStop.message : "请基于自己的判断继续。"}`),
              consultId: "",
              dual: true,
              attempts,
              notes,
            };
          }
          const failedNote = okCount < attempts.length ? "（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）" : "";
          const firstChild = results.filter(isRun).find((r) => r.ok)?.childId ?? "";
          // Dual children are not follow-up-able; remember that on each record.
          for (const r of results.filter(isRun)) {
            if (r.ok) deps.registry.record({ childId: r.childId, parentSessionId: String(parent.id), consultId: r.childId, label: ADVISOR_LABEL_PREFIX + "dual", provider: "", model: "", dual: true });
          }
          return { advice: sections.join("\n\n———\n\n") + failedNote, model: models.join(" + "), consultId: firstChild, dual: true, truncated: anyTruncated, attempts, notes };
        }

        const attempts: AttemptRecord[] = [];
        for (const entry of cfg.chain) {
          const label = entryName(entry);
          const result = await runEntry(entry, promptText);
          if (!isRefusal(result) && result.ok) {
            attempts.push({ label, ok: true });
            // consult_id IS the winning child's session id: follow-ups address that thread.
            deps.registry.record({ childId: result.childId, parentSessionId: String(parent.id), consultId: result.childId, label: ADVISOR_LABEL_PREFIX + label, provider: entry.provider, model: entry.model });
            return { advice: result.content, model: `${entry.provider}/${entry.model}`, consultId: result.childId, dual: false, truncated: result.truncated, attempts, notes };
          }
          if (isRefusal(result)) {
            // authorization / infrastructure / other: the next entry would hit the same wall.
            attempts.push({ label, ok: false, reason: result.message });
            return { ...fail(result.message), consultId: "", dual: false, attempts, notes };
          }
          attempts.push({ label, ok: false, reason: result.failure });
          log(`advisor: ${label} failed: ${result.failure}`);
        }
        return {
          ...fail(`顾问链全部调用失败：${attempts.map((a) => `${a.label}（${a.reason}）`).join("；")}。请基于自己的判断继续，或稍后重试。`),
          consultId: "",
          dual: false,
          attempts,
          notes,
        };
      } catch (error) {
        await Promise.allSettled(live.map((a) => a.dispose()));
        throw error;
      } finally {
        // Successful children settle on their own; dispose anything left only on abnormal exits.
        if (exec.signal.aborted) await Promise.allSettled(live.map((a) => a.dispose()));
      }
    },
  });
}

function buildPromptText(deps: AdvisorDeps, parent: Agent, cfg: AdvisorConfig, mode: "inherited" | "standalone", question: string, context: string | undefined, notes: string[]): string {
  if (mode === "standalone") return buildAdvisorPrompt({ mode, advisorPrompt: cfg.advisorPrompt, question, context });
  let history: Parameters<typeof buildTranscript>[0] = [];
  try {
    history = parent.session.deriveMessages() as never;
  } catch (error) {
    deps.log?.(`advisor: deriveMessages failed: ${error instanceof Error ? error.message : String(error)}`);
  }
  const transcript = buildTranscript(history, {
    maxChars: cfg.limits.transcriptMaxChars,
    perEntryMaxChars: cfg.limits.perEntryMaxChars,
    excludeToolName: TOOL_NAME,
  });
  if (transcript.droppedCount > 0) notes.push(`抄本省略了更早的 ${transcript.droppedCount} 条消息（已附最初请求摘要）`);
  if (transcript.clippedCount > 0) notes.push(`${transcript.clippedCount} 条内容因过长被截断，顾问看到的工具输出可能不完整`);
  return buildAdvisorPrompt({
    mode,
    advisorPrompt: cfg.advisorPrompt,
    question,
    context,
    transcriptText: transcript.text,
    transcriptDropped: transcript.droppedCount,
    transcriptClipped: transcript.clippedCount,
  });
}

function entryLabelOf(deps: AdvisorDeps, childId: string): string {
  const record = deps.registry.get(childId);
  return record?.provider && record?.model ? `${record.provider}/${record.model}` : "顾问";
}

function isAdvisorChild(agent: Agent): boolean {
  try {
    const descriptor = foldSubagentDescriptor(agent.session.snapshotEvents());
    return typeof descriptor?.label === "string" && descriptor.label.startsWith(ADVISOR_LABEL_PREFIX);
  } catch {
    return false;
  }
}
