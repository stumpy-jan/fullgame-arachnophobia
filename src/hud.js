import { icon, SLOT_ICONS } from './icons.js';

// The on-screen bits during a run, kept quiet: top left the specimen's health, what it has consumed and the
// locks; bottom centre the six body slots as icons (a dim outline while empty, the mutation's own icon once
// grown, its key, a cooldown sweep, a tooltip on hover); above them a prompt only when there's something to do
// right now (F to feed). The vat's choice of three mutations; a notice across the middle.
export class Hud {
  constructor() {
    const css = document.createElement('style');
    css.textContent = `
      .hudon #stat, .hudon #slots { opacity: 1; }
      #stat { position: fixed; left: 20px; top: 18px; width: 236px; font: 11px/1.4 ui-monospace, Consolas, monospace; color: #b9c2bf;
        letter-spacing: 0.14em; text-shadow: 0 1px 2px #000; pointer-events: none; user-select: none; opacity: 0; transition: opacity 0.8s; }
      #stat .row { display: flex; justify-content: space-between; align-items: baseline; }
      #stat .bar { height: 7px; margin: 5px 0 9px; background: rgba(255,255,255,0.07); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.14); }
      #stat .fill { height: 100%; background: linear-gradient(90deg, #6d0f0a, #d02a1c); transition: width 0.15s; box-shadow: 0 0 10px rgba(210,40,28,0.45); }
      #stat .k { color: #efe9e5; font-size: 13px; }
      #stat .lk { color: #e0b25a; }
      #stat .lk.open { color: #9fe38a; }
      #slots { position: fixed; left: 50%; bottom: 18px; transform: translateX(-50%); display: flex; gap: 8px; user-select: none; opacity: 0; transition: opacity 0.8s; }
      #slots .s { position: relative; width: 48px; height: 48px; display: grid; place-items: center; color: rgba(190,200,197,0.28);
        background: rgba(6,8,9,0.55); box-shadow: inset 0 0 0 1px rgba(255,255,255,0.1); cursor: default; }
      #slots .s svg { width: 28px; height: 28px; }
      #slots .s.on { color: #f0e9e4; background: rgba(28,8,10,0.7); box-shadow: inset 0 0 0 1px rgba(210,58,40,0.75); }
      #slots .s .key { position: absolute; left: 3px; top: 1px; font: 600 10px ui-monospace, Consolas, monospace; color: #c9a24a; }
      #slots .s .cd { position: absolute; inset: 0; background: conic-gradient(rgba(0,0,0,0.72) var(--p), transparent 0); pointer-events: none; }
      #slots .s.ready { animation: ready 0.5s ease-out; }
      @keyframes ready { from { box-shadow: inset 0 0 0 2px #ff6a50, 0 0 16px rgba(255,90,60,0.7); } }
      #tip { position: fixed; z-index: 30; width: 230px; padding: 10px 12px; background: rgba(8,6,7,0.94); box-shadow: inset 0 0 0 1px rgba(210,58,40,0.5);
        font: 12px/1.45 ui-monospace, Consolas, monospace; color: #c9c3c0; pointer-events: none; display: none; }
      #tip h4 { margin: 0 0 2px; color: #fff; font-size: 13px; letter-spacing: 0.08em; }
      #tip .sl { color: #ff6ab8; font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; }
      #tip p { margin: 6px 0 0; }
      #prompt { position: fixed; left: 50%; bottom: 80px; transform: translateX(-50%); font: 12px ui-monospace, Consolas, monospace; letter-spacing: 0.2em;
        color: #f2ead8; text-shadow: 0 1px 3px #000; pointer-events: none; opacity: 0; transition: opacity 0.2s; }
      #prompt b { color: #c9a24a; padding: 1px 6px; box-shadow: inset 0 0 0 1px rgba(201,162,74,0.6); margin-right: 8px; }
      #note { position: fixed; left: 0; right: 0; top: 22%; text-align: center; color: #f2ead8; font: 600 26px ui-monospace, Consolas, monospace;
        letter-spacing: 0.35em; text-shadow: 0 2px 8px #000; pointer-events: none; opacity: 0; transition: opacity 0.6s; }
      #choice { position: fixed; inset: 0; z-index: 35; display: none; align-items: center; justify-content: center; gap: 18px;
        background: radial-gradient(circle, rgba(30,6,18,0.45), rgba(0,0,0,0.78)); font: 13px/1.5 ui-monospace, Consolas, monospace; }
      #choice .t { position: absolute; top: 17%; width: 100%; text-align: center; color: #f0e6ea; font-size: 22px; letter-spacing: 0.3em; }
      #choice .c { width: 250px; padding: 18px 18px 20px; border: 1px solid rgba(255,80,170,0.45); background: rgba(14,6,12,0.9); color: #d9d2d6;
        cursor: pointer; transition: border-color 0.12s, transform 0.12s; }
      #choice .c:hover { border-color: #ff4aa8; transform: translateY(-3px); }
      #choice .c .ic { width: 40px; height: 40px; color: #ff8cc6; margin-bottom: 8px; }
      #choice .c h3 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0.08em; color: #fff; }
      #choice .c .sl { color: #ff6ab8; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; }
      #choice .c p { margin: 12px 0 0; color: #b9b1b6; }
      #choice .c .k { float: right; color: #8a7f85; }
      .shot #stat, .shot #slots, .shot #prompt { display: none !important; }`;
    document.head.appendChild(css);
    const div = (id, html = '') => { const d = document.createElement('div'); d.id = id; d.innerHTML = html; document.body.appendChild(d); return d; };
    this.el = div('stat', '<div class="row"><span>SPECIMEN 9</span><span class="lk"></span></div><div class="bar"><div class="fill"></div></div><div class="row"><span>CONSUMED</span><span class="k">0</span></div>');
    this.fill = this.el.querySelector('.fill'); this.k = this.el.querySelector('.k'); this.lk = this.el.querySelector('.lk');
    this.note = div('note');
    this.prompt = div('prompt');
    this.slotsEl = div('slots');
    this.tip = div('tip');
    this.choiceEl = div('choice');
    this.slotEls = [];
  }

