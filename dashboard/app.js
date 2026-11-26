'use strict';
/*
 * Token Launch Radar — front end.
 *
 * This page is deliberately dependency-free. It reads the single global
 * that main.ts writes beside it (window.RADAR_DATA, from data.js) and
 * paints three things into #app: a summary strip, a filterable ranking
 * table, and a detail panel for whichever protocol the reader picks.
 * Nothing here talks to the network; every number on screen comes from
 * the sealed snapshot the radar was built from.
 */

/* ---------- tiny DOM helpers ---------- */

function node(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined && text !== null) el.textContent = String(text);
  return el;
}

function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

function listen(el, event, handler) {
  el.addEventListener(event, handler);
  return el;
}

/* ---------- number and date formatting ---------- */

function dollars(value) {
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  const abs = Math.abs(value);
  if (abs >= 1e9) return '$' + (value / 1e9).toFixed(2) + 'B';
  if (abs >= 1e6) return '$' + (value / 1e6).toFixed(1) + 'M';
  if (abs >= 1e3) return '$' + (value / 1e3).toFixed(1) + 'K';
  return '$' + Math.round(value).toLocaleString('en-US');
}

function wholeDollars(value) {
  if (value === null || value === undefined) return '—';
  return '$' + Math.round(value).toLocaleString('en-US');
}

function signedPct(value) {
  if (value === null || value === undefined) return 'not reported';
  const sign = value > 0 ? '+' : '';
  return sign + value.toFixed(1) + '% in 7d';
}

function ageText(days) {
  if (days === null || days === undefined) return 'tracking start unknown';
  if (days < 45) return days + ' days tracked';
  if (days < 730) return Math.round(days / 30.4) + ' months tracked';
  return (days / 365).toFixed(1) + ' years tracked';
}

function factorText(value) {
  if (value === null || value === undefined) return '—';
  return Number(value).toFixed(2) + 'x';
}

/* ---------- view state ---------- */

const PAGE_SIZE = 60;

const view = {
  query: '',
  category: 'all',
  chain: 'all',
  watchOnly: false,
  minConfidence: 0,
  sortKey: 'rank',
  sortDir: 1,
  visibleCount: PAGE_SIZE,
  selectedSlug: null,
};

const SORT_OPTIONS = [
  { key: 'rank', label: 'Radar rank' },
  { key: 'implied', label: 'Implied value' },
  { key: 'tvl', label: 'TVL' },
  { key: 'change', label: '7-day TVL change' },
  { key: 'confidence', label: 'Confidence score' },
  { key: 'age', label: 'Time tracked' },
];

function sortValue(row, key) {
  switch (key) {
    case 'implied': return row.implied_value_usd;
    case 'tvl': return row.tvl_usd;
    case 'change': return row.change_7d === null ? -Infinity : row.change_7d;
    case 'confidence': return row.confidence_score;
    case 'age': return row.age_days === null ? -1 : row.age_days;
    default: return row.rank;
  }
}

function visibleRows(data) {
  const needle = view.query.trim().toLowerCase();
  const picked = data.rows.filter((row) => {
    if (view.category !== 'all' && (row.category || 'Uncategorised') !== view.category) return false;
    if (view.chain !== 'all' && !row.chains.includes(view.chain)) return false;
    if (view.watchOnly && !row.on_watchlist) return false;
    if (row.confidence_score < view.minConfidence) return false;
    if (needle) {
      const hay = (row.name + ' ' + row.slug + ' ' + (row.category || '') + ' ' + row.chains.join(' ')).toLowerCase();
      if (!hay.includes(needle)) return false;
    }
    return true;
  });
  const dir = view.sortKey === 'rank' ? 1 : view.sortDir;
  picked.sort((a, b) => {
    const delta = sortValue(a, view.sortKey) - sortValue(b, view.sortKey);
    if (delta !== 0) return delta * dir;
    return a.rank - b.rank;
  });
  return picked;
}

function distinctValues(data, pick) {
  const seen = new Set();
  for (const row of data.rows) {
    for (const value of pick(row)) {
      if (value) seen.add(value);
    }
  }
  return [...seen].sort((a, b) => a.localeCompare(b));
}

/* ---------- summary strip and controls ---------- */

function statCard(label, big, small) {
  const card = node('div', 'rv-stat');
  card.appendChild(node('div', 'rv-stat-label', label));
  card.appendChild(node('div', 'rv-stat-value', big));
  if (small) card.appendChild(node('div', 'rv-stat-note', small));
  return card;
}

