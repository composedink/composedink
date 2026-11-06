import { join } from "node:path";
export const composedHome = () =>
  process.env.COMPOSED_HOME ?? join(process.env.HOME ?? ".", ".composed");
