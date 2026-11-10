import { FIELDS } from './settings.js';

// The screens around a run: the loading veil (black from the first paint, in index.html, faded out once the
// level is built and every shader compiled, so nothing pops in), the title, pause, settings and the end of a run
// with its summary. One overlay; each screen replaces the last. Buttons and Escape drive it (main.js).
export class Menu {
  constructor() {
    const css = document.createElement('style');
    css.textContent = `
      #menu { position: fixed; inset: 0; z-index: 40; display: none; align-items: center; justify-content: center; flex-direction: column;
        font: 13px/1.5 ui-monospace, Consolas, monospace; color: #d9dedb; letter-spacing: 0.08em; user-select: none;
        background: radial-gradient(ellipse at center, rgba(4,2,3,0.72), rgba(0,0,0,0.88)); opacity: 0; transition: opacity 0.5s; }
      #menu.on { opacity: 1; }
      #menu.clear { background: linear-gradient(90deg, rgba(0,0,0,0.78), rgba(0,0,0,0.2) 55%, rgba(0,0,0,0)); align-items: flex-start; padding-left: 9vw; }
      #menu h1 { margin: 0; font-size: 46px; font-weight: 600; letter-spacing: 0.32em; color: #efe7e2; text-shadow: 0 0 24px rgba(200,30,20,0.35); }
      #menu h2 { margin: 0 0 6px; font-size: 22px; font-weight: 600; letter-spacing: 0.3em; color: #efe7e2; }
      #menu .sub { color: #9a8f8a; margin: 6px 0 34px; letter-spacing: 0.22em; font-size: 12px; }
      #menu .btns { display: flex; flex-direction: column; gap: 4px; min-width: 260px; }
      #menu button { all: unset; cursor: pointer; padding: 9px 14px; color: #c9ccca; border-left: 2px solid transparent; letter-spacing: 0.2em; font-size: 14px; transition: color 0.12s, border-color 0.12s, background 0.12s; }
      #menu button:hover, #menu button:focus-visible { color: #fff; border-left-color: #d23a28; background: linear-gradient(90deg, rgba(210,58,40,0.18), rgba(210,58,40,0)); }
      #menu .keys { margin-top: 34px; display: grid; grid-template-columns: 64px auto; gap: 4px 14px; color: #7f8784; font-size: 11px; letter-spacing: 0.12em; }
      #menu .keys b { color: #c9a24a; font-weight: 600; }
      #menu .stats { margin: 18px 0 28px; display: grid; grid-template-columns: auto auto; gap: 6px 28px; font-size: 13px; }
      #menu .stats span:nth-child(odd) { color: #8e9693; }
      #menu .stats span:nth-child(even) { color: #f0ebe7; text-align: right; }
      #menu .set { display: grid; grid-template-columns: 320px 220px; gap: 10px 22px; align-items: center; margin: 18px 0 26px; }
      #menu .set label { color: #aab2af; }
      #menu input[type=range] { width: 100%; accent-color: #d23a28; }
      #menu .opts { display: flex; gap: 6px; }
      #menu .opts button { padding: 4px 10px; border: 1px solid rgba(255,255,255,0.16); font-size: 12px; letter-spacing: 0.1em; }
      #menu .opts button.on { color: #fff; border-color: #d23a28; background: rgba(210,58,40,0.25); }
      #menu .dead { color: #e0574a; } #menu .won { color: #f2d9a0; }`;
    document.head.appendChild(css);
    this.el = document.createElement('div'); this.el.id = 'menu'; document.body.appendChild(this.el);
    this.veil = document.getElementById('veil');
    this.screen = null;
  }

  // the loading veil: lift it (once everything is ready)
  reveal(ms = 1400) {
    if (!this.veil) return;
    this.veil.style.transition = `opacity ${ms}ms ease`;
    this.veil.style.opacity = 0;
    setTimeout(() => this.veil?.remove(), ms + 50);
  }

