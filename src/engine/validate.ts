// Validación de la FORMA de una respuesta antes de dársela al motor.
// Una respuesta con un tipo o índices imposibles puede dejar al motor en mal estado, así
// que el servidor solo le pasa respuestas bien formadas para la decisión pendiente. Que
// sean legales según las reglas lo decide el motor (si no, pide repetir).

import { OcgMessageType, OcgResponseType, type OcgMessage, type OcgResponse } from 'ocgcore-wasm';

const EXPECTED: Partial<Record<number, number[]>> = {
  [OcgMessageType.SELECT_BATTLECMD]: [OcgResponseType.SELECT_BATTLECMD],
  [OcgMessageType.SELECT_IDLECMD]: [OcgResponseType.SELECT_IDLECMD],
  [OcgMessageType.SELECT_EFFECTYN]: [OcgResponseType.SELECT_EFFECTYN],
  [OcgMessageType.SELECT_YESNO]: [OcgResponseType.SELECT_YESNO],
  [OcgMessageType.SELECT_OPTION]: [OcgResponseType.SELECT_OPTION],
  [OcgMessageType.SELECT_CARD]: [OcgResponseType.SELECT_CARD],
  [OcgMessageType.SELECT_CHAIN]: [OcgResponseType.SELECT_CHAIN],
  [OcgMessageType.SELECT_PLACE]: [OcgResponseType.SELECT_PLACE],
  [OcgMessageType.SELECT_DISFIELD]: [OcgResponseType.SELECT_DISFIELD, OcgResponseType.SELECT_PLACE],
  [OcgMessageType.SELECT_POSITION]: [OcgResponseType.SELECT_POSITION],
  [OcgMessageType.SELECT_TRIBUTE]: [OcgResponseType.SELECT_TRIBUTE],
  [OcgMessageType.SORT_CHAIN]: [OcgResponseType.SORT_CARD],
  [OcgMessageType.SORT_CARD]: [OcgResponseType.SORT_CARD],
  [OcgMessageType.SELECT_COUNTER]: [OcgResponseType.SELECT_COUNTER],
  [OcgMessageType.SELECT_SUM]: [OcgResponseType.SELECT_SUM],
  [OcgMessageType.SELECT_UNSELECT_CARD]: [OcgResponseType.SELECT_UNSELECT_CARD],
  [OcgMessageType.ROCK_PAPER_SCISSORS]: [OcgResponseType.ROCK_PAPER_SCISSORS],
  [OcgMessageType.ANNOUNCE_RACE]: [OcgResponseType.ANNOUNCE_RACE],
  [OcgMessageType.ANNOUNCE_ATTRIB]: [OcgResponseType.ANNOUNCE_ATTRIB],
  [OcgMessageType.ANNOUNCE_CARD]: [OcgResponseType.ANNOUNCE_CARD],
  [OcgMessageType.ANNOUNCE_NUMBER]: [OcgResponseType.ANNOUNCE_NUMBER],
};

const int = (x: unknown, min: number, max: number) => Number.isInteger(x) && (x as number) >= min && (x as number) <= max;
const intOrNull = (x: unknown, min: number, max: number) => x === null || int(x, min, max);
const intList = (x: unknown, maxLen: number, min: number, max: number) =>
  Array.isArray(x) && x.length <= maxLen && x.every((v) => int(v, min, max));

