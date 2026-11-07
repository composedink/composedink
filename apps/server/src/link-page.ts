import type { IncomingMessage, ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import { decodeFrontiers, type LoroDoc } from "loro-crdt";
import {
  KEYS,
  feedbackRequests,
  projection,
  threadViews,
  type ThreadMessage,
  type ThreadView,
} from "@composedink/core/model";
import { renderArticle } from "./render.ts";
import type { LinkRow, Links, Question } from "./links.ts";
import type { Replicas } from "./replicas.ts";
import type { GuestRate } from "./rate.ts";
import { guestName, type Guests } from "./guest.ts";

/**
 * The page's only script: the guest comment UI. A selection must sit inside one text node of the
 * article, because rendered text then matches the source the server resolves the quote against.
 * The guest's name comes from `data-guest` (the server reads the cookie); each answer re-renders
 * its thread in the aside from the JSON response.
 */
export const SCRIPT = `(() => {
  const page = document.body;
  const article = document.querySelector("article");
  const threads = document.getElementById("threads");
  const form = document.getElementById("comment");
  const quoteOut = document.getElementById("quote");
  const nameRow = document.getElementById("name-row");
  const status = document.getElementById("status");
  const base = location.pathname.replace(/\\/+$/, "");
  let quote = "";
  const guest = () => page.dataset.guest || "";
  const showName = () => {
    for (const row of document.querySelectorAll(".name-row")) row.hidden = Boolean(guest());
  };
  showName();
  document.addEventListener("selectionchange", () => {
    const selection = getSelection();
    if (!selection || !selection.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    const node = range.startContainer;
    if (node !== range.endContainer || node.nodeType !== Node.TEXT_NODE || !article.contains(node))
      return;
    const text = selection.toString();
    if (!text.trim()) return;
    quote = text;
    quoteOut.textContent = text;
    form.querySelector("button").disabled = false;
  });
  async function send(path, payload) {
    const response = await fetch(base + path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.error || "Request failed (" + response.status + ")");
    return body;
  }
  const author = (by) => (by.kind === "guest" ? by.name : "Author");
  function replyForm() {
    const reply = document.createElement("form");
    reply.className = "reply";
    const label = document.createElement("label");
    label.className = "name-row";
    label.append("Your name ");
    const name = document.createElement("input");
    name.name = "name";
    name.maxLength = 60;
    label.append(name);
    const text = document.createElement("textarea");
    text.name = "text";
    text.required = true;
    text.maxLength = 4000;
    text.placeholder = "Reply";
    const button = document.createElement("button");
    button.textContent = "Reply";
    reply.append(label, text, button);
    return reply;
  }
  function render(thread, quoted) {
    let section = threads.querySelector('[data-thread="' + CSS.escape(thread.thread) + '"]');
    if (!section) {
      section = document.createElement("section");
      section.className = "thread";
      section.dataset.thread = thread.thread;
      if (quoted) {
        const q = document.createElement("blockquote");
        q.textContent = quoted;
        section.append(q);
      }
      section.append(document.createElement("ol"), replyForm());
      threads.append(section);
    }
    section.dataset.state = thread.state;
    const list = section.querySelector("ol");
    list.replaceChildren(
      ...thread.messages.map((m) => {
        const item = document.createElement("li");
        const who = document.createElement("strong");
        who.textContent = author(m.by);
        const what = document.createElement("span");
        what.textContent = m.text;
        item.append(who, " ", what);
        return item;
      }),
    );
    showName();
  }
  const named = (field) => {
    const value = field && !guest() ? field.value.trim() : "";
    return value ? { name: value } : {};
  };
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = form.elements.text.value.trim();
    const question = form.elements.question ? form.elements.question.value : "";
    const name = named(form.elements.name);
    try {
      const thread = await send("/threads", {
        quote,
        text,
        ...(question ? { question } : {}),
        ...name,
      });
      if (name.name) page.dataset.guest = name.name;
      render(thread, quote);
      form.elements.text.value = "";
      status.textContent = "Comment sent.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
  threads.addEventListener("submit", async (event) => {
    const reply = event.target;
    if (!(reply instanceof HTMLFormElement) || !reply.classList.contains("reply")) return;
    event.preventDefault();
    const section = reply.closest("[data-thread]");
    const name = named(reply.elements.name);
    try {
      const thread = await send("/threads/" + encodeURIComponent(section.dataset.thread) + "/replies", {
        text: reply.elements.text.value.trim(),
        ...name,
      });
      if (name.name) page.dataset.guest = name.name;
      render(thread);
      reply.elements.text.value = "";
      status.textContent = "Reply sent.";
    } catch (error) {
      status.textContent = error.message;
    }
  });
})();`;

const SCRIPT_HASH = createHash("sha256").update(SCRIPT).digest("base64");
/** Computed once at startup from the constant script. */
export const CSP = `default-src 'none'; style-src 'unsafe-inline'; script-src 'sha256-${SCRIPT_HASH}'; connect-src 'self'; img-src 'self' data:; form-action 'none'; base-uri 'none'; frame-ancestors 'none'`;
const HEADERS = {
  "Content-Type": "text/html; charset=utf-8",
  "Content-Security-Policy": CSP,
  "Cache-Control": "no-store",
  "Referrer-Policy": "no-referrer",
  "X-Robots-Tag": "noindex",
  "X-Content-Type-Options": "nosniff",
};

const escape = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );

