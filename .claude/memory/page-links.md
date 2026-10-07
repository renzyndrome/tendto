# Page links (`[[`) — the second brain's first primitive

Phase A of the second-brain plan: a page can now link to another page. The link is BlockNote
**inline content** (`pageLink`, props `{ pageId, title }`), never a block — the curated block set
stays exactly as BlockNote ships it, and a link belongs inside a sentence anyway.

Files: `apps/web/src/components/editor/page-link.tsx` (the spec + chip),
`schema.ts` (the one place the editor schema is extended), `page-link-menu.tsx` (the `[[` menu),
`src/lib/links/page-search.ts` (replica-only lookup). Spec: `apps/web/e2e/page-links.spec.ts`.

## Four traps, all of them costly to rediscover

**1. BlockNote 0.51.4 cannot match a two-character trigger mid-paragraph.**
`SuggestionMenu.ts` computes `textBetween(from - trigger.length, from) + typedChar` and compares
that to the trigger — for a 2-char trigger it compares THREE characters against two, so it can
only match where `textBetween` comes back short, i.e. at a block boundary. `triggerCharacter="[["`
therefore does nothing in the normal case of typing mid-sentence. We use `triggerCharacter="["`
plus `shouldOpen`, which sees the state BEFORE the character is inserted, so "the previous
character is already `[`" is exactly the second bracket. The plugin then believes the trigger was
one character and clears only the second bracket, so the item handler deletes the first itself.
**Do not "simplify" this back to `[[`.**

**2. React events do not reach an inline node view.** BlockNote renders inline content through
its OWN React root and moves the DOM into the editor. React dispatches a synthetic event only
inside the root that owns the target's fiber, so an `onClick` on the chip — and an
`onClickCapture` on the editor container — both never fire once a document is hydrated from
stored blocks. Clicks are handled by ONE **native** capture listener on the editor container in
`block-editor.tsx`, matching `[data-page-link]`. Native, on the container, capture phase: all
three parts matter (capture also beats ProseMirror to the "put the caret here" behaviour).

**3. `useQuery` returns an empty array before its first result.** That is indistinguishable from
"this page was deleted", so a chip that only checked `data.length === 0` rendered as a dead,
struck-through link on every hydrate and could not be clicked. Gate the missing state on
`!isLoading`.

**4. A chip for a deleted page must not navigate.** `PageEditor` on an unknown id renders an
empty editor; typing there inserts blocks whose `page_id` Postgres no longer has, the upload
403/FK-fails, and this device's ordered queue wedges permanently. Missing chips are inert.

## Design notes

- The chip shows the **live** title (`useQuery` on `pages`), so renaming a page updates every
  link to it without rewriting one block. `props.title` is only a snapshot, kept for export, for
  the search index, and for the moment before the row arrives. Never refresh it with
  `updateInlineContent` on render — that dirties the document on every device that merely OPENS
  the page and starts last-write-wins churn.
- `toExternalHTML` runs synchronously inside the exporter (it is what `blocksToMarkdownLossy`
  uses, i.e. what the AI Summarize button sends), so it must not query the replica.
- Text extraction has TWO twins that must agree: `inlineContentToText()` in
  `lib/blocks/text.ts` and `blockTextSql()` in `lib/powersync/fts.ts`. A `pageLink` node has no
  `text` key — its label lives in `props.title` — so the SQL matches
  `fullkey LIKE '%.props.title'` as well, or a page found only by the name of something it links
  to would be unsearchable.
- Export writes `[[Title]]` (resolved from current titles, not the snapshot) so an exported
  vault opens in Obsidian with its links intact.
- `persistBlocks` now takes a structural `PersistableBlock`, not `Block[]`: the editor's document
  type is parameterised by its schema, and naming the concrete type dragged the schema into every
  module that saves blocks.

## Backlinks and unlinked mentions (phase B)

