import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';

// iPad（iPadOS 27.2）のホーム画面アプリで、入力欄をタップすると画面が暗転して戻る不具合の調査用。
// どの条件で起きるかを、文字入力なしで確かめられるようにする。
// 落ちて読み込み直しても続きから見られるよう、結果は localStorage に残す

const KEY = 'shiori-input-test';

type Result = 'ok' | 'crash';
interface TestState {
  open: boolean;
  pending?: string;
  results: Record<string, Result>;
}

function load(): TestState {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? '') as TestState;
    // 前回タップしたまま「入力できた」にならずに読み込み直した → 落ちたとみなす
    if (s.pending) s.results = { ...s.results, [s.pending]: 'crash' };
    return { ...s, pending: undefined };
  } catch {
    return { open: false, results: {} };
  }
}

function save(s: TestState) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // 保存できない環境では結果を残さない
  }
}

export function isInputTestOpen(): boolean {
  return load().open;
}

export function openInputTest() {
  save({ ...load(), open: true });
  location.reload();
}

const plain: CSSProperties = { all: 'revert', fontSize: 16 } as CSSProperties;

const CASES: { id: string; label: string; render: (on: Handlers) => ReactNode }[] = [
  { id: '1', label: '飾りなしの入力欄（文字）', render: (h) => <input type="text" style={plain} {...h} /> },
  { id: '2', label: '飾りなしの入力欄（パスワード）', render: (h) => <input type="password" style={plain} {...h} /> },
  { id: '3', label: '飾りなしの複数行の欄', render: (h) => <textarea style={plain} rows={2} {...h} /> },
  { id: '4', label: 'しおりの見た目の入力欄', render: (h) => <input type="text" className="input" {...h} /> },
  { id: '5', label: 'しおりの見た目＋端末の標準フォント', render: (h) => <input type="text" className="input" style={{ fontFamily: 'system-ui, sans-serif' }} {...h} /> },
  { id: '6', label: '入力欄を label で囲んだもの', render: (h) => <label className="field"><span>見出し</span><input type="text" className="input" {...h} /></label> },
  {
    id: '7',
    label: 'form の中の文字欄（パスワード欄あり・旧ログイン画面と同じ形）',
    render: (h) => (
      <form className="stack" onSubmit={(e) => e.preventDefault()}>
        <input type="text" className="input" {...h} />
        <input type="password" className="input" placeholder="（こちらはタップしなくてよい）" />
      </form>
    ),
  },
  {
    id: '9',
    label: 'form なしで文字欄とパスワード欄が並ぶ（前回のログイン画面と同じ形）',
    render: (h) => (
      <div className="stack">
        <label className="field">
          <span>メールアドレス</span>
          <input className="input" type="text" name="shiori-login-id" inputMode="email" autoComplete="off" {...h} />
        </label>
        <label className="field">
          <span>パスワード</span>
          <input className="input" type="password" name="shiori-login-pass" autoComplete="off" placeholder="（こちらはタップしなくてよい）" />
        </label>
        <button className="btn-primary" type="button">ログイン</button>
      </div>
    ),
  },
  {
    id: '8',
    label: 'form の中の文字欄（パスワード欄なし）',
    render: (h) => (
      <form className="stack" onSubmit={(e) => e.preventDefault()}>
        <input type="text" className="input" {...h} />
      </form>
    ),
  },
];

interface Handlers {
  onPointerDown: () => void;
  onChange: () => void;
}

export function InputTest() {
  const [state, setState] = useState<TestState>(() => load());
  useEffect(() => save(state), [state]);

  const handlers = (id: string): Handlers => ({
    onPointerDown: () => {
      const next = { ...state, pending: id };
      save(next); // 落ちる前に必ず残す
      setState(next);
    },
    onChange: () => setState((s) => ({ ...s, pending: undefined, results: { ...s.results, [id]: 'ok' } })),
  });

  const close = () => {
    save({ open: false, results: state.results });
    location.reload();
  };

  const mark = (r?: Result) => (r === 'ok' ? '入力できた' : r === 'crash' ? '暗転した' : '未確認');

  return (
    <main className="screen">
      <div className="head">
        <h1 className="title">入力欄のテスト</h1>
        <span className="sub">
          上から順に1つずつタップして、1文字入力してみてください。暗転した場合は、戻ってきたら次の欄に進んでください。結果は自動で記録されます。
        </span>
      </div>
      {CASES.map((c) => (
        <div key={c.id} className="card" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="label">
              {c.id}. {c.label}
            </span>
            <span className="small mono" style={{ color: state.results[c.id] === 'crash' ? 'var(--warn)' : state.results[c.id] === 'ok' ? 'var(--done)' : 'var(--muted)' }}>
              {mark(state.results[c.id])}
            </span>
          </div>
          {c.render(handlers(c.id))}
        </div>
      ))}
      <div className="card">
        <span className="label">結果（このまま送ってください）</span>
        <span className="mono small">{CASES.map((c) => `${c.id}:${mark(state.results[c.id])}`).join(' / ')}</span>
        <span className="small muted">{navigator.userAgent}</span>
      </div>
      <button className="btn" onClick={() => setState({ open: true, results: {} })}>
        結果を消してやり直す
      </button>
      <button className="btn-primary" onClick={close}>
        テストを終える
      </button>
    </main>
  );
}

export function InputTestLink() {
  return (
    <button className="btn-ghost" style={{ alignSelf: 'center' }} onClick={openInputTest}>
      入力欄のテスト（iPad の不具合調査用）
    </button>
  );
}
