import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { InputTestLink } from './InputTest';

// ログイン（新規登録ボタンは置かない。§3.1）
export function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    if (!supabase || busy || !email.trim() || !password) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError('ログインできませんでした。メールアドレスとパスワードを確かめてください。');
  };

  return (
    <main className="screen">
      <div className="head">
        <h1 className="title">しおり</h1>
        <span className="sub">ログイン</span>
      </div>
      {/* iPad（iPadOS 27.2）のホーム画面アプリで、パスワード欄を <form> に入れると入力欄をタップした瞬間に落ちる疑いがあるため、form を使わない */}
      <div className="card" onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && void submit()}>
        <label className="field">
          <span>メールアドレス</span>
          {/* iPad のホーム画面アプリで、自動入力の印があると画面が暗くなり入力できない事例があったため、ただの文字入力欄にする */}
          <input
            className="input"
            type="text"
            name="shiori-login-id"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>パスワード</span>
          <input
            className="input"
            type="password"
            name="shiori-login-pass"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn-primary" type="button" disabled={busy} onClick={() => void submit()}>
          {busy ? 'ログイン中…' : 'ログイン'}
        </button>
      </div>
      <InputTestLink />
    </main>
  );
}
