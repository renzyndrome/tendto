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

Related: [[phase-1-build]] (block ids are BlockNote strings), [[theming]] (the chip is set apart
by a pill and an underline because `accent` is the same shade as body text).
