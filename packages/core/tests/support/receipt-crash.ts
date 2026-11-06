import { authority, openStore, bind } from "../../src/node.ts";
const a = await authority(await openStore(process.argv[2]));
await bind(a)("doc.create", { slug: "post", request: "lost-ack" });
