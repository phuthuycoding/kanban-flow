export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kanban-flow dashboard</title>
<style>
  :root { color-scheme: dark; --bg: #0b1120; --panel: #111c30; --border: #2b3a52;
    --text: #e8eef8; --muted: #a9b8ce; --feature: #22d3ee; --bug: #fbbf24; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 1280px; margin: auto; padding: 32px 24px; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  h1 { font-size: 26px; letter-spacing: -.04em; margin: 4px 0 6px; }
  h2 { font-size: 16px; margin: 0; }
  p { margin: 0; }
  .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--feature); }
  .muted, .caption { color: var(--muted); }
  .caption { font-size: 12px; margin-top: 6px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 24px 0; }
  label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
  select, button { font: inherit; min-height: 44px; border: 1px solid var(--border); border-radius: 8px;
    background: var(--panel); color: var(--text); padding: 8px 12px; }
  select { min-width: 180px; max-width: 100%; cursor: pointer; }
  button { cursor: pointer; }
  button:hover { border-color: var(--feature); }
  button:disabled { cursor: wait; opacity: .65; }
  select:focus-visible, button:focus-visible { outline: 2px solid var(--feature); outline-offset: 3px; }
  .updated { margin-left: auto; color: var(--muted); font-size: 12px; align-self: center; }
  #root { font-size: 12px; overflow-wrap: anywhere; margin-top: 12px; }
  #error { background: #452028; color: #fecdd3; border: 1px solid #a94a5a; border-radius: 8px; padding: 12px; margin-bottom: 20px; }
  [hidden] { display: none !important; }
  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi, .panel { background: var(--panel); border: 1px solid var(--border); border-radius: 12px; }
  .kpi { padding: 18px; }
  .kpi-label { color: var(--muted); font-size: 12px; }
  .kpi-value { font-size: 32px; font-weight: 650; letter-spacing: -.04em; margin: 6px 0; font-variant-numeric: tabular-nums; }
  .kpi-note { font-size: 11px; color: var(--muted); }
  .charts { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; }
  .panel { padding: 22px; min-width: 0; }
  .panel-heading { margin-bottom: 20px; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .feature { background: var(--feature); }
  .bug { background: var(--bug); }
  .bars { display: grid; gap: 15px; }
  .chart-row { display: grid; grid-template-columns: minmax(90px, 120px) minmax(0, 1fr) 36px; align-items: center; gap: 12px; }
  .chart-label { overflow-wrap: anywhere; font-size: 12px; }
  .track { display: flex; height: 12px; background: #26354c; border-radius: 4px; overflow: hidden; }
  .segment { display: block; height: 100%; }
  .chart-value { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }
  .scroll-chart { max-height: 340px; overflow: auto; padding-right: 4px; }
  .donut-layout { display: flex; align-items: center; gap: 24px; flex-wrap: wrap; }
  .donut { width: 180px; height: 180px; flex-shrink: 0; }
  .donut text { fill: var(--text); text-anchor: middle; }
  .donut-total { font-size: 28px; font-weight: 650; }
  .donut-label { font-size: 10px; fill: var(--muted) !important; }
  .kind-legend { display: grid; gap: 12px; flex: 1; min-width: 120px; }
  .kind-row { display: grid; grid-template-columns: 12px 1fr auto; align-items: center; gap: 8px; }
  .kind-row small { color: var(--muted); }
  .task-summary { margin-top: 28px; padding-top: 22px; border-top: 1px solid var(--border); }
  .task-line { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .empty { padding: 24px 0; color: var(--muted); text-align: center; }
  footer { margin-top: 24px; font-size: 12px; color: var(--muted); }
  @media (max-width: 1000px) { .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
  @media (max-width: 720px) {
    main { padding: 24px 16px; }
    header { display: block; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .charts { grid-template-columns: minmax(0, 1fr); }
    .toolbar label { flex: 1; min-width: 140px; }
    select { min-width: 0; width: 100%; }
    .updated { width: 100%; margin-left: 0; }
    .panel { padding: 18px; }
    .chart-row { grid-template-columns: 90px minmax(0, 1fr) 30px; gap: 8px; }
  }
</style>
</head>
<body>
<main>
  <header>
    <div><div class="eyebrow">kanban-flow / Analytics</div><h1>Workflow overview</h1>
      <p class="muted">Feature and bug counts, and how far execution has got.</p><p class="muted" id="root"></p></div>
    <button id="refresh" type="button">Refresh</button>
  </header>
  <div class="toolbar">
    <label>Context<select id="context"><option value="">All contexts</option></select></label>
    <label>Work item kind<select id="kind"><option value="">Features and bugs</option><option value="feature">Feature</option><option value="bug">Bug</option></select></label>
    <p class="updated">Updated <span id="ts">—</span> · refreshes every 5 seconds</p>
  </div>
  <div id="error" role="alert" hidden></div>
  <section class="kpis" id="kpis" aria-label="Summary metrics"><p class="muted">Loading metrics…</p></section>
  <div class="charts">
    <section class="panel" aria-labelledby="stages-title">
      <div class="panel-heading"><h2 id="stages-title">By stage</h2><p class="caption">How many work items sit in each stage right now.</p></div>
      <div class="legend"><span><i class="swatch feature"></i>Feature</span><span><i class="swatch bug"></i>Bug</span></div>
      <div class="bars" id="stage-chart"></div>
    </section>
    <section class="panel" aria-labelledby="kind-title">
      <div class="panel-heading"><h2 id="kind-title">Features and bugs</h2><p class="caption">The split under the current filter.</p></div>
      <div class="donut-layout" id="kind-chart"></div>
      <div class="task-summary" id="task-chart"></div>
    </section>
    <section class="panel" aria-labelledby="context-title">
      <div class="panel-heading"><h2 id="context-title">By context</h2><p class="caption">Feature and bug volume compared across contexts.</p></div>
      <div class="bars scroll-chart" id="context-chart"></div>
    </section>
    <section class="panel" aria-labelledby="approval-title">
      <div class="panel-heading"><h2 id="approval-title">Approval state</h2><p class="caption">Work items from planning through review, backlog included.</p></div>
      <div class="bars" id="approval-chart"></div>
    </section>
  </div>
  <footer>These numbers are a snapshot of .works/. Task progress counts only items in implementation, testing and review that have a tasks.md. It is not a test pass rate or coverage.</footer>
</main>
<script>
const $ = (selector) => document.querySelector(selector);
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const percent = (value) => value === null ? '—' : value + '%';
const colors = { feature: '#22d3ee', bug: '#fbbf24', pending: '#a9b8ce', approved: '#4ade80', changed: '#fb7185' };
function bars(rows, stacked) {
  const maximum = Math.max(1, ...rows.map((row) => row.count));
  return rows.map((row) => {
    const label = stacked
      ? row.label + ': ' + row.features + ' feature, ' + row.bugs + ' bug'
      : row.label + ': ' + row.count;
    const segments = stacked
      ? '<i class="segment feature" style="width:' + (100 * row.features / maximum) + '%"></i>'
        + '<i class="segment bug" style="width:' + (100 * row.bugs / maximum) + '%"></i>'
      : '<i class="segment" style="background:' + colors[row.id] + ';width:' + (100 * row.count / maximum) + '%"></i>';
    return '<div class="chart-row"><span class="chart-label">' + escapeHtml(row.label) + '</span>'
      + '<div class="track" role="img" aria-label="' + escapeHtml(label) + '" title="' + escapeHtml(label) + '">' + segments + '</div>'
      + '<span class="chart-value">' + row.count + '</span></div>';
  }).join('');
}
function render(data) {
  const m = data.metrics;
  const kpis = [
    ['Work items', m.total, m.features + ' feature · ' + m.bugs + ' bug'],
    ['In execution', m.executing, 'Implementation · testing · review'],
    ['Backlog', m.backlog, 'Awaiting a decision to start'],
    ['Completed', m.completed, percent(m.completionRate) + ' of work items'],
    ['Cancelled', m.cancelled, 'Left out of the completion rate'],
    ['Gate bypasses', m.bypassed, 'Work items using --force / --skip-hooks'],
    ['Task progress', percent(m.tasks.completionRate), m.tasks.done + '/' + m.tasks.total + ' tasks done'],
  ];
  $('#kpis').innerHTML = kpis.map(([label, value, note]) => '<div class="kpi"><p class="kpi-label">'
    + escapeHtml(label) + '</p><p class="kpi-value">' + escapeHtml(value)
    + '</p><p class="kpi-note">' + escapeHtml(note) + '</p></div>').join('');
  $('#stage-chart').innerHTML = bars(data.charts.byStage, true);
  $('#context-chart').innerHTML = data.charts.byContext.length
    ? bars(data.charts.byContext, true) : '<p class="empty">No work item matches this filter.</p>';
  $('#approval-chart').innerHTML = data.charts.approvals.some((row) => row.count)
    ? bars(data.charts.approvals, false) : '<p class="empty">No work item needs approval yet.</p>';
  const circumference = 2 * Math.PI * 62;
  let offset = 0;
  const arcs = data.charts.byKind.map((row) => {
    const length = m.total ? circumference * row.count / m.total : 0;
    const arc = '<circle cx="90" cy="90" r="62" fill="none" stroke="' + colors[row.id]
      + '" stroke-width="18" stroke-dasharray="' + length + ' ' + (circumference - length)
      + '" stroke-dashoffset="' + (-offset) + '" transform="rotate(-90 90 90)"></circle>';
    offset += length;
    return arc;
  }).join('');
  const legend = data.charts.byKind.map((row) => '<div class="kind-row"><i class="swatch ' + row.id
    + '"></i><span>' + escapeHtml(row.label) + '</span><span>' + row.count + ' <small>('
    + (m.total ? Math.round(100 * row.count / m.total) : 0) + '%)</small></span></div>').join('');
  $('#kind-chart').innerHTML = '<svg class="donut" viewBox="0 0 180 180" role="img" aria-label="'
    + m.features + ' feature, ' + m.bugs + ' bug"><circle cx="90" cy="90" r="62" fill="none" stroke="#26354c" stroke-width="18"></circle>'
    + arcs + '<text x="90" y="91" class="donut-total">' + m.total
    + '</text><text x="90" y="111" class="donut-label">WORK ITEMS</text></svg><div class="kind-legend">' + legend + '</div>';
  $('#task-chart').innerHTML = '<div class="task-line"><span>Tasks in execution</span><strong>'
    + m.tasks.done + '/' + m.tasks.total + '</strong></div><div class="track" role="img" aria-label="'
    + m.tasks.done + ' of ' + m.tasks.total + ' tasks done"><i class="segment feature" style="width:'
    + (m.tasks.completionRate ?? 0) + '%"></i></div><p class="caption">'
    + m.tasks.itemsTracked + ' items with tasks · ' + m.tasks.itemsUntracked + ' items without</p>';
  $('#root').textContent = data.root;
  $('#ts').textContent = new Date(data.updatedAt).toLocaleTimeString();
}
function query() {
  const params = new URLSearchParams();
  if ($('#context').value) params.set('context', $('#context').value);
  if ($('#kind').value) params.set('kind', $('#kind').value);
  return params.toString();
}
let contextOptionsKey = '';
function updateContexts(data) {
  const selected = $('#context').value;
  const options = data.availableContexts.map((context) => ({
    value: context.id === null ? '__none__' : context.id, label: context.label
  }));
  if (selected && !options.some((option) => option.value === selected)) {
    options.push({ value: selected, label: selected === '__none__' ? 'Unassigned' : selected });
  }
  const key = JSON.stringify(options);
  if (key === contextOptionsKey) return;
  contextOptionsKey = key;
  $('#context').innerHTML = '<option value="">All contexts</option>' + options.map((option) =>
    '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join('');
  $('#context').value = selected;
}
let loading = false;
let queued = false;
async function refresh() {
  if (loading) { queued = true; return; }
  loading = true;
  $('#refresh').disabled = true;
  const requested = query();
  try {
    const response = await fetch('/api/data?' + requested, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (requested !== query()) { queued = true; return; }
    updateContexts(data);
    render(data);
    $('#error').hidden = true;
  } catch (error) {
    $('#error').textContent = 'Could not load the metrics (' + (error instanceof Error ? error.message : String(error))
      + '). What is on screen may be stale. Check the server output, then refresh.';
    $('#error').hidden = false;
  } finally {
    loading = false;
    $('#refresh').disabled = false;
    if (queued) { queued = false; refresh(); }
  }
}
$('#refresh').addEventListener('click', refresh);
$('#context').addEventListener('change', refresh);
$('#kind').addEventListener('change', refresh);
refresh();
setInterval(refresh, 5000);
</script>
</body>
</html>`;
}
