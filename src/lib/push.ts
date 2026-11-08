import { supabase } from './supabase';

// Web プッシュ（2026-11-08。要件メモ「始める瞬間の綱引きへの対策」）。
// 「始めた」ことをサーバーに伝え、5分後にサーバーから通知を送ってもらう。
// サーバーに渡すのは送り先と「何秒後か」と通知の種類だけ（中身は渡さない）

export type PushKind = 'five_min' | 'test';

export interface StartReminderPayload {
  send_at: string;
  body: string;
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export function pushPermission(): NotificationPermission | 'unsupported' {
  return pushSupported() ? Notification.permission : 'unsupported';
}

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = (s + '='.repeat((4 - (s.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b64);
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

function sameKey(a: ArrayBuffer | null | undefined, b: Uint8Array): boolean {
  if (!a) return false;
  const x = new Uint8Array(a);
  return x.length === b.length && x.every((v, i) => v === b[i]);
}

function functionUrl(): string {
  const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.replace(/\/+$/, '');
  return `${url}/functions/v1/push`;
}

export type EnableResult = { ok: true } | { ok: false; reason: string };

/** この端末で通知を受け取れるようにする。ボタンを押したときに呼ぶ（iPhone は操作の中でしか許可を聞けない） */
export async function enablePush(): Promise<EnableResult> {
  if (!supabase) return { ok: false, reason: 'Supabase の設定がありません' };
  if (!pushSupported()) return { ok: false, reason: 'この画面では通知を使えません（ホーム画面のしおりから開いてください）' };
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') return { ok: false, reason: '通知が許可されませんでした（設定アプリ > 通知 > しおり で許可できます）' };

  const { data, error } = await supabase.functions.invoke('push', { body: { action: 'public-key' } });
  const publicKey = (data as { publicKey?: string } | null)?.publicKey;
  if (error || !publicKey) return { ok: false, reason: 'サーバーの準備ができていません（README「9. 5分の知らせ」）' };
  const key = base64UrlToBytes(publicKey);

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  // 鍵が変わっていたら登録し直す
  if (sub && !sameKey(sub.options.applicationServerKey, key)) {
    await sub.unsubscribe();
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });

  const j = sub.toJSON();
  const { error: e2 } = await supabase.rpc('register_push_subscription', {
    p_endpoint: j.endpoint,
    p_p256dh: j.keys?.p256dh,
    p_auth: j.keys?.auth,
    p_function_url: functionUrl(),
  });
  if (e2) return { ok: false, reason: `登録できませんでした（${e2.message}）` };
  return { ok: true };
}

/** この端末が通知を受け取る登録をしているか */
export async function currentEndpoint(): Promise<string | null> {
  if (!pushSupported() || Notification.permission !== 'granted') return null;
  const reg = await navigator.serviceWorker.getRegistration();
  const sub = await reg?.pushManager.getSubscription();
  return sub?.endpoint ?? null;
}

/** 何秒後かに通知を送ってもらう。送れないとき（未登録・圏外）は null */
export async function schedulePush(kind: PushKind, delaySeconds: number): Promise<string | null> {
  if (!supabase) return null;
  const endpoint = await currentEndpoint();
  if (!endpoint) return null;
  const { data, error } = await supabase.rpc('schedule_push', { p_endpoint: endpoint, p_kind: kind, p_delay_seconds: delaySeconds });
  return error ? null : (data as string);
}

export async function cancelPush(id: string): Promise<void> {
  await supabase?.rpc('cancel_push', { p_id: id });
}

/** この端末の「開始時刻の通知」を丸ごと置き換える。送れたら true（未登録・圏外は false） */
export async function setStartReminders(items: StartReminderPayload[]): Promise<boolean> {
  if (!supabase) return false;
  const endpoint = await currentEndpoint();
  if (!endpoint) return false;
  const { error } = await supabase.rpc('set_start_reminders', { p_endpoint: endpoint, p_items: items });
  return !error;
}
