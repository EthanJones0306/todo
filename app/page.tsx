'use client'

import { useState, useEffect } from 'react'

type Category = 'once' | 'daily' | 'weekly' | 'monthly'

interface Todo {
  id: string
  text: string
  done: boolean
  category: Category
}

const CATEGORY_ORDER: Category[] = ['once', 'daily', 'weekly', 'monthly']
const CATEGORY_LABEL: Record<Category, string> = {
  once: 'One-off',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
}

type Filter = 'all' | Category
const FILTER_ORDER: Filter[] = ['all', 'daily', 'weekly', 'monthly', 'once']
const FILTER_LABEL: Record<Filter, string> = {
  all: 'All',
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  once: 'One-off',
}

function normalizeCategory(value: unknown): Category {
  return CATEGORY_ORDER.includes(value as Category) ? (value as Category) : 'once'
}

type Theme = 'neon' | 'crt' | 'paper' | 'standard'

const THEME_ORDER: Theme[] = ['neon', 'crt', 'paper', 'standard']
const THEME_LABEL: Record<Theme, string> = {
  neon: 'Neon',
  crt: 'CRT',
  paper: 'Paper',
  standard: 'Standard',
}

function loadTheme(): Theme {
  if (typeof document === 'undefined') return 'neon'
  const attr = document.documentElement.getAttribute('data-theme')
  return THEME_ORDER.includes(attr as Theme) ? (attr as Theme) : 'neon'
}

function loadTodos(): Todo[] {
  if (typeof window === 'undefined') return []
  try {
    const parsed = JSON.parse(localStorage.getItem('arcade-todos') || '[]')
    return parsed.map((t: any) => ({ ...t, category: normalizeCategory(t.category) }))
  } catch {
    return []
  }
}

function saveTodos(todos: Todo[]) {
  localStorage.setItem('arcade-todos', JSON.stringify(todos))
}

