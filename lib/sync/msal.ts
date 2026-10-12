'use client'

import type { AccountInfo, PublicClientApplication } from '@azure/msal-browser'

// Loaded on demand so people who never turn on sync don't download it.
const loadMsal = () => import('@azure/msal-browser')

export const SCOPES = ['Tasks.ReadWrite', 'User.Read']
const CONFIG_KEY = 'arcade-ms-config'

export interface MsConfig {
  clientId: string
  tenantId: string
  fromEnv: boolean
}

/** App registration details: from the deployment's env vars, or entered in Settings on this device. */
export function getMsConfig(): MsConfig | null {
  const envClient = process.env.NEXT_PUBLIC_MS_CLIENT_ID
  if (envClient) return { clientId: envClient, tenantId: process.env.NEXT_PUBLIC_MS_TENANT_ID || 'common', fromEnv: true }
  if (typeof window === 'undefined') return null
  try {
    const saved = JSON.parse(localStorage.getItem(CONFIG_KEY) || 'null')
    if (saved?.clientId) return { clientId: saved.clientId, tenantId: saved.tenantId || 'common', fromEnv: false }
  } catch {}
  return null
}

export function saveMsConfig(clientId: string, tenantId: string): void {
  if (clientId.trim()) {
    localStorage.setItem(CONFIG_KEY, JSON.stringify({ clientId: clientId.trim(), tenantId: tenantId.trim() || 'common' }))
  } else {
    localStorage.removeItem(CONFIG_KEY)
  }
  instance = null
}

/** Register this as a Single-page application redirect URI in Microsoft Entra. */
export function redirectUri(): string {
  return `${window.location.origin}/redirect`
}

let instance: Promise<PublicClientApplication> | null = null
let instanceKey = ''

/** Lazily creates the MSAL client and completes any sign-in redirect that brought us back here. */
export function getMsal(): Promise<PublicClientApplication> | null {
  const cfg = getMsConfig()
  if (!cfg || typeof window === 'undefined') return null
  const key = `${cfg.clientId}|${cfg.tenantId}`
  if (!instance || key !== instanceKey) {
    instanceKey = key
    instance = (async () => {
      const { PublicClientApplication } = await loadMsal()
      const pca = new PublicClientApplication({
        auth: {
          clientId: cfg.clientId,
          authority: `https://login.microsoftonline.com/${cfg.tenantId}`,
          redirectUri: redirectUri(),
          postLogoutRedirectUri: `${window.location.origin}/`,
        },
        cache: { cacheLocation: 'localStorage' },
      })
      await pca.initialize()
      const result = await pca.handleRedirectPromise()
      if (result?.account) pca.setActiveAccount(result.account)
      else if (!pca.getActiveAccount() && pca.getAllAccounts()[0]) pca.setActiveAccount(pca.getAllAccounts()[0])
      return pca
    })()
  }
  return instance
}

export async function getAccount(): Promise<AccountInfo | null> {
  const pca = await getMsal()
  return pca?.getActiveAccount() ?? null
}

export async function signIn(): Promise<void> {
  const pca = await getMsal()
  await pca?.loginRedirect({ scopes: SCOPES, prompt: 'select_account' })
}

export async function signOut(): Promise<void> {
  const pca = await getMsal()
  if (!pca) return
  await pca.logoutRedirect({ account: pca.getActiveAccount() ?? undefined })
}

export class ReauthRequired extends Error {}

export async function getToken(): Promise<string> {
  const pca = await getMsal()
  const account = pca?.getActiveAccount()
  if (!pca || !account) throw new ReauthRequired('Not signed in')
  try {
    const res = await pca.acquireTokenSilent({ scopes: SCOPES, account })
    return res.accessToken
  } catch (e) {
    const { InteractionRequiredAuthError } = await loadMsal()
    if (e instanceof InteractionRequiredAuthError) throw new ReauthRequired('Sign in again to keep syncing')
    throw e
  }
}
