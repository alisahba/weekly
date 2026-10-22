/* Dinners: a static weekly menu app.
   Data: data/index.json (list of weeks, newest first) and data/weeks/<id>.json.
   Shared state (cooked, ticks, delivery check-off, ratings) is local-first and,
   when a GitHub token is set on the device, synced to state/<weekId>.json on the
   repo's `state` branch, so both phones see the same thing. */
const app = document.getElementById('app');
const cache = {};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="M7 11v9H4v-9h3zm0 0l4-8c1.7 0 2.5 1 2.2 2.7L12.6 9H18a2 2 0 0 1 2 2.3l-1.2 7A2 2 0 0 1 16.8 20H7"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="M17 13V4h3v9h-3zm0 0l-4 8c-1.7 0-2.5-1-2.2-2.7l.6-3.3H6a2 2 0 0 1-2-2.3l1.2-7A2 2 0 0 1 7.2 4H17"/></svg>',
  sun: '<svg viewBox="0 0 24 24"><path d="M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4"/><circle cx="12" cy="12" r="3.5"/></svg>'
};

async function getJSON(url) {
  if (cache[url]) return cache[url];
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Couldn't load the menu (${r.status})`);
  return (cache[url] = await r.json());
}
const getIndex = () => getJSON('data/index.json');
const getWeek = id => getJSON(`data/weeks/${id}.json`);

/* ---------- dates ---------- */
const ymd = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const todayName = () => DAYS[new Date().getDay()];
const prettyDate = s => new Date(s + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' });

/* Which week is "this week": a week takes over on the Sunday before its Monday start,
   so a basket planned on Thursday stays "Next week" until then. */
function weekState(idx) {
  const weeks = idx.weeks || [];
  const today = ymd(new Date());
  const takeover = w => { if (!w.start) return '0000-00-00'; const d = new Date(w.start + 'T12:00:00'); d.setDate(d.getDate() - 1); return ymd(d); };
  const ci = weeks.findIndex(w => takeover(w) <= today);
  const curIdx = ci === -1 ? weeks.length - 1 : ci;
  return { current: weeks[curIdx], upcoming: curIdx > 0 ? weeks[curIdx - 1] : null, newest: weeks[0], isUpcoming: id => weeks.findIndex(w => w.id === id) < curIdx };
}

/* ---------- local storage ---------- */
const local = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  del(k) { try { localStorage.removeItem(k); } catch {} }
};

/* ---------- shared state + sync ----------
   Per week: { "<key>": { v: value, t: ms } }. Merge keeps the newest t per key.
   Keys: c:<n> cooked · u:<n>:<k> ingredient ticked · s:<g>:<i> shop got|missing · r:<n> up|down */
