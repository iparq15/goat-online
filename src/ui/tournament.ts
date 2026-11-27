// Organizador de torneos en persona (Swiss, eliminación directa, round robin). Los torneos se
// guardan en este dispositivo y puede haber varios a la vez.

import {
  advance,
  blockReason,
  canRepair,
  champion,
  createTournament,
  currentRound,
  elimRounds,
  finalRanking,
  matchStake,
  FORMAT_LABEL,
  type Format,
  newId,
  nextStep,
  recordOf,
  repair,
  resetTimer,
  roundLabel,
  setDropped,
  setResult,
  standings,
  start,
  suggestedSwissRounds,
  swissTotal,
  timerRemaining,
  toggleTimer,
  type Tournament,
  winnerOf,
} from '../tournament/logic.ts';
import { play } from './sfx.ts';
import { esc } from './text.ts';
import { keepAwake } from './wake.ts';

const KEY = 'goat.tournaments';

function loadAll(): Tournament[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]') as Tournament[];
    return Array.isArray(v) ? v.filter((t) => t && t.v === 1 && Array.isArray(t.players)) : [];
  } catch {
    return [];
  }
}

function saveAll(list: Tournament[]): boolean {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

type Tab = 'players' | 'round' | 'standings' | 'history';

const pct = (x: number) => `${(x * 100).toFixed(1)}`;
const mmss = (ms: number) => {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

export function showTournaments(app: HTMLElement, onBack: () => void): void {
  let list = loadAll();
  let timer = 0;
  let rang = false;
  let editing: string | null = null;
  let saveFailed = false;

  const persist = () => {
    saveFailed = !saveAll(list);
  };
  const leave = () => {
    clearInterval(timer);
    keepAwake(false);
    onBack();
  };

  /** Pinta una pantalla en un contenedor nuevo (los eventos se delegan en él). */
  const mount = (html: string, onAct: (act: string, el: HTMLElement) => void) => {
    clearInterval(timer);
    app.innerHTML = `<div class="screen tm">${html}${saveFailed ? '<p class="msg">Could not save on this device (storage full or blocked).</p>' : ''}</div>`;
    const root = app.firstElementChild as HTMLElement;
    root.addEventListener('click', (e) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-act]');
      if (!el || (el as HTMLButtonElement).disabled) return;
      onAct(el.dataset.act!, el);
    });
    return root;
  };

  // ------------------------------------------------------------ lista

  function listView(): void {
    keepAwake(false);
    const items = list
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => {
        const st = t.status === 'setup' ? 'Not started' : t.status === 'done' ? `Finished · ${esc(nameOf(t, champion(t)) || '—')} wins` : esc(roundLabel(t, t.rounds.length - 1));
        return `<div class="tm-item">
          <button class="tm-open" data-act="open" data-id="${t.id}"><b>${esc(t.name)}</b><small>${FORMAT_LABEL[t.format]} · ${t.players.length} players · ${new Date(t.createdAt).toLocaleDateString()}</small><small class="${t.status}">${st}</small></button>
          <button class="btn ghost" data-act="del" data-id="${t.id}" aria-label="Delete">✕</button>
        </div>`;
      })
      .join('');
    mount(
      `<div class="tm-head"><button class="tm-back" data-act="home" aria-label="Back">‹</button><h1>Tournaments</h1></div>
      <p class="muted">Organize in-person tournaments: random pairings, results, standings and top cut. Saved on this device.</p>
      <div class="mbtns col"><button class="btn go big" data-act="new">New tournament</button></div>
      <div class="tm-list">${items || '<p class="muted center">No tournaments yet.</p>'}</div>`,
      (act, el) => {
        if (act === 'home') leave();
        else if (act === 'new') createView();
        else if (act === 'open') tourView(el.dataset.id!, null);
        else if (act === 'del') {
          const t = list.find((x) => x.id === el.dataset.id);
          if (t && confirm(`Delete "${t.name}"? This cannot be undone.`)) {
            list = list.filter((x) => x !== t);
            persist();
            listView();
          }
        }
      },
    );
  }

  // ------------------------------------------------------------ crear

  function createView(): void {
    const today = new Date().toLocaleDateString();
    const root = mount(
      `<div class="tm-head"><button class="tm-back" data-act="back" aria-label="Back">‹</button><h1>New tournament</h1></div>
      <div class="setup">
        <fieldset><legend>Tournament</legend>
          <label>Name <input id="t-name" maxlength="40" value="GOAT tournament ${esc(today)}"></label>
          <label>Format <select id="t-format">
            <option value="swiss">Swiss rounds</option>
            <option value="single">Single elimination</option>
            <option value="roundrobin">Round robin (everyone plays everyone)</option>
          </select></label>
          <label id="l-rounds">Swiss rounds <select id="t-rounds"><option value="0">Auto (by number of players)</option>${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}">${i + 1}</option>`).join('')}</select></label>
          <label id="l-cut">Top cut after the rounds <select id="t-cut">
            <option value="0">No top cut</option><option value="2">Top 2</option><option value="4">Top 4</option><option value="8">Top 8</option><option value="16">Top 16</option>
          </select></label>
          <label class="check" id="l-place"><input type="checkbox" id="t-place" checked> Play for every place: whoever loses keeps playing (3rd/4th place, 5th–8th…) until every place is decided</label>
        </fieldset>
        <fieldset><legend>Matches</legend>
          <label>Match length <select id="t-bo"><option value="3">Best of 3</option><option value="1">Best of 1</option></select></label>
          <label>Round time (minutes, 0 = no timer) <input id="t-min" type="number" inputmode="numeric" min="0" max="180" value="40"></label>
        </fieldset>
        <p class="muted small" id="t-hint"></p>
        <div class="mbtns col"><button class="btn go big" data-act="create">Create and add players</button></div>
      </div>`,
      (act) => {
        if (act === 'back') listView();
        if (act !== 'create') return;
        const v = (id: string) => (root.querySelector(`#${id}`) as HTMLInputElement).value;
        const t = createTournament({
          name: v('t-name').trim() || `GOAT tournament ${today}`,
          format: v('t-format') as Format,
          bestOf: v('t-bo') === '1' ? 1 : 3,
          swissRounds: Number(v('t-rounds')) || 0,
          topCut: Number(v('t-cut')) as Tournament['topCut'],
          roundMinutes: Math.max(0, Math.min(180, Math.round(Number(v('t-min')) || 0))),
          placements: (root.querySelector('#t-place') as HTMLInputElement).checked && (v('t-format') === 'single' || Number(v('t-cut')) > 0),
        });
        list.push(t);
        persist();
        tourView(t.id, 'players');
      },
    );
    const fmt = root.querySelector<HTMLSelectElement>('#t-format')!;
    const sync = () => {
      const f = fmt.value as Format;
      root.querySelector<HTMLElement>('#l-rounds')!.hidden = f !== 'swiss';
      root.querySelector<HTMLElement>('#l-cut')!.hidden = f === 'single';
      root.querySelector<HTMLElement>('#l-place')!.hidden = f !== 'single' && root.querySelector<HTMLSelectElement>('#t-cut')!.value === '0';
      root.querySelector<HTMLElement>('#t-hint')!.textContent =
        f === 'swiss'
          ? 'Swiss: everyone plays every round against someone with the same record, never the same opponent twice. Win 3 pts, draw 1. Auto rounds: 4–8 players → 3, 9–16 → 4, 17–32 → 5…'
          : f === 'single'
            ? 'Single elimination: random bracket, the loser of each match is out. Byes go to the top seeds when the count is not a power of 2.'
            : 'Round robin: everyone plays everyone once. Best for small groups.';
    };
    fmt.onchange = sync;
    root.querySelector<HTMLSelectElement>('#t-cut')!.onchange = sync;
    sync();
  }

  // ------------------------------------------------------------ torneo

  function tourView(id: string, wanted: Tab | null): void {
    const t = list.find((x) => x.id === id);
    if (!t) return listView();
    const tab: Tab = wanted ?? (t.status === 'setup' ? 'players' : t.status === 'done' ? 'standings' : 'round');
    keepAwake(t.status === 'running');
    const change = (fn: () => void, next: Tab = tab) => {
      fn();
      persist();
      tourView(id, next);
    };
    const tabs = (['players', 'round', 'standings', 'history'] as Tab[])
      .map((k) => `<button class="${k === tab ? 'on' : ''}" data-act="tab" data-tab="${k}">${{ players: 'PLAYERS', round: 'ROUND', standings: 'STANDINGS', history: 'HISTORY' }[k]}</button>`)
      .join('');
    const sub = `${FORMAT_LABEL[t.format]}${t.format === 'swiss' ? ` · ${t.status === 'setup' && !t.swissRounds ? 'auto rounds' : `${swissTotal(t)} rounds`}` : ''}${t.topCut && t.format !== 'single' ? ` · top ${t.topCut}` : ''}${t.placements ? ' · all places' : ''} · Bo${t.bestOf}`;
    const body = tab === 'players' ? playersTab(t) : tab === 'round' ? roundTab(t) : tab === 'standings' ? standingsTab(t) : historyTab(t);
    const root = mount(
      `<div class="tm-head"><button class="tm-back" data-act="list" aria-label="Back">‹</button><div><h1>${esc(t.name)}</h1><small class="muted">${sub}</small></div></div>
      <div class="tabs tm-tabs">${tabs}</div>
      <div class="tm-body">${body}</div>`,
      (act, el) => {
        const d = el.dataset;
        switch (act) {
          case 'list':
            editing = null;
            return listView();
          case 'tab':
            editing = null;
            return tourView(id, d.tab as Tab);
          case 'add': {
            const name = root.querySelector<HTMLInputElement>('#p-name')!.value.trim();
            const deck = root.querySelector<HTMLInputElement>('#p-deck')!.value.trim();
            if (!name) return root.querySelector<HTMLInputElement>('#p-name')!.focus();
            change(() => t.players.push({ id: newId(), name, deck, notes: '', dropped: false }));
            root.ownerDocument.querySelector<HTMLInputElement>('#p-name')?.focus();
            return;
          }
          case 'bulk': {
            const lines = root.querySelector<HTMLTextAreaElement>('#p-bulk')!.value.split(/\r?\n/);
            change(() => {
              for (const line of lines) {
                const [name, ...rest] = line.split(/\s+[-–|]\s+/);
                if (name?.trim()) t.players.push({ id: newId(), name: name.trim().slice(0, 30), deck: rest.join(' - ').trim().slice(0, 40), notes: '', dropped: false });
              }
            });
            return;
          }
          case 'edit':
            editing = d.id!;
            return tourView(id, tab);
          case 'cancel':
            editing = null;
            return tourView(id, tab);
          case 'save': {
            const p = t.players.find((x) => x.id === d.id);
            const val = (s: string) => root.querySelector<HTMLInputElement>(s)!.value.trim();
            editing = null;
            if (p) change(() => Object.assign(p, { name: val('#e-name') || p.name, deck: val('#e-deck'), notes: val('#e-notes') }));
            return;
          }
          case 'drop': {
            const p = t.players.find((x) => x.id === d.id);
            if (!p) return;
            if (!p.dropped && !confirm(`Drop ${p.name} from the tournament? They won't be paired again.`)) return;
            editing = null;
            return change(() => setDropped(t, p.id, !p.dropped));
          }
          case 'remove':
            editing = null;
            return change(() => (t.players = t.players.filter((x) => x.id !== d.id)));
          case 'start':
            return change(() => start(t), 'round');
          case 'res': {
            const ga = Number(d.ga);
            const gb = Number(d.gb);
            const m = currentRound(t)?.matches.find((x) => x.table === Number(d.t));
            const same = m && m.ga === ga && m.gb === gb;
            return change(() => setResult(t, Number(d.t), same ? null : ga, same ? null : gb));
          }
          case 'next': {
            const step = nextStep(t);
            if (step === 'finish' && !confirm('Finish the tournament with these results?')) return;
            rang = false;
            play(step === 'finish' ? 'win' : 'turn');
            return change(() => advance(t), step === 'finish' ? 'standings' : 'round');
          }
          case 'repair':
            return change(() => repair(t));
          case 'timer':
            rang = false;
            return change(() => toggleTimer(t));
          case 'treset':
            rang = false;
            return change(() => resetTimer(t));
          case 'share':
            return void share(tab === 'standings' ? standingsText(t) : pairingsText(t));
        }
      },
    );
    // Reloj de la ronda.
    const clock = root.querySelector<HTMLElement>('.tm-time');
    if (clock) {
      const tick = () => {
        const left = timerRemaining(t);
        if (left == null) return;
        clock.textContent = left > 0 ? mmss(left) : 'TIME!';
        clock.classList.toggle('over', left <= 0);
        clock.classList.toggle('low', left > 0 && left <= 5 * 60000);
        if (left <= 0 && t.timerEnd && !rang) {
          rang = true;
          play('decide');
        }
      };
      tick();
      timer = window.setInterval(tick, 500);
    }
  }

  // ------------------------------------------------------------ pestañas

  function playersTab(t: Tournament): string {
    const canAdd = t.status === 'setup' || (t.status === 'running' && t.format === 'swiss');
    const form = canAdd
      ? `<div class="setup tm-add">
          <label>Player name <input id="p-name" maxlength="30" autocomplete="off"></label>
          <label>Deck (optional) <input id="p-deck" maxlength="40" autocomplete="off"></label>
          <div class="mbtns"><button class="btn go" data-act="add">Add player</button></div>
          ${t.status === 'running' ? '<p class="muted small">Late entries start with 0 points from the next round.</p>' : ''}
          <details><summary>Add several at once</summary>
            <textarea id="p-bulk" rows="6" placeholder="One player per line&#10;Optional deck: Name - Deck"></textarea>
            <div class="mbtns"><button class="btn" data-act="bulk">Add all</button></div>
          </details>
        </div>`
      : '';
    const rows = t.players
      .map((p, i) => {
        if (editing === p.id)
          return `<div class="tm-prow editing setup">
            <label>Name <input id="e-name" maxlength="30" value="${esc(p.name)}"></label>
            <label>Deck <input id="e-deck" maxlength="40" value="${esc(p.deck)}"></label>
            <label>Notes <input id="e-notes" maxlength="120" value="${esc(p.notes)}"></label>
            <div class="mbtns">
              <button class="btn go" data-act="save" data-id="${p.id}">Save</button>
              ${t.status === 'running' ? `<button class="btn ${p.dropped ? '' : 'danger'}" data-act="drop" data-id="${p.id}">${p.dropped ? 'Undo drop' : 'Drop'}</button>` : ''}
              ${t.status === 'setup' ? `<button class="btn danger" data-act="remove" data-id="${p.id}">Remove</button>` : ''}
              <button class="btn ghost" data-act="cancel">Cancel</button>
            </div>
          </div>`;
        return `<button class="tm-prow ${p.dropped ? 'dropped' : ''}" data-act="edit" data-id="${p.id}">
          <span class="n">${i + 1}</span>
          <span class="who"><b>${esc(p.name)}</b>${p.deck ? `<small>${esc(p.deck)}</small>` : ''}${p.notes ? `<small class="muted">${esc(p.notes)}</small>` : ''}</span>
          <span class="rec">${p.dropped ? 'DROP' : t.status === 'setup' ? '' : recordOf(t, p.id)}</span>
        </button>`;
      })
      .join('');
    const n = t.players.filter((p) => !p.dropped).length;
    const startBtn =
      t.status === 'setup'
        ? `<div class="mbtns col"><button class="btn go big" data-act="start" ${n < 2 ? 'disabled' : ''}>Start tournament (${n} players)</button></div>
           ${t.format === 'swiss' && n >= 2 ? `<p class="muted small center">${t.swissRounds || suggestedSwissRounds(n)} Swiss rounds${t.topCut ? `, then top ${Math.min(t.topCut, n)}` : ''}. Round 1 is paired at random.</p>` : ''}`
        : '';
    return `${form}<h2 class="tm-h">Players (${t.players.length})</h2><div class="tm-players">${rows || '<p class="muted">No players yet.</p>'}</div>${startBtn}`;
  }

  function roundTab(t: Tournament): string {
    const r = currentRound(t);
    if (t.status === 'setup' || !r) return '<p class="muted center">Add the players and start the tournament to see the pairings.</p>';
    const st = new Map(standings(t).map((s) => [s.id, s]));
    const name = (id: string | null) => esc(nameOf(t, id));
    const live = t.status === 'running';
    const elim = r.stage === 'elim';
    const opts: [number, number, string][] =
      t.bestOf === 3
        ? [[2, 0, '2-0'], [2, 1, '2-1'], ...(elim ? [] : ([[1, 1, 'DRAW']] as [number, number, string][])), [1, 2, '1-2'], [0, 2, '0-2']]
        : [[1, 0, '1-0'], ...(elim ? [] : ([[0, 0, 'DRAW']] as [number, number, string][])), [0, 1, '0-1']];
    const matches = r.matches
      .map((m) => {
        const w = winnerOf(m);
        const pts = (id: string) => (elim ? '' : `<small>${st.get(id)?.points ?? 0} pts</small>`);
        const stake = elim ? matchStake(t, m) : '';
        const head = `<div class="mt">Table ${m.table}${stake ? ` · <b>${esc(stake)}</b>` : ''}</div>`;
        if (m.b === null)
          return `<div class="tm-match done">${head}<div class="mp"><span class="win">${name(m.a)}${pts(m.a)}</span><span class="vs">BYE</span><span class="muted">wins automatically</span></div></div>`;
        const res = opts
          .map(([a, b, label]) => `<button class="${m.ga === a && m.gb === b ? 'on' : ''}" data-act="res" data-t="${m.table}" data-ga="${a}" data-gb="${b}" ${live ? '' : 'disabled'}>${label}</button>`)
          .join('');
        return `<div class="tm-match ${w ? 'done' : ''} ${stake === 'Final' ? 'final' : ''}">
          ${head}
          <div class="mp"><span class="${w === m.a ? 'win' : ''}">${name(m.a)}${pts(m.a)}</span><span class="vs">vs</span><span class="${w === m.b ? 'win' : ''}">${name(m.b)}${pts(m.b!)}</span></div>
          <div class="tm-res">${res}</div>
        </div>`;
      })
      .join('');
    const left = timerRemaining(t);
    const clock =
      live && left != null
        ? `<div class="tm-timer"><b class="tm-time">${mmss(left)}</b><button class="btn" data-act="timer">${t.timerEnd ? 'Pause' : 'Start'}</button><button class="btn ghost" data-act="treset">Reset</button></div>`
        : '';
    const block = blockReason(t);
    const step = nextStep(t);
    const next = live
      ? `<p class="muted small center">${block ?? 'All results in.'}</p>
         <div class="mbtns col">
           <button class="btn go big" data-act="next" ${block ? 'disabled' : ''}>${step === 'cut' ? `Start top ${Math.min(t.topCut, t.players.filter((p) => !p.dropped).length)}` : step === 'finish' ? 'Finish tournament' : 'Pair next round'}</button>
           ${canRepair(t) ? '<button class="btn" data-act="repair">Re-pair this round</button>' : ''}
         </div>`
      : `<div class="tm-champ"><small>CHAMPION</small><b>${name(champion(t))}</b></div>`;
    return `<h2 class="tm-h">${esc(roundLabel(t, t.rounds.length - 1))}</h2>${clock}${matches}${next}
      <div class="mbtns"><button class="btn ghost" data-act="share">Share pairings</button></div>`;
  }

  function standingsTab(t: Tournament): string {
    if (t.status === 'setup') return '<p class="muted center">Standings appear once the tournament starts.</p>';
    const champ = champion(t);
    let html = champ ? `<div class="tm-champ"><small>CHAMPION</small><b>${esc(nameOf(t, champ))}</b></div>` : '';
    if (t.rounds.some((r) => r.stage !== 'elim')) {
      const rows = standings(t)
        .map((s) => {
          const p = t.players.find((x) => x.id === s.id)!;
          return `<tr class="${p.dropped ? 'dropped' : ''}"><td>${s.rank}</td><td class="nm">${esc(p.name)}${p.deck ? `<small>${esc(p.deck)}</small>` : ''}</td><td><b>${s.points}</b></td><td>${s.w}-${s.l}-${s.d}</td><td>${pct(s.omw)}</td><td>${pct(s.oomw)}</td><td>${pct(s.gwp)}</td></tr>`;
        })
        .join('');
      html += `<h2 class="tm-h">${t.format === 'roundrobin' ? 'Round robin' : 'Swiss'} standings</h2>
        <div class="tm-scroll"><table class="tm-table"><thead><tr><th>#</th><th>Player</th><th>Pts</th><th>W-L-D</th><th>OMW%</th><th>OOMW%</th><th>GW%</th></tr></thead><tbody>${rows}</tbody></table></div>
        <p class="muted small">Tiebreakers: points, opponents' match win % (OMW), opponents' opponents' (OOMW), game win % (GW).</p>`;
    }
    if (elimRounds(t).length) {
      const rows = finalRanking(t)
        .filter((x) => elimRounds(t).some((r) => r.matches.some((m) => m.a === x.id || m.b === x.id)))
        .map((x) => `<tr><td>${x.place}</td><td class="nm">${esc(nameOf(t, x.id))}</td><td>${recordOf(t, x.id)}</td></tr>`)
        .join('');
      html += `<h2 class="tm-h">${t.format === 'single' ? 'Bracket' : 'Top cut'}</h2>${bracketHtml(t)}
        <table class="tm-table"><thead><tr><th>Place</th><th>Player</th><th>W-L-D</th></tr></thead><tbody>${rows}</tbody></table>`;
    }
    return `${html}<div class="mbtns"><button class="btn ghost" data-act="share">Share standings</button></div>`;
  }

  function bracketHtml(t: Tournament): string {
    return `<div class="tm-bracket">${elimRounds(t)
      .map(
        (r) =>
          `<div class="col"><small>${esc(roundLabelOf(t, r))}</small>${r.matches
            .map((m) => {
              const w = winnerOf(m);
              const side = (id: string | null, g: number | null) => `<span class="${w && w === id ? 'win' : ''}">${id ? esc(nameOf(t, id)) : 'BYE'}<i>${m.b === null || g === null ? '' : g}</i></span>`;
              const stake = t.placements ? matchStake(t, m) : '';
              return `<div class="bm">${stake ? `<em>${esc(stake)}</em>` : ''}${side(m.a, m.ga)}${side(m.b, m.gb)}</div>`;
            })
            .join('')}</div>`,
      )
      .join('')}</div>`;
  }

  function historyTab(t: Tournament): string {
    if (!t.rounds.length) return '<p class="muted center">No rounds played yet.</p>';
    return t.rounds
      .map((r, i) => {
        const rows = r.matches
          .map((m) => {
            const w = winnerOf(m);
            if (m.b === null) return `<div class="hm"><span class="win">${esc(nameOf(t, m.a))}</span><b>BYE</b><span></span></div>`;
            const score = m.ga === null ? 'vs' : `${m.ga}-${m.gb}`;
            return `<div class="hm"><span class="${w === m.a ? 'win' : ''}">${esc(nameOf(t, m.a))}</span><b>${score}</b><span class="${w === m.b ? 'win' : ''}">${esc(nameOf(t, m.b))}</span></div>`;
          })
          .join('');
        return `<div class="tm-hround"><h2 class="tm-h">${esc(roundLabel(t, i))}</h2>${rows}</div>`;
      })
      .reverse()
      .join('');
  }

  // ------------------------------------------------------------ textos para compartir

  function pairingsText(t: Tournament): string {
    const r = currentRound(t);
    if (!r) return t.name;
    const lines = r.matches.map((m) => (m.b === null ? `Table ${m.table}: ${nameOf(t, m.a)} — BYE` : `Table ${m.table}${r.stage === 'elim' && matchStake(t, m) ? ` (${matchStake(t, m)})` : ''}: ${nameOf(t, m.a)} vs ${nameOf(t, m.b)}${m.ga === null ? '' : ` (${m.ga}-${m.gb})`}`));
    return `${t.name}\n${roundLabel(t, t.rounds.length - 1)}\n\n${lines.join('\n')}`;
  }

  function standingsText(t: Tournament): string {
    const champ = champion(t);
    const lines = finalRanking(t).map((x) => {
      const s = standings(t).find((y) => y.id === x.id)!;
      return `${x.place}. ${nameOf(t, x.id)} — ${s.points} pts (${recordOf(t, x.id)})`;
    });
    return `${t.name}${champ ? `\nChampion: ${nameOf(t, champ)}` : ''}\n\n${lines.join('\n')}`;
  }

  async function share(text: string): Promise<void> {
    try {
      if (navigator.share) return await navigator.share({ text });
    } catch {
      /* cancelado o no disponible: se copia */
    }
    try {
      await navigator.clipboard.writeText(text);
      alert('Copied to the clipboard.');
    } catch {
      prompt('Copy the text:', text);
    }
  }

  listView();
}

function nameOf(t: Tournament, id: string | null | 'draw'): string {
  if (!id || id === 'draw') return '';
  return t.players.find((p) => p.id === id)?.name ?? '?';
}

function roundLabelOf(t: Tournament, r: Tournament['rounds'][number]): string {
  return roundLabel(t, t.rounds.indexOf(r));
}
