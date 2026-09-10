# The second brain — links, backlinks, related pages, and asking your notes

Four features that turn a pile of pages into something you can navigate by meaning rather than by
remembering where you filed things. They ship as one set because each one is thin on its own and
they compound: links create backlinks, backlinks feed the related list, and all of it feeds the
retrieval behind "Ask my notes".

The reference point is Obsidian, which is where the link-and-backlink loop earned its reputation.
The parts of Obsidian that were **not** copied matter as much as the parts that were: no graph
view, no tags, no properties, no daily-notes page, no plugin surface. Each of those would have to
earn its place separately against the clutter test in `docs/planning/README.md`.

---

## 1. Page links

Type `[[` anywhere in a page. A picker opens listing the workspace's pages; keep typing to narrow
it, press Enter to insert. What you get is a chip inside the sentence, not a block of its own.

- **A link stores an id, not a name.** The chip shows the target's *current* title, read from the
  local replica every time it draws. Rename a page and every link to it updates, with no block
  rewritten and nothing to sync.
- **A dead link is inert.** If the target page is deleted, the chip goes grey and struck through
  and clicking it does nothing. This is a safety rule: opening a page id that no longer exists
  gives you a blank editor, and typing there would save blocks belonging to a missing page, which
  the server rejects and which would stop that device syncing altogether.
- **Export keeps your links.** The Markdown export writes `[[Page title]]`, so an exported vault
  opens in Obsidian with its links intact.
- **Search knows about them.** A page can be found by the name of a page it links to.

A single `[` does nothing, so `cost [1] per unit` stays ordinary text.

## 2. Backlinks and unlinked mentions

Below the body of a page, above its comments, one quiet grey line appears when other pages point
at this one — for example `2 linked · 1 mentioned · 3 related`. Click it to expand.

- **Linked from** lists pages that made a real `[[` link here, each with the sentence the link
  sits in.
- **Mentioned in** lists pages that write this page's title as ordinary prose and never linked it.
  That is the "I wrote about this before I had a page for it" case.

They stay two lists on purpose. A link is a decision somebody made; a mention is only a hint that
they might have meant to.

When nothing points at a page, the whole section renders nothing at all.

## 3. Related pages

A third list, **Related**, suggests pages that keep using the same distinctive words as the one
you are reading. Nobody connected them; the vocabulary did.

- It runs on the full-text index already on the device, so it costs nothing per query and works
  offline.
- Embeddings were deliberately not used. Semantic search needs a paid embeddings API that a
  self-hosted instance cannot provide. The implementation sits behind a provider interface so an
  embedding version can replace it later without the panel changing.
- Pages already shown as links or mentions are excluded, because a connection you can already see
  is not a suggestion.

## 4. Ask my notes

Open the command palette with `Cmd/Ctrl+K`, type a **question** instead of a search term, and
press `Cmd/Ctrl+Enter` (or click the **Ask** row). The answer streams in, followed by the pages it
drew on.

- **Retrieval happens on your device.** The local index picks the matching notes, and only those
  extracts are sent. The server never reads your workspace for this — it is handed a question and
  a numbered bundle of text, exactly as the rewrite tasks are handed a paragraph.
- **The answer cites its sources** as `[1]`, `[2]`, listed underneath. Clicking one opens that page
  so you can check it.
- **Nothing is written to a page unless you ask.** "Insert into this page" appends the answer to
  the page you have open and turns each citation into a real link, so the answer stays checkable
  later. Until that button is pressed, no document is touched.
- **A question that matches nothing costs nothing.** The device says so and never calls the engine.
- **No engine, no feature.** With `AI_CLI` and `AI_API_KEY` both empty, the Ask row is absent and
  the shortcut does nothing.
- There is no chat history. One question, one answer, then it resets.

---

## How it is built

| Piece | Where |
| --- | --- |
| Link chip and its `[[` menu | `apps/web/src/components/editor/page-link.tsx`, `page-link-menu.tsx`, `schema.ts` |
| Link index (device-local) | `apps/web/src/lib/powersync/page-links.ts` |
| Backlinks, mentions, related | `apps/web/src/lib/links/` |
| The panel under a page | `apps/web/src/components/editor/page-connections.tsx` |
| Retrieval for a question | `apps/web/src/lib/ai/retrieve.ts` |
| Answer view and palette row | `apps/web/src/components/search/ask-notes.tsx`, `search-palette.tsx` |
| The `ask` task and its prompt | `apps/api/app/ai/compose.py`, `app/routers/ai.py` |

Two things are worth knowing before changing any of it.

**No new synced table was added.** `page_links` is *derived*: a plain local table filled by SQLite
triggers, rebuilt at every boot and dropped at sign-out, exactly like the search index. Every row
can be recomputed from blocks the device already holds, so there is no migration, no sync rule,
and nothing for a second device to reconcile.

**The traps are written down.** `.claude/memory/page-links.md` records why the `[[` trigger is
wired to a single `[`, why link clicks use a native listener, why `bm25()` cannot be summed, and
why the question is placed ahead of the injection marker. Read it before "simplifying" any of
those.

