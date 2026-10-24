import { Todo } from '@/types'
import { toDateString } from '@/lib/date'
import { GraphDateTime, GraphTask } from '@/lib/sync/graph'
import { composeTitle, parseTitle, repeatPrefixOf } from '@/lib/priority'

/*
 * To Do only gets a task's title and whether it's done. Priority and daily/weekly/monthly travel as
 * title prefixes (see lib/priority.ts). Due dates are read from To Do but never sent; custom repeats
 * and projects live in this app alone.
 */

export function toGraphTask(todo: Todo): Partial<GraphTask> {
  return { title: composeTitle(todo), status: todo.done ? 'completed' : 'notStarted' }
}

function utcToIso(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? new Date(value.dateTime.slice(0, 19) + 'Z').toISOString() : undefined
}

/** Title (with priority prefixes) and done state from To Do, applied to an existing local task. */
export function syncedFieldsFromGraph(task: GraphTask, current: Todo): Partial<Todo> {
  const done = task.status === 'completed'
  const p = parseTitle(task.title)
  const due = localDate(task.dueDateTime)
  // A repeating task stays open in To Do and its due date moves on when an occurrence is ticked off
  // (in To Do or here). Seeing it open again with a later due date means that occurrence was done.
  const rolledForward = !done && !!task.recurrence && (current.done || (!!due && !!current.remoteDue && due > current.remoteDue))
  return {
    lastCompletedAt: rolledForward ? current.completedAt ?? task.lastModifiedDateTime : current.lastCompletedAt,
    remoteSeries: current.remoteSeries || !!task.recurrence,
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    // z_/zz_/zzz_ set daily/weekly/monthly; removing it in To Do makes the task a one-off. Custom stays local.
    category: p.repeat ?? (repeatPrefixOf(current.category) ? 'once' : current.category),
    recurrenceDays: p.repeat ? undefined : current.recurrenceDays,
    // A due date set, moved or removed in To Do comes across; one set only here is kept.
    dueDate: localDate(task.dueDateTime) ?? (current.dueDate === current.remoteDue ? undefined : current.dueDate),
    remoteDue: localDate(task.dueDateTime),
    done,
    completedAt: done ? current.completedAt ?? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}

export function localDate(value?: GraphDateTime | null): string | undefined {
  return value?.dateTime ? toDateString(new Date(value.dateTime.slice(0, 19) + 'Z')) : undefined
}

/** A task that was created in To Do. Its due date is kept if it has one. */
export function newTaskFromGraph(task: GraphTask): Omit<Todo, 'id'> {
  const done = task.status === 'completed'
  const p = parseTitle(task.title)
  const due = localDate(task.dueDateTime)
  return {
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    done,
    remoteSeries: !!task.recurrence || undefined,
    category: p.repeat ?? 'once',
    dueDate: due,
    remoteDue: due,
    completedAt: done ? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}
