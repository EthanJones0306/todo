/*
 * Sync tests against a fake Microsoft To Do (Graph) server.
 * Run with `npm test` (compiles lib/ to tests/.build, then runs this file).
 *
 * The fake server behaves like To Do where it matters:
 * - GET …/tasks supports $filter=status ne 'completed' and @odata paging-free responses
 * - GET/PATCH/DELETE …/tasks/{id}
 * - completing a task that has a recurrence behaves as real To Do does (checked against live Graph data,
 *   Oct 2026): the task itself stays open and its due date moves to the next occurrence after the old
 *   one, and a separate completed record (new id, old due date, recurrence kept) is created
 */
const Module = require('module')
const path = require('path')
const assert = require('assert')

const BUILD = path.join(__dirname, '.build')

/* ---------- Browser-ish globals ---------- */
const store = new Map()
global.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  key: i => [...store.keys()][i] ?? null,
  get length() {
    return store.size
  },
}
global.window = global
global.addEventListener = () => {}
global.dispatchEvent = () => true
Object.defineProperty(global, 'navigator', { value: { onLine: true }, configurable: true })

/* ---------- Module aliasing (@/…) and an MSAL stand-in ---------- */
const msal = { fail: false }
global.__msal = msal
require('fs').writeFileSync(
  path.join(BUILD, 'msal-mock.js'),
  `class ReauthRequired extends Error {}
module.exports = {
  getAccount: async () => { if (global.__msal.fail) throw new Error('sign-in interrupted'); return { username: 'me' } },
  getToken: async () => 'tok',
  ReauthRequired,
}`
)
const origResolve = Module._resolveFilename
Module._resolveFilename = function (req, ...rest) {
  if (req === '@/lib/sync/msal') return path.join(BUILD, 'msal-mock.js')
  if (req.startsWith('@/')) return origResolve.call(this, path.join(BUILD, req.slice(2)), ...rest)
  return origResolve.call(this, req, ...rest)
}

