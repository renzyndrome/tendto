/**
 * Built-in page templates: a short set for the core use cases, offered on every blank page until
 * the user edits or deletes one (see lib/templates.ts for how a row stands in for a built-in).
 *
 * Built only from blocks the editor already ships (docs/planning 03). Each is a skeleton, not
 * sample text: a few bold field lines to fill in ("Date: "), then headings with an empty block of
 * the right kind under each, so a page reads as "fill this in" rather than as words to delete.
 *
 * The `id` is stored in `page_templates.builtin_id` once a user edits or deletes a built-in, so
 * it must never change. Labels and blocks may.
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

/** A bold label to type after, such as "Date: ". */
const field = (label: string): PartialBlock => ({
  type: "paragraph",
  content: [{ type: "text", text: `${label}: `, styles: { bold: true } }],
});

const bullets = (count = 1): PartialBlock[] =>
  Array.from({ length: count }, () => ({ type: "bulletListItem" }));
const checks = (count = 1): PartialBlock[] =>
  Array.from({ length: count }, () => ({ type: "checkListItem" }));

const numbered: PartialBlock = { type: "numberedListItem" };
const paragraph: PartialBlock = { type: "paragraph" };
const divider: PartialBlock = { type: "divider" };

export const PAGE_TEMPLATES: readonly PageTemplate[] = [
  {
    id: "meeting-notes",
    label: "Meeting notes",
    blocks: [
      field("Date"),
      field("Attendees"),
      divider,
      heading("Agenda"),
      numbered,
      heading("Notes"),
      ...bullets(),
      heading("Decisions"),
      ...bullets(),
      heading("Action items"),
      ...checks(),
      heading("Next meeting"),
      paragraph,
    ],
  },
  {
    id: "sermon-notes",
    label: "Sermon notes",
    blocks: [
      field("Speaker"),
      field("Date"),
      field("Series"),
      divider,
      heading("Passage"),
      { type: "quote" },
      heading("Big idea"),
      paragraph,
      heading("Main points"),
      numbered,
      heading("Cross-references"),
      ...bullets(),
      heading("Application"),
      ...checks(),
      heading("Prayer"),
      paragraph,
      heading("Questions"),
      ...bullets(),
    ],
  },
  {
    id: "daily-journal",
    label: "Daily journal",
    blocks: [
      heading("Grateful for"),
      ...bullets(3),
      heading("Top 3 today"),
      ...checks(3),
      heading("Notes"),
      paragraph,
      heading("Wins"),
      ...bullets(),
      heading("Tomorrow"),
      ...checks(),
    ],
  },
  {
    id: "weekly-review",
    label: "Weekly review",
    blocks: [
      field("Week of"),
      divider,
      heading("Went well"),
      ...bullets(),
      heading("Did not go well"),
      ...bullets(),
      heading("Lessons"),
      ...bullets(),
      heading("Next week's priorities"),
      ...checks(3),
    ],
  },
  {
    id: "project-brief",
    label: "Project brief",
    blocks: [
      field("Owner"),
      field("Status"),
      field("Target date"),
      divider,
      heading("Problem"),
      paragraph,
      heading("Goal"),
      paragraph,
      heading("Success looks like"),
      ...bullets(),
      heading("Scope"),
      field("In"),
      field("Out"),
      heading("Milestones"),
      ...checks(),
      heading("Risks"),
      ...bullets(),
      heading("Open questions"),
      ...bullets(),
    ],
  },
];
