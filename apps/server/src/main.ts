import { artifactServer } from "./artifacts.ts";
artifactServer({
  root: process.env.COMPOSED_STORAGE ?? "/data",
  token: process.env.COMPOSED_TOKEN ?? "",
}).listen(Number(process.env.PORT ?? 4849), "0.0.0.0");
