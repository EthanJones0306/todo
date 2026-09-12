'use client'

import { useState, useEffect } from 'react'

interface Todo {
  id: string
  text: string
  done: boolean
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
    return JSON.parse(localStorage.getItem('arcade-todos') || '[]')
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
    setTodos(prev => [...prev, { id: crypto.randomUUID(), text, done: false }])
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

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') addTodo()
  }

  const remaining = todos.filter(t => !t.done).length
  const isArcade = theme === 'neon' || theme === 'crt'

  return (
    <div className="container">
      <div className="topbar">
        <select
          className="theme-select"
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

      <div className="input-row">
        <input
          type="text"
          placeholder={isArcade ? 'INSERT COIN...' : 'Add a task...'}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          autoFocus
        />
        <button className="btn-add" onClick={addTodo}>
          {isArcade ? '+ ADD' : 'Add'}
        </button>
      </div>

      {todos.length > 0 && (
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
        ) : (
          todos.map(todo => (
            <div
              key={todo.id}
              className={`todo-item ${todo.done ? 'done' : ''}`}
            >
              <button
                className="todo-check"
                onClick={() => toggleTodo(todo.id)}
                aria-label="Toggle todo"
              >
                {todo.done ? '✓' : ''}
              </button>
              <span className="todo-text">{todo.text}</span>
              <button
                className="btn-delete"
                onClick={() => deleteTodo(todo.id)}
                aria-label="Delete todo"
              >
                X
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