function buildStats(data, host) {
  const strip = node('section', 'rv-stats');
  strip.setAttribute('aria-label', 'Radar summary');
  const totalImplied = data.rows.reduce((sum, r) => sum + r.implied_value_usd, 0);
  strip.appendChild(statCard('Protocols ranked', String(data.rows.length),
    data.universe_size + ' scanned in the snapshot'));
  strip.appendChild(statCard('Watchlist covered', data.watchlist_size + ' / ' + data.watchlist_size,
    'every watchlist protocol is on the board'));
  strip.appendChild(statCard('Combined implied value', dollars(totalImplied),
    'the board total if every record held'));
  strip.appendChild(statCard('Watchlist floor', dollars(data.floor_usd),
    'the radar also scans well below it'));
  host.appendChild(strip);
  const note = node('p', 'rv-model-note', data.model_note);
  host.appendChild(note);
}

function labelledControl(labelText, control) {
  const wrap = node('label', 'rv-field');
  wrap.appendChild(node('span', 'rv-field-label', labelText));
  wrap.appendChild(control);
  return wrap;
}

function buildControls(data, host, rerender) {
  const bar = node('section', 'rv-controls');
  bar.setAttribute('aria-label', 'Board filters');

  const search = node('input', 'rv-input');
  search.type = 'search';
  search.id = 'rv-search';
  search.placeholder = 'Name, category or chain…';
  search.value = view.query;
  listen(search, 'input', () => {
    view.query = search.value;
    view.visibleCount = PAGE_SIZE;
    rerender(false);
  });
  bar.appendChild(labelledControl('Search', search));

  const catPick = node('select', 'rv-select');
  catPick.id = 'rv-category';
  catPick.appendChild(node('option', null, 'All categories'));
  catPick.options[0].value = 'all';
  for (const cat of distinctValues(data, (r) => [r.category || 'Uncategorised'])) {
    const opt = node('option', null, cat);
    opt.value = cat;
    catPick.appendChild(opt);
  }
  catPick.value = view.category;
  listen(catPick, 'change', () => {
    view.category = catPick.value;
    view.visibleCount = PAGE_SIZE;
    rerender(false);
  });
  bar.appendChild(labelledControl('Category', catPick));

  const chainPick = node('select', 'rv-select');
  chainPick.id = 'rv-chain';
  chainPick.appendChild(node('option', null, 'All chains'));
  chainPick.options[0].value = 'all';
  for (const chain of distinctValues(data, (r) => r.chains)) {
    const opt = node('option', null, chain);
    opt.value = chain;
    chainPick.appendChild(opt);
  }
  chainPick.value = view.chain;
  listen(chainPick, 'change', () => {
    view.chain = chainPick.value;
    view.visibleCount = PAGE_SIZE;
    rerender(false);
  });
  bar.appendChild(labelledControl('Chain', chainPick));

  const sortPick = node('select', 'rv-select');
  sortPick.id = 'rv-sort';
  for (const option of SORT_OPTIONS) {
    const opt = node('option', null, option.label);
    opt.value = option.key;
    sortPick.appendChild(opt);
  }
  sortPick.value = view.sortKey;
  listen(sortPick, 'change', () => {
    view.sortKey = sortPick.value;
    view.sortDir = view.sortKey === 'rank' ? 1 : -1;
    rerender(false);
  });
  bar.appendChild(labelledControl('Sort by', sortPick));

  const watchWrap = node('label', 'rv-check');
  const watchBox = node('input');
  watchBox.type = 'checkbox';
  watchBox.id = 'rv-watch-only';
  watchBox.checked = view.watchOnly;
  listen(watchBox, 'change', () => {
    view.watchOnly = watchBox.checked;
    view.visibleCount = PAGE_SIZE;
    rerender(false);
  });
  watchWrap.appendChild(watchBox);
  watchWrap.appendChild(node('span', null, 'Watchlist only'));
  bar.appendChild(watchWrap);

  host.appendChild(bar);
}

/* ---------- ranking table ---------- */

function confidencePill(row) {
  const pill = node('span', 'rv-pill rv-pill-' + row.confidence.toLowerCase(),
    row.confidence + ' · ' + row.confidence_score);
  pill.title = 'Confidence in the implied value, from peer depth, TVL and data completeness';
  return pill;
}

