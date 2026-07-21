import { useEffect, useState } from "react";
import type { PurchaseOrder } from "../types";
import type { WorkflowCompany } from "../workflows";
import {
  getWorkflow,
  resolvePipelineStatus,
  isSubstageComplete,
  isGroupComplete,
  pipelineProgressPercent,
  getActiveWorkflowGroups,
  getSubstageLabel,
  EXCEPTION_STATUSES,
} from "../workflows";
import { stageIsEditable } from "../stageMilestones";

interface Props {
  company: WorkflowCompany;
  status: string;
  po: PurchaseOrder;
  /** Compact strip for overview — progress bar + current step only */
  compact?: boolean;
  /** When set, steps are clickable to edit milestone fields */
  onSelectStage?: (stageId: string) => void;
  canEditStages?: boolean;
}

function CheckIcon() {
  return (
    <svg className="pipeline-timeline-icon" viewBox="0 0 16 16" fill="none" aria-hidden>
      <path
        d="M3.5 8.5L6.5 11.5L12.5 4.5"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function DotIcon({ active }: { active?: boolean }) {
  return (
    <span
      className={`pipeline-timeline-dot${active ? " pipeline-timeline-dot-active" : ""}`}
      aria-hidden
    />
  );
}

export default function PipelineProgress({
  company,
  status,
  po,
  compact = false,
  onSelectStage,
  canEditStages = false,
}: Props) {
  const resolved = resolvePipelineStatus(status);
  const isException = (EXCEPTION_STATUSES as readonly string[]).includes(status);
  const workflow = getWorkflow(company);
  const poRec = po as unknown as Record<string, unknown>;
  const percent = pipelineProgressPercent(company, poRec);
  const activeGroups = getActiveWorkflowGroups(company, poRec);
  const activeGroupIds = new Set(activeGroups.map((g) => g.id));
  const activeLabel = activeGroups.map((g) => g.label).join(" · ") || getSubstageLabel(company, resolved);
  const editable = canEditStages && !!onSelectStage;

  const [openIds, setOpenIds] = useState<Set<string>>(() => new Set(activeGroupIds));

  useEffect(() => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      for (const g of activeGroups) next.add(g.id);
      return next;
    });
  }, [po.id, status]);

  const toggleGroup = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectStage = (stageId: string) => {
    if (!editable || !stageIsEditable(stageId)) return;
    onSelectStage?.(stageId);
  };

  if (compact) {
    return (
      <div className="pipeline-panel pipeline-panel-compact">
        {isException && (
          <div className="pipeline-exception">Exception: {status}</div>
        )}
        <div className="pipeline-panel-head">
          <div>
            <div className="pipeline-panel-label">Current step</div>
            <div className="pipeline-panel-status">{getSubstageLabel(company, resolved)}</div>
            {activeGroups.length > 0 && (
              <div className="pipeline-panel-hint">{activeLabel}</div>
            )}
          </div>
          <div className="pipeline-panel-pct">{percent}%</div>
        </div>
        <div className="pipeline-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
          <div className="pipeline-progress-fill" style={{ width: `${percent}%` }} />
        </div>
      </div>
    );
  }

  return (
    <div className="pipeline-panel">
      {isException && (
        <div className="pipeline-exception">Exception: {status}</div>
      )}

      <div className="pipeline-panel-head">
        <div>
          <div className="pipeline-panel-label">Order progress</div>
          <div className="pipeline-panel-status">{getSubstageLabel(company, resolved)}</div>
          {editable && (
            <div className="pipeline-panel-hint">Click a step to add or clear details</div>
          )}
        </div>
        <div className="pipeline-panel-pct">{percent}%</div>
      </div>

      <div className="pipeline-progress-track" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className="pipeline-progress-fill" style={{ width: `${percent}%` }} />
      </div>

      <ol className="pipeline-timeline">
        {workflow.map((group, gi) => {
          const complete = isGroupComplete(poRec, group);
          const isActive = activeGroupIds.has(group.id);
          const doneCount = group.substages.filter((s) => isSubstageComplete(poRec, s.id)).length;
          const hasSubstages = group.substages.length > 1;
          const isOpen = hasSubstages && (openIds.has(group.id) || isActive);
          const singleStage = !hasSubstages ? group.substages[0] : null;
          const singleEditable = !!singleStage && editable && stageIsEditable(singleStage.id);

          return (
            <li
              key={group.id}
              className={`pipeline-timeline-item pipeline-timeline-${complete ? "done" : isActive ? "active" : "future"}`}
            >
              <div className="pipeline-timeline-rail">
                {complete ? <CheckIcon /> : <DotIcon active={isActive} />}
                {gi < workflow.length - 1 && <span className="pipeline-timeline-line" />}
              </div>

              <div className="pipeline-timeline-body">
                {hasSubstages ? (
                  <button
                    type="button"
                    className="pipeline-timeline-row pipeline-timeline-toggle"
                    aria-expanded={isOpen}
                    onClick={() => toggleGroup(group.id)}
                  >
                    <span className="pipeline-timeline-title">{group.label}</span>
                    <span className="pipeline-timeline-meta">
                      {doneCount}/{group.substages.length}
                      <span className="pipeline-timeline-chevron" aria-hidden>
                        {isOpen ? "▾" : "▸"}
                      </span>
                    </span>
                  </button>
                ) : singleEditable ? (
                  <button
                    type="button"
                    className="pipeline-timeline-row pipeline-timeline-toggle pipeline-timeline-step-btn"
                    onClick={() => selectStage(singleStage!.id)}
                    title="Edit this step"
                  >
                    <span className="pipeline-timeline-title">{group.label}</span>
                    <span className="pipeline-timeline-meta">Edit</span>
                  </button>
                ) : (
                  <div className="pipeline-timeline-row">
                    <span className="pipeline-timeline-title">{group.label}</span>
                  </div>
                )}

                {isOpen && (
                  <ul className="pipeline-checklist">
                    {group.substages.map((sub) => {
                      const done = isSubstageComplete(poRec, sub.id);
                      const current = sub.id === resolved;
                      const canClick = editable && stageIsEditable(sub.id);
                      const cls = `pipeline-checklist-item${done ? " is-done" : ""}${current ? " is-current" : ""}${canClick ? " is-clickable" : ""}`;
                      if (canClick) {
                        return (
                          <li key={sub.id}>
                            <button
                              type="button"
                              className={cls}
                              onClick={() => selectStage(sub.id)}
                              title="Edit this step"
                            >
                              <span className="pipeline-checklist-mark">{done ? "✓" : current ? "→" : "○"}</span>
                              <span className="pipeline-checklist-text">{sub.label}</span>
                            </button>
                          </li>
                        );
                      }
                      return (
                        <li key={sub.id} className={cls}>
                          <span className="pipeline-checklist-mark">{done ? "✓" : current ? "→" : "○"}</span>
                          <span className="pipeline-checklist-text">{sub.label}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
