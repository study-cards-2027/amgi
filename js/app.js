import * as st from './store.js';
import * as study from './study.js';
import { $, $$, esc, I, toast, ask, confirmBox, modal, menu, fmtDate, autoGrow, download, readFile, starsHTML, pickRating } from './ui.js';
import { photoBlock, hydrate, fileToStoredImage, openViewer } from './media.js';
import { kindOf, listHTML, clozeAnswers, qChoices, qAnswer, circ, plainA, plainB, KIND_LABEL, isRot, rotAnswers } from './kinds.js';

const view = () => $('#view');
const go = (h) => { if (location.hash === h) route(); else location.hash = h; };
let leaveHook = null; // 편집기 등에서 화면을 떠날 때 저장

// ================================================================ 라우터
function parseHash() {
  const raw = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  return { parts, q };
}
function route() {
  if (leaveHook) { try { leaveHook(); } catch (_) {} leaveHook = null; }
  document.onkeydown = null;
  const { parts, q } = parseHash();
  const [a, b] = parts;
  const studying = a === 'play' || a === 'result';
  $('#shell').classList.toggle('study-mode', studying);
  const navKey = { undefined: 'home', f: 'home', s: 'home', edit: 'home', import: 'home', study: 'study', wrong: 'wrong', stats: 'stats', settings: 'settings' }[a] || 'home';
  $$('#nav a').forEach((x) => x.classList.toggle('on', x.dataset.k === navKey));
  window.scrollTo(0, 0);
  if (!a) return home();
  if (a === 'f') return folderView(b);
  if (a === 's') return setView(b, q);
  if (a === 'edit') return editor(b, q);
  if (a === 'import') return importView(q);
  if (a === 'study') return picker(q);
  if (a === 'play') return study.render();
  if (a === 'result') return study.renderResult(b);
  if (a === 'wrong') return wrongView();
  if (a === 'stats') return statsView();
  if (a === 'settings') return settingsView();
  home();
}
window.addEventListener('hashchange', route);

// ================================================================ 도우미
function dday() {
  const d = st.S.settings.examDate; if (!d) return null;
  const t = new Date(d + 'T00:00:00'); const n = new Date(); n.setHours(0, 0, 0, 0);
  const diff = Math.round((t - n) / 86400000);
  return diff > 0 ? `D-${diff}` : diff === 0 ? 'D-DAY' : `D+${-diff}`;
}
function acc(cards) {
  let ok = 0, ng = 0; for (const c of cards) { ok += c.p?.ok || 0; ng += c.p?.ng || 0; }
  return { ok, ng, n: ok + ng, pct: ok + ng ? Math.round((ok / (ok + ng)) * 100) : null };
}
export function scopeLabel(setIds) {
  const sel = new Set(setIds);
  const parts = [];
  const walk = (fid) => {
    const under = st.setsUnder(fid);
    const k = under.filter((x) => sel.has(x.id)).length;
    if (!k) return;
    if (k === under.length) { parts.push(`${st.S.folders[fid].name} 전체`); return; }
    const own = st.setsOf(fid).filter((x) => sel.has(x.id));
    if (own.length) parts.push(`${st.S.folders[fid].name} ${own.map((x) => x.name).join('·')}`);
    st.subfolders(fid).forEach((sf) => walk(sf.id));
  };
  st.folders().forEach((f) => walk(f.id));
  return parts.join(', ') || '선택 없음';
}
function crumbs(fid, last = false) {
  const path = st.folderPath(fid);
  return `<div class="crumb"><a href="#/">홈</a>${path.slice(0, last ? path.length : path.length - 1).map((f) => ` › <a href="#/f/${f.id}">${esc(f.name)}</a>`).join('')}</div>`;
}
function folderStats(fid) {
  const ss = st.setsUnder(fid); const cs = ss.flatMap((x) => st.cardsOf(x.id));
  return { subs: st.subfolders(fid).length, sets: ss.length, cards: cs.length, wrong: cs.filter((c) => c.p?.wrong).length, cs };
}
function folderTile(f) {
  const t = folderStats(f.id);
  return `<a class="tile" href="#/f/${f.id}"><div class="row"><span style="color:var(--primary);display:inline-flex;width:22px">${I.folder}</span><span class="t">${esc(f.name)}</span><span class="spacer"></span>${f.rating !== undefined && f.rating !== null ? starsHTML(f.rating) : ''}${t.wrong ? `<span class="pill ng">오답 ${t.wrong}</span>` : ''}</div>
    <div class="s">${t.subs ? `하위 폴더 ${t.subs}개 · ` : ''}단원 ${t.sets}개 · 카드 ${t.cards}장</div></a>`;
}
// 폴더 선택 창 (옮기기용). excludeId와 그 하위는 고를 수 없음.
function pickFolder(title, { excludeId = null, currentId, allowRoot = false } = {}) {
  const tree = st.folderTree().filter(({ f }) => !(excludeId && (f.id === excludeId || st.isDescendant(f.id, excludeId))));
  return modal(`<h3>${esc(title)}</h3><div class="list" style="gap:8px">
    ${allowRoot ? `<button class="btn block" data-f="__root" style="justify-content:flex-start" ${!currentId ? 'disabled' : ''}>🏠 홈 (최상위)</button>` : ''}
    ${tree.map(({ f, depth }) => `<button class="btn block" data-f="${f.id}" style="justify-content:flex-start;padding-left:${14 + depth * 22}px" ${f.id === currentId ? 'disabled' : ''}>${depth ? '└ ' : ''}${esc(f.name)}</button>`).join('')}
    </div><div class="row end"><button class="btn ghost" data-x>취소</button></div>`, (m, close) => {
    $$('[data-f]', m).forEach((b) => (b.onclick = () => close(b.dataset.f))); $('[data-x]', m).onclick = () => close(null);
  });
}
// 폴더·단원 별점: 안의 카드 중 자기 별점이 없는 카드가 이 별점을 물려받는다
function ratingNote(kind, o) {
  let inh = null;
  if (kind === 'folder') inh = st.folderInherited(o.id);
  else { const p = st.folderPath(o.folderId).reverse().find((x) => x.rating !== undefined && x.rating !== null); if (p) inh = { v: p.rating, name: p.name }; }
  return inh ? `물려받기: ${inh.name} ★${inh.v}` : '';
}
function ratingHeadBtn(kind, o) {
  const has = o.rating !== undefined && o.rating !== null;
  return `<button class="rate-btn" id="headRate" title="${kind === 'folder' ? '폴더' : '단원'} 별점">${has ? starsHTML(o.rating, false, 'lg') : '<span class="stars none">☆<small>별점</small></span>'}</button>`;
}
async function askHeadRating(kind, o) {
  const v = await pickRating(`${kind === 'folder' ? '폴더' : '단원'} 별점 — 안의 카드 중 별점이 없는 카드가 물려받아요`, o.rating ?? null, { inheritNote: ratingNote(kind, o) });
  if (v === undefined) return;
  st.setRating(kind, o.id, v); route();
}
function backupBanner() {
  const n = st.allCards().length; if (!n) return '';
  const last = st.S.local.lastExport;
  const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
  if (days !== null && days < 7) return '';
  return `<div class="banner warn">💾 <span>${days === null ? '아직 백업한 적이 없어요.' : `마지막 백업이 ${days}일 전이에요.`} 카드는 이 기기에만 저장되니 가끔 백업 파일을 저장해 두세요.</span><span class="spacer"></span><a class="btn sm" href="#/settings">백업하기</a></div>`;
}

// ================================================================ 홈
function home() {
  const fs = st.folders();
  const all = st.allCards();
  const rc = study.reviewCounts(all);
  const wrongN = st.wrongCards().length;
  const dd = dday();
  view().innerHTML = `
  <div class="topbar"><div><h1>한의 암기노트</h1><div class="muted">한의사 국가고시 대비</div></div></div>
  <div class="hero">
    ${dd ? `<a class="stat dday" href="#/settings"><div class="n">${dd}</div><div class="l">국가고시</div></a>` : `<a class="stat" href="#/settings"><div class="n" style="font-size:18px">시험일 설정</div><div class="l">D-day 표시</div></a>`}
    <a class="stat" href="#/study?mode=review&all=1"><div class="n">${rc.total}</div><div class="l">오늘 복습할 카드</div></a>
    <a class="stat" href="#/wrong"><div class="n" style="color:var(--ng)">${wrongN}</div><div class="l">오답노트</div></a>
    <a class="stat" href="#/stats"><div class="n">${all.length}</div><div class="l">전체 카드</div></a>
  </div>
  ${backupBanner()}
  <div class="row" style="margin-top:22px"><h2 style="margin:0">폴더</h2><span class="spacer"></span>
    <a class="btn sm" href="#/import">${I.import} 가져오기</a>
    <button class="btn sm primary" id="addF">${I.plus} 폴더</button></div>
  <div class="grid2" style="margin-top:12px">${fs.map(folderTile).join('')}</div>
  ${fs.length ? '' : `<div class="empty"><div class="big">📚</div><p>아직 폴더가 없어요.<br>「+ 폴더」로 상한론, 본초학 같은 과목 폴더를 만들어 보세요.</p></div>`}`;
  $('#addF').onclick = async () => { const n = await ask('새 폴더', '', '예: 상한론'); if (n) { const f = st.addFolder(n); go('#/f/' + f.id); } };
}

