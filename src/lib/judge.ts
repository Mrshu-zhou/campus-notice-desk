export interface JudgeFact {
  title: string;
  text: string;
}

export const JUDGE_COPY = {
  title: "通知不再被淹没，待办会主动找人",
  intro: "面向学生。班级群和邮件里，通知常和闲聊混在一起，看过了也可能忘了办。把文字或截图放进来，确认后会变成能回到原文、到点会提醒的待办。不监听微信、QQ 或邮箱。",
  facts: [
    { title: "只留下要办的事", text: "只提取要办的事，闲聊和知识分享不会进待办。" },
    { title: "每条都回得到原处", text: "每条都能对回原话或截图，不对的可以改，重复通知会先问你是不是同一件。" },
    { title: "到点主动叫你", text: "到点会用电脑或手机的系统通知提醒你，正在忙可以选稍后再叫。" },
  ] satisfies JudgeFact[],
  boundary: "演示素材是虚构的校园通知；你的待办只保存在当前浏览器；关闭这个网页后，网页端无法继续提醒。",
} as const;

export type TourEvent = "draft-ready" | "review-open" | "decision" | "relation-choice" | "saved";

export interface TourStep {
  id: string;
  targets: string[];
  title: string;
  text: string;
  missingHint?: string;
  advanceOn?: TourEvent;
  optional?: boolean;
}

export const TOUR_STEPS: TourStep[] = [
  {
    id: "intake",
    targets: ['[data-tour="intake-heading"]', '[data-tour="intake"]'],
    title: "从一条通知开始",
    text: "在「添加通知」里可以连续粘贴多段文字，也可以添加最多 4 张通知截图。只有你会决定整理哪一条，应用不监听任何聊天软件。",
    missingHint: "如果看不到添加区，请点上方「添加通知」；桌面端它在右侧面板。",
    advanceOn: "draft-ready",
  },
  {
    id: "submit",
    targets: ['[data-tour="intake-submit"]'],
    title: "一次整理整批素材",
    text: "文字和截图放进同一个草稿后，点「整理这批通知」。截图会逐张读出文字；这需要本站的 Cloud Agent 可用，通常等待 10–75 秒。",
    missingHint: "先添加文字或截图，「整理这批通知」按钮才会变为可点击。",
    advanceOn: "review-open",
  },
  {
    id: "review",
    targets: ['[data-tour="review"]', ".review-modal"],
    title: "先核对，再写入待办",
    text: "结果不会直接变成待办。核对窗口会说明哪些生成候选、哪些没有生成及原因；先对每条选择「要办 / 稍后 / 与我无关」，选完会自动进入下一步。",
    missingHint: "完成上一步后会打开核对窗口，这里会高亮候选卡片。",
    advanceOn: "decision",
  },
  {
    id: "relation",
    targets: ['[data-tour="review-relation"]'],
    title: "重复与变化，由你决定",
    text: "如果这条候选和已有任务相似，这里会真实列出相似任务和变化项。可选择仍新建、合并或更新；没有你的选择，已有任务不会被改动。",
    missingHint: "这次演示没有相似任务，已跳过合并/更新；真实遇到重复时，关系选择会出现在核对卡片里。",
    advanceOn: "relation-choice",
    optional: true,
  },
  {
    id: "save",
    targets: ['[data-tour="review-save"]'],
    title: "改到能用，再保存",
    text: "可修改截止日期、开始时刻、地点、材料和补充要求，也可以选「与我无关」不加入。保存前还能设置提醒。",
    missingHint: "核对窗口的底部有保存按钮。",
    advanceOn: "saved",
  },
  {
    id: "today",
    targets: ['[data-tour="today-focus"]'],
    title: "保存后，待办留在通知和看板里",
    text: "已保存的通知会留在通知列表和看板中，手机点「原文依据」还能回看原句；本批草稿在保存成功后自动清空，避免重复整理。可以先看优先处理区，再回到「添加通知」添加下一批通知。",
    missingHint: "保存后点上方「待办」即可看到优先处理区；看板也能看到全部待办。",
  },
];

export function advanceTourStep(stepIndex: number, event: TourEvent) {
  if (stepIndex < 0 || stepIndex >= TOUR_STEPS.length) return null;
  if (event === "saved") return TOUR_STEPS.length - 1;
  const step = TOUR_STEPS[stepIndex];
  if (step.advanceOn !== event) return null;
  return Math.min(stepIndex + 1, TOUR_STEPS.length - 1);
}

export function skipOptionalTourStep(stepIndex: number) {
  if (stepIndex < 0 || stepIndex >= TOUR_STEPS.length) return null;
  return TOUR_STEPS[stepIndex].optional ? Math.min(stepIndex + 1, TOUR_STEPS.length - 1) : null;
}

/** Auto-loading the demo fills the draft without consuming the first step. */
export function demoLoadTourEvent(source: "auto" | "manual"): TourEvent | null {
  return source === "manual" ? "draft-ready" : null;
}

/** Real actions always win: opening review jumps to the review step and stays. */
export function applyTourEvent(current: number | null, event: TourEvent): number | null {
  if (current === null) return null;
  if (event === "review-open") return Math.max(current, 2);
  // A step that does not consume the event stays put; null means "not consumed", not "exit".
  return advanceTourStep(current, event) ?? current;
}