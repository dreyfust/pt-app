// PT Koç: GitHub reposundaki veriyi okuyup yazan tek sayfalık uygulama.
// Veri: <owner>/<repo> (private) içindeki data/days/YYYY-MM-DD.json dosyaları.
// "demo" repo adı girilirse veriyi ../pt-data/ klasöründen okur, yazmaları bellekte tutar (lokal test için).

const TZ = 'Europe/Istanbul';
const WEEKDAYS = ['pazar', 'pazartesi', 'sali', 'carsamba', 'persembe', 'cuma', 'cumartesi'];
const SLOTS = { kahvalti: 'Kahvaltı', ogle: 'Öğle', ara: 'Ara öğün', aksam: 'Akşam', gece: 'Gece', diger: 'Diğer' };
const MEASURES = { bel: 'Bel (göbek hizası)', kalca: 'Kalça', gogus: 'Göğüs', kol: 'Kol', uyluk: 'Uyluk', boyun: 'Boyun' };

const todayStr = () => new Date().toLocaleDateString('sv-SE', { timeZone: TZ });
const nowTime = () => new Date().toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' });
const addDays = (d, n) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const weekdayKey = (d) => WEEKDAYS[new Date(`${d}T12:00:00Z`).getUTCDay()];
const fmtDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 8);
const num = (v) => (v === '' || v == null || isNaN(+String(v).replace(',', '.')) ? null : +String(v).replace(',', '.'));
const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];

const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* özel sekme */ } },
};
const cfg = {
  get token() { return store.get('pt.token') || ''; },
  get repo() { return store.get('pt.repo') || ''; },
  branch: 'main',
};
const isDemo = () => cfg.repo === 'demo';

// ---------- GitHub ----------
const enc = (s) => { let b = ''; new TextEncoder().encode(s).forEach((x) => { b += String.fromCharCode(x); }); return btoa(b); };
const dec = (b64) => new TextDecoder().decode(Uint8Array.from(atob(b64.replace(/\n/g, '')), (c) => c.charCodeAt(0)));
const demoFiles = {};

