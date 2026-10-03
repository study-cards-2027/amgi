// 데이터 저장소: 기기 안(IndexedDB)에만 저장. 백업 파일로 기기 간 이동/병합.
// 카드 내용(cu)과 학습 기록(pu)을 따로 시간표시해서, 병합할 때 각각 최신 것을 고른다.

export const APP_TYPE_BACKUP = 'amgi-backup';
export const APP_TYPE_PACK = 'amgi-cardpack';
const DB_NAME = 'amgi';
const KEY = 'state';

export const now = () => Date.now();
export const uid = () =>
  (Date.now().toString(36) + Math.random().toString(36).slice(2, 8));
export const today = (d = new Date()) => {
  const z = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};

function emptyState() {
  return {
    folders: {}, sets: {}, cards: {}, history: {}, days: {},
    settings: { examDate: '', newPerDay: 20, gradStreak: 2, u: 0 },
    local: { deviceId: uid(), lastExport: 0, newIntro: { date: '', n: 0 }, matchBest: {} },
  };
}

export let S = emptyState();

// ---------- IndexedDB ----------
let dbp = null;
function openDB() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore('kv');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idbGet(k) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction('kv', 'readonly').objectStore('kv').get(k);
    t.onsuccess = () => res(t.result);
    t.onerror = () => rej(t.error);
  });
}
async function idbSet(k, v) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function load() {
  let data = null, ls = null;
  try { data = await idbGet(KEY); } catch (e) { console.error('load failed', e); }
  try { ls = JSON.parse(localStorage.getItem('amgi-' + KEY) || 'null'); } catch (_) {}
  // 창을 닫는 순간 저장된 비상용 사본이 더 최신이면 그것을 사용
  if (ls && (!data || (ls.local?.savedAt || 0) > (data.local?.savedAt || 0))) data = ls;
  const base = emptyState();
  if (data) {
    S = { ...base, ...data, settings: { ...base.settings, ...(data.settings || {}) },
          local: { ...base.local, ...(data.local || {}) } };
  } else S = base;
  try { if (navigator.storage && navigator.storage.persist) await navigator.storage.persist(); } catch (_) {}
  return S;
}

// 변경 후 최대 0.3초 안에 저장 (연속 변경이 있어도 미뤄지지 않음)
let saveTimer = null;
async function writeIDB() {
  saveTimer = null;
  S.local.savedAt = now();
  try { await idbSet(KEY, S); }
  catch (e) { console.error('save failed', e && e.name, e && e.message); emergencyCopy(); }
}
function emergencyCopy() {
  try { S.local.savedAt = now(); localStorage.setItem('amgi-' + KEY, JSON.stringify(S)); } catch (_) {}
}
export function save(immediate = false) {
  if (immediate) { clearTimeout(saveTimer); return writeIDB(); }
  if (!saveTimer) saveTimer = setTimeout(writeIDB, 300);
}
function onHide() { if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; } emergencyCopy(); writeIDB(); }
document.addEventListener('visibilitychange', () => { if (document.hidden) onHide(); });
window.addEventListener('pagehide', onHide);

export async function storagePersisted() {
  try { return navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted() : false; }
  catch (_) { return false; }
}

// ---------- 조회 ----------
const alive = (o) => o && !o.del;
const byOrder = (a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.name || '').localeCompare(b.name || '', 'ko', { numeric: true });

