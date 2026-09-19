import type { Stage } from "./schema.js";
import type { Feature } from "./features.js";

export type Severity = "ERROR" | "WARNING" | "INFO";

export interface Finding {
  severity: Severity;
  feature: string;
  stage: Stage;
  file: string;
  code: string;
  message: string;
}

export interface ValidationResult {
  feature: string;
  stage: Stage;
  valid: boolean;
  issues: Finding[];
}

export function finding(feature: Feature, severity: Severity, file: string, code: string, message: string): Finding {
  return { severity, feature: feature.name, stage: feature.stage, file, code, message };
}
