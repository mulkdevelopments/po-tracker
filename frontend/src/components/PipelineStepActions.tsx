import type { WorkflowCompany } from "../workflows";
import { getSubstageLabel } from "../workflows";

interface Props {
  company: WorkflowCompany;
  allowedStages: string[];
  renderAdvance: (props: {
    stage: string;
    compact: boolean;
    label: string;
  }) => React.ReactNode;
  renderProductionComplete: (stage: string) => React.ReactNode;
}

/** Single next-step action — pipeline is always sequential */
export default function PipelineStepActions({
  company,
  allowedStages,
  renderAdvance,
  renderProductionComplete,
}: Props) {
  const stage = allowedStages[0];
  if (!stage) return null;

  const label = getSubstageLabel(company, stage);

  return (
    <div className="pipeline-actions pipeline-actions-single">
      <div className="pipeline-actions-header">
        <span className="pipeline-actions-title">Next step</span>
        <span className="pipeline-actions-hint">{label}</span>
      </div>
      {stage === "Production Complete"
        ? renderProductionComplete(stage)
        : renderAdvance({ stage, compact: false, label })}
    </div>
  );
}
