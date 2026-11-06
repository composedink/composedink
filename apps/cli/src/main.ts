import { registry } from "@composedink/core/node";
import { call, composedHome } from "./client.ts";
import { studio } from "./studio.ts";
const args = process.argv.slice(2);
try {
  if (args[0] === "studio") await studio(composedHome());
  else {
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
    let input: unknown;
    switch (operation.name) {
      case "export":
        input = { doc: positional[0], to: option("--to") };
        break;
      case "doc.create":
        input = { slug: positional[0] };
        break;
      case "doc.read":
        input = { doc: positional[0] };
        break;
      case "component.create":
        input = { id: component(positional[0]), kind: option("--kind") };
        break;
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