export const folders = () => Object.values(S.folders).filter(alive).sort(byOrder);
export const setsOf = (fid) => Object.values(S.sets).filter((s) => alive(s) && s.folderId === fid).sort(byOrder);
export const cardsOf = (sid) => Object.values(S.cards).filter((c) => alive(c) && c.setId === sid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const allCards = () => Object.values(S.cards).filter((c) => alive(c) && alive(S.sets[c.setId]) && alive(S.folders[S.sets[c.setId].folderId]));
export const cardsIn = (setIds) => { const ids = new Set(setIds); return allCards().filter((c) => ids.has(c.setId)); };
export const folderOfSet = (sid) => S.folders[S.sets[sid]?.folderId];
export const wrongCards = () => allCards().filter((c) => c.p && c.p.wrong);

// ---------- 변경 ----------
export function addFolder(name) {
  const id = uid();
  S.folders[id] = { id, name: name.trim(), order: folders().length, u: now() };
  save(); return S.folders[id];
}
export function addSet(folderId, name) {
  const id = uid();
  S.sets[id] = { id, folderId, name: name.trim(), order: setsOf(folderId).length, u: now() };
  save(); return S.sets[id];
}
export function rename(kind, id, name) {
  const o = (kind === 'folder' ? S.folders : S.sets)[id];
  if (!o) return; o.name = name.trim(); o.u = now(); save();
}
export function moveOrder(kind, id, dir) {
  const list = kind === 'folder' ? folders() : setsOf(S.sets[id].folderId);
  const i = list.findIndex((x) => x.id === id); const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  const t = now(); list.forEach((x, k) => { if (x.order !== k) { x.order = k; x.u = t; } });
  save();
}
export function deleteSet(id) {
  const t = now();
  const s = S.sets[id]; if (!s) return;
  S.sets[id] = { id, folderId: s.folderId, name: s.name, del: true, u: t };
  for (const c of Object.values(S.cards)) if (c.setId === id && !c.del) tombCard(c.id, t);
  save();
}
export function deleteFolder(id) {
  const t = now();
  for (const s of setsOf(id)) deleteSet(s.id);
  S.folders[id] = { id, name: S.folders[id]?.name, del: true, u: t };
  save();
}
function tombCard(id, t = now()) {
  const c = S.cards[id];
  S.cards[id] = { id, setId: c?.setId, del: true, cu: t, pu: t };
}
export function deleteCard(id) { tombCard(id); save(); }

export function newCard(setId, term, def, order) {
  const id = uid(); const t = now();
  S.cards[id] = { id, setId, term, def, star: false, order: order ?? cardsOf(setId).length, cu: t, p: blankProgress(), pu: t };
  return S.cards[id];
}
export const blankProgress = () => ({ fsrs: null, ok: 0, ng: 0, wrong: false, streak: 0, last: 0 });

export function updateCardContent(id, patch) {
  const c = S.cards[id]; if (!c) return;
  Object.assign(c, patch); c.cu = now(); save();
}
export function toggleStar(id) { const c = S.cards[id]; updateCardContent(id, { star: !c.star }); }
export function touchProgress(c) { c.pu = now(); if (!c.p) c.p = blankProgress(); save(); }

// 세트 전체 편집 저장 (편집기에서) rows: [{id?, term, def}]
export function saveSetCards(setId, rows) {
  const keep = new Set();
  rows.forEach((r, i) => {
    const term = (r.term || '').trim(), def = (r.def || '').trim();
    if (!term && !def) return;
    if (r.id && S.cards[r.id] && !S.cards[r.id].del) {
      const c = S.cards[r.id]; keep.add(c.id);
      if (c.term !== term || c.def !== def || c.order !== i || c.setId !== setId) {
        c.term = term; c.def = def; c.order = i; c.setId = setId; c.cu = now();
      }
    } else {
      const c = newCard(setId, term, def, i); keep.add(c.id);
    }
  });
  for (const c of cardsOf(setId)) if (!keep.has(c.id)) tombCard(c.id);
  save();
}

export function bumpDay(field, n = 1) {
  const d = today();
  S.days[d] = S.days[d] || { r: 0, t: 0, f: 0 };
  S.days[d][field] = (S.days[d][field] || 0) + n;
  save();
}

export function setSettings(patch) { Object.assign(S.settings, patch); S.settings.u = now(); save(); }

// 테스트 결과 반영 + 오답노트 갱신
export function recordTest(items, scopeLabel) {
  const grad = Math.max(1, +S.settings.gradStreak || 2);
  let ok = 0;
  for (const [cid, good] of items) {
    const c = S.cards[cid]; if (!c || c.del) continue;
    if (!c.p) c.p = blankProgress();
    if (good) {
      ok++; c.p.ok++;
      if (c.p.wrong) { c.p.streak++; if (c.p.streak >= grad) { c.p.wrong = false; c.p.streak = 0; } }
    } else { c.p.ng++; c.p.wrong = true; c.p.streak = 0; }
    c.p.last = now(); c.pu = now();
  }
  const id = uid();
  S.history[id] = { id, at: now(), scope: scopeLabel, total: items.length, ok, items };
  bumpDay('t', items.length);
  save();
  return S.history[id];
}

// ---------- 백업 / 병합 ----------
export function exportBackup() {
  const strip = (o) => o;
  return {
    type: APP_TYPE_BACKUP, version: 1, exportedAt: new Date().toISOString(),
    note: '한의 암기노트 백업 파일. 카드 내용 수정 시 cu 값을 현재 시각(ms)으로 올릴 것.',
    folders: Object.values(S.folders).map(strip),
    sets: Object.values(S.sets).map(strip),
    cards: Object.values(S.cards).map(strip),
    history: Object.values(S.history),
    days: S.days,
    settings: S.settings,
  };
}
export function markExported() { S.local.lastExport = now(); save(); }

export function parseImport(text) {
  let data;
  try { data = JSON.parse(text.replace(/^﻿/, '')); }
  catch (e) { throw new Error('파일을 읽을 수 없습니다. 백업(.json) 또는 카드팩 파일인지 확인해 주세요.'); }
  if (data && data.type === APP_TYPE_BACKUP) return { kind: 'backup', data };
  if (data && (data.type === APP_TYPE_PACK || Array.isArray(data.cards) && data.cards.every((c) => 'term' in c && ('set' in c || 'folder' in c)))) return { kind: 'pack', data };
  throw new Error('이 앱의 백업 파일이나 카드팩 형식이 아닙니다.');
}

// 백업 병합: 같은 id면 더 최근 것이 이김. 새 id는 추가. 삭제 표시도 전파.
export function mergeBackup(d) {
  const r = { folders: 0, sets: 0, cards: 0, progress: 0, history: 0 };
  const take = (coll, arr, key) => {
    for (const o of arr || []) {
      if (!o || !o.id) continue;
      const cur = coll[o.id];
      if (!cur || (o.u || 0) > (cur.u || 0)) { coll[o.id] = { ...o }; r[key]++; }
    }
  };
  take(S.folders, d.folders, 'folders');
  take(S.sets, d.sets, 'sets');
  for (const o of d.cards || []) {
    if (!o || !o.id) continue;
    const cur = S.cards[o.id];
    if (!cur) { S.cards[o.id] = { ...o, p: o.p || blankProgress(), cu: o.cu || now(), pu: o.pu || 0 }; r.cards++; continue; }
    if ((o.cu || 0) > (cur.cu || 0)) {
      const { p, pu, ...content } = o;
      for (const k of Object.keys(cur)) if (!['p', 'pu', 'id'].includes(k) && !(k in content)) delete cur[k];
      Object.assign(cur, content); r.cards++;
      if (o.del) { cur.del = true; }
    }
    if (!cur.del && o.p && (o.pu || 0) > (cur.pu || 0)) { cur.p = { ...o.p }; cur.pu = o.pu; r.progress++; }
    if (!cur.del && !cur.p) cur.p = o.p ? { ...o.p } : blankProgress();
  }
  for (const h of d.history || []) if (h && h.id && !S.history[h.id]) { S.history[h.id] = h; r.history++; }
  for (const [day, v] of Object.entries(d.days || {})) {
    const cur = S.days[day] || {};
    S.days[day] = { r: Math.max(cur.r || 0, v.r || 0), t: Math.max(cur.t || 0, v.t || 0), f: Math.max(cur.f || 0, v.f || 0) };
  }
  if (d.settings && (d.settings.u || 0) > (S.settings.u || 0)) S.settings = { ...S.settings, ...d.settings };
  save(true);
  return r;
}

// 카드팩: 과목/단원 이름으로 찾아서(없으면 만들고) 카드 추가. 같은 단원에 완전히 같은 카드는 건너뜀.
export function previewPack(d) {
  const rows = (d.cards || []).map((c) => ({
    folder: String(c.folder || '미분류').trim(), set: String(c.set || '기본').trim(),
    term: String(c.term ?? '').trim(), def: String(c.def ?? '').trim(),
  })).filter((c) => c.term || c.def);
  return rows.map((c) => {
    const f = folders().find((x) => x.name === c.folder);
    const s = f && setsOf(f.id).find((x) => x.name === c.set);
    const dup = s && cardsOf(s.id).some((x) => x.term === c.term && x.def === c.def);
    return { ...c, newFolder: !f, newSet: !s, dup: !!dup };
  });
}
export function applyPack(rows) {
  let added = 0, skipped = 0;
  for (const c of rows) {
    if (c.dup || c.skip) { skipped++; continue; }
    let f = folders().find((x) => x.name === c.folder) || addFolder(c.folder);
    let s = setsOf(f.id).find((x) => x.name === c.set) || addSet(f.id, c.set);
    if (cardsOf(s.id).some((x) => x.term === c.term && x.def === c.def)) { skipped++; continue; }
    newCard(s.id, c.term, c.def); added++;
  }
  save(true);
  return { added, skipped };
}

export function resetAll() { const keep = S.local.deviceId; S = emptyState(); S.local.deviceId = keep; save(true); }
