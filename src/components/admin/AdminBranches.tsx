import React from "react";
import { ClinicBranchesPanel, type ClinicBranch } from "../clinic/ClinicBranchesPanel";

/** Admin desk mount. Visibility is gated by admin nav — Super Admin never reaches this panel. */
export const AdminBranches: React.FC<{ onUseBranch?: (branch: ClinicBranch) => void }> = ({ onUseBranch }) => {
  return <ClinicBranchesPanel onUseBranch={onUseBranch} />;
};
