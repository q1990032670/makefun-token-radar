// Token launch radar: the program behind the dashboard.
//
// Reads the sealed DefiLlama snapshot, values every protocol that
// records no token with the peer-multiple model in lib/model.ts, and
// writes the ranked board, the dashboard's data file, a copy of the
// dashboard and screenshots, and finally the dossier the judge reads.
//
// Run locally with:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <kit>/input/snapshot.json
// In the grader the snapshot is at /input/snapshot.json and the output
// directory is /output; both can be overridden with --input/--output.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** Read a `--name value` or `--name=value` argument, else the fallback. */
function readArg(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < args.length) return args[at + 1]!;
  const inline = args.find((a) => a.startsWith(`--${name}=`));
  return inline === undefined ? fallback : inline.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token-radar: ${message}\n`);
  process.exit(1);
}

const inputArg = readArg('input', '/input');
const inputPath = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputPath)) {
  fail(`no snapshot at ${inputPath}: pass --input <snapshot.json|dir> or mount the sealed /input`);
}
const outputDir = readArg('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputPath, 'utf8'));
const { board, radar } = buildRadar(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model produced a board the gate refuses: ${issue}`);

mkdirSync(outputDir, { recursive: true });
// Compact single-line JSON on purpose: the board is machine-read data,
// not source anyone reads by eye, so it is written with no indentation.
// The dossier from buildDossier is already a single canonical line.
writeFileSync(join(outputDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outputDir, 'data.js'), dataScript(radar));

/** Copy every regular, plainly named file of a directory; returns names. */
function copyDirectory(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith('.')) continue;
    const source = join(from, name);
    if (!statSync(source).isFile()) continue;
    copyFileSync(source, join(to, name));
    copied.push(name);
  }
  return copied.sort();
}

const dashboardFiles = copyDirectory(join(repoRoot, 'dashboard'), join(outputDir, 'dashboard'));
if (!dashboardFiles.includes('index.html')) fail('dashboard/ holds no index.html');

const shots = copyDirectory(join(repoRoot, 'screenshots'), join(outputDir, 'screenshots'));
if (shots.length < 3) {
  fail(`screenshots/ holds ${shots.length} images: hand in 3 (board, detail view, filtered view)`);
}
for (const name of shots) {
  if (!PLAIN_NAME.test(name)) fail(`screenshots/${name}: not a plain file name`);
}

// The dossier goes last: the scorer rebuilds it from this same output
// directory and compares it byte for byte, so nothing may change after.
writeFileSync(
  join(outputDir, 'dossier.json'),
  buildDossier(outputDir, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  }),
);

const watchlistRows = board.filter((row) => row.on_watchlist).length;
const top = board[0];
if (top !== undefined) {
  process.stdout.write(
    `token-radar: top of the board is ${top.name} at $${top.implied_value_usd.toLocaleString('en-US')} implied value\n`,
  );
}
process.stdout.write(
  `token-radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist\n` +
    `token-radar: board holds ${board.length} rows, ${watchlistRows} of them watchlist protocols\n` +
    `token-radar: wrote board.json, data.js, dashboard/ (${dashboardFiles.length} files), ` +
    `screenshots/ (${shots.length} images) and dossier.json into ${outputDir}\n`,
);
