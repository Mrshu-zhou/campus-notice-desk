export interface TourRect {
  top: number;
  left: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}

export interface TourViewport {
  width: number;
  height: number;
  mobile: boolean;
}

export interface TourBubbleSize {
  width: number;
  height: number;
}

export interface TourPosition {
  top: number;
  left: number;
  width: number;
}

/** A rect the coach bubble must not cover (primary buttons, inline errors). */
export interface TourObstacle {
  top: number;
  left: number;
  right: number;
  bottom: number;
}

const EDGE = 12;
/** Clears the sticky mobile section tabs. */
const MOBILE_TOP_EDGE = 64;
const DESKTOP_EDGE = 16;
const DESKTOP_BADGE_RESERVE = 76;
/** Covers the Qoder badge plus a sticky mobile action bar / dialog footer. */
const MOBILE_BOTTOM_RESERVE = 128;
/** Breathing room between the bubble and its target / obstacles. */
const GAP = 12;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(value, max));
}

function boxOf(position: TourPosition, height: number): TourObstacle {
  return {
    top: position.top,
    left: position.left,
    right: position.left + position.width,
    bottom: position.top + height,
  };
}

function overlaps(a: TourObstacle, b: TourObstacle) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}

/**
 * Places the coach bubble next to a real target while keeping it inside the
 * viewport, above the platform badge / sticky bottom controls, and clear of
 * the target plus any primary action or error text passed as obstacles.
 *
 * On desktop the bubble may not intersect the target itself; on mobile the
 * target is often the whole intake pane, so only extra obstacles are avoided.
 */
export function computeTourPosition(
  rect: TourRect,
  viewport: TourViewport,
  bubble: TourBubbleSize,
  obstacles: TourObstacle[] = [],
): TourPosition {
  const bottomReserve = viewport.mobile ? MOBILE_BOTTOM_RESERVE : DESKTOP_BADGE_RESERVE;
  const safeBottom = viewport.height - bottomReserve;
  const maxWidth = Math.max(EDGE * 2, viewport.width - EDGE * 2);

  if (!viewport.mobile) {
    const desiredWidth = Math.min(bubble.width, maxWidth);
    const maxLeft = Math.max(DESKTOP_EDGE, viewport.width - desiredWidth - DESKTOP_EDGE);
    const maxTop = Math.max(DESKTOP_EDGE, safeBottom - bubble.height);

    const isClear = (position: TourPosition) => {
      const box = boxOf(position, bubble.height);
      if (box.top < DESKTOP_EDGE || box.bottom > safeBottom) return false;
      if (box.left < DESKTOP_EDGE || box.right > viewport.width - DESKTOP_EDGE) return false;
      if (overlaps(box, rect)) return false;
      return !obstacles.some((obstacle) => overlaps(box, obstacle));
    };
    const place = (top: number, left: number, width: number): TourPosition => ({
      top: clamp(top, DESKTOP_EDGE, maxTop),
      left: clamp(left, DESKTOP_EDGE, Math.max(DESKTOP_EDGE, viewport.width - width - DESKTOP_EDGE)),
      width,
    });

    const widePanel = rect.width > Math.min(520, viewport.width * 0.45) && rect.height > 280;
    const candidates: TourPosition[] = [];

    if (widePanel && rect.left >= 220) {
      const sideWidth = Math.max(160, Math.min(320, rect.left - 28));
      candidates.push(place(clamp(rect.top, DESKTOP_EDGE, maxTop), rect.left - sideWidth - GAP, sideWidth));
    }
    if (widePanel && viewport.width - rect.right >= 220) {
      const sideWidth = Math.max(160, Math.min(320, viewport.width - rect.right - 28));
      candidates.push(place(clamp(rect.top, DESKTOP_EDGE, maxTop), rect.right + GAP, sideWidth));
    }

    // Above the target first (right-aligned, then left-aligned). This is the
    // stable spot for a bottom primary action: the bubble sits just above the
    // button instead of sharing its row and covering it.
    const aboveTop = rect.top - bubble.height - GAP;
    candidates.push(place(aboveTop, rect.right - desiredWidth, desiredWidth));
    candidates.push(place(aboveTop, rect.left, desiredWidth));
    candidates.push(place(rect.bottom + GAP, rect.left, desiredWidth));
    candidates.push(place(rect.top, rect.left - desiredWidth - GAP, desiredWidth));
    candidates.push(place(rect.top, rect.right + GAP, desiredWidth));
    candidates.push(place(DESKTOP_EDGE, maxLeft, desiredWidth));
    candidates.push(place(DESKTOP_EDGE, DESKTOP_EDGE, desiredWidth));

    for (const candidate of candidates) {
      if (isClear(candidate)) return candidate;
    }

    // Nothing lined up cleanly (for example a tall error banner right above the
    // button): pick the nearest valid spot on a coarse grid so the bubble still
    // never covers a primary action or the error text.
    let best: TourPosition | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    const targetX = (rect.left + rect.right) / 2;
    const targetY = (rect.top + rect.bottom) / 2;
    for (let top = DESKTOP_EDGE; top <= maxTop; top += 12) {
      for (let left = DESKTOP_EDGE; left <= maxLeft; left += 12) {
        const candidate = { top, left, width: desiredWidth };
        if (!isClear(candidate)) continue;
        const dx = left + desiredWidth / 2 - targetX;
        const dy = top + bubble.height / 2 - targetY;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          best = candidate;
          bestDistance = distance;
        }
      }
    }
    if (best) return best;
    return place(DESKTOP_EDGE, maxLeft, desiredWidth);
  }

  const width = Math.min(bubble.width, maxWidth);
  const left = clamp(rect.left, EDGE, Math.max(EDGE, viewport.width - width - EDGE));
  const maxTop = Math.max(MOBILE_TOP_EDGE, safeBottom - bubble.height);

  const isClear = (position: TourPosition) => {
    const box = boxOf(position, bubble.height);
    if (box.top < MOBILE_TOP_EDGE || box.bottom > safeBottom) return false;
    if (box.left < EDGE || box.right > viewport.width - EDGE) return false;
    return !obstacles.some((obstacle) => overlaps(box, obstacle));
  };

  const tops: number[] = [];
  if (rect.top - bubble.height - 10 >= MOBILE_TOP_EDGE) tops.push(rect.top - bubble.height - 10);
  if (rect.bottom + bubble.height + 10 <= safeBottom) tops.push(rect.bottom + 10);
  tops.push(rect.top + 8);
  tops.push(MOBILE_TOP_EDGE);

  for (const top of tops) {
    const candidate = { top: clamp(top, MOBILE_TOP_EDGE, maxTop), left, width };
    if (isClear(candidate)) return candidate;
  }
  return { top: clamp(tops[0], MOBILE_TOP_EDGE, maxTop), left, width };
}