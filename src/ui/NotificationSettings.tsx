import { NotifySettings } from './NotifySettings';
import { PushSettings } from './PushSettings';
import { StartReminderSettingsCard } from './StartReminderSettings';
import { supabase } from '../lib/supabase';

// 設定「通知」（2026-11-09）：この端末で受け取る・予定の開始時刻・日曜の知らせ・23時の LINE を1枚にまとめる
export function NotificationSettings() {
  if (!supabase) return null;
  return (
    <div className="card">
      <PushSettings />
      <hr className="divider" />
      <StartReminderSettingsCard />
      <hr className="divider" />
      <NotifySettings />
    </div>
  );
}
