"use client";

// Обёртка: подключает экран сейвов к живому состоянию ГИД (WS + Postgres).
// Без входа сервер отклоняет сохранение состояния, поэтому сначала — форма входа.
import { useGidState } from "@/lib/useGidState";
import { useOnlineUsers } from "@/lib/useOnlineUsers";
import { GidSaves } from "@/app/components/GidSaves";
import LoginOverlay from "@/app/components/LoginOverlay";

export default function GidSavesView({ title }: { title: string }) {
  const { state, setState } = useGidState();
  const { me, login } = useOnlineUsers();

  if (!me) return <LoginOverlay onLogin={login} />;

  return (
    <main style={{ padding: 16 }}>
      <h1>{title}</h1>
      <GidSaves state={state} setState={setState} />
    </main>
  );
}
