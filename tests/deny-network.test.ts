import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { it, expect } from "vite-plus/test";

it("denies the artifact port by default and permits only an explicit host and port", async () => {
  const server = createServer((_req, res) => res.end("artifact"));
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing listener");
  const port = String(address.port);
  async function request(allow: string, socket = false) {
    const child = spawn(
      process.execPath,
      [
        `--import=${new URL("./deny-network.mjs", import.meta.url).pathname}`,
        "--input-type=module",
        "-e",
        socket
          ? `import net from "node:net"; const s=net.connect(${port},"127.0.0.1",()=>{s.end();});`
          : `await fetch("http://127.0.0.1:${port}");`,
      ],
      {
        env: { ...process.env, COMPOSED_DENY_PORT: port, COMPOSED_ALLOW_HOST: allow },
        stdio: "ignore",
      },
    );
    const [code] = await once(child, "exit");
    return code;
  }
  try {
    for (const socket of [false, true]) {
      expect(await request("", socket)).not.toBe(0);
      expect(await request(`127.0.0.1:${port}`, socket)).toBe(0);
      expect(await request(`localhost:${port}`, socket)).not.toBe(0);
      expect(await request(`127.0.0.1:${address.port + 1}`, socket)).not.toBe(0);
      expect(await request("127.0.0.1", socket)).toBe(0);
    }
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
