// Torneos en persona: Swiss (con top cut opcional), eliminación directa y round robin.
// Lógica pura (sin DOM) para poder probarla aparte. Puntuación estándar de TCG: victoria 3,
// empate 1, derrota 0; el bye cuenta como victoria 2-0 (o 1-0 a una partida).
// Desempates: puntos → OMW% → OOMW% → GW% (los porcentajes con mínimo de 33 %, como es costumbre).

export type Format = 'swiss' | 'single' | 'roundrobin';
export type Stage = 'swiss' | 'rr' | 'elim';
export type Status = 'setup' | 'running' | 'done';

export interface Player {
  id: string;
  name: string;
  deck: string;
  notes: string;
  dropped: boolean;
}

export interface Match {
  table: number;
  a: string;
  /** null = bye. */
  b: string | null;
  /** Partidas ganadas por cada lado; null = sin resultado. */
  ga: number | null;
  gb: number | null;
  /** Eliminación: camino previo de los dos ('W'/'L' por ronda), que dice por qué puesto juegan. */
  path?: string;
}

export interface Round {
  stage: Stage;
  matches: Match[];
}

export interface Tournament {
  v: 1;
  id: string;
  name: string;
  createdAt: number;
  format: Format;
  bestOf: 1 | 3;
  /** Rondas de Swiss; 0 = automático según el número de jugadores. */
  swissRounds: number;
  /** Corte a eliminación directa tras Swiss o round robin (0 = sin corte). */
  topCut: 0 | 2 | 4 | 8 | 16;
  /** En eliminación, los que pierden siguen jugando por los puestos de abajo hasta definirlos todos. */
  placements?: boolean;
  /** Cuadro de eliminación: tamaño (potencia de 2) y hueco de cada jugador. */
  elimSize?: number;
  elimSlots?: Record<string, number>;
  roundMinutes: number;
  status: Status;
  players: Player[];
  rounds: Round[];
  /** Calendario del round robin (pares de ids por ronda), fijado al empezar. */
  rrSchedule?: [string, string | null][][];
  /** Reloj de la ronda: hora de fin si corre, o ms que quedan si está en pausa. */
  timerEnd?: number | null;
  timerLeft?: number | null;
}

export interface Standing {
  id: string;
  rank: number;
  points: number;
  w: number;
  l: number;
  d: number;
  byes: number;
  mwp: number;
  omw: number;
  oomw: number;
  gwp: number;
}

export type Rng = () => number;

export const cryptoRng: Rng = () => crypto.getRandomValues(new Uint32Array(1))[0]! / 2 ** 32;

export function shuffle<T>(a: T[], rng: Rng): T[] {
  const r = a.slice();
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [r[i], r[j]] = [r[j]!, r[i]!];
  }
  return r;
}

export const newId = (rng: Rng = cryptoRng) => Math.floor(rng() * 2 ** 32).toString(36) + Date.now().toString(36).slice(-4);

export function createTournament(o: Pick<Tournament, 'name' | 'format' | 'bestOf' | 'swissRounds' | 'topCut' | 'roundMinutes' | 'placements'>, rng: Rng = cryptoRng): Tournament {
  return { v: 1, id: newId(rng), createdAt: Date.now(), status: 'setup', players: [], rounds: [], ...o };
}

export const FORMAT_LABEL: Record<Format, string> = {
  swiss: 'Swiss rounds',
  single: 'Single elimination',
  roundrobin: 'Round robin',
};

/** Rondas de Swiss recomendadas para `n` jugadores. */
export const suggestedSwissRounds = (n: number) => (n <= 1 ? 1 : Math.max(1, Math.ceil(Math.log2(n))));

export const swissTotal = (t: Tournament) => (t.swissRounds > 0 ? t.swissRounds : suggestedSwissRounds(t.players.filter((p) => !p.dropped).length || t.players.length));

export const isBye = (m: Match) => m.b === null;
export const reported = (m: Match) => m.ga !== null && m.gb !== null;

