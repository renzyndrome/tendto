/**
 * Page templates, offered on a blank page and nowhere else. Two kinds:
 *
 * - Built-in: defined in code (lib/builtin-templates.ts).
 * - Custom: a whole page body a user made, Notion-style, in Personalization (a blank one, or a
 *   copy of the open page) and edited in the template editor.
 *
 * Both are managed in Personalization, so a built-in can be edited or deleted too. Built-ins
 * live in code, so a `page_templates` row with `builtin_id` stands in for one: the user's edited
 * copy, or with `hidden` = 1 a record that it was deleted. A built-in with no such row is shown
 * as defined. When two devices wrote rows for one built-in, the newest decides.
 *
 * USER-private (migrations 0013 and 0014, the `user_private` bucket), so the replica only holds
 * the signed-in user's own rows and no query here filters by user. One row per template; the
 * body is a JSON string. All writes go to the local replica; PowerSync uploads them. No network
 * code here.
 */
import type { PartialBlock } from "@blocknote/core";
import { useQuery } from "@powersync/react";
import { useMemo } from "react";

import { loadBlocks, pageOwner, rowToBlock } from "./blocks/serialize";
import { PAGE_TEMPLATES, type PageTemplate } from "./builtin-templates";
import { db } from "./powersync/client";

export { PAGE_TEMPLATES, type PageTemplate } from "./builtin-templates";

/**
 * Largest body a template may hold, in characters of its JSON (data-URL images are ASCII, so
 * close to bytes). A page spreads its images over many `blocks` rows; a template packs them into
 * ONE row, and PowerSync cannot replicate a row much past 15 MB. Such a row would upload, never
 * come back down, and vanish from the device that made it. Refused here instead: a server-side
 * reject would wedge the ordered upload queue.
 */
export const MAX_TEMPLATE_CHARS = 8 * 1024 * 1024;

/** Thrown when a template body is over `MAX_TEMPLATE_CHARS`. Nothing is written. */
export class TemplateTooLargeError extends Error {
  constructor() {
    super("Template too large. Remove images and retry.");
    this.name = "TemplateTooLargeError";
  }
}

/** A body as stored: ids removed, serialized, and within the size limit. */
function serializeBody(blocks: readonly unknown[]): string {
  const content = JSON.stringify(withoutBlockIds(blocks));
  if (content.length > MAX_TEMPLATE_CHARS) throw new TemplateTooLargeError();
  return content;
}

/** What a custom template with no name is called wherever it is listed. */
export const TEMPLATE_UNTITLED = "Untitled template";

/** A `page_templates` row as lists read it. The body is read only when it is used or edited. */
export interface TemplateListRow {
  id: string;
  name: string;
  builtin_id: string | null;
  hidden: number | null;
  updated_at: string;
}

/**
 * One template as a list shows it. `key` is unique in the list and is what an Undo hides.
 * "stored": a row (a custom template, or an edited built-in when `builtinId` is set).
 * "builtin": a built-in nobody has touched, shown as defined in code.
 */
export type TemplateEntry =
  | { kind: "stored"; key: string; id: string; label: string; builtinId: string | null }
  | { kind: "builtin"; key: string; label: string; builtinId: string; template: PageTemplate };

export interface TemplateList {
  /** Custom templates first, oldest first; then the built-ins in their own order. */
  entries: readonly TemplateEntry[];
  /** How many built-ins are deleted, which is what "Restore built-in templates" brings back. */
  hiddenBuiltins: number;
}

const instant = (value: string): number => {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
};

/** The list a user sees, from their rows. Pure, so the rules read in one place. */
export function resolveTemplates(rows: readonly TemplateListRow[]): TemplateList {
  const custom: TemplateEntry[] = rows
    .filter((row) => !row.builtin_id && !row.hidden)
    .map((row) => ({
      kind: "stored",
      key: row.id,
      id: row.id,
      label: row.name || TEMPLATE_UNTITLED,
      builtinId: null,
    }));

  let hiddenBuiltins = 0;
  const builtins: TemplateEntry[] = [];
  for (const template of PAGE_TEMPLATES) {
    // Compared as instants: the text form of `updated_at` changes across the sync round trip.
    // Last write wins, by each device's clock, as everywhere else in the app: a delete on one
    // device and an edit on another resolve to whichever was written later.
    const newest = rows
      .filter((row) => row.builtin_id === template.id)
      .reduce<TemplateListRow | null>(
        (best, row) => (!best || instant(row.updated_at) > instant(best.updated_at) ? row : best),
        null,
      );
    if (newest?.hidden) {
      hiddenBuiltins += 1;
    } else if (newest) {
      builtins.push({
        kind: "stored",
        key: newest.id,
        id: newest.id,
        label: newest.name || template.label,
        builtinId: template.id,
      });
    } else {
      builtins.push({
        kind: "builtin",
        key: `builtin:${template.id}`,
        label: template.label,
        builtinId: template.id,
        template,
      });
    }
  }
  return { entries: [...custom, ...builtins], hiddenBuiltins };
}

/** Every template the user has, built-ins included, in the order a blank page offers them. */
export function useTemplateList(): TemplateList {
  const { data } = useQuery<TemplateListRow>(
    "SELECT id, name, builtin_id, hidden, updated_at FROM page_templates ORDER BY created_at, id",
  );
  return useMemo(() => resolveTemplates(data), [data]);
}