`page_links(workspace_id, source_page_id, target_page_id, block_id)` is a DERIVED, device-local
table in `apps/web/src/lib/powersync/page-links.ts` — the twin of the FTS index, built by triggers
on `ps_data__blocks`, rebuilt at boot, dropped on sign-out. No migration, no sync rule, nothing
for another device to reconcile: every row is recomputable from blocks the replica already holds.
Item-description blocks are skipped (`page_id IS NULL`), since a backlink must come FROM a page.

- The update trigger replaces a block's links wholesale rather than diffing them. A block never
  has more than a handful, and "delete then insert" cannot drift.
- **Neither source can be watched with `useQuery`.** PowerSync resolves watched tables from the
  statement's read plan: `page_links` is written by triggers rather than by the sync stream, and
  `fts_blocks` is an FTS5 virtual table with no root page to report. Both only ever change as a
  side effect of a write to `blocks` or `pages`, so `usePageConnections` subscribes to those two
  with `db.onChange` instead.
- The page title is read inside the hook, not passed in as a prop. It is what unlinked mentions
  are searched for, so a rename has to change the answer.
- Backlinks and mentions are deliberately two lists. A link is a decision somebody made; a
  mention is only a hint that they might have meant to. Obsidian splits them for the same reason.
- The panel renders NOTHING when both are empty, and stays collapsed otherwise. An always-open
  panel turns every page into a page about its own metadata.

## Related pages (phase C)

`apps/web/src/lib/links/related.ts` ranks other pages by the open page's most distinctive words
(`terms.ts`: frequency times length, minus a small stopword list). No embeddings: semantic search
needs a paid embeddings API the self-hosted setup cannot provide, and the FTS index is already on
the device. `relatedPages` is exported through `RelatedPagesProvider` so an embedding
implementation can replace it without the panel changing.

- **FTS5 will not evaluate `bm25()` in an aggregate context**, and wrapping the aggregate around a
  subquery does not help either — `sum(bm25(fts_blocks)) ... GROUP BY` fails with "unable to use
  function bm25 in the requested context". Select the built-in `rank` column instead (the same
  score by another name) and total it in JavaScript.
- Pages already listed as backlinks or mentions are excluded. A connection the reader can already
  see is not a suggestion.
- Titles are matched as well as bodies, so anything shared across many titles becomes a real
  term. A test that stamped every title with the same run id related all of them to each other;
  the fix was to glue the stamp into each title rather than leave it as its own word.

## Ask my notes (phase D)

A question typed in the command palette is answered from the workspace, with cited sources.
Client: `lib/ai/retrieve.ts` + `components/search/ask-notes.tsx`. Server: the `ask` task in
`app/ai/compose.py`, `question` on `ComposeRequest`, and the branch in `_prepare`.

- **Retrieval runs on the device.** The server is handed a question and a numbered bundle of
  text, exactly as the rewrite tasks hand it a paragraph; it never reads the workspace for this.
  That keeps "every interactive action is user-triggered, on content the user chose" true, and
  bounds how much of a workspace an engine ever sees.
- **The question goes BEFORE `USER_TEXT_MARKER` and the sources after it.** Extracts can come
  from any page in a shared workspace, i.e. from text a colleague wrote, which is exactly the
  content that must never be read back as instructions.
- **`TASKS` is rebuilt with `dataclasses.replace`.** It used to be reconstructed field by field,
  which silently drops any field added to `Task` later — `scope` would have reset to "editor" and
  put "Ask my notes" in the editor's rewrite menu. A test pins this.
- **An empty retrieval short-circuits before the engine is called.** The spend guards only see
  requests that are made, so asking a model to answer from nothing would spend a call to be told
  what the device already knew.
- The answer reaches a document only through "Insert into this page", and cited pages are
  inserted as real `[[` links so the answer stays checkable. The editor publishes HOW to accept
  text through `useUiStore.pageInsert`; the palette has no editor of its own to reach into.
- No chat history. A thread would turn the search box into a second place to keep things.

Related: [[phase-1-build]] (block ids are BlockNote strings), [[theming]] (the chip is set apart
by a pill and an underline because `accent` is the same shade as body text).
