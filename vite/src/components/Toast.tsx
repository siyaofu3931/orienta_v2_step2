import React from "react";

export type ToastItem = { id: string; title: string; body: string };

export default function ToastHost(props: { items: ToastItem[]; onDismiss(id: string): void }) {
  return (
    <div className="toastHost">
      {props.items.map((t) => (
        <div key={t.id} className="toast" onClick={() => props.onDismiss(t.id)}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.title}</div>
          <div className="small">{t.body}</div>
          <div className="small" style={{ marginTop: 6 }}>点击关闭</div>
        </div>
      ))}
    </div>
  );
}
