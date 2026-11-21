// GOAT Online: menú, mis mazos, preparación del duelo de práctica y el modo de dos jugadores
// en el mismo móvil (cada jugador ve solo su lado; opcionalmente se tapa la pantalla al pasar
// el móvil).

import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './style.css';
import { validateDeck, type Deck } from '../engine/ydk.ts';
import { loadAssets, type Assets } from './assets.ts';
import { showDeckList } from './deck-editor.ts';
import { listDecks, migrateLegacy } from './deck-store.ts';
import { DuelClient } from './duel-client.ts';
import { LocalHost } from './local-host.ts';
import { playRoom, savedSession, showLobby, type OnlineCtx } from './online.ts';
import { STARTER_DECKS, type NamedDeck } from './starter-decks.ts';
import { settings, updateSettings } from './settings.ts';
import { initSfx } from './sfx.ts';
import { esc, initText } from './text.ts';
import { keepAwake } from './wake.ts';

const app = document.getElementById('app')!;
let assets: Assets;

const prefs = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(`goat.${k}`);
      return v ? { ...def, ...(JSON.parse(v) as T) } : def;
    } catch {
      return def;
    }
  },
  set(k: string, v: unknown): void {
    try {
      localStorage.setItem(`goat.${k}`, JSON.stringify(v));
    } catch {
      /* sin almacenamiento */
    }
  },
};

/** Cada pantalla limpia los manejadores de la anterior. */
function fresh(): void {
  keepAwake(false);
  app.onclick = null;
  app.oninput = null;
  app.onchange = null;
}

// ---------- app instalable (PWA) ----------

let updateReady = false;
const standalone = () => matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.register('/sw.js').catch(() => {});
  // Hay una versión nueva instalada: se ofrece recargar desde el menú (nunca en mitad de un duelo).
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController) return;
    updateReady = true;
    const slot = document.getElementById('m-update');
    if (slot) slot.hidden = false;
  });
}

// iOS: sin zoom con pellizco ni doble toque dentro de la app.
document.addEventListener('gesturestart', (e) => e.preventDefault());
initSfx();

// ---------- carga ----------

async function boot(): Promise<void> {
  app.innerHTML = `<div class="screen center"><div class="logo">GOAT<br><span>ONLINE</span></div><div class="loadbar"><i id="lb"></i></div><p class="muted">Loading cards…</p></div>`;
  try {
    assets = await loadAssets((done, total) => {
      const lb = document.getElementById('lb');
      if (lb) lb.style.width = `${(done / total) * 100}%`;
    });
    initText(assets.data, assets.strings);
    await migrateLegacy();
    // Enlace de invitación: ?room=CODE abre el lobby con el código puesto.
    const code = new URLSearchParams(location.search).get('room');
    if (code) {
      history.replaceState(null, '', location.pathname);
      return void showLobby(onlineCtx(), code.toUpperCase().slice(0, 5));
    }
    menu();
  } catch (e) {
    app.innerHTML = `<div class="screen center"><h2>Couldn't load</h2><p>${esc(String(e))}</p><button class="btn go" onclick="location.reload()">Retry</button></div>`;
  }
}

// ---------- menú ----------

function onlineCtx(): OnlineCtx {
  return {
    app,
    data: assets.data,
    onExit: menu,
    name: prefs.get('online', { name: '' }).name || prefs.get('practice', { names: ['Player 1'] }).names[0] || 'Player',
    saveName: (name) => prefs.set('online', { name }),
  };
}

