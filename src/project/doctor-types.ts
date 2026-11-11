export interface DoctorFinding {
  level: "ERROR" | "WARNING";
  area: string;
  message: string;
  /** A command the user runs themselves. Doctor never fixes anything. */
  action?: string;
}

export interface DoctorReport {
  root: string;
  findings: DoctorFinding[];
  invalidItems: number;
  totalItems: number;
  /** Legacy feature names per declared context still on disk (FR-016); empty when none. */
  legacyDocs: Record<string, string[]>;
  ok: boolean;
}

export interface DoctorFixResult {
  fixed: string[];
  /** Rewrites that failed; the caller reports them as ERROR findings, so the run exits non-zero. */
  failures: DoctorFinding[];
}
