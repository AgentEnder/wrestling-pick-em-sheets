self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener('push', (event) => {
  let payload = {}
  try {
    payload = event.data ? event.data.json() : {}
  } catch {
    payload = { message: event.data ? event.data.text() : '' }
  }

  event.waitUntil(handlePush(payload))
})

async function handlePush(payload) {
  const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })

  for (const client of clients) {
    client.postMessage({
      type: 'GAME_UPDATE',
      data: payload,
    })
  }

  const title = typeof payload.title === 'string' && payload.title.trim()
    ? payload.title
    : 'Live Game Update'
  const body = typeof payload.message === 'string' && payload.message.trim()
    ? payload.message
    : (typeof payload.body === 'string' ? payload.body : 'A new result is available.')

  await self.registration.showNotification(title, {
    body,
    vibrate: [150, 80, 150],
    tag: typeof payload.tag === 'string' ? payload.tag : 'live-game-update',
    renotify: true,
    data: {
      url: typeof payload.url === 'string' ? payload.url : '/games',
      payload,
    },
  })
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close()

  const notificationData = event.notification.data || {}
  const targetUrl = typeof notificationData.url === 'string' ? notificationData.url : '/games'

  event.waitUntil((async () => {
    const clients = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const client of clients) {
      if (client.url.includes('/games')) {
        await client.focus()
        return
      }
    }
    await self.clients.openWindow(targetUrl)
  })())
})
