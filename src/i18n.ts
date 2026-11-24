/**
 * Host-side copy in Chinese and English.
 *
 * The host has no locale service for plugin text (the client's `ctx.locale`
 * lives in the browser), so the plugin carries its own flat dictionaries and
 * a tiny resolver. The language is always inferred from the text at hand —
 * the user's last message for the system-prompt section, the question plus
 * context for the advisor prompt and the results the main model reads — so
 * the plugin exposes no language setting of its own: the UI follows the DSH
 * locale, and model-facing text follows the conversation.
 *
 * Adding a language: add a dictionary with the same keys to `HOST_MESSAGES`
 * and to `Lang`; the client registers its own dictionaries with the host's
 * locale service (see `src/client/i18n.ts`).
 *
 * The tool's schema (name, description, parameter descriptions) stays English
 * on purpose: it is registered once at load and matches the host's own tool
 * descriptions, which are English regardless of the conversation language.
 */

export type Lang = "zh" | "en";

/** Default when there is no text to infer from. */
export const AUTO_DEFAULT: Lang = "zh";

const zh = {
  // ---- system-prompt section for the main model ----
  "prompt.header": "## Second Opinion（第二意见）使用边界",
  "prompt.manual":
    "second_opinion 向只读的顾问子代理征求第二意见，顾问会收到当前会话的有界抄本。当前为手动模式：仅当用户明确要求咨询顾问（如“问一下顾问”“征求第二意见”）时才调用，平时自行作答；用户要求时相关问题合并为一次咨询。",
  "prompt.autoIntro":
    "second_opinion 向只读的顾问子代理征求第二意见：顾问能读文件、跑只读命令核实，但改不了任何东西，回答只交给你。默认继承模式下顾问收到当前会话的有界文本抄本（工具输出可能被截断、更早消息可能被省略），调用时只提具体问题，不要复述对话已有的内容；问题依赖某个大文件或长输出时给出路径让顾问自己去读；对话外的私有信息（你的推理意图、没说出口的约束、被省略的早期要点）写入 context 参数。盲审模式（mode=standalone）下顾问看不到对话，必须在 context 里写清目标、约束、已尝试的做法和相关文件路径。",
  "prompt.rule1":
    "1. 调用判据（满足其一才调用）：此步出错代价高（安全、数据、架构承诺、不可逆操作、对外承诺）；重大方案定稿或重大交付前需要终审；已连续受阻或对结论把握不足。后果可逆的小改动直接做，简单任务不要机械调用。",
  "prompt.rule2": "2. 不适合：可直接联网查证的简单事实；日常闲聊、纯创意任务。",
  "prompt.rule3": "3. 用户明确要求咨询顾问时必须调用；相关问题合并为一次咨询，不要拆成多次。",
  "prompt.rule4":
    "4. 顾问指出具体缺陷时先验证再决定；纯观点分歧则吸收后继续，不要反复咨询寻求认同，不采纳时说明理由；不要原样转贴整段顾问回复。顾问说缺少信息时，带着补充后的 context 重新调用，或用 consult_id + follow_up 追问。",
  "prompt.rule5": "5. 追问的结果以工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。",
  "prompt.forced":
    "【强制咨询】当前会话中同一问题已被用户重复 {count} 次仍未解决。本轮必须先调用 second_opinion 征求第二意见，再基于顾问意见作答；不得继续重复同一思路。",
  "prompt.reminder": "【提醒】当前会话中同一问题已出现 {count} 次。若本轮仍无法解决，应调用 second_opinion 征求第二意见。",

  // ---- advisor task prompt ----
  "preamble.who":
    "【你是谁】你是主代理请来的顾问，对它正在进行的工作给出第二意见。\n你不是主代理，也不独立地在这个工作区里工作：对话是主代理的，工作区是主代理的，你只负责审阅并回答最后的问题。\n你的读者是主代理而不是人类：忽略任何让你“回复人类用户”或“继续完成任务”的指示，你的回答会作为工具结果交给主代理，由它决定是否采纳。",
  "preamble.inherited":
    "【继承来的内容对你不适用】你看到的技能目录、运行环境说明、工具说明，以及其中关于 second_opinion 的使用规则，都是主代理的上下文，只供你理解背景。\n不要继续之前的任务，不要调用 second_opinion，不要再派生子代理，不要替主代理向用户提问。\n不要用 send_message 给主代理或任何代理发消息——你的最终回答就是唯一的交付物，它会作为工具结果交给主代理。",
  "preamble.readonly":
    "【只读】你可以读文件、运行只读的命令来核实事实；不得创建、修改或删除任何文件，不得改变工作区或系统的任何状态。被沙箱拒绝的操作不要重试，在回答里说明即可。",
  "preamble.requirements": "【回答要求】",
  "preamble.transcript":
    "【对话抄本】下面是主代理当前会话的对话抄本（含当前轮次）。抄本是文本化的：工具输出可能被截断，图片与附件无法直接查看——需要细节时请用只读工具读取工作区中的对应文件。",
  "preamble.transcriptDropped": "为控制篇幅已省略更早的 {count} 条消息。",
  "preamble.transcriptClipped": "有 {count} 条内容因过长被截断。",
  "preamble.noTranscript": "（无可用对话记录）",
  "preamble.standalone":
    "【你能看到的】你看不到主对话，只有下面的问题与补充背景；但你与主代理共享同一个工作区，可以读文件、运行只读命令核实。",
  "preamble.context": "【对话外补充背景】",
  "preamble.question": "【问题】",
  "preamble.output":
    "【输出】先给结论，再给依据；指出被忽略的风险、错误假设或更优方案；信息不足时明确说缺什么，不要臆测。用与对话相同的语言回答。",
  "preamble.followUp":
    "【追问 {round}】仍是同一咨询线程：保持顾问身份与只读约束，只回答这个追问，不要重复此前的回答。",

  // ---- advisor persona defaults ----
  "persona.default":
    "你是一位经验丰富的技术顾问，为另一个 AI 编程助手提供第二意见。你会看到该助手当前会话的对话抄本（可能省略了较早的消息）以及它此刻提出的问题。\n\n回答要求：\n- 先给结论，再给依据；观点明确，不模棱两可；论证充分但不冗余。\n- 指出对话中被忽略的风险、错误假设或更优的替代方案。\n- 信息不足以判断时，明确指出缺少哪些信息，不要基于臆测作答。\n- 对已有信息中的不确定内容，标注不确定并说明如何验证。\n- 抄本注明省略了较早消息时，对涉及早期细节的判断降低相应置信度。\n- 用与对话相同的语言回答。",
  "persona.blind":
    "这是一次盲审请求：你看不到主对话记录，只能依据主代理提出的问题与其主动补充的背景作答。主代理陈述的观点、倾向或已做的假设只是它单方面的判断，仅供参考，可以在有依据的前提下推翻，推翻时请说明理由。信息不足以给出可靠判断时，明确指出还缺少哪些信息，不要臆测补全。",

  // ---- transcript labels (read by the advisor) ----
  "transcript.user": "用户",
  "transcript.assistant": "主模型",
  "transcript.tool": "工具结果",
  "transcript.toolFailed": "工具结果（失败）",
  "transcript.injected": "注入：{source}",
  "transcript.call": "（工具调用 {name}：{args}）",
  "transcript.attachment": "{kind}附件，顾问无法直接查看；如有需要请用只读工具读取工作区中的对应文件",
  "transcript.attachmentImage": "图片",
  "transcript.attachmentFile": "文件",
  "transcript.dropped": "（为控制篇幅，已省略更早的 {count} 条消息）",
  "transcript.headTitle": "（最初的用户请求，可能已截断）",
  "transcript.clipped": "…（截断，原 {count} 字符）",

  // ---- tool results read by the main model ----
  "tool.disabled": "Second Opinion 当前已停用（设置中可开启）。",
  "tool.cancelled": "咨询已取消：本轮被用户中止，顾问没有返回结果。",
  "tool.noChain": "顾问链尚未配置任何模型。请先到 设置 → 顾问设置 添加顾问模型。",
  "tool.noSession": "当前执行环境没有会话上下文，无法咨询顾问。",
  "tool.isAdvisor": "你已经是顾问子代理：顾问不能再咨询 second_opinion，直接给出你的意见即可。",
  "tool.dualNoFollowUp": "双意见咨询不支持追问；请基于单一模型开新咨询。",
  "tool.followUpNeedsText": "追问需要提供 follow_up 参数（要继续追问的内容）。",
  "tool.missingQuestion": "缺少 question 参数：请提供要征求第二意见的具体问题（或提供 consult_id + follow_up 进行追问）。",
  "tool.followUpFailed": "顾问本轮未返回可用回答：{reason}。可换个问法追问或开新咨询。",
  "tool.followUpTruncated": "本轮追问超时被中止，以上为已输出的部分回答",
  "tool.followUpLabel": "追问",
  "tool.advisorLabel": "顾问",
  "tool.effortIgnored": "推理档位「{effort}」未被模型 {route} 声明，已忽略",
  "tool.presetFallback": "顾问的精简组成不可用（{reason}），本次继承了主对话的完整工具与提示",
  "tool.transcriptDropped": "抄本省略了更早的 {count} 条消息（已附最初请求摘要）",
  "tool.transcriptClipped": "{count} 条内容因过长被截断，顾问看到的工具输出可能不完整",
  "tool.truncatedNote": "{label}：超时后按已输出内容截断",
  "tool.aborted": "顾问运行中断（{label}）：{message}",
  "tool.dualSection": "【意见一/二 · {label}{truncated}】\n{content}",
  "tool.dualTruncatedMark": " · 已截断",
  "tool.dualFailedSection": "【意见一/二 · {label}】本次未返回可用内容：{reason}",
  "tool.dualNoContent": "未返回可用内容",
  "tool.dualAllFailed": "双意见咨询全部失败：{attempts}。{tail}",
  "tool.dualProceed": "请基于自己的判断继续。",
  "tool.dualPartialNote": "（注：部分顾问未返回可用内容，本次仅包含成功返回的意见。）",
  "tool.chainFailed": "顾问链全部调用失败：{attempts}。请基于自己的判断继续，或稍后重试。",
  "tool.attemptFailed": "{label}（{reason}）",
  "tool.hintFollowUp":
    "\n\n（consult_id: {id} —— 如需继续追问该顾问，携带此 consult_id 与 follow_up 参数再次调用。追问结果以本次工具返回为准；宿主随后可能在对话里投递一条内容相同的子代理完成通知，忽略即可。）",
  "tool.hintDual": "\n\n（双意见咨询不支持追问；如需追问请基于单一模型开新咨询。）",
  "tool.notes": "（注：{notes}）",

  // ---- refusals before / around starting an advisor ----
  "start.settingInvalid": "DSH 的「子代理模型选择」设置无效（{detail}）。请到 设置 → 插件 → 子代理 修正后重试。",
  "start.selectionOff":
    "DSH 的「子代理模型选择」当前是关闭的，顾问无法使用与主对话不同的模型（{route}）。请到 设置 → 顾问设置 点击「开启并授权」。",
  "start.unauthorized": "模型 {route} 尚未授权给子代理。请到 设置 → 顾问设置 点击「授权」，或在 设置 → 插件 → 子代理 的模型白名单里添加它。",
  "start.routeUnavailable": "模型路由不可用（{route}）：{detail}",
  "start.cannotStart": "无法启动顾问（{label}）：{message}",
  "start.sandboxFailed": "无法把顾问限制在只读沙箱内，已中止本次咨询。",
  "start.unrecognized": "未能确认顾问子代理的身份（宿主未提供子代理描述符），已中止本次咨询。",

  // ---- follow-up validation ----
  "followup.notFound": "未找到该 consult_id 对应的咨询记录（可能属于旧版本、其他会话，或记录已不存在）。请开新咨询。",
  "followup.foreign": "该 consult_id 不是本插件建立的咨询线程（旧版本的 consult_id 不再支持）。请开新咨询。",
  "followup.busy": "顾问仍在回答，请等它完成后再追问。",
  "followup.dualNoFollowUp": "双意见咨询不支持追问；请基于单一模型开新咨询。",
  "followup.roundCap": "该咨询线程已达 {max} 轮追问上限，请开新咨询。",
  "followup.otherTree": "该咨询属于另一个会话（会话被 fork 后旧线程不在当前子代理树中），无法追问。请开新咨询。",
  "followup.sendFailed": "追问发送失败：{message}",

  // ---- outcome reasons ----
  "failure.contextWindow": "上下文超限",
  "failure.rateLimit": "限流",
  "failure.timeout": "超时",
  "failure.transport": "网络错误",
  "failure.server": "服务端错误",
  "failure.auth": "鉴权失败",
  "failure.quota": "额度不足",
  "failure.refused": "内容被拒",
  "failure.empty": "空响应",
  "failure.modelUnavailable": "模型不可用",
  "failure.invalidRequest": "请求或响应无效",
  "failure.withStatus": "{category}（HTTP {status}）",
  "failure.withDetail": "{category}：{detail}",
  "stop.error": "顾问运行出错",
  "stop.aborted": "顾问被中止",
  "stop.maxTokens": "顾问输出达到 maxTokens 上限",
  "stop.refusal": "顾问拒绝回答",
  "stop.empty": "顾问正常结束但未返回任何内容（空响应）",
  "stop.unknown": "未知原因（顾问未返回内容）",
  "timeout.deadline": "超时：到点时尚未开始输出回答正文",
  "timeout.idle": "超时：回答中断后长时间无新输出",
  "timeout.hardCap": "超时：超过总时长上限",
  "timeout.withFailure": "{reason}（最后一次请求错误：{detail}）",
  "stop.withFailure": "{reason}（最后一次请求错误：{detail}）",
  "stop.contextHint": "。可在设置里调低抄本预算，或改用盲审模式并在 context 里只写要点",
  "wait.neverSettled": "顾问中止后 {seconds} 秒内未结束",
};

