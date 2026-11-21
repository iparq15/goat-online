// GOAT Online: menú, preparación del duelo de práctica y el modo de dos jugadores en el
// mismo móvil (cada jugador ve solo su lado; opcionalmente se tapa la pantalla al pasar el
// móvil).

import '@fontsource/press-start-2p/400.css';
import '@fontsource/pixelify-sans/400.css';
import '@fontsource/pixelify-sans/600.css';
import './style.css';
import { parseYdk, validateDeck, type Deck } from '../engine/ydk.ts';
import { loadAssets, type Assets } from './assets.ts';
import { DuelClient } from './duel-client.ts';
import { LocalHost } from './local-host.ts';
import { STARTER_DECKS, type NamedDeck } from './starter-decks.ts';
import { esc, initText } from './text.ts';

const app = document.getElementById('app')!;
let assets: Assets;

const store = {
  get<T>(k: string, def: T): T {
    try {
      const v = localStorage.getItem(`goat.${k}`);
      return v ? (JSON.parse(v) as T) : def;
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

// ---------- carga ----------

async function boot(): Promise<void> {
  app.innerHTML = `<div class="screen center"><div class="logo">GOAT<br><span>ONLINE</span></div><div class="loadbar"><i id="lb"></i></div><p class="muted" id="lt">Cargando cartas…</p></div>`;
  try {
    assets = await loadAssets((done, total) => {
      const lb = document.getElementById('lb');
      if (lb) lb.style.width = `${(done / total) * 100}%`;
    });
    initText(assets.data, assets.strings);
    menu();
  } catch (e) {
    app.innerHTML = `<div class="screen center"><h2>No se pudo cargar</h2><p>${esc(String(e))}</p><button class="btn go" onclick="location.reload()">Reintentar</button></div>`;
  }
}

// ---------- menú ----------

function menu(): void {
  app.innerHTML = `<div class="screen center menu">
    <div class="logo">GOAT<br><span>ONLINE</span></div>
    <p class="tag">Duelos en formato GOAT · lista de abril de 2005</p>
    <div class="mbtns col">
      <button class="btn go big" id="m-practice">Duelo de práctica</button>
      <button class="btn big off" disabled>Duelo online <small>(pronto)</small></button>
      <button class="btn big off" disabled>Mis mazos <small>(pronto)</small></button>
    </div>
    <p class="credits">Proyecto de fans, sin relación con Konami. Motor: ygopro-core (EDOPro) y scripts de Project Ignis, bajo AGPL-3.0. <a href="https://github.com/iparq15/goat-online" target="_blank" rel="noopener">Código fuente</a>.</p>
  </div>`;
  document.getElementById('m-practice')!.onclick = practiceSetup;
}

// ---------- preparación del duelo de práctica ----------

function allDecks(): NamedDeck[] {
  return [...STARTER_DECKS, ...store.get<NamedDeck[]>('imported', [])];
}

function practiceSetup(): void {
  const decks = allDecks();
  const prefs = store.get('practice', { names: ['Jugador 1', 'Jugador 2'], decks: [0, 1], curtain: false });
  const opts = (sel: number) => decks.map((d, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(d.name)}</option>`).join('');
  app.innerHTML = `<div class="screen setup">
    <h1>Duelo de práctica</h1>
    <p class="muted">Los dos jugadores en este móvil. La pantalla gira hacia quien tiene que decidir.</p>
    ${[0, 1]
      .map(
        (i) => `<fieldset><legend>Jugador ${i + 1}</legend>
      <label>Nombre <input id="n${i}" maxlength="16" value="${esc(prefs.names[i] ?? `Jugador ${i + 1}`)}"></label>
      <label>Mazo <select id="d${i}">${opts(Math.min(prefs.decks[i] ?? i, decks.length - 1))}</select></label></fieldset>`,
      )
      .join('')}
    <label class="check"><input type="checkbox" id="curtain" ${prefs.curtain ? 'checked' : ''}> Tapar la pantalla al cambiar de jugador (para no ver la mano del otro)</label>
    <div class="mbtns col">
      <button class="btn go big" id="start">¡A jugar!</button>
      <label class="btn">Importar mazo .ydk<input type="file" id="ydk" accept=".ydk,text/plain" hidden></label>
      <button class="btn ghost" id="back">Volver</button>
    </div>
    <p id="msg" class="msg"></p>
  </div>`;
  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  $('back').onclick = menu;
  $<HTMLInputElement>('ydk').onchange = async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    const deck = parseYdk(await f.text());
    const problems = validateDeck(deck, assets.data);
    if (problems.length) {
      $('msg').innerHTML = `<b>${esc(f.name)} no es legal en GOAT:</b><br>${problems.slice(0, 6).map(esc).join('<br>')}`;
      return;
    }
    const imported = store.get<NamedDeck[]>('imported', []);
    imported.push({ name: f.name.replace(/\.ydk$/i, ''), deck });
    store.set('imported', imported);
    practiceSetup();
  };
  $('start').onclick = () => {
    const names = [0, 1].map((i) => $<HTMLInputElement>(`n${i}`).value.trim() || `Jugador ${i + 1}`) as [string, string];
    const idx = [0, 1].map((i) => Number($<HTMLSelectElement>(`d${i}`).value));
    const curtain = $<HTMLInputElement>('curtain').checked;
    store.set('practice', { names, decks: idx, curtain });
    void startPractice(names, [decks[idx[0]].deck, decks[idx[1]].deck], curtain);
  };
}

// ---------- duelo en el mismo móvil ----------

async function startPractice(names: [string, string], decks: [Deck, Deck], curtain: boolean): Promise<void> {
  app.innerHTML = `<div class="screen center"><p class="muted">Barajando…</p></div>`;
  const core = await assets.core();
  const host = new LocalHost(core, assets.data, decks, names);
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
        curtainEl.innerHTML = `<div class="ctext">Pásale el móvil a<br><b>${esc(names[deciding])}</b><br><small>Toca para continuar</small></div>`;
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
