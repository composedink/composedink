import { createFileRoute } from "@tanstack/react-router";
import type { ComponentType } from "react";
const posts = import.meta.glob<{ default: ComponentType }>("../../content/*/index.mdx", {
  eager: true,
});
export const Route = createFileRoute("/posts/$slug")({ component: Post });
function Post() {
  const { slug } = Route.useParams();
  const Body = posts[`../../content/${slug}/index.mdx`]?.default;
  return Body ? <Body /> : <p>Post not exported</p>;
}
