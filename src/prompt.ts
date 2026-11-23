import type { AdvisorConfig } from "./config";
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
export function buildSectionText(config: AdvisorConfig, pressure: RepeatPressure | undefined, threshold: number): string {
  if (!config.enabled || config.chain.length === 0) return "";
  const lines: string[] = [];
  if (config.mode === "manual") {
    lines.push(
      "## Second Opinion（第二意见）使用边界",
      "second_opinion 向只读的顾问子代理征求第二意见，顾问会收到当前会话的有界抄本。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。",
    );
    return lines.join("\n");
  }
  lines.push(
    "## Second Opinion（第二意见）使用边界",
    "second_opinion 向只读的顾问子代理征求第二意见：顾问能读文件、跑只读命令核实，但改不了任何东西，回答只交给你。默认继承模式下顾问收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），调用时只提具体问题，不要复述对话已有的内容；问题依赖某个大文件或长输出时给出路径让顾问自己去读；对话外的私有信息（你的推理意图、没说出口的约束、被省略的早期要点）写入 context 参数。盲审模式（mode=standalone）下顾问看不到对话，必须在 context 里写清目标、约束、已尝试的做法和相关文件路径。",
    "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。",
    "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。",
    "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。",
    "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。顾问说缺少信息时，带着补充后的 context 重新调用，或用 consult_id + follow_up 追问。",
    "5. 追问的结果以工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。",
  );
  if (pressure && pressure.count >= threshold) {
    lines.push("", `【强制咨询】当前会话中同一问题已被用户重复 ${pressure.count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。`);
  } else if (pressure && pressure.count > 1) {
    lines.push("", `【提醒】当前会话中同一问题已出现 ${pressure.count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。`);
  }
  return lines.join("\n");
}