async function gh(path, opts = {}) {
  const r = await fetch(`https://api.github.com/repos/${cfg.repo}${path}`, {
    cache: 'no-store',
    ...opts,
    headers: {
      Authorization: `Bearer ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
    },
  });
  if (r.status === 404) return null;
  if (!r.ok) {
    const e = new Error(r.status === 401 ? 'Token geçersiz veya süresi dolmuş' : `GitHub hatası ${r.status}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}

async function readJSON(path) {
  if (isDemo()) {
    if (path in demoFiles) return { data: structuredClone(demoFiles[path]), sha: 'demo' };
    const r = await fetch(`../pt-data/${path}`, { cache: 'no-store' });
    return r.ok ? { data: await r.json(), sha: 'demo' } : null;
  }
  const f = await gh(`/contents/${path}?ref=${cfg.branch}`);
  return f ? { data: JSON.parse(dec(f.content)), sha: f.sha } : null;
}

async function writeJSON(path, data, sha, message) {
  if (isDemo()) { demoFiles[path] = structuredClone(data); return 'demo'; }
  const res = await gh(`/contents/${path}`, {
    method: 'PUT',
    body: JSON.stringify({ message, branch: cfg.branch, content: enc(JSON.stringify(data, null, 2) + '\n'), ...(sha ? { sha } : {}) }),
  });
  return res.content.sha;
}

async function listDir(path) {
  if (isDemo()) return [];
  const r = await gh(`/contents/${path}?ref=${cfg.branch}`);
  return Array.isArray(r) ? r : [];
}

// ---------- Durum ----------
const S = { plans: null, summary: null, days: {} };

async function loadPlans(force) {
  if (S.plans && !force) return S.plans;
  const [meal, workout, targets, profile] = await Promise.all(
    ['plans/meal-plan.json', 'plans/workout-plan.json', 'profile/targets.json', 'profile/profile.json'].map(readJSON),
  );
  S.plans = {
    meal: meal?.data || { default: [] },
    workout: workout?.data || { schedule: {}, workouts: {} },
    targets: targets?.data || { kcal: 2100, p: 165, c: 210, f: 65 },
    profile: profile?.data || {},
  };
  return S.plans;
}

async function loadSummary(force) {
  if (S.summary && !force) return S.summary;
  S.summary = (await readJSON('data/summary.json'))?.data || { days: {}, weight: [] };
  return S.summary;
}

function newDay(date) {
  const { meal, workout } = S.plans;
  const wk = weekdayKey(date);
  const meals = (meal.days?.[wk] || meal.default || []).map((m) => ({
    id: uid(), slot: m.slot, name: m.name, time: m.time, source: 'plan', status: 'planned',
    items: m.items || [], kcal: m.kcal ?? null, p: m.p ?? null, c: m.c ?? null, f: m.f ?? null,
  }));
  const wid = workout.schedule?.[wk];
  const w = wid && workout.workouts?.[wid];
  return {
    date,
    meals,
    workout: w
      ? { planId: wid, title: w.title, done: false,
          exercises: w.exercises.map((e) => ({ id: uid(), name: e.name, source: 'plan', target: e.target, note: e.note || '', sets: [] })) }
      : { planId: null, title: 'Dinlenme günü', done: false, exercises: [] },
    weight: null, measurements: {}, steps: null, notes: '', questions: [], changes: [], pending: false, coach: null,
  };
}

const dayPath = (d) => `data/days/${d}.json`;

async function getDay(date, force) {
  await loadPlans();
  if (S.days[date] && !force) return S.days[date].data;
  const f = await readJSON(dayPath(date));
  if (f) S.days[date] = { data: f.data, sha: f.sha };
  // Henüz kaydedilmemiş günü yeniden üretme: öğün id'leri değişmesin
  else if (!S.days[date] || S.days[date].sha) S.days[date] = { data: newDay(date), sha: null };
  return S.days[date].data;
}

// Gün dosyasını en güncel hâliyle oku, değiştir, yaz. Çakışmada tekrar dener.
async function updateDay(date, what, mutate) {
  for (let i = 0; i < 3; i++) {
    const day = structuredClone(await getDay(date, i > 0 || !isDemo()));
    mutate(day);
    day.pending = true;
    day.changes = [...(day.changes || []), { at: new Date().toISOString(), what }].slice(-40);
    try {
      const sha = await writeJSON(dayPath(date), day, S.days[date].sha, `${date}: ${what}`);
      S.days[date] = { data: day, sha };
      if (S.summary) S.summary.days[date] = summarize(day);
      return day;
    } catch (e) {
      if (e.status !== 409 && e.status !== 422) throw e;
    }
  }
  throw new Error('Kaydedilemedi, tekrar dene');
}

function totals(day) {
  const t = { kcal: 0, p: 0, c: 0, f: 0, unknown: 0 };
  for (const m of day.meals || []) {
    if (m.status !== 'eaten') continue;
    if (m.kcal == null) { t.unknown++; continue; }
    t.kcal += +m.kcal || 0; t.p += +m.p || 0; t.c += +m.c || 0; t.f += +m.f || 0;
  }
  return t;
}

function summarize(day) {
  const t = totals(day);
  const ex = day.workout?.exercises || [];
  const sets = ex.reduce((n, e) => n + (e.sets?.length || 0), 0);
  return {
    kcal: t.kcal, p: t.p, unknownMeals: t.unknown, target: S.plans.targets.kcal,
    extraMeals: (day.meals || []).filter((m) => m.source === 'extra').length,
    weight: day.weight, waist: day.measurements?.bel ?? null,
    workout: day.workout?.planId || ex.length
      ? { title: day.workout.title, planned: !!day.workout.planId, done: !!day.workout.done || sets > 0, sets, extra: ex.filter((e) => e.source === 'extra').length }
      : null,
    pending: day.pending,
  };
}

// ---------- UI yardımcıları ----------
const view = () => $('#view');
const setTop = (html) => { $('#top').innerHTML = html; };
let toastTimer;
function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
}
function md(s) {
  const lines = esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').split('\n');
  let out = '', inList = false;
  for (const l of lines) {
    const li = l.match(/^\s*[-•*]\s+(.*)/);
    if (li) { if (!inList) { out += '<ul>'; inList = true; } out += `<li>${li[1]}</li>`; continue; }
    if (inList) { out += '</ul>'; inList = false; }
    if (l.trim()) out += `<p>${l}</p>`;
  }
  return out + (inList ? '</ul>' : '');
}
async function busy(btn, fn) {
  const label = btn?.textContent;
  if (btn) { btn.disabled = true; btn.textContent = 'Kaydediliyor…'; }
  try { await fn(); } catch (e) { toast(`⚠️ ${e.message}`); console.error(e); } finally {
    if (btn && btn.isConnected) { btn.disabled = false; btn.textContent = label; }
  }
}

// ---------- Animasyon ----------
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
// quiet: kaydetme sonrası yeniden çizimde giriş animasyonu oynatma; prev: halka/sayıların önceki değerleri (oradan akarlar)
const A = { quiet: false, dir: '', loading: false, flash: null, prev: {}, nums: {}, seg: {} };
const vibrate = (p = 12) => { try { navigator.vibrate?.(p); } catch { /* desteklenmiyor */ } };
const skeleton = (...hs) => hs.map((h) => `<div class="skel" style="height:${h}px"></div>`).join('');

// Sayı: önceki değerinden yenisine sayarak akar
function cnt(key, val, dec = 0, sign = false) {
  const from = A.nums[key] ?? 0;
  A.nums[key] = val ?? 0;
  return `<span data-count="${val ?? 0}" data-from="${from}" data-dec="${dec}"${sign ? ' data-sign="1"' : ''}>${(+from).toFixed(dec)}</span>`;
}

function ring(key, val, target, { size = 132, stroke = 12, color = 'var(--accent)', center } = {}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c * (1 - Math.min(1, target ? Math.max(0, val) / target : 0));
  const from = A.prev[key] ?? c;
  A.prev[key] = off;
  const h = size / 2;
  return `<div class="ring ${target && val > target * 1.05 ? 'over' : ''}" style="--size:${size}px">
    <svg viewBox="0 0 ${size} ${size}"><circle class="trk" cx="${h}" cy="${h}" r="${r}" stroke-width="${stroke}"/>
      <circle class="val" cx="${h}" cy="${h}" r="${r}" stroke-width="${stroke}" style="color:${color};stroke:${color}"
        stroke-dasharray="${c}" stroke-dashoffset="${from}" data-to="${off}"/></svg>
    <div class="ring-c">${center ?? ''}</div></div>`;
}

function seg(key, items, sel) {
  const from = A.seg[key] ?? sel;
  A.seg[key] = sel;
  return `<div class="seg" style="--n:${items.length};--sel:${from}" data-sel="${sel}"><span class="ind"></span>
    ${items.map(([href, label], i) => `<button class="${i === sel ? 'on' : ''}" data-href="${href}">${label}</button>`).join('')}</div>`;
}

function countUp(el) {
  const to = +el.dataset.count, from = +el.dataset.from, dec = +el.dataset.dec || 0;
  const fmt = (v) => (el.dataset.sign && v > 0 ? '+' : '') + v.toFixed(dec);
  if (reduced || from === to) { el.textContent = fmt(to); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 900);
    el.textContent = fmt(from + (to - from) * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function animateIn(root) {
  const tab = $('#tab', root);
  if (!A.quiet && !reduced) {
    [...root.children].forEach((el, i) => el.style.setProperty('--i', i));
    if (tab) { tab.classList.add('stagger'); [...tab.children].forEach((el, i) => el.style.setProperty('--i', i + 2)); }
    root.classList.remove('enter', 'from-left', 'from-right');
    void root.offsetWidth; // animasyonu yeniden başlat
    root.classList.add('enter');
    if (A.dir) root.classList.add(A.dir);
  } else {
    root.classList.remove('enter', 'from-left', 'from-right');
  }
  $$('svg.chart .line', root).forEach((p) => p.style.setProperty('--len', p.getTotalLength()));
  requestAnimationFrame(() => requestAnimationFrame(() => {
    $$('.ring .val', root).forEach((c) => { c.style.strokeDashoffset = c.dataset.to; });
    $$('.seg[data-sel]', root).forEach((s) => s.style.setProperty('--sel', s.dataset.sel));
  }));
  $$('[data-count]', root).forEach(countUp);
}

function confetti() {
  if (reduced) return;
  const colors = ['#22c55e', '#38bdf8', '#a78bfa', '#f59e0b', '#f472b6'];
  for (let i = 0; i < 70; i++) {
    const d = document.createElement('i');
    d.className = 'confetti';
    d.style.left = `${Math.random() * 100}vw`;
    d.style.background = colors[i % colors.length];
    d.style.setProperty('--x', `${Math.random() * 160 - 80}px`);
    d.style.setProperty('--r', `${Math.random() * 900 - 450}deg`);
    d.style.setProperty('--d', `${1.4 + Math.random() * 1.3}s`);
    d.style.animationDelay = `${Math.random() * 0.35}s`;
    document.body.appendChild(d);
    setTimeout(() => d.remove(), 3200);
  }
}

const refreshBtn = () => `<button class="icon ${A.loading ? 'spin' : ''}" data-act="refresh" aria-label="Yenile">⟳</button>`;

// ---------- Gün görünümü ----------
async function viewDay(date, tab) {
  tab = tab || 'beslenme';
  const isToday = date === todayStr();
  setTop(`
    <button class="icon" data-href="#/gun/${addDays(date, -1)}/${tab}" data-dir="from-left" aria-label="Önceki gün">‹</button>
    <div class="title"><b>${fmtDate(date)}</b>${isToday ? '<small>Bugün</small>' : `<small><a href="#/gun">Bugüne dön</a></small>`}</div>
    ${refreshBtn()}
    <button class="icon" data-href="#/gun/${addDays(date, 1)}/${tab}" data-dir="from-right" aria-label="Sonraki gün">›</button>`);
  if (!S.days[date]) view().innerHTML = skeleton(56, 180, 150, 150);
  const day = await getDay(date);

  const tabs = [['beslenme', '🍽 Beslenme'], ['antrenman', '🏋️ Antrenman'], ['olcum', '⚖️ Ölçüm']];
  view().innerHTML = `
    ${coachCard(day)}
    ${seg('day', tabs.map(([k, l]) => [`#/gun/${date}/${k}`, l]), tabs.findIndex(([k]) => k === tab))}
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'antrenman') await loadLib().catch(() => {}); // kardiyo hareketlerini tanımak için
  if (tab === 'beslenme') renderNutrition(el, date, day);
  else if (tab === 'antrenman') renderWorkout(el, date, day);
  else renderMeasure(el, date, day);
}

function coachCard(day) {
  const c = day.coach;
  const when = c?.updatedAt ? new Date(c.updatedAt).toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
  const msg = c?.message ? `<div class="md">${md(c.message)}</div>` : '';
  if (day.pending) {
    return `<div class="card coach wait"><div class="coach-h"><span><span class="av">🧠</span>Koç düşünüyor<span class="typing"><i></i><i></i><i></i></span></span>
      <small class="muted">1-3 dk · ⟳</small></div>${msg ? `<div style="opacity:.5">${msg}</div>` : ''}</div>`;
  }
  if (!msg) return '';
  const flags = (c.flags || []).length ? `<div>${c.flags.map((f) => `<span class="flag">⚠️ ${esc(f)}</span>`).join('')}</div>` : '';
  return `<div class="card coach"><div class="coach-h"><span><span class="av">🧠</span>Koç</span><small class="muted">${when}</small></div>${flags}${msg}</div>`;
}

function macroRow(key, label, val, target, color) {
  return `<div class="macro-row">${ring(key, val, target, { size: 46, stroke: 6, color })}
    <div class="lbl"><span class="muted">${label}</span><b>${cnt(key, Math.round(val))} <small class="muted">/ ${target} g</small></b></div></div>`;
}

function renderNutrition(el, date, day) {
  const t = totals(day);
  const tg = S.plans.targets;
  const left = tg.kcal - t.kcal;
  const meals = [...day.meals].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  el.innerHTML = `
    <div class="card">
      <div class="hero">
        ${ring('kcal', t.kcal, tg.kcal, { size: 138, stroke: 13, center: `<b>${cnt('kcal', Math.round(t.kcal))}</b><small>/ ${tg.kcal}</small><span>kcal</span>` })}
        <div class="macros">
          ${macroRow('p', 'Protein', t.p, tg.p, 'var(--p)')}
          ${macroRow('c', 'Karbonhidrat', t.c, tg.c, 'var(--c)')}
          ${macroRow('f', 'Yağ', t.f, tg.f, 'var(--f)')}
        </div>
      </div>
      <div class="left-pill">${left >= 0 ? `Kalan <b>${cnt('left', left)}</b> kcal` : `Hedefin <b>${cnt('left', -left)}</b> kcal üstünde`}
        ${t.unknown ? `<br><small class="muted">+ ${t.unknown} öğünün makrosunu koç hesaplayacak</small>` : ''}</div>
    </div>
    <button class="btn primary full add-big" data-act="open-food">＋ Yemek ekle</button>
    ${meals.map(mealCard).join('') || '<div class="empty-state">Bu gün için plan yok.</div>'}`;

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === 'meal-status') {
      const status = b.dataset.status;
      const m = day.meals.find((x) => x.id === id);
      if (status === 'replaced') {
        openFoodSheet(date, { slot: SLOTS[m.slot] ? m.slot : 'diger', time: m.time, replaceId: id, replaceName: m.name });
        return;
      }
      const next = m.status === status ? 'planned' : status;
      if (next === 'eaten') { A.flash = id; vibrate(15); }
      busy(b, async () => {
        await updateDay(date, `${m.name}: ${{ eaten: 'yendi', skipped: 'atlandı', planned: 'geri alındı' }[next]}`, (d) => {
          d.meals.find((x) => x.id === id).status = next;
        });
        rerender();
      });
    } else if (act === 'meal-del') {
      if (!confirm('Bu öğün silinsin mi?')) return;
      busy(b, async () => {
        const m = day.meals.find((x) => x.id === id);
        await updateDay(date, `Plan dışı öğün silindi: ${m.text || m.name}`, (d) => { d.meals = d.meals.filter((x) => x.id !== id); });
        rerender();
      });
    } else if (act === 'open-food') {
      openFoodSheet(date);
    }
  };
}

function mealCard(m) {
  const statusLbl = { eaten: '✓ Yendi', skipped: 'Atlandı', replaced: 'Değiştirildi' }[m.status];
  const items = m.items?.length
    ? `<ul class="items">${m.items.map((i) => `<li>${esc(i.name)}${i.amount ? ` <span class="muted">· ${esc(i.amount)}</span>` : ''}</li>`).join('')}</ul>`
    : m.text ? `<div class="items" style="padding:0">${esc(m.text)}</div>` : '';
  const macro = m.kcal != null
    ? `${m.kcal} kcal${m.p != null ? ` · P ${m.p} · K ${m.c} · Y ${m.f}` : ''}${m.estimated ? ' <span class="muted">(tahmini)</span>' : ''}`
    : '<i>makrolar koç tarafından hesaplanacak</i>';
  const actions = m.source === 'plan'
    ? `<button class="btn sm ${m.status === 'eaten' ? 'on' : ''}" data-act="meal-status" data-status="eaten" data-id="${m.id}">✓ Yedim</button>
       <button class="btn sm ${m.status === 'skipped' ? 'on' : ''}" data-act="meal-status" data-status="skipped" data-id="${m.id}">Atladım</button>
       <button class="btn sm" data-act="meal-status" data-status="replaced" data-id="${m.id}">Başka şey yedim</button>`
    : `<button class="btn sm danger" data-act="meal-del" data-id="${m.id}">Sil</button>`;
  const flash = A.flash === m.id ? 'flash' : '';
  return `<div class="meal ${m.status} ${flash}">
    <div class="emo">${m.status === 'eaten' ? '✅' : SLOT_EMO[m.slot] || '🍴'}</div>
    <div class="body">
      <div class="meal-h"><b>${esc(m.name)}</b><span class="time">${esc(m.time || '')}</span>
        ${m.source === 'extra' ? '<span class="badge extra">Plan dışı</span>' : ''}
        ${statusLbl ? `<span class="badge ${m.status}">${statusLbl}</span>` : ''}</div>
      ${items}<div class="macro">${macro}</div><div class="row">${actions}</div>
    </div></div>`;
}
const SLOT_EMO = { kahvalti: '🍳', ogle: '🥗', ara: '🍌', aksam: '🍽️', gece: '🌙', diger: '🍴' };

// Kuvvet: kg × tekrar, kardiyo: dakika × km. Boş alanların ipucu son seansın değeri.
function setRow(i, s = {}, cardio = false, last = {}) {
  const [k1, u1, k2, u2] = cardio ? ['min', 'dk', 'km', 'km'] : ['kg', 'kg', 'reps', 'tekrar'];
  return `<tr><td>${i + 1}</td>
    <td><input inputmode="decimal" data-k="${k1}" value="${s[k1] ?? ''}" placeholder="${last[k1] ?? u1}"></td><td class="unit">${u1}</td>
    <td><input inputmode="decimal" data-k="${k2}" value="${s[k2] ?? ''}" placeholder="${last[k2] ?? u2}"></td><td class="unit">${u2}</td>
    <td><button class="btn sm" data-act="del-set" aria-label="Seti sil">×</button></td></tr>`;
}

const isCardio = (e) => e.kind === 'kardiyo' || LIB.exercises?.find((x) => x.n === e.name)?.k === 'kardiyo';
const exLast = () => jget('pt.exLast', {});
function rememberSets(exercises) {
  const all = exLast();
  for (const e of exercises) { const s = e.sets?.at(-1); if (s) all[e.name] = s; }
  jset('pt.exLast', all);
}

function renderWorkout(el, date, day) {
  const w = day.workout || { title: 'Dinlenme günü', exercises: [] };
  const last = exLast();
  const exHtml = w.exercises.map((e, i) => {
    const cardio = isCardio(e);
    return `
    <div class="ex" data-ex="${e.id}" data-cardio="${cardio ? 1 : ''}">
      <div class="ex-h"><span class="ex-num">${cardio ? '🏃' : i + 1}</span><b>${esc(e.name)}</b>
        ${e.source === 'extra' ? '<span class="badge extra">Ekstra</span>' : ''}
        ${e.target ? `<span class="badge">${esc(e.target)}</span>` : ''}
        ${e.source === 'extra' ? `<button class="btn sm danger" data-act="del-ex" data-id="${e.id}">Sil</button>` : ''}</div>
      ${e.note ? `<small class="muted">${esc(e.note)}</small>` : ''}
      ${last[e.name] && !e.sets.length ? `<small class="muted last-hint">Geçen sefer: ${cardio ? `${last[e.name].min ?? '?'} dk${last[e.name].km ? ` · ${last[e.name].km} km` : ''}` : `${last[e.name].kg ?? '?'} kg × ${last[e.name].reps ?? '?'}`}</small>` : ''}
      <table class="sets"><tbody>${(e.sets.length ? e.sets : [{}]).map((s, j) => setRow(j, s, cardio, last[e.name])).join('')}</tbody></table>
      <button class="btn sm" data-act="add-set" style="margin-top:6px">+ ${cardio ? 'Tur' : 'Set'}</button>
    </div>`;
  }).join('');

  el.innerHTML = `
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(w.title)}</h3>${w.done ? '<span class="badge eaten">✓ Tamamlandı</span>' : ''}</div>
      ${!w.planId && !w.exercises.length ? '<p class="muted" style="margin:8px 0 0">Bugün plan yok. Toparlan, 8-10 bin adım yeter. Yine de bir şey yaptıysan aşağıdan ekle.</p>' : ''}</div>
    ${exHtml}
    ${w.exercises.length ? `
      <label class="done-toggle"><span>🏁 Antrenman bitti</span>
        <span class="switch"><input type="checkbox" id="w-done" ${w.done ? 'checked' : ''}><span></span></span></label>
      <button class="btn primary full" data-act="save-workout">💾 Antrenmanı kaydet</button>` : ''}
    <button class="btn full add-big ${w.exercises.length ? '' : 'primary'}" data-act="open-ex" style="margin-top:12px">＋ Hareket ekle</button>`;

  const collect = () => Object.fromEntries($$('.ex', el).map((box) => [box.dataset.ex,
    $$('tbody tr', box).map((tr) => Object.fromEntries($$('[data-k]', tr).map((i) => [i.dataset.k, num(i.value)])))
      .filter((s) => Object.values(s).some((v) => v != null))]));

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add-set') {
      const box = b.closest('.ex');
      const tbody = $('tbody', box);
      const lastRow = tbody.lastElementChild;
      const prev = lastRow ? Object.fromEntries($$('[data-k]', lastRow).map((i) => [i.dataset.k, i.value])) : {};
      tbody.insertAdjacentHTML('beforeend', setRow(tbody.children.length, prev, !!box.dataset.cardio));
      tbody.lastElementChild.classList.add('new');
      vibrate(8);
    } else if (act === 'del-set') {
      const tr = b.closest('tr');
      const tbody = tr.parentElement;
      tr.remove();
      [...tbody.children].forEach((r, i) => { r.firstElementChild.textContent = i + 1; });
    } else if (act === 'save-workout') {
      const sets = collect();
      const done = $('#w-done').checked;
      const n = Object.values(sets).reduce((a, s) => a + s.length, 0);
      busy(b, async () => {
        const saved = await updateDay(date, `Antrenman kaydedildi: ${n} set${done ? ', bitti' : ''}`, (d) => {
          for (const ex of d.workout.exercises) if (sets[ex.id]) ex.sets = sets[ex.id];
          d.workout.done = done;
        });
        rememberSets(saved.workout.exercises);
        if (done && !w.done) { confetti(); vibrate([20, 40, 20]); toast('Antrenman tamam, helal olsun 🔥'); } else toast('Kaydedildi 💪');
        rerender();
      });
    } else if (act === 'open-ex') {
      // Penceredeki seçim kaydedilirken ekranda girilmiş ama kaydedilmemiş setler kaybolmasın
      openExerciseSheet(async (ex, what) => {
        const pendingSets = collect();
        const saved = await updateDay(date, what, (d) => {
          d.workout ||= { planId: null, title: 'Dinlenme günü', done: false, exercises: [] };
          for (const x of d.workout.exercises) if (pendingSets[x.id]) x.sets = pendingSets[x.id];
          d.workout.exercises.push(ex);
        });
        rememberSets([ex]);
        toast(`${ex.name} eklendi 💪`);
        rerender();
        return saved;
      });
    } else if (act === 'del-ex') {
      if (!confirm('Bu hareket silinsin mi?')) return;
      const id = b.dataset.id;
      busy(b, async () => {
        await updateDay(date, 'Ekstra hareket silindi', (d) => { d.workout.exercises = d.workout.exercises.filter((x) => x.id !== id); });
        rerender();
      });
    }
  };
}

