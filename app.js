/* Dinners — static weekly menu app.
   Data: data/index.json (list of weeks, newest first) and data/weeks/<id>.json. */
const app = document.getElementById('app');
const cache = {};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>'
};

async function getJSON(url) {
  if (cache[url]) return cache[url];
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Couldn't load the menu (${r.status})`);
  return (cache[url] = await r.json());
}
const getIndex = () => getJSON('data/index.json');
const getWeek = id => getJSON(`data/weeks/${id}.json`);

/* per-device state: cooked nights and used ingredients */
const local = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const cooked = id => new Set(local.get(`cooked:${id}`, []));
const setCooked = (id, s) => local.set(`cooked:${id}`, [...s]);
const used = (id, n) => new Set(local.get(`used:${id}:${n}`, []));
const setUsed = (id, n, s) => local.set(`used:${id}:${n}`, [...s]);
const nextNight = w => { const c = cooked(w.id); return w.dinners.find(d => !c.has(d.night)) || null; };

const style = d => `--c:${d.colour};--ink:${d.ink}`;
const vt = n => `view-transition-name:night-${n}`;

/* ---------- this week / a past week ---------- */
async function viewWeek(id) {
  const idx = await getIndex();
  const current = idx.weeks[0]?.id;
  if (!current) return empty('No menu yet. The first one arrives on Saturday.');
  const wid = id || current;
  const isCurrent = wid === current;
  const w = await getWeek(wid);
  const done = cooked(w.id);
  const base = isCurrent ? '#' : `#/w/${w.id}`;
  const up = isCurrent ? nextNight(w) : null;

  const progress = `<div class="progress" aria-label="${done.size} of ${w.dinners.length} cooked">${w.dinners.map(d => `<i class="${done.has(d.night) ? 'on' : ''}" style="${style(d)}"></i>`).join('')}</div>`;

  let lead = '';
  if (isCurrent && up) {
    lead = `<section class="tonight" style="${style(up)};${vt(up.night)}">
      <div class="num" aria-hidden="true">${up.night}</div>
      <div>
        <div class="label">${done.size ? 'Up next' : 'Tonight'}, night ${up.night}</div>
        <h2>${esc(up.title)}</h2>
        <div class="meta">${esc(up.time)}, ${esc(up.protein)} protein each, ${esc(up.method.toLowerCase())}</div>
        <div class="ctas">
          <a class="pill solid" href="${base}/n/${up.night}/cook">${icon.play}Start cooking</a>
          <a class="pill ghost" href="${base}/n/${up.night}">See recipe</a>
        </div>
      </div>
    </section>`;
  } else if (isCurrent) {
    lead = `<section class="done-card"><h2>All 7 cooked</h2><p>Next week's menu lands on Saturday afternoon.</p></section>`;
  }

  const rest = w.dinners.filter(d => !up || d.night !== up.night);
  const rows = rest.map(d => {
    const c = done.has(d.night);
    return `<li><a class="night${c ? ' cooked' : ''}" style="${style(d)}" href="${base}/n/${d.night}">
      <span class="chip" style="${vt(d.night)}">${d.night}</span>
      <span><span class="t" style="display:block">${esc(d.title)}</span><span class="m">${c ? 'Cooked' : `${esc(d.time)}, ${esc(d.protein)} protein`}</span></span>
      <span class="go">${icon.next}</span></a></li>`;
  }).join('');

  const when = isCurrent ? `${done.size} of ${w.dinners.length} cooked${w.shopping?.total ? `, ${w.shopping.total} shop` : ''}` : 'Past week';
  render(`<section class="page">
    <div class="week-head"><h1 class="title">${esc(w.label)}</h1><p class="when">${esc(when)}</p></div>
    ${progress}
    <div class="week-grid">
      ${lead ? `<div>${lead}</div>` : ''}
      <div>
        <h2 class="later-h">${isCurrent && up ? 'Rest of the week' : 'The week'}</h2>
        <ol class="nights">${rows}</ol>
        ${w.notes?.length ? `<ul class="notes">${w.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
      </div>
    </div>
  </section>`, { tab: 'week', title: w.label });
}

/* ---------- recipe ---------- */
async function loadDinner(wid, night) {
  const idx = await getIndex();
  const id = wid || idx.weeks[0].id;
  const w = await getWeek(id);
  const n = Number(night);
  const d = w.dinners.find(x => x.night === n);
  const base = wid && wid !== idx.weeks[0].id ? `#/w/${id}` : '#';
  return { id, w, n, d, base };
}

async function viewRecipe(wid, night) {
  const { id, w, n, d, base } = await loadDinner(wid, night);
  if (!d) return empty('That dinner doesn’t exist.');
  const u = used(id, n);
  const prev = w.dinners.find(x => x.night === n - 1), next = w.dinners.find(x => x.night === n + 1);
  const ing = d.ingredients.map((i, k) => `<li><button class="${u.has(k) ? 'used' : ''}" data-k="${k}" aria-pressed="${u.has(k)}"><span class="q">${esc(i.qty)}</span><span>${esc(i.item)}</span></button></li>`).join('');
  const steps = d.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('');
  const isDone = cooked(id).has(n);

  render(`<article>
    <header class="r-hero" style="${style(d)};${vt(n)}">
      <a class="back" href="${base}/">${icon.back}${esc(w.label)}</a>
      <div class="num" aria-hidden="true">${n}</div>
      <h1>${esc(d.title)}</h1>
      <ul class="facts"><li><b>${esc(d.time)}</b><span>total</span></li><li><b>${esc(d.protein)}</b><span>protein each</span></li><li><b>${esc(d.method)}</b><span>cook with</span></li></ul>
      <div><a class="pill solid" href="${base}/n/${n}/cook">${icon.play}Start cooking</a></div>
    </header>
    <div class="r-body" style="${style(d)}">
      <div class="left"><h2>Ingredients<small>for 2, tap to tick off</small></h2><ul class="ing">${ing}</ul></div>
      <div><h2>Method</h2><ol class="steps">${steps}</ol>
        ${d.tip ? `<p class="tip"><b>Tip</b>${esc(d.tip)}</p>` : ''}
      </div>
    </div>
    <div class="r-actions">
      <a class="sq" href="${base}/n/${n - 1}" aria-label="Previous night" aria-disabled="${!prev}">${icon.back}</a>
      <button class="mark${isDone ? ' is-done' : ''}" id="mark">${isDone ? 'Cooked ✓' : 'Mark as cooked'}</button>
      <a class="sq" href="${base}/n/${n + 1}" aria-label="Next night" aria-disabled="${!next}">${icon.next}</a>
    </div>
  </article>`, { tab: 'week', title: d.title, colour: d.colour });

  app.querySelectorAll('.ing button').forEach(b => b.onclick = () => {
    const s = used(id, n), k = Number(b.dataset.k);
    s.has(k) ? s.delete(k) : s.add(k);
    setUsed(id, n, s);
    b.classList.toggle('used', s.has(k));
    b.setAttribute('aria-pressed', s.has(k));
  });
  document.getElementById('mark').onclick = e => {
    const s = cooked(id);
    s.has(n) ? s.delete(n) : s.add(n);
    setCooked(id, s);
    e.currentTarget.classList.toggle('is-done', s.has(n));
    e.currentTarget.textContent = s.has(n) ? 'Cooked ✓' : 'Mark as cooked';
  };
  onSwipe(prev && `${base}/n/${n - 1}`, next && `${base}/n/${n + 1}`);
}

/* ---------- cook mode: one step per screen, screen kept awake ---------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
    if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch {}
}

/* timers: parsed from step text, kept running across steps while the app is open */
const timers = [];
let tick = null, audio = null;
function parseTime(text) {
  const m = text.match(/(\d+)(?:\s*[–-]\s*(\d+))?\s*(min|mins|minutes|sec|secs|seconds)\b/i);
  if (!m) return null;
  const lo = Number(m[1]), unit = /^s/i.test(m[3]) ? 1 : 60;
  return { secs: lo * unit, label: `${m[1]}${m[2] ? `–${m[2]}` : ''} ${unit === 1 ? 'sec' : 'min'}` };
}
const fmt = s => { s = Math.max(0, Math.ceil(s)); const m = Math.floor(s / 60); return `${m}:${String(s % 60).padStart(2, '0')}`; };
const left = t => t.paused ? t.remaining : (t.end - Date.now()) / 1000;
function beep() {
  try {
    audio = audio || new (window.AudioContext || window.webkitAudioContext)();
    [0, .35, .7].forEach(o => {
      const osc = audio.createOscillator(), g = audio.createGain();
      osc.frequency.value = 880; osc.connect(g); g.connect(audio.destination);
      const t0 = audio.currentTime + o;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.4, t0 + .02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + .28);
      osc.start(t0); osc.stop(t0 + .3);
    });
  } catch {}
}
function startTimer(name, secs) {
  try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch {}
  timers.push({ id: Date.now() + Math.random(), name, secs, end: Date.now() + secs * 1000, paused: false, remaining: secs, rang: false });
  drawTimers();
}
function drawTimers() {
  const tray = app.querySelector('.timers');
  if (!tray) return;
  tray.innerHTML = timers.map(t => {
    const l = left(t), done = l <= 0;
    return `<div class="timer${done ? ' ring' : ''}${t.paused ? ' paused' : ''}" data-id="${t.id}">
      <span class="tn">${esc(t.name)}</span><span class="tt">${done ? 'Done' : fmt(l)}</span>
      ${done ? '' : `<button data-a="pause" aria-label="${t.paused ? 'Resume' : 'Pause'} timer">${t.paused ? '▶' : 'Ⅱ'}</button><button data-a="add" aria-label="Add a minute">+1</button>`}
      <button data-a="del" aria-label="Clear timer">${icon.close}</button></div>`;
  }).join('');
  tray.hidden = !timers.length;
}
function tickTimers() {
  let changed = false;
  timers.forEach(t => { if (!t.paused && !t.rang && left(t) <= 0) { t.rang = true; changed = true; beep(); } });
  const tray = app.querySelector('.timers');
  if (!tray) return;
  if (changed) return drawTimers();
  tray.querySelectorAll('.timer').forEach(el => {
    const t = timers.find(x => String(x.id) === el.dataset.id);
    if (t && left(t) > 0) el.querySelector('.tt').textContent = fmt(left(t));
  });
}

async function viewCook(wid, night) {
  const { id, n, d, base } = await loadDinner(wid, night);
  if (!d) return empty('That dinner doesn’t exist.');
  let i = 0;
  const total = d.steps.length;
  render(`<div class="cook" style="${style(d)}" role="dialog" aria-label="Cooking ${esc(d.title)}">
    <div class="cook-top">
      <span class="chip">${n}</span><span class="t">${esc(d.title)}</span>
      <a class="x" href="${base}/n/${n}" aria-label="Close cook mode">${icon.close}</a>
    </div>
    <div class="cook-bar">${d.steps.map(() => '<i></i>').join('')}</div>
    <div class="cook-step" aria-live="polite"><div class="k"></div><p></p><button class="set-timer" hidden></button></div>
    <div class="timers" hidden></div>
    <div class="cook-nav"><button class="prev">Back</button><button class="next"></button></div>
  </div>`, { tab: 'week', title: d.title, colour: d.colour, cooking: true });

  const k = app.querySelector('.k'), p = app.querySelector('.cook-step p'), setB = app.querySelector('.set-timer');
  const bars = [...app.querySelectorAll('.cook-bar i')];
  const prevB = app.querySelector('.prev'), nextB = app.querySelector('.next');
  const show = () => {
    k.innerHTML = `Step <b>${i + 1}</b> of ${total}`;
    p.textContent = d.steps[i];
    bars.forEach((b, j) => b.classList.toggle('on', j <= i));
    prevB.disabled = i === 0;
    nextB.textContent = i === total - 1 ? 'Done, mark as cooked' : 'Next step';
    const t = parseTime(d.steps[i]);
    setB.hidden = !t;
    if (t) {
      setB.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>Start ${t.label} timer`;
      setB.onclick = () => startTimer(`Step ${i + 1}`, t.secs);
    }
  };
  const go = dir => {
    if (dir > 0 && i === total - 1) {
      const s = cooked(id); s.add(n); setCooked(id, s);
      location.hash = `${base}/`.slice(1);
      return;
    }
    i = Math.max(0, Math.min(total - 1, i + dir));
    show();
  };
  prevB.onclick = () => go(-1);
  nextB.onclick = () => go(1);
  app.querySelector('.timers').onclick = e => {
    const b = e.target.closest('button'); if (!b) return;
    const el = b.closest('.timer'), t = timers.find(x => String(x.id) === el.dataset.id); if (!t) return;
    if (b.dataset.a === 'del') timers.splice(timers.indexOf(t), 1);
    if (b.dataset.a === 'add') { if (t.paused) t.remaining += 60; else t.end += 60000; }
    if (b.dataset.a === 'pause') {
      if (t.paused) { t.end = Date.now() + t.remaining * 1000; t.paused = false; }
      else { t.remaining = left(t); t.paused = true; }
    }
    drawTimers();
  };
  onSwipe(() => go(-1), () => go(1));
  keyHandler = e => { if (e.key === 'ArrowRight' || e.key === ' ') go(1); if (e.key === 'ArrowLeft') go(-1); if (e.key === 'Escape') location.hash = `${base}/n/${n}`.slice(1); };
  document.addEventListener('keydown', keyHandler);
  show();
  drawTimers();
  if (!tick) tick = setInterval(tickTimers, 250);
  keepAwake(true);
}

/* ---------- shopping ---------- */
async function viewShop() {
  const idx = await getIndex();
  const w = await getWeek(idx.weeks[0].id);
  const s = w.shopping || {};
  const groups = Object.entries(s.groups || {}).map(([g, items]) =>
    `<section class="group"><h2>${esc(g)}<small>${items.length}</small></h2><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('');
  render(`<section class="page">
    <h1 class="title">Shopping</h1><p class="lede">In the Tesco basket for ${esc(w.label)}</p>
    ${s.total ? `<div class="shop-stats"><div><b>${esc(s.total)}</b><span>guide price</span></div><div><b>${esc(s.items)}</b><span>items</span></div></div>` : ''}
    ${groups ? `<div class="groups">${groups}</div>` : '<p class="empty">The basket list appears here after Saturday’s shop.</p>'}
  </section>`, { tab: 'shop', title: 'Shopping' });
}

/* ---------- archive ---------- */
async function viewArchive() {
  const idx = await getIndex();
  const items = idx.weeks.map((w, i) => `<li><a class="wk" href="${i === 0 ? '#/' : `#/w/${w.id}`}">
    <div class="chips">${w.colours.map(c => `<i style="--c:${c};background:var(--cc)"></i>`).join('')}</div>
    <h2>${esc(w.label)}${i === 0 ? '<em>This week</em>' : ''}</h2><p>${w.dinners.map(esc).join(', ')}</p></a></li>`).join('');
  render(`<section class="page"><h1 class="title">Past weeks</h1><p class="lede">${idx.weeks.length} week${idx.weeks.length === 1 ? '' : 's'} of dinners so far</p>
    <ul class="weeks">${items}</ul></section>`, { tab: 'archive', title: 'Past weeks' });
}

function empty(msg) { render(`<section class="page"><p class="empty">${esc(msg)}</p></section>`, { tab: 'week' }); }

/* ---------- plumbing ---------- */
const dark = matchMedia('(prefers-color-scheme: dark)');
let barColour = null;
function paintBar() {
  const bg = dark.matches ? '#000000' : '#ffffff';
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => m.remove());
  const m = document.createElement('meta');
  m.name = 'theme-color'; m.content = barColour || bg;
  document.head.appendChild(m);
}
dark.addEventListener('change', paintBar);

let keyHandler = null;
function render(html, { tab, title, colour, cooking } = {}) {
  app.innerHTML = html;
  document.title = title ? `${title} – Dinners` : 'Dinners';
  document.body.classList.toggle('cooking', !!cooking);
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  barColour = colour && !cooking ? colour : null;
  paintBar();
  if (!cooking) keepAwake(false);
  window.scrollTo(0, 0);
}

let swipe = null;
function onSwipe(prev, next) {
  let x0, y0;
  const s = e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
  const e = ev => {
    const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 60 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    const t = dx < 0 ? next : prev;
    if (typeof t === 'function') t();
    else if (t) location.hash = t.slice(1);
  };
  app.addEventListener('touchstart', s, { passive: true });
  app.addEventListener('touchend', e, { passive: true });
  swipe = { s, e };
}
function cleanup() {
  if (swipe) { app.removeEventListener('touchstart', swipe.s); app.removeEventListener('touchend', swipe.e); swipe = null; }
  if (keyHandler) { document.removeEventListener('keydown', keyHandler); keyHandler = null; }
}

async function route() {
  cleanup();
  const p = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  try {
    if (!p.length) return await viewWeek();
    if (p[0] === 'n') return p[2] === 'cook' ? await viewCook(null, p[1]) : await viewRecipe(null, p[1]);
    if (p[0] === 'shop') return await viewShop();
    if (p[0] === 'archive') return await viewArchive();
    if (p[0] === 'w' && p[2] === 'n') return p[4] === 'cook' ? await viewCook(p[1], p[3]) : await viewRecipe(p[1], p[3]);
    if (p[0] === 'w') return await viewWeek(p[1]);
    empty('Page not found.');
  } catch (err) {
    empty(`${err.message}. Check your connection and try again.`);
  }
}
function navigate() {
  if (document.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    document.startViewTransition(() => route());
  } else route();
}
window.addEventListener('hashchange', navigate);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && document.body.classList.contains('cooking')) keepAwake(true);
});
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
