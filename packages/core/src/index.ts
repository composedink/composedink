export type RequestId = string & { readonly __brand: "RequestId" };
export type Mutation<T> = T & { request?: RequestId };
export type DocRead = {
  doc: string;
  slug: string;
  base: string;
  view: "full" | "clean";
  text: string;
  dim: [number, number][];
  alts: { id: string; from: number; to: number; active: number; count: number }[];
  blocks: never[];
};
