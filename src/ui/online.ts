// Duelos online: lobby (salas públicas, crear sala, unirse con código o enlace), sala de
// espera y el duelo contra otra persona por WebSocket, con reconexión automática y aviso al
// rival cuando la app pasa a segundo plano (iOS la congela).

import { decode, encode } from '../codec.ts';
import type { GoatData } from '../engine/data.ts';
import { validateDeck, type Deck } from '../engine/ydk.ts';
import { PROTOCOL_VERSION, type ClientMsg, type RoomInfo, type ServerMsg } from '../protocol.ts';
import { listDecks } from './deck-store.ts';
import { DuelClient } from './duel-client.ts';
import { STARTER_DECKS, type NamedDeck } from './starter-decks.ts';
import { esc } from './text.ts';
import { keepAwake } from './wake.ts';

const API = '/api';
const SESSION_KEY = 'goat.session';

/** Duelo online en curso (para volver a él si se cierra la app). */
interface Session {
  room: string;
  token: string;
  name: string;
  deck: Deck;
}

const ls = {
  get<T>(k: string): T | null {
    try {
      const v = localStorage.getItem(k);
      return v ? (JSON.parse(v) as T) : null;
    } catch {
      return null;
    }
  },
  set(k: string, v: unknown): void {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, JSON.stringify(v));
    } catch {
      /* sin almacenamiento */
    }
  },
};

export const savedSession = () => ls.get<Session>(SESSION_KEY);
const clearSession = () => ls.set(SESSION_KEY, null);

// ---------- conexión ----------

/**
 * WebSocket con la sala que se reconecta sola (con el token del asiento) si se corta, y avisa
 * al rival cuando la app pasa a segundo plano.
 */
class OnlineLink {
  private ws: WebSocket | null = null;
  private closed = false;
  private retries = 0;
  private retryTimer = 0;
  private pingTimer = 0;
  private room: string;
  private joinMsg: () => ClientMsg;
  private onMessage: (m: ServerMsg) => void;
  private onStatus: (connected: boolean) => void;
  private onVisibility = () => this.visibility();

  constructor(room: string, joinMsg: () => ClientMsg, onMessage: (m: ServerMsg) => void, onStatus: (connected: boolean) => void) {
    this.room = room;
    this.joinMsg = joinMsg;
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    document.addEventListener('visibilitychange', this.onVisibility);
    window.addEventListener('pageshow', this.onVisibility);
    this.open();
  }

