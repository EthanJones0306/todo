'use client'

import { useEffect, useState } from 'react'
import type { AccountInfo } from '@azure/msal-browser'
import { Mode, MODE_LABEL, MODE_ORDER } from '@/types'
import { getAccount, getMsConfig, getToken, MsConfig, redirectUri as getRedirectUri, saveMsConfig, signIn, signOut } from '@/lib/sync/msal'
import { createList, GraphList, listLists } from '@/lib/sync/graph'
import { forgetSyncedData, hasPendingChanges, loadLinks, requestSync, setLink, STATUS_EVENT } from '@/lib/sync/engine'
import { formatAgo, useSyncStatus } from '@/lib/sync/useSync'
import Icon from '@/components/Icon'

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
          list = await createList(await getToken(), `${MODE_LABEL[mode]} · Arcade`)
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
        <p>Keep a workspace in step with a Microsoft To Do list, so your tasks are saved online and follow you to any device.</p>
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
                    : 'Only saved in this browser'}
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
                  {lists && <option value={NEW_LIST}>+ New list “{MODE_LABEL[mode]} · Arcade”</option>}
                </select>
              </div>
            </div>
          )
        })}

      {account && (links.personal || links.work) && (
        <div className="settings-row">
          <div>
            <div className="settings-row-label">Sync now</div>
            <div className="settings-row-hint">Changes upload instantly and download every minute while the app is open.</div>
          </div>
          <div className="settings-row-control">
            <button className="btn btn-secondary btn-sm" disabled={status.phase === 'syncing'} onClick={() => requestSync().then(onDataChanged)}>
              <Icon name="refresh" size={14} /> {status.phase === 'syncing' ? 'Syncing…' : 'Sync'}
            </button>
          </div>
        </div>
      )}

      {(error || status.error) && (
        <div className="sync-error" role="alert">
          <Icon name="alert" size={14} />
          <span>{error || status.error}</span>
        </div>
      )}
    </section>
  )
}
