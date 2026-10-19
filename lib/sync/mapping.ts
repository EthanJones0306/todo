import { Todo } from '@/types'
import { toDateString } from '@/lib/date'
import { GraphDateTime, GraphTask } from '@/lib/sync/graph'
import { composeTitle, parseTitle } from '@/lib/priority'

/*
 * To Do only gets a task's title and whether it's done. Priority and "daily" travel as title
 * prefixes (see lib/priority.ts); due dates, other repeats and projects live in this app alone.
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
  return {
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    // zz_ means daily; dropping it in To Do makes a daily task a one-off. Other repeats stay local.
    category: p.daily ? 'daily' : current.category === 'daily' ? 'once' : current.category,
    done,
    completedAt: done ? current.completedAt ?? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}

/** A task that was created in To Do. Its due date is kept if it has one. */
export function newTaskFromGraph(task: GraphTask): Omit<Todo, 'id'> {
  const done = task.status === 'completed'
  const p = parseTitle(task.title)
  const due = task.dueDateTime?.dateTime ? toDateString(new Date(task.dueDateTime.dateTime.slice(0, 19) + 'Z')) : undefined
  return {
    text: p.text,
    rank: p.rank,
    priority: p.priority,
    done,
    category: p.daily ? 'daily' : 'once',
    dueDate: due,
    completedAt: done ? utcToIso(task.completedDateTime) ?? new Date().toISOString() : undefined,
    remoteId: task.id,
    remoteModified: task.lastModifiedDateTime,
  }
}