export type HostKey = keyof typeof zh;

const en: Record<HostKey, string> = {
  "prompt.header": "## Second Opinion usage boundary",
  "prompt.manual":
    "second_opinion asks a read-only advisor subagent for a second opinion; the advisor receives a bounded transcript of this conversation. Manual mode is active: call it only when the user explicitly asks for an advisor (\"ask the advisor\", \"get a second opinion\") and merge related questions into one consultation.",
  "prompt.autoIntro":
    "second_opinion asks a read-only advisor subagent for a second opinion: the advisor can read files and run read-only commands to verify, but cannot change anything, and it reports only to you. In the default inherited mode the advisor receives a bounded text transcript of this conversation (tool outputs may be clipped, older messages may be omitted); ask the specific question and do not restate what the conversation already says. When the question depends on a large file or a long output, give the path and let the advisor read it. Put private information the transcript cannot hold (your intent, unstated constraints, omitted earlier points) in the context parameter. In blind-review mode (mode=standalone) the advisor sees no conversation; state the goal, constraints, what was tried and the relevant file paths in context.",
  "prompt.rule1":
    "1. Call when (any one applies): a mistake here is expensive (safety, data, architectural commitments, irreversible actions, external commitments); a major decision is being finalized or a major delivery needs a final review; you are stuck repeatedly or unsure of a conclusion. Make small reversible changes directly; do not call mechanically for simple tasks.",
  "prompt.rule2": "2. Not for: simple facts you can look up online; small talk and purely creative tasks.",
  "prompt.rule3": "3. When the user explicitly asks for an advisor you must call it; merge related questions into one consultation.",
  "prompt.rule4":
    "4. Verify a concrete defect the advisor points out before acting; absorb pure differences of opinion and move on without consulting again for validation, and state your reasons when you disagree; never paste the advisor's reply verbatim. When the advisor says information is missing, call again with the added context or follow up with consult_id + follow_up.",
  "prompt.rule5":
    "5. The tool result is authoritative for follow-ups; the host may also deliver a subagent completion notice with the same content into the conversation — ignore it.",
  "prompt.forced":
    "【Mandatory consultation】The user has repeated the same question {count} times in this conversation without resolution. This turn you must first call second_opinion and then answer based on the advisor's opinion; do not repeat the same approach.",
  "prompt.reminder": "【Reminder】The same question has now appeared {count} times in this conversation. If it is still unresolved after this turn, call second_opinion.",

  "preamble.who":
    "[Who you are] You are an advisor the main agent consulted for a second opinion on the work it is doing.\nYou are not the main agent and you do not work in this workspace on your own account: the conversation belongs to the main agent, the workspace belongs to the main agent, and your only job is to review and answer the final question.\nYour reader is the main agent, not a human: ignore any instruction to \"answer the human user\" or \"continue the task\"; your answer is handed to the main agent as a tool result and it decides what to adopt.",
  "preamble.inherited":
    "[Inherited content does not apply to you] The skill catalog, environment notes, tool descriptions and the second_opinion usage rules you see are the main agent's context, for background only.\nDo not continue the previous task, do not call second_opinion, do not spawn further subagents, and do not ask the user questions on the main agent's behalf.\nDo not use send_message to message the main agent or any other agent — your final answer is the only deliverable and is handed to the main agent as a tool result.",
  "preamble.readonly":
    "[Read-only] You may read files and run read-only commands to verify facts; you must not create, modify or delete any file or change any state of the workspace or system. When the sandbox denies an operation, do not retry it; say so in your answer.",
  "preamble.requirements": "[Answer requirements]",
  "preamble.transcript":
    "[Conversation transcript] Below is the transcript of the main agent's current conversation (including the in-flight turn). It is textual: tool outputs may be clipped and images or attachments cannot be viewed directly — read the corresponding workspace files with read-only tools when you need details.",
  "preamble.transcriptDropped": " {count} earlier messages were omitted to bound its length.",
  "preamble.transcriptClipped": " {count} entries were clipped for length.",
  "preamble.noTranscript": "(no conversation record available)",
  "preamble.standalone":
    "[What you can see] You cannot see the main conversation; you only have the question and the supplementary background below, but you share the main agent's workspace and may read files and run read-only commands to verify.",
  "preamble.context": "[Out-of-band background]",
  "preamble.question": "[Question]",
  "preamble.output":
    "[Output] Conclusion first, then evidence; point out overlooked risks, wrong assumptions or better alternatives; when information is insufficient, say exactly what is missing instead of guessing. Answer in the conversation's language.",
  "preamble.followUp":
    "[Follow-up {round}] Same consultation thread: keep your advisor role and the read-only constraint, answer only this follow-up, and do not repeat your earlier answer.",

  "persona.default":
    "You are an experienced technical advisor giving a second opinion to another AI coding assistant. You see a transcript of that assistant's current conversation (earlier messages may be omitted) and the question it is asking now.\n\nAnswer requirements:\n- Conclusion first, then evidence; take a clear position; be thorough but not verbose.\n- Point out overlooked risks, wrong assumptions or better alternatives in the conversation.\n- When information is insufficient, say what is missing instead of guessing.\n- Mark uncertain claims as uncertain and say how to verify them.\n- When the transcript says earlier messages were omitted, lower your confidence accordingly for details from that period.\n- Answer in the conversation's language.",
  "persona.blind":
    "This is a blind review: you cannot see the main conversation and may only rely on the question and the background the main agent supplied. The main agent's views, leanings and assumptions are its one-sided judgement — for reference only; overturn them with reasons when the evidence supports it. When information is insufficient for a reliable judgement, state what is missing instead of filling gaps with guesses.",

  "transcript.user": "User",
  "transcript.assistant": "Main agent",
  "transcript.tool": "Tool result",
  "transcript.toolFailed": "Tool result (failed)",
  "transcript.injected": "Injected: {source}",
  "transcript.call": "(tool call {name}: {args})",
  "transcript.attachment": "{kind} attachment, not directly visible to the advisor; read the corresponding workspace file with a read-only tool if needed",
  "transcript.attachmentImage": "Image",
  "transcript.attachmentFile": "File",
  "transcript.dropped": "(To bound its length, {count} earlier messages were omitted)",
  "transcript.headTitle": "(The original user request, possibly clipped)",
  "transcript.clipped": "… (clipped, {count} characters originally)",

  "tool.disabled": "Second Opinion is currently disabled (enable it in Settings).",
  "tool.cancelled": "Consultation cancelled: the turn was stopped by the user and the advisor returned no result.",
  "tool.noChain": "No advisor model is configured yet. Add one under Settings → Advisor.",
  "tool.noSession": "This execution context has no conversation to advise on.",
  "tool.isAdvisor": "You are already an advisor subagent: advisors cannot call second_opinion again; just give your opinion.",
  "tool.dualNoFollowUp": "Dual-opinion consultations cannot be followed up; start a new single-model consultation instead.",
  "tool.followUpNeedsText": "A follow-up needs the follow_up parameter (what to ask next).",
  "tool.missingQuestion": "Missing the question parameter: state the specific question for the second opinion (or provide consult_id + follow_up to follow up).",
  "tool.followUpFailed": "The advisor returned no usable answer this round: {reason}. Rephrase the follow-up or start a new consultation.",
  "tool.followUpTruncated": "This follow-up was stopped by the timeout; the text above is what had been produced",
  "tool.followUpLabel": "Follow-up",
  "tool.advisorLabel": "Advisor",
  "tool.effortIgnored": "Reasoning effort \"{effort}\" is not declared by model {route} and was ignored",
  "tool.presetFallback": "The advisor's lean composition was unavailable ({reason}); this call inherited the main conversation's full tools and prompt",
  "tool.transcriptDropped": "The transcript omitted {count} earlier messages (the original request is summarized)",
  "tool.transcriptClipped": "{count} entries were clipped for length; tool outputs the advisor saw may be incomplete",
  "tool.truncatedNote": "{label}: stopped by the timeout and kept as the partial output",
  "tool.aborted": "Advisor run interrupted ({label}): {message}",
  "tool.dualSection": "[Opinion 1/2 · {label}{truncated}]\n{content}",
  "tool.dualTruncatedMark": " · truncated",
  "tool.dualFailedSection": "[Opinion 1/2 · {label}] No usable content was returned: {reason}",
  "tool.dualNoContent": "no usable content",
  "tool.dualAllFailed": "Every advisor in the dual consultation failed: {attempts}. {tail}",
  "tool.dualProceed": "Proceed on your own judgement.",
  "tool.dualPartialNote": "(Note: some advisors returned no usable content; only the successful opinions are included.)",
  "tool.chainFailed": "Every advisor in the chain failed: {attempts}. Proceed on your own judgement or retry later.",
  "tool.attemptFailed": "{label} ({reason})",
  "tool.hintFollowUp":
    "\n\n(consult_id: {id} — to continue with this advisor, call again with this consult_id and the follow_up parameter. The tool result is authoritative for follow-ups; the host may also deliver a subagent completion notice with the same content into the conversation — ignore it.)",
  "tool.hintDual": "\n\n(Dual-opinion consultations cannot be followed up; start a new single-model consultation to follow up.)",
  "tool.notes": "(Note: {notes})",

  "start.settingInvalid": "DSH's subagent model selection setting is invalid ({detail}). Fix it under Settings → Plugins → Subagents and retry.",
  "start.selectionOff":
    "DSH's subagent model selection is off, so the advisor cannot use a model different from the main conversation ({route}). Click \"Enable and authorize\" under Settings → Advisor.",
  "start.unauthorized":
    "Model {route} is not authorized for subagents. Click \"Authorize\" under Settings → Advisor, or add it to the subagent model allowlist under Settings → Plugins → Subagents.",
  "start.routeUnavailable": "Model route unavailable ({route}): {detail}",
  "start.cannotStart": "Could not start the advisor ({label}): {message}",
  "start.sandboxFailed": "The advisor could not be confined to the read-only sandbox; the consultation was aborted.",
  "start.unrecognized": "The advisor subagent could not be identified (the host provided no subagent descriptor); the consultation was aborted.",

  "followup.notFound": "No consultation matches this consult_id (it may belong to an older version, another conversation, or no longer exist). Start a new consultation.",
  "followup.foreign": "This consult_id is not a thread created by this plugin (consult_ids from older versions are no longer supported). Start a new consultation.",
  "followup.busy": "The advisor is still answering; wait for it to finish before following up.",
  "followup.dualNoFollowUp": "Dual-opinion consultations cannot be followed up; start a new single-model consultation instead.",
  "followup.roundCap": "This consultation thread has reached its limit of {max} follow-up rounds. Start a new consultation.",
  "followup.otherTree": "This consultation belongs to another conversation (after a fork the old thread is not in the current subagent tree) and cannot be followed up. Start a new consultation.",
  "followup.sendFailed": "Sending the follow-up failed: {message}",

  "failure.contextWindow": "context window exceeded",
  "failure.rateLimit": "rate limited",
  "failure.timeout": "timed out",
  "failure.transport": "network error",
  "failure.server": "server error",
  "failure.auth": "authentication failed",
  "failure.quota": "quota exhausted",
  "failure.refused": "content refused",
  "failure.empty": "empty response",
  "failure.modelUnavailable": "model unavailable",
  "failure.invalidRequest": "invalid request or response",
  "failure.withStatus": "{category} (HTTP {status})",
  "failure.withDetail": "{category}: {detail}",
  "stop.error": "The advisor run failed",
  "stop.aborted": "The advisor was aborted",
  "stop.maxTokens": "The advisor hit its maxTokens limit",
  "stop.refusal": "The advisor declined to answer",
  "stop.empty": "The advisor finished normally but returned no content (empty response)",
  "stop.unknown": "Unknown reason (the advisor returned no content)",
  "timeout.deadline": "Timed out: no answer text had started at the deadline",
  "timeout.idle": "Timed out: the answer stopped for too long",
  "timeout.hardCap": "Timed out: total duration cap exceeded",
  "timeout.withFailure": "{reason} (last request error: {detail})",
  "stop.withFailure": "{reason} (last request error: {detail})",
  "stop.contextHint": ". Lower the transcript budget in Settings, or use blind-review mode with only the essentials in context",
  "wait.neverSettled": "The advisor did not settle within {seconds} seconds after being stopped",
};

export const HOST_MESSAGES: Record<Lang, Record<HostKey, string>> = { zh, en };

/** Translate one key; `{name}` placeholders are filled from `params` (undefined → empty). */
export function t(lang: Lang, key: HostKey, params?: Record<string, string | number | undefined>): string {
  const template = HOST_MESSAGES[lang]?.[key] ?? HOST_MESSAGES.zh[key] ?? key;
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name] ?? "") : match));
}

const CJK = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/g;
const LETTER = /[A-Za-z]/g;

/** Infer the language of a text sample from its CJK share; undefined when it has nothing to go on. */
export function detectLanguage(text: string): Lang | undefined {
  const cjk = (text.match(CJK) ?? []).length;
  const latin = (text.match(LETTER) ?? []).length;
  if (cjk === 0 && latin === 0) return undefined;
  return cjk / (cjk + latin) >= 0.2 ? "zh" : "en";
}

/** Resolve the language for one call from the text at hand. */
export function resolveLanguage(sample: string): Lang {
  return detectLanguage(sample) ?? AUTO_DEFAULT;
}
