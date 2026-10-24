import { Category, Todo } from '@/types'
import { addDays, getTodayString, parseDate, toDateString } from '@/lib/date'
import { shouldShowToday } from '@/lib/todos'

export type PeriodCategory = 'daily' | 'weekly' | 'monthly'
export const PERIOD_CATEGORIES: PeriodCategory[] = ['daily', 'weekly', 'monthly']

export function isPeriodCategory(c: Category | string): c is PeriodCategory {
  return c === 'daily' || c === 'weekly' || c === 'monthly'
}

/** First and last day (inclusive, YYYY-MM-DD) of the day, week or month containing `today`. */
export function periodBounds(period: PeriodCategory, weekStartsOn: 0 | 1, today = getTodayString()): { start: string; end: string } {
  if (period === 'daily') return { start: today, end: today }
  if (period === 'weekly') {
    const back = (parseDate(today).getDay() - weekStartsOn + 7) % 7
    const start = addDays(today, -back)
    return { start, end: addDays(start, 6) }
  }
  const d = parseDate(today)
  return {
    start: toDateString(new Date(d.getFullYear(), d.getMonth(), 1)),
    end: toDateString(new Date(d.getFullYear(), d.getMonth() + 1, 0)),
  }
}

/** Copies of the same repeating task (To Do creates a new task for each occurrence) share this key. */
function seriesKey(t: Todo): string {
  return `${t.category}|${t.text.trim().toLowerCase()}`
}

export interface ViewContext {
  /** Whether an open task belongs on the Daily/Weekly/Monthly list for the current period. */
  openInPeriod: (t: Todo) => boolean
  /** Distinct repeating tasks ticked off in the current period, per category — for "x of y done". */
  doneInPeriod: Record<PeriodCategory, number>
  today: string
}

/**
 * Daily, weekly and monthly lists show only what is still open for the current day, week or month:
 * - open tasks due in this period or earlier (overdue stays, since To Do only creates the next copy
 *   once one is ticked off), or with no due date;
 * - once a task is ticked off this period it stays off the list until the next period — including a
 *   task To Do repeats, which To Do keeps open and simply moves to its next due date (ticking an
 *   overdue one moves it to today, and it shouldn't reappear).
 */
export function buildViewContext(todos: Todo[], weekStartsOn: 0 | 1, today = getTodayString()): ViewContext {
  const bounds = {
    daily: periodBounds('daily', weekStartsOn, today),
    weekly: periodBounds('weekly', weekStartsOn, today),
    monthly: periodBounds('monthly', weekStartsOn, today),
  }
  const doneKeys: Record<PeriodCategory, Set<string>> = { daily: new Set(), weekly: new Set(), monthly: new Set() }
  for (const t of todos) {
    if (!isPeriodCategory(t.category)) continue
    // Done here, or a task To Do repeats whose latest occurrence was ticked off (it stays open in To Do).
    const doneAt = t.done ? t.completedAt : t.lastCompletedAt
    if (doneAt && toDateString(new Date(doneAt)) >= bounds[t.category].start) doneKeys[t.category].add(seriesKey(t))
  }
  return {
    today,
    doneInPeriod: { daily: doneKeys.daily.size, weekly: doneKeys.weekly.size, monthly: doneKeys.monthly.size },
    openInPeriod: t => {
      if (t.done || !isPeriodCategory(t.category)) return false
      const { end } = bounds[t.category]
      if (t.dueDate && t.dueDate > end) return false
      return !doneKeys[t.category].has(seriesKey(t))
    },
  }
}

export type ListView = 'today' | 'upcoming' | 'all' | Category

/** Whether a task belongs in a view. Daily/Weekly/Monthly only ever list open tasks for the current period. */
export function inView(t: Todo, view: ListView, ctx: ViewContext): boolean {
  if (isPeriodCategory(view)) return t.category === view && ctx.openInPeriod(t)
  if (view === 'today') {
    if (!t.done && isPeriodCategory(t.category) && !ctx.openInPeriod(t)) return false
    return shouldShowToday(t.dueDate, t.recurrenceDays)
  }
  if (view === 'upcoming') return !!t.dueDate && t.dueDate > ctx.today
  if (view === 'all') return true
  return t.category === view
}