const STYLE = `
:root { color-scheme: light dark; font-family: Georgia, serif; line-height: 1.6; }
body { margin: 0 auto; max-width: 72rem; padding: 1.5rem; }
header p { color: GrayText; font-family: system-ui, sans-serif; font-size: 0.9rem; }
ol.questions { font-family: system-ui, sans-serif; }
main { display: grid; grid-template-columns: minmax(0, 1fr) 20rem; gap: 2rem; }
@media (max-width: 50rem) { main { grid-template-columns: 1fr; } }
article { max-width: 40rem; }
figure.block, span.block { border: 1px dashed GrayText; padding: 0.25rem 0.5rem; margin: 1rem 0; font-family: system-ui, sans-serif; font-size: 0.85rem; }
span.block { display: inline; margin: 0; }
aside { font-family: system-ui, sans-serif; font-size: 0.9rem; min-width: 0; }
aside input, aside select, aside textarea { box-sizing: border-box; width: 100%; min-width: 0; }
aside form { display: grid; gap: 0.4rem; margin: 0.5rem 0 1rem; }
aside textarea { min-height: 4rem; }
.thread { border-top: 1px solid GrayText; padding-top: 0.5rem; }
.thread blockquote { margin: 0; font-style: italic; }
.thread ol { list-style: none; padding: 0; }
[hidden] { display: none !important; }
`;

/** The one 404 for unknown, revoked and expired tokens: it never says which. */
export const NOT_FOUND = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Not found</title></head><body><h1>Not found</h1><p>There is no shared page at this address.</p></body></html>`;

const label = (m: ThreadMessage) => (m.by.kind === "guest" ? m.by.name : "Author");
function threadHtml(thread: ThreadView, quote: string | undefined) {
  const messages = thread.messages
    .map((m) => `<li><strong>${escape(label(m))}</strong> <span>${escape(m.text)}</span></li>`)
    .join("");
  return `<section class="thread" data-thread="${escape(thread.thread)}" data-state="${thread.state}">${
    quote ? `<blockquote>${escape(quote)}</blockquote>` : ""
  }<ol>${messages}</ol><form class="reply"><label class="name-row">Your name <input name="name" maxlength="60"></label><textarea name="text" required maxlength="4000" placeholder="Reply"></textarea><button>Reply</button></form></section>`;
}

export function linkPage(input: {
  title: string;
  questions: Question[];
  article: string;
  threads: { view: ThreadView; quote?: string }[];
  guest?: string;
}) {
  const questions = input.questions.length
    ? `<ol class="questions">${input.questions.map((q) => `<li>${escape(q.text)}</li>`).join("")}</ol>`
    : "";
  const options = input.questions
    .map((q) => `<option value="${escape(q.id)}">${escape(q.text)}</option>`)
    .join("");
  const select = input.questions.length
    ? `<label>Question <select name="question"><option value="">None in particular</option>${options}</select></label>`
    : "";
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${escape(input.title)}</title><style>${STYLE}</style></head>
<body data-guest="${escape(input.guest ?? "")}">
<header><h1>${escape(input.title)}</h1><p>A shared preview. Select a phrase to comment; the author sees your comments with your name.</p></header>
${questions}
<main><article>${input.article}</article>
<aside><h2>Comments</h2>
<form id="comment"><p>Selected: <q id="quote">select a phrase in the text</q></p><label id="name-row" class="name-row">Your name <input name="name" maxlength="60"></label>${select}<textarea name="text" required maxlength="4000" placeholder="Your comment"></textarea><button disabled>Comment</button></form>
<p id="status" role="status"></p>
<div id="threads">${input.threads.map((t) => threadHtml(t.view, t.quote)).join("")}</div>
</aside></main>
<script>${SCRIPT}</script>
</body></html>`;
}

