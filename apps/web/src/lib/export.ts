/**
 * Workspace export — read the whole active workspace from the local replica and download it as
 * (a) structured JSON and (b) plain-text Markdown. Pure local reads; nothing hits the network.
 */
import type { BlockRow } from "./blocks/serialize";
import { parseBlockContent, type InlineRenderers } from "./blocks/text";
import type { ItemRow } from "./items/mutations";
import { db } from "./powersync/client";

interface WorkspaceRow {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

interface PageRow {
  id: string;
  workspace_id: string;
  parent_id: string | null;
  title: string;
  position: number;
  created_at: string;
  updated_at: string;
}

interface CollectionRow {
  id: string;
  workspace_id: string;
  name: string;
  default_view: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceExport {
  workspace: WorkspaceRow | null;
  pages: PageRow[];
  blocks: BlockRow[];
  collections: CollectionRow[];
  items: ItemRow[];
}

/** Read every row for the workspace from the replica. */
async function collectWorkspace(workspaceId: string): Promise<WorkspaceExport> {
  const [workspaces, pages, blocks, collections, items] = await Promise.all([
    db.getAll<WorkspaceRow>("SELECT * FROM workspaces WHERE id = ?", [workspaceId]),
    db.getAll<PageRow>("SELECT * FROM pages WHERE workspace_id = ? ORDER BY position", [
      workspaceId,
    ]),
    db.getAll<BlockRow>(
      "SELECT * FROM blocks WHERE workspace_id = ? ORDER BY page_id, position",
      [workspaceId],
    ),
    db.getAll<CollectionRow>(
      "SELECT * FROM collections WHERE workspace_id = ? ORDER BY created_at",
      [workspaceId],
    ),
    db.getAll<ItemRow>(
      "SELECT * FROM items WHERE workspace_id = ? ORDER BY collection_id, position",
      [workspaceId],
    ),
  ]);
  return { workspace: workspaces[0] ?? null, pages, blocks, collections, items };
}

/**
 * How a page link renders in the exported Markdown: `[[Page title]]`, the wikilink syntax
 * Obsidian and most Markdown knowledge bases understand — so an exported vault keeps its links
 * instead of flattening to loose words. The title is resolved from the CURRENT pages, not from
 * the link's stored snapshot, so a page renamed after the link was made still exports right.
 */
function wikilinkRenderers(titles: ReadonlyMap<string, string>): InlineRenderers {
  return {
    pageLink: ({ pageId, title }) => {
      const live = titles.get(pageId);
      return `[[${(live ?? title).trim() || "Untitled"}]]`;
    },
  };
}

/**
 * A basic block → Markdown renderer. Maps the curated block set to Markdown and pulls inline
 * text from the block's `content` JSON. Approximate: styling and nested children are flattened.
 */
function blockToMarkdown(block: BlockRow, renderers: InlineRenderers): string {
  const { text, props } = parseBlockContent(block.content, renderers);
  switch (block.type) {
    case "heading": {
      const rawLevel = props.level;
      const level = typeof rawLevel === "number" ? Math.min(Math.max(rawLevel, 1), 6) : 1;
      return `${"#".repeat(level)} ${text}`;
    }
    case "bulletListItem":
      return `- ${text}`;
    case "numberedListItem":
      return `1. ${text}`;
    case "checkListItem":
      return `- [${props.checked === true ? "x" : " "}] ${text}`;
    case "quote":
      return `> ${text}`;
    case "codeBlock":
      return "```\n" + text + "\n```";
    default:
      // paragraph and anything else → plain text
      return text;
  }
}

function buildMarkdown(pages: PageRow[], blocks: BlockRow[]): string {
  const titles = new Map(pages.map((page) => [page.id, page.title]));
  const renderers = wikilinkRenderers(titles);
  const blocksByPage = new Map<string, BlockRow[]>();
  for (const block of blocks) {
    // Item descriptions are blocks too (page_id null) — they belong to their item, not here.
    if (!block.page_id) continue;
    const list = blocksByPage.get(block.page_id) ?? [];
    list.push(block);
    blocksByPage.set(block.page_id, list);
  }

  const sections = pages.map((page) => {
    const pageBlocks = [...(blocksByPage.get(page.id) ?? [])].sort(
      (a, b) => a.position - b.position,
    );
    const body = pageBlocks.map((block) => blockToMarkdown(block, renderers)).join("\n\n");
    return `# ${page.title || "Untitled"}\n\n${body}`.trimEnd();
  });

  return sections.join("\n\n---\n\n") + "\n";
}

function triggerDownload(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  // Revoke on the next tick so the download has a chance to start.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Read the workspace and trigger the two file downloads (JSON + Markdown). */
export async function exportWorkspace(workspaceId: string): Promise<void> {
  const bundle = await collectWorkspace(workspaceId);
  triggerDownload("tendto-export.json", "application/json", JSON.stringify(bundle, null, 2));
  triggerDownload(
    "tendto-export.md",
    "text/markdown;charset=utf-8",
    buildMarkdown(bundle.pages, bundle.blocks),
  );
}
