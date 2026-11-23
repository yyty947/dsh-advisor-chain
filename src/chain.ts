/**
 * Chain bookkeeping shared by the tool and its tests. The orchestration
 * itself (which entry to try, how a failure routes) lives in `tool.ts`.
 */

export interface ChainAttemptTarget {
  label?: string;
  provider: string;
  model: string;
  [key: string]: unknown;
}

export function entryName(target: ChainAttemptTarget): string {
  const label = typeof target.label === "string" && target.label.trim() ? target.label.trim() : "";
  return label || `${target.provider}/${target.model}`;
}
