import { RetainedUpdates } from "./pending";
import { encodeFrontiers, type LoroDoc } from "loro-crdt";

export class EditorTransport {
  private socket?: WebSocket;
  private session = crypto.randomUUID();
  private stopped = false;
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private request = 0;
  private pending = new RetainedUpdates();
  private calls = new Map<
    number,
    { resolve: (value: unknown) => void; reject: (error: Error) => void }
  >();
  private waiters: Array<() => void> = [];
  private unsubscribe: () => void;
  private ready = false;
  constructor(
    readonly doc: LoroDoc,
    readonly id: string,
    private status: (status: string) => void,
    private changed: () => void,
  ) {
    this.unsubscribe = doc.subscribeLocalUpdates((bytes) => {
      const seq = ++this.sequence;
      const frame = JSON.stringify({ doc: id, bytes: btoa(String.fromCharCode(...bytes)), seq });
      this.pending.set(seq, frame);
      if (this.ready) this.socket?.send(frame);
      this.status(this.ready ? "Saving" : "Unsaved — disconnected");
    });
    window.addEventListener("offline", this.offline);
    void this.connect();
  }
  private offline = () => this.socket?.close();
  private async connect() {
    try {
      const session: { token: string; origin: string } = await fetch("/session").then((r) =>
        r.json(),
      );
      if (this.stopped) return;
      const socket = (this.socket = new WebSocket(
        `${session.origin.replace("http:", "ws:")}/?token=${session.token}`,
      ));
      socket.onopen = () =>
        socket.send(
          JSON.stringify({
            subscribe: this.id,
            session: this.session,
            base: btoa(String.fromCharCode(...encodeFrontiers(this.doc.frontiers()))),
          }),
        );
      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.preview) {
          this.status(`Preview — ${JSON.stringify(frame.preview.diagnostics)}`);
          return;
        }
        if (frame.error) {
          const call = this.calls.get(frame.request);
          call?.reject(new Error(frame.error));
          this.calls.delete(frame.request);
          this.status(`Unsaved — ${frame.error}`);
          return;
        }
        if (frame.doc && frame.doc !== this.id) return;
        const bytes = frame.snapshot ?? frame.bytes;
        if (bytes) this.doc.import(Uint8Array.from(atob(bytes), (c) => c.charCodeAt(0)));
        if (frame.snapshot) {
          this.ready = true;
          for (const retained of this.pending.values()) socket.send(retained);
        }
        if (typeof frame.seq === "number") this.pending.acknowledge(frame.seq);
        if (typeof frame.request === "number") {
          this.calls.get(frame.request)?.resolve(frame.result);
          this.calls.delete(frame.request);
        }
        if (bytes) this.changed();
        if (this.ready && !this.pending.size) {
          this.status("Saved");
          for (const resolve of this.waiters.splice(0)) resolve();
        } else this.status("Saving");
      };
      socket.onclose = () => {
        this.ready = false;
        this.status("Unsaved — disconnected");
        for (const call of this.calls.values())
          call.reject(new Error("Disconnected before acknowledgement"));
        this.calls.clear();
        if (!this.stopped) this.timer = setTimeout(() => void this.connect(), 200);
      };
    } catch {
      if (!this.stopped) this.timer = setTimeout(() => void this.connect(), 200);
    }
  }
  async flush() {
    if (this.ready && !this.pending.size) return;
    await new Promise<void>((resolve) => this.waiters.push(resolve));
  }
  async operation(name: string, input: unknown, signal?: AbortSignal) {
    await this.flush();
    const request = ++this.request;
    return new Promise<unknown>((resolve, reject) => {
      const cancel = () => {
        if (this.ready) this.socket?.send(JSON.stringify({ cancel: request }));
      };
      this.calls.set(request, {
        resolve: (value) => {
          signal?.removeEventListener("abort", cancel);
          resolve(value);
        },
        reject: (error) => {
          signal?.removeEventListener("abort", cancel);
          reject(error);
        },
      });
      this.socket!.send(JSON.stringify({ request, name, input, human: true }));
      signal?.addEventListener("abort", cancel, { once: true });
      if (signal?.aborted) cancel();
    });
  }
  async undoOperation() {
    await this.flush();
    const request = ++this.request;
    return new Promise<unknown>((resolve, reject) => {
      this.calls.set(request, { resolve, reject });
      this.socket!.send(JSON.stringify({ request, undo: true }));
    });
  }
  destroy() {
    this.stopped = true;
    clearTimeout(this.timer);
    window.removeEventListener("offline", this.offline);
    this.unsubscribe();
    this.socket?.close();
  }
}