const REPO = 'alisahba/weekly', BRANCH = 'state';
const Sync = {
  token: () => local.get('gh_token', ''),
  status: 'local',            // local | ok | syncing | error
  sha: {}, timers: {}, inflight: {},
  key: id => `st:${id}`,
  read(id) {
    const s = local.get(this.key(id), null);
    if (s) return s;
    // migrate older per-device keys once
    const m = {};
    local.get(`cooked:${id}`, []).forEach(n => { m[`c:${n}`] = { v: true, t: 1 }; });
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i), mm = k && k.match(new RegExp(`^used:${id}:(.+)$`));
      if (mm) local.get(k, []).forEach(x => { m[`u:${mm[1]}:${x}`] = { v: true, t: 1 }; });
    }
    local.set(this.key(id), m);
    return m;
  },
  get(id, k) { return this.read(id)[k]?.v ?? null; },
  set(id, k, v) {
    const s = this.read(id);
    s[k] = { v, t: Date.now() };
    local.set(this.key(id), s);
    this.schedule(id);
  },
  merge(a, b) {
    const out = { ...a };
    for (const [k, e] of Object.entries(b || {})) if (!out[k] || (e?.t || 0) > (out[k].t || 0)) out[k] = e;
    return out;
  },
  api(path, opts = {}) {
    const h = { Accept: 'application/vnd.github+json' };
    const t = this.token(); if (t) h.Authorization = `Bearer ${t}`;
    return fetch(`https://api.github.com/repos/${REPO}/${path}`, { ...opts, headers: { ...h, ...(opts.headers || {}) }, cache: 'no-store' });
  },
  b64: { enc: s => btoa(String.fromCharCode(...new TextEncoder().encode(s))), dec: s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0))) },
  async pull(id) {
    if (!this.token()) { this.status = 'local'; return false; }
    try {
      const r = await this.api(`contents/state/${id}.json?ref=${BRANCH}`);
      if (r.status === 404) { this.sha[id] = null; this.status = 'ok'; return false; }
      if (!r.ok) throw new Error(r.status);
      const j = await r.json();
      this.sha[id] = j.sha;
      const remote = JSON.parse(this.b64.dec(j.content) || '{}');
      const before = JSON.stringify(this.read(id));
      const merged = this.merge(this.read(id), remote);
      local.set(this.key(id), merged);
      this.status = 'ok';
      return JSON.stringify(merged) !== before;
    } catch { this.status = 'error'; return false; }
  },
  schedule(id) {
    if (!this.token()) return;
    clearTimeout(this.timers[id]);
    this.timers[id] = setTimeout(() => this.push(id), 700);
  },
  async push(id, tries = 3) {
    if (!this.token() || this.inflight[id]) return;
    this.inflight[id] = true; this.status = 'syncing'; paintSync();
    try {
      await this.pull(id);
      const body = { message: `state ${id}`, branch: BRANCH, content: this.b64.enc(JSON.stringify(this.read(id), null, 0)) };
      if (this.sha[id]) body.sha = this.sha[id];
      const r = await this.api(`contents/state/${id}.json`, { method: 'PUT', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } });
      if (r.status === 409 || r.status === 422) { if (tries > 1) { this.inflight[id] = false; return this.push(id, tries - 1); } throw new Error('conflict'); }
      if (!r.ok) throw new Error(r.status);
      this.sha[id] = (await r.json()).content.sha;
      this.status = 'ok';
    } catch { this.status = 'error'; }
    this.inflight[id] = false; paintSync();
  },
  async test(token) {
    const r = await fetch(`https://api.github.com/repos/${REPO}`, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' } });
    if (!r.ok) return 'That token didn’t work. Check it was copied fully.';
    const j = await r.json();
    if (!j.permissions?.push) return 'The token can read but not write. Give it Contents: Read and write.';
    return '';
  }
};
const isCooked = (id, n) => !!Sync.get(id, `c:${n}`);
const setCooked = (id, n, v) => Sync.set(id, `c:${n}`, v);
const cookedCount = w => w.dinners.filter(d => isCooked(w.id, d.night)).length;

/* ---------- small helpers ---------- */
const style = d => `--c:${d.colour};--ink:${d.ink}`;
const label = d => d.night === 'b' ? 'AM' : d.night;
const nutri = d => [d.kcal && `${esc(d.kcal)}`, d.protein && `${esc(d.protein)} protein`, d.fibre && `${esc(d.fibre)} fibre`].filter(Boolean).join(', ');
const afBadge = d => d.airFryer ? '<span class="af">Air Fryer</span>' : '';
const vt = n => `view-transition-name:night-${n}`;
const stepText = s => typeof s === 'string' ? s : s.text;
const stepUses = s => typeof s === 'string' ? [] : (s.uses || []);
const rateBtns = (id, n) => {
  const r = Sync.get(id, `r:${n}`);
  return `<span class="rate" data-id="${id}" data-n="${n}"><button data-r="up" aria-label="Liked it" aria-pressed="${r === 'up'}">${icon.up}</button><button data-r="down" aria-label="Didn’t like it" aria-pressed="${r === 'down'}">${icon.down}</button></span>`;
};
function wireRates(root = app) {
  root.querySelectorAll('.rate button').forEach(b => b.onclick = e => {
    e.preventDefault(); e.stopPropagation();
    const wrap = b.closest('.rate'), id = wrap.dataset.id, n = wrap.dataset.n;
    const cur = Sync.get(id, `r:${n}`), v = b.dataset.r === cur ? null : b.dataset.r;
    Sync.set(id, `r:${n}`, v);
    wrap.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x.dataset.r === v));
  });
}

