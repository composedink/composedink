import { authority, openStore, bind } from "../../src/node.ts";
const a = await authority(await openStore(process.argv[2]));
await bind(a)("export", {
  view: "clean",
  doc: "post",
  to: process.argv[3],
  request: "export-retry",
});
