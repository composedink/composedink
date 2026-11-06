export class RetainedUpdates {
  private frames = new Map<number, string>();
  set(seq: number, frame: string) {
    this.frames.set(seq, frame);
  }
  acknowledge(seq: number) {
    this.frames.delete(seq);
  }
  get size() {
    return this.frames.size;
  }
  values() {
    return this.frames.values();
  }
}
