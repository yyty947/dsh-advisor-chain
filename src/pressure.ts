/**
 * Repeat-pressure tracking: how many times in a row the same user text has
 * appeared in one session. Same pattern as dsh-advisor-group's repeatTracker
 * (proven in production): a repeated question is the observable signal that
 * the main model is stuck; the system-prompt section escalates the advisory
 * instruction once the count reaches the configured threshold.
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
  count: number;
  text: string;
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
  private map = new Map<string, RepeatPressure>();

  handleEvent(sessionId: string, event: SessionEventLike): void {
    const text = extractUserMessageText(event);
    if (!text) return;
    const tracked = this.map.get(sessionId);
    if (!tracked || tracked.text !== text) {
      this.map.set(sessionId, { text, count: 1 });
    } else {
      tracked.count += 1;
    }
  }

  get(sessionId: string | undefined): RepeatPressure | undefined {
    if (!sessionId) return undefined;
    return this.map.get(sessionId);
  }
}
