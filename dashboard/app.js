'use strict';
/* Token Launch Radar dashboard. All data is inline in ../data.js
   (window.RADAR_DATA), written by main.ts from the sealed snapshot.
   The page makes no network requests: search, filters, sorting and
   the per-protocol detail view all run locally on that data. */

const DATA = window.RADAR_DATA || { rows: [], as_of: '', floor_usd: 0 };
const app = document.getElementById('app');
const stamp = document.getElementById('stamp');

const state = {
  q: '',
  category: 'all',
  chain: 'all',
  scope: 'all',
  confidence: 'all',
  sortKey: 'rank',
  sortDir: 1,
};

function money(v) {
  if (v >= 1e9) return '$' + (v / 1e9).toFixed(2) + 'B';
  if (v >= 1e6) return '$' + (v / 1e6).toFixed(1) + 'M';
  if (v >= 1e3) return '$' + (v / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(v);
}
function pct(v) {
  if (v === null || v === undefined) return '—';
  const cls = v >= 0 ? 'up' : 'down';
  return '<span class="' + cls + '">' + (v >= 0 ? '+' : '') + v.toFixed(1) + '%</span>';
}
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
function confBadge(row) {
  const cls = row.confidence === 'High' ? 'high' : row.confidence === 'Medium' ? 'med' : 'low';
  return '<span class="badge ' + cls + '">' + row.confidence + ' ' + row.confidence_score + '</span>';
}
function scopeBadge(row) {
  return row.on_watchlist
    ? '<span class="badge watch">Watchlist</span>'
    : '<span class="badge early">Early find</span>';
}

function categories() {
  const set = new Set();
  DATA.rows.forEach((r) => set.add(r.category || 'Uncategorised'));
  return [...set].sort();
}
function chains() {
  const set = new Set();
  DATA.rows.forEach((r) => r.chains.forEach((c) => set.add(c)));
  return [...set].sort();
}

function visibleRows() {
  const q = state.q.trim().toLowerCase();
  let rows = DATA.rows.filter((r) => {
    if (q && !(r.name.toLowerCase().includes(q) || r.slug.includes(q))) return false;
    if (state.category !== 'all' && (r.category || 'Uncategorised') !== state.category) return false;
    if (state.chain !== 'all' && !r.chains.includes(state.chain)) return false;
    if (state.scope === 'watchlist' && !r.on_watchlist) return false;
    if (state.scope === 'early' && r.on_watchlist) return false;
    if (state.confidence !== 'all' && r.confidence !== state.confidence) return false;
    return true;
  });
  const key = state.sortKey;
  const dir = state.sortDir;
  rows = [...rows].sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (av === null || av === undefined) return 1;
    if (bv === null || bv === undefined) return -1;
    if (typeof av === 'string') return dir * av.localeCompare(bv);
    return dir * (av - bv);
  });
  return rows;
}

function statsHtml() {
  const rows = DATA.rows;
  const totalImplied = rows.reduce((s, r) => s + r.implied_value_usd, 0);
  const totalTvl = rows.reduce((s, r) => s + r.tvl_usd, 0);
  const growing = rows.filter((r) => (r.change_7d || 0) > 0).length;
  return '<section class="stats">' +
    '<div class="stat"><b>' + rows.length + '</b><span>protocols ranked that record no token</span></div>' +
    '<div class="stat"><b>' + DATA.watchlist_size + ' / ' + DATA.watchlist_size + '</b><span>watchlist protocols covered</span></div>' +
    '<div class="stat"><b>' + money(totalImplied) + '</b><span>combined implied launch value</span></div>' +
    '<div class="stat"><b>' + money(totalTvl) + '</b><span>TVL behind the board</span></div>' +
    '<div class="stat"><b>' + growing + '</b><span>protocols growing this week</span></div>' +
    '<div class="stat"><b>' + DATA.universe_size + '</b><span>protocols scanned in the snapshot</span></div>' +
    '</section>' +
    '<p class="model-note"><strong>How the value is derived:</strong> ' + esc(DATA.model_note) + '</p>';
}