/* ---------- Fake To Do ---------- */
let clock = 0
let seq = 0
const LIST = 'L1'
const tasks = new Map()
const calls = []
const bodies = []
const urls = []
let lagNextList = null // when set, the next list response returns this stale copy of a task
// Modification times follow the real clock (as To Do's do), one second apart so each change is newer.
const CLOCK_BASE = Date.now()
const stamp = t => {
  t.lastModifiedDateTime = new Date(CLOCK_BASE + ++clock * 1000).toISOString().replace(/\.\d+Z$/, 'Z')
}
const addRemote = (title, extra = {}) => {
  const t = { id: 'T' + ++seq, title, status: 'notStarted', createdDateTime: new Date().toISOString(), ...extra }
  if (!extra.lastModifiedDateTime) stamp(t)
  tasks.set(t.id, t)
  return t
}
const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
/** The next occurrence after a local date (YYYY-MM-DD) for a daily or weekly(daysOfWeek) pattern. */
const nextOccurrence = (date, pattern) => {
  const d = new Date(date + 'T00:00:00')
  for (let i = 0; i < 14; i++) {
    d.setDate(d.getDate() + (pattern.type === 'daily' && i === 0 ? (pattern.interval || 1) - 1 : 0) + 1)
    if (pattern.type === 'daily' || (pattern.daysOfWeek || []).includes(DAY_NAMES[d.getDay()])) break
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
/** The local calendar date of a To Do date-time (sent in UTC). */
const localDay = dt => {
  const d = new Date(dt.dateTime.slice(0, 19) + 'Z')
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
let onRequest = null // optional hook: runs at the start of each request (e.g. to make an edit mid-sync)
global.fetch = async (url, init = {}) => {
  const method = init.method || 'GET'
  if (onRequest) await onRequest(method, url)
  const u = new URL(url)
  const p = u.pathname.replace('/v1.0/me/todo/lists/' + LIST + '/tasks', '')
  calls.push(`${method} ${p || '/'}`)
  urls.push(`${method} ${url}`)
  const body = init.body ? JSON.parse(init.body) : undefined
  if (body) bodies.push(body)
  const json = (status, obj) => ({ ok: status < 300, status, statusText: '', headers: { get: () => null }, json: async () => obj })
  const parts = p.split('/').filter(Boolean)
  if (!parts.length) {
    if (method === 'GET') {
      const filter = u.searchParams.get('$filter')
      if (filter && filter !== "status ne 'completed'") return json(400, { error: { message: 'bad filter ' + filter } })
      let value = [...tasks.values()].filter(t => !filter || t.status !== 'completed').map(t => ({ ...t }))
      if (lagNextList) {
        value = value.map(t => (t.id === lagNextList.id ? lagNextList : t))
        if (!value.some(t => t.id === lagNextList.id)) value.push(lagNextList)
        lagNextList = null
      }
      return json(200, { value })
    }
    if (method === 'POST') {
      const t = { id: 'T' + ++seq, status: 'notStarted', createdDateTime: new Date().toISOString(), ...body }
      stamp(t)
      tasks.set(t.id, t)
      return json(201, { ...t })
    }
  }
  const t = tasks.get(parts[0])
  if (!t) return json(404, { error: { message: 'not found' } })
  if (method === 'GET') return json(200, { ...t })
  if (method === 'DELETE') {
    tasks.delete(t.id)
    return json(204)
  }
  if (method === 'PATCH') {
    const wasDone = t.status === 'completed'
    Object.assign(t, body)
    stamp(t)
    if (!wasDone && t.status === 'completed' && t.recurrence) {
      addRemote(t.title, {
        status: 'completed',
        dueDateTime: t.dueDateTime,
        completedDateTime: { dateTime: new Date().toISOString().slice(0, 19), timeZone: 'UTC' },
        recurrence: t.recurrence,
      })
      t.status = 'notStarted'
      t.dueDateTime = dueAt(nextOccurrence(localDay(t.dueDateTime), t.recurrence.pattern))
      stamp(t)
    }
    return json(200, { ...t })
  }
  return json(400, { error: { message: 'unhandled ' + method + ' ' + p } })
}

/* ---------- App code under test ---------- */
const engine = require(path.join(BUILD, 'lib/sync/engine.js'))
const storage = require(path.join(BUILD, 'lib/storage.js'))
const todosLib = require(path.join(BUILD, 'lib/todos.js'))
const priority = require(path.join(BUILD, 'lib/priority.js'))
const views = require(path.join(BUILD, 'lib/views.js'))
const { setLink, requestSync, getStatus, pendingCount, findReopenedCandidates, markRemoteCompleted } = engine
const { loadTodos, saveTodos, saveTodosRaw, markDeleted, resetRepeatingTasks, toggleDone, duplicateOf, isClearable } = todosLib
const { parseTitle, composeTitle, priorityCompare, reprioritise } = priority

const mode = 'work'
const sync = async () => {
  await requestSync()
  assert.notStrictEqual(getStatus().phase, 'error', getStatus().error)
}
const remote = title => [...tasks.values()].find(t => t.title === title)
const remotes = title => [...tasks.values()].filter(t => t.title === title)
const local = text => loadTodos(mode).find(t => t.text === text)
/** What the page does for every edit: change the latest stored tasks, then save (never a stale copy). */
const commit = change => saveTodos(mode, change(loadTodos(mode)))
const pad = n => String(n).padStart(2, '0')
const dayStr = n => {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
/** A due date as real To Do sends it: local midnight of that day, expressed in UTC (e.g. 22:00 the day before in SAST). */
const dueAt = date => ({ dateTime: new Date(date + 'T00:00:00').toISOString().slice(0, 19) + '.0000000', timeZone: 'UTC' })
const dueOn = n => dueAt(dayStr(n))
const now = new Date().toISOString()
const yesterday = new Date(Date.now() - 86400000).toISOString()
const rec = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: dayStr(-5) } }

let passed = 0
const ok = msg => {
  passed++
  console.log('✓ ' + msg)
}

;(async () => {
  /* ===== Title prefixes ===== */
  assert.deepStrictEqual(parseTitle('1_Call bank'), { text: 'Call bank', rank: 1, priority: undefined, repeat: undefined })
  assert.strictEqual(parseTitle('12_Board pack').rank, 12)
  assert.strictEqual(parseTitle('H_Urgent').priority, 'high')
  assert.strictEqual(parseTitle('l_Later').priority, 'low')
  assert.strictEqual(parseTitle('z_Standup').repeat, 'daily')
  assert.strictEqual(parseTitle('zz_Weekly review').repeat, 'weekly')
  assert.strictEqual(parseTitle('ZZZ_Month-end').repeat, 'monthly')
  assert.deepStrictEqual(parseTitle('z_2_Inbox zero'), { text: 'Inbox zero', rank: 2, priority: undefined, repeat: 'daily' })
  assert.strictEqual(parseTitle('zzzz_Sleep').text, 'zzzz_Sleep', 'four z is not a prefix')
  assert.strictEqual(parseTitle('Hello_world').text, 'Hello_world')
  assert.strictEqual(parseTitle('2_').text, '2_', 'prefix-only title kept')
  assert.strictEqual(composeTitle({ text: 'Inbox zero', rank: 2, category: 'daily' }), 'z_2_Inbox zero')
  assert.strictEqual(composeTitle({ text: 'Review', category: 'weekly' }), 'zz_Review')
  assert.strictEqual(composeTitle({ text: 'Pack', category: 'monthly' }), 'zzz_Pack')
  assert.strictEqual(composeTitle({ text: 'Urgent', priority: 'high', category: 'once' }), 'H_Urgent')
  assert.strictEqual(composeTitle({ text: 'Gym', category: 'custom' }), 'Gym')
  const order = [
    { text: 'm', category: 'monthly' }, { text: 'w', category: 'weekly' }, { text: 'd', category: 'daily' },
    { text: 'low', priority: 'low', category: 'once' }, { text: 'n', category: 'once' },
    { text: 'h', priority: 'high', category: 'once' }, { text: '2', rank: 2, category: 'once' }, { text: '1', rank: 1, category: 'once' },
  ]
  assert.deepStrictEqual([...order].sort(priorityCompare).map(t => t.text), ['1', '2', 'h', 'n', 'low', 'd', 'w', 'm'])
  ok('title prefixes parse, compose and sort (1_ 2_ … H_, normal, L_, then z_ zz_ zzz_)')

  /* ===== First link: existing To Do tasks come in clean ===== */
  addRemote('1_Call bank')
  addRemote('2_Board pack')
  addRemote('H_Sign contract')
  addRemote('L_Tidy desk')
  addRemote('z_Check emails')
  addRemote('zz_Weekly review')
  addRemote('zzz_Month-end pack')
  addRemote('Plain task')
  const oldDone = addRemote('z_Old daily report', { status: 'completed', completedDateTime: { dateTime: '2026-08-03T12:00:00', timeZone: 'UTC' } })
  setLink(mode, { listId: LIST, listName: 'Work' })
  await sync()
  assert.strictEqual(local('Call bank').rank, 1)
  assert.strictEqual(local('Board pack').rank, 2)
  assert.strictEqual(local('Sign contract').priority, 'high')
  assert.strictEqual(local('Tidy desk').priority, 'low')
  assert.strictEqual(local('Check emails').category, 'daily')
  assert.strictEqual(local('Weekly review').category, 'weekly')
  assert.strictEqual(local('Month-end pack').category, 'monthly')
  assert.ok(!loadTodos(mode).some(t => /^(\d+|H|L|z{1,3})_/i.test(t.text)), 'no prefixes left in names')
  assert.ok(!local('Old daily report'), 'completed history is not downloaded')
  assert.ok(urls.every(u => !u.endsWith('/tasks?$top=100')), 'only open tasks are listed')
  ok('linking brings in open To Do tasks with clean names and priorities; completed history stays in To Do')

  calls.length = 0
  await sync()
  assert.deepStrictEqual(calls, ['GET /'], 'idle sync makes exactly one read and no writes')
  ok('an idle sync makes one read and no writes')

  /* ===== Changes made here go to To Do ===== */
  commit(all => all.map(t => (t.text === 'Plain task' ? { ...t, rank: 3 } : t.text === 'Sign contract' ? { ...t, priority: undefined, rank: 1 } : t)))
  assert.strictEqual(pendingCount(mode), 2)
  await sync()
  assert.ok(remote('3_Plain task') && remote('1_Sign contract'))
  commit(all => [
    ...all,
    { id: 'n1', text: 'Daily standup', done: false, category: 'daily', createdHere: true },
    { id: 'n2', text: 'Quick win', done: false, category: 'once', priority: 'high', createdHere: true },
  ])
  await sync()
  assert.ok(remote('z_Daily standup') && remote('H_Quick win'))
  ok('priority changes and new tasks are written to To Do with the right prefixes')

  /* ===== Changes made in To Do come here ===== */
  const td = remote('L_Tidy desk')
  td.title = 'H_Tidy desk'
  stamp(td)
  const ce = remote('z_Check emails')
  ce.title = 'Check emails'
  stamp(ce)
  await sync()
  assert.strictEqual(local('Tidy desk').priority, 'high')
  assert.strictEqual(local('Check emails').category, 'once')
  ok('prefix edits in To Do update priority and repeat here')

  /* ===== Legacy titles stored with prefixes are cleaned in place ===== */
  store.set('arcade-todos-personal', JSON.stringify([{ id: 'x', text: '4_Old task', done: false, category: 'once', remoteId: 'R', remoteModified: 'm' }]))
  assert.deepStrictEqual([loadTodos('personal')[0].text, loadTodos('personal')[0].rank], ['Old task', 4])
  saveTodos('personal', loadTodos('personal'))
  assert.ok(!loadTodos('personal')[0].dirty)
  store.delete('arcade-todos-personal')
  ok('older "4_Old task" names are cleaned up without being marked as changed')

  /* ===== Completing / deleting ===== */
  const cb = local('Call bank')
  commit(all => all.map(t => (t.id === cb.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  assert.strictEqual(remote('1_Call bank').status, 'completed')
  const qw = local('Quick win')
  markDeleted(mode, [qw])
  commit(all => all.filter(t => t.id !== qw.id))
  await sync()
  assert.ok(!remote('H_Quick win'))
  commit(all => [...all, qw]) // undo after the delete already reached To Do
  await sync()
  assert.ok(remote('H_Quick win') && local('Quick win'), 'undo recreates it')
  ok('completing, deleting and undoing a delete reach To Do')

  /* ===== Drag and drop ===== */
  const T = (id, extra = {}) => ({ id, text: id, done: false, category: 'once', ...extra })
  const view = list =>
    [...list].filter(t => !t.done).sort(priorityCompare).map(t => `${t.id}:${t.rank ?? t.priority ?? (t.category !== 'once' ? t.category : '-')}`)
  const base = [T('a', { rank: 1 }), T('b', { rank: 2 }), T('c', { rank: 3 }), T('h', { priority: 'high' }), T('n'), T('l', { priority: 'low' }), T('d', { category: 'daily' }), T('x', { rank: 9, done: true })]
  assert.deepStrictEqual(view(reprioritise(base, 'c', 'a')), ['c:1', 'a:2', 'b:3', 'h:high', 'n:-', 'l:low', 'd:daily'])
  assert.deepStrictEqual(view(reprioritise(base, 'a', 'c')), ['b:1', 'c:2', 'a:3', 'h:high', 'n:-', 'l:low', 'd:daily'])
  assert.deepStrictEqual(view(reprioritise(base, 'n', 'b')), ['a:1', 'n:2', 'b:3', 'c:4', 'h:high', 'l:low', 'd:daily'])
  assert.deepStrictEqual(view(reprioritise(base, 'b', 'h')), ['a:1', 'c:2', 'h:high', 'b:high', 'n:-', 'l:low', 'd:daily'])
  assert.deepStrictEqual(view(reprioritise(base, 'h', 'l')), ['a:1', 'b:2', 'c:3', 'n:-', 'l:low', 'h:low', 'd:daily'])
  assert.deepStrictEqual(view(reprioritise(base, 'l', 'n')), ['a:1', 'b:2', 'c:3', 'h:high', 'l:-', 'n:-', 'd:daily'])
  assert.strictEqual(reprioritise(base, 'a', 'd'), base, 'not across the daily boundary')
  assert.strictEqual(reprioritise(base, 'a', 'x'), base, 'not onto a completed task')
  assert.deepStrictEqual(view(reprioritise([T('p', { rank: 2 }), T('q', { rank: 5 }), T('r')], 'r', 'q')), ['p:1', 'r:2', 'q:3'])
  const rep = [T('w1', { category: 'weekly', rank: 1 }), T('w2', { category: 'weekly' }), T('d1', { category: 'daily' })]
  assert.strictEqual(reprioritise(rep, 'w2', 'd1'), rep, 'repeat groups are separate')
  calls.length = 0
  const ws = loadTodos(mode)
  commit(() => reprioritise(ws, ws.find(t => t.text === 'Plain task').id, ws.find(t => t.text === 'Board pack').id))
  await sync()
  const ranked = [...tasks.values()].filter(t => t.status !== 'completed' && /^\d+_/.test(t.title)).map(t => t.title).sort()
  assert.deepStrictEqual(ranked.map(t => parseInt(t)), ranked.map((_, i) => i + 1), 'To Do ranks are 1..n: ' + ranked)
  assert.deepStrictEqual(ranked, loadTodos(mode).filter(t => !t.done && t.rank).sort(priorityCompare).map(composeTitle))
  ok('drag and drop takes the target’s level, renumbers 1..n, and To Do’s A–Z order matches')

  /* ===== The page never writes a stale copy back (the "re-opened after sync" bug) ===== */
  const pageCopy = loadTodos(mode) // what the page is showing
  const bp = remote('2_Board pack') ?? remotes('3_Board pack')[0] ?? [...tasks.values()].find(t => /Board pack$/.test(t.title))
  bp.status = 'completed'
  bp.completedDateTime = dueOn(0)
  stamp(bp)
  const gone = addRemote('Will be deleted')
  await sync()
  tasks.delete(gone.id)
  await sync()
  assert.ok(local('Board pack').done, 'completion from To Do arrived')
  assert.ok(!local('Will be deleted'))
  // The user now edits another task on a page that hasn't refreshed yet:
  void pageCopy
  commit(all => all.map(t => (t.text === 'Tidy desk' ? { ...t, priority: 'low' } : t)))
  bodies.length = 0
  await sync()
  assert.strictEqual(bp.status, 'completed', 'not re-opened in To Do')
  assert.ok(local('Board pack').done)
  assert.ok(!local('Will be deleted'), 'deleted task not brought back')
  assert.ok(!bodies.some(b => /Board pack$/.test(b.title ?? '') && b.status === 'notStarted'), 'the completed task is not sent back as not done: ' + JSON.stringify(bodies))
  assert.deepStrictEqual(bodies.map(b => b.title), ['L_Tidy desk'], 'only the edited task is sent')
  ok('edits apply to the latest saved tasks, so a sync result is never undone or sent back')

  /* ===== A lagging list read never steps a task backwards ===== */
  const tick = local('Month-end pack')
  commit(all => all.map(t => (t.id === tick.id ? { ...t, done: true, completedAt: now } : t)))
  const mp = remote('zzz_Month-end pack')
  const staleCopy = { ...mp } // what a lagging read would still return
  await requestSync() // pushes the completion
  // Next sync's read lags: it still shows the task open, with an older modification time.
  lagNextList = { ...staleCopy, lastModifiedDateTime: new Date(CLOCK_BASE - 3600000).toISOString() }
  await sync()
  assert.ok(local('Month-end pack').done, 'stayed ticked despite the stale read')
  ok('an out-of-date read from To Do is ignored')

  /* ===== Daily reset rules ===== */
  const before = [
    { id: 'y', text: 'y', done: true, completedAt: yesterday, category: 'daily' }, // local-only
    { id: 't', text: 't', done: true, completedAt: now, category: 'daily' },
    { id: 'w', text: 'w', done: true, completedAt: now, category: 'weekly' }, // this week: stays done
    { id: 'r', text: 'r', done: true, completedAt: yesterday, category: 'daily', remoteId: 'R1' }, // from To Do
  ]
  const after = resetRepeatingTasks(before)
  assert.deepStrictEqual(after.map(t => [t.id, t.done]), [['y', false], ['t', true], ['w', true], ['r', true]])
  assert.strictEqual(resetRepeatingTasks(after), after, 'stable')
  // A synced daily task created here: To Do keeps the completed copy, a fresh copy is added for today
  const ds = local('Daily standup')
  commit(all => all.map(t => (t.id === ds.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  assert.strictEqual(remote('z_Daily standup').status, 'completed')
  saveTodosRaw(mode, loadTodos(mode).map(t => (t.id === ds.id ? { ...t, completedAt: yesterday } : t))) // overnight
  commit(all => resetRepeatingTasks(all)) // the page's morning check
  bodies.length = 0
  await sync()
  assert.ok(!bodies.some(b => b.status === 'notStarted' && !b.title), 'the completed copy is not re-opened')
  const standups = remotes('z_Daily standup')
  assert.deepStrictEqual(standups.map(t => t.status).sort(), ['completed', 'notStarted'], 'old copy stays completed; new one for today')
  const localStandups = loadTodos(mode).filter(t => t.text === 'Daily standup')
  assert.strictEqual(localStandups.filter(t => !t.done).length, 1)
  commit(all => resetRepeatingTasks(all))
  await sync()
  assert.strictEqual(remotes('z_Daily standup').length, 2, 'rolled over only once')
  ok('daily tasks made here start fresh each morning as a new copy; completed copies are never re-opened')

  // Tasks that came from To Do are never reset
  const fromTodo = addRemote('z_Morning report')
  await sync()
  const mr = local('Morning report')
  commit(all => all.map(t => (t.id === mr.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  saveTodosRaw(mode, loadTodos(mode).map(t => (t.id === mr.id ? { ...t, completedAt: yesterday } : t)))
  commit(all => resetRepeatingTasks(all))
  await sync()
  assert.strictEqual(fromTodo.status, 'completed')
  assert.strictEqual(remotes('z_Morning report').length, 1)
  ok('daily tasks from To Do are left alone by the morning reset')

  /* ===== To Do-repeated series ===== */
  // Completed records the old reset re-opened (real ones keep the recurrence), next to the real task.
  const c2 = addRemote('z_Recon Summary', { dueDateTime: dueOn(-2), recurrence: rec })
  const c1 = addRemote('z_Recon Summary', { dueDateTime: dueOn(-1), recurrence: rec })
  const c0 = addRemote('z_Recon Summary', { dueDateTime: dueOn(0), recurrence: rec })
  const cT = addRemote('z_Recon Summary', { dueDateTime: dueOn(1), recurrence: rec })
  store.delete('arcade-sync-series-cleanup-' + mode)
  const n0 = tasks.size
  await sync()
  assert.strictEqual(tasks.size, n0, 'cleanup creates no copies')
  assert.deepStrictEqual([c2, c1, c0, cT].map(t => t.status), ['completed', 'completed', 'notStarted', 'notStarted'])
  assert.ok(!c2.recurrence && !c1.recurrence, 'recurrence removed first, so completing them moves nothing on')
  calls.length = 0
  await sync()
  assert.ok(!calls.some(c => c.startsWith('PATCH')), 'cleanup runs once')
  ok('copies brought back by the old reset are ticked off again without creating new ones')

  // A task To Do repeats (weekdays), overdue from yesterday, ticked here:
  const weekdays = { pattern: { type: 'daily', interval: 1 }, range: { type: 'noEnd', startDate: dayStr(-30) } }
  const dfd = addRemote('z_Data Feed Dashboard', { dueDateTime: dueOn(-1), recurrence: weekdays })
  await sync()
  const dfdLocal = local('Data Feed Dashboard')
  assert.ok(dfdLocal.remoteSeries && !dfdLocal.done)
  commit(all => all.map(t => (t.id === dfdLocal.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  assert.strictEqual(dfd.status, 'notStarted', 'To Do keeps the task open…')
  assert.strictEqual(localDay(dfd.dueDateTime), dayStr(0), '…and moves it to the next occurrence (today)')
  assert.strictEqual(remotes('z_Data Feed Dashboard').filter(t => t.status === 'completed').length, 1, 'one completion recorded')
  const after1 = local('Data Feed Dashboard')
  assert.ok(!after1.done && after1.dueDate === dayStr(0) && after1.lastCompletedDue === dayStr(-1), 'here: open, due today; yesterday’s was the one done')
  const ctxToday = views.buildViewContext(loadTodos(mode), 1)
  assert.ok(views.inView(after1, 'daily', ctxToday), 'yesterday’s done — today’s is still on the Daily list')
  assert.ok(views.inView(after1, 'today', ctxToday), 'and on Today')
  assert.ok(!ctxToday.doneThisPeriod(after1), 'not marked done for today')
  // …now tick today's:
  commit(all => all.map(t => (t.id === after1.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  const after2 = local('Data Feed Dashboard')
  assert.strictEqual(localDay(dfd.dueDateTime), dayStr(1), 'To Do moves it to tomorrow')
  const ctxAfter2 = views.buildViewContext(loadTodos(mode), 1)
  assert.ok(!views.inView(after2, 'daily', ctxAfter2), 'today’s done: off the Daily list')
  assert.ok(views.inView(after2, 'daily', views.buildViewContext(loadTodos(mode), 1, dayStr(1))), 'back tomorrow')
  calls.length = 0
  await sync()
  await sync()
  assert.strictEqual(remotes('z_Data Feed Dashboard').filter(t => t.status === 'completed').length, 2, 'exactly two ticks: yesterday’s and today’s')
  ok('ticking an overdue daily task completes yesterday’s and keeps today’s on the list; ticking today’s removes it')

  // Ticked in To Do itself: the due date jumps forward and the app treats that as done for today
  const pls = addRemote('z_Platform Summary', { dueDateTime: dueOn(-1), recurrence: weekdays })
  await sync()
  await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${LIST}/tasks/${pls.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  await sync()
  const plsLocal = local('Platform Summary')
  assert.ok(!plsLocal.done && plsLocal.dueDate === dayStr(0) && plsLocal.lastCompletedAt)
  assert.ok(views.inView(plsLocal, 'daily', views.buildViewContext(loadTodos(mode), 1)), 'overdue ticked in To Do: today’s still on the list')
  await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${LIST}/tasks/${pls.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  await sync()
  assert.ok(!views.inView(local('Platform Summary'), 'daily', views.buildViewContext(loadTodos(mode), 1)), 'today’s ticked in To Do: off the list')
  ok('ticks made in To Do follow the same rule: overdue keeps today’s, today’s removes it')

  // A repeating task stuck as "done" here (from the earlier version) is repaired from To Do
  const stuck = addRemote('z_Account Mapping', { dueDateTime: dueOn(2), recurrence: weekdays })
  await sync()
  saveTodosRaw(mode, loadTodos(mode).map(t => (t.remoteId === stuck.id ? { ...t, done: true, completedAt: yesterday } : t)))
  await sync()
  const fixed = local('Account Mapping')
  assert.ok(!fixed.done && fixed.dueDate === dayStr(2) && fixed.lastCompletedAt === yesterday, 'open again with To Do’s next due date')
  assert.strictEqual(stuck.status, 'notStarted')
  ok('repeating tasks stuck as done here are corrected from To Do')

  /* ===== Open-only pulls: completions, deletions and due dates from To Do ===== */
  const p1 = addRemote('Pay supplier')
  const p2 = addRemote('Book venue')
  const p3 = addRemote('Call auditor', { dueDateTime: dueOn(2) })
  const p4 = addRemote('Send pack', { dueDateTime: dueOn(3) })
  await sync()
  p1.status = 'completed'
  p1.completedDateTime = dueOn(0)
  stamp(p1)
  tasks.delete(p2.id)
  p3.dueDateTime = dueOn(5)
  stamp(p3)
  p4.dueDateTime = null
  stamp(p4)
  urls.length = 0
  await sync()
  assert.ok(local('Pay supplier').done)
  assert.ok(!local('Book venue'))
  assert.strictEqual(local('Call auditor').dueDate, dayStr(5))
  assert.strictEqual(local('Send pack').dueDate, undefined, 'due date removed in To Do is removed here')
  assert.ok(urls.every(u => !u.endsWith('/tasks?$top=100')), 'never downloads the full history')
  const dm = addRemote('Draft memo')
  await sync()
  commit(all => all.map(t => (t.text === 'Draft memo' ? { ...t, dueDate: dayStr(3) } : t)))
  dm.title = 'Draft memo v2'
  stamp(dm)
  await sync()
  assert.strictEqual(local('Draft memo v2').dueDate, dayStr(3), 'a due date set only here is kept')
  saveTodosRaw(mode, loadTodos(mode).map(t => (t.text === 'Pay supplier' ? { ...t, completedAt: new Date(Date.now() - 20 * 86400000).toISOString() } : t)))
  await sync()
  assert.ok(!local('Pay supplier') && p1.status === 'completed', 'old completed tasks leave the browser, not To Do')
  ok('completions, deletions and due-date changes in To Do arrive; history is never downloaded')

  /* ===== Sync never jams ===== */
  msal.fail = true
  await requestSync()
  assert.strictEqual(getStatus().phase, 'signed-out')
  msal.fail = false
  addRemote('After recovery')
  await sync()
  assert.ok(local('After recovery'), 'the next sync runs normally')
  ok('a failed sign-in check does not stop later syncs')

  /* ===== Repair list ===== */
  const afterShip = '2026-10-21T09:00:00Z'
  const mk = (title, extra) => {
    const t = addRemote(title, extra)
    t.lastModifiedDateTime = extra.lastModifiedDateTime ?? afterShip
    return t
  }
  const rDate = mk('z_Recon pack', { dueDateTime: dueOn(-30), completedDateTime: dueOn(-30) })
  const rOld = mk('zz_Pipeline', { dueDateTime: dueOn(-14) })
  mk('z_Today copy', { dueDateTime: dueOn(0) })
  mk('z_Series head', { dueDateTime: dueOn(-1), recurrence: rec })
  mk('Plain overdue', { dueDateTime: dueOn(-10) })
  mk('z_Untouched', { dueDateTime: dueOn(-10), lastModifiedDateTime: '2026-10-19T09:00:00Z' })
  const found = await findReopenedCandidates()
  assert.deepStrictEqual(new Set(found.map(f => f.remoteId)), new Set([rDate.id, rOld.id]), found.map(f => f.text).join())
  assert.deepStrictEqual(found.filter(f => f.likely).map(f => f.remoteId), [rDate.id])
  const n1 = tasks.size
  assert.strictEqual(await markRemoteCompleted(found.filter(f => f.likely)), 1)
  assert.strictEqual(rDate.status, 'completed')
  assert.strictEqual(rOld.status, 'notStarted')
  assert.strictEqual(tasks.size, n1)
  ok('the repair list shows only plausible re-opened tasks and changes only what is chosen')

  /* ===== Period views ===== */
  const today = dayStr(0)
  const V = (id, extra) => ({ id, text: id, done: false, ...extra })
  const sample = [
    V('d-today', { category: 'daily', dueDate: today }),
    V('d-overdue', { category: 'daily', dueDate: dayStr(-1) }),
    V('d-tomorrow', { category: 'daily', dueDate: dayStr(1) }),
    V('d-undated', { category: 'daily' }),
    V('d-done', { category: 'daily', done: true, completedAt: now }),
    V('w-this', { category: 'weekly', dueDate: views.periodBounds('weekly', 1).end }),
    V('w-next', { category: 'weekly' }), // due date set just below: the day after this week ends
    V('m-this', { category: 'monthly', dueDate: views.periodBounds('monthly', 1).end }),
  ]
  sample[6].dueDate = (() => {
    const e = views.periodBounds('weekly', 1).end
    const d = new Date(e + 'T00:00:00')
    d.setDate(d.getDate() + 1)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  })()
  // A series ticked this period: its other open copy is hidden
  sample.push(V('Series', { category: 'weekly', done: true, completedAt: now }), { ...V('Series', { category: 'weekly' }), id: 'series-open', originalId: 'Series' })
  sample.push(V('Same name', { category: 'daily', done: true, completedAt: now }), { ...V('Same name', { category: 'daily', dueDate: today }), id: 'same-name-other' })
  const c = views.buildViewContext(sample, 1)
  const list = v => sample.filter(t => views.inView(t, v, c)).map(t => t.id)
  assert.deepStrictEqual(list('daily'), ['d-today', 'd-overdue', 'd-undated', 'same-name-other'], 'a different task with the same name is not hidden')
  assert.deepStrictEqual(list('weekly'), ['w-this'])
  assert.deepStrictEqual(list('monthly'), ['m-this'])
  assert.deepStrictEqual(c.doneInPeriod, { daily: 2, weekly: 1, monthly: 0 })
  const wk = views.periodBounds('weekly', 1, '2026-10-22') // a Thursday
  assert.deepStrictEqual(wk, { start: '2026-10-19', end: '2026-10-25' })
  assert.deepStrictEqual(views.periodBounds('weekly', 0, '2026-10-22'), { start: '2026-10-18', end: '2026-10-24' })
  assert.deepStrictEqual(views.periodBounds('monthly', 1, '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' })
  ok('Daily, Weekly and Monthly list only what is still open this day, week or month')


  /* ===== Everyday edge cases ===== */
  const wd = { pattern: { type: 'weekly', interval: 1, daysOfWeek: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday'] }, range: { type: 'noEnd', startDate: dayStr(-30) } }
  // 1. A repeating task is completed exactly once per tick, however many syncs follow
  const rs = addRemote('z_Reconcile cash', { dueDateTime: dueOn(0), recurrence: wd })
  await sync()
  const rsLocal = local('Reconcile cash')
  commit(all => all.map(t => (t.id === rsLocal.id ? { ...t, done: true, completedAt: now } : t)))
  await Promise.all([requestSync(), requestSync(), requestSync()]) // several triggers at once
  await sync()
  await sync()
  assert.strictEqual(remotes('z_Reconcile cash').filter(t => t.status === 'completed').length, 1, 'completed once')
  assert.strictEqual(pendingCount(mode), 0)
  ok('one tick completes a repeating task exactly once, even with overlapping syncs')

  // 2. Ticking and unticking before the sync runs sends nothing that changes To Do
  const ut = addRemote('z_Untick me', { dueDateTime: dueOn(0), recurrence: wd })
  await sync()
  const utId = local('Untick me').id
  commit(all => all.map(t => (t.id === utId ? { ...t, done: true, completedAt: now } : t)))
  commit(all => all.map(t => (t.id === utId ? { ...t, done: false, completedAt: undefined } : t)))
  await sync()
  assert.strictEqual(remotes('z_Untick me').filter(t => t.status === 'completed').length, 0, 'not completed in To Do')
  assert.strictEqual(ut.status, 'notStarted')
  assert.ok(views.inView(local('Untick me'), 'daily', views.buildViewContext(loadTodos(mode), 1)), 'still on today’s list')
  ok('ticking then unticking before a sync leaves To Do untouched')

  // 3. An edit made while a sync is running is not lost
  const e1 = addRemote('Edit during sync A')
  const e2 = addRemote('Edit during sync B')
  await sync()
  const eA = local('Edit during sync A').id
  commit(all => all.map(t => (t.id === eA ? { ...t, text: 'Edit during sync A2' } : t)))
  let fired = false
  onRequest = async method => {
    if (method === 'PATCH' && !fired) {
      fired = true
      commit(all => all.map(t => (t.text === 'Edit during sync B' ? { ...t, priority: 'high' } : t)))
    }
  }
  await sync()
  onRequest = null
  await sync()
  assert.strictEqual(e1.title, 'Edit during sync A2')
  assert.strictEqual(e2.title, 'H_Edit during sync B', 'the mid-sync edit reached To Do too')
  assert.strictEqual(pendingCount(mode), 0)
  ok('an edit made while a sync is running still reaches To Do')

  // 4. Weekday task: ticked Friday → off the list for the weekend, back on Monday
  const fri = '2026-10-23'
  const ctxSat = views.buildViewContext([{ id: 'f', text: 'Weekday job', category: 'daily', done: false, dueDate: '2026-10-26', lastCompletedAt: '2026-10-23T08:00:00Z' }], 1, '2026-10-24')
  const fTask = { id: 'f', text: 'Weekday job', category: 'daily', done: false, dueDate: '2026-10-26', lastCompletedAt: '2026-10-23T08:00:00Z' }
  assert.ok(!views.inView(fTask, 'daily', ctxSat), 'Saturday: not shown (due Monday)')
  const ctxMon = views.buildViewContext([fTask], 1, '2026-10-26')
  assert.ok(views.inView(fTask, 'daily', ctxMon), 'Monday: back')
  assert.strictEqual(ctxMon.doneInPeriod.daily, 0, 'Friday’s tick does not count as done Monday')
  void fri
  ok('a weekday task ticked on Friday is back on Monday, not counted as done')

  // 5. Weekly view respects the week start setting
  const sun = { id: 's', text: 'Sunday report', category: 'weekly', done: false, dueDate: '2026-10-25' } // a Sunday
  assert.ok(views.inView(sun, 'weekly', views.buildViewContext([sun], 1, '2026-10-22')), 'Monday-start week: Sun 25 is this week')
  assert.ok(!views.inView(sun, 'weekly', views.buildViewContext([sun], 0, '2026-10-22')), 'Sunday-start week: Sun 25 is next week')
  ok('the Weekly list follows the week-start setting')

  /* ===== Review fixes ===== */
  // #1a A task ticked in To Do, then edited here before the app syncs, must stay completed
  const ph = addRemote('2_Phone tick')
  await sync()
  await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${LIST}/tasks/${ph.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  commit(all => all.map(t => (t.text === 'Phone tick' ? { ...t, rank: 1 } : t)))
  await sync()
  assert.strictEqual(ph.status, 'completed', 'not re-opened by the edit')
  assert.strictEqual(ph.title, '1_Phone tick', 'the edit still went through')
  assert.ok(local('Phone tick').done, 'and it shows as done here')
  ok('editing a task that was just ticked in To Do keeps it completed')

  // #1b Same for a repeating task: the tick in To Do is recognised and not repeated
  const st = addRemote('z_Phone standup', { dueDateTime: dueOn(0), recurrence: wd })
  await sync()
  await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${LIST}/tasks/${st.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  commit(all => all.map(t => (t.text === 'Phone standup' ? { ...t, priority: 'high' } : t)))
  await sync()
  await sync()
  assert.strictEqual(remotes('z_H_Phone standup').filter(t => t.status === 'completed').length + remotes('z_Phone standup').filter(t => t.status === 'completed').length, 1, 'completed once only')
  const psl = local('Phone standup')
  assert.ok(psl.lastCompletedAt, 'recognised as done for today')
  assert.ok(!views.inView(psl, 'daily', views.buildViewContext(loadTodos(mode), 1)), 'off today’s Daily list')
  ok('editing a repeating task ticked in To Do keeps it off today’s list without ticking it again')

  // #4 An overdue monthly/weekly occurrence ticked in the next period doesn't hide that period's one
  const m = { id: 'm', text: 'Month-end', category: 'monthly', done: false, dueDate: '2026-11-30', lastCompletedAt: '2026-11-02T09:00:00Z', lastCompletedDue: '2026-10-31' }
  assert.ok(views.inView(m, 'monthly', views.buildViewContext([m], 1, '2026-11-02')), 'October’s tick (done 2 Nov) leaves November’s on the list')
  const m2 = { ...m, lastCompletedDue: '2026-11-30', dueDate: '2026-12-31', lastCompletedAt: '2026-11-20T09:00:00Z' }
  assert.ok(!views.inView(m2, 'monthly', views.buildViewContext([m2], 1, '2026-11-21')), 'November’s own tick does hide it for November')
  const w = { id: 'w', text: 'Weekly BCI', category: 'weekly', done: false, dueDate: '2026-10-30', lastCompletedAt: '2026-10-26T09:00:00Z', lastCompletedDue: '2026-10-23' }
  assert.ok(views.inView(w, 'weekly', views.buildViewContext([w], 1, '2026-10-26')), 'last Friday’s tick on Monday leaves this Friday’s on the list')
  const dly = { id: 'd', text: 'Daily', category: 'daily', done: false, dueDate: dayStr(0), lastCompletedAt: now, lastCompletedDue: dayStr(-1) }
  assert.ok(views.inView(dly, 'daily', views.buildViewContext([dly], 1)), 'daily: ticking yesterday’s overdue one leaves today’s on the list')
  ok('ticking an overdue weekly/monthly task doesn’t hide the current period’s occurrence')

  // #5 A repeating task already done this period is marked done everywhere, so it isn't ticked again
  const dlyToday = { ...dly, dueDate: dayStr(1), lastCompletedDue: dayStr(0) }
  const ctx5 = views.buildViewContext([dlyToday], 1)
  assert.ok(ctx5.doneThisPeriod(dlyToday), 'known as done for today')
  assert.ok(!ctx5.doneThisPeriod({ ...dlyToday, lastCompletedAt: yesterday }), 'yesterday’s tick doesn’t count')
  ok('a repeating task done this period is recognised as done in every view')

  // #6 Weekly and monthly tasks made in this app come back each new week / month
  const lastWeek = new Date(Date.now() - 8 * 86400000).toISOString()
  const lastMonthTime = (() => { const d = new Date(); d.setDate(0); d.setHours(12); return d.toISOString() })() // last day of previous month
  const rr = resetRepeatingTasks([
    { id: 'w-local', text: 'w', done: true, completedAt: lastWeek, category: 'weekly' },
    { id: 'm-local', text: 'm', done: true, completedAt: lastMonthTime, category: 'monthly' },
    { id: 'w-now', text: 'w2', done: true, completedAt: now, category: 'weekly' },
    { id: 'w-todo', text: 'w3', done: true, completedAt: lastWeek, category: 'weekly', remoteId: 'RW' }, // from To Do
  ])
  assert.deepStrictEqual(rr.map(t => [t.id, t.done]), [['w-local', false], ['m-local', false], ['w-now', true], ['w-todo', true]])
  ok('weekly and monthly tasks made in this app come back each new week and month')

  // Renaming a repeating task while its tick is being sent doesn't tick it twice
  const mf = addRemote('z_Midflight', { dueDateTime: dueOn(0), recurrence: wd })
  await sync()
  const mfId = local('Midflight').id
  commit(all => all.map(t => (t.id === mfId ? { ...t, done: true, completedAt: now } : t)))
  let renamed = false
  onRequest = async method => {
    if (method === 'PATCH' && !renamed) {
      renamed = true
      commit(all => all.map(t => (t.id === mfId ? { ...t, text: 'Midflight renamed' } : t)))
    }
  }
  await sync()
  onRequest = null
  await sync()
  await sync()
  assert.strictEqual(remotes('z_Midflight').length + remotes('z_Midflight renamed').length >= 1, true)
  const mfDone = [...tasks.values()].filter(t => /Midflight/.test(t.title) && t.status === 'completed').length
  assert.strictEqual(mfDone, 1, 'completed exactly once')
  assert.strictEqual(mf.title, 'z_Midflight renamed', 'the rename still reached To Do')
  assert.ok(local('Midflight renamed').lastCompletedAt && !local('Midflight renamed').done)
  ok('renaming a repeating task while its tick is in flight neither loses the rename nor ticks it twice')

  // #10 Deleting a task while it is still being created doesn't bring it back
  commit(all => [...all, { id: 'quick', text: 'Quick delete', done: false, category: 'once', createdHere: true }])
  onRequest = async method => {
    if (method === 'POST') commit(all => all.filter(t => t.id !== 'quick'))
  }
  await sync()
  onRequest = null
  await sync()
  assert.ok(!local('Quick delete'), 'not back here')
  assert.ok(!remote('Quick delete'), 'and removed from To Do again')
  ok('a task deleted while it was being created stays deleted')

  // #7 Unticking a custom-days task takes back the copy its tick created
  const gym = { id: 'gym', text: 'Gym', done: false, category: 'custom', recurrenceDays: [1, 3, 5], dueDate: dayStr(0) }
  const ticked = toggleDone([gym], 'gym').next
  assert.strictEqual(ticked.length, 2, 'tick adds the next occurrence')
  const un = toggleDone(ticked, 'gym')
  assert.deepStrictEqual(un.next.map(t => [t.id, t.done]), [['gym', false]], 'untick takes it back')
  assert.strictEqual(un.removed.length, 1)
  ok('unticking a custom-days task removes the copy its tick created')

  // #8 Typing z_ into a custom-days task makes it daily and drops the custom days
  const pz = priority.withParsedTitle({ ...gym, text: 'z_Gym' })
  assert.deepStrictEqual([pz.category, pz.recurrenceDays, pz.text], ['daily', undefined, 'Gym'])
  ok('typing a repeat prefix replaces custom days')

  // #9 A duplicate is a fresh, independent task
  const dupSrc = { id: 'src', text: 'Recon', done: false, category: 'daily', remoteId: 'R9', remoteSeries: true, lastCompletedAt: now, lastCompletedDue: dayStr(0), remoteDue: dayStr(1), dueDate: dayStr(1), rolledOver: true, originalId: 'x', doneChanged: true }
  const dup = duplicateOf(dupSrc)
  for (const k of ['remoteId', 'remoteSeries', 'lastCompletedAt', 'lastCompletedDue', 'remoteDue', 'rolledOver', 'originalId', 'doneChanged']) assert.strictEqual(dup[k], undefined, k + ' cleared')
  assert.strictEqual(dup.dueDate, dayStr(1), 'keeps its due date')
  const ctx9 = views.buildViewContext([dupSrc, { ...dup, dueDate: dayStr(0) }], 1)
  assert.ok(views.inView({ ...dup, dueDate: dayStr(0) }, 'daily', ctx9), 'not hidden because the original was done')
  ok('duplicates carry no sync history and are not hidden by the original')

  // #3 Clear completed never removes a tick that hasn't reached To Do
  assert.ok(!isClearable({ id: 'a', text: 'a', done: true, category: 'once', dirty: true, remoteId: 'R' }, true), 'unsynced tick kept')
  assert.ok(!isClearable({ id: 'b', text: 'b', done: true, category: 'once' }, true), 'never-synced task in a synced workspace kept')
  assert.ok(isClearable({ id: 'c', text: 'c', done: true, category: 'once', remoteId: 'R' }, true), 'synced completed task can go')
  assert.ok(isClearable({ id: 'd', text: 'd', done: true, category: 'once' }, false), 'local-only workspace: can go')
  assert.ok(!isClearable({ id: 'e', text: 'e', done: true, category: 'daily', remoteId: 'R' }, true), 'daily kept')
  ok('clearing completed tasks never removes a tick that has not reached To Do')

  // Daily tasks made in this app: ticking an overdue one brings it straight back for today
  const od = resetRepeatingTasks([{ id: 'od', text: 'Local daily', done: true, completedAt: now, category: 'daily', dueDate: dayStr(-1) }])
  assert.deepStrictEqual(od.map(t => [t.done, t.dueDate]), [[false, dayStr(0)]], 'local-only: back, due today')
  const odToday = resetRepeatingTasks([{ id: 'od2', text: 'Local daily', done: true, completedAt: now, category: 'daily', dueDate: dayStr(0) }])
  assert.strictEqual(odToday[0].done, true, 'today’s ticked: stays done')
  const odSynced = resetRepeatingTasks([{ id: 'od3', text: 'Synced daily', done: true, completedAt: now, category: 'daily', dueDate: dayStr(-1), remoteId: 'R3', createdHere: true }])
  assert.deepStrictEqual(odSynced.map(t => [t.done, t.dueDate, !!t.remoteId]), [[true, dayStr(-1), true], [false, dayStr(0), false]], 'synced: yesterday’s stays done, a fresh one for today')
  ok('ticking an overdue daily task made in the app brings it straight back for today')
  console.log(`\nAll ${passed} sync checks passed.`)
})().catch(e => {
  console.error('FAILED:', e)
  process.exit(1)
})
