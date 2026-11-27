// Simula muchos torneos al azar y comprueba las reglas: sin revanchas en Swiss mientras se pueda,
// un bye como máximo por jugador, cuadros correctos, round robin completo y un campeón al final.
//   node test/tournament.ts

import {
  advance,
  blockReason,
  champion,
  createTournament,
  currentRound,
  finalRanking,
  matchStake,
  type Format,
  nextStep,
  repair,
  roundRobinSchedule,
  seedOrder,
  setDropped,
  setResult,
  standings,
  start,
  swissTotal,
  type Tournament,
} from '../src/tournament/logic.ts';

let seed = 12345;
const rng = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
let fails = 0;
const check = (c: boolean, msg: string) => {
  if (!c) {
    fails++;
    console.log('FALLO', msg);
  }
};

check(JSON.stringify(seedOrder(8)) === '[1,8,4,5,2,7,3,6]', 'orden de cabezas de serie de 8');
for (const n of [2, 3, 4, 5, 8, 9]) {
  const s = roundRobinSchedule(Array.from({ length: n }, (_, i) => `p${i}`));
  const seen = new Set<string>();
  for (const r of s) for (const [a, b] of r) if (b) seen.add([a, b].sort().join());
  check(seen.size === (n * (n - 1)) / 2, `round robin de ${n}: todos contra todos`);
}

function play(t: Tournament, dropChance = 0) {
  let guard = 0;
  while (t.status === 'running' && guard++ < 100) {
    const r = currentRound(t)!;
    if (guard === 2 && r.stage === 'swiss') repair(t, rng);
    for (const m of currentRound(t)!.matches) {
      if (m.b === null || m.ga !== null) continue;
      const x = rng();
      const elim = r.stage === 'elim';
      if (t.bestOf === 3) {
        const opts: [number, number][] = elim ? [[2, 0], [2, 1], [1, 2], [0, 2]] : [[2, 0], [2, 1], [1, 2], [0, 2], [1, 1]];
        const [a, b] = opts[Math.floor(x * opts.length)]!;
        setResult(t, m.table, a, b);
      } else setResult(t, m.table, x < 0.45 ? 1 : x < 0.9 || elim ? 0 : 0, x < 0.45 ? 0 : x < 0.9 || elim ? 1 : 0);
    }
    if (dropChance && rng() < dropChance) {
      const alive = t.players.filter((p) => !p.dropped);
      if (alive.length > 4) setDropped(t, alive[Math.floor(rng() * alive.length)]!.id, true);
    }
    check(blockReason(t) === null, `${t.name}: ronda completa (${blockReason(t)})`);
    advance(t, rng);
  }
  check(t.status === 'done', `${t.name}: terminó`);
}

let n = 0;
for (const format of ['swiss', 'single', 'roundrobin'] as Format[])
  for (const players of [2, 3, 4, 5, 7, 8, 9, 13, 16, 24, 33])
    for (const bestOf of [1, 3] as const)
      for (const topCut of format === 'single' ? [0] : ([0, 4, 8] as const))
      for (const placements of [false, true]) {
        if (format === 'roundrobin' && players > 13) continue;
        if (placements && format !== 'single' && !topCut) continue;
        const t = createTournament({ name: `${format}-${players}-bo${bestOf}-top${topCut}${placements ? '-places' : ''}`, format, bestOf, swissRounds: 0, topCut: topCut as 0 | 4 | 8, roundMinutes: 40, placements }, rng);
        for (let i = 0; i < players; i++) t.players.push({ id: `p${i}`, name: `P${i}`, deck: '', notes: '', dropped: false });
        start(t, rng);
        play(t, format === 'swiss' && players > 8 ? 0.15 : 0);
        n++;
        // Byes y revanchas en Swiss.
        const sw = t.rounds.filter((r) => r.stage === 'swiss');
        if (format === 'swiss') {
          check(sw.length === swissTotal(t), `${t.name}: ${sw.length} rondas de Swiss`);
          const byes = new Map<string, number>();
          const pairs = new Set<string>();
          let rematches = 0;
          for (const r of sw)
            for (const m of r.matches) {
              if (m.b === null) byes.set(m.a, (byes.get(m.a) ?? 0) + 1);
              else {
                const k = [m.a, m.b].sort().join();
                if (pairs.has(k)) rematches++;
                pairs.add(k);
              }
            }
          if (sw.length < players) check([...byes.values()].every((v) => v <= 1), `${t.name}: un bye por jugador`);
          if (players >= 8) check(rematches === 0, `${t.name}: sin revanchas (${rematches})`);
        }
        // Cada jugador aparece una vez por ronda.
        for (const r of t.rounds) {
          const ids = r.matches.flatMap((m) => [m.a, m.b].filter(Boolean));
          check(new Set(ids).size === ids.length, `${t.name}: nadie juega dos veces en una ronda`);
        }
        const elim = t.rounds.filter((r) => r.stage === 'elim');
        if (format === 'single' || topCut) {
          const cut = format === 'single' ? players : Math.min(topCut, t.players.filter((p) => !p.dropped).length);
          check(elim.length === Math.ceil(Math.log2(cut)), `${t.name}: ${elim.length} rondas de eliminación para ${cut}`);
          if (!placements) check(elim[elim.length - 1]!.matches.length === 1, `${t.name}: final de un partido`);
          else {
            // Todos los del cuadro juegan todas las rondas y acaban con puestos 1..N distintos.
            const ids = Object.keys(t.elimSlots!);
            for (const r of elim) check(ids.every((id) => r.matches.some((m) => m.a === id || m.b === id)), `${t.name}: todos juegan cada ronda del cuadro`);
            const places = finalRanking(t).slice(0, ids.length).map((x) => x.place).join();
            check(places === ids.map((_, i) => String(i + 1)).join(), `${t.name}: puestos ${places}`);
            const last = elim[elim.length - 1]!;
            check(matchStake(t, last.matches[0]!) === 'Final', `${t.name}: la primera mesa de la última ronda es la final`);
            if (ids.length >= 4) check(last.matches.some((m) => matchStake(t, m) === '3rd place match'), `${t.name}: hay partido por el 3.º`);
          }
        }
        check(champion(t) !== null, `${t.name}: hay campeón`);
        const fr = finalRanking(t);
        check(fr.length === players && fr[0]!.id === champion(t), `${t.name}: el campeón va primero en la clasificación final`);
        check(standings(t).length === players, `${t.name}: clasificación completa`);
        check(nextStep(t) !== 'start', `${t.name}: estado`);
      }
console.log(`${n} torneos simulados · ${fails ? `${fails} fallos` : 'todo correcto'}`);
process.exit(fails ? 1 : 0);