  show(html, cls = '') {
    this.el.className = cls; this.el.innerHTML = html; this.el.style.display = 'flex';
    requestAnimationFrame(() => this.el.classList.add('on'));
  }
  hide() { this.el.classList.remove('on'); this.screen = null; setTimeout(() => { if (!this.screen) this.el.style.display = 'none'; }, 500); }
  bind(actions) { for (const b of this.el.querySelectorAll('[data-a]')) b.onclick = () => { this.click?.(); actions[b.dataset.a]?.(); }; }

  title({ onStart, onSettings, seed }) {
    this.screen = 'title';
    this.show(`<h1>ARACHNOPHOBIA</h1><div class="sub">SPECIMEN 9 &middot; FACILITY ${seed}</div>
      <div class="btns"><button data-a="start">BREAK OUT</button><button data-a="settings">SETTINGS</button></div>${KEYS}`, 'clear');
    this.bind({ start: onStart, settings: onSettings });
  }

  pause({ onResume, onSettings, onRestart, onQuit }) {
    this.screen = 'pause';
    this.show(`<h2>PAUSED</h2><div class="sub">ESC TO RESUME</div>
      <div class="btns"><button data-a="resume">RESUME</button><button data-a="settings">SETTINGS</button><button data-a="restart">NEW FACILITY</button><button data-a="quit">QUIT TO TITLE</button></div>${KEYS}`);
    this.bind({ resume: onResume, settings: onSettings, restart: onRestart, quit: onQuit });
  }

  settings(values, onChange, onBack) {
    this.screen = 'settings';
    const row = (f) => {
      if (f.type === 'range') return `<label>${f.label}</label><input type="range" min="0" max="1" step="0.05" value="${values[f.key]}" data-k="${f.key}">`;
      const opts = f.type === 'toggle' ? [[true, 'On'], [false, 'Off']] : f.options;
      return `<label>${f.label}</label><div class="opts">${opts.map(([v, n]) => `<button data-k="${f.key}" data-v='${JSON.stringify(v)}' class="${values[f.key] === v ? 'on' : ''}">${n}</button>`).join('')}</div>`;
    };
    this.show(`<h2>SETTINGS</h2><div class="set">${FIELDS.map(row).join('')}</div><div class="btns"><button data-a="back">BACK</button></div>`);
    for (const r of this.el.querySelectorAll('input[type=range]')) r.oninput = () => onChange(r.dataset.k, +r.value);
    for (const b of this.el.querySelectorAll('.opts button')) b.onclick = () => {
      onChange(b.dataset.k, JSON.parse(b.dataset.v));
      for (const o of this.el.querySelectorAll(`.opts button[data-k="${b.dataset.k}"]`)) o.classList.toggle('on', o === b);
      this.click?.();
    };
    this.bind({ back: onBack });
  }

  end({ escaped, stats, onNew, onRetry, onTitle }) {
    this.screen = 'end';
    this.show(`<h2 class="${escaped ? 'won' : 'dead'}">${escaped ? 'ESCAPED' : 'SPECIMEN TERMINATED'}</h2>
      <div class="sub">${escaped ? 'OUT INTO THE LIGHT' : 'CONTAINMENT RESTORED'}</div>
      <div class="stats">${stats.map(([k, v]) => `<span>${k}</span><span>${v}</span>`).join('')}</div>
      <div class="btns"><button data-a="new">NEW FACILITY</button><button data-a="retry">THIS FACILITY AGAIN</button><button data-a="title">TITLE</button></div>`);
    this.bind({ new: onNew, retry: onRetry, title: onTitle });
  }
}

const KEYS = '<div class="keys">' + [['WASD', 'move'], ['SHIFT', 'scuttle'], ['MOUSE', 'face, aim'], ['', 'slashes what is in front, by itself (standing still: more legs)'], ['F', 'feed on a body'], ['Q E R', 'powers, once grown at a vat'], ['ESC', 'pause']].map(([k, t]) => '<b>' + k + '</b><span>' + t + '</span>').join('') + '</div>';