/** Ganador del enfrentamiento: id, 'draw' o null si falta el resultado. */
export function winnerOf(m: Match): string | 'draw' | null {
  if (m.b === null) return m.a;
  if (m.ga === null || m.gb === null) return null;
  return m.ga > m.gb ? m.a : m.gb > m.ga ? m.b : 'draw';
}

export const currentRound = (t: Tournament): Round | null => t.rounds[t.rounds.length - 1] ?? null;
const byeMatch = (t: Tournament, id: string, table: number): Match => ({ table, a: id, b: null, ga: t.bestOf === 3 ? 2 : 1, gb: 0 });
const activeIds = (t: Tournament) => t.players.filter((p) => !p.dropped).map((p) => p.id);

// ---------------------------------------------------------------- clasificación

export function standings(t: Tournament): Standing[] {
  const rows = new Map<string, Standing & { opps: string[]; gw: number; gp: number }>();
  for (const p of t.players) rows.set(p.id, { id: p.id, rank: 0, points: 0, w: 0, l: 0, d: 0, byes: 0, mwp: 0, omw: 0, oomw: 0, gwp: 0, opps: [], gw: 0, gp: 0 });
  for (const r of t.rounds) {
    if (r.stage === 'elim') continue;
    for (const m of r.matches) {
      const a = rows.get(m.a);
      if (!a) continue;
      if (m.b === null) {
        a.points += 3;
        a.w++;
        a.byes++;
        continue;
      }
      const b = rows.get(m.b);
      const win = winnerOf(m);
      if (!b || win === null) continue;
      a.opps.push(m.b);
      b.opps.push(m.a);
      a.gw += m.ga!;
      b.gw += m.gb!;
      a.gp += m.ga! + m.gb!;
      b.gp += m.ga! + m.gb!;
      if (win === 'draw') {
        a.points++;
        b.points++;
        a.d++;
        b.d++;
      } else {
        const [wr, lr] = win === m.a ? [a, b] : [b, a];
        wr.points += 3;
        wr.w++;
        lr.l++;
      }
    }
  }
  const floor = (x: number) => Math.max(1 / 3, x);
  for (const s of rows.values()) {
    const played = s.w + s.l + s.d - s.byes;
    // MW% sin contar los byes (como hacen los organizadores).
    s.mwp = played > 0 ? floor((s.points - 3 * s.byes) / (3 * played)) : 1 / 3;
    s.gwp = s.gp > 0 ? floor(s.gw / s.gp) : 1 / 3;
  }
  for (const s of rows.values()) s.omw = s.opps.length ? avg(s.opps.map((o) => rows.get(o)!.mwp)) : 0;
  for (const s of rows.values()) s.oomw = s.opps.length ? avg(s.opps.map((o) => rows.get(o)!.omw)) : 0;
  const list = [...rows.values()];
  const order = new Map(t.players.map((p, i) => [p.id, i]));
  list.sort((x, y) => y.points - x.points || y.omw - x.omw || y.oomw - x.oomw || y.gwp - x.gwp || order.get(x.id)! - order.get(y.id)!);
  list.forEach((s, i) => {
    const prev = list[i - 1];
    s.rank = prev && prev.points === s.points && prev.omw === s.omw && prev.oomw === s.oomw && prev.gwp === s.gwp ? prev.rank : i + 1;
  });
  return list.map(({ opps: _o, gw: _g, gp: _p, ...s }) => s);
}

const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Pares ya jugados (para no repetir enfrentamientos en Swiss). */
function playedPairs(t: Tournament): Set<string> {
  const s = new Set<string>();
  for (const r of t.rounds) for (const m of r.matches) if (m.b) s.add(pairKey(m.a, m.b));
  return s;
}
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);

// ---------------------------------------------------------------- Swiss

/**
 * Empareja una ronda de Swiss: ordena por puntos (empates al azar), da el bye al peor clasificado
 * que aún no lo tuvo y empareja de arriba abajo evitando revanchas (con vuelta atrás).
 */
