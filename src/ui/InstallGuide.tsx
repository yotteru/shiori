import { InputTestLink } from './InputTest';

// Safari のタブで開いたときは入力させず、ホーム画面への追加だけを案内する（§3.1）
export function InstallGuide() {
  return (
    <main className="screen">
      <div className="head">
        <h1 className="title">しおり</h1>
        <span className="sub">ホーム画面に追加してから使ってください</span>
      </div>
      <div className="card">
        <ol className="stack" style={{ margin: 0, paddingLeft: 20, lineHeight: 1.7 }}>
          <li>画面下の「共有」ボタンを押す</li>
          <li>「ホーム画面に追加」を選ぶ</li>
          <li>ホーム画面の「しおり」アイコンから開く</li>
        </ol>
        <p className="sub" style={{ margin: 0 }}>
          ブラウザのタブのままだと、入力したデータが端末から消えることがあるため、ここでは入力できません。
        </p>
      </div>
      <InputTestLink />
    </main>
  );
}

export function ConfigMissing() {
  return (
    <main className="screen">
      <h1 className="title">しおり</h1>
      <div className="card">
        <p style={{ margin: 0 }}>Supabase の接続先が設定されていません。README の手順で設定してください。</p>
      </div>
    </main>
  );
}
