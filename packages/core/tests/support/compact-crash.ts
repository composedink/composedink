import { authority, openStore } from "../../src/node.ts";
const a = await authority(await openStore(process.argv[2]));
await a.compact("p");
