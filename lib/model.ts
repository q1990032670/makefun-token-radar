// Token launch radar: the valuation and farming model.
//
// Everything in this file is derived from the sealed snapshot alone. The
// snapshot carries no ranking and no implied value, so this model builds
// both from the figures it does carry: TVL, seven-day TVL change, the day
// DefiLlama began tracking the protocol, its category and chains, and the
// market caps of comparable protocols whose tokens already trade.
//
// Language rule used throughout: a protocol whose gecko_id and symbol are
// both null "records no token". That is a statement about the record, not
// proof that no token exists anywhere.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  age_days: number | null;
  on_watchlist: boolean;
  peer_multiple: number;
  momentum_factor: number;
  maturity_factor: number;
  confidence: string;
  confidence_score: number;
  rationale: string;
  est_weekly_cost_usd: number;
  est_weekly_hours: number;
}

export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  generated_rows: number;
  watchlist_size: number;
  universe_size: number;
  tokenized_size: number;
  model_note: string;
  rows: BoardRow[];
}

/** Parse and lightly validate the snapshot text. Throws on a bad shape. */
export function parseSnapshot(text: string): Snapshot {
  const raw = JSON.parse(text) as Snapshot;
  if (!Array.isArray(raw.protocols) || !Array.isArray(raw.watchlist)) {
    throw new Error('snapshot: protocols and watchlist must be arrays');
  }
  for (const p of raw.protocols) {
    if (typeof p.slug !== 'string' || typeof p.tvl_usd !== 'number') {
      throw new Error('snapshot: every protocol needs a slug and tvl_usd');
    }
  }
  return raw;
}

/** True when the record carries no token: both token fields are null. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const VERSION_TAIL = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_HEAD = /^(Binance|Coinbase|Bybit|Kraken|Bitget|OKX|Bitfinex|Gemini)\b/;
const PRODUCT_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

/**
 * True when a protocol looks like a wrapped, staked or bridged product of
 * a token that already trades, mirroring the watchlist's own exclusions:
 * such a product is not itself waiting on a launch.
 */
export function isTokenProduct(p: Protocol): boolean {
  if (p.category !== null && PRODUCT_CATEGORIES.has(p.category)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  if (VERSION_TAIL.test(p.name)) return true;
  if (EXCHANGE_HEAD.test(p.name)) return true;
  return false;
}

/** Median of a non-empty list, or null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function clamp(value: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, value));
}

/**
 * Peer multiples: for every category, the median market-cap-to-TVL ratio
 * of the protocols in that category whose token already trades. A
 * pre-token protocol is then valued as if its token, at launch, traded
 * at the multiple its own category's live tokens actually sustain.
 * Categories with too few live peers fall back to the global median, and
 * every multiple is clamped so one meme-priced outlier cannot dominate.
 */
export function peerMultiples(snapshot: Snapshot): Map<string, number> {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p)) continue;
    if (p.mcap_usd === null || p.mcap_usd <= 0 || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    all.push(ratio);
    const key = p.category ?? 'Uncategorised';
    const bucket = byCategory.get(key) ?? [];
    bucket.push(ratio);
    byCategory.set(key, bucket);
  }
  const globalMedian = median(all) ?? 0.6;
  const result = new Map<string, number>();
  for (const [key, bucket] of byCategory) {
    const own = bucket.length >= 3 ? median(bucket) : null;
    result.set(key, clamp(own ?? globalMedian, 0.08, 6));
  }
  result.set('__global__', clamp(globalMedian, 0.08, 6));
  return result;
}

