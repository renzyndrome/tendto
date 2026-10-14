/**
 * TemplateEditor — a custom page template, edited like a page: a name and a full body.
 *
 * Same schema and the same look as a page body, so what is written here is exactly what a new
 * page starts with. Not BlockEditor: that one persists into `blocks` rows for a page or a card,
 * while a template is one `page_templates` row whose body is a single JSON string. No AI, no
 * template row and no comments: a template is a starting point, not a document of its own.
 *
 * The persistence loop follows BlockEditor's: hydrate once, save on change (debounced), flush
 * on unmount, and stash a draft when the tab is hidden so a reload mid-edit loses nothing.
 */
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

import type { PartialBlock } from "@blocknote/core";
import { BlockNoteView } from "@blocknote/mantine";
import { useCreateBlockNote } from "@blocknote/react";
import { useQuery } from "@powersync/react";
import { useCallback, useEffect, useRef, useState } from "react";

import { clearDraft, draftKey, onPageHidden, readDraft, writeDraft } from "../../lib/drafts";
import {
  loadTemplate,
  renameTemplate,
  saveTemplateBlocks,
  TEMPLATE_UNTITLED,
  TemplateTooLargeError,
} from "../../lib/templates";
import { useHiddenIds } from "../../stores/pending-delete";
import { useThemeStore } from "../../stores/theme";
import { Spinner } from "../ui/spinner";
import { schema } from "./schema";

const SAVE_DEBOUNCE_MS = 500;

type Loaded = { name: string; blocks: PartialBlock[] } | "missing";

/** Keyed by `templateId` in the router, so one instance only ever shows one template. */
export function TemplateEditor({ templateId }: { templateId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  // Deleted in Personalization and waiting on Undo: an edit here would be written into a
  // template about to vanish.
  const pendingDelete = useHiddenIds().has(templateId);
  // A deep link on a device that has not synced yet reads "missing" first. Watching for the
  // row lets the editor load once it arrives, instead of saying "not found" for good.
  const { data: present } = useQuery<{ id: string }>("SELECT id FROM page_templates WHERE id = ?", [
    templateId,
  ]);
  const arrived = present.length > 0;

  // Hydrate once (never reactively, which would fight BlockNote), plus once more if the row
  // turns up after a "missing".
  useEffect(() => {
    if (loaded !== null && !(loaded === "missing" && arrived)) return;
    let cancelled = false;
    void loadTemplate(templateId)
      .then((template) => {
        if (!cancelled) setLoaded(template ?? "missing");
      })
      .catch(() => {
        if (!cancelled) setLoaded("missing");
      });
    return () => {
      cancelled = true;
    };
  }, [templateId, loaded, arrived]);

  if (pendingDelete) return <Notice>Template deleted.</Notice>;
  if (loaded === null) {
    return (
      <div className="flex h-full items-center justify-center">
        <Spinner label="Loading template…" />
      </div>
    );
  }
  if (loaded === "missing") return <Notice>Template not found.</Notice>;

  return (
    <div
      className="tendto-page-column ml-10 min-h-full max-w-3xl py-10"
      data-testid="template-editor"
    >
      <p className="mb-1 text-xs font-medium uppercase tracking-wide text-subtle">Template</p>
      <TemplateName key={`name:${templateId}`} templateId={templateId} initial={loaded.name} />
      <TemplateBody key={`body:${templateId}`} templateId={templateId} initial={loaded.blocks} />
    </div>
  );
}

function Notice({ children }: { children: string }) {
  return (
    <div className="flex h-full items-center justify-center">
      <p className="text-sm text-subtle">{children}</p>
    </div>
  );
}

/**
 * The template's name. Saved debounced, on unmount, and stashed when the tab is hidden.
 *
 * Compared against the last name SAVED, not the one loaded: renaming "A" to "B" and back to
 * "A" must write "A" again. A draft is stashed only while the name differs from what is saved,
 * and cleared once it no longer does, so a stale draft can never replay over a rename made on
 * another device.
 */
function TemplateName({ templateId, initial }: { templateId: string; initial: string }) {
  const key = draftKey("template-name", templateId);
  const [name, setName] = useState(() => {
    const draft = readDraft<unknown>(key);
    return typeof draft === "string" ? draft : initial;
  });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef(name);
  latest.current = name;
  const saved = useRef(initial.trim());

  const commit = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    const next = latest.current.trim();
    if (next === saved.current) {
      clearDraft(key);
      return;
    }
    const previous = saved.current;
    saved.current = next;
    void renameTemplate(templateId, next).then(
      () => {
        if (latest.current.trim() === saved.current) clearDraft(key);
      },
      () => {
        // Failed write: the next commit tries again, and the draft stays as the backstop.
        saved.current = previous;
      },
    );
  }, [templateId, key]);

  useEffect(() => {
    if (readDraft<unknown>(key) !== null) commit();
    return commit;
  }, [commit, key]);

  useEffect(
    () =>
      onPageHidden(() => {
        if (latest.current.trim() !== saved.current) writeDraft(key, latest.current);
        commit();
      }),
    [commit, key],
  );

  return (
    <input
      value={name}
      onChange={(event) => {
        setName(event.target.value);
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(commit, SAVE_DEBOUNCE_MS);
      }}
      placeholder={TEMPLATE_UNTITLED}
      aria-label="Template name"
      data-testid="template-name"
      className="mb-3 w-full bg-transparent text-3xl font-bold text-fg outline-none placeholder:text-subtle"
    />
  );
}