  show(on) { document.documentElement.classList.toggle('hudon', on); if (!on) this.tip.style.display = 'none'; }

  set(hp, kills) {
    const w = `${Math.max(0, hp).toFixed(1)}%`;
    if (w !== this._w) { this.fill.style.width = w; this._w = w; }
    if (kills !== this._k) { this.k.textContent = kills; this._k = kills; }
  }
  locks(done, total, open) {
    const t = total ? (open ? 'EXIT OPEN' : `LOCKS ${done}/${total}`) : '';
    if (t !== this._lk) { this.lk.textContent = t; this.lk.classList.toggle('open', !!open); this._lk = t; }
  }
  notice(text) { this.note.textContent = text; this.note.style.opacity = 1; clearTimeout(this._nt); this._nt = setTimeout(() => (this.note.style.opacity = 0), 3200); }
  // a prompt for what can be done right now (null: nothing)
  hint(key, text) {
    const h = key ? `<b>${key}</b>${text}` : '';
    if (h !== this._h) { if (h) this.prompt.innerHTML = h; this.prompt.style.opacity = h ? 1 : 0; this._h = h; }
  }

  // the six body slots: [{ slot, slotName, id, name, text, key, cd, max }]
  slots(list) {
    const sig = list.map((s) => `${s.slot}:${s.id || ''}`).join('|');
    if (sig !== this._sig) { // (rebuilt only when a mutation is grown)
      this._sig = sig;
      this.slotsEl.innerHTML = list.map((s) => `<div class="s ${s.id ? 'on' : ''}">${s.id ? icon(s.id, s.slot) : SLOT_ICONS[s.slot]}${s.key && s.id ? `<span class="key">${s.key}</span>` : ''}<i class="cd"></i></div>`).join('');
      this.slotEls = [...this.slotsEl.children];
      this.slotEls.forEach((el, i) => {
        const s = list[i];
        el.onmouseenter = () => {
          this.tip.innerHTML = s.id ? `<span class="sl">${s.slotName}${s.key ? ' / ' + s.key : ''}</span><h4>${s.name}</h4><p>${s.text}</p>`
            : `<span class="sl">${s.slotName}</span><h4>Empty</h4><p>Smash a specimen vat to grow a mutation here.</p>`;
          const r = el.getBoundingClientRect();
          this.tip.style.display = 'block'; this.tip.style.left = `${Math.min(innerWidth - 250, r.left - 90)}px`; this.tip.style.top = `${r.top - this.tip.offsetHeight - 10}px`;
        };
        el.onmouseleave = () => { this.tip.style.display = 'none'; };
      });
      this._cd = [];
    }
    list.forEach((s, i) => {
      const p = s.max ? Math.round((360 * s.cd) / s.max) : 0;
      if (p !== this._cd[i]) {
        const el = this.slotEls[i];
        el.querySelector('.cd').style.setProperty('--p', `${p}deg`);
        if (p === 0 && this._cd[i] > 0) { el.classList.remove('ready'); void el.offsetWidth; el.classList.add('ready'); } // a flash: ready again
        this._cd[i] = p;
      }
    });
  }

  // a vat broken open: three mutations to choose from (click, or 1-3)
  choose(options, onPick) {
    this.choiceEl.innerHTML = '<div class="t">MUTATE</div>' + options.map((o, i) => `<div class="c" data-i="${i}"><span class="k">${i + 1}</span><div class="ic">${icon(o.id, o.slot)}</div><span class="sl">${o.slotName}${o.key ? ' / ' + o.key : ''}</span><h3>${o.name}</h3><p>${o.text}</p></div>`).join('');
    for (const el of this.choiceEl.querySelectorAll('.c')) el.onclick = () => onPick(+el.dataset.i);
    this.choiceEl.style.display = 'flex';
  }
  closeChoice() { this.choiceEl.style.display = 'none'; }

  // the gym's picker: one button per spider version, the current one lit
  versions(list, current, onPick) {
    const el = document.createElement('div');
    el.style.cssText = 'position:fixed;right:16px;top:14px;display:flex;gap:6px;align-items:center;font:11px/1.3 ui-monospace,Consolas,monospace;letter-spacing:0.08em;color:#9aa5a2;z-index:5';
    el.innerHTML = 'SPIDER <span style="opacity:0.6">(V)</span>' + Object.entries(list).map(([k, name]) => `<button data-k="${k}" style="font:inherit;letter-spacing:inherit;padding:5px 9px;cursor:pointer;background:${k === current ? 'rgba(206,60,40,0.35)' : 'rgba(6,8,9,0.65)'};color:${k === current ? '#fff' : '#b8c2bf'};border:1px solid ${k === current ? 'rgba(226,80,60,0.9)' : 'rgba(255,255,255,0.18)'}">${name}</button>`).join('');
    for (const b of el.querySelectorAll('button')) b.onclick = () => b.dataset.k !== current && onPick(b.dataset.k);
    document.body.appendChild(el);
  }
}
