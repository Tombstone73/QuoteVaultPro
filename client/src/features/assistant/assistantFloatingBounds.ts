import type { AssistantLayoutPreferences } from "./types";

export type FloatingBounds = AssistantLayoutPreferences["floatingBounds"];
export type ResizeDirection = "n" | "ne" | "e" | "se" | "s" | "sw" | "w" | "nw";
export type FloatingViewport = { width: number; height: number };

const MARGIN = 12;
const MIN_WIDTH = 320;
const MIN_HEIGHT = 360;

const between = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
const finite = (value: number, fallback: number) => Number.isFinite(value) ? value : fallback;

export function floatingViewport(): FloatingViewport {
  return { width: window.innerWidth, height: window.innerHeight };
}

export function clampFloatingBounds(bounds: FloatingBounds, viewport: FloatingViewport): FloatingBounds {
  const availableWidth = Math.max(1, finite(viewport.width, MIN_WIDTH + MARGIN * 2) - MARGIN * 2);
  const availableHeight = Math.max(1, finite(viewport.height, MIN_HEIGHT + MARGIN * 2) - MARGIN * 2);
  const width = between(finite(bounds.width, MIN_WIDTH), Math.min(MIN_WIDTH, availableWidth), availableWidth);
  const height = between(finite(bounds.height, MIN_HEIGHT), Math.min(MIN_HEIGHT, availableHeight), availableHeight);
  return {
    width, height,
    x: between(finite(bounds.x, MARGIN), MARGIN, MARGIN + availableWidth - width),
    y: between(finite(bounds.y, MARGIN), MARGIN, MARGIN + availableHeight - height),
  };
}

export function moveFloatingBounds(bounds: FloatingBounds, deltaX: number, deltaY: number, viewport: FloatingViewport): FloatingBounds {
  return clampFloatingBounds({ ...bounds, x: bounds.x + deltaX, y: bounds.y + deltaY }, viewport);
}

/** Resize relative to the original bounds so the untouched sides never drift. */
export function resizeFloatingBounds(bounds: FloatingBounds, direction: ResizeDirection, deltaX: number, deltaY: number, viewport: FloatingViewport): FloatingBounds {
  const original = clampFloatingBounds(bounds, viewport);
  const availableWidth = Math.max(1, viewport.width - MARGIN * 2);
  const availableHeight = Math.max(1, viewport.height - MARGIN * 2);
  const minWidth = Math.min(MIN_WIDTH, availableWidth);
  const minHeight = Math.min(MIN_HEIGHT, availableHeight);
  let { x, y, width, height } = original;
  if (direction.includes("w")) {
    const right = x + width;
    x = between(x + deltaX, MARGIN, right - minWidth);
    width = right - x;
  } else if (direction.includes("e")) {
    width = between(width + deltaX, minWidth, viewport.width - MARGIN - x);
  }
  if (direction.includes("n")) {
    const bottom = y + height;
    y = between(y + deltaY, MARGIN, bottom - minHeight);
    height = bottom - y;
  } else if (direction.includes("s")) {
    height = between(height + deltaY, minHeight, viewport.height - MARGIN - y);
  }
  return { x, y, width, height };
}
