/**
 * New-collection template picker. A collection isn't inherently a to-do board, so creation starts
 * from a template choice: Blank (a clean board you shape yourself), Task board (To do / In progress
 * / Done), or Checklist. Picking one creates the collection and opens it.
 */
import type { CollectionTemplate } from "../../lib/collections";
import { Icon, type IconName } from "../ui/icon";
import { Modal } from "../ui/modal";

interface TemplateOption {
  id: CollectionTemplate;
  icon: IconName;
  title: string;
  caption: string;
}

const OPTIONS: TemplateOption[] = [
  {
    id: "blank",
    icon: "board",
    title: "Blank board",
    caption: "One column to start — name your own stages.",
  },
  {
    id: "board",
    icon: "board",
    title: "Task board",
    caption: "To do · In progress · Done.",
  },
  {
    id: "checklist",
    icon: "list",
    title: "Checklist",
    caption: "A simple list you tick off.",
  },
];

interface NewCollectionModalProps {
  onPick: (template: CollectionTemplate) => void;
  onClose: () => void;
}

export function NewCollectionModal({ onPick, onClose }: NewCollectionModalProps) {
  return (
    <Modal width={420} labelledBy="new-collection-title" onClose={onClose}>
      <div className="px-6 pb-2 pt-5">
        <h2 id="new-collection-title" className="text-[15px] font-semibold text-ink">
          New collection
        </h2>
        <p className="mt-0.5 text-[12.5px] text-muted">Pick a starting point — you can change it anytime.</p>
      </div>
      <div className="flex flex-col gap-1.5 px-4 pb-5 pt-2">
        {OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => onPick(option.id)}
            className="flex items-center gap-3 rounded-card border border-hairline px-3.5 py-3 text-left hover:border-border-hover hover:bg-row-hover"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-input bg-accent-soft text-accent-soft-text">
              <Icon name={option.icon} size={17} />
            </span>
            <span className="min-w-0">
              <span className="block text-[13.5px] font-medium text-ink">{option.title}</span>
              <span className="block text-[12px] text-muted">{option.caption}</span>
            </span>
          </button>
        ))}
      </div>
    </Modal>
  );
}
