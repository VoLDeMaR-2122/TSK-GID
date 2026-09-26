"use client";

type Msg = { kind: string; [k: string]: unknown };
type Handler = (m: Msg) => void;

class WSClient {
  private sock: WebSocket | null = null;
  private handlers = new Map<string, Set<Handler>>();
  private queue: Msg[] = [];
  private clientId: string | null = null;
  private reconnectTimer: number | null = null;
  private attempts = 0;
  private url = "";

  /** Инициализация URL (вызывать на клиенте). */
  init() {
    if (typeof window === "undefined") return;
    if (this.url) return;
    const proto = location.protocol === "https:" ? "wss:" : "ws:";
    this.url = `${proto}//${location.host}/ws`;
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
      // сливаем очередь, накопленную пока сокет не был открыт
      const q = this.queue.splice(0);
      q.forEach((m) => this.raw(m));
    };
    this.sock.onmessage = (ev) => {
      let m: Msg;
      try { m = JSON.parse(ev.data as string); } catch { return; }
      if (m.kind === "hello") this.clientId = m.clientId as string;
      this.dispatch(m);
    };
    this.sock.onclose = () => { this.sock = null; this.scheduleReconnect(); };
    this.sock.onerror = () => { try { this.sock?.close(); } catch {} };
  }

  private scheduleReconnect() {
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

  send(m: Msg) { this.init(); this.raw(m); }

  getClientId() { return this.clientId; }

  on(kind: string, h: Handler) {
    if (!this.handlers.has(kind)) this.handlers.set(kind, new Set());
    this.handlers.get(kind)!.add(h);
    return () => this.handlers.get(kind)?.delete(h);
  }

  private dispatch(m: Msg) {
    this.handlers.get(m.kind)?.forEach((h) => h(m));
    this.handlers.get("*")?.forEach((h) => h(m));
  }
}

export const ws = new WSClient();
