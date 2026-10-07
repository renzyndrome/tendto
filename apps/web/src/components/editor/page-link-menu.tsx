/**
 * The `[[` menu: type two brackets, pick a page, get a link.
 *
 * WHY THE TRIGGER IS "[" AND NOT "[[": BlockNote 0.51.4 cannot match a multi-character
 * trigger anywhere but the very start of a block. Its `handleTextInput` builds
 * `textBetween(from - trigger.length, from) + typedChar` and compares that to the trigger —
 * for a 2-character trigger it compares THREE characters against two, so the test can only
 * pass where `textBetween` is short, i.e. at a block boundary. Typing `[[` mid-sentence, which
 * is the normal case, would silently do nothing.
 *
 * So the trigger is a single "[", and `shouldOpen` (which sees the state BEFORE the character
 * is inserted) allows it only when the previous character is already a "[". That is exactly
 * the second bracket, and a lone "[" never opens the menu. The cost is that the plugin now
 * believes the trigger was one character long, so it removes only the second bracket when it
 * clears the query — `insertPageLink` below deletes the first one itself.
 *
 * Do not "simplify" this back to triggerCharacter="[[".
 */
import { SuggestionMenuController, type DefaultReactSuggestionItem } from "@blocknote/react";
import { useCallback } from "react";

import { findPagesForLink } from "../../lib/links/page-search";
import { PAGE_LINK_TYPE } from "./page-link";
import type { AppEditor } from "./schema";

interface PageLinkMenuProps {
  editor: AppEditor;
  workspaceId: string | null;
  /** The page being edited, excluded from its own menu. Null for a card description. */
  currentPageId: string | null;
}

/** The character immediately before the cursor, or "" at the start of the document. */
function charBeforeCursor(doc: { textBetween: (from: number, to: number) => string }, from: number) {
  if (from < 1) return "";
  return doc.textBetween(from - 1, from);
}

export function PageLinkMenu({ editor, workspaceId, currentPageId }: PageLinkMenuProps) {
  /**
   * Replace the leftover "[" and the (already cleared) query with the link node. Runs after
   * the menu has closed and cleared its own trigger character, so the only thing left to
   * remove is the first bracket — and only if it really is one.
   */
  const insertPageLink = useCallback(
    (pageId: string, title: string) => {
      editor.transact((tr) => {
        const { from } = tr.selection;
        if (charBeforeCursor(tr.doc, from) === "[") tr.delete(from - 1, from);
      });
      editor.insertInlineContent([
        { type: PAGE_LINK_TYPE, props: { pageId, title } },
        " ",
      ]);
      editor.focus();
    },
    [editor],
  );

  const getItems = useCallback(
    async (query: string): Promise<DefaultReactSuggestionItem[]> => {
      if (!workspaceId) return [];
      const pages = await findPagesForLink(workspaceId, query, currentPageId);
      return pages.map((page) => {
        const title = page.title.trim() || "Untitled";
        return {
          title,
          group: "Link to page",
          onItemClick: () => insertPageLink(page.id, title),
        };
      });
    },
    [workspaceId, currentPageId, insertPageLink],
  );

  return (
    <SuggestionMenuController
      triggerCharacter="["
      shouldOpen={(tr) => charBeforeCursor(tr.doc, tr.selection.from) === "["}
      getItems={getItems}
    />
  );
}
