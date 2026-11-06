import { expect, it } from "vite-plus/test";
import { RetainedUpdates } from "../src/editor/pending";
it("retains precisely unacknowledged bytes despite duplicate and reordered acknowledgements", () => {
  const pending = new RetainedUpdates();
  pending.set(1, "first unchanged bytes");
  pending.set(2, "second unchanged bytes");
  pending.set(3, "third unchanged bytes");
  pending.acknowledge(2);
  pending.acknowledge(2);
  pending.acknowledge(99);
  expect([...pending.values()]).toEqual(["first unchanged bytes", "third unchanged bytes"]);
  pending.acknowledge(1);
  expect([...pending.values()]).toEqual(["third unchanged bytes"]);
});
