import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

import { STAGES, PHASE_NAMES, STAGE_INDEX, type WorkItemKind } from "../workflow/schema.js";
import { listFeatures } from "../workflow/features.js";
import { computeStatus, renderStatusText, approvalState } from "../workflow/status.js";
import { readProjectConfig } from "../project/config.js";
import { findWorksRoot } from "../workflow/features.js";
import type { CmdResult } from "../cli/result.js";
import { renderDashboardHtml } from "./dashboard-view.js";

export { renderDashboardHtml };

export const DEFAULT_PORT = 8787;

export interface DashboardFilters {
  context?: string | null;
  kind?: WorkItemKind;
}

function percentage(done: number, total: number): number | null {
  return total === 0 ? null : Math.round(100 * done / total);
}

export function dashboardData(root: string, filters: DashboardFilters = {}) {
  const config = readProjectConfig(root);
  const allFeatures = listFeatures(root);
  const features = allFeatures.filter((feature) =>
    (filters.context === undefined || feature.context === filters.context)
    && (filters.kind === undefined || (feature.meta?.kind ?? "feature") === filters.kind));
  const snapshot = {
    root,
    context: config.defaultContext ?? null,
    updatedAt: new Date().toISOString(),
    stages: STAGES.map((stage) => {
      const stageFeatures = features
        .filter((f) => f.stage === stage)
        .map((f) => {
          const st = computeStatus(f);
          return {
            name: st.feature.name,
            kind: st.feature.meta?.kind ?? "feature",
            context: st.feature.context,
            folder: st.feature.folder,
            stage,
            stageIndex: STAGE_INDEX[stage],
            artifacts: st.artifacts.map((a) => ({
              id: a.id,
              file: a.file,
              status: a.status,
              due: a.due,
              note: a.note,
              shortFile: a.file.replace(/^phase-\d-/, ""),
            })),
            doneCount: st.doneCount,
            dueCount: st.dueCount,
            totalCount: st.totalCount,
            next: st.next,
            taskProgress: st.taskProgress,
            approval: approvalState(f),
            bypasses: f.meta?.bypasses?.length ?? 0,
            text: renderStatusText(st),
          };
        });
      return {
        id: stage,
        name: PHASE_NAMES[stage],
        features: stageFeatures,
      };
    }),
  };
  const items = snapshot.stages.flatMap((stage) => stage.features);
  const executing = items.filter((item) => ["implementation", "testing", "review"].includes(item.stage));
  const completed = items.filter((item) => item.stage === "dones").length;
  const approvals = items.filter((item) => item.stage !== "brainstorm" && item.stage !== "dones");
  const taskDone = executing.reduce((sum, item) => sum + item.taskProgress.done, 0);
  const taskTotal = executing.reduce((sum, item) => sum + item.taskProgress.total, 0);
  const itemsTracked = executing.filter((item) => item.taskProgress.total > 0).length;
  const contexts = [...new Set(allFeatures.map((feature) => feature.context))]
    .sort((a, b) => (a ?? "").localeCompare(b ?? ""));
  return {
    ...snapshot,
    filters: { context: filters.context, kind: filters.kind ?? null },
    availableContexts: contexts.map((context) => ({ id: context, label: context ?? "Không xác định" })),
    metrics: {
      total: items.length,
      features: items.filter((item) => item.kind === "feature").length,
      bugs: items.filter((item) => item.kind === "bug").length,
      executing: executing.length,
      backlog: items.filter((item) => item.stage === "backlog").length,
      completed,
      completionRate: percentage(completed, items.length),
      bypassed: items.filter((item) => item.bypasses > 0).length,
      tasks: {
        done: taskDone,
        total: taskTotal,
        completionRate: percentage(taskDone, taskTotal),
        itemsTracked,
        itemsUntracked: executing.length - itemsTracked,
      },
    },
    charts: {
      byStage: snapshot.stages.map((stage) => ({
        id: stage.id, label: stage.id, count: stage.features.length,
        features: stage.features.filter((item) => item.kind === "feature").length,
        bugs: stage.features.filter((item) => item.kind === "bug").length,
      })),
      byKind: (["feature", "bug"] as const).map((kind) => ({
        id: kind, label: kind === "feature" ? "Feature" : "Bug",
        count: items.filter((item) => item.kind === kind).length,
      })),
      byContext: contexts.map((context) => {
        const contextItems = items.filter((item) => item.context === context);
        return {
          id: context, label: context ?? "Không xác định", count: contextItems.length,
          features: contextItems.filter((item) => item.kind === "feature").length,
          bugs: contextItems.filter((item) => item.kind === "bug").length,
        };
      }).filter((context) => context.count > 0).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)),
      approvals: (["pending", "approved", "changed"] as const).map((approval) => ({
        id: approval,
        label: { pending: "Chờ duyệt", approved: "Đã duyệt", changed: "Contract đã đổi" }[approval],
        count: approvals.filter((item) => item.approval === approval).length,
      })),
    },
  };
}

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body, null, 2));
}

/**
 * Start a local dashboard server. The listening server keeps the event loop
 * alive, so the CLI prints the URL then stays running until Ctrl+C.
 */
export async function cmdDashboard(port: number = DEFAULT_PORT): Promise<CmdResult> {
  const root = findWorksRoot(process.cwd());
  if (!root) {
    return { code: 1, stdout: "No .works found. Run: kf init", stderr: "no works" };
  }

  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      if (url.pathname === "/api/data") {
        const kind = url.searchParams.get("kind");
        if (kind !== null && kind !== "feature" && kind !== "bug") {
          json(res, 400, { error: "kind must be feature or bug" });
          return;
        }
        const context = url.searchParams.get("context");
        const filters: DashboardFilters = {
          kind: kind ?? undefined,
          context: context === "__none__" ? null : context ?? undefined,
        };
        try {
          json(res, 200, dashboardData(root, filters));
        } catch (err) {
          process.stderr.write(`Dashboard data failed: ${err instanceof Error ? err.stack : String(err)}\n`);
          json(res, 500, { error: "Unable to read dashboard metrics. Check the server output." });
        }
        return;
      }
      if (url.pathname === "/" || url.pathname === "/favicon.ico") {
        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(renderDashboardHtml());
        return;
      }
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
    } catch (err) {
      process.stderr.write(`Dashboard request failed: ${err instanceof Error ? err.stack : String(err)}\n`);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" });
      res.end("internal error");
    }
  });

  const url = `http://localhost:${port}`;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => resolve());
  });

  const shutdown = (): void => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  };
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);

  return {
    code: 0,
    stdout: `kaban-flow dashboard running at ${url}\n\nOpen ${url} in your browser. Press Ctrl+C to stop.`,
  };
}

export type { CmdResult };
