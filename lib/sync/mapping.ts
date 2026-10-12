import { Category, Phase, Project, Todo } from '@/types'
import { getTodayString, parseDate, toDateString } from '@/lib/date'
import { GraphDateTime, GraphRecurrence, GraphTask } from '@/lib/sync/graph'

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

/** A local calendar date as the UTC instant of local midnight — how To Do stores due dates. */
export function toGraphDate(date: string): GraphDateTime {
  return { dateTime: parseDate(date).toISOString().replace('Z', ''), timeZone: 'UTC' }
}

/** Requests ask Graph for UTC, so convert back to the local calendar date. */
export function fromGraphDate(value?: GraphDateTime | null): string | undefined {
  if (!value?.dateTime) return undefined
  return toDateString(new Date(value.dateTime.slice(0, 19) + 'Z'))
}

function toGraphRecurrence(todo: Todo, due: string): GraphRecurrence | null {
  const d = parseDate(due)
  const range = { type: 'noEnd' as const, startDate: due }
  switch (todo.category) {
    case 'daily':
      return { pattern: { type: 'daily', interval: 1 }, range }
    case 'weekly':
      return { pattern: { type: 'weekly', interval: 1, daysOfWeek: [DAY_NAMES[d.getDay()]], firstDayOfWeek: 'sunday' }, range }
    case 'monthly':
      return { pattern: { type: 'absoluteMonthly', interval: 1, dayOfMonth: d.getDate() }, range }
    case 'custom': {
      const days = todo.recurrenceDays?.length ? todo.recurrenceDays : [d.getDay()]
      return { pattern: { type: 'weekly', interval: 1, daysOfWeek: days.map(i => DAY_NAMES[i]), firstDayOfWeek: 'sunday' }, range }
    }
    default:
      return null
  }
}

function fromGraphRecurrence(rec?: GraphRecurrence | null): { category: Category; recurrenceDays?: number[] } {
  const p = rec?.pattern
  if (!p) return { category: 'once' }
  if (p.type === 'daily') return { category: 'daily' }
  if (p.type === 'weekly') {
    const days = (p.daysOfWeek ?? []).map(n => DAY_NAMES.indexOf(n.toLowerCase())).filter(i => i >= 0).sort()
    return days.length > 1 ? { category: 'custom', recurrenceDays: days } : { category: 'weekly' }
  }
  if (p.type === 'absoluteMonthly' || p.type === 'relativeMonthly') return { category: 'monthly' }
  return { category: 'once' }
}

/**
 * Body for creating/updating a remote task. Recurring tasks need a due date in To Do,
 * so one is filled in (today) and returned so the local copy can match.
 */
export function toGraphTask(todo: Todo, isCreate: boolean): { body: Partial<GraphTask>; dueDate?: string } {
  const dueDate = todo.dueDate ?? (todo.category !== 'once' && !todo.done ? getTodayString() : undefined)
  const body: Partial<GraphTask> = {
    title: todo.text,
    status: todo.done ? 'completed' : 'notStarted',
  }
  // Re-sending the recurrence on completion could stop To Do from rolling the task forward.
  if (!todo.done || isCreate) {
    if (dueDate) body.dueDateTime = toGraphDate(dueDate)
    else if (!isCreate) body.dueDateTime = null
    const rec = dueDate ? toGraphRecurrence(todo, dueDate) : null
    if (rec) body.recurrence = rec
    else if (!isCreate) body.recurrence = null
  }
  return { body, dueDate }
}

/** Fields of a local todo that come from the remote task. */
export function fromGraphTask(task: GraphTask): Pick<
  Todo,
  'text' | 'done' | 'category' | 'recurrenceDays' | 'dueDate' | 'completedAt' | 'remoteId' | 'remoteModified'
> {
  return {
    text: task.title,
    done: task.status === 'completed',
    ...fromGraphRecurrence(task.recurrence),
    dueDate: fromGraphDate(task.dueDateTime),
    completedAt:
      task.status === 'completed'
        ? task.completedDateTime
          ? new Date(task.completedDateTime.dateTime.slice(0, 19) + 'Z').toISOString()
          : new Date().toISOString()
        : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}

export function bodyText(task: GraphTask): string {
  const content = task.body?.content ?? ''
  if (task.body?.contentType !== 'html') return content.trim()
  return content
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .trim()
}

/** Merge remote steps into a project's phases, keeping local-only details like notes and "In progress". */
export function mergePhases(project: Project, task: GraphTask): Phase[] {
  const items = task.checklistItems ?? []
  const byRemote = new Map(project.phases.filter(p => p.remoteId).map(p => [p.remoteId!, p]))
  const now = new Date().toISOString()
  const merged: Phase[] = items.map(item => {
    const existing = byRemote.get(item.id)
    if (existing) {
      const status = item.isChecked ? 'done' : existing.status === 'done' ? 'pending' : existing.status
      return {
        ...existing,
        title: item.displayName,
        status,
        completedAt: status === 'done' ? existing.completedAt ?? now : undefined,
      }
    }
    return {
      id: crypto.randomUUID(),
      projectId: project.id,
      title: item.displayName,
      description: '',
      order: 0,
      status: item.isChecked ? 'done' : 'pending',
      completedAt: item.isChecked ? now : undefined,
      createdAt: now,
      updatedAt: now,
      remoteId: item.id,
    }
  })
  // Phases created here but not uploaded yet stay put.
  const unsynced = project.phases.filter(p => !p.remoteId)
  return [...merged, ...unsynced].map((p, i) => ({ ...p, order: i }))
}
