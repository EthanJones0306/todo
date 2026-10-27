import { Category, Todo } from '@/types'
import { getTodayString, periodBounds, toDateString } from '@/lib/date'

export { periodBounds }
import { shouldShowToday } from '@/lib/todos'

export type PeriodCategory = 'daily' | 'weekly' | 'monthly'
export const PERIOD_CATEGORIES: PeriodCategory[] = ['daily', 'weekly', 'monthly']

export function isPeriodCategory(c: Category | string): c is PeriodCategory {
  return c === 'daily' || c === 'weekly' || c === 'monthly'
}


/** A task and the copies made from it (custom-days roll-forward) count as one; same-named tasks don't. */
function seriesKey(t: Todo): string {
  return t.originalId ?? t.id
}

export interface ViewContext {
  /** Whether an open task belongs on the Daily/Weekly/Monthly list for the current period. */
  openInPeriod: (t: Todo) => boolean
  /** Distinct repeating tasks ticked off in the current period, per category — for "x of y done". */
  doneInPeriod: Record<PeriodCategory, number>
  /**
   * An open task To Do repeats whose occurrence for this period is already ticked off (To Do keeps it
   * open with a later due date). Shown as done everywhere, so it isn't ticked again by mistake.
   */
  doneThisPeriod: (t: Todo) => boolean
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
  /**
   * Whether a task counts as done for its current day/week/month. A task To Do repeats stays open, so
   * its last tick is used — and that tick must be for an occurrence due in this period. Ticking an overdue
   * one (yesterday's, last week's) means "I did that one"; this period's is still to do.
   */
  const doneFor = (t: Todo): boolean => {
    if (!isPeriodCategory(t.category)) return false
    const { start } = bounds[t.category]
    if (t.done) return !!t.completedAt && toDateString(new Date(t.completedAt)) >= start
    if (!t.lastCompletedAt || toDateString(new Date(t.lastCompletedAt)) < start) return false
    return !t.lastCompletedDue || t.lastCompletedDue >= start
  }
  const doneKeys: Record<PeriodCategory, Set<string>> = { daily: new Set(), weekly: new Set(), monthly: new Set() }
  for (const t of todos) if (isPeriodCategory(t.category) && doneFor(t)) doneKeys[t.category].add(seriesKey(t))
  return {
    today,
    doneInPeriod: { daily: doneKeys.daily.size, weekly: doneKeys.weekly.size, monthly: doneKeys.monthly.size },
    doneThisPeriod: t => !t.done && doneFor(t),
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
