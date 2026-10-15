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
    const r = indexedDB.open(DB_NAME, 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
      if (!db.objectStoreNames.contains('img')) db.createObjectStore('img'); // v2.0: 카드 사진 (id → Blob)
    };
    r.onsuccess = () => { const db = r.result; db.onversionchange = () => db.close(); res(db); };
    r.onerror = () => rej(r.error);
  });
  return dbp;
}
async function idbGet(k, store = 'kv') {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readonly').objectStore(store).get(k);
    t.onsuccess = () => res(t.result);
    t.onerror = () => rej(t.error);
  });
}
async function idbDel(k, store = 'kv') {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(k);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbKeys(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const t = db.transaction(store, 'readonly').objectStore(store).getAllKeys();
    t.onsuccess = () => res(t.result); t.onerror = () => rej(t.error);
  });
}
async function idbClear(store) {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite'); tx.objectStore(store).clear();
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
async function idbSet(k, v, store = 'kv') {
  const db = await openDB();
  return new Promise((res, rej) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(v, k);
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
  normalize();
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

// 폴더는 parentId로 여러 단계(하위 폴더)를 가질 수 있다. parentId 없음 = 최상위.
const pid = (f) => f.parentId || null;
const nextOrder = (list) => list.reduce((m, x) => Math.max(m, (x.order ?? 0) + 1), 0);
export const folderAlive = (fid) => {
  for (let f = S.folders[fid], k = 0; f && k < 50; f = S.folders[pid(f)], k++) { if (f.del) return false; if (!pid(f)) return true; }
  return false;
};
export const subfolders = (parentId = null) => Object.values(S.folders).filter((f) => alive(f) && pid(f) === (parentId || null) && folderAlive(f.id)).sort(byOrder);
export const folders = () => subfolders(null);
// 깊이 우선으로 모든 폴더 [{f, depth}]
export function folderTree(parentId = null, depth = 0, out = []) {
  for (const f of subfolders(parentId)) { out.push({ f, depth }); folderTree(f.id, depth + 1, out); }
  return out;
}
export const folderPath = (fid) => { const out = []; for (let f = S.folders[fid], k = 0; f && k < 50; f = S.folders[pid(f)], k++) out.unshift(f); return out; };
export const folderPathLabel = (fid, sep = ' › ') => folderPath(fid).map((f) => f.name).join(sep);
export const isDescendant = (fid, ancestorId) => folderPath(fid).some((f) => f.id === ancestorId);
export const setsOf = (fid) => Object.values(S.sets).filter((s) => alive(s) && s.folderId === fid).sort(byOrder);
// 폴더와 그 하위 폴더 전체의 단원 (화면 순서대로)
export function setsUnder(fid) {
  const out = [...setsOf(fid)];
  for (const sf of subfolders(fid)) out.push(...setsUnder(sf.id));
  return out;
}
export const orderedSets = () => folderTree().flatMap(({ f }) => setsOf(f.id));
export const cardsOf = (sid) => Object.values(S.cards).filter((c) => alive(c) && c.setId === sid).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
export const allCards = () => Object.values(S.cards).filter((c) => alive(c) && alive(S.sets[c.setId]) && folderAlive(S.sets[c.setId].folderId));
export const cardsIn = (setIds) => { const ids = new Set(setIds); return allCards().filter((c) => ids.has(c.setId)); };
export const folderOfSet = (sid) => S.folders[S.sets[sid]?.folderId];
export const wrongCards = () => allCards().filter((c) => c.p && c.p.wrong);

// ---------- 변경 ----------
export function addFolder(name, parentId = null) {
  const id = uid();
  S.folders[id] = { id, name: name.trim(), parentId: parentId || null, order: nextOrder(subfolders(parentId)), u: now() };
  save(); return S.folders[id];
}
// 폴더를 다른 폴더 안으로(또는 최상위로) 옮기기. 자기 자신/자기 하위로는 불가.
export function moveFolder(fid, newParentId) {
  const f = S.folders[fid]; if (!f) return false;
  if (newParentId && (newParentId === fid || isDescendant(newParentId, fid))) return false;
  f.order = nextOrder(subfolders(newParentId).filter((x) => x.id !== fid)); f.parentId = newParentId || null; f.u = now();
  save(); return true;
}
export function addSet(folderId, name) {
  const id = uid();
  S.sets[id] = { id, folderId, name: name.trim(), order: nextOrder(setsOf(folderId)), u: now() };
  save(); return S.sets[id];
}
// v2.3: 여러 단원을 한꺼번에 다른 폴더로
export function moveSets(ids, folderId) {
  if (!S.folders[folderId]) return 0;
  let order = nextOrder(setsOf(folderId)), n = 0; const t = now();
  for (const id of ids) {
    const s = S.sets[id]; if (!s || s.del || s.folderId === folderId) continue;
    s.folderId = folderId; s.order = order++; s.u = t; n++;
  }
  save(); return n;
}
export function rename(kind, id, name) {
  const o = (kind === 'folder' ? S.folders : S.sets)[id];
  if (!o) return; o.name = name.trim(); o.u = now(); save();
}
export function moveOrder(kind, id, dir) {
  const list = kind === 'folder' ? subfolders(pid(S.folders[id])) : setsOf(S.sets[id].folderId);
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
  for (const sf of subfolders(id)) deleteFolder(sf.id);
  for (const s of setsOf(id)) deleteSet(s.id);
  const f = S.folders[id];
  S.folders[id] = { id, name: f?.name, parentId: f ? pid(f) : null, del: true, u: t };
  save();
}
function tombCard(id, t = now()) {
  const c = S.cards[id];
  S.cards[id] = { id, setId: c?.setId, del: true, cu: t, pu: t };
}
export function deleteCard(id) { tombCard(id); save(); }

export function newCard(setId, term, def, order, extra = null) {
  const id = uid(); const t = now();
  S.cards[id] = { id, setId, term, def, rating: null, imgs: [], order: order ?? cardsOf(setId).length, cu: t, p: blankProgress(), pu: t };
  if (extra) applyKind(S.cards[id], extra);
  return S.cards[id];
}
// v2.1 카드 형식: kind 'question'(choices, answer) / 'cloze'. 기본 카드는 kind 없음.
export function applyKind(c, x) {
  const k = x.kind === 'question' || x.kind === 'cloze' ? x.kind : null;
  if (!k) { delete c.kind; delete c.choices; delete c.answer; delete c.answers; delete c.wrong; delete c.group; return c; }
  c.kind = k;
  const strs = (a) => (Array.isArray(a) ? a : []).map((v) => String(v ?? '').trim());
  if (k === 'question' && Array.isArray(x.answers)) {
    // v2.2 정답 돌려쓰기
    c.answers = strs(x.answers).filter(Boolean); c.wrong = strs(x.wrong).filter(Boolean);
    if (x.group) c.group = String(x.group).trim(); else delete c.group;
    delete c.choices; delete c.answer;
  } else if (k === 'question') {
    c.choices = strs(x.choices);
    c.answer = Math.max(1, Math.min(Math.max(1, c.choices.length), parseInt(x.answer, 10) || 1));
    delete c.answers; delete c.wrong; delete c.group;
  } else { delete c.choices; delete c.answer; delete c.answers; delete c.wrong; delete c.group; }
  return c;
}
export const blankProgress = () => ({ fsrs: null, ok: 0, ng: 0, wrong: false, streak: 0, last: 0 });

export function updateCardContent(id, patch) {
  const c = S.cards[id]; if (!c) return;
  Object.assign(c, patch); c.cu = now(); save();
}
// ---------- 별점 (v2.0) ----------
// rating: null(없음) 또는 0~5. 카드에 없으면 단원 → 폴더(상위로) 순서로 물려받는다.
export function normalize() {
  for (const c of Object.values(S.cards)) {
    if (c.del) continue;
    if (c.star === true && (c.rating === undefined || c.rating === null)) c.rating = 5; // v1 별표 → 별 5개
    if ('star' in c) delete c.star;
    if (c.rating === undefined) c.rating = null;
    if (!Array.isArray(c.imgs)) c.imgs = [];
    if (c.kind === 'question' && Array.isArray(c.answers)) { if (!Array.isArray(c.wrong)) c.wrong = []; }
    else if (c.kind === 'question') { if (!Array.isArray(c.choices)) c.choices = []; c.answer = parseInt(c.answer, 10) || 1; }
  }
}
export function setRating(kind, id, val) {
  const v = val === null || val === '' || val === undefined ? null : Math.max(0, Math.min(5, +val));
  if (kind === 'card') return updateCardContent(id, { rating: v });
  const o = (kind === 'folder' ? S.folders : S.sets)[id]; if (!o) return;
  o.rating = v; o.u = now(); save();
}
export function inheritedRating(setId) {
  const s = S.sets[setId]; if (!s) return null;
  if (s.rating !== undefined && s.rating !== null) return { v: s.rating, from: 'set', name: s.name };
  for (const f of folderPath(s.folderId).reverse()) if (f.rating !== undefined && f.rating !== null) return { v: f.rating, from: 'folder', name: f.name };
  return null;
}
export function folderInherited(fid) {
  const path = folderPath(fid); path.pop();
  for (const f of path.reverse()) if (f.rating !== undefined && f.rating !== null) return { v: f.rating, from: 'folder', name: f.name };
  return null;
}
// 카드의 실제 별점: { v: 0~5 | null, inherited: bool }
export function effRating(c) {
  if (c.rating !== undefined && c.rating !== null) return { v: c.rating, inherited: false };
  const r = inheritedRating(c.setId);
  return r ? { v: r.v, inherited: true, from: r.name } : { v: null, inherited: false };
}
// allowed: Set of 0..5 and 'none'. 비어 있거나 null이면 전체 통과
export function ratingOk(c, allowed) {
  if (!allowed || !allowed.size) return true;
  const v = effRating(c).v;
  return allowed.has(v === null ? 'none' : v);
}

// ---------- 사진 (v2.0) ----------
// 사진은 상태 JSON과 분리해 IndexedDB 'img' 저장소에 Blob으로 보관. 카드에는 id 목록(imgs)만.
const urlCache = new Map();
export async function putImage(blob, id = 'i' + uid()) { await idbSet(id, blob, 'img'); return id; }
export async function imageURL(id) {
  if (urlCache.has(id)) return urlCache.get(id);
  const b = await idbGet(id, 'img').catch(() => null);
  if (!b) return null;
  const u = URL.createObjectURL(b); urlCache.set(id, u); return u;
}
export async function removeImageIfUnused(id) {
  const used = Object.values(S.cards).some((c) => !c.del && (c.imgs || []).includes(id));
  if (used) return;
  try { await idbDel(id, 'img'); } catch (_) {}
  if (urlCache.has(id)) { URL.revokeObjectURL(urlCache.get(id)); urlCache.delete(id); }
}
const blobToDataURL = (b) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(b); });
const dataURLToBlob = async (d) => (await fetch(d)).blob();
async function storeDataURL(id, d) { try { await putImage(await dataURLToBlob(d), id); return true; } catch (_) { return false; } }
// v2.2 정답 돌려쓰기: 어떤 정답이 몇 번 나왔고(seen) 몇 번 맞혔는지(hits)
export function noteRot(c, ans, ok) {
  if (!c || !ans) return;
  if (!c.p) c.p = blankProgress();
  c.p.seen = c.p.seen || {}; c.p.hits = c.p.hits || {};
  c.p.seen[ans] = (c.p.seen[ans] || 0) + 1;
  if (ok) c.p.hits[ans] = (c.p.hits[ans] || 0) + 1;
  touchProgress(c);
}
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
  for (const [cid, good, ans] of items) {
    const c = S.cards[cid]; if (!c || c.del) continue;
    if (!c.p) c.p = blankProgress();
    if (good) {
      ok++; c.p.ok++;
      if (c.p.wrong) { c.p.streak++; if (c.p.streak >= grad) { c.p.wrong = false; c.p.streak = 0; delete c.p.miss; } }
    } else {
      c.p.ng++; c.p.wrong = true; c.p.streak = 0;
      if (ans) { c.p.miss = c.p.miss || {}; c.p.miss[ans] = (c.p.miss[ans] || 0) + 1; } // 돌려쓰기 카드: 틀린 정답 처방
    }
    c.p.last = now(); c.pu = now();
  }
  const id = uid();
  S.history[id] = { id, at: now(), scope: scopeLabel, total: items.length, ok, items };
  bumpDay('t', items.length);
  save();
  return S.history[id];
}

