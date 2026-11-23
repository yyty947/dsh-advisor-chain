/**
 * Compact the main session's derived message history into a bounded text
 * transcript for the advisor — the inherited-mode context source.
 *
 * The input is what `session.deriveMessages()` returns: exactly the message
 * history the main model sees. Rendering rules:
 * - system / developer messages are dropped (the harness prompt is not the
 *   advisor's business);
 * - user-role messages are labeled by their producer: a real user message is
 *   `[用户]`, anything injected on the user's behalf (skill catalogs,
 *   environment snapshots, agent relays, notices) is `[注入：<kind>/<form>]`
 *   so the advisor never mistakes harness context for something the user said;
 * - assistant tool calls keep their NAME AND ARGUMENTS (the advisor must see
 *   what was read and what was changed); reasoning blocks are skipped;
 * - tool results are labeled, failures marked, and every entry is clipped;
 * - the in-flight call to `excludeToolName` (the consultation itself) is left
 *   out, while earlier completed consultations stay in;
 * - the newest window that fits the budget is kept, dropped older entries are
 *   counted, and the FIRST user request is preserved as a short head summary
 *   so long sessions do not lose the original task.
 */

export interface TranscriptBlock {
  type?: string;
  text?: string;
  name?: string;
  arguments?: unknown;
  id?: unknown;
  summary?: string;
  [key: string]: unknown;
}

export interface TranscriptMessageLike {
  role?: string;
  content?: readonly TranscriptBlock[];
  source?: { kind?: string; form?: string; summary?: string; [key: string]: unknown };
  toolCallId?: unknown;
  isError?: boolean;
  [key: string]: unknown;
}

export interface TranscriptOptions {
  maxChars: number;
  perEntryMaxChars: number;
  /** Tool name whose in-flight call (no result yet) is excluded from the transcript. */
  excludeToolName?: string;
  /** Character budget for the head summary of the first user request. */
  headSummaryMaxChars?: number;
}

export interface TranscriptResult {
  text: string;
  /** Older entries dropped to fit the budget. */
  droppedCount: number;
  /** Entries (or tool-call arguments) clipped to `perEntryMaxChars`. */
  clippedCount: number;
  /** true when older messages were dropped to fit the budget */
  truncated: boolean;
}

const USER_LABEL = "用户";
const ASSISTANT_LABEL = "主模型";
const TOOL_LABEL = "工具结果";
const DEFAULT_HEAD_SUMMARY_MAX_CHARS = 600;

function clip(text: string, maxChars: number): { text: string; clipped: boolean } {
  if (text.length <= maxChars) return { text, clipped: false };
  return { text: `${text.slice(0, maxChars)}…（截断，原 ${text.length} 字符）`, clipped: true };
}

function compactArgs(raw: unknown): string {
  if (typeof raw !== "string") return raw === undefined ? "" : safeStringify(raw);
  try {
    const parsed = JSON.parse(raw);
    return JSON.stringify(parsed);
  } catch {
    return raw;
  }
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value) ?? "";
  } catch {
    return "";
  }
}

/** Label for a user-role message: the real user, or the injecting producer. */
export function userEntryLabel(source: TranscriptMessageLike["source"]): string {
  const kind = source?.kind ?? "user";
  if (kind === USER_LABEL || kind === "user") return USER_LABEL;
  const form = typeof source?.form === "string" && source.form ? `/${source.form}` : "";
  return `注入：${kind}${form}`;
}

/** Render one content block; returns null for blocks the advisor should not see. */
function blockToText(block: TranscriptBlock, perEntryMaxChars: number, excludedCallIds: ReadonlySet<unknown>, excludeToolName: string | undefined, clipped: { count: number }): string | null {
  if (block.type === "text" && typeof block.text === "string") {
    const res = clip(block.text, perEntryMaxChars);
    if (res.clipped) clipped.count += 1;
    return res.text;
  }
  if (block.type === "reasoning") return null;
  if (block.type === "tool-call" && typeof block.name === "string") {
    if (excludeToolName && block.name === excludeToolName && excludedCallIds.has(block.id)) return null;
    const args = clip(compactArgs(block.arguments), perEntryMaxChars);
    if (args.clipped) clipped.count += 1;
    return `（工具调用 ${block.name}：${args.text || "{}"}）`;
  }
  if (block.type === "image" || block.type === "file") {
    return `（${block.type === "image" ? "图片" : "文件"}附件，顾问无法直接查看；如有需要请用只读工具读取工作区中的对应文件）`;
  }
  if (block.type === "tool-addition" || block.type === "tool-removal") return null;
  return null;
}