/** How many live-token peers priced a category; drives confidence. */
export function peerCounts(snapshot: Snapshot): Map<string, number> {
  const counts = new Map<string, number>();
  for (const p of snapshot.protocols) {
    if (recordsNoToken(p) || p.mcap_usd === null || p.mcap_usd <= 0) continue;
    const key = p.category ?? 'Uncategorised';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/** Whole days between the day tracking began and the snapshot date. */
export function ageInDays(p: Protocol, asOf: string): number | null {
  if (p.listed_at === null) return null;
  const start = Date.parse(`${p.listed_at}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

/**
 * Momentum factor from the seven-day TVL change. Growth is evidence a
 * launch would be priced into a rising protocol, so it lifts the value;
 * shrinkage discounts it. The factor is deliberately gentle (0.82 to
 * 1.30) and a missing change is neutral, never punished.
 */
export function momentumFactor(change7d: number | null): number {
  if (change7d === null) return 1;
  return clamp(1 + change7d / 100, 0.82, 1.3);
}

/**
 * Maturity factor from age. A protocol that has run for years with no
 * token recorded has had time to build the user base a launch rewards,
 * so age adds a slow premium that saturates near three years. Brand-new
 * protocols get a small discount: their TVL has not yet proven sticky.
 */
export function maturityFactor(ageDays: number | null): number {
  if (ageDays === null) return 1;
  if (ageDays < 30) return 0.92;
  const years = ageDays / 365;
  return clamp(0.98 + 0.09 * Math.log2(1 + years), 0.98, 1.14);
}

/** Compact dollar formatting shared by the rationale strings. */
export function fmtUsd(value: number): string {
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`;
  if (value >= 1e6) return `$${(value / 1e6).toFixed(1)}M`;
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`;
  return `$${Math.round(value)}`;
}

interface CategoryPlaybook {
  open: string;
  core: string;
  deepen: string;
  cost: string;
  cadence: string;
}

const PLAYBOOKS: Record<string, CategoryPlaybook> = {
  Lending: {
    open: 'Open the app, connect a fresh wallet and deposit a stablecoin or ETH as collateral on its main market',
    core: 'Borrow a small amount against the deposit and repay it, so the wallet shows both supply and borrow history',
    deepen: 'Rotate part of the position into a second market or chain deployment to count as a multi-market user',
    cost: 'Budget $25-$60 a month in interest spread and gas; keep utilisation under 60% so liquidation risk stays near zero',
    cadence: 'Repeat the supply-borrow-repay loop weekly for 20-30 minutes; consistency over months beats one large deposit',
  },
  Dexs: {
    open: 'Connect a wallet and make a first swap in the protocol interface, starting with a stablecoin pair to limit slippage',
    core: 'Add a small liquidity position in a high-volume pair and leave it in range for at least a full week',
    deepen: 'Trade on two or three different days each week and try a second chain deployment if the protocol runs one',
    cost: 'Budget $15-$40 a month in swap fees and gas; trade sizes of $100-$500 keep fees meaningful without real exposure',
    cadence: 'Spend 30-45 minutes twice a week swapping and rebalancing the position; log every session in a tracker',
  },
  Yield: {
    open: 'Deposit a stablecoin or ETH into the flagship vault so the wallet starts earning the vault share token',
    core: 'Hold the vault position untouched for several weeks; vault snapshots usually reward duration, not churn',
    deepen: 'Add a second, smaller deposit into a different strategy vault to diversify the on-chain footprint',
    cost: 'Budget $10-$30 a month in gas for deposits and claims; the capital itself stays withdrawable from the vault',
    cadence: 'Check the position for 10 minutes weekly and compound rewards monthly; avoid entering and exiting around rumours',
  },
  'Yield Aggregator': {
    open: 'Deposit into the main aggregator vault on its busiest chain and keep the receipt token in the same wallet',
    core: 'Let the position compound for a month, then claim and restake any harvested rewards inside the same product',
    deepen: 'Split a smaller amount across a second vault strategy so the wallet touches more of the product surface',
    cost: 'Budget $10-$25 a month in gas; performance fees come out of yield, so track net rather than headline APY',
    cadence: 'Review for 15 minutes weekly and rebalance monthly; long unbroken holds are the signal worth building',
  },
  Bridge: {
    open: 'Bridge a small amount of ETH or stablecoins to a chain the protocol serves and keep the received funds there',
    core: 'Bridge back on a different day and try a second route or destination chain to build a genuine usage pattern',
    deepen: 'Use the bridge inside a wider route, for example bridging then depositing into a farm on the destination chain',
    cost: 'Budget $20-$50 a month in bridge fees and gas; $50-$200 per crossing is enough to register as real volume',
    cadence: 'Make two to four crossings a month, 15 minutes each; steady monthly activity matters more than one big transfer',
  },
  Derivatives: {
    open: 'Deposit collateral and open a tiny first position, long or short, sized so a full loss is acceptable',
    core: 'Trade small size on several separate days, closing each position cleanly rather than leaving it to expire',
    deepen: 'Try a second market or the options or vault product if offered, keeping total exposure small throughout',
    cost: 'Budget $30-$80 a month in trading fees and expected losses; treat the fees as the cost of the farm, not profit',
    cadence: 'Trade 20-30 minutes twice a week; volume spread across many days is what points systems usually measure',
  },
  'Liquid Staking': {
    open: 'Stake a small amount of the base asset through the protocol and hold the liquid staking token it issues',
    core: 'Use the staking token in one partner integration, such as a lending market or liquidity pool, for a week or more',
    deepen: 'Add a second small stake a month later so the wallet shows recurring staking rather than a single action',
    cost: 'Budget $10-$20 a month in gas; the stake itself stays redeemable subject to the protocol unstaking period',
    cadence: 'Spend 10 minutes weekly checking the position and restaking rewards; patience is the whole strategy here',
  },
  CDP: {
    open: 'Open a small collateralised position: deposit ETH or a staking token and mint a modest amount of the stablecoin',
    core: 'Keep the position healthy above a 200% collateral ratio and adjust it once so the wallet shows active management',
    deepen: 'Use the minted stablecoin in the protocol own stability pool or a partner farm for at least two weeks',
    cost: 'Budget $15-$35 a month in stability fees and gas; never let the ratio drift near the liquidation line',
    cadence: 'Check the ratio for 10 minutes twice a week and top up collateral whenever markets fall sharply',
  },
  RWA: {
    open: 'Complete any onboarding or allowlist step, then make the smallest real subscription or deposit the product allows',
    core: 'Hold the position through at least one full yield or reporting cycle so the wallet counts as an active holder',
    deepen: 'Add a second product or tranche if offered, keeping amounts small while learning the redemption rules',
    cost: 'Budget $20-$50 a month including gas and any subscription minimums; read redemption windows before depositing',
    cadence: 'Review for 15 minutes weekly; RWA products move slowly, so monthly actions match their natural rhythm',
  },
};

const CURATOR_PLAYBOOK: CategoryPlaybook = {
  open: 'Deposit a stablecoin or ETH into one of the curator flagship vaults on its main chain and keep the vault shares',
  core: 'Hold the vault position through a full rebalancing cycle, then claim any rewards inside the same product',
  deepen: 'Add a smaller deposit to a second curated vault with a different risk profile to widen the footprint',
  cost: 'Budget $10-$30 a month in gas; curator vaults carry smart-contract and strategy risk, so size positions conservatively',
  cadence: 'Review allocations for 15 minutes weekly and rebalance monthly; curators reward depositors who stay through cycles',
};

PLAYBOOKS['Risk Curators'] = CURATOR_PLAYBOOK;
PLAYBOOKS['Onchain Capital Allocator'] = CURATOR_PLAYBOOK;

const GENERIC_PLAYBOOK: CategoryPlaybook = {
  open: 'Open the protocol app, connect a fresh wallet and complete its primary action once with a small amount',
  core: 'Repeat the primary action on separate days so the wallet builds a history of genuine, spaced-out usage',
  deepen: 'Try a second feature or chain deployment of the same protocol to widen the on-chain footprint',
  cost: 'Budget $15-$40 a month in fees and gas; keep position sizes small until the rules of any rewards program are known',
  cadence: 'Spend 20-30 minutes weekly for at least two months; early, steady users are who launch allocations usually reward',
};

function playbookFor(category: string | null): CategoryPlaybook {
  if (category !== null && PLAYBOOKS[category] !== undefined) {
    return PLAYBOOKS[category]!;
  }
  return GENERIC_PLAYBOOK;
}

/**
 * A concrete five-step farm plan for one protocol. Every step names the
 * action, and the plan as a whole states the money and the time it
 * takes, because a plan without a cost is a slogan. Steps stay inside
 * the gate's 20 to 600 character window by construction.
 */
export function farmSteps(p: Protocol): string[] {
  const book = playbookFor(p.category);
  const chain = p.chains[0] ?? 'its main chain';
  const extraChains =
    p.chains.length > 1
      ? ` It also runs on ${p.chains.slice(1, 3).join(' and ')}, which the later steps use.`
      : '';
  const size =
    p.tvl_usd >= 500_000_000
      ? 'This is a large protocol, so modest positions still register among many users.'
      : p.tvl_usd >= 50_000_000
        ? 'At this size a few hundred dollars of activity is a visible, credible footprint.'
        : 'It is still small, so early and consistent activity stands out more than position size.';
  return [
    `Start on ${chain}: ${book.open}. ${size}${extraChains}`,
    `${book.core}. Keep screenshots or a spreadsheet log of dates and amounts as your own record.`,
    `${book.deepen}. Stay inside products the protocol itself runs, not third-party copies.`,
    `${book.cost}. Never deposit money you cannot leave untouched for three to six months.`,
    `${book.cadence}. Revisit the plan whenever TVL moves sharply, since a launch usually follows growth.`,
  ];
}

/** Rough monthly out-of-pocket cost implied by the playbook, for display. */
export function weeklyCost(category: string | null): { usd: number; hours: number } {
  switch (category) {
    case 'Derivatives':
      return { usd: 14, hours: 1 };
    case 'Bridge':
      return { usd: 9, hours: 0.5 };
    case 'Lending':
      return { usd: 10, hours: 0.6 };
    case 'Dexs':
      return { usd: 8, hours: 1 };
    default:
      return { usd: 6, hours: 0.5 };
  }
}

/**
 * Confidence in the implied value, from how much evidence backs it:
 * the number of live peers pricing the category, the protocol's own
 * TVL, and whether its momentum and age are actually reported.
 */
export function confidenceOf(
  peers: number,
  tvl: number,
  change7d: number | null,
  ageDays: number | null,
): { label: string; score: number } {
  let score = 30;
  score += clamp(peers * 4, 0, 32);
  if (tvl >= 500_000_000) score += 18;
  else if (tvl >= 100_000_000) score += 13;
  else if (tvl >= 25_000_000) score += 8;
  else score += 3;
  if (change7d !== null) score += 6;
  if (ageDays !== null) score += 6;
  score = clamp(Math.round(score), 5, 97);
  const label = score >= 70 ? 'High' : score >= 45 ? 'Medium' : 'Low';
  return { label, score };
}

/** One-sentence rationale tying the implied value to the inputs. */
export function rationaleFor(
  p: Protocol,
  multiple: number,
  momentum: number,
  maturity: number,
  peers: number,
  ageDays: number | null,
): string {
  const cat = p.category ?? 'its category';
  const growth =
    p.change_7d === null
      ? 'no seven-day change reported'
      : `TVL ${p.change_7d >= 0 ? 'up' : 'down'} ${Math.abs(p.change_7d).toFixed(1)}% in seven days`;
  const age =
    ageDays === null
      ? 'tracking start unreported'
      : `${Math.round(ageDays / 30.4)} months tracked with no token recorded`;
  const peerCaveat =
    peers < 3
      ? ' That peer set is thin, so this multiple leans on the wider market and deserves extra caution.'
      : '';
  return (
    `${cat} peers trade at a median ${multiple.toFixed(2)}x market cap to TVL across ${peers} live token${peers === 1 ? '' : 's'}; ` +
    `applied to ${fmtUsd(p.tvl_usd)} of TVL with a ${momentum.toFixed(2)} momentum factor (${growth}) ` +
    `and a ${maturity.toFixed(2)} maturity factor (${age}).${peerCaveat}`
  );
}

/**
 * Build the ranked board. Candidates are the protocols that record no
 * token and are not a wrapped, staked or bridged product of one that
 * trades. The watchlist is always included in full; beyond it, the
 * radar keeps scanning down the TVL table, because finding launches
 * early is the whole point. Ranking is by implied value, and implied
 * values are forced strictly decreasing so rank always means value.
 */
export function buildRadar(
  snapshot: Snapshot,
  targetRows = 220,
): { board: BoardRow[]; radar: RadarData } {
  const multiples = peerMultiples(snapshot);
  const counts = peerCounts(snapshot);
  const globalMultiple = multiples.get('__global__') ?? 0.6;
  const watch = new Set(snapshot.watchlist);

  const candidates = snapshot.protocols.filter(
    (p) => recordsNoToken(p) && (watch.has(p.slug) || !isTokenProduct(p)),
  );

  interface Scored {
    p: Protocol;
    raw: number;
    multiple: number;
    momentum: number;
    maturity: number;
    ageDays: number | null;
    peers: number;
  }
  const scored: Scored[] = candidates.map((p) => {
    const key = p.category ?? 'Uncategorised';
    const multiple = multiples.get(key) ?? globalMultiple;
    const momentum = momentumFactor(p.change_7d);
    const maturity = maturityFactor(ageInDays(p, snapshot.as_of));
    return {
      p,
      raw: p.tvl_usd * multiple * momentum * maturity,
      multiple,
      momentum,
      maturity,
      ageDays: ageInDays(p, snapshot.as_of),
      peers: counts.get(key) ?? 0,
    };
  });
  scored.sort((a, b) => b.raw - a.raw || b.p.tvl_usd - a.p.tvl_usd || a.p.slug.localeCompare(b.p.slug));

  const chosen = scored.slice(0, Math.max(targetRows, watch.size));
  const board: BoardRow[] = [];
  let previous = Number.POSITIVE_INFINITY;
  chosen.forEach((s, index) => {
    let implied = Math.round(s.raw);
    if (implied >= previous) implied = previous - 1;
    if (implied < 1) implied = 1;
    previous = implied;
    const conf = confidenceOf(s.peers, s.p.tvl_usd, s.p.change_7d, s.ageDays);
    const cost = weeklyCost(s.p.category);
    board.push({
      slug: s.p.slug,
      name: s.p.name,
      rank: index + 1,
      implied_value_usd: implied,
      farm_steps: farmSteps(s.p),
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      listed_at: s.p.listed_at,
      age_days: s.ageDays,
      on_watchlist: watch.has(s.p.slug),
      peer_multiple: Number(s.multiple.toFixed(3)),
      momentum_factor: Number(s.momentum.toFixed(3)),
      maturity_factor: Number(s.maturity.toFixed(3)),
      confidence: conf.label,
      confidence_score: conf.score,
      rationale: rationaleFor(s.p, s.multiple, s.momentum, s.maturity, s.peers, s.ageDays),
      est_weekly_cost_usd: cost.usd,
      est_weekly_hours: cost.hours,
    });
  });

  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    generated_rows: board.length,
    watchlist_size: snapshot.watchlist.length,
    universe_size: snapshot.protocols.length,
    tokenized_size: snapshot.protocols.filter((p) => !recordsNoToken(p)).length,
    model_note:
      'Implied value = TVL x category peer multiple (median market cap / TVL of live tokens in the ' +
      'same category) x momentum factor from seven-day TVL change x maturity factor from time tracked ' +
      'with no token recorded. It states what a launch would be worth if the record held, not a ' +
      'prediction that a token will be issued.',
    rows: board,
  };
  return { board, radar };
}

/** The dashboard data file: a single global the static page reads. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR_DATA = ${JSON.stringify(radar)};\n`;
}

/** Null when the board passes the gate's shape, else the first problem. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) {
    return `board holds ${board.length} rows, outside 100 to 4000`;
  }
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  const sorted = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 0; i < sorted.length; i++) {
    const row = sorted[i]!;
    if (row.rank !== i + 1) return `ranks are not exactly 1 to N at rank ${row.rank}`;
    if (!slugs.has(row.slug)) return `slug ${row.slug} is not in the snapshot`;
    if (seen.has(row.slug)) return `slug ${row.slug} appears twice`;
    seen.add(row.slug);
    if (!(row.implied_value_usd > 0) || row.implied_value_usd > 100_000_000_000_000) {
      return `implied value out of range at ${row.slug}`;
    }
    if (row.implied_value_usd > previous) return `implied value rises at rank ${row.rank}`;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `farm_steps count wrong at ${row.slug}`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `farm step length ${len} at ${row.slug}`;
    }
  }
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `watchlist slug ${slug} is missing from the board`;
  }
  return null;
}
