import { format } from "date-fns";

export type ProofingQueueDueDate = {
  label: string;
  title: string;
  tone: "overdue" | "today" | "tomorrow" | "future";
};

function toLocalCalendarDay(value: string | Date) {
  const raw = String(value);
  const calendarMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (calendarMatch) {
    return new Date(Number(calendarMatch[1]), Number(calendarMatch[2]) - 1, Number(calendarMatch[3]));
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
}

export function getProofingQueueDueDate(value: string | Date | null | undefined, now = new Date()): ProofingQueueDueDate | null {
  if (!value) return null;
  const dueDay = toLocalCalendarDay(value);
  if (!dueDay) return null;

  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayDelta = Math.round((dueDay.getTime() - today.getTime()) / 86_400_000);
  const formattedDate = format(dueDay, "MMM d");

  if (dayDelta < 0) return { label: "OVERDUE", title: `Overdue: ${formattedDate}`, tone: "overdue" };
  if (dayDelta === 0) return { label: "DUE TODAY", title: `Due today: ${formattedDate}`, tone: "today" };
  if (dayDelta === 1) return { label: "DUE TOMORROW", title: `Due tomorrow: ${formattedDate}`, tone: "tomorrow" };
  return { label: `DUE ${formattedDate.toUpperCase()}`, title: `Due: ${formattedDate}`, tone: "future" };
}