function renderMeasure(el, date, day) {
  const m = day.measurements || {};
  const qs = day.questions || [];
  el.innerHTML = `
    <div class="card">
      <h3>⚖️ Kilo ve adım</h3>
      <div class="grid2">
        <div><label class="f">Kilo (kg) · sabah, tuvaletten sonra, aç</label><input id="m-weight" inputmode="decimal" value="${day.weight ?? ''}" placeholder="83.1"></div>
        <div><label class="f">Adım</label><input id="m-steps" inputmode="numeric" value="${day.steps ?? ''}" placeholder="9000"></div>
      </div>
    </div>
    <div class="card">
      <h3>📏 Ölçüler (cm)</h3>
      <small class="muted">Haftada 1 kez, pazar sabahı yeterli. Bel ölçüsü ana göstergemiz.</small>
      <div class="grid2">${Object.entries(MEASURES).map(([k, l]) => `<div><label class="f">${l}</label><input data-m="${k}" inputmode="decimal" value="${m[k] ?? ''}"></div>`).join('')}</div>
    </div>
    <div class="card">
      <h3>📝 Not / koça soru</h3>
      <label class="f">Günün notu (uyku, enerji, ağrı, stres…)</label>
      <textarea id="m-notes">${esc(day.notes || '')}</textarea>
      <label class="f">Koça sor</label>
      <textarea id="m-q" placeholder="ör. Akşam dışarıda yiyeceğim, ne seçeyim?"></textarea>
      ${qs.length ? `<div style="margin-top:8px">${qs.map((q) => `<div class="muted" style="font-size:13px">${q.answered ? '✓' : '…'} ${esc(q.text)}</div>`).join('')}</div>` : ''}
    </div>
    <button class="btn primary full" data-act="save-measure">💾 Kaydet</button>`;

  el.onclick = (e) => {
    const b = e.target.closest('[data-act=save-measure]');
    if (!b) return;
    const weight = num($('#m-weight').value);
    const steps = num($('#m-steps').value);
    const ms = Object.fromEntries($$('[data-m]', el).map((i) => [i.dataset.m, num(i.value)]).filter(([, v]) => v != null));
    const notes = $('#m-notes').value.trim();
    const q = $('#m-q').value.trim();
    const parts = [];
    if (weight !== day.weight) parts.push(`kilo ${weight}`);
    if (steps !== day.steps) parts.push(`adım ${steps}`);
    if (JSON.stringify(ms) !== JSON.stringify(day.measurements || {})) parts.push(`ölçüler ${Object.entries(ms).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    if (notes !== (day.notes || '')) parts.push(`not: ${notes}`);
    if (q) parts.push(`soru: ${q}`);
    if (!parts.length) { toast('Değişiklik yok'); return; }
    busy(b, async () => {
      await updateDay(date, parts.join(' · '), (d) => {
        d.weight = weight; d.steps = steps; d.measurements = ms; d.notes = notes;
        if (q) d.questions = [...(d.questions || []), { at: new Date().toISOString(), text: q, answered: false }];
      });
      toast('Kaydedildi');
      rerender();
    });
  };
}

// ---------- Takvim ----------
async function viewCalendar(ym, mode) {
  ym = ym || todayStr().slice(0, 7);
  mode = mode || store.get('pt.calmode') || 'yemek';
  store.set('pt.calmode', mode);
  const [y, mo] = ym.split('-').map(Number);
  const prev = new Date(Date.UTC(y, mo - 2, 1)).toISOString().slice(0, 7);
  const next = new Date(Date.UTC(y, mo, 1)).toISOString().slice(0, 7);
  const label = new Date(Date.UTC(y, mo - 1, 15)).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  setTop(`<button class="icon" data-href="#/takvim/${prev}/${mode}" data-dir="from-left">‹</button>
    <div class="title"><b>${label}</b></div>
    ${refreshBtn()}
    <button class="icon" data-href="#/takvim/${next}/${mode}" data-dir="from-right">›</button>`);
  if (!S.summary) view().innerHTML = skeleton(48, 380);
  await loadPlans();
  const sum = await loadSummary();
  for (const [d, v] of Object.entries(S.days)) if (d.startsWith(ym) && v.sha) sum.days[d] = summarize(v.data);

  const first = new Date(Date.UTC(y, mo - 1, 1));
  const offset = (first.getUTCDay() + 6) % 7;
  const daysInMonth = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  const today = todayStr();
  const tg = S.plans.targets.kcal;
  let cells = '';
  for (let i = 0; i < offset; i++) cells += '<div class="c empty"></div>';
  for (let n = 1; n <= daysInMonth; n++) {
    const d = `${ym}-${String(n).padStart(2, '0')}`;
    const s = sum.days[d];
    const future = d > today;
    let cls = '', v = '', dots = '';
    if (mode === 'yemek') {
      if (s && s.kcal) {
        const r = s.kcal / (s.target || tg);
        cls = r < 0.85 && d < today ? 'low' : r > 1.07 ? 'high' : r >= 0.85 ? 'ok' : '';
        v = `${s.kcal}`;
      }
      if (s?.extraMeals) dots += '<span style="color:var(--extra)">●</span>';
      if (s?.weight) dots += '⚖️';
    } else {
      const planned = S.plans.workout.schedule?.[weekdayKey(d)];
      const title = s?.workout?.title || (planned && S.plans.workout.workouts[planned]?.title) || '';
      const short = title.replace('Vücut ', '').replace(' (opsiyonel)', '').split(' ').slice(0, 2).join(' ');
      if (s?.workout?.done) { cls = 'ok'; v = short; }
      else if (planned && d < today && !(planned === 'kondisyon')) { cls = 'miss'; v = short; }
      else if (planned) v = short;
      else v = '<span class="muted">—</span>';
      if (s?.workout?.extra) dots += '<span style="color:var(--extra)">＋</span>';
    }
    if (s?.pending) dots += '⏳';
    cells += `<a class="c ${cls} ${d === today ? 'today' : ''} ${future ? 'future' : ''}" style="--i:${n + offset}" href="#/gun/${d}/${mode === 'yemek' ? 'beslenme' : 'antrenman'}">
      <span class="n">${n}</span><span class="v">${v}</span><span class="dots">${dots}</span></a>`;
  }

  const legend = mode === 'yemek'
    ? `<span><i style="background:color-mix(in srgb,var(--accent) 40%,transparent)"></i>Hedefte</span>
       <span><i style="background:color-mix(in srgb,var(--bad) 40%,transparent)"></i>Fazla</span>
       <span><i style="background:color-mix(in srgb,var(--info) 40%,transparent)"></i>Az</span>
       <span><span style="color:var(--extra)">●</span> Plan dışı öğün</span><span>⚖️ Tartı</span>`
    : `<span><i style="background:color-mix(in srgb,var(--accent) 40%,transparent)"></i>Yapıldı</span>
       <span><i style="background:color-mix(in srgb,var(--warn) 40%,transparent)"></i>Kaçırıldı</span>
       <span><span style="color:var(--extra)">＋</span> Ekstra hareket</span>`;

  view().innerHTML = `
    ${seg('cal', [[`#/takvim/${ym}/yemek`, '🍽 Yemek'], [`#/takvim/${ym}/spor`, '🏋️ Spor']], mode === 'yemek' ? 0 : 1)}
    <div class="cal">${['Pzt', 'Sal', 'Çar', 'Per', 'Cum', 'Cmt', 'Paz'].map((w) => `<div class="wd">${w}</div>`).join('')}${cells}</div>
    <div class="legend">${legend}</div>
    ${monthStats(sum, ym, mode)}`;
}

function monthStats(sum, ym, mode) {
  const days = Object.entries(sum.days).filter(([d]) => d.startsWith(ym)).map(([, v]) => v);
  if (!days.length) return '<div class="empty-state">Bu ay için kayıt yok.</div>';
  if (mode === 'yemek') {
    const logged = days.filter((d) => d.kcal > 0);
    const avg = (k) => (logged.length ? Math.round(logged.reduce((a, d) => a + (d[k] || 0), 0) / logged.length) : 0);
    return `<div class="stats" style="margin-top:12px">
      <div class="stat"><div class="k">Ort. kalori</div><div class="v">${cnt('m-kcal', avg('kcal'))}</div></div>
      <div class="stat"><div class="k">Ort. protein</div><div class="v">${cnt('m-p', avg('p'))} <small>g</small></div></div>
      <div class="stat"><div class="k">Kayıtlı gün</div><div class="v">${cnt('m-days', logged.length)}</div></div>
      <div class="stat"><div class="k">Plan dışı öğün</div><div class="v">${cnt('m-extra', days.reduce((a, d) => a + (d.extraMeals || 0), 0))}</div></div></div>`;
  }
  const done = days.filter((d) => d.workout?.done).length;
  return `<div class="stats" style="margin-top:12px">
    <div class="stat"><div class="k">Yapılan antrenman</div><div class="v">${cnt('m-done', done)}</div></div>
    <div class="stat"><div class="k">Toplam set</div><div class="v">${cnt('m-sets', days.reduce((a, d) => a + (d.workout?.sets || 0), 0))}</div></div></div>`;
}

// ---------- İlerleme ----------
async function viewProgress() {
  setTop(`<h1>İlerleme</h1>${refreshBtn()}`);
  if (!S.summary) view().innerHTML = skeleton(170, 230, 120);
  await loadPlans();
  const sum = await loadSummary();
  const series = sum.weight || [];
  const tr = sum.trend;
  const waist = Object.entries(sum.days).filter(([, v]) => v.waist).map(([d, v]) => ({ d, v: v.waist }));
  const cls = (x) => (x == null ? '' : x < 0 ? 'good' : x > 0 ? 'bad' : '');
  const sign = (x) => (x == null ? '—' : `${x > 0 ? '+' : ''}${x}`);

  let report = '';
  const files = (await listDir('reports/weekly')).filter((f) => f.name.endsWith('.md')).sort((a, b) => a.name.localeCompare(b.name));
  if (files.length) {
    const f = await gh(`/contents/${files.at(-1).path}?ref=${cfg.branch}`);
    report = `<div class="card"><h3>📊 Son haftalık rapor <small class="muted">${esc(files.at(-1).name.replace('.md', ''))}</small></h3><div class="md">${md(dec(f.content))}</div></div>`;
  }

  view().innerHTML = `
    <div class="stats stagger">
      <div class="stat" style="--i:0"><div class="k">7 günlük ortalama</div><div class="v">${tr?.avg7 != null ? cnt('avg7', tr.avg7, 1) : '—'} <small>kg</small></div></div>
      <div class="stat" style="--i:1"><div class="k">Haftalık değişim</div><div class="v ${cls(tr?.weeklyChange)}">${tr?.weeklyChange != null ? cnt('wk', tr.weeklyChange, 1, true) : '—'} <small>kg</small></div></div>
      <div class="stat" style="--i:2"><div class="k">Toplam</div><div class="v ${cls(tr?.totalChange)}">${tr?.totalChange != null ? cnt('tot', tr.totalChange, 1, true) : '—'} <small>kg</small></div></div>
      <div class="stat" style="--i:3"><div class="k">Bel</div><div class="v">${waist.length ? cnt('waist', waist.at(-1).v, 1) : '—'} <small>cm</small></div>
        ${waist.length > 1 ? `<small class="${cls(waist.at(-1).v - waist[0].v)}">${sign(+(waist.at(-1).v - waist[0].v).toFixed(1))} cm başlangıca göre</small>` : ''}</div>
    </div>
    <div class="card"><h3>Kilo</h3>${weightChart(series)}
      <small class="muted">Noktalar günlük tartı, çizgi 7 günlük ortalama. Günlük ±1 kg oynama normaldir, çizgiye bak.</small></div>
    <div class="card"><h3>🎯 Güncel hedefler</h3>
      <div class="grid2"><div>Kalori: <b>${S.plans.targets.kcal}</b></div><div>Protein: <b>${S.plans.targets.p} g</b></div>
      <div>Karb.: <b>${S.plans.targets.c} g</b></div><div>Yağ: <b>${S.plans.targets.f} g</b></div></div>
      ${S.plans.targets.reason ? `<small class="muted">${esc(S.plans.targets.reason)}</small>` : ''}</div>
    ${report}`;
}

function weightChart(pts) {
  if (pts.length < 2) return '<div class="empty-state">Grafik için en az 2 tartı gerekli.</div>';
  const W = 340, H = 170, P = { l: 34, r: 8, t: 8, b: 20 };
  const ws = pts.flatMap((p) => [p.w, p.avg7]);
  const min = Math.floor(Math.min(...ws) - 0.5), max = Math.ceil(Math.max(...ws) + 0.5);
  const t0 = Date.parse(pts[0].date), t1 = Date.parse(pts.at(-1).date) || t0 + 1;
  const x = (d) => P.l + ((Date.parse(d) - t0) / Math.max(1, t1 - t0)) * (W - P.l - P.r);
  const y = (v) => P.t + (1 - (v - min) / Math.max(1, max - min)) * (H - P.t - P.b);
  const grid = [];
  const step = Math.max(1, Math.round((max - min) / 4));
  for (let v = min; v <= max; v += step) grid.push(`<line x1="${P.l}" x2="${W - P.r}" y1="${y(v)}" y2="${y(v)}" stroke="var(--line)"/><text x="${P.l - 4}" y="${y(v) + 3}" text-anchor="end">${v}</text>`);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.avg7).toFixed(1)}`).join('');
  const area = `${line}L${x(pts.at(-1).date).toFixed(1)},${H - P.b}L${x(pts[0].date).toFixed(1)},${H - P.b}Z`;
  const dots = pts.map((p, i) => `<circle cx="${x(p.date)}" cy="${y(p.w)}" r="3" fill="var(--muted)" style="--i:${i}"/>`).join('');
  const lbl = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kilo grafiği">
    <defs><linearGradient id="wg" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#22c55e" stop-opacity=".35"/><stop offset="1" stop-color="#22c55e" stop-opacity="0"/></linearGradient>
      <linearGradient id="wl" x1="0" x2="1"><stop offset="0" stop-color="#22c55e"/><stop offset="1" stop-color="#38bdf8"/></linearGradient></defs>
    ${grid.join('')}<path class="area" d="${area}" fill="url(#wg)"/>${dots}
    <path class="line" d="${line}" fill="none" stroke="url(#wl)" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>
    <text x="${P.l}" y="${H - 4}">${lbl(pts[0].date)}</text><text x="${W - P.r}" y="${H - 4}" text-anchor="end">${lbl(pts.at(-1).date)}</text></svg>`;
}

// ---------- Ayarlar ----------
async function viewSettings() {
  setTop('<h1>Ayarlar</h1>');
  const connected = cfg.token || isDemo();
  view().innerHTML = `
    <div class="card">
      <h3>🔑 GitHub bağlantısı</h3>
      <small class="muted">Token yalnızca bu cihazın tarayıcısında saklanır. Sadece veri reposuna "Contents: Read and write" yetkisi olan fine-grained token kullan.</small>
      <label class="f">Veri reposu (kullanıcı/repo)</label><input id="s-repo" value="${esc(cfg.repo)}" placeholder="kullaniciadin/pt-data" autocapitalize="off">
      <label class="f">Token</label><input id="s-token" type="password" value="${esc(cfg.token)}" placeholder="github_pat_…" autocomplete="off">
      <div class="row" style="margin-top:10px"><button class="btn primary grow" data-act="save-cfg">Kaydet ve test et</button></div>
      <div id="s-status" style="margin-top:8px"></div>
    </div>
    ${connected ? '<div id="profile-card" class="card"><div class="loading">Profil yükleniyor…</div></div>' : ''}`;

  view().onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'save-cfg') {
      store.set('pt.repo', $('#s-repo').value.trim());
      store.set('pt.token', $('#s-token').value.trim());
      S.plans = null; S.summary = null; S.days = {};
      busy(b, async () => {
        await loadPlans(true);
        $('#s-status').innerHTML = '<span style="color:var(--accent)">✓ Bağlandı</span>';
        setTimeout(() => { location.hash = '#/gun'; }, 600);
      });
    } else if (b.dataset.act === 'save-profile') {
      const height = num($('#p-height').value);
      busy(b, async () => {
        const f = await readJSON('profile/profile.json');
        const p = { ...(f?.data || {}), heightCm: height };
        await writeJSON('profile/profile.json', p, f?.sha, 'Profil: boy güncellendi');
        S.plans.profile = p;
        toast('Kaydedildi, koç hedefleri yeniden hesaplayacak');
      });
    }
  };

  if (connected) {
    try {
      const { profile } = await loadPlans();
      $('#profile-card').innerHTML = `
        <h3>👤 Profil</h3>
        <div class="muted" style="font-size:14px">${profile.age ?? '?'} yaş · ${esc(profile.sex ?? '')} · başlangıç ${profile.startWeight ?? '?'} kg</div>
        <label class="f">Boy (cm), hedef hesabı için gerekli</label>
        <input id="p-height" inputmode="numeric" value="${profile.heightCm ?? ''}" placeholder="178">
        <button class="btn primary full" style="margin-top:10px" data-act="save-profile">Kaydet</button>`;
    } catch (e) {
      $('#profile-card').innerHTML = `<span style="color:var(--bad)">⚠️ ${esc(e.message)}</span>`;
    }
  }
}

// ---------- Hazır listeler: yemek ve hareket ----------
// Yemek: m = 100 g başına [kcal, protein, karb, yağ], u = [[porsiyon adı, gram], ...]
const LIB = { foods: null, exercises: null };
const norm = (s) => String(s ?? '').toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');
const jget = (k, d) => { try { return JSON.parse(store.get(k)) ?? d; } catch { return d; } };
const jset = (k, v) => store.set(k, JSON.stringify(v));
const MUSCLES = ['Tümü', 'Göğüs', 'Sırt', 'Omuz', 'Kol', 'Bacak', 'Kalça', 'Karın', 'Kardiyo', 'Tüm vücut'];

async function loadLib() {
  if (LIB.foods) return LIB;
  const get = (p) => fetch(p).then((r) => (r.ok ? r.json() : []));
  const [foods, exercises, custom] = await Promise.all([
    get('data/foods.json'), get('data/exercises.json'), readJSON('data/foods-custom.json').catch(() => null),
  ]);
  // Koçun daha önce hesaplayıp eklediği yemekler (veri reposunda, kişiye özel)
  LIB.foods = [...(custom?.data || []).map((f) => ({ ...f, cat: 'Koçun ekledikleri' })), ...foods];
  LIB.exercises = exercises;
  return LIB;
}

function searchList(list, q, fields) {
  const tokens = norm(q).split(/\s+/).filter(Boolean);
  return list
    .map((it) => {
      const hay = norm(fields.map((f) => it[f]).join(' '));
      if (!tokens.every((t) => hay.includes(t))) return null;
      return [norm(it[fields[0]]).startsWith(tokens[0]) ? 0 : 1, it];
    })
    .filter(Boolean).sort((a, b) => a[0] - b[0]).map((x) => x[1]);
}

const units = (food) => (food.u.some((u) => u[1] === 100 && u[0] === '100 g') ? food.u : [...food.u, ['100 g', 100]]);
function macrosFor(food, ui, qty) {
  const g = units(food)[ui][1] * qty;
  const [k, p, c, f] = food.m.map((v) => (v * g) / 100);
  return { g: Math.round(g), kcal: Math.round(k), p: Math.round(p), c: Math.round(c), f: Math.round(f) };
}
// "1 kase" × 1,5 → "1,5 kase"; "yarım" × 2 → "2 × yarım"
function portionLabel(food, ui, qty) {
  const u = units(food)[ui][0];
  if (qty === 1) return u;
  const q = String(qty).replace('.', ',');
  return u.startsWith('1 ') ? `${q} ${u.slice(2)}` : `${q} × ${u}`;
}
const guessSlot = () => {
  const h = +nowTime().slice(0, 2);
  return h < 5 ? 'gece' : h < 11 ? 'kahvalti' : h < 15 ? 'ogle' : h < 18 ? 'ara' : h < 22 ? 'aksam' : 'gece';
};

// Alttan açılan pencere
let sheetEls = null;
let scanStop = null;
function openSheet() {
  closeSheet(true);
  document.body.insertAdjacentHTML('beforeend', '<div class="sheet-bg"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div><div class="sheet-in"></div></div>');
  const bg = document.body.lastElementChild.previousElementSibling;
  const sheet = document.body.lastElementChild;
  sheetEls = { bg, sheet };
  document.body.classList.add('noscroll');
  bg.onclick = () => closeSheet();
  // Tutamaçtan aşağı sürükleyerek kapat
  const grab = $('.grab', sheet);
  let y0 = null;
  grab.addEventListener('touchstart', (e) => { y0 = e.touches[0].clientY; sheet.style.transition = 'none'; }, { passive: true });
  grab.addEventListener('touchmove', (e) => { if (y0 != null) sheet.style.transform = `translateY(${Math.max(0, e.touches[0].clientY - y0)}px)`; }, { passive: true });
  grab.addEventListener('touchend', (e) => {
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null; sheet.style.transition = ''; sheet.style.transform = '';
    if (dy > 90) closeSheet();
  });
  return $('.sheet-in', sheet);
}
function closeSheet(now) {
  scanStop?.();
  if (!sheetEls) return;
  const { bg, sheet } = sheetEls;
  sheetEls = null;
  document.body.classList.remove('noscroll');
  if (now || reduced) { bg.remove(); sheet.remove(); return; }
  bg.classList.add('out'); sheet.classList.add('out');
  setTimeout(() => { bg.remove(); sheet.remove(); }, 300);
}
// Yazarken sadece çipleri ve listeyi yenile: arama kutusu odağını korur, satırlar yeniden animasyon oynatmaz
function refreshList(body, listHtml) {
  const tmp = document.createElement('div');
  tmp.innerHTML = listHtml();
  $('.chips', body).replaceWith($('.chips', tmp));
  const list = $('.flist', tmp);
  list.classList.add('quiet');
  $('.flist', body).replaceWith(list);
}
const sheetTabs = (items, sel) => `<div class="seg" style="--n:${items.length};--sel:${sel}"><span class="ind"></span>
  ${items.map(([k, l], i) => `<button class="${i === sel ? 'on' : ''}" data-mode="${k}">${l}</button>`).join('')}</div>`;

// ---- Yemek penceresi ----
function openFoodSheet(date, { slot, time, replaceId, replaceName } = {}) {
  const st = {
    mode: 'liste', q: '', cat: 'Son', basket: [], detail: null,
    slot: slot || guessSlot(), time: time || (date === todayStr() ? nowTime() : '13:00'),
  };
  const body = openSheet();
  body.innerHTML = skeleton(48, 40, 300);
  loadLib().then(draw).catch((e) => { body.innerHTML = `<div class="empty-state">⚠️ ${esc(e.message)}</div>`; });

  const recents = () => jget('pt.recentFoods', []);
  const favs = () => jget('pt.favFoods', []);
  const isFav = (food) => favs().some((f) => f.n === food.n);
  const toggleFav = (food) => {
    const list = favs();
    jset('pt.favFoods', isFav(food) ? list.filter((f) => f.n !== food.n) : [food, ...list].slice(0, 50));
  };

  function rowsFor() {
    if (st.q) return searchList(LIB.foods, st.q, ['n', 'a', 'cat']).slice(0, 50).map((f) => ({ food: f, ui: 0, qty: 1 }));
    if (st.cat === 'Son') return recents().map((r) => ({ food: r.f, ui: r.ui, qty: r.q }));
    if (st.cat === 'Favori') return favs().map((f) => ({ food: f, ui: 0, qty: 1 }));
    return LIB.foods.filter((f) => f.cat === st.cat).map((f) => ({ food: f, ui: 0, qty: 1 }));
  }

  function listHtml() {
    const cats = ['Son', 'Favori', ...new Set(LIB.foods.map((f) => f.cat))];
    const rows = rowsFor();
    st.rows = rows;
    const empty = st.q
      ? `<div class="empty-state">"${esc(st.q)}" listede yok.<br><button class="btn sm" data-x="to-free" style="margin-top:8px">✍️ Serbest yaz, koç hesaplasın</button></div>`
      : st.cat === 'Son' ? '<div class="empty-state">Henüz bir şey eklemedin. Yukarıdan ara ya da kategori seç.</div>'
        : '<div class="empty-state">Favori yok. Yemeklerin yanındaki ★ ile ekle.</div>';
    return `
      <input class="search" id="f-q" type="search" placeholder="Ara: mercimek, döner, muz…" value="${esc(st.q)}" autocomplete="off">
      <div class="chips">${cats.map((c) => `<button class="chip ${!st.q && c === st.cat ? 'on' : ''}" data-cat="${esc(c)}">${c === 'Son' ? '🕘 Son' : c === 'Favori' ? '★ Favori' : esc(c)}</button>`).join('')}</div>
      <div class="flist">${rows.length ? rows.map((r, i) => {
        const mm = macrosFor(r.food, r.ui, r.qty);
        return `<div class="frow" data-i="${i}" style="--i:${Math.min(i, 12)}">
          <div class="fmain"><b>${esc(r.food.n)}</b><small>${esc(portionLabel(r.food, r.ui, r.qty))} · ${mm.kcal} kcal · P ${mm.p}</small></div>
          <button class="fav ${isFav(r.food) ? 'on' : ''}" data-fav="${i}" aria-label="Favori">★</button>
          <button class="fadd" data-quick="${i}" aria-label="Hızlı ekle">＋</button></div>`;
      }).join('') : empty}</div>`;
  }

  function detailHtml() {
    const { food, ui, qty } = st.detail;
    const mm = macrosFor(food, ui, qty);
    return `
      <button class="btn sm" data-x="back">‹ Listeye dön</button>
      <h3 style="margin:12px 0 2px">${esc(food.n)}</h3><small class="muted">${esc(food.cat || '')}</small>
      <label class="f">Porsiyon</label>
      <div class="chips wrap">${units(food).map((u, i) => `<button class="chip ${i === ui ? 'on' : ''}" data-unit="${i}">${esc(u[0])}${/\d\s*g$/.test(u[0]) ? '' : ` <small>${u[1]} g</small>`}</button>`).join('')}</div>
      <label class="f">Miktar</label>
      <div class="stepper"><button data-qty="-">−</button><b>${qty}</b><button data-qty="+">+</button></div>
      <div class="mgrid">
        <div><b>${cnt('d-k', mm.kcal)}</b><small>kcal</small></div>
        <div style="--c:var(--p)"><b>${cnt('d-p', mm.p)}</b><small>protein</small></div>
        <div style="--c:var(--c)"><b>${cnt('d-c', mm.c)}</b><small>karb.</small></div>
        <div style="--c:var(--f)"><b>${cnt('d-f', mm.f)}</b><small>yağ</small></div>
      </div>
      <small class="muted">${mm.g} g</small>
      <button class="btn primary full" data-x="to-basket" style="margin-top:12px">Sepete ekle</button>`;
  }

  function barcodeHtml() {
    const can = 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
    return `
      <p class="muted" style="margin:4px 0 10px">Paketli ürünün barkodunu okut ya da numarasını yaz. Besin değerleri Open Food Facts'ten gelir.</p>
      ${can ? '<button class="btn primary full" data-x="scan">📷 Kamerayla tara</button><video id="bc-video" playsinline muted></video>'
        : '<small class="muted">Bu tarayıcı kamerayla barkod okumayı desteklemiyor (iPhone Safari gibi). Numarayı elle yazabilirsin.</small>'}
      <div class="row" style="margin-top:10px"><input id="bc-code" inputmode="numeric" placeholder="8690000000000" class="grow" style="flex:1"><button class="btn" data-x="lookup">Ara</button></div>
      <div id="bc-status" class="muted" style="margin-top:8px"></div>`;
  }

  function freeHtml() {
    return `
      <p class="muted" style="margin:4px 0 0">Listede olmayan ya da karışık bir şey yediysen yaz, koç kalorisini hesaplasın.</p>
      <label class="f">Ne yedin? (yaklaşık miktarlarla)</label>
      <textarea id="x-text" placeholder="ör. annemin kuru fasulyesi 1 tabak, yarım ekmek">${esc(st.freeText || '')}</textarea>
      <label class="f">Kalori (biliyorsan)</label>
      <input id="x-kcal" type="number" inputmode="numeric" placeholder="boş bırakırsan koç tahmin eder">`;
  }

  function footerHtml() {
    const tot = st.basket.reduce((a, b) => { const m = macrosFor(b.food, b.ui, b.qty); a.kcal += m.kcal; a.p += m.p; return a; }, { kcal: 0, p: 0 });
    const free = st.mode === 'serbest';
    if (!free && !st.basket.length) return replaceId ? `<div class="sheet-foot"><small class="muted">"${esc(replaceName)}" yerine ne yediğini seç.</small></div>` : '';
    return `<div class="sheet-foot">
      ${!free ? `<div class="bitems">${st.basket.map((b, i) => `<span class="bchip">${esc(b.food.n)} · ${esc(portionLabel(b.food, b.ui, b.qty))}<i data-rm="${i}">✕</i></span>`).join('')}</div>` : ''}
      <div class="grid2">
        <select id="f-slot">${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}" ${k === st.slot ? 'selected' : ''}>${v}</option>`).join('')}</select>
        <input id="f-time" type="time" value="${st.time}">
      </div>
      <button class="btn primary full" data-x="save" style="margin-top:8px">${free ? 'Kaydet' : `Kaydet · ${tot.kcal} kcal · P ${tot.p}`}</button></div>`;
  }

  function draw() {
    const modes = [['liste', '🔎 Liste'], ['barkod', '▥ Barkod'], ['serbest', '✍️ Serbest']];
    const content = st.mode === 'liste' ? (st.detail ? detailHtml() : listHtml()) : st.mode === 'barkod' ? barcodeHtml() : freeHtml();
    body.innerHTML = `
      <div class="sheet-h"><b>${replaceId ? `${esc(replaceName)} yerine` : 'Yemek ekle'}</b><button class="icon" data-x="close" aria-label="Kapat">✕</button></div>
      ${sheetTabs(modes, modes.findIndex(([k]) => k === st.mode))}
      <div class="sheet-body">${content}</div>
      ${footerHtml()}`;
    $$('[data-count]', body).forEach(countUp);
    const q = $('#f-q', body);
    if (q) q.oninput = () => { st.q = q.value; refreshList(body, listHtml); };
  }

  function addToBasket(item) {
    st.basket.push(item);
    vibrate(10);
    toast(`${item.food.n} sepette`);
  }

  async function lookupBarcode(code) {
    const status = $('#bc-status', body);
    if (!/^\d{6,14}$/.test(code)) { status.textContent = 'Geçerli bir barkod numarası yaz.'; return; }
    status.textContent = 'Aranıyor…';
    try {
      const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=product_name,brands,nutriments,serving_quantity`);
      const j = await r.json();
      const p = j.product;
      const n = p?.nutriments || {};
      if (!p || n['energy-kcal_100g'] == null) { status.textContent = 'Ürün bulunamadı ya da besin değeri yok. Serbest yazabilirsin.'; return; }
      const food = {
        n: p.product_name || p.brands?.split(',')[0] || `Ürün ${code}`,
        cat: 'Paketli ürün',
        m: [n['energy-kcal_100g'], n.proteins_100g || 0, n.carbohydrates_100g || 0, n.fat_100g || 0],
        u: p.serving_quantity ? [['1 porsiyon', +p.serving_quantity]] : [['100 g', 100]],
      };
      scanStop?.();
      st.mode = 'liste'; st.detail = { food, ui: 0, qty: 1 };
      draw();
    } catch {
      status.textContent = 'Bağlantı hatası, tekrar dene.';
    }
  }

  async function startScan() {
    const video = $('#bc-video', body);
    const status = $('#bc-status', body);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      video.srcObject = stream;
      video.classList.add('on');
      await video.play();
      const det = new BarcodeDetector({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e'] });
      let alive = true;
      scanStop = () => { alive = false; stream.getTracks().forEach((t) => t.stop()); scanStop = null; };
      status.textContent = 'Barkodu kameraya göster…';
      while (alive) {
        const codes = await det.detect(video).catch(() => []);
        if (codes[0]) { vibrate(30); const c = codes[0].rawValue; scanStop(); $('#bc-code', body).value = c; lookupBarcode(c); return; }
        await new Promise((r) => setTimeout(r, 250));
      }
    } catch {
      status.textContent = 'Kamera açılamadı. Numarayı elle yazabilirsin.';
    }
  }

  async function save(btn) {
    st.slot = $('#f-slot', body).value;
    st.time = $('#f-time', body).value;
    const newId = uid();
    let meal, what;
    if (st.mode === 'serbest') {
      const text = $('#x-text', body).value.trim();
      if (!text) { toast('Ne yediğini yaz'); return; }
      meal = { text, items: [], kcal: num($('#x-kcal', body).value), p: null, c: null, f: null, needsParse: true };
      what = `Plan dışı öğün eklendi (${SLOTS[st.slot]}): ${text}`;
    } else {
      const sum = { kcal: 0, p: 0, c: 0, f: 0 };
      const items = st.basket.map((b) => {
        const m = macrosFor(b.food, b.ui, b.qty);
        for (const k of Object.keys(sum)) sum[k] += m[k];
        return { name: b.food.n, amount: `${portionLabel(b.food, b.ui, b.qty)} (${m.g} g)` };
      });
      meal = { items, ...sum, fromDb: true, needsParse: false };
      what = `Listeden eklendi (${SLOTS[st.slot]}): ${items.map((i) => `${i.name} ${i.amount}`).join(', ')} = ${sum.kcal} kcal`;
      const rec = recents().filter((r) => !st.basket.some((b) => b.food.n === r.f.n));
      jset('pt.recentFoods', [...st.basket.map((b) => ({ f: b.food, ui: b.ui, q: b.qty })), ...rec].slice(0, 25));
    }
    await busy(btn, async () => {
      await updateDay(date, what, (d) => {
        if (replaceId) { const r = d.meals.find((x) => x.id === replaceId); if (r) r.status = 'replaced'; }
        d.meals.push({ id: newId, slot: st.slot, name: SLOTS[st.slot], time: st.time, source: 'extra', status: 'eaten', ...meal });
      });
      closeSheet();
      A.flash = newId;
      vibrate(15);
      toast(meal.fromDb ? `Eklendi · ${meal.kcal} kcal` : 'Eklendi, koç makroları hesaplayacak');
      rerender();
    });
  }

  body.onclick = (e) => {
    const t = e.target.closest('[data-x],[data-mode],[data-cat],[data-i],[data-unit],[data-qty],[data-rm]');
    if (!t) return;
    const d = t.dataset;
    if (d.mode) { if (st.mode === 'serbest') st.freeText = $('#x-text', body)?.value; scanStop?.(); st.mode = d.mode; draw(); return; }
    if (d.cat) { st.cat = d.cat; st.q = ''; draw(); return; }
    if (d.rm != null) { st.basket.splice(+d.rm, 1); draw(); return; }
    if (d.unit != null) { st.detail.ui = +d.unit; draw(); return; }
    if (d.qty) { st.detail.qty = Math.max(0.5, st.detail.qty + (d.qty === '+' ? 0.5 : -0.5)); vibrate(5); draw(); return; }
    if (d.i != null) {
      const fav = e.target.closest('[data-fav]');
      const quick = e.target.closest('[data-quick]');
      const row = st.rows[+d.i];
      if (fav) { toggleFav(row.food); draw(); return; }
      if (quick) { addToBasket({ ...row }); quick.classList.add('popped'); setTimeout(draw, 250); return; }
      st.detail = { ...row };
      draw();
      return;
    }
    switch (d.x) {
      case 'close': closeSheet(); break;
      case 'back': st.detail = null; draw(); break;
      case 'to-basket': addToBasket({ ...st.detail }); st.detail = null; draw(); break;
      case 'to-free': st.freeText = st.q; st.mode = 'serbest'; draw(); break;
      case 'scan': startScan(); break;
      case 'lookup': lookupBarcode($('#bc-code', body).value.trim()); break;
      case 'save': save(t); break;
      default:
    }
  };
}

