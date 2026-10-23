const BASE = 'https://graph.microsoft.com/v1.0'

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export interface GraphDateTime {
  dateTime: string
  timeZone: string
}

export interface GraphTask {
  id: string
  title: string
  status: 'notStarted' | 'inProgress' | 'completed' | 'waitingOnOthers' | 'deferred'
  dueDateTime?: GraphDateTime | null
  completedDateTime?: GraphDateTime | null
  /** Set when To Do repeats the task itself (completing it makes To Do create the next copy) */
  recurrence?: unknown | null
  lastModifiedDateTime: string
  createdDateTime?: string
}

export interface GraphList {
  id: string
  displayName: string
  wellknownListName?: string
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

async function graph<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(path.startsWith('http') ? path : BASE + path, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'outlook.timezone="UTC"',
        ...(init.headers ?? {}),
      },
    })
    if ((res.status === 429 || res.status === 503 || res.status === 504) && attempt < 3) {
      const wait = Number(res.headers.get('Retry-After')) || 2 ** attempt
      await sleep(wait * 1000)
      continue
    }
    if (!res.ok) {
      let message = `${res.status} ${res.statusText}`
      try {
        const body = await res.json()
        message = body?.error?.message || message
      } catch {}
      throw new GraphError(res.status, message)
    }
    if (res.status === 204) return undefined as T
    return res.json()
  }
}

async function getAll<T>(token: string, path: string): Promise<T[]> {
  const items: T[] = []
  let next: string | undefined = path
  while (next) {
    const page: { value: T[]; '@odata.nextLink'?: string } = await graph(token, next)
    items.push(...page.value)
    next = page['@odata.nextLink']
  }
  return items
}

export const listLists = (token: string) => getAll<GraphList>(token, '/me/todo/lists')

export const createList = (token: string, displayName: string) =>
  graph<GraphList>(token, '/me/todo/lists', { method: 'POST', body: JSON.stringify({ displayName }) })

/** Every task in the list, including the full completed history. Only used for one-off repairs. */
export const listTasks = (token: string, listId: string) =>
  getAll<GraphTask>(token, `/me/todo/lists/${listId}/tasks?$top=100`)

const OPEN_FILTER = encodeURIComponent("status ne 'completed'")

/**
 * Open tasks only. The completed history (often thousands of tasks) never needs to come down: tasks
 * that leave this list are looked up one by one to see whether they were completed or deleted.
 */
export async function listOpenTasks(token: string, listId: string): Promise<GraphTask[]> {
  const base = `/me/todo/lists/${listId}/tasks?$top=100`
  try {
    return await getAll<GraphTask>(token, `${base}&$filter=${OPEN_FILTER}`)
  } catch (e) {
    if (!(e instanceof GraphError && e.status === 400)) throw e
    return (await getAll<GraphTask>(token, base)).filter(t => t.status !== 'completed')
  }
}

const taskPath = (listId: string, taskId?: string) => `/me/todo/lists/${listId}/tasks${taskId ? `/${taskId}` : ''}`

export const createTask = (token: string, listId: string, task: Partial<GraphTask>) =>
  graph<GraphTask>(token, taskPath(listId), { method: 'POST', body: JSON.stringify(task) })

export const getTask = (token: string, listId: string, taskId: string) =>
  graph<GraphTask>(token, taskPath(listId, taskId))

export const updateTask = (token: string, listId: string, taskId: string, patch: Partial<GraphTask>) =>
  graph<GraphTask>(token, taskPath(listId, taskId), { method: 'PATCH', body: JSON.stringify(patch) })

export const deleteTask = (token: string, listId: string, taskId: string) =>
  graph<void>(token, taskPath(listId, taskId), { method: 'DELETE' })
