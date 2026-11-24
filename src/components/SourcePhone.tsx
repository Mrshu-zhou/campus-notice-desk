import { useEffect, useRef } from "react";
import { FlaskConical, Mail, MessageSquareText, Play } from "lucide-react";
import type { DemoPhase } from "../lib/pipeline";
import type { Notice, Role } from "../types";

interface Props {
  role: Role;
  notice?: Notice;
  phase: DemoPhase;
  busy: boolean;
  onSimulate: () => void;
  onManualTest: () => void;
}

export function SourcePhone({ role, notice, phase, busy, onSimulate, onManualTest }: Props) {
  const isMail = Boolean(notice && !notice.thread);
  const bodyRef = useRef<HTMLDivElement>(null);
  const threadLength = notice?.thread?.length ?? 0;

  useEffect(() => {
    const body = bodyRef.current;
    if (!body) return;
    body.scrollTop = isMail ? 0 : body.scrollHeight;
  }, [isMail, notice?.id, threadLength, phase]);

  return (
    <div className="source-phone">
      <p className="sim-banner">模拟消息源 · 仅用于演示，未接入真实微信或邮件</p>
      <div className="phone-frame">
        <div className="phone-speaker" aria-hidden="true" />
        <header className="phone-bar">
          {isMail ? <Mail size={14} /> : <MessageSquareText size={14} />}
          <div>
            <strong>{notice?.sourceLabel ?? (role === "student" ? "班级群" : "邮箱")}</strong>
            <small>{isMail ? "模拟邮件" : "模拟群聊"}</small>
          </div>
        </header>
        <div className="phone-body" ref={bodyRef}>
          {notice?.thread ? (
            <div className="thread phone-thread">
              {notice.thread.map((message, index) => {
                const official = /班长|老师|课代表|学生处|辅导员/.test(message.sender);
                return (
                  <div className={`message ${official ? "official" : ""}`} key={`${message.time}-${index}`}>
                    <div className="message-author"><strong>{message.sender}</strong><span>{message.time}</span></div>
                    <div className="message-bubble">{message.text}</div>
                  </div>
                );
              })}
            </div>
          ) : notice ? (
            <article className="mail-body phone-mail">
              <h3>{notice.title}</h3>
              <p className="mail-from">来自 {notice.sourceLabel}</p>
              <div className="phone-mail-text">{notice.body}</div>
            </article>
          ) : (
            <p className="phone-empty">当前角色没有可演示的模拟消息。</p>
          )}
        </div>
        {role === "student" && (phase === "idle" || phase === "failed" || phase === "complete") && (
          <div className="phone-action">
            <div className="phone-action-row">
              <button type="button" className={phase === "complete" ? "secondary-button" : "primary-button"} onClick={onSimulate} disabled={busy}>
                <Play size={15} />{phase === "complete" ? "重新演示" : "班长发来通知"}
              </button>
              <button type="button" className="secondary-button" onClick={onManualTest} disabled={busy}>
                <FlaskConical size={15} />自己测一条
              </button>
            </div>
            <small>左侧会同步显示拆解流程与核对结果</small>
          </div>
        )}
        {role === "counselor" && (
          <div className="phone-action">
            <button type="button" className="primary-button" onClick={onManualTest}>
              <FlaskConical size={15} />自己测一条
            </button>
            <small>粘贴任意通知，左侧会同步显示拆解流程与核对结果</small>
          </div>
        )}
      </div>
    </div>
  );
}
