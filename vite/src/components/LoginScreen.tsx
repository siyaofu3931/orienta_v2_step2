import React, { useMemo, useState } from "react";

export default function LoginScreen(props: {
  onLogin(emailOrUser: string, password: string): void;
  onSSO(): void;
}) {
  const { onLogin, onSSO } = props;
  const [user, setUser] = useState("admin@airchina.com");
  const [pass, setPass] = useState("orienta123");
  const [err, setErr] = useState<string | null>(null);

  const hint = useMemo(
    () =>
      "Demo 账号：admin@airchina.com / orienta123（或 ops@airchina.com / orienta123）\n也可一键使用国航 SSO（模拟）登录。",
    []
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      onLogin(user, pass);
    } catch (ex: any) {
      setErr(ex?.message || "登录失败");
    }
  };

  return (
    <div className="loginRoot">
      <div className="loginBg" />
      <div className="loginOverlay" />

      <div className="loginShell">
        <div className="loginBrand">
          <div className="loginMark">
            <div className="loginLogo" />
            <div>
              <div className="loginTitle">Orienta</div>
              <div className="loginSub">航司后台 · 国航 Demo · 北京首都机场 T3</div>
            </div>
          </div>
          <div className="loginTag">Admin Console</div>
        </div>

        <div className="loginCard">
          <div className="loginCardHeader">
            <div style={{ fontWeight: 800, fontSize: 16 }}>管理员登录</div>
            <div className="small">用于航班登机态势与旅客服务调度</div>
          </div>

          <form onSubmit={submit} className="loginForm">
            <label className="loginLabel">
              <span>账号</span>
              <input
                className="input"
                value={user}
                onChange={(e) => setUser(e.target.value)}
                placeholder="admin@airchina.com"
                autoComplete="username"
              />
            </label>

            <label className="loginLabel">
              <span>密码</span>
              <input
                className="input"
                type="password"
                value={pass}
                onChange={(e) => setPass(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </label>

            {err ? <div className="loginError">{err}</div> : null}

            <div className="loginActions">
              <button className="btn primary" type="submit">登录</button>
              <button
                className="btn"
                type="button"
                onClick={() => {
                  setErr(null);
                  onSSO();
                }}
                title="模拟企业 SSO"
              >
                国航 SSO（模拟）
              </button>
            </div>

            <div className="loginHint">
              <pre>{hint}</pre>
            </div>
          </form>
        </div>

        <div className="loginFoot">
          <span className="badge">🔒 Demo 仅本地存储会话（localStorage）</span>
          <span className="badge">🗺 Apple MapKit JS / OSM 自动切换</span>
          <span className="badge">♿ Wheelchair / i18n Passenger Simulation</span>
        </div>
      </div>
    </div>
  );
}