function controlsHtml() {
  const catOpts = ['all', ...categories()].map((c) =>
    '<option value="' + esc(c) + '"' + (state.category === c ? ' selected' : '') + '>' +
    (c === 'all' ? 'All categories' : esc(c)) + '</option>').join('');
  const chainOpts = ['all', ...chains()].map((c) =>
    '<option value="' + esc(c) + '"' + (state.chain === c ? ' selected' : '') + '>' +
    (c === 'all' ? 'All chains' : esc(c)) + '</option>').join('');
  const scopeOpts = [['all', 'Watchlist + early finds'], ['watchlist', 'Watchlist only'], ['early', 'Early finds only']]
    .map(([v, label]) => '<option value="' + v + '"' + (state.scope === v ? ' selected' : '') + '>' + label + '</option>').join('');
  const confOpts = ['all', 'High', 'Medium', 'Low'].map((c) =>
    '<option value="' + c + '"' + (state.confidence === c ? ' selected' : '') + '>' +
    (c === 'all' ? 'Any confidence' : c + ' confidence') + '</option>').join('');
  return '<div class="controls">' +
    '<input type="search" id="f-q" placeholder="Search by name or slug…" value="' + esc(state.q) + '" aria-label="Search protocols">' +
    '<select id="f-cat" aria-label="Filter by category">' + catOpts + '</select>' +
    '<select id="f-chain" aria-label="Filter by chain">' + chainOpts + '</select>' +
    '<select id="f-scope" aria-label="Filter by scope">' + scopeOpts + '</select>' +
    '<select id="f-conf" aria-label="Filter by confidence">' + confOpts + '</select>' +
    '</div>';
}

function sortHead(label, key, cls) {
  const arrow = state.sortKey === key ? (state.sortDir === 1 ? ' ↑' : ' ↓') : '';
  return '<th class="sortable ' + (cls || '') + '" data-sort="' + key + '">' + label + arrow + '</th>';
}

function boardHtml() {
  const rows = visibleRows();
  const maxImplied = DATA.rows.length ? DATA.rows[0].implied_value_usd : 1;
  let html = statsHtml() + controlsHtml();
  html += '<p class="count-line">Showing ' + rows.length + ' of ' + DATA.rows.length +
    ' ranked protocols. Click a row for its detail view and full farm plan.</p>';
  if (rows.length === 0) {
    return html + '<div class="empty">No protocol matches these filters. Loosen the search or pick another category.</div>';
  }
  html += '<table><thead><tr>' +
    sortHead('#', 'rank') +
    sortHead('Protocol', 'name') +
    sortHead('Implied value', 'implied_value_usd', 'num') +
    '<th class="num hide-s">Value vs top</th>' +
    sortHead('TVL', 'tvl_usd', 'num hide-s') +
    sortHead('7d change', 'change_7d', 'num hide-s') +
    sortHead('Confidence', 'confidence_score') +
    '<th>Scope</th>' +
    '</tr></thead><tbody>';
  for (const r of rows) {
    const width = Math.max(2, Math.round((r.implied_value_usd / maxImplied) * 100));
    html += '<tr data-slug="' + esc(r.slug) + '">' +
      '<td class="rank">' + r.rank + '</td>' +
      '<td><span class="pname"><a href="#/protocol/' + esc(r.slug) + '">' + esc(r.name) + '</a></span>' +
      '<div class="sub">' + esc(r.category || 'Uncategorised') + ' · ' + esc(r.chains.slice(0, 3).join(', ')) + '</div></td>' +
      '<td class="num"><strong>' + money(r.implied_value_usd) + '</strong>' +
      '<div class="sub">' + r.peer_multiple.toFixed(2) + '× peer multiple</div></td>' +
      '<td class="num hide-s"><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
      '<td class="num hide-s">' + money(r.tvl_usd) + '</td>' +
      '<td class="num hide-s">' + pct(r.change_7d) + '</td>' +
      '<td>' + confBadge(r) + '</td>' +
      '<td>' + scopeBadge(r) + '</td></tr>';
  }
  return html + '</tbody></table>';
}

