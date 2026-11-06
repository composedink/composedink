export type RequestId = string & { readonly __brand: "RequestId" };
export type Mutation<T> = T & { request?: RequestId };
export type DocRead = {
  doc: string;
  slug: string;
  base: string;
  view: "full";
  text: string;
  dim: never[];
  alts: never[];
  blocks: never[];
};
