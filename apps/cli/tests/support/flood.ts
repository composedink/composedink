function field(value: unknown, key: string): string {
  if (!value || typeof value !== "object" || !(key in value)) throw new Error("Invalid response");
  const result = Reflect.get(value, key);
  if (typeof result !== "string") throw new Error("Invalid frontier");
  return result;
}
import { call } from "../../src/client.ts";
const [home, label] = process.argv.slice(2);
let base = field(await call(home, "component.read", { id: "composed:test/flood" }), "base");
let text = "";
for (let n = 0; n < 500; n++) {
  text += `${label}:${n}\n`;
  const result = await call(home, "component.write", {
    id: "composed:test/flood",
    base,
    files: { [`${label}.txt`]: text },
    request: `${label}-${n}`,
  });
  base = field(result, "head");
}
console.log(JSON.stringify({ label, acknowledged: 500 }));
