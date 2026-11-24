export type NotificationState = "default" | "granted" | "denied" | "unsupported";

export function toNotificationState(value: NotificationPermission | undefined | null): NotificationState {
  if (!value) return "unsupported";
  return value;
}

export function notificationStatusLabel(state: NotificationState) {
  if (state === "granted") return "已允许";
  if (state === "denied") return "已拒绝";
  if (state === "default") return "未授权";
  return "当前浏览器不支持";
}

export function notificationStatusDetail(state: NotificationState) {
  if (state === "granted") return "标签页保持打开时，切到其他窗口也会提醒；关闭网页后无法再提醒。";
  if (state === "denied") return "浏览器已拒绝通知权限，不会再弹出授权框；可在地址栏的站点设置中改为允许。";
  if (state === "default") return "尚未授权。页面内收件箱可用；授权后切到其他窗口也能收到系统提醒。";
  return "页面内收件箱仍可用，但无法发出系统通知。";
}

export function canRequestNotification(state: NotificationState) {
  return state === "default";
}

export function canSendTestNotification(state: NotificationState) {
  return state === "granted";
}

export function notificationFailureReason(state: NotificationState) {
  if (state === "unsupported") return "当前浏览器不支持系统通知（Notifications API 不可用）";
  if (state === "denied") return "系统通知已被拒绝，浏览器不会再显示授权框";
  if (state === "default") return "系统通知尚未授权";
  return "";
}