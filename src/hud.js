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
      .shot #stat, .shot #over { display: none !important; }`;
    document.head.appendChild(css);
    this.el = document.createElement('div');
    this.el.id = 'stat';
    this.el.innerHTML = 'SPECIMEN 9<div class="bar"><div class="fill"></div></div><span class="k">0</span> CONSUMED';
    document.body.appendChild(this.el);
    this.fill = this.el.querySelector('.fill'); this.k = this.el.querySelector('.k');
    this.over = document.createElement('div');
    this.over.id = 'over';
    document.body.appendChild(this.over);
  }
  set(hp, kills) { this.fill.style.width = `${Math.max(0, hp)}%`; this.k.textContent = kills; }
  end(text) { this.over.innerHTML = `${text}<small>press R to try again</small>`; this.over.style.display = 'flex'; }
}