export default function Home() {
  const [todos, setTodos] = useState<Todo[]>([])
  const [input, setInput] = useState('')
  const [mounted, setMounted] = useState(false)
  const [theme, setTheme] = useState<Theme>('neon')
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editText, setEditText] = useState('')
  const [newCategory, setNewCategory] = useState<Category>('once')
  const [filter, setFilter] = useState<Filter>('all')

  useEffect(() => {
    setTodos(loadTodos())
    setTheme(loadTheme())
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) saveTodos(todos)
  }, [todos, mounted])

  const applyTheme = (next: Theme) => {
    setTheme(next)
    document.documentElement.setAttribute('data-theme', next)
    localStorage.setItem('arcade-theme', next)
  }

  const addTodo = () => {
    const text = input.trim()
    if (!text) return
    setTodos(prev => [...prev, { id: crypto.randomUUID(), text, done: false, category: newCategory }])
    setInput('')
  }

  const toggleTodo = (id: string) => {
    setTodos(prev =>
      prev.map(t => (t.id === id ? { ...t, done: !t.done } : t))
    )
  }

  const deleteTodo = (id: string) => {
    setTodos(prev => prev.filter(t => t.id !== id))
  }

  const setCategory = (id: string, category: Category) => {
    setTodos(prev => prev.map(t => (t.id === id ? { ...t, category } : t)))
  }

  const setPriority = (id: string, position: number) => {
    setTodos(prev => {
      const from = prev.findIndex(t => t.id === id)
      if (from === -1) return prev
      const to = Math.min(Math.max(1, position), prev.length) - 1
      if (to === from) return prev
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo()
  }

  const startEdit = (todo: Todo) => {
    setEditingId(todo.id)
    setEditText(todo.text)
  }

  const cancelEdit = () => {
    setEditingId(null)
    setEditText('')
  }

  const saveEdit = (id: string) => {
    const text = editText.trim()
    if (text) {
      setTodos(prev => prev.map(t => (t.id === id ? { ...t, text } : t)))
    }
    setEditingId(null)
    setEditText('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent, id: string) => {
    if (e.key === 'Enter') saveEdit(id)
    if (e.key === 'Escape') cancelEdit()
  }

  const isArcade = theme === 'neon' || theme === 'crt'
  const visibleTodos = filter === 'all' ? todos : todos.filter(t => t.category === filter)
  const remaining = visibleTodos.filter(t => !t.done).length

  return (
    <div className="container">
      <div className="topbar">
        <select
          className="select-control theme-select"
          value={theme}
          onChange={e => applyTheme(e.target.value as Theme)}
          aria-label="Choose theme"
        >
          {THEME_ORDER.map(t => (
            <option key={t} value={t}>
              {THEME_LABEL[t]}
            </option>
          ))}
        </select>
      </div>

      <h1>To-Do List</h1>

      <div className="panel">
        <div className="input-row">
          <input
            type="text"
            placeholder={isArcade ? 'INSERT COIN...' : 'Add a task...'}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
          />
          <select
            className="select-control new-category-select category-select"
            data-category={newCategory}
            value={newCategory}
            onChange={e => setNewCategory(e.target.value as Category)}
            aria-label="Category for new task"
          >
            {CATEGORY_ORDER.map(c => (
              <option key={c} value={c}>
                {CATEGORY_LABEL[c]}
              </option>
            ))}
          </select>
          <button className="btn-add" onClick={addTodo}>
            {isArcade ? '+ ADD' : 'Add'}
          </button>
        </div>

        <div className="filter-tabs">
          {FILTER_ORDER.map(f => (
            <button
              key={f}
              className={`filter-tab ${filter === f ? 'active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {FILTER_LABEL[f]}
            </button>
          ))}
        </div>

        {visibleTodos.length > 0 && (
          <div className="counter">
            <span>{remaining}</span> {isArcade ? 'MISSIONS LEFT' : 'tasks left'}
          </div>
        )}

        <div className="todo-list">
          {!mounted ? null : todos.length === 0 ? (
            <div className="empty-state">
              {isArcade ? (
                <>
                  <p>NO QUESTS YET</p>
                  <p className="blink" style={{ marginTop: '1rem' }}>
                    INSERT COIN TO BEGIN_
                  </p>
                </>
              ) : (
                <>
                  <p>No tasks yet</p>
                  <p style={{ marginTop: '1rem' }}>Add one to get started.</p>
                </>
              )}
            </div>
          ) : visibleTodos.length === 0 ? (
            <div className="empty-state small">
              <p>
                {isArcade ? 'NOTHING HERE' : `No ${FILTER_LABEL[filter].toLowerCase()} tasks`}
              </p>
            </div>
          ) : (
            visibleTodos.map(todo => {
              const index = todos.findIndex(t => t.id === todo.id)
              return (
                <div key={todo.id} className={`todo-item ${todo.done ? 'done' : ''}`}>
                  <div className="todo-main">
                    <button
                      className="todo-check"
                      onClick={() => toggleTodo(todo.id)}
                      aria-label="Toggle todo"
                    >
                      {todo.done ? '✓' : ''}
                    </button>
                    {editingId === todo.id ? (
                      <input
                        className="todo-edit-input"
                        value={editText}
                        onChange={e => setEditText(e.target.value)}
                        onKeyDown={e => handleEditKeyDown(e, todo.id)}
                        onBlur={() => saveEdit(todo.id)}
                        autoFocus
                      />
                    ) : (
                      <span className="todo-text" onDoubleClick={() => startEdit(todo)}>
                        {todo.text}
                      </span>
                    )}
                    <div className="todo-actions">
                      <button
                        className="btn-edit"
                        onClick={() => startEdit(todo)}
                        aria-label="Edit todo"
                      >
                        ✎
                      </button>
                      <button
                        className="btn-delete"
                        onClick={() => deleteTodo(todo.id)}
                        aria-label="Delete todo"
                      >
                        X
                      </button>
                    </div>
                  </div>
                  <div className="todo-meta">
                    <select
                      className="select-control priority-select"
                      value={index + 1}
                      onChange={e => setPriority(todo.id, Number(e.target.value))}
                      aria-label={`Priority for "${todo.text}"`}
                    >
                      {todos.map((_, i) => (
                        <option key={i} value={i + 1}>
                          {i + 1}
                        </option>
                      ))}
                    </select>
                    <select
                      className="select-control category-select"
                      data-category={todo.category}
                      value={todo.category}
                      onChange={e => setCategory(todo.id, e.target.value as Category)}
                      aria-label={`Category for "${todo.text}"`}
                    >
                      {CATEGORY_ORDER.map(c => (
                        <option key={c} value={c}>
                          {CATEGORY_LABEL[c]}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
