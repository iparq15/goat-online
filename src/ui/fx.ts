// Animaciones del duelo (diseño propio, estética pixel). Se dibujan en una capa encima del
// tablero con la Web Animations API; cada función devuelve una promesa que se resuelve al
// terminar, para encadenarlas en orden.

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Fx {
  private root: HTMLElement;
  private speed: () => number;

  /** `speed()`: 1 = normal, <1 más rápido. */
  constructor(root: HTMLElement, speed: () => number) {
    this.root = root;
    this.speed = speed;
  }

  private ms(n: number): number {
    return Math.round(n * this.speed());
  }

  layer(): HTMLElement {
    let l = this.root.querySelector<HTMLElement>(':scope > .fxlayer');
    if (!l) {
      l = document.createElement('div');
      l.className = 'fxlayer';
      this.root.appendChild(l);
    }
    return l;
  }

  box(el: Element): Box {
    const r = el.getBoundingClientRect();
    const o = this.root.getBoundingClientRect();
    return { x: r.left - o.left, y: r.top - o.top, w: r.width, h: r.height };
  }

  zone(key: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-z="${key}"]`);
  }

  pile(key: string): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(`[data-pile="${key}"]`);
  }

  private place(el: HTMLElement, b: Box): HTMLElement {
    el.style.position = 'absolute';
    el.style.left = `${b.x}px`;
    el.style.top = `${b.y}px`;
    el.style.width = `${b.w}px`;
    el.style.height = `${b.h}px`;
    this.layer().appendChild(el);
    return el;
  }

  private run(el: Element, frames: Keyframe[], duration: number, opts: KeyframeAnimationOptions = {}): Promise<void> {
    const d = this.ms(duration);
    if (d <= 0) return Promise.resolve();
    const a = el.animate(frames, { duration: d, fill: 'forwards', ...opts });
    // Por si el elemento sale del DOM a mitad: nunca esperar más de lo previsto.
    return Promise.race([a.finished.then(() => {}), wait(d + 80)]).catch(() => {});
  }

  /** Copia visual de la carta de una zona (para animarla sin tocar el tablero). */
  private ghost(zoneEl: HTMLElement): HTMLElement | null {
    const card = zoneEl.querySelector<HTMLElement>('.card');
    if (!card) return null;
    const g = card.cloneNode(true) as HTMLElement;
    g.classList.add('fxcard');
    this.place(g, this.box(card));
    // Las cartas en defensa están giradas: la copia también.
    g.style.transform = getComputedStyle(card).transform === 'none' ? '' : getComputedStyle(card).transform;
    return g;
  }

  // ---------- efectos ----------

  /** Carta activada: aparece grande en el centro con rayos. */
  async activate(cardHtml: string, label: string, mine: boolean): Promise<void> {
    const wrap = document.createElement('div');
    wrap.className = `fx-activate ${mine ? 'mine' : 'theirs'}`;
    wrap.innerHTML = `<div class="rays"></div><div class="fx-big">${cardHtml}</div><div class="fx-label">${label}</div>`;
    this.layer().appendChild(wrap);
    const big = wrap.querySelector('.fx-big')!;
    await Promise.all([
      this.run(wrap, [{ opacity: 0 }, { opacity: 1, offset: 0.12 }, { opacity: 1, offset: 0.82 }, { opacity: 0 }], 950),
      this.run(big, [{ transform: 'scale(0.2) rotate(-8deg)' }, { transform: 'scale(1.12) rotate(2deg)', offset: 0.22 }, { transform: 'scale(1)', offset: 0.32 }, { transform: 'scale(1)' }], 950),
    ]);
    wrap.remove();
  }

  /** Ataque: el monstruo embiste al objetivo (o al jugador) y vuelve. */
  async attack(attacker: HTMLElement, target: Box): Promise<void> {
    const g = this.ghost(attacker);
    if (!g) return;
    const from = this.box(attacker);
    const dx = (target.x + target.w / 2 - (from.x + from.w / 2)) * 0.85;
    const dy = (target.y + target.h / 2 - (from.y + from.h / 2)) * 0.85;
    const base = g.style.transform;
    attacker.style.visibility = 'hidden';
    const hit = this.run(
      g,
      [
        { transform: `${base} translate(0,0) scale(1)` },
        { transform: `${base} translate(${-dx * 0.08}px,${-dy * 0.08}px) scale(1.08)`, offset: 0.25 },
        { transform: `${base} translate(${dx}px,${dy}px) scale(1.15)`, offset: 0.5 },
        { transform: `${base} translate(${dx * 0.9}px,${dy * 0.9}px) scale(1.1)`, offset: 0.6 },
        { transform: `${base} translate(0,0) scale(1)` },
      ],
      700,
      { easing: 'ease-in-out' },
    );
    await wait(this.ms(330));
    void this.slash(target);
    await hit;
    attacker.style.visibility = '';
    g.remove();
  }

  /** Corte en diagonal con destello en el punto de impacto. */
  async slash(b: Box): Promise<void> {
    const s = document.createElement('div');
    s.className = 'fx-slash';
    this.place(s, { x: b.x - b.w * 0.25, y: b.y, w: b.w * 1.5, h: b.h });
    const f = document.createElement('div');
    f.className = 'fx-flash';
    this.place(f, b);
    await Promise.all([
      this.run(s, [{ transform: 'scaleX(0) rotate(-35deg)', opacity: 1 }, { transform: 'scaleX(1) rotate(-35deg)', opacity: 1, offset: 0.4 }, { transform: 'scaleX(1) rotate(-35deg)', opacity: 0 }], 380),
      this.run(f, [{ opacity: 0.95 }, { opacity: 0 }], 380, { easing: 'steps(4)' }),
    ]);
    s.remove();
    f.remove();
  }

  /** Destrucción: la carta destella y estalla en fragmentos pixel. */
  async shatter(zoneEl: HTMLElement): Promise<void> {
    const g = this.ghost(zoneEl);
    const card = zoneEl.querySelector<HTMLElement>('.card');
    if (!g || !card) return;
    card.style.visibility = 'hidden';
    const b = this.box(card);
    const color = getComputedStyle(card).getPropertyValue('--frame').trim() || '#ddd';
    const parts: Promise<void>[] = [];
    const N = 14;
    for (let i = 0; i < N; i++) {
      const p = document.createElement('div');
      p.className = 'fx-shard';
      p.style.background = i % 3 === 0 ? '#fff4dc' : color;
      const size = 4 + Math.floor(Math.random() * 6);
      this.place(p, { x: b.x + b.w / 2 - size / 2 + (Math.random() - 0.5) * b.w * 0.6, y: b.y + b.h / 2 - size / 2 + (Math.random() - 0.5) * b.h * 0.6, w: size, h: size });
      const ang = (i / N) * Math.PI * 2 + Math.random() * 0.4;
      const dist = 30 + Math.random() * 40;
      const tx = Math.cos(ang) * dist;
      const ty = Math.sin(ang) * dist;
      parts.push(
        this.run(
          p,
          [
            { transform: 'translate(0,0)', opacity: 1 },
            { transform: `translate(${tx * 0.7}px,${ty * 0.7 - 10}px)`, opacity: 1, offset: 0.5 },
            { transform: `translate(${tx}px,${ty + 25}px)`, opacity: 0 },
          ],
          560,
          { easing: 'steps(7)', delay: this.ms(120) },
        ).then(() => p.remove()),
      );
    }
    parts.push(this.run(g, [{ filter: 'brightness(1)', opacity: 1 }, { filter: 'brightness(3)', opacity: 1, offset: 0.25 }, { filter: 'brightness(3)', opacity: 0, offset: 0.4 }, { opacity: 0 }], 600, { easing: 'steps(5)' }));
    await Promise.all(parts);
    g.remove();
  }

  /** La carta sale del campo volando hacia `to` (mano, mazo, desterradas…). */
  async fly(zoneEl: HTMLElement, to: Box | null): Promise<void> {
    const g = this.ghost(zoneEl);
    const card = zoneEl.querySelector<HTMLElement>('.card');
    if (!g || !card) return;
    card.style.visibility = 'hidden';
    const b = this.box(card);
    const t = to ?? { x: b.x, y: b.y - 60, w: b.w, h: b.h };
    const dx = t.x + t.w / 2 - (b.x + b.w / 2);
    const dy = t.y + t.h / 2 - (b.y + b.h / 2);
    await this.run(g, [{ transform: `${g.style.transform} translate(0,0) scale(1)`, opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(0.6)`, opacity: 0.2 }], 480, { easing: 'ease-in' });
    g.remove();
  }

  /**
   * Cartas enviadas al cementerio desde la mano o el mazo (descartes, costes, Graceful Charity…):
   * se muestran un momento en el centro y caen cada una en su cementerio.
   */
  async toGrave(cards: { html: string; to: Box | null }[], label: string, mine: boolean): Promise<void> {
    if (!cards.length) return;
    const wrap = document.createElement('div');
    wrap.className = `fx-grave ${mine ? 'mine' : 'theirs'}`;
    wrap.innerHTML = `<div class="fx-row">${cards.map((c) => `<div class="fx-gc">${c.html}</div>`).join('')}</div><div class="fx-label">${label}</div>`;
    this.layer().appendChild(wrap);
    const els = [...wrap.querySelectorAll<HTMLElement>('.fx-gc')];
    const label$ = wrap.querySelector<HTMLElement>('.fx-label')!;
    // Entrada: aparecen una tras otra.
    await Promise.all([
      this.run(wrap, [{ background: '#0a061800' }, { background: '#0a0618aa' }], 200),
      this.run(label$, [{ opacity: 0 }, { opacity: 1 }], 200),
      ...els.map((el, i) =>
        this.run(el, [{ transform: 'translateY(30px) scale(0.4)', opacity: 0 }, { transform: 'translateY(-4px) scale(1.06)', opacity: 1, offset: 0.7 }, { transform: 'none', opacity: 1 }], 260, { delay: this.ms(i * 90), easing: 'steps(5)' }),
      ),
    ]);
    await this.wait(650);
    // Salida: cada carta cae en su cementerio.
    const base = this.box(this.root);
    await Promise.all([
      this.run(label$, [{ opacity: 1 }, { opacity: 0 }], 200),
      this.run(wrap, [{ background: '#0a0618aa' }, { background: '#0a061800' }], 420),
      ...els.map((el, i) => {
        const b = this.box(el);
        const t = cards[i]!.to ?? { x: b.x, y: base.h, w: b.w, h: b.h };
        const dx = t.x + t.w / 2 - (b.x + b.w / 2);
        const dy = t.y + t.h / 2 - (b.y + b.h / 2);
        return this.run(el, [{ transform: 'none', opacity: 1 }, { transform: `translate(${dx}px,${dy}px) scale(0.45)`, opacity: 0.35 }], 380, { delay: this.ms(i * 50), easing: 'ease-in' });
      }),
    ]);
    wrap.remove();
  }

  /** Una pila (cementerio) destella al recibir cartas. */
  async pulse(pileEl: HTMLElement): Promise<void> {
    await this.run(
      pileEl,
      [{ filter: 'brightness(1)', transform: 'scale(1)' }, { filter: 'brightness(2.2)', transform: 'scale(1.08)', offset: 0.35 }, { filter: 'brightness(1)', transform: 'scale(1)' }],
      380,
      { easing: 'steps(5)', fill: 'none' },
    );
  }

  /** Mazo barajado: la pila se agita. */
  async shuffle(pileEl: HTMLElement): Promise<void> {
    await this.run(
      pileEl,
      [0, -5, 5, -4, 4, -2, 0].map((x, i) => ({ transform: `translateX(${x}px) rotate(${i % 2 ? 4 : -4}deg)` })),
      480,
      { easing: 'steps(7)', fill: 'none' },
    );
  }

  /** Mano barajada: las cartas saltan. */
  async shuffleHand(cards: HTMLElement[]): Promise<void> {
    await Promise.all(cards.map((c, i) => this.run(c, [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }], 300, { delay: this.ms(i * 40), fill: 'none', easing: 'steps(4)' })));
  }

  /** Daño: la pantalla tiembla con un destello rojo. */
  async damage(target: HTMLElement): Promise<void> {
    const f = document.createElement('div');
    f.className = 'fx-redflash';
    this.place(f, { x: 0, y: 0, w: this.root.clientWidth, h: this.root.clientHeight });
    await Promise.all([
      this.run(target, [0, -6, 6, -5, 5, -3, 3, 0].map((x) => ({ transform: `translate(${x}px, ${x / 2}px)` })), 420, { easing: 'steps(8)', fill: 'none' }),
      this.run(f, [{ opacity: 0.45 }, { opacity: 0 }], 420, { easing: 'steps(4)' }),
    ]);
    f.remove();
  }

  /** Franja de cambio de turno. */
  async banner(title: string, sub: string, mine: boolean): Promise<void> {
    const b = document.createElement('div');
    b.className = `fx-banner ${mine ? 'mine' : 'theirs'}`;
    b.innerHTML = `<div class="t">${title}</div><div class="s">${sub}</div>`;
    this.layer().appendChild(b);
    await this.run(
      b,
      [
        { transform: 'translateX(-110%) skewX(-12deg)', opacity: 1 },
        { transform: 'translateX(0) skewX(-12deg)', opacity: 1, offset: 0.22 },
        { transform: 'translateX(0) skewX(-12deg)', opacity: 1, offset: 0.78 },
        { transform: 'translateX(110%) skewX(-12deg)', opacity: 1 },
      ],
      1100,
      { easing: 'ease-in-out' },
    );
    b.remove();
  }

  /** Cambio de fase: una franja más estrecha y rápida que la del turno, con el nombre de la fase. */
  async phase(title: string, mine: boolean): Promise<void> {
    const b = document.createElement('div');
    b.className = `fx-banner fx-phase ${mine ? 'mine' : 'theirs'}`;
    b.innerHTML = `<div class="t">${title}</div>`;
    this.layer().appendChild(b);
    await this.run(
      b,
      [
        { transform: 'scaleY(0)', opacity: 1 },
        { transform: 'scaleY(1)', opacity: 1, offset: 0.18 },
        { transform: 'scaleY(1)', opacity: 1, offset: 0.8 },
        { transform: 'scaleY(0)', opacity: 0 },
      ],
      720,
      { easing: 'steps(6)' },
    );
    b.remove();
  }

  /** Sello grande (NEGATED, resultado de moneda…). */
  async stamp(text: string, cls = ''): Promise<void> {
    const s = document.createElement('div');
    s.className = `fx-stamp ${cls}`;
    s.textContent = text;
    this.layer().appendChild(s);
    await this.run(s, [{ transform: 'translate(-50%,-50%) scale(2.6) rotate(-12deg)', opacity: 0 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 1, offset: 0.25 }, { transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)', opacity: 1, offset: 0.8 }, { opacity: 0, transform: 'translate(-50%,-50%) scale(1) rotate(-12deg)' }], 800);
    s.remove();
  }

  // ---------- en el tablero nuevo ----------

  /** Invocación (normal / especial / volteo) o carta colocada que aparece en su zona. */
  async appear(zoneEl: HTMLElement, kind: 'summon' | 'special' | 'flip' | 'set'): Promise<void> {
    const card = zoneEl.querySelector<HTMLElement>('.card');
    if (!card) return;
    const base = getComputedStyle(card).transform === 'none' ? '' : getComputedStyle(card).transform;
    const b = this.box(zoneEl);
    const effects: Promise<void>[] = [];
    if (kind === 'special' || kind === 'summon') {
      const ring = document.createElement('div');
      ring.className = `fx-ring ${kind}`;
      this.place(ring, { x: b.x - b.w * 0.3, y: b.y + b.h * 0.1, w: b.w * 1.6, h: b.w * 1.6 * 0.55 + b.h * 0.3 });
      effects.push(this.run(ring, [{ transform: 'scale(0.2)', opacity: 1 }, { transform: 'scale(1.2)', opacity: 0 }], 600, { easing: 'steps(6)' }).then(() => ring.remove()));
    }
    if (kind === 'special') {
      const pillar = document.createElement('div');
      pillar.className = 'fx-pillar';
      this.place(pillar, { x: b.x + b.w * 0.1, y: b.y - b.h, w: b.w * 0.8, h: b.h * 2 });
      effects.push(this.run(pillar, [{ transform: 'scaleX(0)', opacity: 1 }, { transform: 'scaleX(1)', opacity: 1, offset: 0.3 }, { transform: 'scaleX(0.2)', opacity: 0 }], 700, { easing: 'steps(7)' }).then(() => pillar.remove()));
    }
    if (kind === 'flip') {
      effects.push(this.run(card, [{ transform: `${base} rotateY(90deg)`, filter: 'brightness(2)' }, { transform: `${base} rotateY(0deg)`, filter: 'brightness(1)' }], 450, { fill: 'none', easing: 'steps(6)' }));
    } else if (kind === 'set') {
      effects.push(this.run(card, [{ transform: `${base} translateY(-40px)`, opacity: 0 }, { transform: `${base} translateY(0)`, opacity: 1 }], 320, { fill: 'none', easing: 'ease-out' }));
    } else {
      effects.push(
        this.run(
          card,
          [
            { transform: `${base} scale(1.9)`, opacity: 0, filter: 'brightness(3)' },
            { transform: `${base} scale(0.92)`, opacity: 1, filter: 'brightness(2)', offset: 0.55 },
            { transform: `${base} scale(1)`, opacity: 1, filter: 'brightness(1)' },
          ],
          520,
          { fill: 'none', easing: 'ease-out' },
        ),
      );
    }
    await Promise.all(effects);
  }

  /** Copia flotante de una carta (o de su reverso) del tamaño de `size`, colocada en `at`. */
  private drawGhost(html: string, at: Box, size: Box): HTMLElement {
    const g = document.createElement('div');
    g.className = 'fx-draw';
    g.style.setProperty('--dw', `${size.w}px`);
    g.style.setProperty('--dh', `${size.h}px`);
    g.innerHTML = html;
    return this.place(g, { x: at.x + (at.w - size.w) / 2, y: at.y + (at.h - size.h) / 2, w: size.w, h: size.h });
  }

  /**
   * Robo propio: cada carta sale del mazo boca abajo, sube al centro, se voltea para mostrarse
   * un momento y baja a su hueco de la mano.
   */
  async draw(cards: HTMLElement[], deck: HTMLElement | null, backHtml: string): Promise<void> {
    if (!deck || !cards.length || this.ms(100) <= 0) return;
    const d = this.box(deck);
    const root = this.box(this.root);
    for (const c of cards) c.style.visibility = 'hidden';
    const n = cards.length;
    await Promise.all(
      cards.map(async (c, i) => {
        try {
          await this.wait(i * 170);
          const b = this.box(c);
          const g = this.drawGhost(backHtml, d, b);
          const g0 = this.box(g);
          const s = n > 3 ? 1.25 : 1.6;
          const spread = Math.min(b.w * s + 10, (root.w - 24) / n);
          const cx = root.w / 2 - b.w / 2 + (i - (n - 1) / 2) * spread - g0.x;
          const cy = root.h * 0.52 - b.h / 2 - g0.y;
          const at = (x: number, y: number, sx: number, sy = sx) => `translate(${x}px,${y}px) scale(${sx},${sy})`;
          // Sale del mazo.
          await this.run(g, [{ transform: at(0, 0, 1) }, { transform: at(0, -16, 1.12) }], 130, { easing: 'ease-out' });
          // Al centro, más grande.
          await this.run(g, [{ transform: at(0, -16, 1.12) }, { transform: at(cx, cy, s) }], 260, { easing: 'ease-out' });
          // Se voltea.
          await this.run(g, [{ transform: at(cx, cy, s) }, { transform: at(cx, cy, 0, s) }], 90, { easing: 'ease-in' });
          const face = c.cloneNode(true) as HTMLElement;
          face.removeAttribute('data-z');
          face.removeAttribute('data-h');
          face.className = face.className.replace(/\b(hl|flash|tg\S*)\b/g, '');
          face.style.visibility = '';
          g.replaceChildren(face);
          await this.run(g, [{ transform: at(cx, cy, 0, s) }, { transform: at(cx, cy, s) }], 90, { easing: 'ease-out' });
          await this.wait(380);
          // A la mano.
          const dx = b.x - g0.x;
          const dy = b.y - g0.y;
          await this.run(g, [{ transform: at(cx, cy, s) }, { transform: at(dx, dy, 1) }], 260, { easing: 'ease-in' });
          g.remove();
        } finally {
          c.style.visibility = '';
        }
      }),
    );
  }

  /** Robo del rival: reversos que salen de su mazo y vuelan a su mano. */
  async drawTheirs(count: number, deck: HTMLElement | null, hand: HTMLElement | null, backHtml: string): Promise<void> {
    if (!deck || !count || this.ms(100) <= 0) return;
    const d = this.box(deck);
    const t = hand ? this.box(hand) : { x: d.x, y: 0, w: d.w, h: 0 };
    await Promise.all(
      Array.from({ length: count }, async (_, i) => {
        await this.wait(i * 150);
        const g = this.drawGhost(backHtml, d, { x: 0, y: 0, w: d.w * 0.8, h: d.h * 0.8 });
        const g0 = this.box(g);
        const dx = t.x + t.w / 2 - (g0.x + g0.w / 2);
        const dy = t.y + t.h / 2 - (g0.y + g0.h / 2);
        await this.run(g, [{ transform: 'translate(0,0) scale(1)' }, { transform: 'translate(0,12px) scale(1.12)', offset: 0.25 }, { transform: `translate(${dx}px,${dy}px) scale(0.35)`, opacity: 0.4 }], 520, {
          easing: 'ease-in',
        });
        g.remove();
      }),
    );
  }

  /** El número de LP baja (o sube) poco a poco. */
  tweenNumber(el: HTMLElement, from: number, to: number, duration = 650): void {
    const d = this.ms(duration);
    if (d <= 0 || from === to) return;
    const t0 = performance.now();
    const step = (t: number) => {
      const k = Math.min(1, (t - t0) / d);
      el.textContent = String(Math.round(from + (to - from) * k));
      if (k < 1 && el.isConnected) requestAnimationFrame(step);
    };
    el.textContent = String(from);
    requestAnimationFrame(step);
  }

  wait(ms: number): Promise<void> {
    return wait(this.ms(ms));
  }
}
