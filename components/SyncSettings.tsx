'use client'

import { useEffect, useState } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import { Mode, MODE_LABEL, MODE_ORDER } from '@/types'
import { getAccount, getMsConfig, getToken, MsConfig, redirectUri as getRedirectUri, saveMsConfig, signIn, signOut } from '@/lib/sync/msal'
import { createList, GraphList, listLists } from '@/lib/sync/graph'
import {
  findReopenedCandidates,
  forgetSyncedData,
  hasPendingChanges,
  loadLinks,
  markRemoteCompleted,
  ReopenedCandidate,
  requestSync,
  setLink,
  STATUS_EVENT,
} from '@/lib/sync/engine'
import { formatAgo, useSyncStatus } from '@/lib/sync/useSync'
import { formatRelativeDate } from '@/lib/date'
import Icon from '@/components/Icon'
import { Switch } from '@/components/ui'
import { useSettings } from '@/lib/settings'

const NEW_LIST = '__new__'

export default function SyncSettings({ onDataChanged }: { onDataChanged: () => void }) {
  const [cfg, setCfg] = useState<MsConfig | null>(null)
  const [clientId, setClientId] = useState('')
  const [tenantId, setTenantId] = useState('')
  const [account, setAccount] = useState<AccountInfo | null | undefined>(undefined)
  const [lists, setLists] = useState<GraphList[] | null>(null)
  const [links, setLinks] = useState(loadLinks)
  const [busy, setBusy] = useState<Mode | 'signin' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const status = useSyncStatus()
  const [settings, updateSettings] = useSettings()
  const redirectUri = typeof window === 'undefined' ? '' : getRedirectUri()

  useEffect(() => {
    const c = getMsConfig()
    setCfg(c)
    if (c && !c.fromEnv) {
      setClientId(c.clientId)
      setTenantId(c.tenantId === 'common' ? '' : c.tenantId)
    }
  }, [])

  useEffect(() => {
    if (!cfg) {
      setAccount(null)
      return
    }
    getAccount()
      .then(setAccount)
      .catch(e => {
        setAccount(null)
        setError(e instanceof Error ? e.message : String(e))
      })
  }, [cfg])

  useEffect(() => {
    if (!account) return
    getToken()
      .then(listLists)
      .then(setLists)
      .catch(e => setError(e instanceof Error ? e.message : String(e)))
  }, [account])

  useEffect(() => {
    const update = () => setLinks(loadLinks())
    window.addEventListener(STATUS_EVENT, update)
    return () => window.removeEventListener(STATUS_EVENT, update)
  }, [])

  const saveConfig = () => {
    saveMsConfig(clientId, tenantId)
    setError(null)
    setCfg(getMsConfig())
  }

  const handleSignOut = async () => {
    setError(null)
    setBusy('signin')
    await requestSync()
    if (hasPendingChanges() && !confirmDiscard) {
      setConfirmDiscard(true)
      setError('Some changes haven’t uploaded to To Do yet. Sign out again to discard them, or fix the sync error first.')
      setBusy(null)
      return
    }
    forgetSyncedData()
    onDataChanged()
    await signOut()
  }

  const changeLink = async (mode: Mode, value: string) => {
    setError(null)
    setBusy(mode)
    try {
      if (!value) {
        setLink(mode, null)
      } else {
        let list = lists?.find(l => l.id === value)
        if (value === NEW_LIST) {
          list = await createList(await getToken(), `Todo · ${MODE_LABEL[mode]}`)
          setLists(prev => [...(prev ?? []), list!])
        }
        if (list) setLink(mode, { listId: list.id, listName: list.displayName })
      }
      setLinks(loadLinks())
      onDataChanged()
      await requestSync()
      onDataChanged()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  return (
    <section className="settings-section">
      <header className="settings-section-head">
        <h3>Sync</h3>
        <p>
          Send a workspace’s tasks to a Microsoft To Do list. To Do gets each task’s name and whether it’s done; due
          dates, repeats, order and projects stay here.
        </p>
      </header>

      {!cfg?.fromEnv && (
        <div className="settings-group sync-setup">
          <div className="settings-row-label">Microsoft app registration</div>
          <div className="settings-row-hint">
            From your app’s Overview page in Microsoft Entra. Under Authentication, add a <b>Single-page application</b>{' '}
            redirect URI of:
          </div>
          <div className="copy-field">
            <code>{redirectUri}</code>
            <button
              className="text-btn"
              onClick={() => {
                navigator.clipboard?.writeText(redirectUri)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <div className="sync-fields">
            <label>
              <span>Application (client) ID</span>
              <input className="field" value={clientId} onChange={e => setClientId(e.target.value)} placeholder="00000000-0000-…" spellCheck={false} />
            </label>
            <label>
              <span>Directory (tenant) ID</span>
              <input className="field" value={tenantId} onChange={e => setTenantId(e.target.value)} placeholder="Leave blank for any account" spellCheck={false} />
            </label>
          </div>
          <div className="row-end">
            <button className="btn btn-secondary btn-sm" onClick={saveConfig} disabled={clientId.trim() === (cfg?.clientId ?? '') && (tenantId.trim() || 'common') === (cfg?.tenantId ?? 'common')}>
              Save
            </button>
          </div>
        </div>
      )}

      {cfg && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Microsoft account</div>
            <div className="settings-row-hint">
              {account === undefined ? 'Checking…' : account ? `${account.name ?? ''} · ${account.username}` : 'Not connected'}
            </div>
            {account && (
              <div className="settings-row-hint">Signing out removes synced tasks from this device. They stay in To Do.</div>
            )}
          </div>
          <div className="settings-row-control">
            {account ? (
              <button className="btn btn-ghost btn-sm" disabled={busy !== null} onClick={handleSignOut}>
                {busy === 'signin' ? 'Signing out…' : confirmDiscard ? 'Sign out anyway' : 'Sign out'}
              </button>
            ) : (
              <button
                className="btn btn-primary btn-sm"
                disabled={account === undefined || busy === 'signin'}
                onClick={async () => {
                  setBusy('signin')
                  try {
                    await signIn()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e))
                    setBusy(null)
                  }
                }}
              >
                <Icon name="external" size={14} /> Sign in with Microsoft
              </button>
            )}
          </div>
        </div>
      )}

      {account &&
        MODE_ORDER.map(mode => {
          const link = links[mode]
          const otherListId = links[MODE_ORDER.find(m => m !== mode)!]?.listId
          return (
            <div className="settings-row" key={mode}>
              <div>
                <div className="settings-row-label">{MODE_LABEL[mode]} workspace</div>
                <div className="settings-row-hint">
                  {busy === mode
                    ? 'Syncing…'
                    : link
                    ? `Synced with “${link.listName}” · ${formatAgo(link.lastSync)}`
                    : 'Not sent to To Do'}
                </div>
              </div>
              <div className="settings-row-control">
                <select
                  className="field"
                  value={link?.listId ?? ''}
                  disabled={!lists || busy !== null}
                  onChange={e => changeLink(mode, e.target.value)}
                  aria-label={`To Do list for ${MODE_LABEL[mode]}`}
                >
                  <option value="">{lists ? 'Not synced' : 'Loading lists…'}</option>
                  {lists?.map(l => (
                    <option key={l.id} value={l.id} disabled={l.id === otherListId}>
                      {l.displayName}
                      {l.id === otherListId ? ' (used by other workspace)' : ''}
                    </option>
                  ))}
                  {lists && <option value={NEW_LIST}>+ New list “Todo · {MODE_LABEL[mode]}”</option>}
                </select>
              </div>
            </div>
          )
        })}

      {account && (links.personal || links.work) && (
        <>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Sync now</div>
              <div className="settings-row-hint">
                Sends new tasks, renames, completions and deletions to To Do, and brings back the same from there. Also the
                Sync button in the top bar, or press S.
              </div>
            </div>
            <div className="settings-row-control">
              <button className="btn btn-primary btn-sm" disabled={status.phase === 'syncing'} onClick={() => requestSync().then(onDataChanged)}>
                <Icon name="refresh" size={14} /> {status.phase === 'syncing' ? 'Syncing…' : 'Sync'}
              </button>
            </div>
          </div>
          <div className="settings-row">
            <div>
              <div className="settings-row-label">Sync automatically</div>
              <div className="settings-row-hint">Also sync in the background: after edits, when you return to the tab, and every minute.</div>
            </div>
            <div className="settings-row-control">
              <Switch label="Sync automatically" checked={settings.autoSync} onChange={autoSync => updateSettings({ autoSync })} />
            </div>
          </div>
        </>
      )}

      {account && (links.personal || links.work) && <ReopenedRepair onDone={onDataChanged} />}

      {(error || status.error) && (
        <div className="sync-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{error || status.error}</span>
        </div>
      )}
    </section>
  )
}

/** Review list for tasks the old daily reset (21–22 Oct 2026) re-opened in To Do. Nothing changes until confirmed. */
function ReopenedRepair({ onDone }: { onDone: () => void }) {
  const [items, setItems] = useState<ReopenedCandidate[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const check = async () => {
    setBusy(true)
    setMessage(null)
    try {
      const found = await findReopenedCandidates()
      setItems(found)
      setSelected(new Set(found.filter(f => f.likely).map(f => f.remoteId)))
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const apply = async () => {
    if (!items) return
    setBusy(true)
    try {
      const n = await markRemoteCompleted(items.filter(i => selected.has(i.remoteId)))
      setItems(items.filter(i => !selected.has(i.remoteId)))
      setSelected(new Set())
      setMessage(`Marked ${n} task${n === 1 ? '' : 's'} as completed again.`)
      onDone()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const toggle = (id: string) =>
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <div className="repair">
      <div className="settings-row">
        <div>
          <div className="settings-row-label">Fix tasks re-opened by sync</div>
          <div className="settings-row-hint">
            A bug on 21–22 Oct could un-tick old completed daily/weekly tasks in To Do. Check, review, then choose which
            to mark completed again.
          </div>
        </div>
        <div className="settings-row-control">
          <button className="btn btn-secondary btn-sm" onClick={check} disabled={busy}>
            {busy && !items ? 'Checking…' : items ? 'Check again' : 'Check'}
          </button>
        </div>
      </div>

      {items && items.length === 0 && <p className="repair-empty">Nothing found — no tasks look re-opened.</p>}

      {items && items.length > 0 && (
        <>
          <div className="repair-head">
            <span>
              {items.length} open task{items.length === 1 ? '' : 's'} could have been re-opened · {selected.size} selected
            </span>
            <button className="text-btn" onClick={() => setSelected(new Set(items.map(i => i.remoteId)))}>
              Select all
            </button>
            <button className="text-btn" onClick={() => setSelected(new Set())}>
              Select none
            </button>
          </div>
          <ul className="repair-list">
            {items.map(i => (
              <li key={i.remoteId}>
                <label>
                  <input type="checkbox" checked={selected.has(i.remoteId)} onChange={() => toggle(i.remoteId)} />
                  <span className="repair-text">{i.text}</span>
                  <span className="repair-meta">
                    {i.due ? `Due ${formatRelativeDate(i.due)}` : i.created ? `Created ${formatRelativeDate(i.created)}` : ''} ·{' '}
                    {i.reason}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row-end">
            <button className="btn btn-primary btn-sm" onClick={apply} disabled={busy || selected.size === 0}>
              {busy ? 'Updating…' : `Mark ${selected.size} as completed`}
            </button>
          </div>
        </>
      )}

      {message && <p className="repair-empty">{message}</p>}
    </div>
  )
}
