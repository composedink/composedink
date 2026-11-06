import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { createServer } from "node:http";
import { expect, type Browser } from "@playwright/test";
export async function desktopRemote(input: {
  root: string;
  runtime: string;
  evidence: string;
  browser: Browser;
  run: (...args: string[]) => Promise<string>;
}) {
  const { root, runtime, evidence, browser, run } = input;
  const fixture = join(evidence, "remote.mdx");
  await writeFile(fixture, '# Remote smoke\n\n<Probe name="Packaged" />\n');
  await run("new", "post", "remote", "--from", fixture, "--i-am-human");
  await run("deps", "add", "remote", "Probe", "composed:desktop/smoke@dev");
  const exported = JSON.parse(await run("preview", "remote", "--to", join(evidence, "export")));
  const host = join(evidence, "host");
  await mkdir(host);
  await writeFile(
    join(host, "entry.tsx"),
    `
 import * as React from ${JSON.stringify(join(root, "apps/web/node_modules/react"))};
 import {createRoot} from ${JSON.stringify(join(root, "apps/web/node_modules/react-dom/client"))};
 import * as JSX from ${JSON.stringify(join(root, "apps/web/node_modules/react/jsx-runtime"))};
 import {blockLoader} from ${JSON.stringify(join(root, "packages/host-runtime/src/index.ts"))};
 const shared = Object.fromEntries(Object.entries({'react':React,'react-dom':{...await import(${JSON.stringify(join(root, "apps/web/node_modules/react-dom"))})},'react/jsx-runtime':JSX}).map(([name,value])=>[name,{version:React.version,lib:()=>value,shareConfig:{singleton:true,requiredVersion:false}}]));
 const block = ${JSON.stringify(exported.lock.blocks.Probe)};
 if(location.search.includes('failed')) block.entry='http://127.0.0.1:1/missing.js';
 const target=document.createElement('div');document.body.append(target);target.textContent='Readable fallback: Hello, Packaged.';
 try { const remote=await blockLoader(shared).load(block);createRoot(target).render(React.createElement(remote.default.component,{name:'Packaged'})); } catch(error) { console.warn(String(error)); }
 `,
  );
  const script = join(runtime, "packages/core/desktop-host.mjs");
  await writeFile(
    script,
    `import {createRsbuild} from '@rsbuild/core';import {pluginReact} from '@rsbuild/plugin-react';const builder=await createRsbuild({cwd:${JSON.stringify(host)},rsbuildConfig:{mode:'production',source:{entry:{index:${JSON.stringify(join(host, "entry.tsx"))}}},plugins:[pluginReact()],output:{distPath:{root:'dist'},minify:false}}});await builder.build();`,
  );
  await promisify(execFile)(join(runtime, "bin/node"), [script], {
    env: { PATH: "/usr/bin:/bin", HOME: process.env.HOME },
    maxBuffer: 10 * 1024 * 1024,
  }).then(async (r) => writeFile(join(evidence, "remote-build.log"), r.stdout + r.stderr));
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
      if (path.includes("..")) throw Error("Invalid path");
      res.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : "text/html");
      res.end(await readFile(join(host, "dist", path)));
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const address = server.address();
  if (!address || typeof address === "string") throw Error("Missing host port");
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await page.goto("http://127.0.0.1:" + address.port);
    const button = page.getByRole("button", { name: "Hello Packaged; clicked 0" });
    await expect(button).toBeVisible();
    await button.click();
    await expect(page.getByRole("button", { name: "Hello Packaged; clicked 1" })).toBeVisible();
    await page.screenshot({ path: join(evidence, "remote-hooks.png") });
    await page.goto("http://127.0.0.1:" + address.port + "/?failed");
    await expect(page.getByText("Readable fallback: Hello, Packaged.")).toBeVisible();
    await page.screenshot({ path: join(evidence, "remote-failed.png") });
    return {
      hooks: true,
      failedRemoteFallback: true,
      entry: exported.lock.blocks.Probe.entry,
      hostOrigin: "http://127.0.0.1:" + address.port,
    };
  } finally {
    await context.close();
    await new Promise<void>((r) => server.close(() => r()));
  }
}