/** The template's body: the page editor's schema, saved whole into one row. */
function TemplateBody({ templateId, initial }: { templateId: string; initial: PartialBlock[] }) {
  const theme = useThemeStore((s) => s.resolved);
  const key = draftKey("template", templateId);
  // Read once. Anything stored that is not a block list is ignored rather than trusted: a
  // corrupt draft must not be "recovered" as a blank body over the saved one.
  const [draft] = useState(() => {
    const stored = readDraft<unknown>(key);
    return Array.isArray(stored) && stored.length > 0 ? (stored as PartialBlock[]) : null;
  });
  const recovered = useRef(draft);
  const [initialContent] = useState(() => {
    const blocks = draft ?? initial;
    return blocks.length > 0 ? blocks : undefined;
  });
  const editor = useCreateBlockNote({ schema, initialContent });

  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(false);
  // Set only when it changes, so the editor re-renders once per crossing of the limit.
  const [tooLarge, setTooLarge] = useState(false);

  const flush = useCallback(() => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (!dirty.current) return;
    dirty.current = false;
    void saveTemplateBlocks(templateId, editor.document).then(
      // Not while newer edits wait: their draft, stashed meanwhile, is still the backstop.
      () => {
        setTooLarge(false);
        if (!dirty.current) clearDraft(key);
      },
      (error: unknown) => {
        // Failed write: the content is still in the editor, so it is still unsaved. The next
        // edit saves again, which is how removing an image clears the warning.
        dirty.current = true;
        if (error instanceof TemplateTooLargeError) setTooLarge(true);
      },
    );
  }, [editor, templateId, key]);

  useEffect(() => flush, [flush]);

  useEffect(
    () =>
      onPageHidden(() => {
        if (dirty.current) writeDraft(key, editor.document);
        flush();
      }),
    [flush, editor, key],
  );

  // A draft recovered from a session torn down mid-edit is written through now.
  useEffect(() => {
    if (!recovered.current) return;
    recovered.current = null;
    dirty.current = true;
    flush();
  }, [flush]);

  const handleChange = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
  }, [flush]);

  return (
    <div className="tendto-page-editor">
      {tooLarge ? (
        <p role="alert" data-testid="template-too-large" className="mb-2 text-xs text-danger">
          Template too large. Not saved until images are removed.
        </p>
      ) : null}
      <BlockNoteView editor={editor} onChange={handleChange} theme={theme} />
    </div>
  );
}