function menu(): void {
  fresh();
  const session = savedSession();
  app.innerHTML = `<div class="screen center menu">
    <div class="logo">GOAT<br><span>ONLINE</span></div>
    <p class="tag">GOAT format duels · April 2005 banlist</p>
    <div class="mbtns col">
      ${session ? `<button class="btn go big" id="m-resume">Resume online duel <small>(room ${esc(session.room)})</small></button>` : ''}
      <button class="btn ${session ? '' : 'go '}big" id="m-online">Online duel</button>
      <button class="btn big" id="m-practice">Practice duel</button>
      <button class="btn big" id="m-decks">My decks</button>
      <button class="btn" id="m-settings">Settings</button>
    </div>
    <button class="btn go" id="m-update" ${updateReady ? '' : 'hidden'}>New version ready · tap to update</button>
    ${isIos() && !standalone() ? '<p class="tip">Tip: tap <b>Share</b> → <b>Add to Home Screen</b> to install the app.</p>' : ''}
    <p class="credits">Fan project, not affiliated with Konami. Engine: ygopro-core (EDOPro) and Project Ignis card scripts, under AGPL-3.0. <a href="https://github.com/iparq15/goat-online" target="_blank" rel="noopener">Source code</a>.</p>
  </div>`;
  document.getElementById('m-practice')!.onclick = () => void practiceSetup();
  document.getElementById('m-online')!.onclick = () => {
    fresh();
    void showLobby(onlineCtx());
  };
  if (session) document.getElementById('m-resume')!.onclick = () => (fresh(), playRoom(onlineCtx(), session));
  document.getElementById('m-decks')!.onclick = decks;
  document.getElementById('m-settings')!.onclick = settingsScreen;
  document.getElementById('m-update')!.onclick = () => location.reload();
}

function settingsScreen(): void {
  fresh();
  const s = settings();
  app.innerHTML = `<div class="screen setup">
    <h1>Settings</h1>
    <label class="check"><input type="checkbox" id="s-sound" ${s.sound ? 'checked' : ''}> Sound effects</label>
    <label class="check"><input type="checkbox" id="s-zone" ${s.autoZone ? 'checked' : ''}> Choose zones automatically when summoning or setting</label>
    <label class="check"><input type="checkbox" id="s-chain" ${s.chains === 'always' ? 'checked' : ''}> Always ask to chain (otherwise only when something happens, and in your opponent's Battle and End Phase)</label>
    <div class="mbtns col"><button class="btn go" id="s-back">Done</button></div>
    <p class="muted small">Settings are saved on this device.</p>
  </div>`;
  const $ = (id: string) => document.getElementById(id) as HTMLInputElement;
  $('s-back').onclick = () => {
    updateSettings({ sound: $('s-sound').checked, autoZone: $('s-zone').checked, chains: $('s-chain').checked ? 'always' : 'smart' });
    menu();
  };
}

function decks(): void {
  fresh();
  void showDeckList({ el: app, data: assets.data, onBack: menu });
}

// ---------- preparación del duelo de práctica ----------