/**
 * A copy of `blocks` with every block id removed, children included.
 *
 * `blocks.id` is a primary key. Two pages started from one template must not carry the same
 * block ids, or the second page's save would collide with the first page's rows. Without ids,
 * BlockNote gives each inserted block a fresh one.
 */
export function withoutBlockIds(blocks: readonly unknown[]): PartialBlock[] {
  return blocks
    .filter(
      (block): block is Record<string, unknown> => typeof block === "object" && block !== null,
    )
    .map((block) => {
      const { id: _id, children, ...rest } = block;
      return {
        ...rest,
        ...(Array.isArray(children) ? { children: withoutBlockIds(children) } : {}),
      } as PartialBlock;
    });
}

/** Parse a stored body. Anything that is not a JSON array reads as an empty template. */
function parseContent(raw: string | null | undefined): PartialBlock[] {
  try {
    const parsed: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(parsed) ? withoutBlockIds(parsed) : [];
  } catch {
    return [];
  }
}

/** A custom template's name and body, or null when it is not in the replica. */
export async function loadTemplate(
  id: string,
): Promise<{ name: string; blocks: PartialBlock[] } | null> {
  const rows = await db.getAll<{ name: string; content: string }>(
    "SELECT name, content FROM page_templates WHERE id = ?",
    [id],
  );
  const row = rows[0];
  return row ? { name: row.name, blocks: parseContent(row.content) } : null;
}

/** Create a custom template. Returns its id. */
export async function createTemplate(
  userId: string | null,
  name: string,
  blocks: readonly unknown[] = [],
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const content = serializeBody(blocks);
  await db.execute(
    `INSERT INTO page_templates
       (id, user_id, name, content, builtin_id, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, NULL, 0, ?, ?)`,
    [id, userId ?? "", name.trim(), content, now, now],
  );
  return id;
}

/**
 * Start editing a built-in: write it as the user's own row, which stands in for it from now on.
 * Returns the row id, for the template editor.
 */
export async function createBuiltinCopy(
  userId: string | null,
  template: PageTemplate,
): Promise<string> {
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const content = serializeBody(template.blocks);
  await db.execute(
    `INSERT INTO page_templates
       (id, user_id, name, content, builtin_id, hidden, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, 0, ?, ?)`,
    [id, userId ?? "", template.label, content, template.id, now, now],
  );
  return id;
}

/**
 * Delete a built-in: mark every row that stands in for it as hidden, or write one that says so
 * when there is none. A row, not a local flag, so it stays deleted on every device.
 */
export async function hideBuiltin(userId: string | null, template: PageTemplate): Promise<void> {
  const now = new Date().toISOString();
  await db.writeTransaction(async (tx) => {
    const rows = await tx.getAll<{ id: string }>(
      "SELECT id FROM page_templates WHERE builtin_id = ?",
      [template.id],
    );
    if (rows.length > 0) {
      await tx.execute(
        "UPDATE page_templates SET hidden = 1, updated_at = ? WHERE builtin_id = ?",
        [now, template.id],
      );
      return;
    }
    await tx.execute(
      `INSERT INTO page_templates
         (id, user_id, name, content, builtin_id, hidden, created_at, updated_at)
       VALUES (?, ?, ?, '[]', ?, 1, ?, ?)`,
      [crypto.randomUUID(), userId ?? "", template.label, template.id, now, now],
    );
  });
}

/** Bring back every deleted built-in, as defined in code. Edited ones that were deleted too. */
export async function restoreBuiltins(): Promise<void> {
  await db.execute("DELETE FROM page_templates WHERE builtin_id IS NOT NULL AND hidden = 1");
}

/** The built-in a `builtin_id` names, or undefined for one no longer in code. */
export function builtinById(builtinId: string | null): PageTemplate | undefined {
  return PAGE_TEMPLATES.find((template) => template.id === builtinId);
}

/**
 * Save a copy of a page as a new template, named after the page. Returns the template id, or
 * null when the page is not in the replica or is a folder (a folder has no body to copy).
 * Throws `TemplateTooLargeError` for a page too big to be one template row.
 */
export async function createTemplateFromPage(
  userId: string | null,
  pageId: string,
): Promise<string | null> {
  const [pages, rows] = await Promise.all([
    db.getAll<{ title: string; kind: string | null }>(
      "SELECT title, kind FROM pages WHERE id = ?",
      [pageId],
    ),
    loadBlocks(pageOwner(pageId)),
  ]);
  const page = pages[0];
  if (!page || page.kind === "folder") return null;
  return createTemplate(userId, page.title, rows.map(rowToBlock));
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  await db.execute("UPDATE page_templates SET name = ?, updated_at = ? WHERE id = ?", [
    name.trim(),
    new Date().toISOString(),
    id,
  ]);
}

/** Save a template's body. Throws `TemplateTooLargeError`, writing nothing, when it is too big. */
export async function saveTemplateBlocks(id: string, blocks: readonly unknown[]): Promise<void> {
  const content = serializeBody(blocks);
  await db.execute("UPDATE page_templates SET content = ?, updated_at = ? WHERE id = ?", [
    content,
    new Date().toISOString(),
    id,
  ]);
}

/** Delete a custom template outright. A built-in is hidden instead; see `hideBuiltin`. */
export async function deleteTemplate(id: string): Promise<void> {
  await db.execute("DELETE FROM page_templates WHERE id = ?", [id]);
}
