/**
 * Compact the main session's derived message history into a bounded text
 * transcript for the advisor.
 *
 * The input is what `session.deriveMessages()` returns: exactly the message
 * history the main model sees. We drop system/developer messages (the main
 * model's harness prompt is huge and not the advisor's business), render
 * user/assistant/tool messages with role labels, bound every single entry
 * (tool results in particular can be enormous), and keep the newest window
 * within the configured character budget.
 */

export interface TranscriptBlock {
  type?: string;
  text?: string;
  [key: string]: unknown;
}

export interface DerivedMessageLike {
  role?: string;
  content?: TranscriptBlock[];
  [key: string]: unknown;
}

export interface TranscriptOptions {
  maxChars: number;
  perEntryMaxChars: number;
}

export interface TranscriptResult {
  text: string;
  droppedCount: number;
  /** true when older messages were dropped to fit the budget */
  truncated: boolean;
}

const ROLE_LABELS: Record<string, string> = {
  user: "用户",
  assistant: "主模型",
  tool: "工具结果",
};

function clip(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars)}…（截断，原 ${text.length} 字符）`;
}

/** Render one content block; unknown shapes degrade to a bounded JSON dump. */
function blockToText(block: TranscriptBlock): string {
  if (block.type === "text" && typeof block.text === "string") return block.text;
  const type = typeof block.type === "string" ? block.type : "unknown";
  if (typeof block.name === "string" && type.includes("tool")) {
    return `（${type.includes("call") ? "工具调用" : "工具"} ${block.name}）`;
  }
  try {
    return `（非文本块 ${type}：${JSON.stringify(block).slice(0, 200)}）`;
  } catch {
    return `（非文本块 ${type}）`;
  }
}

/** One derived message → a labeled transcript entry; null for skipped roles
 *  (system/developer) or empty text. */
export function messageToEntry(message: DerivedMessageLike, perEntryMaxChars: number): { label: string; text: string } | null {
  const role = typeof message.role === "string" ? message.role : "";
  const label = ROLE_LABELS[role];
  if (!label) return null;
  const blocks = Array.isArray(message.content) ? message.content : [];
  const text = clip(
    blocks.map(blockToText).join("\n").trim(),
    perEntryMaxChars,
  );
  if (!text) return null;
  return { label, text };
}

export function buildTranscript(messages: DerivedMessageLike[], options: TranscriptOptions): TranscriptResult {
  const entries: string[] = [];
  for (const message of messages) {
    const entry = messageToEntry(message, options.perEntryMaxChars);
    if (entry) entries.push(`[${entry.label}]\n${entry.text}`);
  }
  // Walk from the newest entry backwards; keep everything that fits.
  let kept: string[] = [];
  let used = 0;
  let i = entries.length - 1;
  for (; i >= 0; i--) {
    const cost = entries[i].length + 1;
    if (used + cost > options.maxChars && kept.length > 0) break;
    kept.unshift(entries[i]);
    used += cost;
    if (used >= options.maxChars) {
      i--;
      break;
    }
  }
  const dropped = i + 1;
  const parts: string[] = [];
  if (dropped > 0) parts.push(`（为控制篇幅，已省略更早的 ${dropped} 条消息）`);
  parts.push(...kept);
  return { text: parts.join("\n\n"), droppedCount: dropped, truncated: dropped > 0 };
}

/** The final user prompt handed to the advisor model. */
export function buildAdvisorUserPrompt(input: {
  transcriptText: string;
  question: string;
  context?: string;
}): string {
  const sections: string[] = [];
  sections.push(`以下是你所在的 AI 助手当前会话的对话抄本（可能已省略较早部分）：\n\n${input.transcriptText || "（无可用对话记录）"}`);
  if (input.context && input.context.trim()) {
    sections.push(`助手补充的对话外信息：\n${input.context.trim()}`);
  }
  sections.push(`助手此刻的问题：\n${input.question}`);
  return sections.join("\n\n---\n\n");
}
