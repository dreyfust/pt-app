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

// ---------- Gün görünümü ----------
async function viewDay(date, tab) {
  tab = tab || 'beslenme';
  const isToday = date === todayStr();
  setTop(`
    <button class="icon" data-href="#/gun/${addDays(date, -1)}/${tab}" aria-label="Önceki gün">‹</button>
    <div class="title"><b>${fmtDate(date)}</b>${isToday ? '<small>Bugün</small>' : `<small><a href="#/gun" style="color:inherit">Bugüne dön</a></small>`}</div>
    <button class="icon" data-act="refresh" aria-label="Yenile">⟳</button>
    <button class="icon" data-href="#/gun/${addDays(date, 1)}/${tab}" aria-label="Sonraki gün">›</button>`);
  view().innerHTML = '<div class="loading">Yükleniyor…</div>';
  const day = await getDay(date);

  const tabs = [['beslenme', '🍽 Beslenme'], ['antrenman', '🏋️ Antrenman'], ['olcum', '⚖️ Ölçüm']];
  view().innerHTML = `
    ${coachCard(day)}
    <div class="seg">${tabs.map(([k, l]) => `<button class="${k === tab ? 'on' : ''}" data-href="#/gun/${date}/${k}">${l}</button>`).join('')}</div>
    <div id="tab"></div>`;
  const el = $('#tab');
  if (tab === 'beslenme') renderNutrition(el, date, day);
  else if (tab === 'antrenman') renderWorkout(el, date, day);
  else renderMeasure(el, date, day);
}

function coachCard(day) {
  const c = day.coach;
  const when = c?.updatedAt ? new Date(c.updatedAt).toLocaleTimeString('tr-TR', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }) : '';
  const msg = c?.message ? `<div class="md">${md(c.message)}</div>` : '';
  if (day.pending) {
    return `<div class="card coach wait"><div class="coach-h"><span>⏳ Koç değerlendiriyor…</span><small>1-3 dk sonra ⟳</small></div>${msg ? `<div style="opacity:.6">${msg}</div>` : ''}</div>`;
  }
  if (!msg) return '';
  const flags = (c.flags || []).length ? `<div class="row" style="margin-bottom:6px">${c.flags.map((f) => `<span class="badge skipped">⚠️ ${esc(f)}</span>`).join('')}</div>` : '';
  return `<div class="card coach"><div class="coach-h"><span>🧠 Koç</span><small class="muted">${when}</small></div>${flags}${msg}</div>`;
}

function bar(label, val, target, unit) {
  const pct = target ? Math.min(100, (val / target) * 100) : 0;
  const over = target && val > target * 1.05;
  return `<div class="bar ${over ? 'over' : ''}"><div class="lbl"><span>${label}</span><span>${Math.round(val)} / ${target} ${unit}</span></div>
    <div class="track"><div class="fill" style="width:${pct}%"></div></div></div>`;
}

