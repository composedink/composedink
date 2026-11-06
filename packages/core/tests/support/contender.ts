import { acquire } from "../../src/store/election.ts";
const [home, kind = "inline"] = process.argv.slice(2);
const lock = await acquire(home, kind === "studio" ? "studio" : "inline", async () => {
  process.send?.({ barrier: true });
  await new Promise<void>((r) => process.once("message", () => r()));
});
process.send?.({ kind: lock.kind });
process.on("message", async (message) => {
  if (message === "ready" && lock.kind === "owner") {
    await lock.ready();
    process.send?.({ ready: true });
  }
  if (message === "close") {
    if (lock.kind === "owner") await lock.close();
    process.exit();
  }
});