/** One derived message → a labeled transcript entry; null for skipped roles
 *  (system / developer) or entries that render to nothing. */
export function messageToEntry(
  message: TranscriptMessageLike,
  perEntryMaxChars: number,
  excludedCallIds: ReadonlySet<unknown> = new Set(),
  excludeToolName?: string,
  clipped: { count: number } = { count: 0 },
): { label: string; text: string } | null {
  const role = message.role ?? "";
  if (role === "system" || role === "developer") return null;

  if (role === "user") {
    const source = message.source;
    // A notice is summarized by its one-line account; its body is noise.
    if (source?.form === "notice" && typeof source.summary === "string") {
      return { label: userEntryLabel(source), text: source.summary };
    }
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
    return text ? { label: userEntryLabel(source), text } : null;
  }
  if (role === "assistant") {
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
    return text ? { label: ASSISTANT_LABEL, text } : null;
  }
  if (role === "tool") {
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
    if (!text) return null;
    return { label: `${TOOL_LABEL}${message.isError ? "（失败）" : ""}`, text };
  }
  return null;
}

function renderBlocks(
  blocks: readonly TranscriptBlock[] | undefined,
  perEntryMaxChars: number,
  excludedCallIds: ReadonlySet<unknown>,  excludeToolName: string | undefined,
  clipped: { count: number },
): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    const rendered = blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped);
    if (rendered !== null && rendered !== "") parts.push(rendered);
  }
  return parts.join("\n").trim();
}

/** Ids of tool calls that already have a result in the log. */
function collectAnsweredCallIds(messages: readonly TranscriptMessageLike[]): Set<unknown> {
  const answered = new Set<unknown>();
  for (const message of messages) {
    if (message.role === "tool" && message.toolCallId !== undefined) answered.add(message.toolCallId);
  }
  return answered;
}

/** The first real user message, rendered as a short head summary. */
function headSummaryOf(messages: readonly TranscriptMessageLike[], maxChars: number): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.source?.kind !== undefined && message.source.kind !== "user") continue;
    const text = renderBlocks(message.content, maxChars, new Set(), undefined, { count: 0 });
    if (text) return clip(text, maxChars).text;
  }
  return null;
}

export function buildTranscript(messages: readonly TranscriptMessageLike[], options: TranscriptOptions): TranscriptResult {
  const clipped = { count: 0 };
  const exclude = options.excludeToolName;
  // Every call to the excluded tool is in flight unless a result answers it.
  const excludedCallIds = new Set<unknown>();
  if (exclude) {
    for (const message of messages) {
      if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
      for (const block of message.content) {
        if (block.type === "tool-call" && block.name === exclude) excludedCallIds.add(block.id);
      }
    }
    for (const id of collectAnsweredCallIds(messages)) excludedCallIds.delete(id);
  }

  const entries: Array<{ label: string; text: string }> = [];
  // Entry index of the first message the real user wrote, so a dropped
  // original request can be restored as a short head summary.
  let firstUserEntryIndex = -1;
  messages.forEach((message) => {
    const entry = messageToEntry(message, options.perEntryMaxChars, excludedCallIds, exclude, clipped);
    if (!entry) return;
    if (firstUserEntryIndex < 0 && message.role === "user" && (message.source?.kind ?? "user") === "user") {
      firstUserEntryIndex = entries.length;
    }
    entries.push(entry);
  });

  // Walk from the newest entry backwards; keep everything that fits.
  const rendered = entries.map((e) => `[${e.label}]\n${e.text}`);
  const kept: string[] = [];
  let used = 0;
  let i = rendered.length - 1;
  for (; i >= 0; i--) {
    const cost = rendered[i].length + 1;
    if (used + cost > options.maxChars && kept.length > 0) break;
    kept.unshift(rendered[i]);
    used += cost;
    if (used >= options.maxChars) {
      i--;
      break;
    }
  }
  const dropped = i + 1;

  const parts: string[] = [];
  if (dropped > 0) {
    parts.push(`（为控制篇幅，已省略更早的 ${dropped} 条消息）`);
    // The original task is the one thing a tail window must not lose.
    if (firstUserEntryIndex >= 0 && firstUserEntryIndex < dropped) {
      const head = headSummaryOf(messages, options.headSummaryMaxChars ?? DEFAULT_HEAD_SUMMARY_MAX_CHARS);
      if (head) parts.push(`（最初的用户请求，可能已截断）\n${head}`);
    }
  }
  parts.push(...kept);
  return { text: parts.join("\n\n"), droppedCount: dropped, clippedCount: clipped.count, truncated: dropped > 0 };
}
