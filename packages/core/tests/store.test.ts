import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vite-plus/test";
import { openStore, authority } from "../src/node.ts";
import { createPost, replaceText } from "../src/model/text.ts";
it("replays the unchanged editor history after authority restart", async () => {
  const home = await mkdtemp(join(tmpdir(), "composed-store-"));
  try {
    const a = await authority(await openStore(home));
    await a.create("post", createPost("post"));
    const editor = a.get("post").fork();
    const from = editor.version();
    replaceText(editor, "typed <Hello />");
    editor.commit();
    const bytes = editor.export({ mode: "update", from });
    await a.typing("post", bytes);
    await a.typing("post", bytes);
    const b = await authority(await openStore(home));
    expect(b.read("post").text).toBe("typed <Hello />");
    expect(b.read("post").base).toBe(a.read("post").base);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
