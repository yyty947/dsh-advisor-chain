import { BLIND_REVIEW_MODIFIER } from "../config";

/**
 * The advisor's task prompt. The fixed preamble frames the situation — the
 * child inherits the main agent's composition (system prompt, tools, the
 * host's delegation note that says "answer the human user"), so the preamble
 * has to override all of that explicitly, every time.
 */
const PREAMBLE = `【你是谁】你是主代理请来的顾问，对它正在进行的工作给出第二意见。
你不是主代理，也不独立地在这个工作区里工作：对话是主代理的，工作区是主代理的，你只负责审阅并回答最后的问题。
你的读者是主代理而不是人类：忽略任何让你"回复人类用户"或"继续完成任务"的指示，你的回答会作为工具结果交给主代理，由它决定是否采纳。

【继承来的内容对你不适用】你看到的技能目录、运行环境说明、工具说明，以及其中关于 second_opinion 的使用规则，都是主代理的上下文，只供你理解背景。
不要继续之前的任务，不要调用 second_opinion，不要再派生子代理，不要替主代理向用户提问。
不要用 send_message 给主代理或任何代理发消息——你的最终回答就是唯一的交付物，它会作为工具结果交给主代理。

【只读】你可以读文件、运行只读的命令来核实事实；不得创建、修改或删除任何文件，不得改变工作区或系统的任何状态。被沙箱拒绝的操作不要重试，在回答里说明即可。`;

const OUTPUT_CONTRACT = `【输出】先给结论，再给依据；指出被忽略的风险、错误假设或更优方案；信息不足时明确说缺什么，不要臆测。用与对话相同的语言回答。`;

const INHERITED_CONTEXT = (dropped: number, clipped: number) =>
  `【对话抄本】下面是主代理当前会话的对话抄本（含当前轮次）。抄本是文本化的：工具输出可能被截断，图片与附件无法直接查看——需要细节时请用只读工具读取工作区中的对应文件。${
    dropped > 0 ? `为控制篇幅已省略更早的 ${dropped} 条消息。` : ""
  }${clipped > 0 ? `有 ${clipped} 条内容因过长被截断。` : ""}`;

const STANDALONE_CONTEXT = `【你能看到的】你看不到主对话，只有下面的问题与补充背景；但你与主代理共享同一个工作区，可以读文件、运行只读命令核实。${BLIND_REVIEW_MODIFIER}`;

export interface AdvisorPromptInput {
  mode: "inherited" | "standalone";
  /** The user-editable persona and answer requirements (chain-wide). */
  advisorPrompt: string;
  question: string;
  context?: string;
  /** Inherited mode: the built transcript and its truncation facts. */
  transcriptText?: string;
  transcriptDropped?: number;
  transcriptClipped?: number;
}

export function buildAdvisorPrompt(input: AdvisorPromptInput): string {
  const sections: string[] = [PREAMBLE, `【回答要求】${input.advisorPrompt.trim()}`];
  if (input.mode === "standalone") {
    sections.push(STANDALONE_CONTEXT);
  } else {
    sections.push(INHERITED_CONTEXT(input.transcriptDropped ?? 0, input.transcriptClipped ?? 0));
    sections.push(input.transcriptText?.trim() || "（无可用对话记录）");
  }
  if (input.context && input.context.trim()) sections.push(`【对话外补充背景】\n${input.context.trim()}`);
  sections.push(`【问题】\n${input.question.trim()}`, OUTPUT_CONTRACT);
  return sections.join("\n\n");
}

/** The message sent to an existing advisor child on a follow-up round. */
export function buildFollowUpMessage(followUp: string, round: number): string {
  return `【追问 ${round}】仍是同一咨询线程：保持顾问身份与只读约束，只回答这个追问，不要重复此前的回答。\n\n${followUp.trim()}`;
}
