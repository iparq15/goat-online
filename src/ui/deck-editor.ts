// Mis mazos (lista) y editor de mazos limitado al pool GOAT, con importación/exportación .ydk.

import { TYPE, isExtraDeckCard, type GoatData } from '../engine/data.ts';
import { cannotAdd, cardLimit, cardRoot, normalizeDeck, parseYdk, sortCodes, toYdk, validateDeck, type Deck, type DeckPart } from '../engine/ydk.ts';
import { bigCard, cardInfoHtml, miniCard } from './card-view.ts';
import { deleteDeck, listDecks, newId, saveDeck, type StoredDeck } from './deck-store.ts';
import { STARTER_DECKS } from './starter-decks.ts';
import { ATTRIBUTE_SHORT, attributeName, cardName, esc, typeLine } from './text.ts';

const PART_NAME: Record<DeckPart, string> = { main: 'Main Deck', extra: 'Extra Deck', side: 'Side Deck' };

/** Pequeño gestor de pantallas con handlers por data-h (como en duel-client). */
class Screen {
  readonly el: HTMLElement;
  private handlers = new Map<string, () => void>();
  private hid = 0;

  constructor(el: HTMLElement) {
    this.el = el;
    el.onclick = (e) => {
      const t = (e.target as HTMLElement).closest<HTMLElement>('[data-h]');
      const fn = t && this.handlers.get(t.dataset.h!);
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
  }

  h(fn: () => void): string {
    const id = `h${++this.hid}`;
    this.handlers.set(id, fn);
    return `data-h="${id}"`;
  }

  set(html: string): void {
    this.el.innerHTML = html;
  }

  reset(): void {
    this.handlers.clear();
    this.hid = 0;
  }

  btn(label: string, fn: () => void, cls = '', disabled = false): string {
    return `<button class="btn ${cls}${disabled ? ' off' : ''}" ${disabled ? 'disabled' : this.h(fn)}>${esc(label)}</button>`;
  }
}

function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'deck';
}

