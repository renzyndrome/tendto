/**
 * Built-in page templates: a short, fixed set offered on a blank page and nowhere else.
 *
 * Curated, not user-editable, and built only from blocks the editor already ships (docs/planning
 * 03). Each one is a skeleton of headings with an empty block under each, so the page reads as
 * "fill this in" rather than as sample text to delete first.
 */
import type { PartialBlock } from "@blocknote/core";

export interface PageTemplate {
  id: string;
  label: string;
  blocks: readonly PartialBlock[];
}

const heading = (text: string): PartialBlock => ({
  type: "heading",
  props: { level: 2 },
  content: text,
});

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: "meeting-notes",
    label: "Meeting notes",
    blocks: [
      heading("Attendees"),
      { type: "bulletListItem" },
      heading("Agenda"),
      { type: "bulletListItem" },
      heading("Notes"),
      { type: "paragraph" },
      heading("Action items"),
      { type: "checkListItem" },
    ],
  },
  {
    id: "sermon-notes",
    label: "Sermon notes",
    blocks: [
      heading("Passage"),
      { type: "quote" },
      heading("Main points"),
      { type: "numberedListItem" },
      heading("Application"),
      { type: "paragraph" },
      heading("Prayer"),
      { type: "paragraph" },
    ],
  },
  {
    id: "daily-journal",
    label: "Daily journal",
    blocks: [
      heading("Grateful for"),
      { type: "bulletListItem" },
      heading("Today's focus"),
      { type: "checkListItem" },
      heading("Notes"),
      { type: "paragraph" },
    ],
  },
  {
    id: "project-brief",
    label: "Project brief",
    blocks: [
      heading("Goal"),
      { type: "paragraph" },
      heading("Scope"),
      { type: "bulletListItem" },
      heading("Milestones"),
      { type: "checkListItem" },
      heading("Risks"),
      { type: "bulletListItem" },
    ],
  },
];