function detailHtml(slug) {
  const r = DATA.rows.find((row) => row.slug === slug);
  if (!r) return '<p class="empty">Unknown protocol. <a class="back" href="#/">Back to the board</a></p>';
  const age = r.age_days === null ? 'Not reported' : Math.round(r.age_days / 30.4) + ' months (' + r.age_days + ' days)';
  const steps = r.farm_steps.map((s) => '<li>' + esc(s) + '</li>').join('');
  return '<p><a class="back" href="#/">← Back to the board</a></p>' +
    '<article class="detail">' +
    '<h2>' + esc(r.name) + '</h2>' +
    '<p class="sub">Rank #' + r.rank + ' of ' + DATA.rows.length + ' · ' + esc(r.category || 'Uncategorised') +
    ' · records no token in the snapshot · ' + (r.on_watchlist ? 'on the $' + (DATA.floor_usd / 1e6) + 'M+ watchlist' : 'early find below the watchlist floor') + '</p>' +
    '<div class="kv">' +
    '<div><b>' + money(r.implied_value_usd) + '</b><span>implied launch value (model)</span></div>' +
    '<div><b>' + money(r.tvl_usd) + '</b><span>total value locked</span></div>' +
    '<div><b>' + r.peer_multiple.toFixed(2) + '×</b><span>category peer FDV / TVL multiple</span></div>' +
    '<div><b>' + (r.change_7d === null ? '—' : (r.change_7d >= 0 ? '+' : '') + r.change_7d.toFixed(1) + '%') + '</b><span>TVL change, 7 days</span></div>' +
    '<div><b>' + age + '</b><span>tracked with no token recorded</span></div>' +
    '<div><b>' + r.confidence + ' (' + r.confidence_score + '/100)</b><span>model confidence</span></div>' +
    '<div><b>$' + r.est_weekly_cost_usd + ' / week</b><span>estimated farming cost</span></div>' +
    '<div><b>' + r.est_weekly_hours + ' h / week</b><span>estimated farming time</span></div>' +
    '</div>' +
    '<h3 class="section">Why this value</h3>' +
    '<p class="rationale">' + esc(r.rationale) + '</p>' +
    '<p class="sub">Momentum factor ' + r.momentum_factor.toFixed(2) + ' · maturity factor ' + r.maturity_factor.toFixed(2) +
    ' · chains: ' + esc(r.chains.join(', ')) + ' · tracking since ' + esc(r.listed_at || 'unreported') + '</p>' +
    '<h3 class="section">How to farm it</h3>' +
    '<ol class="steps">' + steps + '</ol>' +
    '<p class="sub">Work the plan from a wallet you control, keep amounts small until any rewards rules are published, and re-check this protocol weekly: a launch usually follows sustained TVL growth.</p>' +
    '</article>';
}

function bindBoard() {
  const q = document.getElementById('f-q');
  if (q) q.addEventListener('input', () => { state.q = q.value; renderBoardOnly(); });
  const bind = (id, key) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => { state[key] = el.value; renderBoardOnly(); });
  };
  bind('f-cat', 'category');
  bind('f-chain', 'chain');
  bind('f-scope', 'scope');
  bind('f-conf', 'confidence');
  app.querySelectorAll('th.sortable').forEach((th) => {
    th.addEventListener('click', () => {
      const key = th.getAttribute('data-sort');
      if (state.sortKey === key) state.sortDir = state.sortDir === 1 ? -1 : 1;
      else { state.sortKey = key; state.sortDir = key === 'name' ? 1 : -1; }
      renderBoardOnly();
    });
  });
  app.querySelectorAll('tbody tr').forEach((tr) => {
    tr.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      location.hash = '#/protocol/' + tr.getAttribute('data-slug');
    });
  });
}

function renderBoardOnly() {
  const keepFocus = document.activeElement && document.activeElement.id === 'f-q';
  const caret = keepFocus ? document.activeElement.selectionStart : null;
  app.innerHTML = boardHtml();
  bindBoard();
  if (keepFocus) {
    const q = document.getElementById('f-q');
    q.focus();
    try { q.setSelectionRange(caret, caret); } catch (e) { /* older engines */ }
  }
}

function render() {
  const hash = location.hash || '#/';
  const detail = hash.match(/^#\/protocol\/(.+)$/);
  app.setAttribute('aria-busy', 'false');
  if (detail) {
    app.innerHTML = detailHtml(decodeURIComponent(detail[1]));
    window.scrollTo(0, 0);
  } else {
    const params = new URLSearchParams(hash.replace(/^#\/?/, '').replace(/^\?/, ''));
    if (params.get('cat')) state.category = params.get('cat');
    if (params.get('scope')) state.scope = params.get('scope');
    if (params.get('q')) state.q = params.get('q');
    app.innerHTML = boardHtml();
    bindBoard();
  }
}

stamp.textContent = 'Snapshot ' + DATA.as_of + ' · ' + DATA.universe_size + ' protocols · floor ' + money(DATA.floor_usd);
window.addEventListener('hashchange', render);
render();
