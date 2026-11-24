import type { AdvisorConfig } from "./config";
import { t, type Lang } from "./i18n";
import type { RepeatPressure } from "./pressure";

/**
 * The system-prompt section that teaches the main model when and how to call
 * second_opinion. Concise by design: it is injected into every model step.
 *
 * DSH adaptation notes: the advisor is a read-only subagent that receives a
 * bounded transcript of this conversation (or nothing, in blind mode), so the
 * instructions tell the model NOT to restate background but to point the
 * advisor at files and to supply out-of-transcript facts in `context`.
 */
export function buildSectionText(config: AdvisorConfig, pressure: RepeatPressure | undefined, threshold: number, lang: Lang = "zh"): string {
  if (!config.enabled || config.chain.length === 0) return "";
  const lines: string[] = [t(lang, "prompt.header")];
  if (config.mode === "manual") {
    lines.push(t(lang, "prompt.manual"));
    return lines.join("\n");
  }
  lines.push(
    t(lang, "prompt.autoIntro"),
    t(lang, "prompt.rule1"),
    t(lang, "prompt.rule2"),
    t(lang, "prompt.rule3"),
    t(lang, "prompt.rule4"),
    t(lang, "prompt.rule5"),
  );
  if (pressure && pressure.count >= threshold) {
    lines.push("", t(lang, "prompt.forced", { count: pressure.count }));
  } else if (pressure && pressure.count > 1) {
    lines.push("", t(lang, "prompt.reminder", { count: pressure.count }));
  }
  return lines.join("\n");
}
