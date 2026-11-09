import { createRoot } from "react-dom/client";
import { useEffect, useState } from "react";
import type { DocSummary } from "@composedink/core";
import { Home } from "./Home";
import { PostEditor } from "./PostEditor";
import { StudioClient } from "./studio";
import "./style.css";

/** The URL decides: no `doc` shows Home; `?doc=<slug>` opens it, or Home with a notice if absent. */
function Root() {
  // Read once: Home replaces the URL of a missing post and must still name it.
  const [id] = useState(() => new URLSearchParams(location.search).get("doc"));
  const [found, setFound] = useState<boolean>();
  useEffect(() => {
    if (id === null) return;
    const client = new StudioClient();
    void client
      .operation("doc.list", {})
      .then(
        (r) => (r as { docs: DocSummary[] }).docs.some((d) => d.id === id),
        // If the list cannot be read, let the editor try; it reports its own failure.
        () => true,
      )
      .then((exists) => {
        if (!exists) history.replaceState(null, "", location.pathname);
        setFound(exists);
      })
      .finally(() => client.destroy());
  }, [id]);
  if (id === null) return <Home />;
  if (found === undefined) return <main className="opening" aria-busy="true" />;
  return found ? <PostEditor id={id} /> : <Home missing={id} />;
}
createRoot(document.getElementById("root")!).render(<Root />);
