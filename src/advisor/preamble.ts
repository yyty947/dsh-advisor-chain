import { t, type Lang } from "../i18n";

/**
 * The advisor's task prompt. The fixed preamble frames the situation — the
 * child inherits the main agent's composition (system prompt, tools, the
 * host's delegation note that says "answer the human user"), so the preamble
 * has to override all of that explicitly, every time.
 */
export interface AdvisorPromptInput {
  mode: "inherited" | "standalone";
  lang: Lang;
  /** The user-editable persona and answer requirements (chain-wide); empty = built-in default. */
  advisorPrompt: string;
  question: string;
  context?: string;
  /** Inherited mode: the built transcript and its truncation facts. */
  transcriptText?: string;
  transcriptDropped?: number;
  transcriptClipped?: number;
  /** What the transcript left out on purpose (harness noise, earlier consultations), already phrased for the advisor. */
  transcriptOmitted?: string;
}

export function buildAdvisorPrompt(input: AdvisorPromptInput): string {
  const { lang } = input;
  const persona = input.advisorPrompt.trim() || t(lang, "persona.default");
  const sections: string[] = [
    t(lang, "preamble.who"),
    t(lang, "preamble.inherited"),
    t(lang, "preamble.readonly"),
    `${t(lang, "preamble.requirements")}${persona}`,
  ];
  if (input.mode === "standalone") {
    sections.push(`${t(lang, "preamble.standalone")}${t(lang, "persona.blind")}`);
  } else {
    const dropped = input.transcriptDropped ?? 0;
    const clipped = input.transcriptClipped ?? 0;
    const header =
      t(lang, "preamble.transcript") +
      (dropped > 0 ? t(lang, "preamble.transcriptDropped", { count: dropped }) : "") +
      (clipped > 0 ? t(lang, "preamble.transcriptClipped", { count: clipped }) : "") +
      (input.transcriptOmitted ? "\n" + t(lang, "preamble.transcriptOmitted", { summary: input.transcriptOmitted }) : "");
    sections.push(header, input.transcriptText?.trim() || t(lang, "preamble.noTranscript"));
  }
  if (input.context && input.context.trim()) sections.push(`${t(lang, "preamble.context")}\n${input.context.trim()}`);
  sections.push(`${t(lang, "preamble.question")}\n${input.question.trim()}`, t(lang, "preamble.output"));
  return sections.join("\n\n");
}

/** The message sent to an existing advisor child on a follow-up round. */
export function buildFollowUpMessage(followUp: string, round: number, lang: Lang = "zh"): string {
  return `${t(lang, "preamble.followUp", { round })}\n\n${followUp.trim()}`;
}
