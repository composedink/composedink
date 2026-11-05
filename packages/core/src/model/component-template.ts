export function componentTemplate(kind: "inline" | "block") {
  return {
    "package.json": JSON.stringify(
      { name: "composed-hello", private: true, type: "module", dependencies: {} },
      null,
      2,
    ),
    "block.tsx": `import * as React from "react";
import { defineBlock } from "@composedink/blocks";
import fallback from "./fallback";
function Hello({ name }: { name: string }) {
 const [n, setN] = React.useState(0);
 return <button onClick={() => setN(n + 1)}>Hello {name}; clicked {n}</button>;
}
export default defineBlock({kind: "${kind}", props: {type:"object", properties:{name:{type:"string"}}, required:["name"]},sample:{name:"Lachlan"},component:Hello,fallback});
`,
    "fallback.ts": "export default ({ name }: { name: string }) => `Hello, **${name}**.`;\n",
  };
}
