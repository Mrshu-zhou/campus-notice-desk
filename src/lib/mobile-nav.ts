export type MobileSection = "intake" | "tasks" | "source";

export type WorkbenchView = "workbench" | "board";

export interface MobileSectionDefinition {
  id: MobileSection;
  label: string;
  hint: string;
}

export const MOBILE_SECTIONS: MobileSectionDefinition[] = [
  { id: "intake", label: "添加通知", hint: "添加文字或截图并整理" },
  { id: "tasks", label: "待办", hint: "核对结果、提醒与完成状态" },
  { id: "source", label: "原文依据", hint: "查看通知原句与截图" },
];

export function mobileSectionLabel(section: MobileSection) {
  return MOBILE_SECTIONS.find((item) => item.id === section)?.label ?? "待办";
}

/**
 * The board is a detailed view of the task section, never a separate mobile
 * tab, so leaving it always lands back on 待办.
 */
export function mobileSectionForView(view: WorkbenchView, current: MobileSection): MobileSection {
  return view === "board" ? "tasks" : current;
}

/** After a batch is saved or a reminder is opened, the user expects to land on tasks. */
export function sectionAfterSave(): MobileSection {
  return "tasks";
}