// ---- Hareket penceresi ----
function openExerciseSheet(onAdd) {
  const st = { q: '', m: 'Tümü', detail: null };
  const body = openSheet();
  body.innerHTML = skeleton(48, 40, 300);
  loadLib().then(draw).catch((e) => { body.innerHTML = `<div class="empty-state">⚠️ ${esc(e.message)}</div>`; });

  function listHtml() {
    let rows = st.m === 'Tümü' ? LIB.exercises : LIB.exercises.filter((x) => x.m === st.m);
    if (st.q) rows = searchList(rows, st.q, ['n', 'tr', 'm']);
    st.rows = rows;
    const custom = st.q && !rows.some((r) => norm(r.n) === norm(st.q))
      ? `<div class="frow" data-custom="1"><div class="fmain"><b>＋ "${esc(st.q)}"</b><small>Listede yok, bu adla ekle</small></div></div>` : '';
    const last = exLast();
    return `
      <input class="search" id="e-q" type="search" placeholder="Ara: bench, barfiks, koşu…" value="${esc(st.q)}" autocomplete="off">
      <div class="chips">${MUSCLES.map((m) => `<button class="chip ${m === st.m ? 'on' : ''}" data-m="${m}">${m}</button>`).join('')}</div>
      <div class="flist">${custom}${rows.map((r, i) => `<div class="frow" data-i="${i}" style="--i:${Math.min(i, 12)}">
        <div class="fmain"><b>${esc(r.n)}</b><small>${esc(r.tr)} · ${r.m}${last[r.n] ? ` · son: ${r.k === 'kardiyo' ? `${last[r.n].min ?? '?'} dk` : `${last[r.n].kg ?? '?'} kg × ${last[r.n].reps ?? '?'}`}` : ''}</small></div>
        <span class="fadd">›</span></div>`).join('')}</div>`;
  }

  function detailHtml() {
    const ex = st.detail;
    const last = exLast()[ex.n] || {};
    const cardio = ex.k === 'kardiyo';
    return `
      <button class="btn sm" data-x="back">‹ Listeye dön</button>
      <h3 style="margin:12px 0 2px">${esc(ex.n)}</h3><small class="muted">${esc(ex.tr || '')} · ${ex.m}</small>
      ${cardio ? `
        <div class="grid2">
          <div><label class="f">Süre (dk)</label><input id="x-min" inputmode="decimal" value="${last.min ?? 30}"></div>
          <div><label class="f">Mesafe (km)</label><input id="x-km" inputmode="decimal" value="${last.km ?? ''}" placeholder="opsiyonel"></div>
        </div>` : `
        <label class="f">Set sayısı</label>
        <div class="stepper"><button data-sets="-">−</button><b id="x-sets">${st.sets ?? 3}</b><button data-sets="+">+</button></div>
        <div class="grid2">
          <div><label class="f">Ağırlık (kg)</label><input id="x-kg" inputmode="decimal" value="${last.kg ?? ''}" placeholder="vücut ağırlığı ise boş"></div>
          <div><label class="f">Tekrar</label><input id="x-reps" inputmode="numeric" value="${last.reps ?? ''}" placeholder="12"></div>
        </div>`}
      <label class="f">Not</label><input id="x-note" placeholder="opsiyonel (his, eğim, tempo…)">
      <button class="btn primary full" data-x="add" style="margin-top:12px">Antrenmana ekle</button>`;
  }

  function draw() {
    body.innerHTML = `
      <div class="sheet-h"><b>Hareket ekle</b><button class="icon" data-x="close" aria-label="Kapat">✕</button></div>
      <div class="sheet-body">${st.detail ? detailHtml() : listHtml()}</div>`;
    const q = $('#e-q', body);
    if (q) q.oninput = () => { st.q = q.value; refreshList(body, listHtml); };
  }

  body.onclick = async (e) => {
    const t = e.target.closest('[data-x],[data-m],[data-i],[data-custom],[data-sets]');
    if (!t) return;
    const d = t.dataset;
    if (d.m) { st.m = d.m; draw(); return; }
    if (d.custom) { st.detail = { n: st.q.trim(), tr: 'Listede olmayan hareket', m: 'Diğer' }; st.sets = 3; draw(); return; }
    if (d.i != null) { st.detail = st.rows[+d.i]; st.sets = 3; draw(); return; }
    if (d.sets) { st.sets = Math.max(1, Math.min(10, (st.sets ?? 3) + (d.sets === '+' ? 1 : -1))); $('#x-sets', body).textContent = st.sets; vibrate(5); return; }
    if (d.x === 'close') { closeSheet(); return; }
    if (d.x === 'back') { st.detail = null; draw(); return; }
    if (d.x === 'add') {
      const ex = st.detail;
      const cardio = ex.k === 'kardiyo';
      const note = $('#x-note', body).value.trim();
      let sets, what;
      if (cardio) {
        const s = { min: num($('#x-min', body).value), km: num($('#x-km', body).value) };
        sets = [s];
        what = `Ekstra kardiyo: ${ex.n} ${s.min ?? '?'} dk${s.km ? `, ${s.km} km` : ''}`;
      } else {
        const s = { kg: num($('#x-kg', body).value), reps: num($('#x-reps', body).value) };
        sets = Array.from({ length: st.sets ?? 3 }, () => ({ ...s }));
        what = `Ekstra hareket: ${ex.n} ${sets.length}x${s.reps ?? '?'}${s.kg != null ? ` @${s.kg}kg` : ''}`;
      }
      if (note) what += ` (${note})`;
      await busy(t, async () => {
        await onAdd({ id: uid(), name: ex.n, source: 'extra', target: '', note, sets, ...(cardio ? { kind: 'kardiyo' } : {}) }, what);
        closeSheet();
      });
    }
  };
}