/** Exporta un .ydk: en el móvil abre el menú de compartir (Guardar en Archivos…); si no, descarga. */
export async function exportYdk(name: string, deck: Deck): Promise<void> {
  const fileName = `${safeFileName(name)}.ydk`;
  const text = toYdk(deck);
  const file = new File([text], fileName, { type: 'text/plain' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && matchMedia('(pointer: coarse)').matches) {
    try {
      await nav.share({ files: [file], title: fileName });
      return;
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

/** Lee varios .ydk, los pasa a versiones GOAT y los guarda. Devuelve un resumen. */
export async function importYdkFiles(files: FileList | File[], data: GoatData): Promise<string[]> {
  const out: string[] = [];
  for (const f of Array.from(files)) {
    const parsed = parseYdk(await f.text());
    if (!parsed.main.length && !parsed.extra.length) {
      out.push(`${f.name}: no cards found.`);
      continue;
    }
    const { deck, replaced } = normalizeDeck(parsed, data);
    const name = f.name.replace(/\.ydk$/i, '');
    await saveDeck({ id: newId(), name, deck, updated: 0 });
    const problems = validateDeck(deck, data);
    out.push(`${name}: imported${replaced ? ` (${replaced} cards switched to their GOAT version)` : ''}${problems.length ? ` — not legal yet: ${problems.length} problem(s)` : ' — legal'}.`);
  }
  return out;
}

// ---------- lista de mazos ----------

export interface DeckScreensCtx {
  el: HTMLElement;
  data: GoatData;
  onBack: () => void;
}

export async function showDeckList(ctx: DeckScreensCtx, message = ''): Promise<void> {
  ctx.el.oninput = null;
  ctx.el.onchange = null;
  const s = new Screen(ctx.el);
  const decks = await listDecks();
  const render = (msg: string) => {
    s.reset();
    const row = (d: StoredDeck) => {
      const problems = validateDeck(d.deck, ctx.data);
      return `<div class="deckrow">
        <button class="deckmain" ${s.h(() => openEditor(ctx, d))}>
          <b>${esc(d.name)}</b>
          <small>${d.deck.main.length} main · ${d.deck.extra.length} extra · ${d.deck.side.length} side</small>
          <span class="badge ${problems.length ? 'bad' : 'ok'}">${problems.length ? 'NOT LEGAL' : 'LEGAL'}</span>
        </button>
        <div class="deckacts">
          ${s.btn('Copy', async () => {
            await saveDeck({ id: newId(), name: `${d.name} (copy)`, deck: structuredClone(d.deck), updated: 0 });
            void showDeckList(ctx);
          })}
          ${s.btn('Export', () => void exportYdk(d.name, d.deck))}
          ${s.btn('Delete', async () => {
            if (!confirm(`Delete "${d.name}"?`)) return;
            await deleteDeck(d.id);
            void showDeckList(ctx);
          }, 'danger')}
        </div>
      </div>`;
    };
    s.set(`<div class="screen decks">
      <div class="topbar">${s.btn('‹ Back', ctx.onBack, 'ghost')}<h1>My decks</h1></div>
      <div class="mbtns">
        ${s.btn('New deck', async () => {
          const d: StoredDeck = { id: newId(), name: 'New deck', deck: { main: [], extra: [], side: [] }, updated: 0 };
          await saveDeck(d);
          openEditor(ctx, d);
        }, 'go')}
        <label class="btn">Import .ydk<input type="file" id="ydk-in" accept=".ydk,text/plain" multiple hidden></label>
      </div>
      ${msg ? `<div class="notice">${msg}</div>` : ''}
      <div class="decklist">${decks.length ? decks.map(row).join('') : '<p class="muted">No decks yet. Create one, import a .ydk, or copy a starter deck.</p>'}</div>
      <h2>Starter decks</h2>
      <div class="decklist">${STARTER_DECKS.map(
        (d) => `<div class="deckrow"><div class="deckmain static"><b>${esc(d.name)}</b><small>${d.deck.main.length} main · ${d.deck.extra.length} extra</small></div>
        <div class="deckacts">${s.btn('Copy to my decks', async () => {
          await saveDeck({ id: newId(), name: d.name, deck: structuredClone(d.deck), updated: 0 });
          void showDeckList(ctx, `${esc(d.name)} copied. Tap it to edit.`);
        })}</div></div>`,
      ).join('')}</div>
      <p class="muted small">Banlist: ${esc(ctx.data.listName)}. Decks are saved on this device.</p>
    </div>`);
    const input = ctx.el.querySelector<HTMLInputElement>('#ydk-in')!;
    input.onchange = async () => {
      if (!input.files?.length) return;
      const lines = await importYdkFiles(input.files, ctx.data);
      void showDeckList(ctx, lines.map(esc).join('<br>'));
    };
  };
  render(message);
}

// ---------- editor ----------

type Kind = 'all' | 'monster' | 'spell' | 'trap' | 'fusion';

function openEditor(ctx: DeckScreensCtx, stored: StoredDeck): void {
  new DeckEditor(ctx, stored);
}

class DeckEditor {
  private s: Screen;
  private ctx: DeckScreensCtx;
  private d: StoredDeck;
  private tab: 'deck' | 'search' = 'deck';
  private q = '';
  private kind: Kind = 'all';
  private attr = 0;
  private level = 0;
  private searchText = false;
  private shown = 60;
  private detail: number | null = null;
  private showProblems = false;
  private pool: number[];
  private saveTimer = 0;

  constructor(ctx: DeckScreensCtx, stored: StoredDeck) {
    this.ctx = ctx;
    this.d = stored;
    this.s = new Screen(ctx.el);
    const data = ctx.data;
    // Una entrada por carta: las versiones de arte alternativo (mismo alias) se muestran una vez.
    const byRoot = new Map<number, number>();
    for (const c of data.cards.values()) {
      if (!c.inPool || c.type & TYPE.TOKEN) continue;
      const root = cardRoot(c.code, data);
      const prev = byRoot.get(root);
      if (prev === undefined || c.code === root || (prev !== root && (data.limits.get(c.code) ?? 0) > (data.limits.get(prev) ?? 0))) byRoot.set(root, c.code);
    }
    this.pool = [...byRoot.values()].sort((a, b) => cardName(a).localeCompare(cardName(b)) || a - b);
    ctx.el.oninput = (e) => this.onInput(e);
    ctx.el.onchange = (e) => this.onChange(e);
    this.render();
  }

  private get data(): GoatData {
    return this.ctx.data;
  }

  private save(): void {
    clearTimeout(this.saveTimer);
    this.saveTimer = window.setTimeout(() => void saveDeck(this.d), 250);
  }

  private onInput(e: Event): void {
    const t = e.target as HTMLInputElement;
    if (t.id === 'q') {
      this.q = t.value;
      this.shown = 60;
      this.refreshResults();
    }
  }

  private onChange(e: Event): void {
    const t = e.target as HTMLInputElement | HTMLSelectElement;
    if (t.id === 'deck-name') {
      this.d.name = t.value.trim().slice(0, 40) || 'Untitled deck';
      this.save();
    } else if (t.id === 'f-attr') {
      this.attr = Number(t.value);
      this.shown = 60;
      this.refreshResults();
    } else if (t.id === 'f-level') {
      this.level = Number(t.value);
      this.shown = 60;
      this.refreshResults();
    } else if (t.id === 'f-text') {
      this.searchText = (t as HTMLInputElement).checked;
      this.refreshResults();
    }
  }

  private add(code: number, part: DeckPart): void {
    if (cannotAdd(this.d.deck, code, part, this.data)) return;
    this.d.deck[part].push(code);
    this.save();
  }

  private remove(code: number, part: DeckPart): void {
    const i = this.d.deck[part].lastIndexOf(code);
    if (i >= 0) this.d.deck[part].splice(i, 1);
    this.save();
  }

  private copies(code: number): number {
    const root = cardRoot(code, this.data);
    const { main, extra, side } = this.d.deck;
    return [...main, ...extra, ...side].filter((x) => cardRoot(x, this.data) === root).length;
  }

  private limitBadge(code: number): string {
    const l = cardLimit(code, this.data);
    if (l === undefined) return '<span class="lim l0">✕</span>';
    if (l === 3) return '';
    return `<span class="lim l${l}">${l === 0 ? '✕' : l}</span>`;
  }

  // ---------- render ----------

  render(): void {
    const s = this.s;
    s.reset();
    const { main, extra, side } = this.d.deck;
    const problems = validateDeck(this.d.deck, this.data);
    const status = problems.length
      ? `<button class="badge bad" ${s.h(() => ((this.showProblems = !this.showProblems), this.render()))}>${problems.length} PROBLEM${problems.length > 1 ? 'S' : ''} ▾</button>`
      : '<span class="badge ok">LEGAL</span>';
    const problemList = problems.length && this.showProblems ? `<ul class="problems">${problems.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>` : '';
    const count = (n: number, lo: number, hi: number) => `<b class="${n < lo || n > hi ? 'bad' : ''}">${n}</b>`;
    s.set(`<div class="editor">
      <div class="edhead">
        ${s.btn('‹', () => {
          clearTimeout(this.saveTimer);
          void saveDeck(this.d).then(() => showDeckList(this.ctx));
        }, 'ghost back')}
        <input id="deck-name" class="dname" value="${esc(this.d.name)}" maxlength="40" aria-label="Deck name">
        ${status}
      </div>
      ${problemList}
      <div class="edcounts">Main ${count(main.length, 40, 60)} · Extra ${count(extra.length, 0, 15)} · Side ${count(side.length, 0, 15)}</div>
      <div class="tabs">
        <button class="${this.tab === 'deck' ? 'on' : ''}" ${s.h(() => ((this.tab = 'deck'), this.render()))}>Deck</button>
        <button class="${this.tab === 'search' ? 'on' : ''}" ${s.h(() => ((this.tab = 'search'), this.render()))}>Add cards</button>
      </div>
      <div class="edbody">${this.tab === 'deck' ? this.deckHtml() : this.searchHtml()}</div>
      <div class="bar">
        <span class="btxt muted small">${esc(this.data.listName)}</span>
        <span class="bbtns">${s.btn('Export .ydk', () => void exportYdk(this.d.name, this.d.deck))}</span>
      </div>
      ${this.detailHtml()}
    </div>`);
    if (this.tab === 'search') this.refreshResults();
  }

  private deckHtml(): string {
    const part = (p: DeckPart) => {
      const codes = sortCodes(this.d.deck[p], this.data);
      const grid = codes.length
        ? codes.map((c) => `<div class="dcell" ${this.s.h(() => this.openDetail(c))}>${miniCard(c)}${this.limitBadge(c)}</div>`).join('')
        : `<p class="muted small">${p === 'main' ? 'Empty. Go to "Add cards" to build your deck.' : 'Empty.'}</p>`;
      return `<h2>${PART_NAME[p]} <small>${codes.length}</small></h2><div class="dgrid">${grid}</div>`;
    };
    return part('main') + part('extra') + part('side');
  }

  private searchHtml(): string {
    const s = this.s;
    const chip = (k: Kind, label: string) => `<button class="chipbtn ${this.kind === k ? 'picked' : ''}" ${s.h(() => ((this.kind = k), (this.shown = 60), this.render()))}>${label}</button>`;
    const attrs = Object.entries(ATTRIBUTE_SHORT)
      .filter(([a]) => Number(a) !== 64)
      .map(([a]) => `<option value="${a}" ${Number(a) === this.attr ? 'selected' : ''}>${esc(attributeName(Number(a)))}</option>`)
      .join('');
    const levels = Array.from({ length: 12 }, (_, i) => i + 1)
      .map((l) => `<option value="${l}" ${l === this.level ? 'selected' : ''}>Level ${l}</option>`)
      .join('');
    return `<div class="searchbox">
      <input id="q" class="search" type="search" placeholder="Search by name…" value="${esc(this.q)}" autocomplete="off" autocorrect="off" spellcheck="false">
      <div class="chips">${chip('all', 'All')}${chip('monster', 'Monster')}${chip('spell', 'Spell')}${chip('trap', 'Trap')}${chip('fusion', 'Fusion')}</div>
      <div class="filters">
        <select id="f-attr"><option value="0">Any attribute</option>${attrs}</select>
        <select id="f-level"><option value="0">Any level</option>${levels}</select>
        <label class="small"><input type="checkbox" id="f-text" ${this.searchText ? 'checked' : ''}> Search card text</label>
      </div>
    </div>
    <div id="results" class="results"></div>`;
  }

  private matches(): number[] {
    const q = this.q.trim().toLowerCase();
    return this.pool.filter((code) => {
      const c = this.data.cards.get(code)!;
      const t = c.type;
      if (this.kind === 'monster' && !(t & TYPE.MONSTER)) return false;
      if (this.kind === 'spell' && !(t & TYPE.SPELL)) return false;
      if (this.kind === 'trap' && !(t & TYPE.TRAP)) return false;
      if (this.kind === 'fusion' && !(t & TYPE.FUSION)) return false;
      if (this.attr && c.attribute !== this.attr) return false;
      if (this.level && (!(t & TYPE.MONSTER) || c.level !== this.level)) return false;
      if (q && !cardName(code).toLowerCase().includes(q) && !(this.searchText && c.desc.toLowerCase().includes(q))) return false;
      return true;
    });
  }

  /** Solo redibuja la lista (para no perder el foco del buscador mientras se escribe). */
  private refreshResults(): void {
    const box = this.ctx.el.querySelector('#results');
    if (!box) return;
    const s = this.s;
    const all = this.matches();
    const list = all.slice(0, this.shown);
    const rows = list
      .map((code) => {
        const c = this.data.cards.get(code)!;
        const part: DeckPart = isExtraDeckCard(c) ? 'extra' : 'main';
        const why = cannotAdd(this.d.deck, code, part, this.data);
        const have = this.copies(code);
        const stats = c.type & TYPE.MONSTER ? ` · ${c.attack < 0 ? '?' : c.attack}/${c.defense < 0 ? '?' : c.defense}` : '';
        return `<div class="rrow">
          <button class="rinfo" ${s.h(() => this.openDetail(code))}>${miniCard(code, { cls: 'xs' })}<span><b>${esc(cardName(code))}</b>${this.limitBadge(code)}<br><small>${esc(typeLine(c))}${stats}${have ? ` · <i>${have} in deck</i>` : ''}</small></span></button>
          <button class="addbtn ${why ? 'off' : ''}" ${why ? `title="${esc(why)}"` : s.h(() => (this.add(code, part), this.refreshResults(), this.refreshCounts()))} aria-label="Add">+</button>
        </div>`;
      })
      .join('');
    const more = all.length > list.length ? `<button class="btn ghost more" ${s.h(() => ((this.shown += 60), this.refreshResults()))}>Show more (${all.length - list.length})</button>` : '';
    box.innerHTML = `<p class="muted small">${all.length} card${all.length === 1 ? '' : 's'}</p>${rows}${more}`;
  }

  /** Actualiza contadores y estado sin redibujar toda la pantalla. */
  private refreshCounts(): void {
    const { main, extra, side } = this.d.deck;
    const el = this.ctx.el.querySelector('.edcounts');
    const count = (n: number, lo: number, hi: number) => `<b class="${n < lo || n > hi ? 'bad' : ''}">${n}</b>`;
    if (el) el.innerHTML = `Main ${count(main.length, 40, 60)} · Extra ${count(extra.length, 0, 15)} · Side ${count(side.length, 0, 15)}`;
    const badge = this.ctx.el.querySelector('.edhead .badge');
    const problems = validateDeck(this.d.deck, this.data);
    if (badge) {
      badge.className = `badge ${problems.length ? 'bad' : 'ok'}`;
      badge.textContent = problems.length ? `${problems.length} PROBLEM${problems.length > 1 ? 'S' : ''} ▾` : 'LEGAL';
    }
  }

  private openDetail(code: number): void {
    this.detail = code;
    this.render();
  }

  private detailHtml(): string {
    const code = this.detail;
    if (code === null) return '';
    const s = this.s;
    const c = this.data.cards.get(code)!;
    const limit = cardLimit(code, this.data);
    const limitText = limit === undefined ? 'Not legal in GOAT' : limit === 0 ? 'Forbidden' : limit === 1 ? 'Limited (1)' : limit === 2 ? 'Semi-limited (2)' : 'Unlimited (3)';
    const inPart = (p: DeckPart) => this.d.deck[p].filter((x) => x === code).length;
    const parts: DeckPart[] = isExtraDeckCard(c) ? ['extra', 'side'] : ['main', 'side'];
    const rerender = () => this.render();
    const rows = parts
      .map((p) => {
        const why = cannotAdd(this.d.deck, code, p, this.data);
        const n = inPart(p);
        return `<div class="partrow"><span>${PART_NAME[p]}: <b>${n}</b></span>
          ${s.btn('−', () => (this.remove(code, p), rerender()), '', n === 0)}
          ${s.btn('+', () => (this.add(code, p), rerender()), 'go', !!why)}</div>`;
      })
      .join('');
    const why = cannotAdd(this.d.deck, code, parts[0], this.data);
    return `<div class="sheet-bg" ${s.h(() => ((this.detail = null), this.render()))}></div>
    <div class="sheet">
      <div class="detail">${bigCard(code)}<div class="info">${cardInfoHtml(code)}</div></div>
      <p class="limitline">GOAT: <b>${limitText}</b> · ${this.copies(code)} in this deck</p>
      ${rows}
      ${why && !why.startsWith('Limit') ? `<p class="muted small">${esc(why)}</p>` : ''}
      <div class="mfoot">${s.btn('Close', () => ((this.detail = null), this.render()), 'ghost')}</div>
    </div>`;
  }
}
