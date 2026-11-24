self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {};
  const action = event.action === "snooze" ? "snooze" : "now";
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const page = windows.find((client) => new URL(client.url).origin === self.location.origin);
    if (data.test) {
      if (page) {
        await page.focus();
        return;
      }
      await self.clients.openWindow("/");
      return;
    }
    if (!data.taskId) return;
    for (const client of windows) {
      client.postMessage({
        type: "notice-desk-reminder-action",
        action,
        taskId: data.taskId,
        role: data.role,
      });
    }
    if (page) {
      await page.focus();
      return;
    }
    const params = new URLSearchParams({
      reminder: String(data.taskId || ""),
      role: data.role === "counselor" ? "counselor" : "student",
      action,
    });
    await self.clients.openWindow(`/?${params.toString()}`);
  })());
});