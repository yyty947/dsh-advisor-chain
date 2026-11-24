/**
 * Compact the main session's derived message history into a bounded text
 * transcript for the advisor — the inherited-mode context source.
 *
 * The input is what `session.deriveMessages()` returns: exactly the message
 * history the main model sees. Rendering rules:
 * - system / developer messages are dropped (the harness prompt is not the
 *   advisor's business);
 * - user-role messages are labeled by their producer: a real user message is
 *   `用户`/`User`, anything injected on the user's behalf (skill catalogs,
 *   environment snapshots, agent relays, notices) is labeled as an injection
 *   with its source kind, so the advisor never mistakes harness context for
 *   something the user said;
 * - assistant tool calls keep their NAME AND ARGUMENTS (the advisor must see
 *   what was read and what was changed); reasoning blocks are skipped;
 * - tool results are labeled, failures marked, and every entry is clipped;
 * - the in-flight call to `excludeToolName` (the consultation itself) is left
 *   out, while earlier completed consultations stay in;
 * - the newest window that fits the budget is kept, dropped older entries are
 *   counted, and the FIRST user request is preserved as a short head summary
 *   so long sessions do not lose the original task.
 *
 * Labels follow the advisor prompt's language (`options.lang`).
 */

import { t, type Lang } from "./i18n";

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
  /** Language for the labels; defaults to Chinese. */
  lang?: Lang;
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

const DEFAULT_HEAD_SUMMARY_MAX_CHARS = 600;

function clip(text: string, maxChars: number, lang: Lang): { text: string; clipped: boolean } {
  if (text.length <= maxChars) return { text, clipped: false };
  return { text: `${text.slice(0, maxChars)}${t(lang, "transcript.clipped", { count: text.length })}`, clipped: true };
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
export function userEntryLabel(source: TranscriptMessageLike["source"], lang: Lang = "zh"): string {
  const kind = source?.kind ?? "user";
  if (kind === "user") return t(lang, "transcript.user");
  const form = typeof source?.form === "string" && source.form ? `/${source.form}` : "";
  return t(lang, "transcript.injected", { source: `${kind}${form}` });
}

/** Render one content block; returns null for blocks the advisor should not see. */
function blockToText(block: TranscriptBlock, perEntryMaxChars: number, excludedCallIds: ReadonlySet<unknown>, excludeToolName: string | undefined, clipped: { count: number }, lang: Lang): string | null {
  if (block.type === "text" && typeof block.text === "string") {
    const res = clip(block.text, perEntryMaxChars, lang);
    if (res.clipped) clipped.count += 1;
    return res.text;
  }
  if (block.type === "reasoning") return null;
  if (block.type === "tool-call" && typeof block.name === "string") {
    if (excludeToolName && block.name === excludeToolName && excludedCallIds.has(block.id)) return null;
    const args = clip(compactArgs(block.arguments), perEntryMaxChars, lang);
    if (args.clipped) clipped.count += 1;
    return t(lang, "transcript.call", { name: block.name, args: args.text || "{}" });
  }
  if (block.type === "image" || block.type === "file") {
    return `（${t(lang, "transcript.attachment", { kind: t(lang, block.type === "image" ? "transcript.attachmentImage" : "transcript.attachmentFile") })}）`;
  }
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
  lang: Lang = "zh",
): { label: string; text: string } | null {
  const role = message.role ?? "";
  if (role === "system" || role === "developer") return null;

  if (role === "user") {
    const source = message.source;
    // A notice is summarized by its one-line account; its body is noise.
    if (source?.form === "notice" && typeof source.summary === "string") {
      return { label: userEntryLabel(source, lang), text: source.summary };
    }
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
    return text ? { label: userEntryLabel(source, lang), text } : null;
  }
  if (role === "assistant") {
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
    return text ? { label: t(lang, "transcript.assistant"), text } : null;
  }
  if (role === "tool") {
    const text = renderBlocks(message.content, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
    if (!text) return null;
    return { label: message.isError ? t(lang, "transcript.toolFailed") : t(lang, "transcript.tool"), text };
  }
  return null;
}

function renderBlocks(
  blocks: readonly TranscriptBlock[] | undefined,
  perEntryMaxChars: number,
  excludedCallIds: ReadonlySet<unknown>,
  excludeToolName: string | undefined,
  clipped: { count: number },
  lang: Lang,
): string {
  if (!Array.isArray(blocks)) return "";
  const parts: string[] = [];
  for (const block of blocks) {
    const rendered = blockToText(block, perEntryMaxChars, excludedCallIds, excludeToolName, clipped, lang);
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
function headSummaryOf(messages: readonly TranscriptMessageLike[], maxChars: number, lang: Lang): string | null {
  for (const message of messages) {
    if (message.role !== "user") continue;
    if (message.source?.kind !== undefined && message.source.kind !== "user") continue;
    const text = renderBlocks(message.content, maxChars, new Set(), undefined, { count: 0 }, lang);
    if (text) return clip(text, maxChars, lang).text;
  }
  return null;
}

export function buildTranscript(messages: readonly TranscriptMessageLike[], options: TranscriptOptions): TranscriptResult {
  const lang = options.lang ?? "zh";
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
    const entry = messageToEntry(message, options.perEntryMaxChars, excludedCallIds, exclude, clipped, lang);
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
    parts.push(t(lang, "transcript.dropped", { count: dropped }));
    // The original task is the one thing a tail window must not lose.
    if (firstUserEntryIndex >= 0 && firstUserEntryIndex < dropped) {
      const head = headSummaryOf(messages, options.headSummaryMaxChars ?? DEFAULT_HEAD_SUMMARY_MAX_CHARS, lang);
      if (head) parts.push(`${t(lang, "transcript.headTitle")}\n${head}`);
    }
  }
  parts.push(...kept);
  return { text: parts.join("\n\n"), droppedCount: dropped, clippedCount: clipped.count, truncated: dropped > 0 };
}