/* Today's dinner by weekday (falls back to the first not-cooked one on weekends) */
function pickTonight(w) {
  const t = todayName();
  const todays = w.dinners.find(d => d.day === t);
  if (todays && !isCooked(w.id, todays.night)) return { d: todays, tag: `Tonight, ${t}` };
  const order = w.dinners;
  const from = todays ? order.indexOf(todays) + 1 : 0;
  const nxt = order.slice(from).find(d => !isCooked(w.id, d.night)) || order.find(d => !isCooked(w.id, d.night));
  if (!nxt) return null;
  const tomorrow = DAYS[(new Date().getDay() + 1) % 7];
  return { d: nxt, tag: nxt.day === tomorrow ? `Tomorrow, ${nxt.day}` : (nxt.day || 'Up next') };
}
const prepToday = w => (w.prep || []).filter(p => (p.when || '').toLowerCase().startsWith(todayName().toLowerCase()));

/* ---------- this week / a past or next week ---------- */
async function viewWeek(id) {
  const idx = await getIndex();
  const ws = weekState(idx);
  const current = ws.current?.id;
  if (!current) return empty('No menu yet. The first one arrives on Thursday evening.');
  const wid = id || current;
  const isCurrent = wid === current;
  const w = await getWeek(wid);
  const base = isCurrent ? '#' : `#/w/${w.id}`;
  const pick = isCurrent ? pickTonight(w) : null;
  const up = pick?.d;
  const done = cookedCount(w);

  const progress = `<div class="progress" aria-label="${done} of ${w.dinners.length} cooked">${w.dinners.map(d => `<i class="${isCooked(w.id, d.night) ? 'on' : ''}" style="${style(d)}"></i>`).join('')}</div>`;

  const prep = isCurrent ? prepToday(w) : [];
  const prepCard = prep.length ? `<section class="todo"><h2>${icon.sun}Today’s prep</h2><ul>${prep.flatMap(p => p.tips).map(t => `<li>${esc(t)}</li>`).join('')}</ul></section>` : '';

  let lead = '';
  if (isCurrent && up) {
    lead = `<section class="tonight" style="${style(up)};${vt(up.night)}">
      <div class="num" aria-hidden="true">${up.night}</div>
      <div>
        <div class="label">${esc(pick.tag)}${afBadge(up)}</div>
        <h2>${esc(up.title)}</h2>
        <div class="meta">${esc(up.time)}${up.kcal ? `, ${nutri(up)}` : `, ${esc(up.protein)} protein each`}</div>
        <div class="ctas">
          <a class="pill solid" href="${base}/n/${up.night}/cook">${icon.play}Start cooking</a>
          <a class="pill ghost" href="${base}/n/${up.night}">See recipe</a>
        </div>
      </div>
    </section>`;
  } else if (isCurrent) {
    lead = `<section class="done-card"><h2>All ${w.dinners.length} cooked</h2><p>Next week’s menu lands on Thursday evening.</p></section>`;
  }

  const rest = w.dinners.filter(d => !up || d.night !== up.night);
  const rows = rest.map(d => {
    const c = isCooked(w.id, d.night);
    return `<li><a class="night${c ? ' cooked' : ''}" style="${style(d)}" href="${base}/n/${d.night}">
      <span class="chip" style="${vt(d.night)}">${d.night}</span>
      <span>${d.day ? `<span class="d">${esc(d.day)}</span>` : ''}<span class="t" style="display:block">${esc(d.title)}</span><span class="m">${c ? 'Cooked' : (d.kcal ? nutri(d) : `${esc(d.time)}, ${esc(d.protein)} protein`)}</span></span>
      ${c ? rateBtns(w.id, d.night) : `<span class="go">${icon.next}</span>`}</a></li>`;
  }).join('');

  const when = isCurrent ? `${done} of ${w.dinners.length} cooked${w.shopping?.total ? `, ${w.shopping.total} shop` : ''}` : (ws.isUpcoming(wid) ? `Next week, starts ${prettyDate(w.start)}` : 'Past week');
  const nextCard = isCurrent && ws.upcoming ? `<a class="nextwk" href="#/w/${ws.upcoming.id}"><span class="chips">${ws.upcoming.colours.map(c => `<i style="--c:${c};background:var(--cc)"></i>`).join('')}</span><span><span class="d">Next week is planned</span><span class="t">${esc(ws.upcoming.label)}</span><span class="m">Basket ready, delivery on Sunday</span></span><span class="go">${icon.next}</span></a>` : '';
  render(`<section class="page">
    <div class="week-head"><h1 class="title">${esc(w.label)}</h1><p class="when">${esc(when)}</p></div>
    ${progress}
    ${prepCard}
    <div class="week-grid">
      ${lead || w.breakfast ? `<div>${lead}${w.breakfast ? `<a class="bfast" style="${style(w.breakfast)}" href="${base}/n/b">
        <span class="chip">AM</span><span><span class="d">Breakfast, every day</span><span class="t">${esc(w.breakfast.title)}</span><span class="m">${esc(w.breakfast.time)}, ${nutri(w.breakfast)}</span></span><span class="go">${icon.next}</span></a>` : ''}</div>` : ''}
      <div>
        <h2 class="later-h">${isCurrent && up ? 'Rest of the week' : 'The week'}</h2>
        <ol class="nights">${rows}</ol>
        ${nextCard}
        ${w.notes?.length ? `<ul class="notes">${w.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        ${syncLine()}
      </div>
    </div>
  </section>`, { tab: 'week', title: w.label, weekId: w.id });
  wireRates();
}

/* ---------- recipe ---------- */
async function loadDinner(wid, night) {
  const idx = await getIndex();
  const cur = weekState(idx).current.id;
  const id = wid || cur;
  const w = await getWeek(id);
  const isB = night === 'b';
  const n = isB ? 'b' : Number(night);
  const d = isB ? (w.breakfast && { ...w.breakfast, night: 'b' }) : w.dinners.find(x => x.night === n);
  const base = wid && wid !== cur ? `#/w/${id}` : '#';
  return { id, w, n, d, base };
}

async function viewRecipe(wid, night) {
  const { id, w, n, d, base } = await loadDinner(wid, night);
  if (!d) return empty('That dinner doesn’t exist.');
  const isB = n === 'b';
  const prev = !isB && w.dinners.find(x => x.night === n - 1), next = !isB && w.dinners.find(x => x.night === n + 1);
  const ing = d.ingredients.map((i, k) => { const u = !!Sync.get(id, `u:${n}:${k}`); return `<li><button class="${u ? 'used' : ''}" data-k="${k}" aria-pressed="${u}"><span class="q">${esc(i.qty)}</span><span>${esc(i.item)}</span></button></li>`; }).join('');
  const steps = d.steps.map(s => `<li><span>${esc(stepText(s))}${stepUses(s).length ? `<small class="uses">${stepUses(s).map(esc).join(', ')}</small>` : ''}</span></li>`).join('');
  const isDone = isCooked(id, n);

  render(`<article>
    <header class="r-hero" style="${style(d)};${vt(n)}">
      <a class="back" href="${base}/">${icon.back}${esc(w.label)}</a>
      <div class="num" aria-hidden="true">${label(d)}</div>
      ${d.day || isB || d.airFryer ? `<div class="kicker">${isB ? 'Breakfast, every day' : esc(d.day || '')}${d.cuisine ? `<span>${esc(d.cuisine)}</span>` : ''}${afBadge(d)}</div>` : ''}
      <h1>${esc(d.title)}</h1>
      ${d.kcal ? `<ul class="facts f4"><li><b>${esc(d.kcal)}</b><span>per serving</span></li><li><b>${esc(d.protein)}</b><span>protein</span></li><li><b>${esc(d.fibre)}</b><span>fibre</span></li><li><b>${esc(d.time)}</b><span>${esc(d.method)}</span></li></ul>`
        : `<ul class="facts"><li><b>${esc(d.time)}</b><span>total</span></li><li><b>${esc(d.protein)}</b><span>protein each</span></li><li><b>${esc(d.method)}</b><span>cook with</span></li></ul>`}
      <div><a class="pill solid" href="${base}/n/${n}/cook">${icon.play}Start cooking</a></div>
    </header>
    <div class="r-body" style="${style(d)}">
      <div class="left"><h2>Ingredients<small>${isB ? 'for 2, one morning' : 'for 2'}, tap to tick off</small></h2><ul class="ing">${ing}</ul></div>
      <div><h2>Method</h2><ol class="steps">${steps}</ol>
        ${d.tip ? `<p class="tip"><b>Tip</b>${esc(d.tip)}</p>` : ''}
        ${d.kcal ? `<p class="nut"><b>Per serving</b>${nutri(d)}. Estimates from ingredient weights.</p>` : ''}
        <div class="rate-row"><span>How was it?</span>${rateBtns(id, n)}</div>
      </div>
    </div>
    ${isB ? '' : `<div class="r-actions">
      <a class="sq" href="${base}/n/${n - 1}" aria-label="Previous night" aria-disabled="${!prev}">${icon.back}</a>
      <button class="mark${isDone ? ' is-done' : ''}" id="mark">${isDone ? 'Cooked ✓' : 'Mark as cooked'}</button>
      <a class="sq" href="${base}/n/${n + 1}" aria-label="Next night" aria-disabled="${!next}">${icon.next}</a>
    </div>`}
  </article>`, { tab: 'week', title: d.title, colour: d.colour, weekId: id });

  app.querySelectorAll('.ing button').forEach(b => b.onclick = () => {
    const k = b.dataset.k, v = !Sync.get(id, `u:${n}:${k}`);
    Sync.set(id, `u:${n}:${k}`, v);
    b.classList.toggle('used', v); b.setAttribute('aria-pressed', v);
  });
  const mk = document.getElementById('mark');
  if (mk) mk.onclick = e => {
    const v = !isCooked(id, n);
    setCooked(id, n, v);
    e.currentTarget.classList.toggle('is-done', v);
    e.currentTarget.textContent = v ? 'Cooked ✓' : 'Mark as cooked';
  };
  wireRates();
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
      <span class="chip">${label(d)}</span><span class="t">${esc(d.title)}</span>
      <a class="x" href="${base}/n/${n}" aria-label="Close cook mode">${icon.close}</a>
    </div>
    <div class="cook-bar">${d.steps.map(() => '<i></i>').join('')}</div>
    <div class="cook-step" aria-live="polite"><div class="k"></div><p></p><ul class="need" hidden></ul><button class="set-timer" hidden></button></div>
    <div class="timers" hidden></div>
    <div class="cook-nav"><button class="prev">Back</button><button class="next"></button></div>
  </div>`, { tab: 'week', title: d.title, colour: d.colour, cooking: true, weekId: id });

  const k = app.querySelector('.k'), p = app.querySelector('.cook-step p'), setB = app.querySelector('.set-timer'), need = app.querySelector('.need');
  const bars = [...app.querySelectorAll('.cook-bar i')];
  const prevB = app.querySelector('.prev'), nextB = app.querySelector('.next');
  const finished = () => {
    const step = app.querySelector('.cook-step');
    step.innerHTML = `<div class="k">${n === 'b' ? 'Done' : 'Cooked'}</div><p>How was it?</p><div class="rate big">${rateBtns(id, n).replace(/^<span class="rate"[^>]*>|<\/span>$/g, '')}</div>`;
    step.querySelector('.rate').dataset.id = id; step.querySelector('.rate').dataset.n = n;
    wireRates(step);
    prevB.hidden = true; prevB.parentElement.classList.add('solo');
    nextB.textContent = 'Back to the week';
    nextB.onclick = () => { location.hash = `${base}/`.slice(1); };
  };
  const show = () => {
    const s = d.steps[i];
    k.innerHTML = `Step <b>${i + 1}</b> of ${total}`;
    p.textContent = stepText(s);
    const uses = stepUses(s);
    need.hidden = !uses.length;
    need.innerHTML = uses.map(u => `<li>${esc(u)}</li>`).join('');
    bars.forEach((b, j) => b.classList.toggle('on', j <= i));
    prevB.disabled = i === 0;
    nextB.textContent = i === total - 1 ? (n === 'b' ? 'Done' : 'Done, mark as cooked') : 'Next step';
    const t = parseTime(stepText(s));
    setB.hidden = !t;
    if (t) {
      setB.innerHTML = `<svg viewBox="0 0 24 24"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/></svg>Start ${t.label} timer`;
      setB.onclick = () => startTimer(`Step ${i + 1}`, t.secs);
    }
  };
  const go = dir => {
    if (dir > 0 && i === total - 1) {
      if (n !== 'b') setCooked(id, n, true);
      return finished();
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

/* ---------- shopping, with delivery check-off ---------- */
async function viewShop() {
  const idx = await getIndex();
  const ws = weekState(idx);
  const w = await getWeek(ws.newest.id);
  const nextOne = ws.upcoming && ws.newest.id === ws.upcoming.id;
  const s = w.shopping || {};
  const st = (g, i) => Sync.get(w.id, `s:${g}:${i}`);
  let total = 0, got = 0, missing = 0;
  const groups = Object.entries(s.groups || {}).map(([g, items], gi) =>
    `<section class="group"><h2>${esc(g)}<small>${items.length}</small></h2><ul>${items.map((i, ii) => {
      const fromCupboard = typeof i === 'object' && /cupboard/i.test(i.note || '');
      if (!fromCupboard) total++;
      const v = st(gi, ii); if (v === 'got') got++; if (v === 'missing') missing++;
      const name = typeof i === 'string' ? i : i.name;
      return `<li class="si${v ? ' ' + v : ''}${fromCupboard ? ' pantry' : ''}">${fromCupboard ? '<span class="tick" aria-hidden="true"></span>' : `<button class="tick" data-g="${gi}" data-i="${ii}" aria-label="${esc(name)}: ${v === 'got' ? 'unpacked' : v === 'missing' ? 'missing' : 'not checked'}"></button>`}
        <span class="nm">${esc(name)}${typeof i === 'object' && i.gf ? `<em class="gf">${i.gf === true ? 'Certified GF' : esc(i.gf)}</em>` : ''}${v === 'missing' ? '<em class="miss">Missing</em>' : ''}${typeof i === 'object' && i.note ? `<small>${esc(i.note)}</small>` : ''}</span>${typeof i === 'object' && i.qty ? `<b>${esc(i.qty)}</b>` : ''}</li>`;
    }).join('')}</ul></section>`).join('');
  const skip = s.skipped?.length ? `<p class="skipped">Skipped this week: ${s.skipped.map(esc).join(', ')}</p>` : '';
  const check = groups ? `<div class="unpack"><b>${got} of ${total} unpacked${missing ? `, ${missing} missing` : ''}</b><span>Tap once when it arrives, twice if it’s missing.</span></div>` : '';
  render(`<section class="page">
    <h1 class="title">Shopping</h1><p class="lede">${nextOne ? 'Next week’s basket' : 'In the Tesco basket'} for ${esc(w.label)}</p>
    ${s.total ? `<div class="shop-stats"><div><b>${esc(s.total)}</b><span>guide price</span></div><div><b>${esc(s.items)}</b><span>items</span></div></div>` : ''}
    ${check}
    ${groups ? `<div class="groups">${groups}</div>${skip}` : '<p class="empty">The basket list appears here after Thursday’s shop.</p>'}
    ${syncLine()}
  </section>`, { tab: 'shop', title: 'Shopping', weekId: w.id });
  app.querySelectorAll('button.tick').forEach(b => b.onclick = () => {
    const k = `s:${b.dataset.g}:${b.dataset.i}`, cur = Sync.get(w.id, k);
    Sync.set(w.id, k, cur === null ? 'got' : cur === 'got' ? 'missing' : null);
    const y = window.scrollY; viewShop().then(() => window.scrollTo(0, y));
  });
}

/* ---------- prep: batch cooking + reuse ---------- */
async function viewPrep() {
  const idx = await getIndex();
  const w = await getWeek(weekState(idx).current.id);
  const prep = w.prep || [];
  const t = todayName().toLowerCase();
  const body = prep.length ? prep.map(p => `<section class="prep${(p.when || '').toLowerCase().startsWith(t) ? ' now' : ''}"><h2>${esc(p.when)}${(p.when || '').toLowerCase().startsWith(t) ? '<em>Today</em>' : ''}</h2><ul>${p.tips.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>`).join('')
    : '<p class="empty">Prep tips appear here with each week’s plan.</p>';
  render(`<section class="page"><h1 class="title">Prep</h1><p class="lede">Batch cooking and reuse for ${esc(w.label)}</p>
    <div class="preps">${body}</div></section>`, { tab: 'prep', title: 'Prep', weekId: w.id });
}

/* ---------- archive ---------- */
async function viewArchive() {
  const idx = await getIndex();
  const ws = weekState(idx);
  const items = idx.weeks.map(w => `<li><a class="wk" href="${w.id === ws.current.id ? '#/' : `#/w/${w.id}`}">
    <div class="chips">${w.colours.map(c => `<i style="--c:${c};background:var(--cc)"></i>`).join('')}</div>
    <h2>${esc(w.label)}${w.id === ws.current.id ? '<em>This week</em>' : (ws.isUpcoming(w.id) ? '<em>Next week</em>' : '')}</h2><p>${w.dinners.map(esc).join(', ')}</p></a></li>`).join('');
  render(`<section class="page"><h1 class="title">Past weeks</h1><p class="lede">${idx.weeks.length} week${idx.weeks.length === 1 ? '' : 's'} of dinners so far</p>
    <ul class="weeks">${items}</ul>${syncLine()}</section>`, { tab: 'archive', title: 'Past weeks' });
}

/* ---------- sync settings ---------- */
function syncLine() {
  const on = !!Sync.token();
  const txt = !on ? 'Only on this phone' : Sync.status === 'error' ? 'Sync problem, tap to check' : 'Synced between your phones';
  return `<a class="syncline${on && Sync.status !== 'error' ? ' on' : ''}${Sync.status === 'error' ? ' err' : ''}" href="#/sync"><i></i><span>${txt}</span></a>`;
}
function paintSync() {
  const el = app.querySelector('.syncline'); if (!el) return;
  const tmp = document.createElement('div'); tmp.innerHTML = syncLine(); el.replaceWith(tmp.firstElementChild);
}
function viewSettings() {
  const on = !!Sync.token();
  render(`<section class="page narrow">
    <h1 class="title">Sync</h1>
    <p class="lede">Share cooked nights, ticked ingredients, the delivery check-off and ratings between both phones.</p>
    <div class="set-card">
      <p class="state ${on ? 'on' : ''}">${on ? 'Sync is on for this phone.' : 'Sync is off: changes stay on this phone.'}</p>
      ${on ? `<button class="pill solid dark" id="rm">Turn off sync on this phone</button>` : `
      <label for="tok">GitHub token</label>
      <input id="tok" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="github_pat_…">
      <button class="pill solid dark" id="save">Turn on sync</button>
      <p class="msg" id="msg" role="status"></p>`}
    </div>
    <details class="how"><summary>How to get a token (2 min, once)</summary><ol>
      <li>On github.com go to Settings, Developer settings, Personal access tokens, <b>Fine-grained tokens</b>, Generate new token.</li>
      <li>Name it “Dinners”. Expiration: whatever you like (it stops syncing when it expires).</li>
      <li>Repository access: <b>Only select repositories</b>, then pick <b>alisahba/weekly</b>.</li>
      <li>Permissions, Repository permissions, <b>Contents: Read and write</b>. Nothing else.</li>
      <li>Generate, copy it, paste it above. Do the same on Mihaela’s phone (the same token works).</li>
    </ol><p>The token is stored only on the phone, never on the website. It can only edit this one repo.</p></details>
  </section>`, { tab: 'archive', title: 'Sync' });
  const save = document.getElementById('save');
  if (save) save.onclick = async () => {
    const t = document.getElementById('tok').value.trim(), msg = document.getElementById('msg');
    if (!t) { msg.textContent = 'Paste the token first.'; return; }
    msg.textContent = 'Checking…';
    const err = await Sync.test(t).catch(() => 'Couldn’t reach GitHub. Check your connection.');
    if (err) { msg.textContent = err; return; }
    local.set('gh_token', t);
    const idx = await getIndex(); const ws = weekState(idx);
    for (const w of [ws.current, ws.upcoming].filter(Boolean)) { await Sync.pull(w.id); Sync.schedule(w.id); }
    viewSettings();
  };
  const rm = document.getElementById('rm');
  if (rm) rm.onclick = () => { local.del('gh_token'); Sync.status = 'local'; viewSettings(); };
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

let keyHandler = null, currentWeekId = null;
function render(html, { tab, title, colour, cooking, weekId } = {}) {
  app.innerHTML = html;
  currentWeekId = weekId || null;
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
    if (p[0] === 'prep') return await viewPrep();
    if (p[0] === 'archive') return await viewArchive();
    if (p[0] === 'sync') return viewSettings();
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

/* pull shared state for the weeks on screen; re-render quietly if something changed */
async function refresh() {
  if (!Sync.token() || document.body.classList.contains('cooking')) return;
  try {
    const idx = await getIndex(); const ws = weekState(idx);
    let changed = false;
    for (const w of [ws.current, ws.upcoming].filter(Boolean)) changed = (await Sync.pull(w.id)) || changed;
    if (changed && !document.activeElement?.matches('input')) { const y = window.scrollY; await route(); window.scrollTo(0, y); }
    else paintSync();
  } catch {}
}
window.addEventListener('hashchange', navigate);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    if (document.body.classList.contains('cooking')) keepAwake(true);
    refresh();
  }
});
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 30000);
route().then(refresh);

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
