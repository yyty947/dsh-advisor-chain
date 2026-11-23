import { KNOWN_SESSION_EVENT_TYPES } from "@deepseek-ai/dsh-session";

/**
 * Legacy READ shim.
 *
 * Versions up to 0.3.9 wrote `advisor/*` events into the parent session log
 * for the chat card. The persistence read path refuses to reconstruct a log
 * that contains an unknown, non-ignorable event type, so those sessions open
 * only while some plugin registers the types. 0.3.10 never writes them — it
 * only keeps old sessions openable, and it never throws: a frozen, renamed,
 * or missing Set must not keep the plugin itself from loading (which would
 * leave the same sessions unopenable anyway).
 *
 * Exit path: once a repair tool has rewritten the legacy events as ignorable
 * records, this shim can be removed.
 */
export const LEGACY_ADVISOR_EVENT_TYPES = ["advisor/start", "advisor/delta", "advisor/message", "advisor/end", "advisor/followup"] as const;

export function installLegacyShim(known: unknown = KNOWN_SESSION_EVENT_TYPES, log: (message: string) => void = () => {}): boolean {
  try {
    const set = known as Set<string> | undefined;
    if (!set || typeof set.add !== "function") {
      log("advisor: KNOWN_SESSION_EVENT_TYPES is not a mutable Set; sessions written by versions <= 0.3.9 may not open");
      return false;
    }
    if (Object.isFrozen(set)) {
      log("advisor: KNOWN_SESSION_EVENT_TYPES is frozen; sessions written by versions <= 0.3.9 may not open");
      return false;
    }
    for (const type of LEGACY_ADVISOR_EVENT_TYPES) set.add(type);
    return true;
  } catch (error) {
    log(`advisor: legacy event shim failed: ${error instanceof Error ? error.message : String(error)}`);
    return false;
  }
}
