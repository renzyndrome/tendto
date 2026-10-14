# Page templates, named new pages, fresh pages (2026-10-13)

## Custom templates are personal, and one row each
`page_templates` (migration 0013) rides `user_private`, not `workspace_content`: the owner asked
for templates "synced to account", Notion-style. A template follows its owner into every
workspace and never reaches a teammate. Built-in templates are defined in code (below).

The body is ONE `content` TEXT column holding the BlockNote document as a JSON string, not
`blocks` rows: a template belongs to no page, `blocks` needs a workspace_id, and a template is
only ever read or written whole. TEXT (not JSONB), so the upload path stores it as sent with no
JSON_COLUMNS entry. `name` is TEXT and both columns have server defaults, so a PUT can never
fail on length or a missing column and wedge the ordered upload queue.

## Block ids are stripped, twice
`blocks.id` is a primary key and BlockNote-owned. Two pages started from one template with the
same block ids would collide on save. `withoutBlockIds` runs on save AND on apply, children
included; BlockNote then gives each inserted block a fresh id.

## Built-ins are editable and deletable, through rows (migration 0014)
Built-ins live in code (`lib/builtin-templates.ts`); their `id` is stored, so never rename one.
A `page_templates` row with `builtin_id` stands in for a built-in: editing makes the user's copy,
deleting sets `hidden = 1` on every row for it (or writes a tombstone row). A row, not a local
flag, so a deleted built-in stays deleted on every device and a fresh device does not
resurrect it. Several rows for one built-in (two devices offline) resolve newest-wins by
instant. "Restore built-in templates" deletes the hidden rows. `hidden` is INTEGER, not
Boolean: the upload path binds the replica's 0/1 raw. Ids stay random; a derived id would
collide across users if the client's user id were ever wrong (403, wedged queue).

## Where templates live in the UI
Made and deleted in Personalization (blank, or "Save page as template" from the open page),
edited at `/t/$templateId` by `TemplateEditor`, which is NOT BlockEditor (that one persists
into `blocks`). Template actions write at once; Personalization's Save/Cancel still governs
only the look. Delete uses the pending-delete Undo store, filtered by `useHiddenIds`.

## New pages are named first
"New page", the hover "+" and "Add subpage" open a "Page name" field in the tree (TreeSource
`newItemNameLabel`) instead of creating "Untitled" at once. Enter on a blank name still makes an
auto-named page (the placeholder shows "Untitled"), which keeps the auto-numbering and its
tests meaningful. Blur with a typed name creates without opening, so a click on another row is
not overridden. Collections still create at once (no `newItemNameLabel`).

E2E: `clickNewPage` in `e2e/helpers/pages.ts` clicks and presses Enter in the field; every spec
that used to click "New page" goes through it.

## No comment box on a page's first visit
Naming a page at creation made it "started" at once, so the thread showed under a page made a
second ago. `stores/fresh-pages.ts` marks a page opened straight after the tree made it (TreeSource `openNew`; one made and left unopened is not marked); PageDiscussion hides an
EMPTY thread while the page is fresh, and leaving the page (or a reload) ends it. The leave is
deferred a tick because StrictMode runs effect cleanup + setup on mount, which would otherwise
end the visit at once. E2E: `createPageAndRevisit` makes a page and reloads before commenting.