// ---------- Yönlendirme ----------
let current = async () => {};
// Kaydetme sonrası yeniden çizim: giriş animasyonu yok, halkalar/sayılar eski değerden akar
async function rerender() {
  A.quiet = true;
  try { await current(); } finally { A.quiet = false; A.flash = null; }
}

const TAB_INDEX = { gun: 0, takvim: 1, ilerleme: 2, ayarlar: 3 };

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || 'gun';
  let active = -1;
  $$('#tabs a').forEach((a) => {
    const on = a.dataset.tab === page && (page !== 'gun' || !parts[1] || parts[1] === todayStr());
    a.classList.toggle('on', on);
    if (on) active = TAB_INDEX[page];
  });
  const nav = $('#tabs');
  if (active >= 0) nav.style.setProperty('--tab', active);
  $('.ind', nav).style.opacity = active >= 0 ? 1 : 0;
  if (!cfg.repo || (!cfg.token && !isDemo())) {
    if (page !== 'ayarlar') { location.hash = '#/ayarlar'; return; }
  }
  view().onclick = null;
  const run = {
    gun: () => viewDay(parts[1] || todayStr(), parts[2]),
    takvim: () => viewCalendar(parts[1], parts[2]),
    ilerleme: () => viewProgress(),
    ayarlar: () => viewSettings(),
  }[page] || (() => { location.hash = '#/gun'; });
  current = async () => {
    try { await run(); } catch (e) {
      console.error(e);
      view().innerHTML = `<div class="card" style="color:var(--bad)">⚠️ ${esc(e.message)}<br><small class="muted">İnternet bağlantını ve Ayarlar'daki token'ı kontrol et.</small></div>`;
    }
    animateIn(view());
    A.dir = '';
  };
  window.scrollTo({ top: 0, behavior: 'instant' });
  await current();
}