async function practiceSetup(): Promise<void> {
  fresh();
  const mine = (await listDecks()).map((d): NamedDeck => ({ name: d.name, deck: d.deck }));
  const all: NamedDeck[] = [...mine, ...STARTER_DECKS];
  const legal = all.map((d) => validateDeck(d.deck, assets.data).length === 0);
  const p = prefs.get('practice', { names: ['Player 1', 'Player 2'], deckNames: ['', ''], curtain: false });
  const pick = (i: number) => {
    const byName = all.findIndex((d, k) => d.name === p.deckNames[i] && legal[k]);
    if (byName >= 0) return byName;
    const firstStarter = mine.length + (i % STARTER_DECKS.length);
    return firstStarter;
  };
  const opts = (sel: number) =>
    all
      .map((d, i) => `<option value="${i}" ${i === sel ? 'selected' : ''} ${legal[i] ? '' : 'disabled'}>${esc(d.name)}${i >= mine.length ? ' (starter)' : ''}${legal[i] ? '' : ' — not legal'}</option>`)
      .join('');
  app.innerHTML = `<div class="screen setup">
    <h1>Practice duel</h1>
    <p class="muted">Both players on this phone. The screen turns to whoever has to decide.</p>
    ${[0, 1]
      .map(
        (i) => `<fieldset><legend>Player ${i + 1}</legend>
      <label>Name <input id="n${i}" maxlength="16" value="${esc(p.names[i] || `Player ${i + 1}`)}"></label>
      <label>Deck <select id="d${i}">${opts(pick(i))}</select></label></fieldset>`,
      )
      .join('')}
    <label class="check"><input type="checkbox" id="curtain" ${p.curtain ? 'checked' : ''}> Cover the screen when switching players (so you can't see the other hand)</label>
    <div class="mbtns col">
      <button class="btn go big" id="start">Duel!</button>
      <button class="btn" id="edit">Edit my decks</button>
      <button class="btn ghost" id="back">Back</button>
    </div>
  </div>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  $('back').onclick = menu;
  $('edit').onclick = decks;
  $('start').onclick = () => {
    const names = [0, 1].map((i) => $<HTMLInputElement>(`n${i}`).value.trim() || `Player ${i + 1}`) as [string, string];
    const idx = [0, 1].map((i) => Number($<HTMLSelectElement>(`d${i}`).value));
    const curtain = $<HTMLInputElement>('curtain').checked;
    prefs.set('practice', { names, deckNames: idx.map((i) => all[i].name), curtain });
    void startPractice(names, [all[idx[0]].deck, all[idx[1]].deck], curtain);
  };
}

// ---------- duelo en el mismo móvil ----------

async function startPractice(names: [string, string], decks: [Deck, Deck], curtain: boolean): Promise<void> {
  fresh();
  app.innerHTML = `<div class="screen center"><p class="muted">Shuffling…</p></div>`;
  const core = await assets.core();
  const host = new LocalHost(core, assets.data, decks, names);
  keepAwake(true);
  app.innerHTML = `<div class="hotseat"><div id="s0" class="seat"></div><div id="s1" class="seat"></div><div id="curtain" class="curtain" hidden></div></div>`;
  const seatEls = [document.getElementById('s0')!, document.getElementById('s1')!];
  const curtainEl = document.getElementById('curtain')!;
  let shown: 0 | 1 = 0;
  let exited = false;
  const exit = () => {
    if (exited) return;
    exited = true;
    host.destroy();
    menu();
  };
  const show = (seat: 0 | 1) => {
    shown = seat;
    clients.forEach((c, i) => {
      c.visible = i === seat;
      seatEls[i].hidden = i !== seat;
    });
    clients[seat].render();
  };
  let pending = false;
  const onChange = () => {
    if (pending) return;
    pending = true;
    // Se evalúa cuando los dos asientos ya recibieron su actualización.
    setTimeout(() => {
      pending = false;
      if (exited) return;
      const deciding = ([0, 1] as const).find((s) => clients[s].deciding);
      if (deciding === undefined || deciding === shown) return;
      if (curtain) {
        curtainEl.hidden = false;
        curtainEl.innerHTML = `<div class="ctext">Pass the phone to<br><b>${esc(names[deciding])}</b><br><small>Tap to continue</small></div>`;
        curtainEl.onclick = () => {
          curtainEl.hidden = true;
          show(deciding);
        };
        seatEls.forEach((el) => (el.hidden = true));
        shown = deciding;
      } else show(deciding);
    }, 0);
  };
  const clients = ([0, 1] as const).map(
    (seat) =>
      new DuelClient(seatEls[seat], { send: (m) => link[seat].send(m) }, {
        names: [names[seat], names[1 - seat]],
        hotseat: true,
        onExit: exit,
        onChange,
      }),
  ) as [DuelClient, DuelClient];
  const link = ([0, 1] as const).map((seat) => host.link(seat, (m) => clients[seat].handle(m))) as [ReturnType<LocalHost['link']>, ReturnType<LocalHost['link']>];
  // Empieza viendo el que va primero.
  show(host.teamOfSeat[0] === 0 ? 0 : 1);
  host.start();
}

void boot();
