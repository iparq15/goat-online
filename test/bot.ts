// Bot de pruebas: responde a cualquier decisión del motor con una opción válida al azar
// (con un poco de criterio para que los duelos avancen). Si el motor responde RETRY,
// se vuelve a llamar con `attempt` mayor para variar la respuesta.

import {
  OcgLocation,
  OcgMessageType,
  OcgResponseType,
  SelectBattleCMDAction,
  SelectIdleCMDAction,
  type OcgMessage,
  type OcgPosition,
  type OcgResponse,
} from 'ocgcore-wasm';

export type Rng = () => number;

/** PRNG determinista (mulberry32). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = <T>(rng: Rng, xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)];

function shuffledIndices(rng: Rng, n: number): number[] {
  const a = [...Array(n).keys()];
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function bits(mask: number | bigint): number[] {
  const out: number[] = [];
  const m = BigInt(mask);
  for (let i = 0n; i < 64n; i++) if ((m >> i) & 1n) out.push(Number(i));
  return out;
}

export interface BotState {
  /** Acciones hechas en la fase principal actual (para no quedarse en bucle). */
  idleActions: number;
}

export function botRespond(msg: OcgMessage, rng: Rng, st: BotState, attempt: number, poolCodes: number[]): OcgResponse {
  switch (msg.type) {
    case OcgMessageType.SELECT_IDLECMD: {
      const options: { action: SelectIdleCMDAction; index: number | null }[] = [];
      if (attempt === 0 && st.idleActions < 8) {
        msg.summons.forEach((_, i) => options.push({ action: SelectIdleCMDAction.SELECT_SUMMON, index: i }));
        msg.special_summons.forEach((_, i) => options.push({ action: SelectIdleCMDAction.SELECT_SPECIAL_SUMMON, index: i }));
        msg.monster_sets.forEach((_, i) => options.push({ action: SelectIdleCMDAction.SELECT_MONSTER_SET, index: i }));
        msg.spell_sets.forEach((_, i) => options.push({ action: SelectIdleCMDAction.SELECT_SPELL_SET, index: i }));
        msg.activates.forEach((_, i) => options.push({ action: SelectIdleCMDAction.SELECT_ACTIVATE, index: i }));
        msg.pos_changes.forEach((_, i) => {
          if (rng() < 0.2) options.push({ action: SelectIdleCMDAction.SELECT_POS_CHANGE, index: i });
        });
      }
      const end = msg.to_bp && rng() < 0.85 ? SelectIdleCMDAction.TO_BP : SelectIdleCMDAction.TO_EP;
      if (!options.length || rng() < 0.15) {
        st.idleActions = 0;
        return { type: OcgResponseType.SELECT_IDLECMD, action: end, index: null };
      }
      st.idleActions++;
      return { type: OcgResponseType.SELECT_IDLECMD, ...pick(rng, options) };
    }
    case OcgMessageType.SELECT_BATTLECMD: {
      if (attempt === 0 && msg.attacks.length && rng() < 0.85) {
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: Math.floor(rng() * msg.attacks.length) };
      }
      if (attempt === 0 && msg.chains.length && rng() < 0.3) {
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_CHAIN, index: Math.floor(rng() * msg.chains.length) };
      }
      // Sin poder salir de la batalla (p. ej. Berserk Gorilla debe atacar): atacar.
      if (!msg.to_m2 && !msg.to_ep && msg.attacks.length) {
        return { type: OcgResponseType.SELECT_BATTLECMD, action: SelectBattleCMDAction.SELECT_BATTLE, index: attempt % msg.attacks.length };
      }
      return {
        type: OcgResponseType.SELECT_BATTLECMD,
        action: msg.to_m2 ? SelectBattleCMDAction.TO_M2 : SelectBattleCMDAction.TO_EP,
        index: null,
      };
    }
    case OcgMessageType.SELECT_EFFECTYN:
      return { type: OcgResponseType.SELECT_EFFECTYN, yes: attempt > 0 ? false : rng() < 0.8 };
    case OcgMessageType.SELECT_YESNO:
      return { type: OcgResponseType.SELECT_YESNO, yes: attempt % 2 === 0 ? rng() < 0.6 : rng() >= 0.6 };
    case OcgMessageType.SELECT_OPTION:
      return { type: OcgResponseType.SELECT_OPTION, index: (Math.floor(rng() * msg.options.length) + attempt) % msg.options.length };
    case OcgMessageType.SELECT_CARD: {
      const n = Math.min(msg.selects.length, msg.min + (attempt > 0 ? attempt % Math.max(1, msg.max - msg.min + 1) : 0));
      return { type: OcgResponseType.SELECT_CARD, indicies: shuffledIndices(rng, msg.selects.length).slice(0, Math.max(n, msg.min)) };
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      if ((msg.can_finish || msg.can_cancel) && (msg.select_cards.length === 0 || (msg.can_finish && rng() < 0.3))) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: null };
      }
      if (msg.select_cards.length) {
        return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: Math.floor(rng() * msg.select_cards.length) };
      }
      return { type: OcgResponseType.SELECT_UNSELECT_CARD, index: msg.select_cards.length + Math.floor(rng() * msg.unselect_cards.length) };
    }
    case OcgMessageType.SELECT_CHAIN: {
      if (msg.forced && msg.selects.length) return { type: OcgResponseType.SELECT_CHAIN, index: Math.floor(rng() * msg.selects.length) };
      if (attempt === 0 && msg.selects.length && rng() < 0.35) {
        return { type: OcgResponseType.SELECT_CHAIN, index: Math.floor(rng() * msg.selects.length) };
      }
      return { type: OcgResponseType.SELECT_CHAIN, index: null };
    }
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      // field_mask: bit a 1 = zona NO disponible. 0-4 monstruos, 8-12 magias/trampas;
      // +16 = el rival (relativo al jugador que decide).
      const free: { player: number; location: OcgLocation; sequence: number }[] = [];
      for (let bit = 0; bit < 32; bit++) {
        if ((msg.field_mask >>> bit) & 1) continue;
        const rel = bit >= 16 ? 1 : 0;
        const b = bit % 16;
        let location: OcgLocation | null = null;
        let sequence = 0;
        if (b < 5) {
          location = OcgLocation.MZONE;
          sequence = b;
        } else if (b >= 8 && b < 13) {
          location = OcgLocation.SZONE;
          sequence = b - 8;
        }
        if (location !== null) free.push({ player: rel ? 1 - msg.player : msg.player, location, sequence });
      }
      const places = shuffledIndices(rng, free.length)
        .slice(0, msg.count)
        .map((i) => free[i]);
      return { type: msg.type === OcgMessageType.SELECT_PLACE ? OcgResponseType.SELECT_PLACE : OcgResponseType.SELECT_DISFIELD, places } as OcgResponse;
    }
    case OcgMessageType.SELECT_POSITION: {
      const options = bits(msg.positions);
      return { type: OcgResponseType.SELECT_POSITION, position: (1 << options[(Math.floor(rng() * options.length) + attempt) % options.length]) as OcgPosition };
    }
    case OcgMessageType.SELECT_TRIBUTE: {
      const order = shuffledIndices(rng, msg.selects.length);
      const chosen: number[] = [];
      let sum = 0;
      for (const i of order) {
        if (sum >= msg.min) break;
        chosen.push(i);
        sum += Math.max(1, msg.selects[i].release_param & 0xff);
      }
      return { type: OcgResponseType.SELECT_TRIBUTE, indicies: chosen };
    }
    case OcgMessageType.SELECT_SUM: {
      // Subconjunto de `selects` (más los obligatorios) cuya suma (de cualquiera de los
      // dos valores de cada carta) sea `amount` (o >= si select_max).
      const must = msg.selects_must.map((c) => [c.amount & 0xffff, (c.amount >>> 16) & 0xffff]);
      const opts = msg.selects.map((c) => [c.amount & 0xffff, (c.amount >>> 16) & 0xffff]);
      const sumOf = (vals: number[][]) => {
        let sums = new Set([0]);
        for (const [a, b] of vals) {
          const next = new Set<number>();
          for (const s of sums) {
            next.add(s + a);
            if (b) next.add(s + b);
          }
          sums = next;
        }
        return sums;
      };
      const ok = (sums: Set<number>) => [...sums].some((s) => (msg.select_max ? s >= msg.amount : s === msg.amount));
      const order = shuffledIndices(rng, opts.length);
      for (let size = 1; size <= opts.length; size++) {
        // Búsqueda simple: combinaciones en orden aleatorio, tamaño creciente.
        const combo = findCombo(order, size, (idx) => ok(sumOf([...must, ...idx.map((i) => opts[i])])));
        if (combo) return { type: OcgResponseType.SELECT_SUM, indicies: combo.map((i) => i + msg.selects_must.length) };
      }
      return { type: OcgResponseType.SELECT_SUM, indicies: [] };
    }
    case OcgMessageType.SELECT_COUNTER: {
      const counters = msg.cards.map(() => 0);
      let left = msg.count;
      for (let i = 0; i < msg.cards.length && left > 0; i++) {
        const take = Math.min(left, msg.cards[i].count);
        counters[i] = take;
        left -= take;
      }
      return { type: OcgResponseType.SELECT_COUNTER, counters };
    }
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      return { type: OcgResponseType.SORT_CARD, order: null };
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      return { type: OcgResponseType.ROCK_PAPER_SCISSORS, value: (1 + Math.floor(rng() * 3)) as 1 | 2 | 3 };
    case OcgMessageType.ANNOUNCE_RACE: {
      const avail = bits(msg.available);
      return { type: OcgResponseType.ANNOUNCE_RACE, races: shuffledIndices(rng, avail.length).slice(0, msg.count).map((i) => 1n << BigInt(avail[i])) } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_ATTRIB: {
      const avail = bits(msg.available);
      return { type: OcgResponseType.ANNOUNCE_ATTRIB, attributes: shuffledIndices(rng, avail.length).slice(0, msg.count).map((i) => 1 << avail[i]) } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_CARD:
      return { type: OcgResponseType.ANNOUNCE_CARD, card: poolCodes[(Math.floor(rng() * poolCodes.length) + attempt * 7919) % poolCodes.length] };
    case OcgMessageType.ANNOUNCE_NUMBER:
      return { type: OcgResponseType.ANNOUNCE_NUMBER, value: (Math.floor(rng() * msg.options.length) + attempt) % msg.options.length };
    default:
      throw new Error(`Decisión no soportada: ${msg.type}`);
  }
}

function findCombo(order: number[], size: number, test: (idx: number[]) => boolean): number[] | null {
  const cur: number[] = [];
  let tries = 0;
  const rec = (start: number): number[] | null => {
    if (++tries > 20000) return null;
    if (cur.length === size) return test(cur) ? [...cur] : null;
    for (let k = start; k < order.length; k++) {
      cur.push(order[k]);
      const r = rec(k + 1);
      cur.pop();
      if (r) return r;
    }
    return null;
  };
  return rec(0);
}
