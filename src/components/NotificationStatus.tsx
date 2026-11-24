import { Bell, BellOff, BellRing, LoaderCircle } from "lucide-react";
import {
  canRequestNotification,
  canSendTestNotification,
  notificationFailureReason,
  notificationStatusDetail,
  notificationStatusLabel,
  type NotificationState,
} from "../lib/notifications";

interface Props {
  permission: NotificationState;
  testing?: boolean;
  hint?: string;
  onRequest: () => void;
  onTest: () => void;
}

export function NotificationStatus({ permission, testing = false, hint, onRequest, onTest }: Props) {
  const Icon = permission === "granted" ? BellRing : permission === "denied" || permission === "unsupported" ? BellOff : Bell;
  const label = notificationStatusLabel(permission);
  return (
    <div className={`notification-status tone-${permission}`} role="group" aria-label="系统通知状态">
      <span className="notification-status-label"><Icon size={13} aria-hidden="true" />系统通知：{label}</span>
      <small>{hint ?? notificationStatusDetail(permission)}</small>
      <div className="notification-status-actions">
        {canRequestNotification(permission) && (
          <button type="button" className="text-button reminder-permission" onClick={onRequest}>
            <Bell size={12} />允许系统通知
          </button>
        )}
        <button
          type="button"
          className="secondary-button compact-button"
          onClick={onTest}
          disabled={!canSendTestNotification(permission) || testing}
          title={canSendTestNotification(permission) ? "发送一条测试通知" : notificationFailureReason(permission)}
        >
          {testing ? <LoaderCircle size={12} className="spin" /> : <BellRing size={12} />}
          {testing ? "正在发送" : "发送测试通知"}
        </button>
      </div>
    </div>
  );
}