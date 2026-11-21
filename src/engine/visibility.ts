// Qué puede ver cada jugador. El servidor nunca manda a un jugador el código de una carta
// que no debería conocer: mano y mazo del rival, cartas boca abajo del rival, Extra Deck
// del rival, cartas que el rival mira de su propio mazo…

import { OcgLocation, OcgMessageType, OcgPosition, type OcgMessage } from 'ocgcore-wasm';

const FACEUP = OcgPosition.FACEUP;

/** ¿Ve `viewer` el código de una carta en ese sitio? */
export function canSee(viewer: number, controller: number, location: number, position?: number, isPublic?: boolean): boolean {
  if (isPublic) return true;
  const own = viewer === controller;
  switch (location) {
    case OcgLocation.DECK:
      return false;
    case OcgLocation.HAND:
      return own;
    case OcgLocation.EXTRA:
      return own || (position !== undefined && (position & FACEUP) !== 0);
    case OcgLocation.MZONE:
    case OcgLocation.SZONE:
    case OcgLocation.FZONE:
    case OcgLocation.REMOVED:
      // Boca abajo: solo su controlador la conoce. Sin posición conocida, se asume oculta para el rival.
      return own || (position !== undefined && (position & FACEUP) !== 0);
    case OcgLocation.GRAVE:
    case OcgLocation.OVERLAY:
      return true;
    default:
      return own;
  }
}

interface LocPos {
  controller: number;
  location: number;
  sequence?: number;
  position?: number;
}

const visibleAt = (viewer: number, l: LocPos) => canSee(viewer, l.controller, l.location, l.position);

/** Eventos que se reenvían (el resto son internos o se sustituyen por la vista). */
const FORWARD = new Set<number>([
  OcgMessageType.HINT,
  OcgMessageType.WIN,
  OcgMessageType.CONFIRM_DECKTOP,
  OcgMessageType.CONFIRM_CARDS,
  OcgMessageType.SHUFFLE_DECK,
  OcgMessageType.SHUFFLE_HAND,
  OcgMessageType.SWAP_GRAVE_DECK,
  OcgMessageType.SHUFFLE_SET_CARD,
  OcgMessageType.REVERSE_DECK,
  OcgMessageType.DECK_TOP,
  OcgMessageType.SHUFFLE_EXTRA,
  OcgMessageType.NEW_TURN,
  OcgMessageType.NEW_PHASE,
  OcgMessageType.CONFIRM_EXTRATOP,
  OcgMessageType.MOVE,
  OcgMessageType.POS_CHANGE,
  OcgMessageType.SET,
  OcgMessageType.SWAP,
  OcgMessageType.FIELD_DISABLED,
  OcgMessageType.SUMMONING,
  OcgMessageType.SUMMONED,
  OcgMessageType.SPSUMMONING,
  OcgMessageType.SPSUMMONED,
  OcgMessageType.FLIPSUMMONING,
  OcgMessageType.FLIPSUMMONED,
  OcgMessageType.CHAINING,
  OcgMessageType.CHAINED,
  OcgMessageType.CHAIN_SOLVING,
  OcgMessageType.CHAIN_SOLVED,
  OcgMessageType.CHAIN_END,
  OcgMessageType.CHAIN_NEGATED,
  OcgMessageType.CHAIN_DISABLED,
  OcgMessageType.CARD_SELECTED,
  OcgMessageType.RANDOM_SELECTED,
  OcgMessageType.BECOME_TARGET,
  OcgMessageType.DRAW,
  OcgMessageType.DAMAGE,
  OcgMessageType.RECOVER,
  OcgMessageType.EQUIP,
  OcgMessageType.LPUPDATE,
  OcgMessageType.CARD_TARGET,
  OcgMessageType.CANCEL_TARGET,
  OcgMessageType.PAY_LPCOST,
  OcgMessageType.ADD_COUNTER,
  OcgMessageType.REMOVE_COUNTER,
  OcgMessageType.ATTACK,
  OcgMessageType.BATTLE,
  OcgMessageType.ATTACK_DISABLED,
  OcgMessageType.DAMAGE_STEP_START,
  OcgMessageType.DAMAGE_STEP_END,
  OcgMessageType.MISSED_EFFECT,
  OcgMessageType.TOSS_COIN,
  OcgMessageType.TOSS_DICE,
  OcgMessageType.HAND_RES,
  OcgMessageType.CARD_HINT,
  OcgMessageType.PLAYER_HINT,
]);

/** Versión del evento para `viewer` (null = no le llega). */
export function filterEvent(viewer: number, m: OcgMessage): OcgMessage | null {
  if (!FORWARD.has(m.type)) return null;
  switch (m.type) {
    case OcgMessageType.HINT:
    case OcgMessageType.PLAYER_HINT:
      return m.player === viewer ? m : null;
    case OcgMessageType.DRAW:
      if (m.player === viewer) return m;
      return { ...m, drawn: m.drawn.map((d) => ((d.position & FACEUP) !== 0 ? d : { ...d, code: 0 })) };
    case OcgMessageType.MOVE:
      return visibleAt(viewer, m.from) || visibleAt(viewer, m.to) ? m : { ...m, card: 0 };
    case OcgMessageType.SET:
      return m.controller === viewer ? m : { ...m, code: 0 };
    case OcgMessageType.POS_CHANGE:
      return m.controller === viewer || (m.position & FACEUP) !== 0 || (m.prev_position & FACEUP) !== 0 ? m : { ...m, code: 0 };
    case OcgMessageType.SHUFFLE_HAND:
      return m.player === viewer ? m : { ...m, cards: m.cards.map(() => 0) };
    case OcgMessageType.CONFIRM_CARDS:
      // Se le enseñan a `player`; el dueño también las conoce (salvo que estén en su mazo).
      return {
        ...m,
        cards: m.cards.map((c) =>
          viewer === m.player || (viewer === c.controller && c.location !== OcgLocation.DECK) ? c : { ...c, code: 0 },
        ),
      };
    case OcgMessageType.CONFIRM_EXTRATOP:
      return m.player === viewer ? m : null;
    default:
      return m;
  }
}

/**
 * Copia de una decisión para el jugador que decide, sin códigos de cartas que no debe ver
 * (p. ej. al elegir como objetivo una carta boca abajo del rival).
 * `faceUp(controller, location, sequence)` informa la posición actual de las cartas en el campo.
 */
export function sanitizePrompt(viewer: number, m: OcgMessage, faceUp: (c: number, l: number, s: number) => boolean): OcgMessage {
  const fix = (o: unknown): unknown => {
    if (Array.isArray(o)) return o.map(fix);
    if (!o || typeof o !== 'object') return o;
    const rec = o as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(rec)) out[k] = fix(v);
    if (typeof rec.code === 'number' && typeof rec.controller === 'number' && typeof rec.location === 'number') {
      const c = rec.controller;
      const l = rec.location;
      let pos = typeof rec.position === 'number' ? rec.position : undefined;
      if (pos === undefined && (l === OcgLocation.MZONE || l === OcgLocation.SZONE) && typeof rec.sequence === 'number') {
        pos = faceUp(c, l, rec.sequence) ? OcgPosition.FACEUP_ATTACK : OcgPosition.FACEDOWN_DEFENSE;
      }
      // Tu propio mazo sí lo ves cuando un efecto te deja buscar en él.
      const visible = c === viewer ? true : canSee(viewer, c, l, pos);
      if (!visible) out.code = 0;
    }
    return out;
  };
  return fix(m) as OcgMessage;
}