---

# How to test it

Two ways: run the automated suite, or click through it yourself. Do the automated run first — it
is faster and it proves the plumbing.

## A. Run the automated tests

```bash
make test                       # API tests + web typecheck
make e2e                        # boots the stack, runs the full Playwright suite
```

To run only the four second-brain specs:

```bash
make e2e-stack                  # boot Postgres, PowerSync, auth, API
cd apps/web
npx playwright test e2e/page-links.spec.ts e2e/backlinks.spec.ts \
                   e2e/related.spec.ts e2e/ask-notes.spec.ts
```

Expected: everything passes. Two specs (`ai-summary`, `recap`) **skip** when a real AI engine is
configured — that is correct, not a failure.

> **If every spec fails at "editor not visible"**, check nothing else is already serving port
> 15173. Playwright reuses an existing dev server, so a `vite --mode desktop` session left running
> will serve the desktop bundle to the browser and nothing will work. Stop it and re-run.

The AI engine is stubbed in every spec, so **no test ever spends your AI subscription**.

## B. Click through it yourself

### Setup

```bash
make dev            # boots the whole stack, then Vite in the foreground
```

Open http://localhost:15173 and sign up. For section 4 you also need an AI engine — see step 12.

### Page links

1. Click **+** next to *Pages*. Name it `Launch plan`.
2. Create a second page named `Weekly notes`.
3. In *Weekly notes*, type: `budget lives in ` then `[[` and start typing `Launch`.
   → A picker appears listing *Launch plan*. Press Enter.
   → **Expect:** a chip reading *Launch plan* inside your sentence, and no stray brackets.
4. Click the chip. → **Expect:** you land on *Launch plan*.
5. Rename *Launch plan* to `Launch plan v2`, then go back to *Weekly notes*.
   → **Expect:** the chip now reads *Launch plan v2*. You never edited that page.
6. Reload the browser. → **Expect:** the chip is still there.
7. Type `cost [1] per unit` somewhere. → **Expect:** no picker, text left alone.

### Backlinks and mentions

8. Open *Launch plan v2*. → **Expect:** a grey line above the comments reading `1 linked`.
   Click it. → **Expect:** *Weekly notes* listed under **Linked from**, with your sentence
   underneath. Click the row. → **Expect:** you land on *Weekly notes*.
9. Create a third page named `Diary`, and type in it: `I should write up Launch plan v2 tomorrow`
   (plain text, no `[[`). Wait a second or two.
10. Open *Launch plan v2* and expand the panel again.
    → **Expect:** *Diary* now appears under **Mentioned in**, and *not* under Linked from.

### Related pages

11. Create two pages that share an unusual word and one that does not:
    - `Machining` — *the tolerance stack on the spindle housing is the tolerance problem*
    - `Vendor call` — *vendor confirmed the tolerance stack meets the spindle spec*
    - `Groceries` — *milk, bread, apples*

    Open *Machining* and expand the panel.
    → **Expect:** *Vendor call* under **Related**. *Groceries* must not appear.
    → Clicking it opens *Vendor call*.

    > Give the pages distinct titles. Titles are matched too, so three pages all ending in the
    > same word are genuinely related by that word.

### Ask my notes

12. Configure an engine in the repo-root `.env`, then restart `make dev`:
    - **Claude CLI** (uses your own subscription): `AI_CLI=claude`. Start `make dev` from a shell
      where `claude -p` already works.
    - **or an API key**: `AI_API_KEY=sk-...` (OpenAI by default; set `AI_BASE_URL` for Anthropic
      or a local Ollama).
13. Press `Cmd/Ctrl+K`. Type a real question, for example `when does the launch ship`.
    → **Expect:** an **Ask** row above the search results reading *Ask my notes about "…"*.
14. Press `Cmd/Ctrl+Enter` (or click the row).
    → **Expect:** "Looking through your notes…", then an answer streaming in, then a line saying
    how many pages it was answered from and which engine wrote it.
15. → **Expect:** a **Sources** list underneath. Click one. → **Expect:** the palette closes and
    that page opens.
16. Open a page, press `Cmd/Ctrl+K`, ask again, and this time click **Insert into this page**.
    → **Expect:** the answer is appended to the page, followed by a `Sources:` line whose entries
    are real, clickable page links. Before you click the button, the page must be untouched.
17. Ask something your notes cannot answer, for example `what is my passport number`.
    → **Expect:** *Nothing in your notes matches that.* No request is sent to the engine.
18. Empty `AI_CLI` and `AI_API_KEY`, restart, and press `Cmd/Ctrl+K` again.
    → **Expect:** no Ask row at all, and `Cmd/Ctrl+Enter` does nothing.

### Two things that should NOT happen

- A link to a page you have deleted should go grey and struck through, and clicking it should do
  nothing at all. If it opens a blank page, stop and report it — that path can wedge the device's
  upload queue.
- A page nothing points at should show no panel whatsoever, not an empty one.
