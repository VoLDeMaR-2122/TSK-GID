"use client";

type Msg = { kind: string; [k: string]: unknown };
type Handler = (m: Msg) => void;

class WSClient {
  private sock: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: Msg[] = [];
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private url = "";

  init() {
    if (typeof window === "undefined") return;
    if (this.url) return;

    // Адрес бэкенда можно переопределить переменной NEXT_PUBLIC_WS_URL —
    // так фронтенд на Next.js подключается к отдельному процессу с логикой и БД.
    // Если переменная не задана, работает как раньше: тот же хост, путь /ws.
    const override = process.env.NEXT_PUBLIC_WS_URL;
    if (override) {
      this.url = override;
    } else {
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      this.url = `${proto}//${location.host}/ws`;
    }
    this.connect();
  }

  private connect() {
    if (typeof window === "undefined") return;

    try {
      this.sock = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.sock.onopen = () => {
      this.attempts = 0;
      const q = this.queue.splice(0);
      q.forEach((m) => this.raw(m));
    };

    this.sock.onmessage = (ev) => {
      let m: Msg;
      try {
        m = JSON.parse(ev.data as string);
      } catch {
        return;
      }

      this.dispatch(m);
    };

    this.sock.onclose = () => {
      this.sock = null;
      this.scheduleReconnect();
    };

    this.sock.onerror = () => {
      try {
        this.sock?.close();
      } catch {}
    };
  }

  private scheduleReconnect() {
    if (typeof window === "undefined") return;
    if (this.reconnectTimer != null) return;

    const delay = Math.min(1000 * 2 ** this.attempts++, 8000);
    this.reconnectTimer = window.setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  private raw(m: Msg) {
    if (this.sock && this.sock.readyState === WebSocket.OPEN) {
      this.sock.send(JSON.stringify(m));
    } else {
      this.queue.push(m);
    }
  }

  send(m: Msg) {
    this.init();
    this.raw(m);
  }

  on(kind: string, h: Handler) {
    if (!this.handlers.has(kind)) {
      this.handlers.set(kind, new Set());
    }

    this.handlers.get(kind)!.add(h);

    // ВАЖНО: возвращаем void, а не boolean от Map.delete()
    return () => {
      const set = this.handlers.get(kind);
      if (set) {
        set.delete(h);
      }
    };
  }

  private dispatch(m: Msg) {
    const set = this.handlers.get(m.kind);
    if (set) {
      set.forEach((h) => h(m));
    }

    const star = this.handlers.get("*");
    if (star) {
      star.forEach((h) => h(m));
    }
  }
}

export const ws = new WSClient();
