export function toDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function getTodayString(): string {
  return toDateString(new Date())
}

export function parseDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00')
}

export function addDays(dateStr: string, days: number): string {
  const d = parseDate(dateStr)
  d.setDate(d.getDate() + days)
  return toDateString(d)
}

export function isOverdue(dueDate?: string): boolean {
  return !!dueDate && dueDate < getTodayString()
}

export function isDueToday(dueDate?: string): boolean {
  return !!dueDate && dueDate === getTodayString()
}

export function formatShortDate(dateStr: string): string {
  return parseDate(dateStr).toLocaleDateString(undefined, { month: 'short', day: 'numeric', weekday: 'short' })
}

/** Human label for a due date: Today, Tomorrow, Yesterday, weekday within a week, else short date. */
export function formatRelativeDate(dateStr: string): string {
  const today = getTodayString()
  if (dateStr === today) return 'Today'
  if (dateStr === addDays(today, 1)) return 'Tomorrow'
  if (dateStr === addDays(today, -1)) return 'Yesterday'
  const diff = Math.round((parseDate(dateStr).getTime() - parseDate(today).getTime()) / 86400000)
  if (diff > 1 && diff < 7) return parseDate(dateStr).toLocaleDateString(undefined, { weekday: 'long' })
  const sameYear = dateStr.slice(0, 4) === today.slice(0, 4)
  return parseDate(dateStr).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function greeting(): string {
  const h = new Date().getHours()
  if (h < 5) return 'Good night'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function formatLongToday(): string {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

/** First and last day (inclusive, YYYY-MM-DD) of the day, week or month containing `today`. */
export function periodBounds(period: 'daily' | 'weekly' | 'monthly', weekStartsOn: 0 | 1, today = getTodayString()): { start: string; end: string } {
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
