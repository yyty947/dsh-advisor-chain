import type { AdvisorConfig } from "./config";
import type { RepeatPressure } from "./pressure";

/**
 * The system-prompt section that teaches the main model when to call
 * advisor_ask. Concise by design: it is injected into every model step.
 *
 * DSH adaptation notes (deliberately different from the codex-advisor
 * protocol): the advisor inherits the full conversation automatically, so
 * the instructions tell the model NOT to restate background; the fallback
 * chain is executed in code, so nothing here mentions model priorities or
 * retries; there is no V1/V2 interface and no recursion marker.
 */
export function buildSectionText(config: AdvisorConfig, pressure: RepeatPressure | undefined, threshold: number): string {
  if (!config.enabled || config.chain.length === 0) return "";
  const lines: string[] = [];
  if (config.mode === "manual") {
    lines.push(
      "## Advisor 顾问使用边界",
      "advisor_ask 向顾问模型征求第二意见，顾问会自动看到当前会话的完整对话。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答。",
    );
    return lines.join("\n");
  }
  lines.push(
    "## Advisor 顾问使用边界",
    "你可以调用 advisor_ask 向顾问模型征求第二意见。顾问会自动看到当前会话的完整对话记录，调用时只提出具体问题，不要复述对话中已有的内容；对话之外的私有信息（你的推理意图、未说出口的约束）可写入 context 参数。",
    "1. 适合咨询：重大方案决策前的复核；高风险判断（安全、数据、架构承诺）；你对自己的结论把握不足；同一问题连续多轮没有进展。",
    "2. 不适合：可以直接联网查证的简单事实；日常闲聊、纯创意任务。",
    "3. 用户明确要求咨询顾问时必须调用。",
    "4. 拿到顾问意见后自行判断取舍，不要原样转贴整段回复。",
  );
  if (pressure && pressure.count >= threshold) {
    lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 advisor_ask 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
  } else if (pressure && pressure.count > 1) {
    lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 advisor_ask 征求第二意见。`);
  }
  return lines.join("\n");
}
