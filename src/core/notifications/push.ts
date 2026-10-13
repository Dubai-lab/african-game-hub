import i18n from '@/core/i18n'
import { env } from '@/core/lib/env'
import { supabase } from '@/core/lib/supabase'

// Notifications to this phone while the app is closed. The browser does the work: the player
// says yes, the browser hands the app an address at its push service, and the app gives that
// address to the server. Only a browser that can do this is offered it (a phone's browser, or
// the site added to the Home screen; not the app-store shell, which has no such thing).

const KEY = env?.VITE_VAPID_PUBLIC_KEY

export type PushState = 'unsupported' | 'blocked' | 'off' | 'on'

/** Whether this browser can be sent notifications at all, and the hub is set up to send them. */
export const pushSupported = () => Boolean(KEY) && typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window

async function registration(): Promise<ServiceWorkerRegistration | null> {
  if (!pushSupported()) return null
  // The app's own service worker, once it is running. (In development there is none.)
  const known = await navigator.serviceWorker.getRegistration()
  if (!known) return null
  return navigator.serviceWorker.ready
}

/** Where things stand on this browser. */
export async function pushState(): Promise<PushState> {
  try {
    const worker = await registration()
    if (!worker) return 'unsupported'
    if (Notification.permission === 'denied') return 'blocked'
    return (await worker.pushManager.getSubscription()) ? 'on' : 'off'
  } catch {
    return 'unsupported'
  }
}

const encoded = (buffer: ArrayBuffer | null) => (buffer ? btoa(String.fromCharCode(...new Uint8Array(buffer))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '') : '')
const keyBytes = (key: string) => {
  const padded = key.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(key.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0))
}

/** Asks the player (the browser's own question), and tells the server where this browser can be reached. */
export async function enablePush(): Promise<PushState> {
  const worker = await registration()
  if (!worker || !KEY) return 'unsupported'
  const answer = await Notification.requestPermission()
  if (answer !== 'granted') return answer === 'denied' ? 'blocked' : 'off'
  const subscription = (await worker.pushManager.getSubscription()) ?? (await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(KEY) }))
  const { data, error } = await supabase.rpc('save_push_subscription', {
    p_endpoint: subscription.endpoint,
    p_p256dh: encoded(subscription.getKey('p256dh')),
    p_auth: encoded(subscription.getKey('auth')),
    p_language: i18n.resolvedLanguage ?? 'en',
  })
  if (error || !(data as { ok?: boolean } | null)?.ok) {
    // The server does not know of it: better none than one that does nothing.
    await subscription.unsubscribe().catch(() => undefined)
    throw error ?? new Error('The server refused the subscription')
  }
  return 'on'
}

/** Stops notifications to this browser, here and on the server. */
export async function disablePush(): Promise<PushState> {
  const worker = await registration()
  const subscription = await worker?.pushManager.getSubscription()
  if (subscription) {
    await supabase.rpc('remove_push_subscription', { p_endpoint: subscription.endpoint })
    await subscription.unsubscribe().catch(() => undefined)
  }
  return 'off'
}
