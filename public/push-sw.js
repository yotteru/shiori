// しおり：Web プッシュを受け取って通知を出す（sw.js から importScripts で読み込む）。2026-11-08 追加
// 文面はサーバー（Edge Function「push」）が種類ごとに固定で送る
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'しおり', {
      body: data.body || '',
      tag: data.tag || 'shiori',
      icon: 'icon-192.png',
    }),
  );
});

// 通知をタップしたら、開いているしおりに戻る（なければ開く）
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) if ('focus' in c) return c.focus();
      return self.clients.openWindow('./');
    }),
  );
});
