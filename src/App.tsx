import type { Session } from '@supabase/supabase-js';
import { useEffect, useState } from 'react';
import { useLive, useNow } from './hooks';
import { isDebugNowActive } from './lib/clock';
import { getMeta, loadClockOverride } from './lib/db';
import { isStandalone } from './lib/standalone';
import { supabase } from './lib/supabase';
import { Home } from './ui/Home';
import { ConfigMissing, InstallGuide } from './ui/InstallGuide';
import { Login } from './ui/Login';
import { NightFlow } from './ui/NightFlow';
import { Onboarding } from './ui/Onboarding';

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

  if (!DEV && !isStandalone()) return <InstallGuide />;
  if (!booted || session === undefined) return null;
  if (!supabase && !DEV) return <ConfigMissing />;
  if (supabase && !session) return <Login />;
  return <Signed />;
}

function Signed() {
  const meta = useLive(() => getMeta(), []);
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

function Main() {
  const [view, setView] = useState<'home' | 'night'>('home');
  return (
    <main className="screen">
      {view === 'home' && <Home onStartNight={() => setView('night')} />}
      {view === 'night' && <NightFlow onClose={() => setView('home')} />}
    </main>
  );
}