/** The questions of the newest request addressed to this link, else the link's stored questions. */
export function linkQuestions(doc: LoroDoc, link: LinkRow): Question[] {
  const recipient = `link:${link.link_id}`;
  let newest: { at: number; questions: Question[] } | undefined;
  try {
    for (const request of feedbackRequests(doc))
      if (request.to.includes(recipient) && (!newest || request.at >= newest.at)) newest = request;
  } catch {
    newest = undefined;
  }
  return newest?.questions ?? (JSON.parse(link.questions) as Question[]);
}

/** Threads started from this link (first message `by.linkId`), with every reply. */
export function linkThreads(doc: LoroDoc, linkId: string) {
  const source = doc.getText(KEYS.mdx).toString();
  return threadViews(doc)
    .filter((t) => {
      const by = t.messages[0]?.by;
      return by?.kind === "guest" && by.linkId === linkId;
    })
    .map((view) => ({
      view,
      quote: view.from !== null && view.to !== null ? source.slice(view.from, view.to) : undefined,
    }));
}

export function sendPage(res: ServerResponse, status: number, html: string) {
  res.writeHead(status, HEADERS).end(html);
}
export const sendNotFound = (res: ServerResponse) => sendPage(res, 404, NOT_FOUND);

/** `GET /s/<token>`: the clean projection of the pinned frontiers or the live replica. */
export function renderLink(link: LinkRow, links: Links, replica: Replicas, guest?: string) {
  const live = replica.get(link.doc_id);
  const doc = link.frontiers
    ? live.forkAt(decodeFrontiers(Buffer.from(link.frontiers, "base64url")))
    : live;
  const { title, html } = renderArticle(
    projection(doc, "clean").text,
    links.instances(link.link_id),
  );
  const slug = doc.getMap(KEYS.meta).get("slug");
  return linkPage({
    title: title ?? (typeof slug === "string" ? slug : link.doc_id),
    questions: linkQuestions(live, link),
    article: html,
    threads: linkThreads(live, link.link_id),
    guest,
  });
}

/** `/s/...`: rate-limited per token before lookup; anything not usable is the one 404. Guest POSTs go to `guests`. */
export function linkPages(links: Links, replica: Replicas, rate: GuestRate, guests: Guests) {
  return async function handle(req: IncomingMessage, res: ServerResponse, parts: string[]) {
    const token = parts[2];
    if (!token) return sendNotFound(res);
    const wait = rate(token);
    if (wait !== undefined) {
      res.writeHead(429, { "Content-Type": "text/plain", "Retry-After": String(wait) });
      return void res.end("Too many requests");
    }
    const link = links.active(token);
    if (!link || replica.get(link.doc_id).getMap(KEYS.meta).get("deleted"))
      return sendNotFound(res);
    if (req.method === "GET" && parts.length === 3)
      return sendPage(res, 200, renderLink(link, links, replica, guestName(req)));
    if (req.method === "POST") return guests(req, res, parts, link);
    return sendNotFound(res);
  };
}