function boardRow(data, row, openDetail) {
  const tr = node('tr', 'rv-row');
  tr.dataset.slug = row.slug;

  const rankCell = node('td', 'rv-rank', '#' + row.rank);
  tr.appendChild(rankCell);

  const nameCell = node('td', 'rv-name-cell');
  const nameBtn = node('button', 'rv-name-btn', row.name);
  nameBtn.type = 'button';
  listen(nameBtn, 'click', () => openDetail(row.slug));
  nameCell.appendChild(nameBtn);
  if (row.on_watchlist) {
    nameCell.appendChild(node('span', 'rv-watch-tag', 'watchlist'));
  }
  nameCell.appendChild(node('div', 'rv-slug', row.slug));
  tr.appendChild(nameCell);

  tr.appendChild(node('td', null, row.category || 'Uncategorised'));
  tr.appendChild(node('td', 'rv-chains', row.chains.join(', ') || '—'));
  tr.appendChild(node('td', 'rv-num', dollars(row.tvl_usd)));

  const changeCell = node('td', 'rv-num ' + (row.change_7d === null ? '' : row.change_7d >= 0 ? 'rv-up' : 'rv-down'),
    signedPct(row.change_7d));
  tr.appendChild(changeCell);

  tr.appendChild(node('td', 'rv-num rv-implied', wholeDollars(row.implied_value_usd)));

  const confCell = node('td');
  confCell.appendChild(confidencePill(row));
  tr.appendChild(confCell);

  tr.appendChild(node('td', 'rv-num',
    '$' + row.est_weekly_cost_usd + ' · ' + row.est_weekly_hours + 'h / wk'));

  const actionCell = node('td');
  const detailBtn = node('button', 'rv-detail-btn', 'Farm plan →');
  detailBtn.type = 'button';
  listen(detailBtn, 'click', () => openDetail(row.slug));
  actionCell.appendChild(detailBtn);
  tr.appendChild(actionCell);

  listen(tr, 'click', (event) => {
    if (event.target === tr || event.target.tagName === 'TD') openDetail(row.slug);
  });
  return tr;
}

function buildTable(data, host, openDetail, rerender) {
  const rows = visibleRows(data);
  const heading = node('div', 'rv-table-head');
  heading.appendChild(node('h2', null,
    rows.length === data.rows.length
      ? 'The board — ' + rows.length + ' protocols ranked by implied value'
      : rows.length + ' of ' + data.rows.length + ' protocols match the filters'));
  host.appendChild(heading);

  if (rows.length === 0) {
    host.appendChild(node('p', 'rv-empty',
      'No protocol matches those filters. Clear the search or pick another category or chain.'));
    return;
  }

  const scroll = node('div', 'rv-table-scroll');
  const table = node('table', 'rv-table');
  const head = node('thead');
  const headRow = node('tr');
  const columns = ['Rank', 'Protocol', 'Category', 'Chains', 'TVL', '7-day change',
    'Implied value', 'Confidence', 'Farm cost', ''];
  for (const label of columns) headRow.appendChild(node('th', null, label));
  head.appendChild(headRow);
  table.appendChild(head);

  const body = node('tbody');
  for (const row of rows.slice(0, view.visibleCount)) {
    body.appendChild(boardRow(data, row, openDetail));
  }
  table.appendChild(body);
  scroll.appendChild(table);
  host.appendChild(scroll);

  if (rows.length > view.visibleCount) {
    const more = node('button', 'rv-more-btn',
      'Show more — ' + (rows.length - view.visibleCount) + ' still hidden');
    more.type = 'button';
    listen(more, 'click', () => {
      view.visibleCount += PAGE_SIZE;
      rerender(false);
    });
    host.appendChild(more);
  }
}

/* ---------- per-protocol detail panel ---------- */

function metricTile(label, value, hint) {
  const tile = node('div', 'rv-metric');
  tile.appendChild(node('div', 'rv-metric-label', label));
  tile.appendChild(node('div', 'rv-metric-value', value));
  if (hint) tile.appendChild(node('div', 'rv-metric-hint', hint));
  return tile;
}

