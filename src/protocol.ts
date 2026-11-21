// Protocolo cliente <-> servidor de duelos (WebSocket, JSON).
// Los bigint (descripciones de efectos, razas…) viajan como {"$b":"123"} (ver codec).

import type { OcgMessage, OcgResponse } from 'ocgcore-wasm';
import type { Deck } from './engine/ydk.ts';

export const PROTOCOL_VERSION = 2;

/** Sala del lobby (GET /api/rooms, POST /api/rooms). */
export interface RoomInfo {
  /** Código de 5 caracteres. */
  id: string;
  host: string;
  created: number;
}

/** Si un jugador se desconecta durante el duelo, pierde al pasar este tiempo sin volver. */
export const DISCONNECT_FORFEIT_MS = 3 * 60 * 1000;

/** Carta tal como la ve un jugador. code 0 = boca abajo / oculta para él. */
export interface ViewCard {
  code: number;
  position: number;
  attack?: number;
  defense?: number;
  level?: number;
  /** Contadores (tipo -> cantidad). */
  counters?: Record<number, number>;
}

export interface ViewPlayer {
  lp: number;
  deckCount: number;
  extraCount: number;
  /** Mano: cartas propias con código; las del rival con code 0 salvo que sean públicas. */
  hand: ViewCard[];
  /** Zonas de monstruo (5) y de magia/trampa (5) + zona de campo (índice 5). null = vacía. */
  monsters: (ViewCard | null)[];
  spells: (ViewCard | null)[];
  grave: ViewCard[];
  banished: ViewCard[];
  /** Solo el Extra Deck propio lleva códigos. */
  extra: ViewCard[];
}

export interface DuelView {
  /** Tu índice de jugador en el duelo (0 = el que empezó). */
  you: 0 | 1;
  turn: number;
  turnPlayer: 0 | 1;
  phase: number;
  players: [ViewPlayer, ViewPlayer];
  /** Cadena en curso (códigos de las cartas activadas, públicos). */
  chain: { code: number; controller: number; location: number; sequence: number }[];
}

export type ClientMsg =
  | { t: 'join'; v: number; name: string; deck: Deck; token?: string }
  | { t: 'respond'; seq: number; response: OcgResponse }
  | { t: 'surrender' }
  /** La app pasó a segundo plano (true) o volvió (false). */
  | { t: 'away'; away: boolean }
  /** Salir de una sala que aún no ha empezado. */
  | { t: 'leave' }
  | { t: 'ping' }
  /** Solo en desarrollo. */
  | { t: 'debug-restore' };

export type ServerMsg =
  | { t: 'joined'; seat: 0 | 1; token: string; opponent: string | null }
  | {
      t: 'opponent';
      name: string | null;
      connected: boolean;
      /** Tiene la app en segundo plano. */
      away?: boolean;
      /** Si no vuelve, pierde en este momento (ms desde 1970). */
      forfeitAt?: number;
    }
  | { t: 'deck-invalid'; problems: string[] }
  | {
      t: 'update';
      /** Número de decisión: la respuesta debe llevar el mismo. */
      seq: number;
      view: DuelView;
      /** Eventos desde la última actualización, ya filtrados para este jugador. */
      events: OcgMessage[];
      /** Decisión pendiente PARA TI (null si no te toca). */
      prompt: OcgMessage | null;
      /** Quién tiene que decidir (null si nadie: duelo terminado). */
      waitingFor: 0 | 1 | null;
      /** La respuesta anterior no era válida: vuelve a decidir. */
      retry?: boolean;
    }
  | { t: 'ended'; winner: 0 | 1 | null; reason: string }
  | { t: 'error'; message: string }
  | { t: 'pong' };