// ---------- 백업 / 병합 ----------
export async function exportBackup() {
  const strip = (o) => o;
  const images = {};
  const ids = new Set(Object.values(S.cards).filter((c) => !c.del).flatMap((c) => c.imgs || []));
  for (const id of ids) {
    const b = await idbGet(id, 'img').catch(() => null);
    if (b) images[id] = await blobToDataURL(b);
  }
  return {
    type: APP_TYPE_BACKUP, version: 2, exportedAt: new Date().toISOString(), images,
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
  if (data && (data.type === APP_TYPE_PACK || Array.isArray(data.cards) && data.cards.every((c) => ('term' in c || 'stem' in c || 'text' in c) && ('set' in c || 'folder' in c)))) return { kind: 'pack', data };
  throw new Error('이 앱의 백업 파일이나 카드팩 형식이 아닙니다.');
}

// 백업 병합: 같은 id면 더 최근 것이 이김. 새 id는 추가. 삭제 표시도 전파.
export async function mergeBackup(d) {
  const r = { folders: 0, sets: 0, cards: 0, progress: 0, history: 0, images: 0 };
  if (d.images) {
    let have = new Set(); try { have = new Set(await idbKeys('img')); } catch (_) {}
    for (const [id, data] of Object.entries(d.images)) if (!have.has(id) && await storeDataURL(id, data)) r.images++;
  }
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
  normalize();
  await save(true);
  return r;
}

// 카드팩: 과목/단원 이름으로 찾아서(없으면 만들고) 카드 추가. 같은 단원에 완전히 같은 카드는 건너뜀.
const splitPath = (p) => String(p || '미분류').split(/\s*[>›]\s*/).map((x) => x.trim()).filter(Boolean);
// 경로로 폴더 찾기. 이름 하나만 주어졌고 최상위에 없으면, 어디에 있든 같은 이름의 폴더가 하나뿐일 때 그것을 사용.
function findFolderPath(names) {
  let parent = null, f = null;
  for (const n of names) { f = subfolders(parent).find((x) => x.name === n); if (!f) break; parent = f.id; }
  if (f) return f;
  if (names.length === 1) {
    const hits = folderTree().map((x) => x.f).filter((x) => x.name === names[0]);
    if (hits.length === 1) return hits[0];
  }
  return null;
}
function ensureFolderPath(names, baseId = null) {
  if (baseId && S.folders[baseId]) {
    // v2.3: 고른 폴더 안에 카드팩 폴더 구조째로
    let parent = baseId, f = S.folders[baseId];
    for (const n of names) { f = subfolders(parent).find((x) => x.name === n) || addFolder(n, parent); parent = f.id; }
    return f;
  }
  const found = findFolderPath(names); if (found) return found;
  let parent = null, f = null;
  for (const n of names) { f = subfolders(parent).find((x) => x.name === n) || addFolder(n, parent); parent = f.id; }
  return f;
}
const CIRC_NO = '①②③④⑤⑥⑦⑧⑨⑩';
const packAnswer = (a) => { const s = String(a ?? '').trim(); const k = CIRC_NO.indexOf(s[0]); return k >= 0 ? k + 1 : parseInt(s, 10) || 1; };
// v2.3 넣을 곳: target = null(카드팩대로) | { id, keep } — keep=false면 고른 폴더에 단원만, true면 고른 폴더 안에 카드팩 폴더째로
function targetFolder(names, target, create) {
  if (target && target.id && S.folders[target.id]) {
    if (!target.keep) return S.folders[target.id];
    if (create) return ensureFolderPath(names, target.id);
    let parent = target.id, f = S.folders[target.id];
    for (const n of names) { f = subfolders(parent).find((x) => x.name === n); if (!f) return null; parent = f.id; }
    return f;
  }
  return create ? ensureFolderPath(names) : findFolderPath(names);
}
export function previewPack(d, target = null) {
  const rows = (d.cards || []).map((c) => {
    const kind = c.kind === 'question' || c.kind === 'q' ? 'question' : c.kind === 'cloze' ? 'cloze' : 'basic';
    const r = {
      folder: splitPath(c.folder).join(' › '), set: String(c.set || '기본').trim(), kind,
      term: String((kind === 'question' ? c.stem ?? c.term : kind === 'cloze' ? c.text ?? c.term : c.term) ?? '').trim(),
      def: String((kind === 'question' ? c.explain ?? c.def : kind === 'cloze' ? c.note ?? c.def : c.def) ?? '').trim(),
      rating: c.rating !== undefined && c.rating !== null && c.rating !== '' ? Math.max(0, Math.min(5, +c.rating)) : (c.star ? 5 : null),
      imgs: kind === 'cloze' ? [] : Array.isArray(c.imgs) ? c.imgs.filter((x) => typeof x === 'string' && x.startsWith('data:image')) : [],
    };
    const strip = (a) => (Array.isArray(a) ? a : []).map((x) => String(x ?? '').replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').trim()).filter(Boolean);
    if (kind === 'question' && Array.isArray(c.answers) && strip(c.answers).length) { r.answers = strip(c.answers); r.wrong = strip(c.wrong); if (c.group) r.group = String(c.group); }
    else if (kind === 'question') { r.choices = (Array.isArray(c.choices) ? c.choices : []).map((x) => String(x ?? '').replace(/^\s*[①②③④⑤⑥⑦⑧⑨⑩]\s*/, '').trim()); r.answer = packAnswer(c.answer); }
    return r;
  }).filter((c) => (c.kind === 'question' ? c.term && (c.answers ? c.wrong.length >= 1 : c.choices.length >= 2) : c.kind === 'cloze' ? /\{\{[\s\S]*?\}\}/.test(c.term) : c.term || c.def || c.imgs.length));
  return rows.map((c) => {
    const f = targetFolder(splitPath(c.folder), target, false);
    const s = f && setsOf(f.id).find((x) => x.name === c.set);
    const dup = s && cardsOf(s.id).some((x) => x.term === c.term && x.def === c.def);
    const label = f ? folderPathLabel(f.id) : target && target.id ? [folderPathLabel(target.id), ...splitPath(c.folder)].join(' › ') : c.folder;
    return { ...c, src: c.src || c.folder, folder: label, newFolder: !f, newSet: !s, dup: !!dup };
  });
}
export async function applyPack(rows, target = null) {
  let added = 0, skipped = 0;
  for (const c of rows) {
    if (c.dup || c.skip) { skipped++; continue; }
    const f = targetFolder(splitPath(c.src || c.folder), target, true);
    const s = setsOf(f.id).find((x) => x.name === c.set) || addSet(f.id, c.set);
    if (cardsOf(s.id).some((x) => x.term === c.term && x.def === c.def)) { skipped++; continue; }
    const card = newCard(s.id, c.term, c.def, undefined, c.kind !== 'basic' ? c : null); if (c.rating !== null && c.rating !== undefined) card.rating = c.rating;
    for (const d of c.imgs || []) { const id = 'i' + uid(); if (await storeDataURL(id, d)) card.imgs.push(id); }
    added++;
  }
  await save(true);
  return { added, skipped };
}

export async function resetAll() {
  const keep = S.local.deviceId; S = emptyState(); S.local.deviceId = keep;
  try { await idbClear('img'); } catch (_) {}
  urlCache.forEach((u) => URL.revokeObjectURL(u)); urlCache.clear();
  await save(true);
}
