import { Braces, Check, Filter, Inbox, ListPlus } from "lucide-react";
import type { ExtractionResult } from "../types";

export type DemoPhase = "idle" | "ingest" | "classify" | "extract" | "write" | "complete" | "failed";

const steps = [
  { id: "ingest", label: "接入", note: "接收新消息", icon: Inbox },
  { id: "classify", label: "识别", note: "排除闲聊与分享", icon: Filter },
  { id: "extract", label: "抽取", note: "任务回指原文", icon: Braces },
  { id: "write", label: "写入", note: "核对后加入待办", icon: ListPlus },
] as const;

function logFor(phase: DemoPhase, origin: ExtractionResult["mode"] | null, error: string) {
  if (phase === "idle") return "当前只有闲聊，不生成任务。点击「模拟：班长发来通知」，新消息会进入同一会话后再处理。";
  if (phase === "ingest") return "班长的新消息已进入当前群聊，正在接入拆解服务…";
  if (phase === "classify" || phase === "extract") return "正在识别正式通知并抽取任务，进度由实际请求状态更新，而不是倒计时动画。";
  if (phase === "write") return "已收到处理结果，正在核对原文摘录、截止日期和合并规则，随后写入待办。";
  if (phase === "failed") return error || "处理失败。在线拆解不可用时，不会用动画或静态回放冒充在线 Agent。";
  if (origin === "cloud_agent") return "Cloud Agent 已拆解并写入待办：任务可点击查看依据，已读不会改变完成状态。";
  return "已写入离线已核对任务（未调用 Cloud Agent）。3 条任务可点击回查原文，已读不会改变完成状态。";
}

export function Pipeline({
  phase,
  origin = null,
  error = "",
}: {
  phase: DemoPhase;
  origin?: ExtractionResult["mode"] | null;
  error?: string;
}) {
  const pending = phase === "ingest" || phase === "classify" || phase === "extract" || phase === "write";
  const activeIndex = phase === "complete" ? steps.length : phase === "failed" ? Math.max(steps.findIndex((step) => step.id === "extract"), 0) : steps.findIndex((step) => step.id === phase);
  const originLabel = origin === "cloud_agent" ? "Cloud Agent 拆解" : origin ? "离线已核对" : phase === "idle" ? "待处理" : pending ? "处理中" : phase === "failed" ? "未完成" : "已核对演示";
  return (
    <section className="pipeline" aria-label="通知拆解技术流程">
      <div className="pipeline-title">
        <span>识别过程</span>
        <span className="demo-label" data-origin={origin ?? phase}>{originLabel}</span>
      </div>
      <ol className="pipeline-steps">
        {steps.map((step, index) => {
          const Icon = step.icon;
          const state = index < activeIndex || phase === "complete" ? "done" : index === activeIndex || (pending && index === Math.max(activeIndex, 0)) ? "active" : "";
          return (
            <li className={state} key={step.id}>
              <span className="pipeline-icon">{state === "done" ? <Check size={14} /> : <Icon size={14} />}</span>
              <div><strong>{index + 1}. {step.label}</strong><span>{step.note}</span></div>
            </li>
          );
        })}
      </ol>
      <p className="pipeline-log" aria-live="polite">{logFor(phase, origin, error)}</p>
    </section>
  );
}
