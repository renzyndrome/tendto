/**
 * The editor's schema — the default BlockNote one plus our `pageLink` inline content.
 *
 * Deliberately additive: `defaultBlockSpecs` and `defaultStyleSpecs` are untouched, so the
 * curated block set is exactly what BlockNote ships (docs/planning 03). The ONLY extension is
 * an inline node, which lives inside a paragraph rather than beside it.
 */
import { BlockNoteSchema, defaultInlineContentSpecs } from "@blocknote/core";

import { pageLink } from "./page-link";

export const schema = BlockNoteSchema.create({
  inlineContentSpecs: {
    ...defaultInlineContentSpecs,
    pageLink,
  },
});

export type AppEditor = typeof schema.BlockNoteEditor;
export type AppBlock = typeof schema.Block;
export type AppPartialBlock = typeof schema.PartialBlock;
