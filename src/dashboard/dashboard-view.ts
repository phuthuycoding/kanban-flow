export function renderDashboardHtml(): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>kanban-flow dashboard</title>
<style>
  /* Series colours are validated against this panel surface for the lightness band,
     the chroma floor, CVD separation and 3:1 contrast. The old cyan/amber pair failed
     the lightness band. --accent is UI chrome only: text and focus never wear a
     series colour, or the eye starts reading identity into the furniture. */
  :root { color-scheme: dark;
    --bg: #0b1120; --panel: #111c30; --raised: #16233c; --track: #1d2b44;
    --border: #2b3a52; --border-soft: #1e2b42;
    --text: #e8eef8; --muted: #a9b8ce; --accent: #22d3ee;
    --feature: #3987e5; --bug: #d95926;
    --good: #0ca30c; --warn: #fab219; --crit: #d03b3b;
    --ease: cubic-bezier(.22, 1, .36, 1); }
  * { box-sizing: border-box; }
  body { margin: 0; background:
      radial-gradient(1200px 600px at 12% -8%, #16264180 0%, transparent 60%),
      radial-gradient(900px 500px at 92% 0%, #1b2f4a66 0%, transparent 55%), var(--bg);
    background-attachment: fixed; color: var(--text);
    font: 14px/1.5 ui-sans-serif, system-ui, -apple-system, sans-serif; }
  main { max-width: 1280px; margin: auto; padding: 32px 24px 48px; }
  header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
  h1 { font-size: 26px; letter-spacing: -.04em; margin: 4px 0 6px; }
  h2 { font-size: 16px; margin: 0; }
  p { margin: 0; }
  .eyebrow { font-size: 11px; letter-spacing: .14em; text-transform: uppercase; color: var(--accent); }
  .muted, .caption { color: var(--muted); }
  .caption { font-size: 12px; margin-top: 6px; }
  .toolbar { display: flex; flex-wrap: wrap; align-items: end; gap: 12px; margin: 24px 0; }
  label { display: grid; gap: 6px; font-size: 12px; color: var(--muted); }
  select, button { font: inherit; min-height: 44px; border: 1px solid var(--border); border-radius: 10px;
    background: var(--panel); color: var(--text); padding: 8px 12px;
    transition: border-color .18s var(--ease), background .18s var(--ease), transform .18s var(--ease); }
  select { min-width: 180px; max-width: 100%; cursor: pointer; }
  button { cursor: pointer; }
  button:hover, select:hover { border-color: var(--accent); background: var(--raised); }
  button:active { transform: translateY(1px); }
  button:disabled { cursor: wait; opacity: .65; }
  select:focus-visible, button:focus-visible, .bar-row:focus-visible, .node:focus-visible {
    outline: 2px solid var(--accent); outline-offset: 3px; }
  .updated { margin-left: auto; color: var(--muted); font-size: 12px; align-self: center; }
  #root { font-size: 12px; overflow-wrap: anywhere; margin-top: 12px; }
  #error { background: #452028; color: #fecdd3; border: 1px solid #a94a5a; border-radius: 10px; padding: 12px; margin-bottom: 20px; }
  [hidden] { display: none !important; }

  /* A refetch holds the previous render at reduced opacity. A skeleton would flash
     and jump the layout every five seconds for data that rarely changes. */
  .surface { transition: opacity .2s var(--ease); }
  body.loading .surface { opacity: .55; }

  .kpis { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 12px; margin-bottom: 20px; }
  .kpi, .panel { background: linear-gradient(180deg, var(--raised) 0%, var(--panel) 100%);
    border: 1px solid var(--border); border-radius: 14px; }
  .kpi { padding: 18px; position: relative; overflow: hidden;
    transition: border-color .18s var(--ease), transform .18s var(--ease); }
  .kpi:hover { border-color: var(--accent); transform: translateY(-2px); }
  .kpi::after { content: ""; position: absolute; inset: 0 0 auto 0; height: 1px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent); opacity: .45; }
  .kpi-label { color: var(--muted); font-size: 12px; }
  /* Proportional figures on a display-size number; tabular only where digits stack. */
  .kpi-value { font-size: 32px; font-weight: 650; letter-spacing: -.04em; margin: 6px 0; }
  .kpi-note { font-size: 11px; color: var(--muted); }

  /* ---- Pipeline strip: the tool's core idea, drawn instead of described ---- */
  .flow { margin-bottom: 20px; padding: 24px 22px 20px; }
  .flow-track { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; align-items: start; gap: 0; }
  .node-wrap { display: grid; grid-template-columns: 1fr auto 1fr; align-items: center; }
  .node-wrap .link { height: 2px; background: #33486a; border-radius: 2px; }
  .node-wrap .link.on { background: linear-gradient(90deg, var(--border-soft), var(--accent), var(--border-soft));
    background-size: 220% 100%; animation: flow 2.6s linear infinite; }
  .node-wrap .link.edge { background: transparent; }
  @keyframes flow { from { background-position: 100% 0; } to { background-position: -120% 0; } }
  .node { display: grid; justify-items: center; gap: 6px; padding: 10px 6px; border-radius: 12px;
    border: 1px solid var(--border-soft); background: var(--panel); min-width: 74px;
    transition: border-color .2s var(--ease), transform .2s var(--ease), box-shadow .2s var(--ease); }
  .node.live { border-color: #2f5d86; box-shadow: 0 0 0 1px #1d3a56, 0 6px 18px -10px var(--accent); }
  .node:hover, .node:focus-visible { transform: translateY(-3px); border-color: var(--accent); }
  .node-count { font-size: 22px; font-weight: 650; letter-spacing: -.03em; }
  .node.empty .node-count { color: var(--muted); }
  .node-name { font-size: 10px; letter-spacing: .08em; text-transform: uppercase; color: var(--muted); text-align: center; }
  .node-split { font-size: 10px; color: var(--muted); font-variant-numeric: tabular-nums; }
  .flow-aside { display: flex; flex-wrap: wrap; gap: 10px; align-items: center;
    margin-top: 18px; padding-top: 16px; border-top: 1px solid var(--border-soft); }
  .chip { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; color: var(--muted);
    border: 1px solid var(--border-soft); border-radius: 999px; padding: 6px 12px; background: var(--panel); }
  .chip b { color: var(--text); font-variant-numeric: tabular-nums; }
  .chip.branch b { color: var(--accent); }

  .charts { display: grid; grid-template-columns: minmax(0, 1.5fr) minmax(0, 1fr); gap: 20px; }
  .panel { padding: 22px; min-width: 0; }
  .panel-heading { margin-bottom: 20px; }
  .legend { display: flex; flex-wrap: wrap; gap: 16px; color: var(--muted); font-size: 12px; margin-bottom: 18px; }
  .legend span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 9px; height: 9px; border-radius: 2px; display: inline-block; }
  .feature { background: var(--feature); }
  .bug { background: var(--bug); }
  .bars { display: grid; gap: 4px; }

  /* The row is the hit target, not the 12px bar: a pinpoint target fails anyone
     without a steady hand, and it gives hover and keyboard the same surface. */
  .bar-row { display: grid; grid-template-columns: minmax(90px, 120px) minmax(0, 1fr) 40px;
    align-items: center; gap: 12px; position: relative; padding: 6px 8px; margin: 0 -8px;
    border-radius: 10px; min-height: 32px; transition: background .16s var(--ease); }
  .bar-row:hover, .bar-row:focus-visible { background: #ffffff0a; }
  .chart-label { overflow-wrap: anywhere; font-size: 12px; }
  .track { display: flex; height: 12px; background: var(--track); border-radius: 6px; }
  /* A 2px surface gap separates fills; a stroke around each mark would add weight. */
  .segment { display: block; height: 100%; min-width: 0; border-radius: 6px;
    transform-origin: left center; animation: grow .45s var(--ease) both; }
  .segment + .segment { margin-left: 2px; }
  @keyframes grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
  .chart-value { font-size: 12px; text-align: right; font-variant-numeric: tabular-nums; }

  /* Tooltips are CSS-only, so they work under keyboard focus and need no scripting. */
  .tip { position: absolute; left: 50%; bottom: calc(100% - 4px); transform: translate(-50%, 4px);
    background: #060d1a; border: 1px solid var(--border); color: var(--text); font-size: 12px;
    padding: 6px 10px; border-radius: 8px; white-space: nowrap; pointer-events: none;
    opacity: 0; transition: opacity .14s var(--ease), transform .14s var(--ease);
    box-shadow: 0 10px 24px -12px #000; z-index: 3; }
  .bar-row:hover .tip, .bar-row:focus-visible .tip { opacity: 1; transform: translate(-50%, 0); }
  .scroll-chart { max-height: 340px; overflow: auto; padding-right: 4px; }

  /* Two categories is a stat tile plus one bar, not a donut: a two-slice ring
     compares nothing the number does not already say. */
  .split { display: grid; gap: 14px; }
  .split-total { display: flex; align-items: baseline; gap: 10px; }
  .split-total b { font-size: 34px; font-weight: 650; letter-spacing: -.04em; }
  .split-bar { display: flex; height: 16px; border-radius: 8px; background: var(--track); }
  .split-legend { display: grid; gap: 10px; }
  .kind-row { display: grid; grid-template-columns: 10px 1fr auto; align-items: center; gap: 10px; font-size: 13px; }
  .kind-row small { color: var(--muted); font-variant-numeric: tabular-nums; }
  .task-summary { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border-soft); }
  .task-line { display: flex; justify-content: space-between; gap: 12px; margin-bottom: 10px; }
  .empty { padding: 24px 0; color: var(--muted); text-align: center; }
  footer { margin-top: 24px; font-size: 12px; color: var(--muted); }

  /* Motion is decoration here; the numbers carry the meaning without it. */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation: none !important; transition: none !important; }
    .node:hover, .kpi:hover { transform: none; }
  }
  @media (max-width: 1000px) {
    .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
    .flow-track { grid-auto-flow: row; grid-auto-columns: auto; gap: 8px; }
    .node-wrap { grid-template-columns: 1fr; justify-items: stretch; }
    .node-wrap .link { display: none; }
    .node { min-width: 0; grid-template-columns: auto 1fr auto; justify-items: start; text-align: left; }
    .node-name { text-align: left; }
  }
  @media (max-width: 720px) {
    main { padding: 24px 16px; }
    header { display: block; }
    .kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .charts { grid-template-columns: minmax(0, 1fr); }
    .toolbar label { flex: 1; min-width: 140px; }
    select { min-width: 0; width: 100%; }
    .updated { width: 100%; margin-left: 0; }
    .panel { padding: 18px; }
    .bar-row { grid-template-columns: 90px minmax(0, 1fr) 34px; gap: 8px; }
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
  <section class="panel flow surface" aria-labelledby="flow-title">
    <div class="panel-heading"><h2 id="flow-title">Pipeline</h2><p class="caption">Where the work is sitting right now. Backlog branches off planning; cancelled sits off the line.</p></div>
    <div class="flow-track" id="flow-chart"></div>
    <div class="flow-aside" id="flow-aside"></div>
  </section>
  <section class="kpis surface" id="kpis" aria-label="Summary metrics"><p class="muted">Loading metrics…</p></section>
  <div class="charts surface">
    <section class="panel" aria-labelledby="stages-title">
      <div class="panel-heading"><h2 id="stages-title">By stage</h2><p class="caption">How many work items sit in each stage right now.</p></div>
      <div class="legend"><span><i class="swatch feature"></i>Feature</span><span><i class="swatch bug"></i>Bug</span></div>
      <div class="bars" id="stage-chart"></div>
    </section>
    <section class="panel" aria-labelledby="kind-title">
      <div class="panel-heading"><h2 id="kind-title">Features and bugs</h2><p class="caption">The split under the current filter.</p></div>
      <div id="kind-chart"></div>
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
/* Every write goes through here so a panel this page does not have cannot throw. */
const setHtml = (selector, html) => { const el = $(selector); if (el) el.innerHTML = html; };
const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (char) =>
  ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
const percent = (value) => value === null ? '—' : value + '%';
/* Approval is a state, not an identity, so it wears status colours and never a series hue. */
const colors = { feature: '#3987e5', bug: '#d95926', pending: '#a9b8ce', approved: '#0ca30c', changed: '#d03b3b' };
const LINEAR = ['brainstorm', 'planning', 'implementation', 'testing', 'review', 'dones'];
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
    return '<div class="bar-row" tabindex="0" role="img" aria-label="' + escapeHtml(label) + '">'
      + '<span class="chart-label">' + escapeHtml(row.label) + '</span>'
      + '<div class="track">' + segments + '</div>'
      + '<span class="chart-value">' + row.count + '</span>'
      + '<span class="tip">' + escapeHtml(label) + '</span></div>';
  }).join('');
}
function flow(rows) {
  const at = (id) => rows.find((row) => row.id === id) || { count: 0, features: 0, bugs: 0 };
  return LINEAR.map((id, index) => {
    const row = at(id);
    const live = row.count > 0;
    const nextLive = index < LINEAR.length - 1 && at(LINEAR[index + 1]).count > 0;
    const label = id + ': ' + row.count + ' work item' + (row.count === 1 ? '' : 's');
    return '<div class="node-wrap">'
      + '<i class="link ' + (index === 0 ? 'edge' : (live ? 'on' : '')) + '"></i>'
      + '<div class="node ' + (live ? 'live' : 'empty') + '" tabindex="0" role="img" aria-label="'
      + escapeHtml(label) + '"><span class="node-count">' + row.count + '</span>'
      + '<span class="node-name">' + escapeHtml(id) + '</span>'
      + (row.count ? '<span class="node-split">' + row.features + 'f · ' + row.bugs + 'b</span>' : '')
      + '</div>'
      + '<i class="link ' + (index === LINEAR.length - 1 ? 'edge' : (nextLive ? 'on' : '')) + '"></i>'
      + '</div>';
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
  setHtml('#kpis', kpis.map(([label, value, note]) => '<div class="kpi"><p class="kpi-label">'
    + escapeHtml(label) + '</p><p class="kpi-value">' + escapeHtml(value)
    + '</p><p class="kpi-note">' + escapeHtml(note) + '</p></div>').join(''));
  setHtml('#flow-chart', flow(data.charts.byStage));
  const aside = data.charts.byStage.filter((row) => row.id === 'backlog' || row.id === 'cancelled');
  setHtml('#flow-aside', aside.map((row) => '<span class="chip'
    + (row.id === 'backlog' ? ' branch' : '') + '"><b>' + row.count + '</b>' + escapeHtml(row.label)
    + '</span>').join('') + '<span class="chip"><b>' + m.bypassed + '</b>with a recorded bypass</span>');
  setHtml('#stage-chart', bars(data.charts.byStage, true));
  setHtml('#context-chart', data.charts.byContext.length
    ? bars(data.charts.byContext, true) : '<p class="empty">No work item matches this filter.</p>');
  setHtml('#approval-chart', data.charts.approvals.some((row) => row.count)
    ? bars(data.charts.approvals, false) : '<p class="empty">No work item needs approval yet.</p>');
  const share = (count) => m.total ? Math.round(100 * count / m.total) : 0;
  const slices = data.charts.byKind.map((row, index) => '<i class="segment ' + row.id
    + '" style="width:' + (m.total ? 100 * row.count / m.total : 0) + '%;'
    + (index ? 'margin-left:2px;' : '') + '"></i>').join('');
  const legend = data.charts.byKind.map((row) => '<div class="kind-row"><i class="swatch ' + row.id
    + '"></i><span>' + escapeHtml(row.label) + '</span><span>' + row.count + ' <small>('
    + share(row.count) + '%)</small></span></div>').join('');
  setHtml('#kind-chart', '<div class="split"><p class="split-total"><b>' + m.total
    + '</b><span class="muted">work items</span></p>'
    + '<div class="split-bar" role="img" aria-label="' + m.features + ' feature, ' + m.bugs + ' bug">'
    + slices + '</div><div class="split-legend">' + legend + '</div></div>');
  setHtml('#task-chart', '<div class="task-line"><span>Tasks in execution</span><strong>'
    + m.tasks.done + '/' + m.tasks.total + '</strong></div><div class="track" role="img" aria-label="'
    + m.tasks.done + ' of ' + m.tasks.total + ' tasks done"><i class="segment feature" style="width:'
    + (m.tasks.completionRate ?? 0) + '%"></i></div><p class="caption">'
    + m.tasks.itemsTracked + ' items with tasks · ' + m.tasks.itemsUntracked + ' items without</p>');
  const root = $('#root'); if (root) root.textContent = data.root;
  const ts = $('#ts'); if (ts) ts.textContent = new Date(data.updatedAt).toLocaleTimeString();
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
  setHtml('#context', '<option value="">All contexts</option>' + options.map((option) =>
    '<option value="' + escapeHtml(option.value) + '">' + escapeHtml(option.label) + '</option>').join(''));
  $('#context').value = selected;
}
/* document.body is absent in the headless render test, so the dimming is optional. */
const dim = (on) => { if (typeof document.body === 'object' && document.body && document.body.classList)
  document.body.classList.toggle('loading', on); };
let loading = false;
let queued = false;
async function refresh() {
  if (loading) { queued = true; return; }
  loading = true;
  dim(true);
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
    dim(false);
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
