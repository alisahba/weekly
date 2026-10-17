/* Dinners — static weekly menu app. Data lives in data/index.json and data/weeks/<id>.json */
const app = document.getElementById('app');
const cache = {};
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function getJSON(url) {
  if (cache[url]) return cache[url];
  const r = await fetch(url, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`Couldn't load ${url} (${r.status})`);
  return (cache[url] = await r.json());
}
const getIndex = () => getJSON('data/index.json');
const getWeek = id => getJSON(`data/weeks/${id}.json`);

/* cooked state, per device */
const store = {
  key: id => `cooked:${id}`,
  get(id) { try { return new Set(JSON.parse(localStorage.getItem(this.key(id)) || '[]')); } catch { return new Set(); } },
  set(id, s) { try { localStorage.setItem(this.key(id), JSON.stringify([...s])); } catch {} }
};
const tonightOf = (week) => {
  const done = store.get(week.id);
  return week.dinners.find(d => !done.has(d.night))?.night ?? null;
};

/* ---------- views ---------- */
async function viewWeek(id) {
  const idx = await getIndex();
  const wid = id || idx.weeks[0]?.id;
  if (!wid) return empty('No menu yet. The first one arrives on Saturday.');
  const w = await getWeek(wid);
  const done = store.get(w.id);
  const tonight = id && id !== idx.weeks[0].id ? null : tonightOf(w);
  const base = id ? `#/w/${w.id}` : '#';
  const bands = w.dinners.map(d => {
    const cooked = done.has(d.night);
    const isT = d.night === tonight;
    return `<li><a class="band${isT ? ' tonight' : ''}${cooked ? ' cooked' : ''}" style="--c:${d.colour};--ink:${d.ink}" href="${base}/n/${d.night}">
      <span class="n">${d.night}</span>
      <span>${isT ? '<span class="flag">Tonight</span>' : ''}<span class="t" style="display:block">${esc(d.title)}</span>
      <span class="m">${esc(d.time)}, ${esc(d.protein)} protein${cooked ? ', cooked' : ''}</span></span>
    </a></li>`;
  }).join('');
  const total = w.shopping?.total ? `, ${esc(w.shopping.total)} shop` : '';
  const sub = id && id !== idx.weeks[0].id ? 'Past week' : (tonight ? `Night ${tonight} is up next${total}` : `All 7 cooked${total}`);
  render(`<section class="page">
    <div class="page-head"><h1>${esc(w.label)}</h1><p>${sub}</p></div>
    <ol class="stack">${bands}</ol>
    ${w.notes?.length ? `<ul class="notes">${w.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
  </section>`, 'week', w.label);
}

let wakeLock = null;
async function viewRecipe(wid, night) {
  const idx = await getIndex();
  const id = wid || idx.weeks[0].id;
  const w = await getWeek(id);
  const n = Number(night);
  const d = w.dinners.find(x => x.night === n);
  if (!d) return empty('That dinner doesn’t exist.');
  const base = wid ? `#/w/${id}` : '#';
  const done = store.get(id);
  const prev = w.dinners.find(x => x.night === n - 1), next = w.dinners.find(x => x.night === n + 1);
  const ing = d.ingredients.map(i => `<li><span class="q">${esc(i.qty)}</span><span>${esc(i.item)}</span></li>`).join('');
  const steps = d.steps.map(s => `<li><span>${esc(s)}</span></li>`).join('');
  const canWake = 'wakeLock' in navigator;
  render(`<article class="recipe" style="--c:${d.colour};--ink:${d.ink}">
    <header class="hero">
      <a class="back" href="${base || '#'}/"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>${esc(w.label)}</a>
      <div class="row"><span class="n">${d.night}</span><h1>${esc(d.title)}</h1></div>
      <ul class="facts"><li><b>${esc(d.time)}</b><span>total</span></li><li><b>${esc(d.protein)}</b><span>protein each</span></li><li><b>${esc(d.method)}</b><span>cook with</span></li></ul>
    </header>
    <div class="sheet">
      <div class="left"><h2>Ingredients for 2</h2><ul class="ing">${ing}</ul></div>
      <div><h2>Method</h2><ol class="steps">${steps}</ol>
        ${d.tip ? `<p class="tip"><b>Tip.</b> ${esc(d.tip)}</p>` : ''}
        ${canWake ? `<label class="awake"><input type="checkbox" id="wake"> Keep screen on while cooking</label>` : ''}
      </div>
    </div>
    <div class="actions">
      <a class="btn" href="${base}/n/${n - 1}" aria-label="Previous dinner" aria-disabled="${!prev}"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></a>
      <button class="btn ${done.has(n) ? 'done' : 'primary'}" id="cook">${done.has(n) ? 'Cooked' : 'Mark as cooked'}</button>
      <a class="btn" href="${base}/n/${n + 1}" aria-label="Next dinner" aria-disabled="${!next}"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></a>
    </div>
  </article>`, 'week', d.title, d.colour);

  document.getElementById('cook').onclick = e => {
    const s = store.get(id);
    s.has(n) ? s.delete(n) : s.add(n);
    store.set(id, s);
    e.currentTarget.className = `btn ${s.has(n) ? 'done' : 'primary'}`;
    e.currentTarget.textContent = s.has(n) ? 'Cooked' : 'Mark as cooked';
  };
  const wake = document.getElementById('wake');
  if (wake) {
    wake.checked = !!wakeLock;
    wake.onchange = async () => {
      try {
        if (wake.checked) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
        else { await wakeLock?.release(); wakeLock = null; }
      } catch { wake.checked = false; }
    };
  }
  swipe(prev && `${base}/n/${n - 1}`, next && `${base}/n/${n + 1}`);
}

async function viewShop() {
  const idx = await getIndex();
  const w = await getWeek(idx.weeks[0].id);
  const s = w.shopping || {};
  const groups = Object.entries(s.groups || {}).map(([g, items]) =>
    `<section class="group"><h2>${esc(g)}</h2><ul>${items.map(i => `<li>${esc(i)}</li>`).join('')}</ul></section>`).join('');
  render(`<section class="page">
    <div class="page-head"><h1>Shopping</h1><p>What's in the Tesco basket for ${esc(w.label)}</p></div>
    ${s.total ? `<div class="shop-meta"><div><b>${esc(s.total)}</b><span>guide price</span></div><div><b>${esc(s.items)}</b><span>items</span></div></div>` : ''}
    ${groups ? `<div class="groups">${groups}</div>` : '<p class="empty">The basket list appears here after Saturday’s shop.</p>'}
  </section>`, 'shop', 'Shopping');
}

async function viewArchive() {
  const idx = await getIndex();
  const items = idx.weeks.map((w, i) => `<li><a class="wk${i === 0 ? ' current' : ''}" href="${i === 0 ? '#/' : `#/w/${w.id}`}">
    <div class="chips">${w.colours.map(c => `<i style="background:${c}"></i>`).join('')}</div>
    <h2>${esc(w.label)}</h2><p>${w.dinners.map(esc).join(', ')}</p></a></li>`).join('');
  render(`<section class="page"><div class="page-head"><h1>Past weeks</h1><p>${idx.weeks.length} week${idx.weeks.length === 1 ? '' : 's'} so far</p></div>
    <ul class="weeks">${items}</ul></section>`, 'archive', 'Past weeks');
}

function empty(msg) { render(`<section class="page"><p class="empty">${esc(msg)}</p></section>`, 'week', 'Dinners'); }

/* ---------- plumbing ---------- */
function render(html, tab, title, colour) {
  app.innerHTML = html;
  document.title = title ? `${title} – Dinners` : 'Dinners';
  document.querySelectorAll('[data-tab]').forEach(a => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  const tc = document.querySelector('meta[name="theme-color"]:not([media*="dark"])');
  if (tc) tc.content = colour || '#ffffff';
  window.scrollTo(0, 0);
}

let swipeHandlers = null;
function swipe(prevHref, nextHref) {
  if (swipeHandlers) { app.removeEventListener('touchstart', swipeHandlers.s); app.removeEventListener('touchend', swipeHandlers.e); }
  let x0, y0;
  const s = e => { x0 = e.touches[0].clientX; y0 = e.touches[0].clientY; };
  const e = ev => {
    const dx = ev.changedTouches[0].clientX - x0, dy = ev.changedTouches[0].clientY - y0;
    if (Math.abs(dx) < 70 || Math.abs(dy) > Math.abs(dx) * 0.6) return;
    if (dx < 0 && nextHref) location.hash = nextHref.slice(1);
    if (dx > 0 && prevHref) location.hash = prevHref.slice(1);
  };
  app.addEventListener('touchstart', s, { passive: true });
  app.addEventListener('touchend', e, { passive: true });
  swipeHandlers = { s, e };
}

async function route() {
  if (swipeHandlers) { app.removeEventListener('touchstart', swipeHandlers.s); app.removeEventListener('touchend', swipeHandlers.e); swipeHandlers = null; }
  const h = location.hash.replace(/^#\/?/, '');
  const p = h.split('/').filter(Boolean);
  try {
    if (!p.length) return await viewWeek();
    if (p[0] === 'n') return await viewRecipe(null, p[1]);
    if (p[0] === 'shop') return await viewShop();
    if (p[0] === 'archive') return await viewArchive();
    if (p[0] === 'w' && p[2] === 'n') return await viewRecipe(p[1], p[3]);
    if (p[0] === 'w') return await viewWeek(p[1]);
    empty('Page not found.');
  } catch (err) {
    empty(`${err.message}. Check your connection and pull to refresh.`);
  }
}
window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', async () => {
  if (wakeLock && document.visibilityState === 'visible') { try { wakeLock = await navigator.wakeLock.request('screen'); } catch {} }
});
route();

if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
