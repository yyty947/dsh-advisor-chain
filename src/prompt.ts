import type { AdvisorConfig } from "./config";
import type { RepeatPressure } from "./pressure";

/**
 * The system-prompt section that teaches the main model when to call
 * second_opinion. Concise by design: it is injected into every model step.
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
      "## Second Opinion（第二意见）使用边界",
      "second_opinion 向顾问模型征求第二意见，顾问会自动看到当前会话的完整对话。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。",
    );
    return lines.join("\n");
  }
  lines.push(
    "## Second Opinion（第二意见）使用边界",
    "second_opinion 向顾问模型征求第二意见。顾问自动看到当前会话的完整对话，调用时只提具体问题，不要复述对话已有的内容；对话外的私有信息（你的推理意图、未说出口的约束）写入 context 参数。",
    "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。",
    "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。",
    "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。",
    "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。",
  );
  if (pressure && pressure.count >= threshold) {
    lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
  } else if (pressure && pressure.count > 1) {
    lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。`);
  }
  return lines.join("\n");
}
