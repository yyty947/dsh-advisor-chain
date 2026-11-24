/**
 * Repeat-pressure tracking: how many times in a row the same user text has
 * appeared in one session. Same pattern as dsh-advisor-group's repeatTracker
 * (proven in production): a repeated question is the observable signal that
 * the main model is stuck; the system-prompt section escalates the advisory
 * instruction once the count reaches the configured threshold.
 *
 * Comparison is normalized (case, punctuation and whitespace are ignored) so
 * that a re-sent question with a stray comma still counts, while "advance"
 * phrases ("继续", "go on") never count: they are how a user nudges a model
 * that is still working, not a repeated question.
 */

export interface SessionEventLike {
  type?: string;
  data?: {
    content?: Array<{ type?: string; text?: string }>;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

export interface RepeatPressure {
  /** Times the normalized text has been seen in a row. */
  count: number;
  /** The raw text as last seen (used for language inference). */
  text: string;
}

/** Short messages that only nudge the model to keep going; never a repeated question.
 *  Compared in normalized form (see {@link normalizeUserText}). */
export const ADVANCE_PHRASES = new Set(["继续", "请继续", "接着", "接着写", "继续吧", "goon", "continue", "pleasecontinue", "next", "ok", "okay", "好的", "嗯", "yes", "y"]);

/** Lower-case, punctuation- and whitespace-free form used for equality. */
export function normalizeUserText(text: string): string {
  return text
    .toLowerCase()
    // Keep letters (any script) and digits; drop punctuation, symbols, whitespace.
    .replace(/[^\p{L}\p{N}]+/gu, "");
}

export function extractUserMessageText(event: SessionEventLike): string | null {
  if (event.type !== "user/message") return null;
  const content = event.data?.content;
  if (!Array.isArray(content)) return null;
  const text = content
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text as string)
    .join(" ")
    .trim();
  return text.length > 0 ? text : null;
}

export class RepeatPressureTracker {
  private map = new Map<string, RepeatPressure & { key: string }>();

  handleEvent(sessionId: string, event: SessionEventLike): void {
    const text = extractUserMessageText(event);
    if (!text) return;
    const key = normalizeUserText(text);
    // Empty after normalization (pure punctuation/emoji) or an advance phrase: not a question.
    if (!key || ADVANCE_PHRASES.has(key)) return;
    const tracked = this.map.get(sessionId);
    if (!tracked || tracked.key !== key) {
      this.map.set(sessionId, { key, text, count: 1 });
    } else {
      tracked.count += 1;
      tracked.text = text;
    }
  }

  get(sessionId: string | undefined): RepeatPressure | undefined {
    if (!sessionId) return undefined;
    const tracked = this.map.get(sessionId);
    if (!tracked) return undefined;
    return { count: tracked.count, text: tracked.text };
  }
}