export function pairSwiss(t: Tournament, rng: Rng = cryptoRng): Round {
  const st = new Map(standings(t).map((s) => [s.id, s]));
  let ids = shuffle(activeIds(t), rng).sort((x, y) => st.get(y)!.points - st.get(x)!.points);
  const matches: Match[] = [];
  let bye: string | null = null;
  if (ids.length % 2 === 1) {
    for (let i = ids.length - 1; i >= 0; i--) {
      if (st.get(ids[i]!)!.byes === 0) {
        bye = ids[i]!;
        break;
      }
    }
    bye ??= ids[ids.length - 1]!;
    ids = ids.filter((x) => x !== bye);
  }
  const played = playedPairs(t);
  const pairs = pairUp(ids, played) ?? greedy(ids);
  pairs.forEach(([a, b], i) => matches.push({ table: i + 1, a, b, ga: null, gb: null }));
  if (bye) matches.push(byeMatch(t, bye, matches.length + 1));
  return { stage: 'swiss', matches };
}

function pairUp(ids: string[], played: Set<string>): [string, string][] | null {
  let budget = 20000;
  const go = (rest: string[]): [string, string][] | null => {
    if (!rest.length) return [];
    if (--budget < 0) return null;
    const [first, ...others] = rest;
    for (let i = 0; i < others.length; i++) {
      const b = others[i]!;
      if (played.has(pairKey(first!, b))) continue;
      const sub = go([...others.slice(0, i), ...others.slice(i + 1)]);
      if (sub) return [[first!, b], ...sub];
    }
    return null;
  };
  return go(ids);
}

function greedy(ids: string[]): [string, string][] {
  const r: [string, string][] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) r.push([ids[i]!, ids[i + 1]!]);
  return r;
}

// ---------------------------------------------------------------- round robin

/** Calendario de todos contra todos (método del círculo). */
export function roundRobinSchedule(ids: string[]): [string, string | null][][] {
  const list: (string | null)[] = ids.length % 2 ? [...ids, null] : ids.slice();
  const n = list.length;
  const rounds: [string, string | null][][] = [];
  for (let r = 0; r < n - 1; r++) {
    const round: [string, string | null][] = [];
    for (let i = 0; i < n / 2; i++) {
      const x = list[i]!;
      const y = list[n - 1 - i]!;
      if (x === null && y === null) continue;
      round.push(x === null ? [y!, null] : y === null ? [x, null] : [x, y]);
    }
    rounds.push(round);
    list.splice(1, 0, list.pop()!);
  }
  return rounds;
}

function rrRound(t: Tournament, k: number): Round {
  const dropped = new Set(t.players.filter((p) => p.dropped).map((p) => p.id));
  const matches: Match[] = [];
  const byes: string[] = [];
  for (const [a, b] of t.rrSchedule![k]!) {
    const da = dropped.has(a);
    const db = b === null || dropped.has(b);
    if (da && db) continue;
    if (da) byes.push(b!);
    else if (db) byes.push(a);
    else matches.push({ table: matches.length + 1, a, b, ga: null, gb: null });
  }
  for (const id of byes) matches.push(byeMatch(t, id, matches.length + 1));
  return { stage: 'rr', matches };
}

// ---------------------------------------------------------------- eliminación directa

/** Orden de cabezas de serie en un cuadro de `size` (1 contra size, 2 en la otra mitad…). */
export function seedOrder(size: number): number[] {
  let o = [1];
  while (o.length < size) {
    const n = o.length * 2;
    o = o.flatMap((s) => [s, n + 1 - s]);
  }
  return o;
}

/** Monta el cuadro con los ids ya ordenados por cabeza de serie (los byes a los mejores). */
function bracket(t: Tournament, seeded: string[]): Round {
  let size = 2;
  while (size < seeded.length) size *= 2;
  t.elimSize = size;
  t.elimSlots = {};
  seedOrder(size).forEach((seed, slot) => {
    const id = seeded[seed - 1];
    if (id) t.elimSlots![id] = slot;
  });
  return buildElim(t, 1);
}

export const elimRounds = (t: Tournament) => t.rounds.filter((r) => r.stage === 'elim');
export const elimTotal = (t: Tournament) => Math.round(Math.log2(t.elimSize ?? 2));
export const pathValue = (p: string) => [...p].reduce((v, c) => v * 2 + (c === 'L' ? 1 : 0), 0);