document.addEventListener('click', async (e) => {
  const h = e.target.closest('[data-href]');
  if (h) { A.dir = h.dataset.dir || ''; vibrate(6); location.hash = h.dataset.href; return; }
  if (e.target.closest('[data-act=refresh]')) {
    S.days = {}; S.summary = null; S.plans = null;
    A.loading = true;
    e.target.closest('[data-act=refresh]').classList.add('spin');
    await rerender();
    A.loading = false;
    $('[data-act=refresh]')?.classList.remove('spin');
    toast('Yenilendi ✨');
  }
});

// Butonlarda dokunma dalgası
document.addEventListener('pointerdown', (e) => {
  const b = e.target.closest('.btn');
  if (!b || reduced) return;
  const r = b.getBoundingClientRect();
  const s = Math.max(r.width, r.height);
  const w = document.createElement('span');
  w.className = 'ripple';
  Object.assign(w.style, { width: `${s}px`, height: `${s}px`, left: `${e.clientX - r.left - s / 2}px`, top: `${e.clientY - r.top - s / 2}px` });
  b.appendChild(w);
  setTimeout(() => w.remove(), 600);
});

// Sağa/sola kaydırma: gün ekranında gün, takvimde ay değiştirir (üstte oklar olan her ekranda)
let touch = null;
document.addEventListener('touchstart', (e) => {
  const t = e.touches[0];
  touch = t && !sheetEls && !e.target.closest('input, textarea, select, .sets') ? { x: t.clientX, y: t.clientY, at: Date.now() } : null;
}, { passive: true });
document.addEventListener('touchend', (e) => {
  if (!touch) return;
  const t = e.changedTouches[0];
  const dx = t.clientX - touch.x, dy = t.clientY - touch.y;
  touch = null;
  if (Math.abs(dx) < 70 || Math.abs(dy) > 50) return;
  const btn = $(`#top [data-dir="${dx < 0 ? 'from-right' : 'from-left'}"]`);
  if (btn) { A.dir = btn.dataset.dir; vibrate(8); location.hash = btn.dataset.href; }
}, { passive: true });

window.addEventListener('hashchange', route);
route();
