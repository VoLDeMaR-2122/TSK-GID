// app/data/import/page.tsx
import { GidSaves } from '@/app/components/GidSaves';   // ← ДОБАВИТЬ импорт (путь см. Шаг 4)

export default function ImportPage() {
  return (
    <main>
      <h1>Импорт данных ГИД</h1>
      <GidSaves />                                  // ← ВСТАВИТЬ компонент на место старого блока загрузки
    </main>
  );
}
