/**
 * The Templates section of Personalization: every page template, Notion-style, built-ins too.
 *
 * A template is made blank ("New template", named first, then opened in the template editor)
 * or copied from the open page ("Save page as template"). A name opens it for editing; × deletes
 * it with Undo, like a sidebar row. A built-in works the same way: editing one saves the user's
 * own copy of it, and deleting one hides it, which "Restore built-in templates" undoes for good.
 *
 * Unlike the rest of Personalization, nothing here waits for Save. A template is content, synced
 * to every device the user signs in on, and each action writes at once, as a sidebar action
 * does. Save and Cancel govern only the look.
 */
import { useQuery } from "@powersync/react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useRef, useState } from "react";

import { useSession } from "../../lib/auth/client";
import {
  builtinById,
  createBuiltinCopy,
  createTemplate,
  createTemplateFromPage,
  deleteTemplate,
  hideBuiltin,
  restoreBuiltins,
  TEMPLATE_UNTITLED,
  TemplateTooLargeError,
  useTemplateList,
  type TemplateEntry,
} from "../../lib/templates";
import { useHiddenIds, usePendingDelete } from "../../stores/pending-delete";
import { idFromPath } from "./sidebar-tree";

export function TemplateSettings({ onOpen }: { onOpen: (templateId: string) => void }) {
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const { data: session } = useSession();
  const userId = session?.user?.id ?? null;
  const hidden = useHiddenIds();
  const schedule = usePendingDelete((state) => state.schedule);
  const { entries, hiddenBuiltins } = useTemplateList();
  const templates = entries.filter((entry) => !hidden.has(entry.key));
  const [naming, setNaming] = useState(false);
  // One write per click, so a double click is not two copies of a built-in.
  const [opening, setOpening] = useState(false);
  // One copy per click: the button waits for the write, so a double click is not two templates.
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);

  // "Save page as template" needs an open page with a body: not a folder, not another view.
  const openPageId = idFromPath(pathname, "p");
  const { data: openPage } = useQuery<{ kind: string | null }>(
    "SELECT kind FROM pages WHERE id = ?",
    [openPageId ?? ""],
  );
  const canCopyPage = openPage.length > 0 && openPage[0]?.kind !== "folder";
  const openTemplateId = idFromPath(pathname, "t");

  async function handleCreate(name: string, byKey: boolean): Promise<void> {
    setNaming(false);
    const trimmed = name.trim();
    // Enter creates, even unnamed (the editor's name field takes the name later). Focus
    // leaving an empty field creates nothing.
    if (!trimmed && !byKey) return;
    try {
      const id = await createTemplate(userId, trimmed);
      if (byKey) onOpen(id);
    } catch {
      // The write failed: open the field again rather than drop the name without a trace.
      setNaming(true);
    }
  }

  async function handleCopyPage(pageId: string): Promise<void> {
    setCopying(true);
    setCopyError(null);
    try {
      await createTemplateFromPage(userId, pageId);
    } catch (error: unknown) {
      // Nothing was written; the button is back for another try.
      setCopyError(
        error instanceof TemplateTooLargeError ? error.message : "Template not saved. Retry.",
      );
    } finally {
      setCopying(false);
    }
  }

  /** Open a template in the editor. An untouched built-in becomes the user's copy first. */
  async function handleOpen(entry: TemplateEntry): Promise<void> {
    if (entry.kind === "stored") {
      onOpen(entry.id);
      return;
    }
    if (opening) return;
    setOpening(true);
    try {
      onOpen(await createBuiltinCopy(userId, entry.template));
    } catch {
      // Nothing was written; the name is still there to click again.
    } finally {
      setOpening(false);
    }
  }

  function handleDelete(entry: TemplateEntry): void {
    const builtin = entry.kind === "builtin" ? entry.template : builtinById(entry.builtinId);
    const wasOpen = entry.kind === "stored" && openTemplateId === entry.id;
    schedule({
      label: `Template "${entry.label}" deleted.`,
      ids: [entry.key],
      // A built-in is hidden, so it stays gone on every device; a custom one is deleted.
      commit: () =>
        builtin
          ? hideBuiltin(userId, builtin)
          : entry.kind === "stored"
            ? deleteTemplate(entry.id)
            : Promise.resolve(),
      restore:
        wasOpen && entry.kind === "stored"
          ? () => void navigate({ to: "/t/$templateId", params: { templateId: entry.id } })
          : undefined,
    });
    if (wasOpen) void navigate({ to: "/" });
  }

  return (
    <div data-testid="template-settings" className="space-y-2">
      {templates.length === 0 && !naming ? (
        <p className="text-sm text-subtle">No templates yet.</p>
      ) : (
        <ul className="space-y-0.5">
          {templates.map((entry) => (
            <li key={entry.key} className="group flex items-center gap-1">
              <button
                type="button"
                onClick={() => void handleOpen(entry)}
                title="Edit template"
                className="flex-1 truncate rounded px-2 py-1 text-left text-sm text-fg hover:bg-hover"
              >
                {entry.label}
              </button>
              <button
                type="button"
                onClick={() => handleDelete(entry)}
                aria-label={`Delete template ${entry.label}`}
                title="Delete template"
                className="shrink-0 rounded px-1.5 text-subtle hover:text-danger"
              >
                ×
              </button>
            </li>
          ))}
          {naming ? (
            <li>
              <NameField
                onCommit={(name, byKey) => void handleCreate(name, byKey)}
                onCancel={() => setNaming(false)}
              />
            </li>
          ) : null}
        </ul>
      )}

      <div className="flex flex-wrap gap-1">
        <SmallButton onClick={() => setNaming(true)} disabled={naming}>
          New template
        </SmallButton>
        {canCopyPage && openPageId ? (
          <SmallButton onClick={() => void handleCopyPage(openPageId)} disabled={copying}>
            Save page as template
          </SmallButton>
        ) : null}
        {hiddenBuiltins > 0 ? (
          <SmallButton onClick={() => void restoreBuiltins().catch(() => undefined)}>
            Restore built-in templates
          </SmallButton>
        ) : null}
      </div>
      {copyError ? (
        <p role="alert" className="text-xs text-danger">
          {copyError}
        </p>
      ) : null}
    </div>
  );
}

function SmallButton({
  onClick,
  disabled,
  children,
}: {
  onClick: () => void;
  disabled?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="rounded border border-line px-2 py-1 text-xs text-muted hover:bg-hover hover:text-fg disabled:opacity-50"
    >
      {children}
    </button>
  );
}

/**
 * A new template's name. Enter commits, Escape cancels, focus leaving commits. Settles exactly
 * once, like the sidebar's name field: Enter unmounts it, and that unmount's blur must not
 * commit a second time.
 */
function NameField({
  onCommit,
  onCancel,
}: {
  onCommit: (value: string, byKey: boolean) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState("");
  const settled = useRef(false);

  function settle(commit: boolean, byKey: boolean): void {
    if (settled.current) return;
    settled.current = true;
    if (commit) onCommit(value, byKey);
    else onCancel();
  }

  return (
    <input
      autoFocus
      value={value}
      aria-label="Template name"
      placeholder={TEMPLATE_UNTITLED}
      onChange={(event) => setValue(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          settle(true, true);
        } else if (event.key === "Escape") {
          // Cancels the name only. Without this the dialog's own Escape would close it too.
          event.preventDefault();
          event.stopPropagation();
          settle(false, true);
        }
      }}
      onBlur={() => settle(true, false)}
      className="w-full rounded border border-line bg-app px-2 py-1 text-sm text-fg outline-none placeholder:text-subtle focus:border-muted"
    />
  );
}
