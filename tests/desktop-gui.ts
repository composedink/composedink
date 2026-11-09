import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import assert from "node:assert/strict";
const exec = promisify(execFile);
const root = resolve(import.meta.dirname, "..");
const evidence = join(root, "test-results/plan-11-gui");
await mkdir(evidence, { recursive: true });
const session = await exec("/usr/sbin/ioreg", ["-n", "Root", "-d1", "-a"]);
// ioreg's plist is authoritative; Accessibility may appear enabled even while locked.
if (/<key>CGSSessionScreenIsLocked<\/key>\s*<true\s*\/>/.test(session.stdout)) {
  const result = {
    check: "window typing + screenshot",
    status: "skipped: gui session locked",
    reason:
      "IOConsoleUsers reports CGSSessionScreenIsLocked=true; native typing, relaunch screenshot and window launch time require the unlocked GUI session",
  };
  await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} else {
  const app = join(root, "apps/desktop/src-tauri/target/release/bundle/macos/Composed.app");
  const home = join(evidence, "home-" + Date.now());
  await mkdir(home, { recursive: true });
  const runtime = join(home, "runtime");
  await mkdir(runtime);
  await exec("/usr/bin/tar", [
    "-xzf",
    join(app, "Contents/Resources/runtime.tar.gz"),
    "-C",
    runtime,
  ]);
  const cli = join(runtime, "bin/composed");
  const env = {
    HOME: process.env.HOME,
    PATH: "/usr/bin:/bin",
    COMPOSED_HOME: home,
    COMPOSED_PORT: "4794",
    COMPOSED_ARTIFACT_PORT: "4894",
  };
  const run = async (...args: string[]) => (await exec(cli, args, { env })).stdout;
  await run("new", "post", "tracer");
  let child: ReturnType<typeof spawn> | undefined;
  async function apple(script: string) {
    return (await exec("/usr/bin/osascript", ["-e", script], { timeout: 8000 })).stdout;
  }
  async function wait(check: () => Promise<boolean>) {
    for (let i = 0; i < 360; i++) {
      if (await check().catch(() => false)) return;
      await delay(250);
    }
    throw Error("Native GUI check timed out");
  }
  function launch() {
    child = spawn(join(app, "Contents/MacOS/composed-desktop"), [], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stderr?.on("data", (b) => {
      void writeFile(join(evidence, "process.log"), b, { flag: "a" });
    });
    return child.pid;
  }
  const sentence = "Native desktop smoke " + Date.now() + ".";
  const start = performance.now();
  try {
    const pid = launch();
    await wait(
      async () =>
        Number(
          await apple(
            `tell application "System Events" to tell (first process whose unix id is ${pid}) to get count of windows`,
          ),
        ) > 0,
    );
    // Cold open shows Home (plan 18): open the post from its row before typing.
    await apple(`tell application "System Events"
    tell (first process whose unix id is ${pid})
      set frontmost to true
      repeat with element in (entire contents of window 1)
        if role of element is "AXLink" and (description of element contains "Untitled" or title of element contains "Untitled") then
          perform action "AXPress" of element
          exit repeat
        end if
      end repeat
    end tell
  end tell`);
    await delay(1500);
    await apple(`tell application "System Events"
    tell (first process whose unix id is ${pid})
      set frontmost to true
      set candidates to entire contents of window 1
      repeat with element in candidates
        if role of element is "AXTextArea" then
          set focused of element to true
          exit repeat
        end if
      end repeat
      keystroke "a" using command down
      keystroke ${JSON.stringify(sentence)}
    end tell
  end tell`);
    await wait(async () => (await run("cat", "tracer")).includes(sentence));
    const coldWindowEditMs = performance.now() - start;
    await exec("/usr/sbin/screencapture", ["-x", join(evidence, "typed.png")]);
    child?.kill("SIGTERM");
    await delay(3000);
    launch();
    await wait(
      async () =>
        Number(
          await apple(
            `tell application "System Events" to tell (first process whose unix id is ${child?.pid}) to get count of windows`,
          ),
        ) > 0,
    );
    assert.ok((await run("cat", "tracer")).includes(sentence));
    await exec("/usr/sbin/screencapture", ["-x", join(evidence, "relaunched.png")]);
    const result = {
      check: "window typing + screenshot",
      status: "passed",
      nativeTyping: true,
      terminalRead: true,
      relaunchPersistence: true,
      coldWindowEditMs,
    };
    await writeFile(join(evidence, "result.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result));
  } finally {
    child?.kill("SIGTERM");
  }
}