// ================================================================ 폴더 (하위 폴더 + 단원)
function folderView(fid) {
  const f = st.S.folders[fid]; if (!f || f.del || !st.folderAlive(fid)) return go('#/');
  const subs = st.subfolders(fid);
  const ss = st.setsOf(fid);
  const t = folderStats(fid);
  const parentHref = f.parentId ? `#/f/${f.parentId}` : '#/';
  view().innerHTML = `
  ${crumbs(fid)}
  <div class="topbar"><div><h1>${esc(f.name)}</h1><div class="muted">${t.subs ? `하위 폴더 ${t.subs}개 · ` : ''}단원 ${t.sets}개 · 카드 ${t.cards}장</div></div>
    <span class="spacer"></span>${ratingHeadBtn('folder', f)}<div><button class="icon-btn" id="more">${I.more}</button></div></div>
  <div class="row">
    ${t.cards ? `<a class="btn primary" href="#/study?mode=test&folder=${fid}">${I.test} 범위 골라 시험</a>
    <a class="btn" href="#/study?mode=flash&folder=${fid}">${I.cards} 낱말카드</a>` : ''}
    <button class="btn" id="addSub">${I.folder} 하위 폴더</button>
    <button class="btn" id="addS">${I.plus} 단원</button>
  </div>
  ${subs.length ? `<h2>폴더</h2><div class="grid2">${subs.map(folderTile).join('')}</div>` : ''}
  ${ss.length ? `${subs.length ? '<h2>단원</h2>' : ''}<div class="list" style="margin-top:${subs.length ? 0 : 16}px">
    ${ss.map((s) => { const cs = st.cardsOf(s.id); const a = acc(cs); const w = cs.filter((c) => c.p?.wrong).length;
      return `<a class="tile" href="#/s/${s.id}"><div class="row"><span class="t">${esc(s.name)}</span><span class="spacer"></span>${s.rating !== undefined && s.rating !== null ? starsHTML(s.rating) : ''}${w ? `<span class="pill ng">오답 ${w}</span>` : ''}${a.pct !== null ? `<span class="pill ${a.pct >= 80 ? 'ok' : ''}">정답률 ${a.pct}%</span>` : ''}</div>
      <div class="s">카드 ${cs.length}장</div></a>`; }).join('')}
  </div>` : ''}
  ${ss.length || subs.length ? '' : `<div class="empty"><div class="big">🗂️</div><p>「+ 단원」으로 1단원, 2단원 등을 만들거나<br>「하위 폴더」로 폴더를 한 단계 더 나눠 보세요.</p></div>`}`;
  $('#addS').onclick = async () => { const n = await ask('새 단원', '', `예: ${ss.length + 1}단원`); if (n) { const s = st.addSet(fid, n); go('#/s/' + s.id); } };
  $('#headRate').onclick = () => askHeadRating('folder', f);
  $('#addSub').onclick = async () => { const n = await ask(`'${f.name}' 안에 새 폴더`, '', '예: 상한 무조건법'); if (n) { const nf = st.addFolder(n, fid); go('#/f/' + nf.id); } };
  $('#more').onclick = (e) => menu(e.currentTarget, [
    { label: '폴더 이름 바꾸기', run: async () => { const n = await ask('폴더 이름', f.name); if (n) { st.rename('folder', fid, n); route(); } } },
    { label: '폴더 별점 매기기', run: () => askHeadRating('folder', f) },
    { label: '다른 폴더 안으로 옮기기', run: async () => {
      const to = await pickFolder(`'${f.name}'을(를) 어디로 옮길까요?`, { excludeId: fid, currentId: f.parentId || null, allowRoot: true });
      if (!to) return;
      st.moveFolder(fid, to === '__root' ? null : to); toast('옮겼어요'); route();
    } },
    { label: '새 상위 폴더로 묶기', run: async () => {
      const n = await ask(`'${f.name}'을(를) 담을 새 폴더 이름`, '', '예: 상한론', '만들기');
      if (!n) return;
      const parent = st.addFolder(n, f.parentId || null);
      parent.order = f.order ?? 0;
      st.moveFolder(fid, parent.id); toast(`'${n}' 폴더 안으로 넣었어요`); go('#/f/' + parent.id);
    } },
    { label: '여러 단원 한꺼번에 옮기기', run: () => moveManySets(fid) },
    { label: '위로 이동', run: () => { st.moveOrder('folder', fid, -1); toast('순서를 바꿨어요'); } },
    { label: '아래로 이동', run: () => { st.moveOrder('folder', fid, 1); toast('순서를 바꿨어요'); } },
    { label: '폴더 삭제', danger: true, run: async () => { if (await confirmBox(`'${f.name}' 폴더를 삭제할까요?`, `안의 하위 폴더, 단원, 카드 ${t.cards}장이 모두 삭제됩니다.`, '삭제', true)) { st.deleteFolder(fid); go(parentHref); } } },
  ]);
}

// ================================================================ 단원 (세트)
function setView(sid, q = {}) {
  const s = st.S.sets[sid]; if (!s || s.del) return go('#/');
  const f = st.S.folders[s.folderId];
  const filter = q.v === 'wrong' ? 'wrong' : 'all';
  const rf = q.r ?? '';
  const all = st.cardsOf(sid);
  let cs = filter === 'wrong' ? all.filter((c) => c.p?.wrong) : all;
  if (rf !== '') cs = cs.filter((c) => st.ratingOk(c, new Set([rf === 'none' ? 'none' : +rf])));
  const qs = (v, r) => { const p = new URLSearchParams(); if (v === 'wrong') p.set('v', 'wrong'); if (r !== '') p.set('r', r); const t = p.toString(); return `#/s/${sid}${t ? '?' + t : ''}`; };
  const a = acc(all);
  view().innerHTML = `
  ${crumbs(f.id, true)}
  <div class="topbar"><div><h1>${esc(s.name)}</h1><div class="muted">카드 ${all.length}장${a.pct !== null ? ` · 정답률 ${a.pct}%` : ''}</div></div>
    <span class="spacer"></span>${ratingHeadBtn('set', s)}<div><button class="icon-btn" id="more">${I.more}</button></div></div>
  <div class="modes">
    <button class="mode" data-m="flash">${I.cards}낱말카드</button>
    <button class="mode" data-m="test">${I.test}테스트</button>
    <button class="mode" data-m="match">${I.match}매칭</button>
    <button class="mode" data-m="review">${I.review}복습</button>
    <button class="mode" data-m="mc">${I.test}객관식</button>
    <button class="mode" data-m="learn">${I.flip}학습하기</button>
  </div>
  <div class="row" style="margin-top:18px">
    <div class="seg" id="vf"><button data-v="all" class="${filter === 'all' ? 'on' : ''}">전체 ${all.length}</button><button data-v="wrong" class="${filter === 'wrong' ? 'on' : ''}">오답 ${all.filter((c) => c.p?.wrong).length}</button></div>
    <select class="input" id="rf" style="width:auto;min-height:40px;padding:6px 10px"><option value="">별점: 전체</option>${[5, 4, 3, 2, 1, 0].map((n) => `<option value="${n}" ${rf === String(n) ? 'selected' : ''}>★ ${n}개 (${all.filter((c) => st.effRating(c).v === n).length})</option>`).join('')}<option value="none" ${rf === 'none' ? 'selected' : ''}>별점 없음 (${all.filter((c) => st.effRating(c).v === null).length})</option></select>
    <span class="spacer"></span>
    <a class="btn sm" href="#/import?set=${sid}">${I.import} 가져오기</a>
    <a class="btn sm primary" href="#/edit/${sid}">${I.edit} 카드 편집</a>
  </div>
  <div class="term-list" style="margin-top:12px">
    ${cs.map((c) => { const r = st.effRating(c); return `<div class="term-row ${c.p?.wrong ? 'wrong' : ''}"><div class="a">${listHTML(c).a}${(c.imgs || []).length ? `<div class="ph-row">${photoBlock(c.imgs, { compact: true })}<span class="small muted" style="align-self:center">사진 ${c.imgs.length}장</span></div>` : ''}</div><div class="b">${listHTML(c).b}</div>
      <div class="acts"><button class="rate-btn" data-rate="${c.id}" title="별점">${starsHTML(r.v, r.inherited)}</button>
      <a class="icon-btn" href="#/edit/${sid}?focus=${c.id}" title="편집">${I.edit}</a></div></div>`; }).join('')}
  </div>
  ${all.length ? (cs.length ? '' : '<div class="empty">해당하는 카드가 없어요.</div>') : `<div class="empty"><div class="big">🃏</div><p>카드가 없어요.<br>「카드 편집」에서 직접 쓰거나, 「가져오기」로 엑셀 표를 붙여넣으세요.</p><a class="btn primary" href="#/edit/${sid}">카드 만들기</a></div>`}`;
  $$('#vf button').forEach((b) => (b.onclick = () => go(qs(b.dataset.v, rf))));
  $('#rf').onchange = (e) => go(qs(filter, e.target.value));
  $('#headRate').onclick = () => askHeadRating('set', s);
  hydrate(view());
  $$('[data-rate]').forEach((b) => (b.onclick = async () => {
    const c = st.S.cards[b.dataset.rate]; const inh = st.inheritedRating(c.setId);
    const v = await pickRating('카드 별점', c.rating, { inheritNote: inh ? `물려받기: ${inh.name} ★${inh.v}` : '' });
    if (v === undefined) return; st.setRating('card', c.id, v); setView(sid, q);
  }));
  $$('[data-m]').forEach((b) => (b.onclick = () => {
    const m = b.dataset.m; const title = `${f.name} ${s.name}`;
    if (!all.length) return toast('먼저 카드를 추가해 주세요.');
    if (m === 'test' || m === 'mc' || m === 'learn') return go(`#/study?mode=${m}&sets=${sid}`);
    study.start(m, all, { title, shuffle: m !== 'flash', dir: 'term', key: 's:' + sid });
  }));
  $('#more').onclick = (e) => menu(e.currentTarget, [
    { label: '단원 이름 바꾸기', run: async () => { const n = await ask('단원 이름', s.name); if (n) { st.rename('set', sid, n); route(); } } },
    { label: '단원 별점 매기기', run: () => askHeadRating('set', s) },
    { label: '위로 이동', run: () => { st.moveOrder('set', sid, -1); toast('순서를 바꿨어요'); } },
    { label: '아래로 이동', run: () => { st.moveOrder('set', sid, 1); toast('순서를 바꿨어요'); } },
    { label: '다른 폴더로 옮기기', run: () => moveSet(sid) },
    { label: '단원 삭제', danger: true, run: async () => { if (await confirmBox(`'${s.name}'을(를) 삭제할까요?`, `카드 ${all.length}장도 함께 삭제됩니다.`, '삭제', true)) { st.deleteSet(sid); go('#/f/' + f.id); } } },
  ]);
}
// v2.3: 이 폴더(하위 폴더 포함)의 단원 여러 개를 골라 한꺼번에 옮기기
async function moveManySets(fid) {
  const list = st.setsUnder(fid);
  if (!list.length) return toast('옮길 단원이 없어요');
  const label = (s) => { const p = st.folderPath(s.folderId).filter((f) => !st.folderPath(fid).slice(0, -1).some((x) => x.id === f.id)).map((f) => f.name); return p.join(' › '); };
  const picked = await modal(`<h3>옮길 단원 고르기</h3>
    <div class="row" style="margin-bottom:8px"><button class="btn sm ghost" data-all>전체 선택</button><button class="btn sm ghost" data-none>선택 해제</button><span class="spacer"></span><span class="small muted" data-n>0개</span></div>
    <div class="list mv-list" style="gap:6px;max-height:55vh;overflow:auto">${list.map((s) => `<label class="mv-row"><input type="checkbox" value="${s.id}"><span><b>${esc(s.name)}</b><br><span class="small muted">${esc(label(s))} · 카드 ${st.cardsOf(s.id).length}장</span></span></label>`).join('')}</div>
    <div class="row end" style="margin-top:12px"><button class="btn ghost" data-x>취소</button><button class="btn primary" data-ok>다음: 옮길 폴더 고르기</button></div>`, (m, close) => {
    const boxes = $$('input[type=checkbox]', m); const n = $('[data-n]', m);
    const upd = () => { n.textContent = `${boxes.filter((b) => b.checked).length}개`; };
    boxes.forEach((b) => (b.onchange = upd));
    $('[data-all]', m).onclick = () => { boxes.forEach((b) => (b.checked = true)); upd(); };
    $('[data-none]', m).onclick = () => { boxes.forEach((b) => (b.checked = false)); upd(); };
    $('[data-x]', m).onclick = () => close(null);
    $('[data-ok]', m).onclick = () => { const ids = boxes.filter((b) => b.checked).map((b) => b.value); if (!ids.length) return toast('단원을 하나 이상 골라 주세요'); close(ids); };
  });
  if (!picked) return;
  const to = await pickFolder(`단원 ${picked.length}개를 어느 폴더로 옮길까요?`, {});
  if (!to) return;
  const n = st.moveSets(picked, to);
  toast(`${n}개 단원을 '${st.S.folders[to].name}'(으)로 옮겼어요`, 2500); route();
}
async function moveSet(sid) {
  const s = st.S.sets[sid];
  const to = await pickFolder(`'${s.name}'을(를) 어느 폴더로 옮길까요?`, { currentId: s.folderId });
  if (!to) return;
  s.folderId = to; s.order = st.setsOf(to).length; s.u = Date.now(); st.save(); toast('옮겼어요'); route();
}