  private open(): void {
    if (this.closed) return;
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}${API}/duel/${this.room}`);
    this.ws = ws;
    ws.onopen = () => {
      this.retries = 0;
      ws.send(encode(this.joinMsg()));
      if (document.visibilityState === 'hidden') ws.send(encode({ t: 'away', away: true } satisfies ClientMsg));
      this.onStatus(true);
      clearInterval(this.pingTimer);
      this.pingTimer = window.setInterval(() => this.send({ t: 'ping' }), 25000);
    };
    ws.onmessage = (e) => {
      try {
        this.onMessage(decode<ServerMsg>(String(e.data)));
      } catch {
        /* mensaje roto */
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      clearInterval(this.pingTimer);
      this.ws = null;
      if (this.closed) return;
      this.onStatus(false);
      // Reintentos: 0,5 s, 1 s, 2 s… hasta 8 s.
      const delay = Math.min(8000, 500 * 2 ** this.retries++);
      clearTimeout(this.retryTimer);
      this.retryTimer = window.setTimeout(() => this.open(), delay);
    };
  }

  private visibility(): void {
    if (this.closed) return;
    const hidden = document.visibilityState === 'hidden';
    if (!hidden && (!this.ws || this.ws.readyState > WebSocket.OPEN)) {
      // Al volver a la app: reconectar ya, sin esperar al siguiente reintento.
      clearTimeout(this.retryTimer);
      this.retries = 0;
      this.ws?.close();
      this.ws = null;
      this.open();
      return;
    }
    this.send({ t: 'away', away: hidden });
  }

  send(m: ClientMsg): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(encode(m));
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.retryTimer);
    clearInterval(this.pingTimer);
    document.removeEventListener('visibilitychange', this.onVisibility);
    window.removeEventListener('pageshow', this.onVisibility);
    this.ws?.close();
    this.ws = null;
  }
}

// ---------- pantallas ----------

export interface OnlineCtx {
  app: HTMLElement;
  data: GoatData;
  onExit: () => void;
  /** Nombre guardado del jugador. */
  name: string;
  saveName: (n: string) => void;
}

async function legalDecks(data: GoatData): Promise<NamedDeck[]> {
  const mine = (await listDecks()).map((d): NamedDeck => ({ name: d.name, deck: d.deck }));
  return [...mine, ...STARTER_DECKS.map((d) => ({ ...d, name: `${d.name} (starter)` }))].filter((d) => validateDeck(d.deck, data).length === 0);
}

/** Lobby: salas abiertas, crear sala, unirse con código. `code`: viene de un enlace de invitación. */
export async function showLobby(ctx: OnlineCtx, code = '', message = ''): Promise<void> {
  const { app } = ctx;
  app.onclick = null;
  const decks = await legalDecks(ctx.data);
  const lastDeck = ls.get<string>('goat.onlineDeck') ?? '';
  const sel = Math.max(0, decks.findIndex((d) => d.name === lastDeck));
  app.innerHTML = `<div class="screen setup online">
    <h1>Online duel</h1>
    <label>Your name <input id="o-name" maxlength="16" value="${esc(ctx.name)}"></label>
    <label>Deck <select id="o-deck">${decks.map((d, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select></label>
    ${message ? `<div class="notice">${message}</div>` : ''}
    <fieldset><legend>Join a friend</legend>
      <div class="codein"><input id="o-code" maxlength="5" placeholder="CODE" value="${esc(code)}" autocomplete="off" autocapitalize="characters" spellcheck="false"><button class="btn go" id="o-join">Join</button></div>
    </fieldset>
    <fieldset><legend>Create a room</legend>
      <label class="check"><input type="checkbox" id="o-public" checked> List it in the lobby (anyone can join)</label>
      <div class="mbtns col"><button class="btn go" id="o-create">Create room</button></div>
    </fieldset>
    <h2>Open rooms</h2>
    <div class="roomlist" id="o-rooms"><p class="muted">Loading…</p></div>
    <div class="mbtns col"><button class="btn ghost" id="o-back">Back</button></div>
  </div>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  let alive = true;
  const stop = () => {
    alive = false;
    clearInterval(poll);
  };
  const chosen = () => {
    const name = $<HTMLInputElement>('o-name').value.trim() || 'Player';
    ctx.saveName(name);
    const d = decks[Number($<HTMLSelectElement>('o-deck').value)];
    if (d) ls.set('goat.onlineDeck', d.name);
    return { name, deck: d?.deck };
  };
  const go = (room: string) => {
    const { name, deck } = chosen();
    if (!deck) return void showLobby(ctx, room, 'You need a legal deck. Build one in "My decks".');
    stop();
    void playRoom(ctx, { room, name, deck, token: '' });
  };

  $('o-back').onclick = () => {
    stop();
    ctx.onExit();
  };
  $('o-join').onclick = async () => {
    const id = $<HTMLInputElement>('o-code').value.trim().toUpperCase();
    if (!/^[A-Z0-9]{5}$/.test(id)) return void showLobby(ctx, id, 'Room codes have 5 letters or numbers.');
    const r = await fetch(`${API}/rooms/${id}`).catch(() => null);
    if (!r?.ok) return void showLobby(ctx, id, `Room ${esc(id)} doesn't exist or has already started.`);
    go(id);
  };
  $('o-create').onclick = async () => {
    const { name, deck } = chosen();
    if (!deck) return void showLobby(ctx, '', 'You need a legal deck. Build one in "My decks".');
    const r = await fetch(`${API}/rooms`, { method: 'POST', body: JSON.stringify({ host: name, public: $<HTMLInputElement>('o-public').checked }) }).catch(() => null);
    if (!r?.ok) return void showLobby(ctx, '', "Couldn't reach the server. Check your connection.");
    const { id } = (await r.json()) as { id: string };
    go(id);
  };

  const refresh = async () => {
    const r = await fetch(`${API}/rooms`).catch(() => null);
    if (!alive) return;
    const box = document.getElementById('o-rooms');
    if (!box) return stop();
    if (!r?.ok) {
      box.innerHTML = `<p class="muted">Can't reach the server.</p>`;
      return;
    }
    const rooms = (await r.json()) as RoomInfo[];
    box.innerHTML = rooms.length
      ? rooms
          .map(
            (room) =>
              `<div class="roomrow"><span><b>${esc(room.host)}</b><br><small>Room ${esc(room.id)} · ${ago(room.created)}</small></span><button class="btn go" data-room="${esc(room.id)}">Join</button></div>`,
          )
          .join('')
      : '<p class="muted">No open rooms right now. Create one and share the code!</p>';
    box.querySelectorAll<HTMLButtonElement>('[data-room]').forEach((b) => (b.onclick = () => go(b.dataset.room!)));
  };
  const poll = window.setInterval(() => void refresh(), 4000);
  void refresh();
}

const ago = (t: number) => {
  const m = Math.max(0, Math.round((Date.now() - t) / 60000));
  return m < 1 ? 'just now' : `${m} min ago`;
};

/** Conecta a una sala (nueva o para volver a un duelo) y gestiona espera y duelo. */
export function playRoom(ctx: OnlineCtx, s: Session): void {
  const { app } = ctx;
  app.onclick = null;
  let session: Session = { ...s };
  let client: DuelClient | null = null;
  let oppName: string | null = null;
  let finished = false;
  let link: OnlineLink;

  const leave = (message = '') => {
    if (finished) return;
    finished = true;
    keepAwake(false);
    link.close();
    client?.destroy();
    if (message) void showLobby(ctx, '', message);
    else ctx.onExit();
  };

  const waiting = (status: string) => {
    if (client) return;
    const url = `${location.origin}${location.pathname}?room=${session.room}`;
    app.innerHTML = `<div class="screen center">
      <h1>Room</h1>
      <div class="roomcode">${esc(session.room)}</div>
      <p class="muted">${status}</p>
      <div class="mbtns col">
        <button class="btn go" id="w-share">Share invite link</button>
        <button class="btn ghost" id="w-cancel">Cancel</button>
      </div>
      <p class="muted small">Your friend can also open “Online duel” and type the code.</p>
    </div>`;
    document.getElementById('w-share')!.onclick = async () => {
      const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
      try {
        if (nav.share) await nav.share({ title: 'GOAT Online duel', text: `Duel me in GOAT Online! Room ${session.room}`, url });
        else {
          await navigator.clipboard.writeText(url);
          (document.getElementById('w-share') as HTMLButtonElement).textContent = 'Link copied!';
        }
      } catch {
        /* cancelado */
      }
    };
    document.getElementById('w-cancel')!.onclick = () => {
      link.send({ t: 'leave' });
      clearSession();
      leave();
    };
  };

  const onMessage = (m: ServerMsg) => {
    if (finished) return;
    switch (m.t) {
      case 'joined':
        session = { ...session, token: m.token };
        ls.set(SESSION_KEY, session);
        oppName = m.opponent;
        if (!client) waiting(oppName ? `${esc(oppName)} joined. Starting<span class="dots"></span>` : 'Waiting for an opponent<span class="dots"></span>');
        return;
      case 'deck-invalid':
        clearSession();
        return leave(`Your deck isn't legal:<br>${m.problems.slice(0, 5).map(esc).join('<br>')}`);
      case 'error':
        if (!client) {
          clearSession();
          return leave(esc(m.message));
        }
        break;
      case 'opponent':
        if (m.name) oppName = m.name;
        if (!client) {
          waiting(m.connected && m.name ? `${esc(m.name)} joined. Starting<span class="dots"></span>` : 'Waiting for an opponent<span class="dots"></span>');
          return;
        }
        break;
      case 'update':
        if (!client) {
          app.innerHTML = '<div id="seat" class="seat"></div>';
          keepAwake(true);
          client = new DuelClient(document.getElementById('seat')!, { send: (msg) => link.send(msg) }, {
            names: [session.name, oppName ?? 'Opponent'],
            onExit: () => {
              if (!client) return leave();
              // Salir en mitad del duelo: el duelo sigue en el servidor (puedes volver desde el menú).
              leave();
            },
          });
        }
        break;
      case 'ended':
        clearSession();
        break;
    }
    client?.handle(m);
  };

  link = new OnlineLink(
    session.room,
    () => ({ t: 'join', v: PROTOCOL_VERSION, name: session.name, deck: session.deck, token: session.token || undefined }),
    onMessage,
    (connected) => {
      if (client) client.setReconnecting(!connected);
      else if (!connected) waiting('Connecting<span class="dots"></span>');
    },
  );
  waiting('Connecting<span class="dots"></span>');
}
