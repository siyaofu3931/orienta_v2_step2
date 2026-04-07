self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }
  const title = payload.title || "Orienta 提醒";
  const body = payload.body || "请返回旅客页面继续查看。";
  const url = payload.url || "/pax.html";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      tag: "orienta-away",
      renotify: true,
      data: { url },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/pax.html";
  event.waitUntil(self.clients.openWindow(url));
});