// ================================================================ 카드 편집기 (퀴즐렛식, 자동 저장)
// v2.1: 카드마다 형식 선택 — 기본(용어/정의) · 확인문제(문제 + 보기 5개 + 정답 + 해설) · 빈칸(본문에 {{정답}})
const blankChoices = () => ['', '', '', '', ''];
function editor(sid, q = {}) {
  const s = st.S.sets[sid]; if (!s || s.del) return go('#/');
  const f = st.S.folders[s.folderId];
  const toRow = (c) => ({ id: c.id, kind: kindOf(c), term: c.term, def: c.def, imgs: (c.imgs || []).slice(),
    choices: kindOf(c) === 'question' && !isRot(c) ? [...qChoices(c), ...blankChoices()].slice(0, Math.max(5, qChoices(c).length)) : blankChoices(), answer: kindOf(c) === 'question' && !isRot(c) ? qAnswer(c) : 1,
    rot: isRot(c), ansText: isRot(c) ? rotAnswers(c).join('\n') : '', wrongText: isRot(c) ? (c.wrong || []).join('\n') : '', group: c.group || '' });
  const empty = (kind = 'basic', rot = false) => ({ kind, term: '', def: '', imgs: [], choices: blankChoices(), answer: 1, rot, ansText: '', wrongText: '', group: '' });
  const lines = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean);
  let rows = st.cardsOf(sid).map(toRow);
  if (!rows.length) rows = [empty(), empty(), empty()];
  const dropped = new Set(); // 편집 중 뺀 사진 (저장 후 어디에도 안 쓰이면 지움)
  const removed = new Set();
  let dirty = false, timer = null;

  const isEmpty = (r) => !r.term.trim() && !r.def.trim() && !(r.imgs || []).length && !(r.kind === 'question' && (r.rot ? lines(r.ansText).length || lines(r.wrongText).length : r.choices.some((x) => x.trim())));
  const kindData = (r) => (r.kind === 'question' && r.rot ? { kind: 'question', answers: lines(r.ansText), wrong: lines(r.wrongText), group: r.group }
    : r.kind === 'question' ? { kind: 'question', choices: (() => { const ch = r.choices.map((x) => x.trim()); while (ch.length > 2 && !ch[ch.length - 1] && ch.length > r.answer) ch.pop(); return ch; })(), answer: r.answer } : { kind: r.kind });
  const sig = (o) => JSON.stringify([o.kind || 'basic', o.choices || null, o.kind === 'question' && o.choices ? o.answer : null, o.answers || null, o.wrong || null, o.group || null]);
  const flush = () => {
    clearTimeout(timer); if (!dirty) return; dirty = false;
    let order = 0;
    $$('.ed-row').forEach((el) => {
      const r = rows[+el.dataset.i]; if (!r) return;
      const term = r.term.trim(), def = r.def.trim(); const imgs = r.kind === 'cloze' ? [] : (r.imgs || []);
      const kd = kindData(r);
      if (r.id && st.S.cards[r.id] && !st.S.cards[r.id].del) {
        const c = st.S.cards[r.id];
        if (isEmpty(r)) { st.deleteCard(r.id); r.id = null; return; }
        const sameImgs = (c.imgs || []).join(',') === imgs.join(',');
        const before = sig(c);
        if (c.term !== term || c.def !== def || c.order !== order || !sameImgs || before !== sig({ ...kd, kind: kd.kind === 'basic' ? 'basic' : kd.kind })) {
          c.term = term; c.def = def; c.order = order; c.imgs = imgs.slice(); st.applyKind(c, kd); c.cu = Date.now();
        }
        order++;
      } else if (!isEmpty(r)) { const c = st.newCard(sid, term, def, order, kd.kind === 'basic' ? null : kd); c.imgs = imgs.slice(); r.id = c.id; order++; }
    });
    for (const id of removed) st.deleteCard(id);
    removed.clear(); st.save(true);
    for (const im of dropped) st.removeImageIfUnused(im);
    dropped.clear();
    const sv = $('#saved'); if (sv) { sv.textContent = '저장됨 ✓'; }
  };
  const touch = () => { dirty = true; const sv = $('#saved'); if (sv) sv.textContent = '저장 중…'; clearTimeout(timer); timer = setTimeout(flush, 600); };
  leaveHook = flush;

  const kindSeg = (r) => `<div class="seg sm ed-kind">${[['basic', '기본'], ['question', '확인문제'], ['cloze', '빈칸']].map(([k, l]) => `<button data-kind="${k}" class="${r.kind === k ? 'on' : ''}">${l}</button>`).join('')}</div>`;
  const clozeInfo = (r) => { const a = clozeAnswers(r.term); return a.length ? `빈칸 ${a.length}개 · ${a.map((t, k) => `${circ(k + 1)} ${esc(t)}`).join('  ')}` : '빈칸이 없어요. 가릴 글자를 고르고 「빈칸으로」를 누르세요.'; };
  const bodyHtml = (r, i) => {
    const qmode = `<div class="seg sm" data-qmode><button data-rot="0" class="${r.rot ? '' : 'on'}">보기 고정</button><button data-rot="1" class="${r.rot ? 'on' : ''}">정답 돌려쓰기</button></div>`;
    if (r.kind === 'question' && r.rot) {
      const na = lines(r.ansText).length, nw = lines(r.wrongText).length;
      return `<div class="ed-q">${qmode}
      <div><textarea rows="2" data-k="term" placeholder="문제 (증례 + 질문)">${esc(r.term)}</textarea><div class="cap">문제</div></div>
      <div class="grid2 rot-cols">
        <div><textarea rows="3" data-k="ansText" placeholder="육신산&#10;익황산&#10;구등음">${esc(r.ansText)}</textarea><div class="cap" data-rotinfo="a">정답 후보 ${na}개 · 한 줄에 하나 · 나올 때마다 하나씩 돌아가며 정답</div></div>
        <div><textarea rows="3" data-k="wrongText" placeholder="오답 처방을 한 줄에 하나씩 (6~8개 추천)">${esc(r.wrongText)}</textarea><div class="cap ${nw < 4 ? 'warn' : ''}" data-rotinfo="w">오답 풀 ${nw}개 · 매번 4개를 뽑아요${nw < 4 ? ' (4개 미만이면 보기가 줄어요)' : ''}</div></div>
      </div>
      <div><textarea rows="1" data-k="def" placeholder="해설 (근거·감별 증상, 선택)">${esc(r.def)}</textarea><div class="cap">해설</div></div></div>`;
    }
    if (r.kind === 'question') return `<div class="ed-q">${qmode}
      <div><textarea rows="2" data-k="term" placeholder="문제 (증례 + 질문)">${esc(r.term)}</textarea><div class="cap">문제</div></div>
      <div class="qc-list">${r.choices.map((t, k) => `<label class="qc ${r.answer === k + 1 ? 'on' : ''}"><input type="radio" name="ans-${i}" value="${k + 1}" ${r.answer === k + 1 ? 'checked' : ''} title="정답으로"><span class="no">${circ(k + 1)}</span><input class="input" data-c="${k}" value="${esc(t)}" placeholder="보기 ${k + 1}"></label>`).join('')}
        <div class="cap">보기 · 왼쪽 동그라미로 정답 선택</div></div>
      <div><textarea rows="1" data-k="def" placeholder="해설 (근거·감별 증상, 선택)">${esc(r.def)}</textarea><div class="cap">해설</div></div></div>`;
    if (r.kind === 'cloze') return `<div class="ed-cz">
      <div class="row" style="gap:6px;margin-bottom:6px"><button class="btn sm" data-wrap>［ ］ 빈칸으로</button><button class="btn sm ghost" data-unwrap>빈칸 풀기</button><span class="small muted">본문에서 글자를 고른 뒤 누르세요 · 직접 {{정답}}으로 써도 돼요</span></div>
      <div><textarea rows="3" data-k="term" placeholder="본문 (예: 미숙아는 만삭아보다 {{호흡이 빠르고}} 변화폭도 큼)">${esc(r.term)}</textarea><div class="cap" data-czinfo>${clozeInfo(r)}</div></div>
      <div><textarea rows="1" data-k="def" placeholder="메모 (출처·쪽수 등, 선택)">${esc(r.def)}</textarea><div class="cap">메모</div></div></div>`;
    return `<div class="ed-body"><div><textarea rows="1" data-k="term" placeholder="용어 (A)">${esc(r.term)}</textarea><div class="cap">용어</div></div>
    <div><textarea rows="1" data-k="def" placeholder="정의 (B)">${esc(r.def)}</textarea><div class="cap">정의</div></div></div>`;
  };
  const rowHtml = (r, i, n) => `<div class="ed-row" data-i="${i}"><div class="ed-head"><span class="ed-n">${n}</span>${kindSeg(r)}<span class="spacer"></span>
      ${r.kind === 'basic' ? `<button class="icon-btn" data-swap title="용어↔정의 바꾸기">${I.flip}</button>` : ''}<button class="icon-btn" data-del title="삭제">${I.trash}</button></div>
    ${bodyHtml(r, i)}
    ${r.kind === 'cloze' ? '' : `<div class="ed-ph">${phHtml(r)}</div>`}</div>`;
  const phHtml = (r) => `${(r.imgs || []).map((id, k) => `<div class="t"><img data-img="${esc(id)}" data-k="${k}" alt=""><button data-rm="${k}" title="사진 빼기">×</button></div>`).join('')}
      <button class="add" data-addph>＋ 사진${(r.imgs || []).length ? '' : `<br><span style="font-weight:600;font-size:11px">(${r.kind === 'question' ? '문제' : '용어'} 쪽)</span>`}</button>
      <input type="file" accept="image/*" multiple hidden data-file>`;
  const bindPh = (el) => {
    const i = +el.dataset.i; const box = $('.ed-ph', el); const r = rows[i]; if (!box) return;
    box.innerHTML = phHtml(r); hydrate(box);
    const file = $('[data-file]', box);
    $('[data-addph]', box).onclick = () => file.click();
    file.onchange = async () => {
      const files = [...file.files]; file.value = ''; if (!files.length) return;
      toast(`사진 ${files.length}장 넣는 중…`);
      for (const fl of files) { try { r.imgs.push(await fileToStoredImage(fl)); } catch (e) { toast('읽을 수 없는 사진이 있어요'); } }
      bindPh(el); dirty = true; flush();
    };
    $$('[data-rm]', box).forEach((b) => (b.onclick = () => { const [id] = r.imgs.splice(+b.dataset.rm, 1); dropped.add(id); bindPh(el); dirty = true; flush(); }));
    $$('img[data-img]', box).forEach((im) => (im.onclick = () => openViewer(r.imgs, +im.dataset.k)));
  };
  const draw = () => {
    view().innerHTML = `
    ${crumbs(f.id, true).replace('</div>', ` › <a href="#/s/${sid}">${esc(s.name)}</a></div>`)}
    <div class="sticky-bar"><h1 style="margin:0;font-size:22px">카드 편집</h1><span class="muted small" id="saved">자동 저장</span><span class="spacer"></span>
      <a class="btn primary" href="#/s/${sid}">완료</a></div>
    <div id="rows">${rows.map((r, i) => rowHtml(r, i, i + 1)).join('')}</div>
    <button class="ed-add" id="add"><span>+ 카드 추가</span></button>
    <p class="muted small" style="text-align:center">카드마다 위쪽에서 형식(기본 · 확인문제 · 빈칸)을 고를 수 있어요. 마지막 칸에서 Tab을 누르면 새 카드가 생겨요.</p>`;
    bind();
  };
  const renumber = () => $$('.ed-row').forEach((el, k) => { $('.ed-n', el).textContent = k + 1; });
  const redrawRow = (el) => {
    const i = +el.dataset.i; const wrap = document.createElement('div');
    wrap.innerHTML = rowHtml(rows[i], i, $('.ed-n', el).textContent);
    const nel = wrap.firstElementChild; el.replaceWith(nel); bindRow(nel); return nel;
  };
  // 본문 선택 영역을 {{ }}로 감싸기 / 풀기
  const wrapSel = (ta, r, unwrap) => {
    let a = ta.selectionStart, b = ta.selectionEnd; const v = ta.value;
    if (unwrap) {
      // 커서·선택이 걸친 {{…}}를 찾아 괄호만 지움
      const re = /\{\{([\s\S]*?)\}\}/g; let m, out = v, shift = 0, hit = false;
      while ((m = re.exec(v))) {
        const s0 = m.index, e0 = s0 + m[0].length;
        if (b >= s0 && a <= e0) { out = out.slice(0, s0 - shift) + m[1] + out.slice(e0 - shift); shift += 4; hit = true; }
      }
      if (!hit) return toast('풀 빈칸 안에 커서를 두세요');
      ta.value = out;
    } else {
      while (a < b && /\s/.test(v[a])) a++; while (b > a && /\s/.test(v[b - 1])) b--;
      if (a === b) return toast('먼저 빈칸으로 만들 글자를 고르세요');
      if (/\{\{|\}\}/.test(v.slice(a, b))) return toast('이미 빈칸이 들어 있어요');
      ta.value = v.slice(0, a) + '{{' + v.slice(a, b) + '}}' + v.slice(b);
      ta.setSelectionRange(b + 4, b + 4);
    }
    r.term = ta.value; autoGrow(ta); touch();
  };
  const bindRow = (el) => {
    const i = +el.dataset.i; const r = rows[i];
    $$('textarea', el).forEach((ta) => {
      autoGrow(ta);
      ta.oninput = () => {
        r[ta.dataset.k] = ta.value; autoGrow(ta); touch();
        if (r.kind === 'cloze' && ta.dataset.k === 'term') { const ci = $('[data-czinfo]', el); if (ci) ci.innerHTML = clozeInfo(r); }
      };
      ta.onkeydown = (e) => {
        if (e.key === 'Tab' && !e.shiftKey && ta.dataset.k === 'def' && el === $$('.ed-row').at(-1)) { e.preventDefault(); addRow(); }
      };
    });
    $$('[data-c]', el).forEach((inp) => (inp.oninput = () => { r.choices[+inp.dataset.c] = inp.value; touch(); }));
    $$('input[type=radio]', el).forEach((rb) => (rb.onchange = () => { r.answer = +rb.value; $$('.qc', el).forEach((x, k) => x.classList.toggle('on', k + 1 === r.answer)); touch(); }));
    const ta = $('textarea[data-k="term"]', el);
    const wb = $('[data-wrap]', el), ub = $('[data-unwrap]', el);
    [[wb, false], [ub, true]].forEach(([btn, un]) => { if (!btn) return; btn.onpointerdown = (e) => e.preventDefault(); btn.onclick = () => { wrapSel(ta, r, un); const ci = $('[data-czinfo]', el); if (ci) ci.innerHTML = clozeInfo(r); }; });
    $$('[data-rot]', el).forEach((b) => (b.onclick = () => {
      const to = b.dataset.rot === '1'; if (r.rot === to) return;
      if (to && !r.ansText.trim()) { // 고정 보기 → 돌려쓰기: 정답은 정답 후보로, 나머지 보기는 오답 풀로
        const ch = r.choices.map((x) => x.trim());
        r.ansText = ch[r.answer - 1] || ''; r.wrongText = ch.filter((x, k) => x && k !== r.answer - 1).join('\n');
      } else if (!to && !r.choices.some((x) => x.trim())) {
        r.choices = [...lines(r.ansText).slice(0, 1), ...lines(r.wrongText).slice(0, 4)]; while (r.choices.length < 5) r.choices.push(''); r.answer = 1;
      }
      r.rot = to; redrawRow(el); dirty = true; flush();
    }));
    $$('textarea[data-k="ansText"], textarea[data-k="wrongText"]', el).forEach((ta) => ta.addEventListener('input', () => {
      const na = lines(r.ansText).length, nw = lines(r.wrongText).length;
      const ia = $('[data-rotinfo="a"]', el), iw = $('[data-rotinfo="w"]', el);
      if (ia) ia.textContent = `정답 후보 ${na}개 · 한 줄에 하나 · 나올 때마다 하나씩 돌아가며 정답`;
      if (iw) { iw.textContent = `오답 풀 ${nw}개 · 매번 4개를 뽑아요${nw < 4 ? ' (4개 미만이면 보기가 줄어요)' : ''}`; iw.classList.toggle('warn', nw < 4); }
    }));
    $$('[data-kind]', el).forEach((b) => (b.onclick = () => {
      if (r.kind === b.dataset.kind) return;
      if (b.dataset.kind === 'cloze' && (r.imgs || []).length) toast('빈칸 카드에는 사진이 들어가지 않아요. 사진은 형식을 되돌리면 다시 보여요.', 3000);
      r.kind = b.dataset.kind; redrawRow(el); dirty = true; flush();
    }));
    bindPh(el);
    $('[data-del]', el).onclick = () => { if (r.id) removed.add(r.id); (r.imgs || []).forEach((id) => dropped.add(id)); rows[i] = null; el.remove(); renumber(); dirty = true; flush(); };
    const sw = $('[data-swap]', el);
    if (sw) sw.onclick = () => {
      [r.term, r.def] = [r.def, r.term];
      const [a, b] = $$('textarea', el); a.value = r.term; b.value = r.def; autoGrow(a); autoGrow(b); touch();
    };
  };
  const addRow = () => {
    const last = rows.filter(Boolean).at(-1);
    rows.push(empty(last ? last.kind : 'basic', !!(last && last.kind === 'question' && last.rot)));
    const i = rows.length - 1;
    const wrap = document.createElement('div');
    wrap.innerHTML = rowHtml(rows[i], i, $$('.ed-row').length + 1);
    const el = wrap.firstElementChild; $('#rows').appendChild(el); bindRow(el);
    $('textarea', el).focus(); el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };
  const bind = () => {
    $$('.ed-row').forEach(bindRow);
    $('#add').onclick = addRow;
    if (q.focus) {
      const idx = rows.findIndex((r) => r && r.id === q.focus);
      const el = $(`.ed-row[data-i="${idx}"]`);
      if (el) { setTimeout(() => { el.scrollIntoView({ block: 'center' }); $('textarea', el).focus(); }, 50); }
    }
  };
  draw();
}

