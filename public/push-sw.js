// Notifications sent to this phone while the app is closed. Loaded by the app's service worker
// (see vite.config.ts). The server sends a few words and where a tap should lead; this shows
// them, and opens the app at that place when the notification is tapped.

self.addEventListener('push', (event) => {
  let message = {}
  try {
    message = event.data ? event.data.json() : {}
  } catch {
    message = {}
  }
  const title = typeof message.title === 'string' && message.title ? message.title : 'African Game Hub'
  event.waitUntil(
    self.registration.showNotification(title, {
      body: typeof message.body === 'string' ? message.body : '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      // A newer notification of the same sort takes the place of the older one.
      tag: typeof message.tag === 'string' ? message.tag : undefined,
      data: { url: typeof message.url === 'string' && message.url.startsWith('/') ? message.url : '/lobby' },
    }),
  )
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  const path = (event.notification.data && event.notification.data.url) || '/lobby'
  const url = new URL(path, self.location.origin).href
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      // The app is open somewhere: bring it forward and take it to the place.
      for (const client of windows) {
        if ('focus' in client) {
          if ('navigate' in client) client.navigate(url).catch(() => undefined)
          return client.focus()
        }
      }
      return self.clients.openWindow(url)
    }),
  )
})
