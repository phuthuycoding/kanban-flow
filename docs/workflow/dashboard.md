# Dashboard metrics and charts

Run `kf dashboard` and open `http://localhost:8787`. Change the port with `--port`. The dashboard refreshes every 5 seconds, has a manual refresh button and filters by context and by work item kind.

## KPI

| Metric | How it is computed |
|---|---|
| Work items | Every feature and bug matching the filter, `dones` included |
| In execution | Items in `implementation`, `testing` or `review` |
| Backlog | Items in `backlog` |
| Completed | Items in `dones`; the rate is dones divided by total items |
| Task progress | Completed checkboxes divided by all checkboxes across the items in execution |

With no items or no tasks to divide by, the figure shows as `—`. An item in execution with no task checkboxes is counted separately and never defaults to done. Task progress is not a test pass rate and not code coverage.

## Charts

- Bars by stage: the total per state and the feature/bug split within it.
- Feature and bug donut: the share of each work item kind under the current filter.
- Bars by context: item volume across contexts, ordered by total, largest first.
- Approval bars: pending, approved and changed for items from planning through review, backlog included; brainstorm and dones are left out.
- Task progress bar: tasks done, items that have tasks and items that do not, across the stages in execution.

The charts show the filesystem as it is right now. The workflow keeps no history of stage transitions, so the dashboard infers no throughput, no lead time and no trend over time from these counts.

## CLI and API

`kf view` prints the same summary in the terminal. `kf view --json` and `/api/data` return `metrics`, `charts`, `availableContexts` and `stages`, so existing agents and tools can still read it.

The API takes `?kind=feature|bug&context=<slug>`. Drop a parameter to see everything. `context=__none__` selects older items that carry no context. The context list behind the filter is always drawn from the whole project.

When the API fails, the dashboard says so and keeps the previous snapshot with a warning that the numbers may be stale. It never turns an error into a zero.
