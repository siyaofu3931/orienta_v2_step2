export type AdminSession = {
  token: string;
  exp: number; // ms epoch
  user: {
    email: string;
    displayName: string;
    org: string;
    role: "admin" | "ops" | "viewer";
  };
};

const KEY = "orienta_admin_session_v1";

export function getSession(): AdminSession | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as AdminSession;
    if (!s?.token || !s?.exp) return null;
    if (Date.now() > s.exp) {
      localStorage.removeItem(KEY);
      return null;
    }
    return s;
  } catch {
    return null;
  }
}

export function logout() {
  localStorage.removeItem(KEY);
}

function mkToken() {
  return "demo_" + Math.random().toString(16).slice(2) + "_" + Date.now().toString(16);
}

// Demo credential rules (client-side mock):
// - admin@airchina.com / orienta123
// - ops@airchina.com / orienta123
// - demo / demo
export function loginWithPassword(emailOrUser: string, password: string): AdminSession {
  const u = emailOrUser.trim().toLowerCase();
  const p = password;

  const ok1 = (u === "admin@airchina.com" || u === "admin") && p === "orienta123";
  const ok2 = (u === "ops@airchina.com" || u === "ops") && p === "orienta123";
  const ok3 = u === "demo" && p === "demo";

  if (!ok1 && !ok2 && !ok3) {
    throw new Error("账号或密码错误（demo：admin@airchina.com / orienta123）");
  }

  const role: AdminSession["user"]["role"] = ok2 ? "ops" : "admin";
  const displayName = ok2 ? "国航运行席位" : "国航管理员";
  const email = ok3 ? "demo@orienta.ai" : (u.includes("@") ? u : (role === "ops" ? "ops@airchina.com" : "admin@airchina.com"));

  const session: AdminSession = {
    token: mkToken(),
    exp: Date.now() + 1000 * 60 * 60 * 8, // 8h
    user: {
      email,
      displayName,
      org: ok3 ? "Orienta Demo" : "Air China",
      role,
    },
  };

  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}

// Simulated SSO login (one click)
export function loginWithSSO(): AdminSession {
  const session: AdminSession = {
    token: mkToken(),
    exp: Date.now() + 1000 * 60 * 60 * 8,
    user: {
      email: "admin@airchina.com",
      displayName: "国航管理员",
      org: "Air China",
      role: "admin",
    },
  };
  localStorage.setItem(KEY, JSON.stringify(session));
  return session;
}
