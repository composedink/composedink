import { createFileRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
const posts = import.meta.webpackContext("../../content", {
  recursive: true,
  regExp: /\/index\.mdx$/,
  mode: "sync",
});
export const Route = createFileRoute("/posts/$slug")({ component: Post });
function Post() {
  const { slug } = Route.useParams();
  const Body = posts.keys().includes(`./${slug}/index.mdx`)
    ? (posts(`./${slug}/index.mdx`) as { default: ComponentType }).default
    : undefined;
  return Body ? <Body /> : <p>Post not exported</p>;
}
