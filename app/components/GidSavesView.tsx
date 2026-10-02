"use client";

// Обёртка: связывает экран сейвов/импорта с живым состоянием ГИД (WS + Postgres).
// Сам GidSaves — «чистый» компонент по состоянию, его переиспользуют и другие экраны.
import { useGidState } from "@/lib/useGidState";
import { GidSaves } from "@/app/components/GidSaves";

export default function GidSavesView({ title }: { title: string }) {
  const { state, setState } = useGidState();

  return (
    <main style={{ padding: 16 }}>
      <h1>{title}</h1>
      <GidSaves state={state} setState={setState} />
    </main>
  );
}
