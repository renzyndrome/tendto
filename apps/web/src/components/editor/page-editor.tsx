/**
 * PageEditor — BlockNote wired to the local replica.
 *
 * Phase-0 skeleton. The real wiring:
 *  - load block rows for `pageId` from the replica (useQuery from @powersync/react)
 *  - hydrate BlockNote's document from them
 *  - onChange (debounced ~500ms): diff → upsert changed block rows into the local db;
 *    PowerSync queues + uploads them via the connector automatically.
 * No network code belongs in this component.
 */
import "@blocknote/core/fonts/inter.css";
import { useCreateBlockNote } from "@blocknote/react";

interface PageEditorProps {
  pageId: string;
}

export function PageEditor({ pageId }: PageEditorProps) {
  const editor = useCreateBlockNote();

  // TODO(phase-0): hydrate from replica + persist on change (see header comment).
  void pageId;
  void editor;

  return (
    <div className="mx-auto max-w-3xl p-6">
      <p className="text-sm text-gray-400">
        Editor placeholder — wire BlockNote ⇄ replica here (Phase 0).
      </p>
    </div>
  );
}
