import { desktop } from "./desktop.ts";
import { configureScope } from "@composedink/core/node";
import { componentEdit } from "./component-edit.ts";
import { humanDirect } from "@composedink/core/node";
import { readFile } from "node:fs/promises";
import { mcp } from "./mcp.ts";
import { registry } from "@composedink/core/node";
import { call, composedHome } from "./client.ts";
import { studio } from "./studio.ts";
const args = process.argv.slice(2);
try {
  if (args[0] === "desktop") await desktop(composedHome());
  else if (args[0] === "config" && args[1] === "scope") {
    await configureScope(
      composedHome(),
      args[2],
      args[args.indexOf("--server") + 1],
      args[args.indexOf("--token-ref") + 1],
    );
  } else if (args[0] === "mcp") await mcp();
  else if (args[0] === "studio") await studio(composedHome());
  else if (args[0] === "component" && args[1] === "edit")
    await componentEdit(
      composedHome(),
      args[2].startsWith("composed:") ? args[2] : `composed:${args[2]}`,
      args[3],
    );
  else {
    if (args[0] === "export") args[0] = "preview";
    const operation = registry.find((op) => op.cli.every((part, i) => args[i] === part));
    if (!operation)
      throw new Error(`Commands: studio, ${registry.map((op) => op.cli.join(" ")).join(", ")}`);
    const values = args.slice(operation.cli.length);
    const positional = values.filter(
      (v, i) => !v.startsWith("--") && (i === 0 || !values[i - 1].startsWith("--")),
    );
    const option = (flag: string) => values[values.indexOf(flag) + 1];
    const component = (value: string) =>
      value.startsWith("composed:") ? value : `composed:${value}`;
    const direct = values.includes("--direct");
    if (
      operation.name === "doc.import" ||
      direct ||
      (operation.name === "doc.create" && values.includes("--from"))
    )
      humanDirect(!!process.stdin.isTTY, values.includes("--i-am-human"));
    if (direct && values.includes("--propose")) throw Error("Choose --direct or --propose");
    let input: unknown;
    switch (operation.name) {
      case "component.publish":
        input = {
          id: component(positional[0]),
          bump: values.includes("--major")
            ? "major"
            : values.includes("--minor")
              ? "minor"
              : "patch",
        };
        break;
      case "deps.pin":
        input = { doc: positional[0], tag: positional[1], version: values[2] };
        break;
      case "doc.import":
        input = { doc: positional[0], file: option("--file") };
        break;
      case "export":
        input = {
          mode: process.argv[2] === "export" ? "release" : "preview",
          doc: positional[0],
          to: values.includes("--to") ? option("--to") : undefined,
          view: values.includes("--include-dim") ? "full" : "clean",
        };
        break;
      case "doc.apply": {
        let text = "";
        for await (const chunk of process.stdin) text += chunk;
        input = {
          doc: positional[0],
          base: option("--base"),
          view: values.includes("--view") ? option("--view") : "full",
          text,
          mode: direct ? "direct" : "propose",
          by: { kind: direct ? "human" : "agent", ...(direct ? {} : { name: "cli" }) },
        };
        break;
      }
      case "doc.create":
        input = {
          slug: positional[0],
          ...(values.includes("--kind") ? { kind: option("--kind") } : {}),
        };
        break;
      case "doc.kind":
        input = { id: positional[0], kind: positional[1] };
        break;
      case "kind.list":
        input = {};
        break;
      case "kind.read":
        input = { kind: positional[0] };
        break;
      case "kind.write": {
        let text = "";
        for await (const chunk of process.stdin) text += chunk;
        input = { kind: positional[0], file: option("--file"), text, base: option("--base") };
        break;
      }
      case "rules.effective":
        input = { id: positional[0] };
        break;
      case "doc.read":
        input = { doc: positional[0], view: values.includes("--view") ? option("--view") : "full" };
        break;
      case "component.create":
        input = { id: component(positional[0]), kind: option("--kind") };
        break;
      case "component.check":
      case "component.read":
        input = { id: component(positional[0]) };
        break;
      case "component.write": {
        let text = "";
        for await (const chunk of process.stdin) text += chunk;
        input = {
          id: component(positional[0]),
          base: option("--base"),
          files: { [option("--file")]: text },
        };
        break;
      }
      case "alt.rewrite":
        input = {
          doc: positional[0],
          at: {
            base: option("--base"),
            quote: option("--quote"),
            view: values.includes("--view") ? option("--view") : "full",
            ...(values.includes("--nth") ? { nth: Number(option("--nth")) } : {}),
          },
          ...(values.includes("--instruction") ? { instruction: option("--instruction") } : {}),
          ...(values.includes("--count") ? { count: Number(option("--count")) } : {}),
        };
        break;
      case "alt.propose":
        input = {
          doc: positional[0],
          at: {
            base: option("--base"),
            quote: option("--quote"),
            ...(values.includes("--nth") ? { nth: Number(option("--nth")) } : {}),
          },
          versions: values.flatMap((v, i) => (v === "--version" ? [values[i + 1]] : [])),
          by: { kind: "agent", name: "cli" },
        };
        break;
      case "alt.flip":
        input = {
          doc: positional[0],
          alt: positional[1],
          to: values.includes("--to")
            ? Number(option("--to"))
            : values.includes("--prev")
              ? "prev"
              : "next",
        };
        break;
      case "alt.resolve":
        input = {
          doc: positional[0],
          alt: positional[1],
          rest: values.includes("--ghost") ? "ghost" : "stash",
        };
        break;
      case "ghost.set":
      case "stash.add":
      case "stash.restore":
        input = {
          doc: positional[0],
          item: positional[1],
          dim: !values.includes("--undim"),
          at: {
            base: option("--base"),
            from: Number(option("--from")),
            to: Number(option("--to")),
          },
        };
        break;
      case "lint":
      case "stash.list":
        input = { doc: positional[0] };
        break;
      case "thread.open":
        input = {
          id: positional[0],
          base: option("--base"),
          quote: option("--quote"),
          text: option("--text"),
          ...(values.includes("--question") ? { question: option("--question") } : {}),
        };
        break;
      case "thread.reply":
        input = { id: positional[0], thread: positional[1], text: option("--text") };
        break;
      case "thread.resolve":
        input = { id: positional[0], thread: positional[1] };
        break;
      case "thread.list":
        input = {
          id: positional[0],
          ...(values.includes("--state") ? { state: option("--state") } : {}),
        };
        break;
      case "feedback.request": {
        const questions = values.flatMap((v, i) => (v === "--question" ? [values[i + 1]] : []));
        input = {
          id: positional[0],
          to: values.flatMap((v, i) => (v === "--to" ? [values[i + 1]] : [])),
          ...(questions.length ? { questions } : {}),
        };
        break;
      }
      case "feedback.answers":
        input = { id: positional[0], request: positional[1] };
        break;
      case "session.login":
        input = {
          server: positional[0],
          ...(values.includes("--code") ? { code: option("--code") } : {}),
          ...(values.includes("--bootstrap") ? { bootstrap: option("--bootstrap") } : {}),
          ...(values.includes("--name") ? { deviceName: option("--name") } : {}),
        };
        break;
      case "session.logout":
      case "session.status":
      case "devices.pair":
      case "devices.list":
        input = {};
        break;
      case "devices.revoke":
        input = { device: positional[0] };
        break;
      case "sync.now":
        input = positional[0] ? { id: positional[0] } : {};
        break;
      case "share.create": {
        const questions = values.flatMap((v, i) => (v === "--question" ? [values[i + 1]] : []));
        input = {
          id: positional[0],
          mode: values.includes("--live") ? "live" : "pinned",
          ...(values.includes("--expires") ? { expiresIn: option("--expires") } : {}),
          ...(questions.length ? { questions } : {}),
        };
        break;
      }
      case "share.list":
        input = { id: positional[0] };
        break;
      case "share.revoke":
        input = { link: positional[0] };
        break;
      case "deps.add": {
        const [id, version] = positional[2].split("@");
        input = { doc: positional[0], tag: positional[1], component: id, version };
        break;
      }
      default:
        throw new Error("Unsupported CLI mapping");
    }
    if (operation.mutation && input && typeof input === "object" && values.includes("--request"))
      input = { ...input, request: option("--request") };
    const result = await call(composedHome(), operation.name, input);
    if (operation.name === "lint") {
      // A missing kind lints with post rules; say so where the author is looking.
      const effective = await call(composedHome(), "rules.effective", { id: positional[0] });
      if (effective && typeof effective === "object" && "warnings" in effective)
        for (const warning of Array.isArray(effective.warnings) ? effective.warnings : [])
          console.error(`warning: ${String(warning)}`);
    }
    if (operation.name === "doc.create" && values.includes("--from")) {
      const source = await readFile(option("--from"), "utf8");
      const state = await call(composedHome(), "doc.read", { doc: positional[0] });
      if (!state || typeof state !== "object" || !("base" in state)) throw Error("Missing base");
      await call(composedHome(), "doc.apply", {
        doc: positional[0],
        base: state.base,
        text: source,
        mode: "direct",
        by: { kind: "human" },
        ...(values.includes("--request") ? { request: option("--request") + ":from" } : {}),
      });
    }
    if (
      operation.name === "doc.read" &&
      !args.includes("--json") &&
      result &&
      typeof result === "object" &&
      "text" in result &&
      typeof result.text === "string"
    )
      process.stdout.write(result.text);
    else console.log(JSON.stringify(result));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
