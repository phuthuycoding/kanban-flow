import type { ConfigLayer } from "./config-layers.js";

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
  /** The global and workspace files that exist; the project file is not listed. */
  configLayers: { layer: ConfigLayer; path: string }[];
  ok: boolean;
}

export interface DoctorFixResult {
  fixed: string[];
  /** Rewrites that failed; the caller reports them as ERROR findings, so the run exits non-zero. */
  failures: DoctorFinding[];
}