function renderNutrition(el, date, day) {
  const t = totals(day);
  const tg = S.plans.targets;
  const meals = [...day.meals].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
  el.innerHTML = `
    <div class="card">
      ${bar('Kalori', t.kcal, tg.kcal, 'kcal')}
      ${bar('Protein', t.p, tg.p, 'g')}
      <div class="grid2">${bar('Karb.', t.c, tg.c, 'g')}${bar('Yağ', t.f, tg.f, 'g')}</div>
      ${t.unknown ? `<small class="muted">+ ${t.unknown} öğünün makrosunu koç hesaplayacak</small>` : ''}
    </div>
    ${meals.map(mealCard).join('') || '<div class="empty-state">Bu gün için plan yok.</div>'}
    <div class="card" id="extra-form">
      <h3>➕ Plan dışı öğün ekle</h3>
      <div class="grid2">
        <div><label class="f">Öğün</label><select id="x-slot">${Object.entries(SLOTS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></div>
        <div><label class="f">Saat</label><input id="x-time" type="time" value="${date === todayStr() ? nowTime() : '13:00'}"></div>
      </div>
      <label class="f">Ne yedin? (yaklaşık miktarlarla)</label>
      <textarea id="x-text" placeholder="ör. 1 tavuk dürüm, 1 ayran"></textarea>
      <label class="f">Kalori (biliyorsan, boş bırakırsan koç tahmin eder)</label>
      <input id="x-kcal" type="number" inputmode="numeric" placeholder="opsiyonel">
      <button class="btn primary full" style="margin-top:10px" data-act="add-meal">Ekle</button>
    </div>`;

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const id = b.dataset.id;
    const act = b.dataset.act;
    if (act === 'meal-status') {
      const status = b.dataset.status;
      const m = day.meals.find((x) => x.id === id);
      if (status === 'replaced') {
        $('#x-slot').value = SLOTS[m.slot] ? m.slot : 'diger';
        $('#x-time').value = m.time || nowTime();
        $('#extra-form').dataset.replace = id;
        $('#extra-form').scrollIntoView({ behavior: 'smooth' });
        $('#x-text').focus();
        toast('Yerine ne yediğini yaz');
        return;
      }
      const next = m.status === status ? 'planned' : status;
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
    } else if (act === 'add-meal') {
      const text = $('#x-text').value.trim();
      if (!text) { toast('Ne yediğini yaz'); return; }
      const slot = $('#x-slot').value;
      const replaceId = $('#extra-form').dataset.replace;
      const kcal = num($('#x-kcal').value);
      busy(b, async () => {
        await updateDay(date, `Plan dışı öğün eklendi (${SLOTS[slot]}): ${text}`, (d) => {
          if (replaceId) { const r = d.meals.find((x) => x.id === replaceId); if (r) r.status = 'replaced'; }
          d.meals.push({
            id: uid(), slot, name: SLOTS[slot], time: $('#x-time').value, source: 'extra', status: 'eaten',
            text, items: [], kcal, p: null, c: null, f: null, needsParse: true,
          });
        });
        toast('Eklendi, koç makroları hesaplayacak');
        rerender();
      });
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
  return `<div class="meal ${m.status}">
    <div class="meal-h"><span class="time">${esc(m.time || '')}</span><b>${esc(m.name)}</b>
      ${m.source === 'extra' ? '<span class="badge extra">Plan dışı</span>' : ''}
      ${statusLbl ? `<span class="badge ${m.status}">${statusLbl}</span>` : ''}</div>
    ${items}<div class="macro">${macro}</div><div class="row">${actions}</div></div>`;
}

function setRow(i, s = {}) {
  return `<tr><td>${i + 1}</td>
    <td><input inputmode="decimal" data-k="kg" value="${s.kg ?? ''}" placeholder="kg"></td><td class="unit">kg</td>
    <td><input inputmode="numeric" data-k="reps" value="${s.reps ?? ''}" placeholder="tekrar"></td><td class="unit">tekrar</td>
    <td><button class="btn sm" data-act="del-set" aria-label="Seti sil">×</button></td></tr>`;
}

function renderWorkout(el, date, day) {
  const w = day.workout || { title: 'Dinlenme günü', exercises: [] };
  const exHtml = w.exercises.map((e) => `
    <div class="ex" data-ex="${e.id}">
      <div class="ex-h"><b>${esc(e.name)}</b>
        ${e.source === 'extra' ? '<span class="badge extra">Ekstra</span>' : ''}
        ${e.target ? `<span class="badge">${esc(e.target)}</span>` : ''}
        ${e.source === 'extra' ? `<button class="btn sm danger" data-act="del-ex" data-id="${e.id}">Sil</button>` : ''}</div>
      ${e.note ? `<small class="muted">${esc(e.note)}</small>` : ''}
      <table class="sets"><tbody>${(e.sets.length ? e.sets : [{}]).map((s, i) => setRow(i, s)).join('')}</tbody></table>
      <button class="btn sm" data-act="add-set" style="margin-top:6px">+ Set</button>
    </div>`).join('');

  el.innerHTML = `
    <div class="card"><div class="row"><h3 class="grow" style="margin:0">${esc(w.title)}</h3>${w.done ? '<span class="badge eaten">✓ Tamamlandı</span>' : ''}</div>
      ${!w.planId && !w.exercises.length ? '<p class="muted" style="margin:8px 0 0">Bugün plan yok. Toparlan, 8-10 bin adım yeter. Yine de bir şey yaptıysan aşağıdan ekle.</p>' : ''}</div>
    ${exHtml}
    ${w.exercises.length ? `
      <label class="row" style="margin:6px 0 10px"><input type="checkbox" id="w-done" style="width:auto" ${w.done ? 'checked' : ''}> Antrenman bitti</label>
      <button class="btn primary full" data-act="save-workout">💾 Antrenmanı kaydet</button>` : ''}
    <div class="card" style="margin-top:12px">
      <h3>➕ Programda olmayan hareket ekle</h3>
      <label class="f">Hareket</label><input id="e-name" placeholder="ör. Cable Fly, 20 dk bisiklet" list="ex-list">
      <datalist id="ex-list">${allExerciseNames().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <div class="grid3">
        <div><label class="f">Set</label><input id="e-sets" type="number" inputmode="numeric" value="3"></div>
        <div><label class="f">Tekrar</label><input id="e-reps" inputmode="numeric" placeholder="12"></div>
        <div><label class="f">Kg</label><input id="e-kg" inputmode="decimal" placeholder="opsiyonel"></div>
      </div>
      <label class="f">Not (kardiyo süresi, his vb.)</label><input id="e-note" placeholder="opsiyonel">
      <button class="btn primary full" style="margin-top:10px" data-act="add-ex">Ekle</button>
    </div>`;

  const collect = () => Object.fromEntries($$('.ex', el).map((box) => [box.dataset.ex,
    $$('tbody tr', box).map((tr) => ({ kg: num($('[data-k=kg]', tr).value), reps: num($('[data-k=reps]', tr).value) }))
      .filter((s) => s.kg != null || s.reps != null)]));

  el.onclick = (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const act = b.dataset.act;
    if (act === 'add-set') {
      const tbody = $('tbody', b.closest('.ex'));
      const last = tbody.lastElementChild;
      const prev = last ? { kg: $('[data-k=kg]', last).value, reps: $('[data-k=reps]', last).value } : {};
      tbody.insertAdjacentHTML('beforeend', setRow(tbody.children.length, prev));
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
        await updateDay(date, `Antrenman kaydedildi: ${n} set${done ? ', bitti' : ''}`, (d) => {
          for (const ex of d.workout.exercises) if (sets[ex.id]) ex.sets = sets[ex.id];
          d.workout.done = done;
        });
        toast('Kaydedildi 💪');
        rerender();
      });
    } else if (act === 'add-ex') {
      const name = $('#e-name').value.trim();
      if (!name) { toast('Hareket adını yaz'); return; }
      const count = Math.max(0, Math.min(10, num($('#e-sets').value) || 0));
      const reps = num($('#e-reps').value);
      const kg = num($('#e-kg').value);
      const note = $('#e-note').value.trim();
      const pendingSets = $$('.ex', el).length ? collect() : {};
      busy(b, async () => {
        await updateDay(date, `Ekstra hareket: ${name} ${count}x${reps ?? '?'}${kg != null ? ` @${kg}kg` : ''}${note ? ` (${note})` : ''}`, (d) => {
          d.workout ||= { planId: null, title: 'Dinlenme günü', done: false, exercises: [] };
          for (const ex of d.workout.exercises) if (pendingSets[ex.id]) ex.sets = pendingSets[ex.id];
          d.workout.exercises.push({ id: uid(), name, source: 'extra', target: '', note, sets: Array.from({ length: count }, () => ({ kg, reps })) });
        });
        toast('Hareket eklendi');
        rerender();
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

function allExerciseNames() {
  return [...new Set(Object.values(S.plans.workout.workouts || {}).flatMap((w) => w.exercises.map((e) => e.name)))];
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
  setTop(`<button class="icon" data-href="#/takvim/${prev}/${mode}">‹</button>
    <div class="title"><b>${label}</b></div>
    <button class="icon" data-act="refresh">⟳</button>
    <button class="icon" data-href="#/takvim/${next}/${mode}">›</button>`);
  view().innerHTML = '<div class="loading">Yükleniyor…</div>';
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
    cells += `<a class="c ${cls} ${d === today ? 'today' : ''} ${future ? 'future' : ''}" href="#/gun/${d}/${mode === 'yemek' ? 'beslenme' : 'antrenman'}">
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
    <div class="seg">
      <button class="${mode === 'yemek' ? 'on' : ''}" data-href="#/takvim/${ym}/yemek">🍽 Yemek</button>
      <button class="${mode === 'spor' ? 'on' : ''}" data-href="#/takvim/${ym}/spor">🏋️ Spor</button>
    </div>
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
      <div class="stat"><div class="k">Ort. kalori</div><div class="v">${avg('kcal')}</div></div>
      <div class="stat"><div class="k">Ort. protein</div><div class="v">${avg('p')} g</div></div>
      <div class="stat"><div class="k">Kayıtlı gün</div><div class="v">${logged.length}</div></div>
      <div class="stat"><div class="k">Plan dışı öğün</div><div class="v">${days.reduce((a, d) => a + (d.extraMeals || 0), 0)}</div></div></div>`;
  }
  const done = days.filter((d) => d.workout?.done).length;
  return `<div class="stats" style="margin-top:12px">
    <div class="stat"><div class="k">Yapılan antrenman</div><div class="v">${done}</div></div>
    <div class="stat"><div class="k">Toplam set</div><div class="v">${days.reduce((a, d) => a + (d.workout?.sets || 0), 0)}</div></div></div>`;
}

// ---------- İlerleme ----------
async function viewProgress() {
  setTop('<h1>İlerleme</h1><button class="icon" data-act="refresh">⟳</button>');
  view().innerHTML = '<div class="loading">Yükleniyor…</div>';
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
    <div class="stats">
      <div class="stat"><div class="k">7 günlük ortalama</div><div class="v">${tr?.avg7 ?? '—'} <small>kg</small></div></div>
      <div class="stat"><div class="k">Haftalık değişim</div><div class="v ${cls(tr?.weeklyChange)}">${sign(tr?.weeklyChange)} <small>kg</small></div></div>
      <div class="stat"><div class="k">Toplam</div><div class="v ${cls(tr?.totalChange)}">${sign(tr?.totalChange)} <small>kg</small></div></div>
      <div class="stat"><div class="k">Bel</div><div class="v">${waist.at(-1)?.v ?? '—'} <small>cm</small></div>
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
  const dots = pts.map((p) => `<circle cx="${x(p.date)}" cy="${y(p.w)}" r="2.5" fill="var(--muted)"/>`).join('');
  const lbl = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', timeZone: 'UTC' });
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kilo grafiği">${grid.join('')}${dots}
    <path d="${line}" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/>
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

// ---------- Yönlendirme ----------
let current = () => {};
function rerender() { current(); }

async function route() {
  const parts = location.hash.replace(/^#\/?/, '').split('/');
  const page = parts[0] || 'gun';
  $$('#tabs a').forEach((a) => a.classList.toggle('on', a.dataset.tab === page && (page !== 'gun' || !parts[1] || parts[1] === todayStr())));
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
  };
  current();
  window.scrollTo(0, 0);
}

document.addEventListener('click', (e) => {
  const h = e.target.closest('[data-href]');
  if (h) { location.hash = h.dataset.href; return; }
  if (e.target.closest('[data-act=refresh]')) {
    S.days = {}; S.summary = null; S.plans = null;
    rerender();
    toast('Yenilendi');
  }
});
window.addEventListener('hashchange', route);
route();
