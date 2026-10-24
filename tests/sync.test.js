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
const stamp = t => {
  t.lastModifiedDateTime = `2026-10-24T10:${String(Math.floor(++clock / 60)).padStart(2, '0')}:${String(clock % 60).padStart(2, '0')}Z`
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
global.fetch = async (url, init = {}) => {
  const method = init.method || 'GET'
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
const { loadTodos, saveTodos, saveTodosRaw, markDeleted, resetDailyTasks } = todosLib
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
  lagNextList = { ...staleCopy, lastModifiedDateTime: '2026-10-24T09:00:00Z' }
  await sync()
  assert.ok(local('Month-end pack').done, 'stayed ticked despite the stale read')
  ok('an out-of-date read from To Do is ignored')

  /* ===== Daily reset rules ===== */
  const before = [
    { id: 'y', text: 'y', done: true, completedAt: yesterday, category: 'daily' }, // local-only
    { id: 't', text: 't', done: true, completedAt: now, category: 'daily' },
    { id: 'w', text: 'w', done: true, completedAt: yesterday, category: 'weekly' },
    { id: 'r', text: 'r', done: true, completedAt: yesterday, category: 'daily', remoteId: 'R1' }, // from To Do
  ]
  const after = resetDailyTasks(before)
  assert.deepStrictEqual(after.map(t => [t.id, t.done]), [['y', false], ['t', true], ['w', true], ['r', true]])
  assert.strictEqual(resetDailyTasks(after), after, 'stable')
  // A synced daily task created here: To Do keeps the completed copy, a fresh copy is added for today
  const ds = local('Daily standup')
  commit(all => all.map(t => (t.id === ds.id ? { ...t, done: true, completedAt: now } : t)))
  await sync()
  assert.strictEqual(remote('z_Daily standup').status, 'completed')
  saveTodosRaw(mode, loadTodos(mode).map(t => (t.id === ds.id ? { ...t, completedAt: yesterday } : t))) // overnight
  commit(all => resetDailyTasks(all)) // the page's morning check
  bodies.length = 0
  await sync()
  assert.ok(!bodies.some(b => b.status === 'notStarted' && !b.title), 'the completed copy is not re-opened')
  const standups = remotes('z_Daily standup')
  assert.deepStrictEqual(standups.map(t => t.status).sort(), ['completed', 'notStarted'], 'old copy stays completed; new one for today')
  const localStandups = loadTodos(mode).filter(t => t.text === 'Daily standup')
  assert.strictEqual(localStandups.filter(t => !t.done).length, 1)
  commit(all => resetDailyTasks(all))
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
  commit(all => resetDailyTasks(all))
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
  assert.ok(!after1.done && after1.lastCompletedAt && after1.dueDate === dayStr(0), 'here: open, due today, done today')
  const ctxToday = views.buildViewContext(loadTodos(mode), 1)
  assert.ok(!views.inView(after1, 'daily', ctxToday), 'not on today’s Daily list')
  assert.ok(!views.inView(after1, 'today', ctxToday), 'not on Today either')
  const ctxTomorrow = views.buildViewContext(loadTodos(mode), 1, dayStr(1))
  assert.ok(views.inView(after1, 'daily', ctxTomorrow), 'back on the Daily list tomorrow')
  calls.length = 0
  await sync()
  await sync()
  assert.strictEqual(remotes('z_Data Feed Dashboard').filter(t => t.status === 'completed').length, 1, 'never ticked twice')
  ok('ticking a repeating task removes it for today, even though To Do moves it to today; it is back tomorrow')

  // Ticked in To Do itself: the due date jumps forward and the app treats that as done for today
  const pls = addRemote('z_Platform Summary', { dueDateTime: dueOn(-1), recurrence: weekdays })
  await sync()
  await fetch(`https://graph.microsoft.com/v1.0/me/todo/lists/${LIST}/tasks/${pls.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'completed' }) })
  await sync()
  const plsLocal = local('Platform Summary')
  assert.ok(!plsLocal.done && plsLocal.dueDate === dayStr(0) && plsLocal.lastCompletedAt)
  assert.ok(!views.inView(plsLocal, 'daily', views.buildViewContext(loadTodos(mode), 1)), 'ticked in To Do: off today’s list')
  ok('ticking a repeating task in To Do also takes it off today’s list')

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
  sample.push(V('Series', { category: 'weekly', done: true, completedAt: now }), { ...V('Series', { category: 'weekly' }), id: 'series-open' })
  const c = views.buildViewContext(sample, 1)
  const list = v => sample.filter(t => views.inView(t, v, c)).map(t => t.id)
  assert.deepStrictEqual(list('daily'), ['d-today', 'd-overdue', 'd-undated'])
  assert.deepStrictEqual(list('weekly'), ['w-this'])
  assert.deepStrictEqual(list('monthly'), ['m-this'])
  assert.deepStrictEqual(c.doneInPeriod, { daily: 1, weekly: 1, monthly: 0 })
  const wk = views.periodBounds('weekly', 1, '2026-10-22') // a Thursday
  assert.deepStrictEqual(wk, { start: '2026-10-19', end: '2026-10-25' })
  assert.deepStrictEqual(views.periodBounds('weekly', 0, '2026-10-22'), { start: '2026-10-18', end: '2026-10-24' })
  assert.deepStrictEqual(views.periodBounds('monthly', 1, '2026-02-10'), { start: '2026-02-01', end: '2026-02-28' })
  ok('Daily, Weekly and Monthly list only what is still open this day, week or month')

  console.log(`\nAll ${passed} sync checks passed.`)
})().catch(e => {
  console.error('FAILED:', e)
  process.exit(1)
})
