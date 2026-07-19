/**
 * Task detail modal — the view-agnostic editor for one item (a Trello-style card back). It edits
 * the SAME item that board / table / list / checklist all project, so a change here shows in every
 * view. Fields: title, status, due date, assignees (workspace members, multi-select), description.
 * All writes go through patchItem (whole-bag merge → local replica → sync).
 */
import { useEffect, useRef, useState } from "react";

import {
  deleteItem,
  parseProperties,
  patchItem,
  type Column,
  type ItemRow,
} from "../../lib/items/mutations";
import { memberInitials, memberLabel, type MemberInfo } from "../../lib/workspaces";
import { useUiStore } from "../../stores/ui";
import type { WorkspaceMembers } from "../../stores/members";
import { Icon } from "../ui/icon";
import { Modal } from "../ui/modal";

interface TaskDetailModalProps {
  row: ItemRow;
  columns: Column[];
  members: WorkspaceMembers;
  onClose: () => void;
}

export function TaskDetailModal({ row, columns, members, onClose }: TaskDetailModalProps) {
  const props = parseProperties(row);
  const assignees = props.assignees ?? [];
  const setShareOpen = useUiStore((s) => s.setShareOpen);
  const [assigning, setAssigning] = useState(false);

  // Free-text fields are edited in LOCAL state for smooth typing (initialized once on mount), then
  // persisted debounced — never driven by the async replica round-trip, which would revert the
  // input mid-keystroke. Status / due / assignees are discrete, so they write directly.
  const [title, setTitle] = useState(props.title);
  const [description, setDescription] = useState(props.description ?? "");
  const latest = useRef({ title, description });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function saveText(next: { title?: string; description?: string }): void {
    latest.current = { ...latest.current, ...next };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      void patchItem(row, { ...latest.current });
    }, 350);
  }
  // Flush any pending text edit when the modal closes/unmounts.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      void patchItem(row, { ...latest.current });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function toggleAssignee(userId: string): void {
    const next = assignees.includes(userId)
      ? assignees.filter((id) => id !== userId)
      : [...assignees, userId];
    void patchItem(row, { assignees: next });
  }

  // Resolve to members; fall back to an id-only stub so an assignee chip shows immediately (before
  // the member list loads, or offline) rather than vanishing.
  const assigned: MemberInfo[] = assignees.map(
    (id) => members.byId.get(id) ?? { user_id: id, role: "" },
  );
  const soloWorkspace = members.members.length <= 1;

  return (
    <Modal width={540} labelledBy="task-title" onClose={onClose}>
      <div className="flex items-start gap-2 border-b border-hairline px-6 py-4">
        <input
          id="task-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            saveText({ title: e.target.value });
          }}
          placeholder="Untitled task"
          aria-label="Task title"
          className="min-w-0 flex-1 bg-transparent text-lg font-semibold text-ink outline-none placeholder:text-muted"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-row text-muted hover:bg-row-hover hover:text-ink"
        >
          <Icon name="close" size={16} />
        </button>
      </div>

      <div className="max-h-[68vh] space-y-5 overflow-y-auto px-6 py-5">
        {/* Status */}
        <Field label="Status">
          <div className="flex flex-wrap gap-1.5">
            {columns.map((column) => {
              const active = props.status === column.id;
              return (
                <button
                  key={column.id}
                  type="button"
                  onClick={() => void patchItem(row, { status: column.id })}
                  className={
                    "rounded-pill px-3 py-1 text-[12px] " +
                    (active
                      ? "bg-accent-soft font-medium text-accent-soft-text"
                      : "bg-chip text-secondary hover:text-ink")
                  }
                >
                  {column.label || "Untitled"}
                </button>
              );
            })}
          </div>
        </Field>

        <div className="flex flex-wrap gap-6">
          {/* Due date */}
          <Field label="Due date">
            <input
              type="date"
              value={props.due ?? ""}
              onChange={(e) => void patchItem(row, { due: e.target.value })}
              aria-label="Due date"
              className="rounded-input border border-border-soft bg-canvas px-2.5 py-1.5 text-[13px] text-body outline-none focus:border-accent"
            />
          </Field>

          {/* Assignees */}
          <Field label="Assignees">
            <div className="flex flex-wrap items-center gap-1.5">
              {assigned.map((m) => (
                <button
                  key={m.user_id}
                  type="button"
                  data-testid="assignee-chip"
                  onClick={() => toggleAssignee(m.user_id)}
                  title={`Unassign ${memberLabel(m)}`}
                  className="flex items-center gap-1.5 rounded-pill bg-accent-soft py-1 pl-1 pr-2.5 text-[12px] text-accent-soft-text hover:bg-accent-soft-strong"
                >
                  <Avatar member={m} />
                  <span className="max-w-[120px] truncate">{memberLabel(m)}</span>
                </button>
              ))}
              <button
                type="button"
                onClick={() => setAssigning((v) => !v)}
                aria-label="Assign members"
                className="flex h-7 w-7 items-center justify-center rounded-full border border-dashed border-border-hover text-muted hover:text-ink"
              >
                <Icon name="plus" size={14} />
              </button>
            </div>

            {assigning ? (
              <div className="mt-2 w-64 overflow-hidden rounded-card border border-hairline-strong bg-surface p-1 shadow-menu">
                {members.members.map((m) => {
                  const on = assignees.includes(m.user_id);
                  return (
                    <button
                      key={m.user_id}
                      type="button"
                      data-testid="member-option"
                      onClick={() => toggleAssignee(m.user_id)}
                      className="flex w-full items-center gap-2 rounded-row px-2 py-1.5 text-left text-[13px] text-body row-hover"
                    >
                      <Avatar member={m} />
                      <span className="min-w-0 flex-1 truncate">{memberLabel(m)}</span>
                      {on ? (
                        <Icon name="check" size={13} className="shrink-0 text-accent-soft-text" />
                      ) : null}
                    </button>
                  );
                })}
                {soloWorkspace ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShareOpen(true);
                      onClose();
                    }}
                    className="mt-1 flex w-full items-center gap-2 rounded-row px-2 py-1.5 text-left text-[12.5px] text-accent-soft-text hover:bg-accent-soft"
                  >
                    <Icon name="share" size={13} />
                    Invite teammates to assign
                  </button>
                ) : null}
              </div>
            ) : null}
          </Field>
        </div>

        {/* Description */}
        <Field label="Description">
          <textarea
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              saveText({ description: e.target.value });
            }}
            placeholder="Add more detail, links, acceptance criteria…"
            rows={5}
            aria-label="Task description"
            className="w-full resize-y rounded-input border border-border-soft bg-canvas px-3 py-2 text-[13.5px] leading-[1.6] text-body outline-none placeholder:text-muted focus:border-accent"
          />
        </Field>
      </div>

      <div className="flex items-center justify-between border-t border-hairline px-6 py-3">
        <button
          type="button"
          onClick={() => {
            if (window.confirm("Delete this task?")) {
              void deleteItem(row.id);
              onClose();
            }
          }}
          className="rounded-row px-2 py-1 text-[12.5px] text-muted hover:text-overdue"
        >
          Delete task
        </button>
        <span className="text-[11.5px] text-faint">Changes save automatically · Esc to close</span>
      </div>
    </Modal>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-faint">
        {label}
      </div>
      {children}
    </div>
  );
}

function Avatar({ member }: { member: import("../../lib/workspaces").MemberInfo }) {
  return (
    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-accent text-[10px] font-semibold text-accent-contrast">
      {memberInitials(member)}
    </span>
  );
}
