import { TelemetryFrame, validateFrame } from "./schema";

type FrameCallback = (frame: TelemetryFrame) => void;
type StatusCallback = (connected: boolean) => void;

export class TelemetryClient {
  private ws: WebSocket | null = null;
  private url = "";
  private frameCallbacks: FrameCallback[] = [];
  private statusCallbacks: StatusCallback[] = [];
  private connected = false;
  private shouldReconnect = true;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;

  onFrame(cb: FrameCallback): () => void {
    this.frameCallbacks.push(cb);
    return () => {
      this.frameCallbacks = this.frameCallbacks.filter((c) => c !== cb);
    };
  }

  onStatusChange(cb: StatusCallback): () => void {
    this.statusCallbacks.push(cb);
    return () => {
      this.statusCallbacks = this.statusCallbacks.filter((c) => c !== cb);
    };
  }

  isConnected(): boolean {
    return this.connected;
  }

  connect(url: string): void {
    if (!url.trim()) {
      this.disconnect();
      return;
    }
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.url = url;
    this.shouldReconnect = true;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  disconnect(): void {
    this.shouldReconnect = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    this.setConnected(false);
  }

  private doConnect(): void {
    if (!this.shouldReconnect) return;

    if (this.ws) {
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
    }

    try {
      this.ws = new WebSocket(this.url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.setConnected(true);
    };

    this.ws.onmessage = async (event: MessageEvent) => {
      try {
        const data = JSON.parse(await this.decodeMessageData(event.data));
        const frame = validateFrame(data);
        if (frame) {
          for (const cb of this.frameCallbacks) cb(frame);
        }
      } catch {}
    };

    this.ws.onerror = () => {};
    this.ws.onclose = () => {
      this.setConnected(false);
      if (this.shouldReconnect) this.scheduleReconnect();
    };
  }

  private scheduleReconnect(): void {
    if (!this.shouldReconnect) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempt), 10000);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  private async decodeMessageData(data: unknown): Promise<string> {
    if (typeof data === "string") return data;
    if (data instanceof Blob) return await data.text();
    if (data instanceof ArrayBuffer) return new TextDecoder().decode(data);
    if (ArrayBuffer.isView(data)) {
      const view = data as ArrayBufferView;
      return new TextDecoder().decode(
        view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength),
      );
    }
    return "";
  }

  private setConnected(c: boolean): void {
    if (this.connected === c) return;
    this.connected = c;
    for (const cb of this.statusCallbacks) cb(c);
  }
}