/** Devuelve la respuesta normalizada si tiene una forma válida para `pending`, o null. */
export function checkResponse(pending: OcgMessage, raw: unknown): OcgResponse | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const allowed = EXPECTED[pending.type];
  if (!allowed || !allowed.includes(r.type as number)) return null;
  const p = pending as unknown as Record<string, unknown>;
  const len = (k: string) => (Array.isArray(p[k]) ? (p[k] as unknown[]).length : 0);
  const BIG = 1 << 30;

  switch (pending.type) {
    case OcgMessageType.SELECT_IDLECMD:
    case OcgMessageType.SELECT_BATTLECMD:
      if (!int(r.action, 0, 8) || !intOrNull(r.index, 0, 255)) return null;
      return { type: r.type, action: r.action, index: r.index ?? null } as OcgResponse;
    case OcgMessageType.SELECT_EFFECTYN:
    case OcgMessageType.SELECT_YESNO:
      if (typeof r.yes !== 'boolean') return null;
      return { type: r.type, yes: r.yes } as OcgResponse;
    case OcgMessageType.SELECT_OPTION:
      if (!int(r.index, 0, len('options') - 1)) return null;
      return { type: r.type, index: r.index } as OcgResponse;
    case OcgMessageType.SELECT_CARD:
      if (r.indicies !== null && !intList(r.indicies, len('selects'), 0, len('selects') - 1)) return null;
      return { type: r.type, indicies: r.indicies } as OcgResponse;
    case OcgMessageType.SELECT_TRIBUTE:
      if (r.indicies !== null && !intList(r.indicies, len('selects'), 0, len('selects') - 1)) return null;
      return { type: r.type, indicies: r.indicies } as OcgResponse;
    case OcgMessageType.SELECT_SUM: {
      const n = len('selects_must') + len('selects');
      if (!intList(r.indicies, n, 0, n - 1)) return null;
      return { type: r.type, indicies: r.indicies } as OcgResponse;
    }
    case OcgMessageType.SELECT_UNSELECT_CARD: {
      const n = len('select_cards') + len('unselect_cards');
      if (!intOrNull(r.index, 0, n - 1)) return null;
      return { type: r.type, index: r.index } as OcgResponse;
    }
    case OcgMessageType.SELECT_CHAIN:
      if (!intOrNull(r.index, 0, len('selects') - 1)) return null;
      return { type: r.type, index: r.index } as OcgResponse;
    case OcgMessageType.SELECT_PLACE:
    case OcgMessageType.SELECT_DISFIELD: {
      const places = r.places;
      if (!Array.isArray(places) || places.length > 10) return null;
      const ok = places.every((pl) => pl && typeof pl === 'object' && int(pl.player, 0, 1) && int(pl.location, 1, 0x400) && int(pl.sequence, 0, 7));
      if (!ok) return null;
      return { type: r.type, places: places.map((pl) => ({ player: pl.player, location: pl.location, sequence: pl.sequence })) } as OcgResponse;
    }
    case OcgMessageType.SELECT_POSITION:
      if (![1, 2, 4, 8].includes(r.position as number)) return null;
      return { type: r.type, position: r.position } as OcgResponse;
    case OcgMessageType.SORT_CARD:
    case OcgMessageType.SORT_CHAIN:
      if (r.order !== null && !intList(r.order, len('cards'), 0, len('cards') - 1)) return null;
      return { type: r.type, order: r.order } as OcgResponse;
    case OcgMessageType.SELECT_COUNTER:
      if (!intList(r.counters, len('cards'), 0, 255)) return null;
      return { type: r.type, counters: r.counters } as OcgResponse;
    case OcgMessageType.ROCK_PAPER_SCISSORS:
      if (!int(r.value, 1, 3)) return null;
      return { type: r.type, value: r.value } as OcgResponse;
    case OcgMessageType.ANNOUNCE_RACE: {
      const races = r.races;
      if (!Array.isArray(races) || races.length > 32 || !races.every((x) => typeof x === 'bigint' && x > 0n && x < 1n << 40n)) return null;
      return { type: r.type, races } as OcgResponse;
    }
    case OcgMessageType.ANNOUNCE_ATTRIB:
      if (!intList(r.attributes, 8, 1, 0x7f)) return null;
      return { type: r.type, attributes: r.attributes } as OcgResponse;
    case OcgMessageType.ANNOUNCE_CARD:
      if (!int(r.card, 1, BIG)) return null;
      return { type: r.type, card: r.card } as OcgResponse;
    case OcgMessageType.ANNOUNCE_NUMBER:
      if (!int(r.value, 0, len('options') - 1)) return null;
      return { type: r.type, value: r.value } as OcgResponse;
  }
  return null;
}