// ================================================================ 가져오기 (붙여넣기 / 카드팩 파일)
function parseDSV(text, sep) {
  const out = []; let row = [], cell = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === sep) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && text[i + 1] === '\n') i++; row.push(cell); out.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  row.push(cell); out.push(row);
  return out;
}
function parsePaste(text, ts, cs) {
  let rows;
  if ((ts === '\t' || ts === ',') && cs === '\n') rows = parseDSV(text, ts);
  else rows = text.split(cs).map((line) => { const k = line.indexOf(ts); return k < 0 ? [line] : [line.slice(0, k), line.slice(k + ts.length)]; });
  return rows.map((r) => ({ term: (r[0] || '').trim(), def: r.slice(1).map((x) => x.trim()).filter(Boolean).join(' / ') })).filter((r) => r.term || r.def);
}

function importView(q = {}) {
  const fs = st.folderTree().map((x) => x.f);
  const preSet = q.set && st.S.sets[q.set];
  const P = { fid: preSet ? preSet.folderId : (q.folder || fs[0]?.id || 'new'), sid: preSet ? preSet.id : 'new', newF: '', newS: '', text: '', ts: '\t', cs: '\n', cts: '-', ccs: ';;' };
  const draw = () => {
    const sets = P.fid && P.fid !== 'new' ? st.setsOf(P.fid) : [];
    if (P.sid !== 'new' && !sets.find((s) => s.id === P.sid)) P.sid = sets[0]?.id || 'new';
    view().innerHTML = `
    <div class="crumb"><a href="#/">홈</a></div>
    <h1>가져오기</h1>
    <p class="muted">엑셀·구글 시트에서 <b>두 열(A: 용어, B: 정의)</b>을 복사해 붙여넣거나, Claude가 만들어 준 <b>카드팩 파일</b>을 불러오세요.</p>
    <div class="card" style="margin-top:12px">
      <div class="row"><h3>📄 카드팩 / 백업 파일 불러오기</h3><span class="spacer"></span><button class="btn primary" id="pickFile">파일 선택</button>
      <input type="file" id="file" hidden></div>
      <p class="muted small" style="margin:6px 0 0">카드팩에는 폴더·단원 이름이 들어 있어서 알맞은 곳에 자동으로 들어갑니다.</p>
    </div>
    <h2>붙여넣기</h2>
    <div class="card">
      <div class="grid2">
        <div><label class="f">폴더</label><select class="input" id="fsel">${fs.map((f) => `<option value="${f.id}" ${f.id === P.fid ? 'selected' : ''}>${esc(st.folderPathLabel(f.id))}</option>`).join('')}<option value="new" ${P.fid === 'new' ? 'selected' : ''}>+ 새 폴더…</option></select>
          ${P.fid === 'new' ? `<input class="input" id="newF" style="margin-top:8px" placeholder="새 폴더 이름" value="${esc(P.newF)}">` : ''}</div>
        <div><label class="f">단원</label><select class="input" id="ssel">${sets.map((s) => `<option value="${s.id}" ${s.id === P.sid ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}<option value="new" ${P.sid === 'new' ? 'selected' : ''}>+ 새 단원…</option></select>
          ${P.sid === 'new' ? `<input class="input" id="newS" style="margin-top:8px" placeholder="새 단원 이름" value="${esc(P.newS)}">` : ''}</div>
      </div>
      <label class="f">여기에 붙여넣기</label>
      <textarea class="input" id="txt" rows="8" placeholder="계지탕&#9;계지, 작약, 생강, 대조, 감초&#10;마황탕&#9;마황, 계지, 행인, 감초">${esc(P.text)}</textarea>
      <div class="grid2" style="margin-top:6px">
        <div><label class="f">용어와 정의 사이</label><div class="seg" id="tsg">
          <button data-v="\t" class="${P.ts === '\t' ? 'on' : ''}">탭 (엑셀)</button><button data-v="," class="${P.ts === ',' ? 'on' : ''}">쉼표</button><button data-v="custom" class="${!['\t', ','].includes(P.ts) ? 'on' : ''}">직접</button></div>
          ${!['\t', ','].includes(P.ts) ? `<input class="input" id="cts" style="margin-top:8px" value="${esc(P.cts)}">` : ''}</div>
        <div><label class="f">카드와 카드 사이</label><div class="seg" id="csg">
          <button data-v="\n" class="${P.cs === '\n' ? 'on' : ''}">줄바꿈</button><button data-v=";" class="${P.cs === ';' ? 'on' : ''}">세미콜론</button><button data-v="custom" class="${!['\n', ';'].includes(P.cs) ? 'on' : ''}">직접</button></div>
          ${!['\n', ';'].includes(P.cs) ? `<input class="input" id="ccs" style="margin-top:8px" value="${esc(P.ccs)}">` : ''}</div>
      </div>
    </div>
    <div id="pv"></div>`;
    bind(); preview();
  };
  const curRows = () => parsePaste(P.text, P.ts, P.cs);
  const preview = () => {
    const rows = curRows();
    $('#pv').innerHTML = rows.length ? `<h2>미리보기 · ${rows.length}장</h2>
      <div class="pv"><table><tr><th>#</th><th>용어 (A)</th><th>정의 (B)</th></tr>${rows.slice(0, 300).map((r, i) => `<tr><td class="muted">${i + 1}</td><td>${esc(r.term)}</td><td>${esc(r.def)}</td></tr>`).join('')}</table></div>
      ${rows.length > 300 ? `<p class="muted small">… 외 ${rows.length - 300}장</p>` : ''}
      <div class="row end" style="margin-top:14px"><button class="btn primary" id="doImp">${rows.length}장 가져오기</button></div>` : '';
    const b = $('#doImp'); if (b) b.onclick = doImport;
  };
  const doImport = () => {
    const rows = curRows(); if (!rows.length) return;
    let fid = P.fid, sid = P.sid;
    if (fid === 'new') { if (!P.newF.trim()) return toast('새 폴더 이름을 입력해 주세요.'); fid = st.addFolder(P.newF).id; sid = 'new'; }
    if (sid === 'new') { if (!P.newS.trim()) return toast('새 단원 이름을 입력해 주세요.'); sid = st.addSet(fid, P.newS).id; }
    const base = st.cardsOf(sid).length;
    rows.forEach((r, i) => st.newCard(sid, r.term, r.def, base + i));
    st.save(true);
    toast(`${rows.length}장을 가져왔어요`);
    go('#/s/' + sid);
  };
  const bind = () => {
    $('#fsel').onchange = (e) => { P.fid = e.target.value; P.sid = 'new'; const ss = P.fid !== 'new' ? st.setsOf(P.fid) : []; if (ss[0]) P.sid = ss[0].id; draw(); };
    $('#ssel').onchange = (e) => { P.sid = e.target.value; draw(); };
    const nf = $('#newF'); if (nf) nf.oninput = () => (P.newF = nf.value);
    const ns = $('#newS'); if (ns) ns.oninput = () => (P.newS = ns.value);
    $('#txt').oninput = (e) => { P.text = e.target.value; preview(); };
    $$('#tsg button').forEach((b) => (b.onclick = () => { P.ts = b.dataset.v === 'custom' ? P.cts : b.dataset.v; draw(); }));
    $$('#csg button').forEach((b) => (b.onclick = () => { P.cs = b.dataset.v === 'custom' ? P.ccs : b.dataset.v; draw(); }));
    const ct = $('#cts'); if (ct) ct.oninput = () => { P.cts = ct.value || '-'; P.ts = P.cts; preview(); };
    const cc = $('#ccs'); if (cc) cc.oninput = () => { P.ccs = cc.value || ';;'; P.cs = P.ccs; preview(); };
    $('#pickFile').onclick = () => $('#file').click();
    $('#file').onchange = (e) => { const file = e.target.files[0]; e.target.value = ''; if (file) importFile(file); };
  };
  draw();
}

export async function importFile(file) {
  let parsed;
  try { parsed = st.parseImport(await readFile(file)); } catch (e) { return toast(e.message, 3500); }
  if (parsed.kind === 'backup') return importBackupFlow(parsed.data);
  // 카드팩 — v2.3: 넣을 폴더를 고를 수 있음
  const T = { id: '', keep: false };
  const edits = {}, skips = new Set();
  const packFolders = [...new Set((parsed.data.cards || []).map((c) => String(c.folder || '미분류').split(/\s*[>›]\s*/).filter(Boolean).join(' › ')))];
  let rows = [];
  const draw = () => {
    rows = st.previewPack(parsed.data, T.id ? { id: T.id, keep: T.keep } : null).map((r, i) => ({ ...r, ...(edits[i] || {}), skip: skips.has(i) }));
    const add = rows.filter((r) => !r.dup).length, dup = rows.length - add;
    const newSets = [...new Set(rows.filter((r) => r.newSet).map((r) => `${r.folder} › ${r.set}`))];
    const kinds = { basic: 0, question: 0, cloze: 0 }; rows.forEach((r) => kinds[r.kind]++);
    const tree = st.folderTree();
    view().innerHTML = `
    <div class="crumb"><a href="#/">홈</a> › <a href="#/import">가져오기</a></div>
    <h1>카드팩 확인</h1>
    <p class="muted">${esc(file.name)} · 카드 ${rows.length}장${parsed.data.title ? ` · ${esc(parsed.data.title)}` : ''}</p>
    <div class="card" style="margin:12px 0">
      <label class="f" style="margin-top:0">넣을 곳</label>
      <select class="input" id="tgt">
        <option value="">카드팩에 적힌 폴더 그대로 (${esc(packFolders.slice(0, 3).join(', '))}${packFolders.length > 3 ? ' …' : ''})</option>
        ${tree.map(({ f, depth }) => `<option value="${f.id}" ${T.id === f.id ? 'selected' : ''}>${'　'.repeat(depth)}${depth ? '└ ' : ''}${esc(f.name)}</option>`).join('')}
      </select>
      ${T.id ? `<div class="seg" id="keep" style="margin-top:10px"><button data-v="0" class="${T.keep ? '' : 'on'}">이 폴더에 단원만 넣기</button><button data-v="1" class="${T.keep ? 'on' : ''}">이 폴더 안에 카드팩 폴더째로</button></div>
        <p class="small muted" style="margin:8px 0 0">${T.keep ? `예: ${esc(st.folderPathLabel(T.id))} › ${esc(packFolders[0] || '')} › 단원` : `예: ${esc(st.folderPathLabel(T.id))} › 단원 (카드팩의 폴더 이름은 쓰지 않아요)`}</p>` : ''}
    </div>
    ${newSets.length ? `<div class="banner">새로 만들어질 단원 ${newSets.length}개: ${newSets.slice(0, 6).map(esc).join(', ')}${newSets.length > 6 ? ` 외 ${newSets.length - 6}개` : ''}</div>` : ''}
    <p class="small muted">기본 카드는 표의 용어·정의 칸을 눌러 바로 고칠 수 있어요(확인문제·빈칸은 추가한 뒤 카드 편집에서). 회색 줄은 이미 같은 카드가 있어서 건너뜁니다.</p>
    ${kinds.question || kinds.cloze ? `<p class="small">형식: ${Object.entries(kinds).filter(([, n]) => n).map(([k, n]) => `${KIND_LABEL[k]} ${n}장`).join(' · ')}</p>` : ''}
    <div class="pv"><table><tr><th>폴더 › 단원</th><th>용어 · 문제 · 본문</th><th>정의 · 정답</th><th></th></tr>
    ${rows.map((r, i) => `<tr class="${r.dup ? 'dup' : ''}" data-i="${i}"><td class="muted">${esc(r.folder)} › ${esc(r.set)}${r.kind !== 'basic' ? `<br><span class="kind-tag ${r.kind === 'question' ? 'q' : 'cz'}">${KIND_LABEL[r.kind]}</span>` : ''}</td>${r.kind === 'basic' ? `<td contenteditable data-k="term">${esc(r.term)}</td><td contenteditable data-k="def">${esc(r.def)}</td>` : `<td>${esc(plainA(r))}</td><td>${esc(plainB(r))}</td>`}
      <td><label class="chk"><input type="checkbox" ${r.dup ? 'disabled' : r.skip ? '' : 'checked'} data-use></label></td></tr>`).join('')}</table></div>
    <div class="row end" style="margin-top:14px"><a class="btn ghost" href="#/import">취소</a><button class="btn primary" id="apply">${add}장 추가${dup ? ` (중복 ${dup}장 제외)` : ''}</button></div>`;
    $('#tgt').onchange = (e) => { T.id = e.target.value; draw(); };
    $$('#keep button').forEach((b) => (b.onclick = () => { T.keep = b.dataset.v === '1'; draw(); }));
    $$('.pv td[contenteditable]').forEach((td) => (td.oninput = () => { const i = +td.parentElement.dataset.i; (edits[i] = edits[i] || {})[td.dataset.k] = td.innerText.trim(); rows[i][td.dataset.k] = td.innerText.trim(); }));
    $$('[data-use]').forEach((cb) => (cb.onchange = () => { const i = +cb.closest('tr').dataset.i; cb.checked ? skips.delete(i) : skips.add(i); rows[i].skip = !cb.checked; }));
    $('#apply').onclick = async () => {
      const r = await st.applyPack(rows, T.id ? { id: T.id, keep: T.keep } : null);
      toast(`${r.added}장 추가${r.skipped ? `, ${r.skipped}장 건너뜀` : ''}`, 3000);
      go('#/');
    };
  };
  draw();
}

async function importBackupFlow(d) {
  const nCards = (d.cards || []).filter((c) => !c.del).length;
  const ok = await confirmBox('백업 파일 합치기',
    `${esc((d.exportedAt || '').slice(0, 16).replace('T', ' '))} 에 저장된 백업 (카드 ${nCards}장)<br><br>
    이 기기의 데이터와 <b>합칩니다</b>. 같은 카드는 더 최근에 바뀐 쪽이 남고, 어느 쪽에만 있는 카드는 모두 유지됩니다. 학습 기록도 함께 합쳐집니다.`, '합치기');
  if (!ok) return;
  toast('합치는 중…');
  const r = await st.mergeBackup(d);
  await modal(`<h3>합치기 완료</h3><p>카드 ${r.cards}장 추가·수정, 학습 기록 ${r.progress}건 갱신, 폴더 ${r.folders} · 단원 ${r.sets} · 시험 기록 ${r.history}건${r.images ? ` · 사진 ${r.images}장` : ''} 반영</p>
    <div class="row end"><button class="btn primary" data-ok>확인</button></div>`, (m, close) => { $('[data-ok]', m).onclick = () => close(true); });
  go('#/');
}

// ================================================================ 학습 범위 선택
function picker(q = {}) {
  const fs = st.folders();
  const last = st.S.local.lastPick || {};
  const P = {
    mode: q.mode || last.mode || 'test',
    sel: new Set(),
    shuffle: last.shuffle ?? true, dir: last.dir || 'term', filter: q.filter === 'wrong' ? 'wrong' : 'all', count: last.count || 0,
    ratings: new Set(last.ratings || []), answer: last.answer || 'mc',
  };
  if (!['flash', 'test', 'mc', 'learn', 'match', 'review'].includes(P.mode)) P.mode = 'test';
  const allSets = st.orderedSets();
  if (q.sets) q.sets.split(',').forEach((id) => st.S.sets[id] && P.sel.add(id));
  else if (q.folder) st.setsUnder(q.folder).forEach((s) => P.sel.add(s.id));
  else if (q.all) allSets.forEach((s) => P.sel.add(s.id));
  else (last.sets || []).forEach((id) => allSets.some((s) => s.id === id) && P.sel.add(id));
  // v2.3: 처음엔 접힌 상태(펼친 폴더는 기억). 보기: 교재별(폴더) / 단원별(같은 주제끼리)
  const open = new Set((st.S.local.pickOpen || []).filter((id) => st.S.folders[id]));
  if (q.folder) st.folderPath(q.folder).forEach((f) => open.add(f.id));
  if (q.sets) for (const id of P.sel) st.folderPath(st.S.sets[id].folderId).forEach((f) => open.add(f.id));
  P.view = st.S.local.pickView === 'topic' ? 'topic' : 'folder';
  const saveOpen = () => { st.S.local.pickOpen = [...open]; st.save(); };
  // 단원 이름에서 꼬리표·괄호를 떼어 같은 주제끼리 묶는 열쇠
  const topicKey = (name) => String(name).replace(/\s*\((빈칸|확인문제|문제|blank|Blank)\)\s*$/, '').trim();
  const topicGroups = (top) => {
    const groups = new Map();
    for (const s of st.setsUnder(top.id)) {
      const k = topicKey(s.name);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(s);
    }
    return [...groups.entries()];
  };
  const subLabel = (s, top) => { const p = st.folderPath(s.folderId).filter((f) => f.id !== top.id).map((f) => f.name); return p.length ? p.join('›') : (s.name !== topicKey(s.name) ? s.name.slice(topicKey(s.name).length).replace(/[()\s]/g, '') : '단원'); };
  const topicNode = (f) => {
    const under = st.setsUnder(f.id); const k = under.filter((s) => P.sel.has(s.id)).length;
    const gs = topicGroups(f);
    return `<div class="fold"><div class="fh"><label class="chk"><input type="checkbox" data-f="${f.id}" ${k && k === under.length ? 'checked' : ''} ${under.length ? '' : 'disabled'}><span>${esc(f.name)}</span></label>
      <span class="cnt pill ${k ? 'pr' : ''}">${k}/${under.length}</span><button class="icon-btn" data-open="${f.id}">${open.has(f.id) ? I.up : I.down}</button></div>
      ${open.has(f.id) ? `<div class="topics">${gs.map(([name, ss]) => { const on = ss.filter((s) => P.sel.has(s.id)).length;
        if (ss.length === 1 && st.S.sets[ss[0].id].folderId === f.id) { const s1 = ss[0]; return `<label class="chip ${P.sel.has(s1.id) ? 'on' : ''}"><input type="checkbox" data-s="${s1.id}" ${P.sel.has(s1.id) ? 'checked' : ''}>${esc(s1.name)}<span class="c">${st.cardsOf(s1.id).length}</span></label>`; }
        return `<div class="topic ${on === ss.length ? 'on' : on ? 'part' : ''}"><button class="tp-name" data-g="${ss.map((s) => s.id).join(',')}">${esc(name)}</button>
          <div class="tp-parts">${ss.map((s) => `<label class="chip sm ${P.sel.has(s.id) ? 'on' : ''}"><input type="checkbox" data-s="${s.id}" ${P.sel.has(s.id) ? 'checked' : ''}>${esc(subLabel(s, f))}<span class="c">${st.cardsOf(s.id).length}</span></label>`).join('')}</div></div>`; }).join('')
        || '<span class="muted small">단원이 없어요</span>'}</div>` : ''}</div>`;
  };
  const node = (f) => {
    const under = st.setsUnder(f.id); const k = under.filter((s) => P.sel.has(s.id)).length;
    const own = st.setsOf(f.id), subs = st.subfolders(f.id);
    return `<div class="fold"><div class="fh"><label class="chk"><input type="checkbox" data-f="${f.id}" ${k && k === under.length ? 'checked' : ''} ${under.length ? '' : 'disabled'}><span>${esc(f.name)}</span></label>
      <span class="cnt pill ${k ? 'pr' : ''}">${k}/${under.length}</span><button class="icon-btn" data-open="${f.id}">${open.has(f.id) ? I.up : I.down}</button></div>
      ${open.has(f.id) ? `${own.length ? `<div class="sets">${own.map((s) => `<label class="chip ${P.sel.has(s.id) ? 'on' : ''}"><input type="checkbox" data-s="${s.id}" ${P.sel.has(s.id) ? 'checked' : ''}>${esc(s.name)}<span class="c">${st.cardsOf(s.id).length}</span></label>`).join('')}</div>` : ''}
        ${subs.length ? `<div class="subtree">${subs.map(node).join('')}</div>` : ''}
        ${!own.length && !subs.length ? '<div class="sets"><span class="muted small">단원이 없어요</span></div>' : ''}` : ''}</div>`;
  };

  const filtered = () => {
    let cs = st.cardsIn([...P.sel]);
    if (P.filter === 'wrong') cs = cs.filter((c) => c.p?.wrong);
    if (P.ratings.size) cs = cs.filter((c) => st.ratingOk(c, P.ratings));
    return cs;
  };
  const draw = () => {
    const cs = filtered();
    const n = P.mode === 'review' ? study.reviewCounts(cs).total : (P.count && P.count < cs.length ? P.count : cs.length);
    const modeName = { flash: '낱말카드', test: '테스트', mc: '객관식', learn: '학습하기', match: '매칭', review: '복습' }[P.mode];
    const base = (() => { let x = st.cardsIn([...P.sel]); if (P.filter === 'wrong') x = x.filter((c) => c.p?.wrong); return x; })();
    const rc = (k) => base.filter((c) => { const v = st.effRating(c).v; return k === 'none' ? v === null : v === k; }).length;
    view().innerHTML = `
    <h1>학습하기</h1>
    <div class="seg" id="msg" style="margin:10px 0 4px">
      ${[['flash', '낱말카드'], ['learn', '학습하기'], ['test', '테스트'], ['mc', '객관식'], ['match', '매칭'], ['review', '복습(Anki)']].map(([k, l]) => `<button data-v="${k}" class="${P.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small">${{ flash: '카드를 넘기며 외워요. 오른쪽으로 밀면 "알고 있음", 왼쪽은 "학습 중". 사진은 모두 보여요.', learn: '틀린 카드는 조금 뒤에 다시 나와요. 전부 맞혀야 끝나요.', test: '문제를 보고 떠올린 뒤 정답을 확인하고 맞음/틀림을 직접 표시해요. 틀린 문제는 오답노트로 갑니다.', mc: '국시처럼 보기 5개 중 정답을 골라요. 보기는 같은 단원·폴더의 다른 카드 답으로 자동으로 만들어져요. 틀린 문제는 오답노트로 갑니다.', match: '용어와 정의 짝을 빠르게 맞히는 게임이에요. 확인문제·빈칸 카드는 빠져요.', review: 'Anki의 FSRS 알고리즘으로 잊어버릴 때쯤 다시 보여줘요. 매일 하면 가장 효율적이에요.' }[P.mode]}${['test', 'mc', 'learn', 'review'].includes(P.mode) ? ' 확인문제 카드는 정해진 보기 중에서 골라요.' : ''}${P.mode === 'mc' || (P.mode === 'learn' && P.answer === 'mc') ? ' 빈칸 카드는 빈칸 하나를 골라 다른 빈칸들의 답을 보기로 내요.' : ['test', 'review', 'learn'].includes(P.mode) ? ' 빈칸 카드는 빈칸을 눌러 하나씩 열어 보고 채점해요.' : ''}${['test', 'mc', 'learn', 'review', 'match'].includes(P.mode) ? ' 사진이 여러 장인 카드는 한 장만 무작위로 나와요.' : ''}</p>
    <div class="row" style="margin-top:18px;flex-wrap:wrap"><h2 style="margin:0">범위</h2>
      <div class="seg sm" id="vsg">${[['folder', '교재별'], ['topic', '단원별']].map(([k, l]) => `<button data-v="${k}" class="${P.view === k ? 'on' : ''}">${l}</button>`).join('')}</div>
      <span class="spacer"></span>
      <button class="btn sm ghost" id="foldAll">${open.size ? '모두 접기' : '모두 펼치기'}</button>
      <button class="btn sm ghost" id="selAll">전체 선택</button><button class="btn sm ghost" id="selNone">선택 해제</button></div>
    <p class="small muted" style="margin:6px 0 0">${P.view === 'topic' ? '같은 주제의 단원(예: Blank와 문제)을 한 줄로 묶어 보여줘요. 주제 이름을 누르면 묶음 전체가 선택돼요.' : '폴더(교재)별로 보여줘요. ▾를 눌러 펼치세요.'}</p>
    <div class="tree" style="margin-top:10px">
      ${fs.map(P.view === 'topic' ? topicNode : node).join('') || '<div class="empty">먼저 폴더와 카드를 만들어 주세요.</div>'}
    </div>
    <h2>옵션</h2>
    <div class="card">
      ${P.mode !== 'review' ? `<div class="switch"><span>순서 섞기 (랜덤)</span><label class="toggle"><input type="checkbox" id="shuf" ${P.shuffle ? 'checked' : ''}><span></span></label></div>` : ''}
      ${P.mode !== 'match' ? `<div class="switch"><span>먼저 보여줄 면</span><div class="seg" id="dsg">${[['term', '용어'], ['def', '정의'], ...(P.mode === 'review' ? [] : [['mix', '섞기']])].map(([k, l]) => `<button data-v="${k}" class="${P.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      <div class="switch"><span>대상 카드</span><div class="seg" id="fsg">${[['all', '전체'], ['wrong', '오답만']].map(([k, l]) => `<button data-v="${k}" class="${P.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      <div class="switch" style="flex-wrap:wrap"><span>별점 <span class="muted small">(여러 개 선택 가능 · 안 고르면 전체)</span></span>
        <div class="row" id="rsg" style="gap:6px">${[5, 4, 3, 2, 1, 0, 'none'].map((k) => `<button class="chip chip-r ${P.ratings.has(k) ? 'on' : ''}" data-r="${k}">${k === 'none' ? '없음' : '★' + k}<span class="c">${rc(k)}</span></button>`).join('')}</div></div>
      ${P.mode === 'learn' ? `<div class="switch"><span>답하는 방식</span><div class="seg" id="asg">${[['mc', '객관식'], ['self', '직접 채점(O/X)']].map(([k, l]) => `<button data-v="${k}" class="${P.answer === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      ${['test', 'flash', 'mc', 'learn'].includes(P.mode) ? `<div class="switch"><span>문제 수</span><select class="input" id="cnt" style="width:auto">${[0, 10, 20, 30, 50, 100].map((v) => `<option value="${v}" ${+P.count === v ? 'selected' : ''}>${v ? v + '개' : '전부'}</option>`).join('')}</select></div>` : ''}
    </div>
    <div class="pick-bar">
      <div class="card row" style="width:100%;padding:10px 12px 10px 18px"><div><b>${n}장</b> <span class="muted small">${esc(scopeLabel([...P.sel]))}</span></div><span class="spacer"></span>
      <button class="btn primary" id="go" ${n ? '' : 'disabled'}>${modeName} 시작</button></div>
    </div>`;
    bind();
  };
  const bind = () => {
    $$('#msg button').forEach((b) => (b.onclick = () => { P.mode = b.dataset.v; if (P.mode === 'review' && P.dir === 'mix') P.dir = 'term'; draw(); }));
    $('#selAll').onclick = () => { allSets.forEach((s) => P.sel.add(s.id)); draw(); };
    $('#selNone').onclick = () => { P.sel.clear(); draw(); };
    $$('[data-f]').forEach((cb) => {
      const ss = st.setsUnder(cb.dataset.f); const k = ss.filter((s) => P.sel.has(s.id)).length;
      cb.indeterminate = k > 0 && k < ss.length;
      cb.onchange = () => { ss.forEach((s) => (cb.checked ? P.sel.add(s.id) : P.sel.delete(s.id))); draw(); };
    });
    $$('[data-open]').forEach((b) => (b.onclick = () => { const id = b.dataset.open; open.has(id) ? open.delete(id) : open.add(id); saveOpen(); draw(); }));
    $$('#vsg button').forEach((b) => (b.onclick = () => { P.view = b.dataset.v; st.S.local.pickView = P.view; st.save(); draw(); }));
    $('#foldAll').onclick = () => { if (open.size) open.clear(); else st.folderTree().forEach(({ f }) => open.add(f.id)); saveOpen(); draw(); };
    $$('[data-g]').forEach((b) => (b.onclick = () => { const ids = b.dataset.g.split(','); const all = ids.every((id) => P.sel.has(id)); ids.forEach((id) => (all ? P.sel.delete(id) : P.sel.add(id))); draw(); }));
    $$('[data-s]').forEach((cb) => (cb.onchange = () => { cb.checked ? P.sel.add(cb.dataset.s) : P.sel.delete(cb.dataset.s); draw(); }));
    const sh = $('#shuf'); if (sh) sh.onchange = () => { P.shuffle = sh.checked; };
    $$('#dsg button').forEach((b) => (b.onclick = () => { P.dir = b.dataset.v; draw(); }));
    $$('#fsg button').forEach((b) => (b.onclick = () => { P.filter = b.dataset.v; draw(); }));
    $$('#rsg [data-r]').forEach((b) => (b.onclick = () => { const k = b.dataset.r === 'none' ? 'none' : +b.dataset.r; P.ratings.has(k) ? P.ratings.delete(k) : P.ratings.add(k); draw(); }));
    $$('#asg button').forEach((b) => (b.onclick = () => { P.answer = b.dataset.v; draw(); }));
    const cn = $('#cnt'); if (cn) cn.onchange = () => { P.count = +cn.value; draw(); };
    $('#go').onclick = () => {
      const sets = [...P.sel];
      st.S.local.lastPick = { mode: P.mode, sets, shuffle: P.shuffle, dir: P.dir, count: P.count, ratings: [...P.ratings], answer: P.answer }; st.save();
      const idx = new Map(allSets.map((x, i) => [x.id, i]));
      const cards = st.cardsIn(sets).sort((a, b) => idx.get(a.setId) - idx.get(b.setId) || (a.order ?? 0) - (b.order ?? 0));
      study.start(P.mode, cards, { title: scopeLabel(sets), shuffle: P.shuffle, dir: P.dir, filter: P.filter, ratings: [...P.ratings], answer: P.answer, count: P.count, key: 'p:' + sets.sort().join(',') });
    };
  };
  draw();
}

// ================================================================ 오답노트
function wrongView() {
  const ws = st.wrongCards();
  const grad = st.S.settings.gradStreak;
  const groups = new Map();
  for (const c of ws) { const s = st.S.sets[c.setId]; const k = s.id; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(c); }
  const idx = new Map(st.orderedSets().map((x, i) => [x.id, i]));
  const keys = [...groups.keys()].sort((a, b) => (idx.get(a) ?? 0) - (idx.get(b) ?? 0));
  view().innerHTML = `
  <h1>오답노트</h1>
  <p class="muted">테스트에서 틀린 카드가 모여요. <b>연속 ${grad}번</b> 맞히면 자동으로 빠집니다.</p>
  ${ws.length ? `<div class="row" style="margin:12px 0">
    <button class="btn primary" id="t">${I.test} 오답 전체 시험 (${ws.length})</button>
    <button class="btn" id="tmc">${I.test} 오답 객관식</button>
    <button class="btn" id="fl">${I.cards} 오답 낱말카드</button>
    <a class="btn" href="#/study?mode=test&filter=wrong">범위 골라 오답 시험</a></div>` : ''}
  ${keys.map((k) => { const s = st.S.sets[k]; const fl = st.folderPathLabel(s.folderId); const cs = groups.get(k);
    return `<div class="row" style="margin-top:22px"><h2 style="margin:0">${esc(fl)} › ${esc(s.name)}</h2><span class="pill ng">${cs.length}</span><span class="spacer"></span>
      <button class="btn sm" data-tset="${k}">이 단원 오답 시험</button></div>
      <div class="term-list" style="margin-top:10px">${cs.map((c) => `<div class="term-row wrong"><div class="a">${listHTML(c).a}${(c.imgs || []).length ? `<div class="ph-row">${photoBlock(c.imgs, { compact: true })}</div>` : ''}</div><div class="b">${listHTML(c).b}<div class="small muted" style="margin-top:6px">틀림 ${c.p.ng}회 · 연속 정답 ${c.p.streak}/${grad}</div>${c.p.miss && Object.keys(c.p.miss).length ? `<div class="asked">틀린 정답: ${Object.entries(c.p.miss).map(([t, n]) => `<b>${esc(t)}</b>${n > 1 ? ` ×${n}` : ''}`).join(', ')}</div>` : ''}</div>
        <div class="acts"><button class="btn sm ghost" data-clear="${c.id}" title="오답노트에서 빼기">✓ 외웠음</button></div></div>`).join('')}</div>`; }).join('')}
  ${ws.length ? '' : '<div class="empty"><div class="big">🎯</div><p>오답이 없어요!<br>테스트에서 틀린 문제가 여기에 모입니다.</p><a class="btn primary" href="#/study?mode=test">테스트 보러 가기</a></div>'}`;
  hydrate(view());
  const t = $('#t'); if (t) t.onclick = () => study.start('test', ws, { title: '오답노트 전체', shuffle: true, dir: 'term' });
  const tm = $('#tmc'); if (tm) tm.onclick = () => study.start('mc', ws, { title: '오답노트 전체', shuffle: true, dir: 'term' });
  const fl = $('#fl'); if (fl) fl.onclick = () => study.start('flash', ws, { title: '오답노트', shuffle: true, dir: 'term' });
  $$('[data-tset]').forEach((b) => (b.onclick = () => { const s = st.S.sets[b.dataset.tset]; study.start('test', groups.get(b.dataset.tset), { title: `${st.S.folders[s.folderId].name} ${s.name} 오답`, shuffle: true, dir: 'term' }); }));
  $$('[data-clear]').forEach((b) => (b.onclick = () => { const c = st.S.cards[b.dataset.clear]; c.p.wrong = false; c.p.streak = 0; delete c.p.miss; st.touchProgress(c); toast('오답노트에서 뺐어요'); wrongView(); }));
}

// ================================================================ 통계
function statsView() {
  const all = st.allCards();
  const started = all.filter((c) => c.p?.fsrs).length;
  const hist = Object.values(st.S.history).sort((a, b) => b.at - a.at);
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = st.today(d); const v = st.S.days[k] || {}; days.push({ k, d, n: (v.r || 0) + (v.t || 0) + (v.f || 0) }); }
  const max = Math.max(1, ...days.map((d) => d.n));
  const setsAcc = st.orderedSets().map((s) => ({ fl: st.folderPathLabel(s.folderId), s, a: acc(st.cardsOf(s.id)), w: st.cardsOf(s.id).filter((c) => c.p?.wrong).length })).filter((x) => x.a.n > 0).sort((x, y) => x.a.pct - y.a.pct);
  const dd = dday();
  view().innerHTML = `
  <h1>통계</h1>
  <div class="hero">
    ${dd ? `<div class="stat dday"><div class="n">${dd}</div><div class="l">국가고시 ${esc(st.S.settings.examDate)}</div></div>` : ''}
    <div class="stat"><div class="n">${all.length}</div><div class="l">전체 카드</div></div>
    <div class="stat"><div class="n">${started}</div><div class="l">복습 시작한 카드</div></div>
    <div class="stat"><div class="n">${hist.length}</div><div class="l">테스트 횟수</div></div>
  </div>
  <h2>최근 14일 학습량</h2>
  <div class="card"><div class="bars">${days.map((d) => `<div class="b" title="${d.k}: ${d.n}"><i style="height:${(d.n / max) * 100}%"></i><span>${d.d.getDate()}</span></div>`).join('')}</div>
    <div class="muted small" style="margin-top:6px">낱말카드·테스트·복습에서 넘긴 카드 수</div></div>
  <h2>단원별 정답률 <span class="muted small">(낮은 순 = 약한 단원)</span></h2>
  ${setsAcc.length ? `<div class="card" style="overflow-x:auto"><table class="tbl"><tr><th>단원</th><th>정답률</th><th></th><th>푼 횟수</th><th>오답</th></tr>
    ${setsAcc.map((x) => `<tr><td><a href="#/s/${x.s.id}">${esc(x.fl)} › ${esc(x.s.name)}</a></td><td><b>${x.a.pct}%</b></td><td style="width:30%"><div class="meter"><i style="width:${x.a.pct}%"></i></div></td><td>${x.a.n}</td><td>${x.w ? `<span class="pill ng">${x.w}</span>` : '-'}</td></tr>`).join('')}</table></div>`
    : '<div class="card muted">테스트를 보면 단원별 정답률이 나타나요.</div>'}
  <h2>테스트 기록</h2>
  ${hist.length ? `<div class="list">${hist.slice(0, 30).map((h) => `<a class="tile" href="#/result/${h.id}"><div class="row"><span class="t" style="font-size:15px">${esc(h.scope)}</span><span class="spacer"></span><span class="pill ${h.ok / h.total >= 0.8 ? 'ok' : h.ok / h.total < 0.6 ? 'ng' : ''}">${Math.round((h.ok / h.total) * 100)}%</span></div>
    <div class="s">${fmtDate(h.at)} · ${h.ok}/${h.total} 맞음</div></a>`).join('')}</div>` : '<div class="card muted">아직 테스트 기록이 없어요.</div>'}`;
}

// ================================================================ 설정 · 백업
async function settingsView() {
  const S = st.S.settings;
  const last = st.S.local.lastExport;
  const persisted = await st.storagePersisted();
  const canShare = !!(navigator.canShare && navigator.canShare({ files: [new File(['x'], 'a.txt', { type: 'text/plain' })] }));
  const theme = st.S.local.theme || 'auto';
  view().innerHTML = `
  <h1>설정 · 백업</h1>
  <h2>백업 · 기기 간 옮기기</h2>
  <div class="card">
    <p style="margin-top:0">카드와 학습 기록은 <b>이 기기 안에만</b> 저장돼요. PC ↔ 갤탭으로 옮기거나 Claude에게 편집을 맡길 때 백업 파일을 사용하세요.</p>
    <p class="muted small">마지막 백업: ${last ? fmtDate(last) : '없음'} · 카드 ${st.allCards().length}장</p>
    <div class="row">
      <button class="btn primary" id="exp">💾 백업 파일 저장</button>
      ${canShare ? '<button class="btn" id="share">📤 공유하기 (카톡·드라이브)</button>' : ''}
      <button class="btn" id="imp">📂 백업·카드팩 불러오기</button>
      <input type="file" id="file" hidden>
    </div>
    <details style="margin-top:14px"><summary class="small" style="cursor:pointer;font-weight:700">옮기는 방법</summary>
      <ol class="small muted" style="padding-left:20px">
        <li>보내는 기기에서 「백업 파일 저장」 또는 「공유하기」</li>
        <li>파일을 구글 드라이브, 카톡 나에게 보내기, USB 등으로 다른 기기에 옮기기</li>
        <li>받는 기기에서 「백업·카드팩 불러오기」로 선택 → <b>합치기</b></li>
      </ol>
      <p class="small muted">합치기는 양쪽 기기의 카드와 기록을 모두 살리고, 같은 카드는 최근에 바뀐 쪽을 남겨요.</p></details>
  </div>
  <h2>시험 · 학습</h2>
  <div class="card">
    <div class="switch"><span>국가고시 날짜</span><input class="input" type="date" id="exam" value="${esc(S.examDate)}" style="width:auto"></div>
    <div class="switch"><span>복습: 하루 새 카드 수</span><input class="input" type="number" min="0" max="999" id="npd" value="${S.newPerDay}" style="width:100px"></div>
    <div class="switch"><span>오답노트에서 빠지는 연속 정답 수</span><input class="input" type="number" min="1" max="10" id="grad" value="${S.gradStreak}" style="width:100px"></div>
    <div class="switch"><span>확인문제 보기 순서 섞기 <span class="muted small">(끄면 교재·국시 문제 순서 그대로)</span></span><label class="toggle"><input type="checkbox" id="qsh" ${S.qShuffle ? 'checked' : ''}><span></span></label></div>
  </div>
  <h2>화면</h2>
  <div class="card"><div class="switch"><span>테마</span><div class="seg" id="thm">${[['auto', '자동'], ['light', '밝게'], ['dark', '어둡게']].map(([k, l]) => `<button data-v="${k}" class="${theme === k ? 'on' : ''}">${l}</button>`).join('')}</div></div></div>
  <h2>저장 공간</h2>
  <div class="card small">
    <p style="margin-top:0">${persisted ? '✅ 브라우저가 이 앱의 데이터를 <b>영구 보관</b>하도록 설정되어 있어요.' : '⚠️ 영구 보관이 아직 허용되지 않았어요. 앱을 홈 화면에 설치하면 대부분 자동으로 허용됩니다. 그래도 정기적으로 백업해 주세요.'}</p>
    <p class="muted">브라우저의 "인터넷 사용 기록 삭제 → 사이트 데이터"를 지우면 카드가 지워질 수 있어요.</p>
  </div>
  <h2>위험 구역</h2>
  <div class="card"><button class="btn ng" id="reset">이 기기의 모든 데이터 삭제</button></div>
  <p class="muted small" style="margin-top:24px">한의 암기노트 v2.3 · 복습 일정은 Anki의 FSRS 알고리즘(ts-fsrs, MIT)을 사용합니다.</p>`;

  const fname = (ext) => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `암기노트-백업-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.${ext}`; };
  $('#exp').onclick = async () => { toast('백업 파일 만드는 중…'); download(fname('json'), JSON.stringify(await st.exportBackup(), null, 1)); st.markExported(); toast('백업 파일을 저장했어요 (다운로드 폴더)'); setTimeout(settingsView, 600); };
  const sh = $('#share');
  if (sh) sh.onclick = async () => {
    const file = new File([JSON.stringify(await st.exportBackup(), null, 1)], fname('txt'), { type: 'text/plain' });
    try { await navigator.share({ files: [file], title: '암기노트 백업' }); st.markExported(); settingsView(); }
    catch (e) { if (e.name !== 'AbortError') toast('공유에 실패했어요. 「백업 파일 저장」을 사용해 주세요.'); }
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  $('#exam').onchange = (e) => { st.setSettings({ examDate: e.target.value }); toast('저장했어요'); };
  $('#npd').onchange = (e) => { st.setSettings({ newPerDay: Math.max(0, +e.target.value || 0) }); toast('저장했어요'); };
  $('#qsh').onchange = (e) => { st.setSettings({ qShuffle: e.target.checked }); toast('저장했어요'); };
  $('#grad').onchange = (e) => { st.setSettings({ gradStreak: Math.min(10, Math.max(1, +e.target.value || 2)) }); toast('저장했어요'); };
  $$('#thm button').forEach((b) => (b.onclick = () => { st.S.local.theme = b.dataset.v; st.save(); applyTheme(); settingsView(); }));
  $('#reset').onclick = async () => {
    if (!(await confirmBox('정말 모든 데이터를 삭제할까요?', '이 기기의 과목, 카드, 학습 기록이 모두 지워집니다. 먼저 백업 파일을 저장해 두세요.', '모두 삭제', true))) return;
    const n = await ask('확인을 위해 "삭제"라고 입력하세요', '', '삭제', '삭제');
    if (n !== '삭제') return toast('취소했어요');
    await st.resetAll(); toast('삭제했어요'); go('#/');
  };
}
function applyTheme() {
  const t = st.S.local.theme || 'auto';
  if (t === 'auto') document.documentElement.removeAttribute('data-theme'); else document.documentElement.dataset.theme = t;
}

// ================================================================ 시작
(async function init() {
  await st.load();
  applyTheme();
  document.addEventListener('visibilitychange', () => { if (document.hidden && leaveHook) leaveHook(); });
  // 학습 중 새로고침하면 세션이 없으므로 홈으로
  if (/^#\/play/.test(location.hash)) location.hash = '#/';
  route();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // 새 버전이 설치되면: 학습 중이 아닐 때 자동으로 새로고침
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController) return;
      if (/^#\/(play|edit)/.test(location.hash)) toast('새 버전이 준비됐어요. 앱을 다시 열면 적용됩니다.', 4000);
      else location.reload();
    });
  }
})();
