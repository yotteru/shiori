import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { useLive, useNow } from './hooks';
import { isDebugNowActive } from './lib/clock';
import { getMeta, loadClockOverride } from './lib/db';
import { isStandalone } from './lib/standalone';
import { supabase } from './lib/supabase';
import { BackupSettings, ExportSettings } from './ui/Backup';
import { InputTest, isInputTestOpen } from './ui/InputTest';
import { ConfigMissing, InstallGuide } from './ui/InstallGuide';
import { Login } from './ui/Login';
import { NotifySettings } from './ui/NotifySettings';
import { Shiori } from './ui/Shiori';
import { Onboarding } from './ui/Onboarding';
import { Settings } from './ui/Settings';
import { SyncSettings } from './ui/SyncSettings';
import { scheduleSync } from './lib/syncRuntime';
import { Tracks } from './ui/Tracks';

// 開発サーバー（npm run dev）のときだけ、ホーム画面判定とログインを省略できる
const DEV = import.meta.env.DEV;

export function App() {
  const [booted, setBooted] = useState(false);
  const [session, setSession] = useState<Session | null | undefined>(supabase ? undefined : null);

  useEffect(() => {
    loadClockOverride().finally(() => setBooted(true));
  }, []);

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => data.subscription.unsubscribe();
  }, []);

  // 入力欄の不具合調査（ホーム画面・Safari のタブのどちらでも開ける）
  if (isInputTestOpen()) return <InputTest />;
  if (!DEV && !isStandalone()) return <InstallGuide />;
  if (!booted || session === undefined) return null;
  if (!supabase && !DEV) return <ConfigMissing />;
  if (supabase && !session) return <Login />;
  return <Signed />;
}

function Signed() {
  const meta = useLive(() => getMeta(), []);
  // ログインできたら（=アプリを開いたら）まず取り込む
  useEffect(() => scheduleSync(0), []);
  if (!meta) return null;
  return (
    <>
      <DebugBanner />
      {meta.onboarded ? <Main /> : <Onboarding />}
    </>
  );
}

function DebugBanner() {
  useNow(); // 上書きの設定・解除で再描画する
  if (!isDebugNowActive()) return null;
  return <div className="debug-banner">テスト中：日時を上書きしています</div>;
}

type View = 'home' | 'tracks' | 'settings';

function Main() {
  const [view, setView] = useState<View>('home');
  const go = (v: View) => {
    setView(v);
    window.scrollTo(0, 0);
  };
  return (
    <>
      <main className="screen">
        {view === 'home' && <Shiori />}
        {view === 'tracks' && <Tracks />}
        {view === 'settings' && (
          <Settings
            sections={
              <>
                <SyncSettings />
                <BackupSettings />
                <ExportSettings />
                <NotifySettings />
              </>
            }
          />
        )}
      </main>
      {(
        <nav className="tabbar" aria-label="画面の切り替え">
          <div>
            {(
              [
                ['home', 'しおり'],
                ['tracks', '取り組み'],
                ['settings', '設定'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </>
  );
}
