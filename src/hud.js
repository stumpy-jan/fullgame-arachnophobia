// The on-screen bits: the specimen's health, the body count, and the end screen.
export class Hud {
  constructor() {
    const css = document.createElement('style');
    css.textContent = `
      #stat { position: fixed; left: 18px; top: 16px; font: 12px/1.4 ui-monospace, Consolas, monospace; color: #c9d3cf;
        letter-spacing: 0.08em; text-shadow: 0 1px 2px #000; pointer-events: none; user-select: none; }
      #stat .bar { width: 220px; height: 8px; background: rgba(255,255,255,0.08); border: 1px solid rgba(255,255,255,0.18); margin: 4px 0 8px; }
      #stat .fill { height: 100%; background: linear-gradient(90deg, #6d0f0a, #c2261a); transition: width 0.15s; }
      #over { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; flex-direction: column;
        background: radial-gradient(circle, rgba(40,0,0,0.35), rgba(0,0,0,0.75)); color: #e8e0dc; font: 600 28px/1.3 ui-monospace, Consolas, monospace;
        letter-spacing: 0.25em; text-align: center; }
      #over small { font-size: 13px; letter-spacing: 0.12em; opacity: 0.7; margin-top: 12px; }
      .shot #stat, .shot #over { display: none !important; }
      #slots { position: fixed; left: 50%; bottom: 14px; transform: translateX(-50%); display: flex; gap: 6px; pointer-events: none;
        font: 11px/1.3 ui-monospace, Consolas, monospace; letter-spacing: 0.06em; }
      #slots .s { position: relative; width: 104px; padding: 5px 7px 6px; border: 1px solid rgba(255,255,255,0.16); background: rgba(6,8,9,0.6);
        color: #6f7a78; overflow: hidden; }
      #slots .s.on { color: #e3e9e6; border-color: rgba(206,60,40,0.7); }
      #slots .s b { color: #c9a24a; margin-right: 4px; }
      #slots .s .n { display: block; color: inherit; font-size: 12px; margin-top: 2px; white-space: nowrap; }
      #slots .s .cd { position: absolute; left: 0; bottom: 0; height: 3px; background: #c33a26; }
      #choice { position: fixed; inset: 0; display: none; align-items: center; justify-content: center; gap: 18px;
        background: radial-gradient(circle, rgba(30,6,18,0.45), rgba(0,0,0,0.78)); font: 13px/1.5 ui-monospace, Consolas, monospace; }
      #choice .t { position: absolute; top: 18%; width: 100%; text-align: center; color: #f0e6ea; font-size: 22px; letter-spacing: 0.3em; }
      #choice .c { width: 250px; padding: 18px 18px 20px; border: 1px solid rgba(255,80,170,0.45); background: rgba(14,6,12,0.88); color: #d9d2d6;
        cursor: pointer; transition: border-color 0.12s, transform 0.12s; }
      #choice .c:hover { border-color: #ff4aa8; transform: translateY(-3px); }
      #choice .c h3 { margin: 0 0 4px; font-size: 18px; letter-spacing: 0.08em; color: #fff; }
      #choice .c .sl { color: #ff6ab8; font-size: 11px; letter-spacing: 0.18em; text-transform: uppercase; }
      #choice .c p { margin: 12px 0 0; color: #b9b1b6; }
      #choice .c .k { float: right; color: #8a7f85; }
      .shot #slots { display: none !important; }`;
    document.head.appendChild(css);
    this.el = document.createElement('div');
    this.el.id = 'stat';
    this.el.innerHTML = 'SPECIMEN 9<div class="bar"><div class="fill"></div></div><span class="k">0</span> CONSUMED';
    document.body.appendChild(this.el);
    this.fill = this.el.querySelector('.fill'); this.k = this.el.querySelector('.k');
    this.slotsEl = document.createElement('div'); this.slotsEl.id = 'slots'; document.body.appendChild(this.slotsEl);
    this.choiceEl = document.createElement('div'); this.choiceEl.id = 'choice'; document.body.appendChild(this.choiceEl);
    this.over = document.createElement('div');
    this.over.id = 'over';
    document.body.appendChild(this.over);
  }
  set(hp, kills) { this.fill.style.width = `${Math.max(0, hp)}%`; this.k.textContent = kills; }
  // the six body slots: key, mutation (or empty), cooldown bar
  slots(list) {
    const html = list.map((s) => `<div class="s ${s.name ? 'on' : ''}">${s.key ? `<b>${s.key}</b>` : ''}${s.slot}<span class="n">${s.name || '-'}</span>${s.max ? `<i class="cd" style="width:${(100 * s.cd) / s.max}%"></i>` : ''}</div>`).join('');
    if (html !== this._slots) { this.slotsEl.innerHTML = html; this._slots = html; }
  }
  // a vat broken open: three mutations to choose from (click, or 1-3)
  choose(options, onPick) {
    this.choiceEl.innerHTML = '<div class="t">MUTATE</div>' + options.map((o, i) => `<div class="c" data-i="${i}"><span class="k">${i + 1}</span><span class="sl">${o.slotName}${o.key ? ' / ' + o.key : ''}</span><h3>${o.name}</h3><p>${o.text}</p></div>`).join('');
    for (const el of this.choiceEl.querySelectorAll('.c')) el.onclick = () => onPick(+el.dataset.i);
    this.choiceEl.style.display = 'flex';
  }
  closeChoice() { this.choiceEl.style.display = 'none'; }
  end(text) { this.over.innerHTML = `${text}<small>press R to try again</small>`; this.over.style.display = 'flex'; }
}