/** Camino de un jugador en el cuadro ('W'/'L' por ronda); null si no aparece en alguna. */
export function elimPath(t: Tournament, id: string, rounds = elimRounds(t)): string | null {
  let p = '';
  for (const r of rounds) {
    const m = r.matches.find((x) => x.a === id || x.b === id);
    if (!m) return null;
    const w = winnerOf(m);
    if (w === null) return p;
    p += w === id ? 'W' : 'L';
  }
  return p;
}

/**
 * Ronda `r` (desde 1) del cuadro. Cada bloque de 2^(r-1) huecos tiene un jugador por camino;
 * se enfrentan los del mismo camino de bloques vecinos. Sin `placements` solo sigue el camino
 * de solo victorias (eliminación directa clásica); con él, los que pierden juegan por los
 * puestos de abajo (3.º-4.º, 5.º-8.º…) hasta que todos quedan definidos.
 */
function buildElim(t: Tournament, r: number): Round {
  const prev = elimRounds(t);
  const groups = new Map<string, { id: string; block: number; path: string }[]>();
  for (const [id, slot] of Object.entries(t.elimSlots ?? {})) {
    const path = elimPath(t, id, prev);
    if (path === null || (!t.placements && path.includes('L'))) continue;
    const block = slot >> (r - 1);
    const key = `${path}|${block >> 1}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ id, block, path });
  }
  const list = [...groups.values()].sort((x, y) => pathValue(x[0]!.path) - pathValue(y[0]!.path) || (x[0]!.block >> 1) - (y[0]!.block >> 1));
  const matches: Match[] = [];
  for (const g of list) {
    g.sort((x, y) => x.block - y.block);
    const table = matches.length + 1;
    const path = g[0]!.path;
    matches.push(g.length === 2 ? { table, a: g[0]!.id, b: g[1]!.id, ga: null, gb: null, path } : { ...byeMatch(t, g[0]!.id, table), path });
  }
  return { stage: 'elim', matches };
}

const bracketName = (left: number) => (left === 2 ? 'Final' : left === 4 ? 'Semifinals' : left === 8 ? 'Quarterfinals' : `Top ${left}`);

/** Nombre de una ronda de eliminación. */
export function elimLabel(t: Tournament, r: Round): string {
  const k = elimRounds(t).indexOf(r) + 1;
  const left = (t.elimSize ?? 2) >> (k - 1);
  return t.placements ? `${bracketName(left)} + placement matches` : bracketName(left);
}

/** Qué se juega en una mesa de eliminación: "Final", "3rd place", "Places 5-8"… */
export function matchStake(t: Tournament, m: Match): string {
  if (m.path === undefined || !t.elimSize) return '';
  const g = t.elimSize >> m.path.length;
  const n = Object.keys(t.elimSlots ?? {}).length;
  const from = 1 + pathValue(m.path) * g;
  const to = Math.min(n, from + g - 1);
  if (from === 1) return g === 2 ? 'Final' : g === 4 ? 'Semifinal' : g === 8 ? 'Quarterfinal' : `Top ${g}`;
  if (to <= from) return `Place ${from}`;
  if (g === 2) return from === 3 ? '3rd place match' : `${ordinal(from)} place match`;
  return `Places ${from}-${to}`;
}

const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

// ---------------------------------------------------------------- avance del torneo

export function roundLabel(t: Tournament, i: number): string {
  const r = t.rounds[i]!;
  if (r.stage === 'elim') return elimLabel(t, r);
  const k = t.rounds.slice(0, i + 1).filter((x) => x.stage === r.stage).length;
  const total = r.stage === 'swiss' ? swissTotal(t) : t.rrSchedule?.length ?? k;
  return `Round ${k} of ${total}`;
}

/** Por qué no se puede pasar a la siguiente ronda (null = se puede). */
export function blockReason(t: Tournament): string | null {
  const r = currentRound(t);
  if (!r) return null;
  const missing = r.matches.filter((m) => !reported(m)).length;
  if (missing) return `${missing} result${missing === 1 ? '' : 's'} missing`;
  if (r.stage === 'elim' && r.matches.some((m) => winnerOf(m) === 'draw')) return 'Elimination matches need a winner';
  return null;
}

export type NextStep = 'start' | 'round' | 'cut' | 'finish';

/** Qué hace el botón principal en este momento. */
export function nextStep(t: Tournament): NextStep {
  if (t.status === 'setup') return 'start';
  const r = currentRound(t);
  if (!r) return 'round';
  if (r.stage === 'elim') return elimRounds(t).length >= elimTotal(t) ? 'finish' : 'round';
  const done = r.stage === 'swiss' ? t.rounds.filter((x) => x.stage === 'swiss').length >= swissTotal(t) : t.rounds.filter((x) => x.stage === 'rr').length >= (t.rrSchedule?.length ?? 0);
  if (!done) return 'round';
  return t.topCut >= 2 && Math.min(t.topCut, activeIds(t).length) >= 2 ? 'cut' : 'finish';
}

export function start(t: Tournament, rng: Rng = cryptoRng): void {
  if (t.status !== 'setup') return;
  const ids = shuffle(activeIds(t), rng);
  if (ids.length < 2) throw new Error('At least 2 players are needed');
  t.status = 'running';
  t.rounds = [];
  // Las rondas automáticas se fijan al empezar (no cambian si alguien se retira).
  if (t.format === 'swiss' && t.swissRounds <= 0) t.swissRounds = suggestedSwissRounds(ids.length);
  if (t.format === 'roundrobin') {
    t.rrSchedule = roundRobinSchedule(ids);
    t.rounds.push(rrRound(t, 0));
  } else if (t.format === 'single') t.rounds.push(bracket(t, ids));
  else t.rounds.push(pairSwiss(t, rng));
  resetTimer(t);
}

/** Pasa a la siguiente ronda, al top cut o termina. */
export function advance(t: Tournament, rng: Rng = cryptoRng): void {
  if (t.status !== 'running' || blockReason(t)) return;
  const step = nextStep(t);
  const r = currentRound(t)!;
  if (step === 'finish') {
    t.status = 'done';
    t.timerEnd = t.timerLeft = null;
    return;
  }
  if (step === 'cut') {
    const top = standings(t)
      .filter((s) => !t.players.find((p) => p.id === s.id)!.dropped)
      .slice(0, t.topCut)
      .map((s) => s.id);
    t.rounds.push(bracket(t, top));
  } else if (r.stage === 'elim') t.rounds.push(buildElim(t, elimRounds(t).length + 1));
  else if (r.stage === 'rr') t.rounds.push(rrRound(t, t.rounds.filter((x) => x.stage === 'rr').length));
  else t.rounds.push(pairSwiss(t, rng));
  // En eliminación, quien se retiró pierde su mesa sin jugar.
  if (currentRound(t)!.stage === 'elim') for (const p of t.players) if (p.dropped) setDropped(t, p.id, true);
  resetTimer(t);
}

/** Vuelve a emparejar la ronda actual (solo Swiss y sin resultados apuntados). */
export function canRepair(t: Tournament): boolean {
  const r = currentRound(t);
  return t.status === 'running' && !!r && r.stage === 'swiss' && r.matches.every((m) => m.b === null || !reported(m));
}

export function repair(t: Tournament, rng: Rng = cryptoRng): void {
  if (!canRepair(t)) return;
  t.rounds.pop();
  t.rounds.push(pairSwiss(t, rng));
}

/** Apunta (o borra con null) el resultado de una mesa de la ronda actual. */
export function setResult(t: Tournament, table: number, ga: number | null, gb: number | null): void {
  const m = currentRound(t)?.matches.find((x) => x.table === table);
  if (!m || m.b === null || t.status !== 'running') return;
  m.ga = ga;
  m.gb = gb;
}

/** Retirar a un jugador: no se le empareja más; en eliminación pierde su mesa pendiente. */
export function setDropped(t: Tournament, id: string, dropped: boolean): void {
  const p = t.players.find((x) => x.id === id);
  if (!p) return;
  p.dropped = dropped;
  const r = currentRound(t);
  if (dropped && t.status === 'running' && r?.stage === 'elim') {
    const m = r.matches.find((x) => (x.a === id || x.b === id) && x.b !== null && !reported(x));
    if (m) {
      const win = t.bestOf === 3 ? 2 : 1;
      [m.ga, m.gb] = m.a === id ? [0, win] : [win, 0];
    }
  }
}

/**
 * Puesto final. Con eliminación: los del cuadro por el camino que hicieron (con puestos jugados,
 * todos distintos; sin ellos, empatados por ronda: "3-4", "5-8"…) y el resto por la clasificación.
 */
export function finalRanking(t: Tournament): { id: string; place: string }[] {
  const er = elimRounds(t);
  const table = standings(t);
  if (!er.length) return table.map((s) => ({ id: s.id, place: String(s.rank) }));
  const pos = new Map(table.map((s, i) => [s.id, i]));
  const done = t.status === 'done';
  const R = elimTotal(t);
  const cut = Object.keys(t.elimSlots ?? {}).map((id) => ({ id, path: elimPath(t, id, er) ?? '' }));
  const out: { id: string; place: string }[] = [];
  if (t.placements) {
    cut.sort((x, y) => pathValue(x.path.padEnd(R, 'W')) - pathValue(y.path.padEnd(R, 'W')) || pos.get(x.id)! - pos.get(y.id)!);
    cut.forEach((c, i) => out.push({ id: c.id, place: done ? String(i + 1) : '—' }));
  } else {
    // Ronda en la que cayó cada uno (o R si ganó todo).
    const fell = (p: string) => (p.includes('L') ? p.indexOf('L') : p.length >= R ? R : -1);
    cut.sort((x, y) => fell(y.path) - fell(x.path) || pos.get(x.id)! - pos.get(y.id)!);
    for (const c of cut) {
      const k = fell(c.path);
      const left = (t.elimSize ?? 2) >> k;
      out.push({ id: c.id, place: k === R ? '1' : k < 0 || (!done && k === R - 1) ? '—' : left === 2 ? '2' : `${left / 2 + 1}-${Math.min(left, cut.length)}` });
    }
  }
  const inCut = new Set(cut.map((c) => c.id));
  for (const s of table) if (!inCut.has(s.id)) out.push({ id: s.id, place: String(out.length + 1) });
  return out;
}

export function champion(t: Tournament): string | null {
  if (t.status !== 'done') return null;
  if (elimRounds(t).length) {
    const R = elimTotal(t);
    return Object.keys(t.elimSlots ?? {}).find((id) => elimPath(t, id) === 'W'.repeat(R)) ?? null;
  }
  return standings(t)[0]?.id ?? null;
}

// ---------------------------------------------------------------- reloj de ronda

export function resetTimer(t: Tournament): void {
  t.timerEnd = null;
  t.timerLeft = t.roundMinutes > 0 ? t.roundMinutes * 60000 : null;
}

export function timerRemaining(t: Tournament, now = Date.now()): number | null {
  if (t.timerEnd) return Math.max(0, t.timerEnd - now);
  return t.timerLeft ?? null;
}

export function toggleTimer(t: Tournament, now = Date.now()): void {
  if (t.timerEnd) {
    t.timerLeft = Math.max(0, t.timerEnd - now);
    t.timerEnd = null;
  } else if (t.timerLeft != null) {
    t.timerEnd = now + t.timerLeft;
  }
}

/** Récord de un jugador (W-L-D) en Swiss/round robin más su marcador en eliminación. */
export function recordOf(t: Tournament, id: string): string {
  let w = 0;
  let l = 0;
  let d = 0;
  for (const r of t.rounds)
    for (const m of r.matches) {
      if (m.a !== id && m.b !== id) continue;
      const win = winnerOf(m);
      if (win === null) continue;
      if (win === 'draw') d++;
      else if (win === id) w++;
      else l++;
    }
  return `${w}-${l}-${d}`;
}
