import { useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  Bell,
  ChevronLeft,
  ChevronRight,
  ClipboardPaste,
  GraduationCap,
  Info,
  ListChecks,
  Play,
  Quote,
  X,
} from "lucide-react";
import { JUDGE_COPY, TOUR_STEPS } from "../lib/judge";
import { computeTourPosition, type TourObstacle } from "../lib/tour-position";

const TOUR_OBSTACLE_SELECTORS = [
  '[data-tour="intake-submit"]',
  '[data-tour="intake-running"]',
  ".intake-submit-error",
  '[data-tour="review-save"]',
];

interface JudgeProps {
  onClose: () => void;
  onStart: (mode: "tour" | "own") => void;
}

const FACT_ICONS = [ListChecks, Quote, Bell];

export function JudgeDialog({ onClose, onStart }: JudgeProps) {
  return (
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="modal judge-modal" role="dialog" aria-modal="true" aria-labelledby="judge-title">
        <button type="button" className="icon-button modal-close" onClick={onClose} aria-label="关闭评委介绍"><X size={18} /></button>
        <div className="judge-scroll">
          <header className="judge-head">
            <span className="intake-kicker"><GraduationCap size={13} />评委三分钟了解</span>
            <h2 id="judge-title">{JUDGE_COPY.title}</h2>
            <p className="modal-intro">{JUDGE_COPY.intro}</p>
          </header>

          <div className="judge-facts">
            {JUDGE_COPY.facts.map((fact, index) => {
              const Icon = FACT_ICONS[index];
              return (
                <article key={fact.title}>
                  <Icon size={17} />
                  <strong>{fact.title}</strong>
                  <p>{fact.text}</p>
                </article>
              );
            })}
          </div>

          <div className="judge-boundary">
            <Info size={14} />
            <p>{JUDGE_COPY.boundary}</p>
          </div>
        </div>

        <footer className="judge-actions">
          <button type="button" className="secondary-button" onClick={() => onStart("own")}>
            <ClipboardPaste size={15} />用我自己的通知试试
          </button>
          <button type="button" className="primary-button" onClick={() => onStart("tour")}>
            <Play size={15} />跟着走一遍
          </button>
        </footer>
      </section>
    </div>
  );
}

interface CoachProps {
  step: number;
  onStep: (step: number) => void;
  onExit: () => void;
}

export function TourCoach({ step, onStep, onExit }: CoachProps) {
  const current = TOUR_STEPS[step];
  const [missing, setMissing] = useState(false);
  const [position, setPosition] = useState<{ top: number; left: number; width?: number } | null>(null);
  const targetRef = useRef<HTMLElement | null>(null);
  const coachRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!current) return;
    let disposed = false;
    let highlighted: HTMLElement | null = null;
    const clear = () => {
      highlighted?.classList.remove("tour-target");
      highlighted = null;
      targetRef.current = null;
    };
    const place = (target: HTMLElement) => {
      const rect = target.getBoundingClientRect();
      const bubbleHeight = coachRef.current?.offsetHeight ?? 240;
      const obstacles: TourObstacle[] = [];
      for (const selector of TOUR_OBSTACLE_SELECTORS) {
        const node = document.querySelector<HTMLElement>(selector);
        if (!node || node === target) continue;
        const box = node.getBoundingClientRect();
        if (box.width <= 0 || box.height <= 0) continue;
        obstacles.push({ top: box.top, left: box.left, right: box.right, bottom: box.bottom });
      }
      setPosition(computeTourPosition(
        { top: rect.top, left: rect.left, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height },
        { width: window.innerWidth, height: window.innerHeight, mobile: window.innerWidth <= 760 },
        { width: 340, height: bubbleHeight },
        obstacles,
      ));
    };
    const onMove = () => {
      if (targetRef.current) place(targetRef.current);
    };
    // The bubble's real height depends on the step copy; re-place after it renders
    // and whenever the copy wraps differently (mobile widths, font scaling).
    const resizeObserver = new ResizeObserver(() => onMove());
    if (coachRef.current) resizeObserver.observe(coachRef.current);
    const timer = window.setTimeout(() => {
      if (!disposed) setMissing(true);
    }, 6000);
    const find = () => {
      if (disposed) return;
      for (const selector of current.targets) {
        const target = document.querySelector<HTMLElement>(selector);
        if (!target) continue;
        if (highlighted !== target) {
          clear();
          highlighted = target;
          targetRef.current = target;
          target.classList.add("tour-target");
          target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
        }
        place(target);
        setMissing(false);
        window.clearTimeout(timer);
        return;
      }
    };
    const observer = new MutationObserver(find);
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    const raf = requestAnimationFrame(find);
    const settle = window.setTimeout(find, 400);
    document.body.classList.add("tour-running");
    return () => {
      disposed = true;
      observer.disconnect();
      resizeObserver.disconnect();
      window.clearTimeout(timer);
      window.clearTimeout(settle);
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
      cancelAnimationFrame(raf);
      document.body.classList.remove("tour-running");
      clear();
    };
  }, [current]);

  useEffect(() => {
    if (!current?.optional) return;
    const timer = window.setTimeout(() => {
      const exists = current.targets.some((selector) => document.querySelector(selector));
      if (!exists) onStep(step + 1);
    }, 1800);
    return () => window.clearTimeout(timer);
  }, [current, step, onStep]);

  if (!current) return null;
  const last = step >= TOUR_STEPS.length - 1;

  return (
    <aside
      ref={coachRef}
      className="tour-coach"
      role="region"
      aria-label={`评委跟随引导：${current.title}`}
      style={position ? { top: position.top, left: position.left, width: position.width, bottom: "auto" } : undefined}
    >
      <header>
        <span><GraduationCap size={13} />跟着走一遍</span>
        <strong>{step + 1} / {TOUR_STEPS.length}</strong>
        <button type="button" className="icon-button" onClick={onExit} aria-label="退出引导"><X size={15} /></button>
      </header>
      <h3>{current.title}</h3>
      <p>{current.text}</p>
      {current.advanceOn && !last && (
        <p className="tour-auto-note">{current.optional ? "这次没有相似任务时会自动跳过。" : "完成上一步操作后，会自动进入下一步。"}</p>
      )}
      {missing && (
        <div className="tour-missing"><Info size={13} /><span>{current.missingHint}</span></div>
      )}
      <footer>
        <div className="tour-dots" aria-hidden="true">
          {TOUR_STEPS.map((item, index) => <span className={index === step ? "active" : ""} key={item.id} />)}
        </div>
        <div className="tour-actions">
          <button type="button" className="text-button" onClick={onExit}>退出</button>
          <button type="button" className="secondary-button compact-button" onClick={() => onStep(step - 1)} disabled={step === 0}>
            <ChevronLeft size={13} />上一步
          </button>
          {last ? (
            <button type="button" className="primary-button compact-button" onClick={onExit}>
              完成引导<ArrowRight size={13} />
            </button>
          ) : (
            <button type="button" className="primary-button compact-button" onClick={() => onStep(step + 1)}>
              下一步<ChevronRight size={13} />
            </button>
          )}
        </div>
      </footer>
    </aside>
  );
}