function buildDetail(data, row, host, closeDetail) {
  const panel = node('section', 'rv-detail');
  panel.setAttribute('aria-label', 'Detail for ' + row.name);

  const back = node('button', 'rv-back-btn', '← Back to the board');
  back.type = 'button';
  listen(back, 'click', closeDetail);
  panel.appendChild(back);

  const titleRow = node('div', 'rv-detail-head');
  const titleBox = node('div');
  titleBox.appendChild(node('h2', 'rv-detail-title', '#' + row.rank + ' · ' + row.name));
  titleBox.appendChild(node('p', 'rv-detail-sub',
    (row.category || 'Uncategorised') + ' · ' + (row.chains.join(', ') || 'chain not listed') +
    (row.on_watchlist ? ' · on the watchlist' : ' · found below the watchlist floor')));
  titleRow.appendChild(titleBox);
  titleRow.appendChild(confidencePill(row));
  panel.appendChild(titleRow);

  panel.appendChild(node('p', 'rv-records-note',
    'This protocol records no token in the snapshot. That describes the record, not proof that no token exists anywhere.'));

  const grid = node('div', 'rv-metric-grid');
  grid.appendChild(metricTile('Implied value', wholeDollars(row.implied_value_usd),
    'what a launch would be worth if the record held'));
  grid.appendChild(metricTile('TVL', dollars(row.tvl_usd), signedPct(row.change_7d)));
  grid.appendChild(metricTile('Peer multiple', factorText(row.peer_multiple),
    'median market cap / TVL of live tokens in this category'));
  grid.appendChild(metricTile('Momentum factor', factorText(row.momentum_factor),
    'from the seven-day TVL change'));
  grid.appendChild(metricTile('Maturity factor', factorText(row.maturity_factor), ageText(row.age_days)));
  grid.appendChild(metricTile('Tracked since', row.listed_at || 'not reported', ageText(row.age_days)));
  grid.appendChild(metricTile('Estimated farm cost',
    '$' + row.est_weekly_cost_usd + ' / week', row.est_weekly_hours + ' hours a week'));
  grid.appendChild(metricTile('Confidence', row.confidence + ' (' + row.confidence_score + '/100)',
    'peer depth, TVL and data completeness'));
  panel.appendChild(grid);

  panel.appendChild(node('h3', 'rv-section-title', 'Why this value'));
  panel.appendChild(node('p', 'rv-rationale', row.rationale));

  panel.appendChild(node('h3', 'rv-section-title', 'How to farm it — step by step'));
  const steps = node('ol', 'rv-steps');
  row.farm_steps.forEach((step, index) => {
    const item = node('li', 'rv-step');
    item.appendChild(node('span', 'rv-step-num', 'Step ' + (index + 1)));
    item.appendChild(node('span', 'rv-step-text', step));
    steps.appendChild(item);
  });
  panel.appendChild(steps);

  host.appendChild(panel);
  panel.scrollIntoView({ block: 'start' });
}

/* ---------- page assembly ---------- */

function startRadar() {
  const app = document.getElementById('app');
  const stamp = document.getElementById('stamp');
  const data = window.RADAR_DATA;

  if (!app) return;
  if (!data || !Array.isArray(data.rows)) {
    clear(app).appendChild(node('p', 'rv-empty',
      'The radar data file did not load, so there is nothing to rank yet.'));
    if (stamp) stamp.textContent = 'No data loaded';
    return;
  }

  if (stamp) {
    stamp.textContent = 'Snapshot ' + data.as_of + ' · ' + data.universe_size +
      ' protocols · ' + data.tokenized_size + ' already record a token';
  }

  /* The summary and controls are built once and stay mounted, so typing
   * in the search box never loses focus; only the board region below
   * them is repainted when a filter, sort or page-size change lands. */
  const boardHost = node('div', 'rv-board');
  buildStats(data, app);
  buildControls(data, app, () => render(false));
  app.appendChild(boardHost);
  app.setAttribute('aria-busy', 'false');

  function openDetail(slug) {
    view.selectedSlug = slug;
    render(true);
  }
  function closeDetail() {
    view.selectedSlug = null;
    render(true);
  }

  function render(detailChanged) {
    const selected = view.selectedSlug
      ? data.rows.find((r) => r.slug === view.selectedSlug)
      : null;
    if (selected) {
      app.style.display = 'none';
      let panelHost = document.getElementById('rv-detail-host');
      if (!panelHost) {
        panelHost = node('div');
        panelHost.id = 'rv-detail-host';
        app.parentNode.insertBefore(panelHost, app.nextSibling);
      }
      clear(panelHost);
      buildDetail(data, selected, panelHost, closeDetail);
      return;
    }
    if (detailChanged) {
      const panelHost = document.getElementById('rv-detail-host');
      if (panelHost) clear(panelHost);
      app.style.display = '';
    }
    clear(boardHost);
    buildTable(data, boardHost, openDetail, render);
  }

  render(true);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startRadar);
} else {
  startRadar();
}
