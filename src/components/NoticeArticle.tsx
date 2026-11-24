import { useEffect, useRef } from "react";
import { ArrowLeft, CheckCheck, ClipboardPaste, Mail, MessageSquareText } from "lucide-react";
import { formatReceivedAt } from "../lib/tasks";
import type { Notice, Task } from "../types";

function HighlightedText({ text, quote }: { text: string; quote?: string }) {
  if (!quote) return <>{text}</>;
  const index = text.indexOf(quote);
  if (index < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, index)}
      <mark id="source-highlight">{quote}</mark>
      {text.slice(index + quote.length)}
    </>
  );
}

interface Props {
  notice: Notice;
  selectedTask?: Task;
  onToggleRead: () => void;
  mobileHidden?: boolean;
  onBack?: () => void;
}

export function NoticeArticle({ notice, selectedTask, onToggleRead, mobileHidden, onBack }: Props) {
  const articleRef = useRef<HTMLDivElement>(null);
  const quote = selectedTask?.sourceQuote;

  useEffect(() => {
    if (!quote) return;
    const timer = window.setTimeout(() => {
      document.getElementById("source-highlight")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    return () => window.clearTimeout(timer);
  }, [quote, notice.id]);

  return (
    <section className={`panel article-panel ${mobileHidden ? "mobile-hidden" : ""}`} aria-label="通知原文">
      <div className="panel-heading article-heading">
        <div>
          {onBack && <button className="icon-button back-button" type="button" onClick={onBack} aria-label="返回通知列表"><ArrowLeft size={17} /></button>}
          {notice.adapter === "paste_import" ? <ClipboardPaste size={16} /> : notice.thread ? <MessageSquareText size={16} /> : <Mail size={16} />}
          <h2>{notice.adapter === "paste_import" ? "粘贴原文" : notice.thread ? "群聊原文" : "邮件原文"}</h2>
        </div>
        <button type="button" className="text-button" onClick={onToggleRead}>
          <CheckCheck size={15} />{notice.read ? "标为未读" : "标为已读"}
        </button>
      </div>
      <div className="article-context">
        <strong>{notice.sourceLabel}</strong>
        <span>{formatReceivedAt(notice.receivedAt)} · 已读不等于已完成</span>
      </div>
      <div className="article-scroll" ref={articleRef}>
        {notice.thread ? (
          <div className="thread">
            {notice.thread.map((message, index) => {
              const official = /班长|老师|课代表|学生处/.test(message.sender);
              return (
                <div className={`message ${official ? "official" : ""}`} key={`${message.time}-${index}`}>
                  <div className="message-author"><strong>{message.sender}</strong><span>{message.time}</span></div>
                  <div className="message-bubble"><HighlightedText text={message.text} quote={quote} /></div>
                </div>
              );
            })}
          </div>
        ) : (
          <article className="mail-body">
            <h3>{notice.title}</h3>
            <p className="mail-from">来自 {notice.sourceLabel}</p>
            <div><HighlightedText text={notice.body} quote={quote} /></div>
          </article>
        )}
      </div>
    </section>
  );
}
