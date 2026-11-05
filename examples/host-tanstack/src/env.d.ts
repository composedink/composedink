/// <reference types="vite/client" />
declare module "*.mdx" {
  const MDX: import("react").ComponentType;
  export default MDX;
}
