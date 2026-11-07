import { useState } from 'react';
import { supabase } from '../lib/supabase';
import { InputTestLink } from './InputTest';

// ログイン（新規登録ボタンは置かない。§3.1）
//
// iPad（iPadOS 27.2）のホーム画面アプリでは、文字欄とパスワード欄が同じ画面に並ぶ
// （form の有無にかかわらず）と、入力欄をタップした瞬間に画面が落ちる。
// 入力欄のテストで「パスワード欄だけ」「文字欄だけ」なら入力できたので、
// 1画面目はメールアドレスだけ、2画面目はパスワードだけにする。
// テスト画面との違いとして「login」「ログイン」といった名前・文言もあったため、
// iPad がログイン画面と判断する手がかり（欄の name、ボタンの「ログイン」）も外す
export function Login() {
  const [step, setStep] = useState<'email' | 'password'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const next = () => {
    if (!email.trim()) return;
    setError('');
    setStep('password');
  };

  const submit = async () => {
    if (!supabase || busy || !email.trim() || !password) return;
    setBusy(true);
    setError('');
    const { error: err } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    setBusy(false);
    if (err) setError('ログインできませんでした。メールアドレスとパスワードを確かめてください。');
  };

  const onEnter = (fn: () => void) => (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) fn();
  };

  return (
    <main className="screen">
      <div className="head">
        <h1 className="title">しおり</h1>
        <span className="sub">本人確認（{step === 'email' ? '1' : '2'} / 2）</span>
      </div>

      {step === 'email' ? (
        <div key="email" className="card" onKeyDown={onEnter(next)}>
          <label className="field">
            <span>メールアドレス</span>
            <input
              className="input"
              type="text"
              inputMode="email"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </label>
          <button className="btn-primary" type="button" disabled={!email.trim()} onClick={next}>
            次へ
          </button>
        </div>
      ) : (
        <div key="password" className="card" onKeyDown={onEnter(() => void submit())}>
          <span className="sub">{email.trim()}</span>
          <label className="field">
            <span>パスワード</span>
            <input
              className="input"
              type="password"
              autoComplete="off"
              autoCapitalize="none"
              autoCorrect="off"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="btn-primary" type="button" disabled={busy || !password} onClick={() => void submit()}>
            {busy ? '確認中…' : 'はじめる'}
          </button>
          <button
            className="btn-ghost"
            type="button"
            onClick={() => {
              setPassword('');
              setError('');
              setStep('email');
            }}
          >
            メールアドレスを直す
          </button>
        </div>
      )}
      <InputTestLink />
    </main>
  );
}
