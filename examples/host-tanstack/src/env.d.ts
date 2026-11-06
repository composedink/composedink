/// <reference types="@rsbuild/core/types" />
declare module "*.mdx" {
  const MDX: import("react").ComponentType;
  export default MDX;
}
