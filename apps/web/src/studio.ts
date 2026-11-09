import type { Session } from "./SessionStatus";
/**
 * A socket to studio that runs operations without subscribing to a document: Home and New post
 * use it. It reconnects after a drop; calls made while disconnected wait for the next connection.
 */
export class StudioClient {
  private socket?: WebSocket;
  private open?: Promise<WebSocket>;
  private request = 0;
  private stopped = false;
  private calls = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  constructor(private onSession?: (session: Session) => void) {}
  private connect(): Promise<WebSocket> {
    this.open ??= (async () => {
      const { token, origin }: { token: string; origin: string } = await fetch("/session").then(
        (r) => r.json(),
      );
      const socket = new WebSocket(`${origin.replace("http:", "ws:")}/?token=${token}`);
      await new Promise<void>((resolve, reject) => {
        socket.onopen = () => resolve();
        socket.onerror = () => reject(Error("Disconnected: studio is not reachable"));
      });
      socket.onmessage = (event) => {
        const frame = JSON.parse(event.data);
        if (frame.session) return this.onSession?.(frame.session);
        const call = this.calls.get(frame.request);
        if (!call) return;
        this.calls.delete(frame.request);
        if (frame.error) call.reject(Error(String(frame.error)));
        else call.resolve(frame.result);
      };
      socket.onclose = () => {
        this.open = undefined;
        for (const call of this.calls.values()) call.reject(Error("Disconnected before a reply"));
        this.calls.clear();
      };
      this.socket = socket;
      if (this.onSession)
        void this.operation("session.status", {}).then(
          (s) => this.onSession?.(s as Session),
          () => {},
        );
      return socket;
    })().catch((error: unknown) => {
      this.open = undefined;
      throw error;
    });
    return this.open;
  }
  async operation(name: string, input: unknown): Promise<unknown> {
    if (this.stopped) throw Error("Disconnected: the page is closing");
    const socket = await this.connect();
    const request = ++this.request;
    return new Promise((resolve, reject) => {
      this.calls.set(request, { resolve, reject });
      socket.send(JSON.stringify({ request, name, input, human: true }));
    });
  }
  destroy() {
    this.stopped = true;
    this.socket?.close();
  }
}
