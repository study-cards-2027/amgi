import * as st from './store.js';
import * as study from './study.js';
import { $, $$, esc, I, toast, ask, confirmBox, modal, menu, fmtDate, autoGrow, download, readFile } from './ui.js';

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
  const by = new Map();
  for (const id of setIds) { const s = st.S.sets[id]; if (!s) continue; const f = st.S.folders[s.folderId]; if (!by.has(f)) by.set(f, []); by.get(f).push(s); }
  return [...by.entries()].map(([f, sets]) => {
    const all = st.setsOf(f.id).length === sets.length;
    return all ? `${f.name} 전체` : `${f.name} ${sets.sort((x, y) => (x.order ?? 0) - (y.order ?? 0)).map((s) => s.name).join('·')}`;
  }).join(', ') || '선택 없음';
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
  <div class="row" style="margin-top:22px"><h2 style="margin:0">과목</h2><span class="spacer"></span>
    <a class="btn sm" href="#/import">${I.import} 가져오기</a>
    <button class="btn sm primary" id="addF">${I.plus} 과목</button></div>
  <div class="grid2" style="margin-top:12px">
    ${fs.map((f) => { const ss = st.setsOf(f.id); const cs = ss.flatMap((s) => st.cardsOf(s.id)); const w = cs.filter((c) => c.p?.wrong).length;
      return `<a class="tile" href="#/f/${f.id}"><div class="row"><span class="t">${esc(f.name)}</span><span class="spacer"></span>${w ? `<span class="pill ng">오답 ${w}</span>` : ''}</div>
      <div class="s">단원 ${ss.length}개 · 카드 ${cs.length}장</div></a>`; }).join('')}
  </div>
  ${fs.length ? '' : `<div class="empty"><div class="big">📚</div><p>아직 과목이 없어요.<br>「+ 과목」으로 상한론, 본초학 같은 과목을 만들어 보세요.</p></div>`}`;
  $('#addF').onclick = async () => { const n = await ask('새 과목', '', '예: 상한론'); if (n) { const f = st.addFolder(n); go('#/f/' + f.id); } };
}

// ================================================================ 과목
function folderView(fid) {
  const f = st.S.folders[fid]; if (!f || f.del) return go('#/');
  const ss = st.setsOf(fid);
  view().innerHTML = `
  <div class="crumb"><a href="#/">홈</a></div>
  <div class="topbar"><div><h1>${esc(f.name)}</h1><div class="muted">단원 ${ss.length}개 · 카드 ${ss.reduce((n, s) => n + st.cardsOf(s.id).length, 0)}장</div></div>
    <span class="spacer"></span><div><button class="icon-btn" id="more">${I.more}</button></div></div>
  <div class="row">
    <a class="btn primary" href="#/study?mode=test&folder=${fid}">${I.test} 범위 골라 시험</a>
    <a class="btn" href="#/study?mode=flash&folder=${fid}">${I.cards} 낱말카드</a>
    <button class="btn" id="addS">${I.plus} 단원</button>
  </div>
  <div class="list" style="margin-top:16px">
    ${ss.map((s) => { const cs = st.cardsOf(s.id); const a = acc(cs); const w = cs.filter((c) => c.p?.wrong).length;
      return `<a class="tile" href="#/s/${s.id}"><div class="row"><span class="t">${esc(s.name)}</span><span class="spacer"></span>${w ? `<span class="pill ng">오답 ${w}</span>` : ''}${a.pct !== null ? `<span class="pill ${a.pct >= 80 ? 'ok' : ''}">정답률 ${a.pct}%</span>` : ''}</div>
      <div class="s">카드 ${cs.length}장</div></a>`; }).join('')}
  </div>
  ${ss.length ? '' : `<div class="empty"><div class="big">🗂️</div><p>「+ 단원」으로 1단원, 2단원 등을 만들어 보세요.</p></div>`}`;
  $('#addS').onclick = async () => { const n = await ask('새 단원', '', `예: ${ss.length + 1}단원`); if (n) { const s = st.addSet(fid, n); go('#/s/' + s.id); } };
  $('#more').onclick = (e) => menu(e.currentTarget, [
    { label: '과목 이름 바꾸기', run: async () => { const n = await ask('과목 이름', f.name); if (n) { st.rename('folder', fid, n); route(); } } },
    { label: '위로 이동', run: () => { st.moveOrder('folder', fid, -1); toast('순서를 바꿨어요'); } },
    { label: '아래로 이동', run: () => { st.moveOrder('folder', fid, 1); toast('순서를 바꿨어요'); } },
    { label: '과목 삭제', danger: true, run: async () => { if (await confirmBox(`'${f.name}' 과목을 삭제할까요?`, '안의 단원과 카드도 모두 삭제됩니다.', '삭제', true)) { st.deleteFolder(fid); go('#/'); } } },
  ]);
}

// ================================================================ 단원 (세트)
function setView(sid, q = {}) {
  const s = st.S.sets[sid]; if (!s || s.del) return go('#/');
  const f = st.S.folders[s.folderId];
  const filter = q.v || 'all';
  const all = st.cardsOf(sid);
  const cs = filter === 'star' ? all.filter((c) => c.star) : filter === 'wrong' ? all.filter((c) => c.p?.wrong) : all;
  const a = acc(all);
  view().innerHTML = `
  <div class="crumb"><a href="#/">홈</a> › <a href="#/f/${f.id}">${esc(f.name)}</a></div>
  <div class="topbar"><div><h1>${esc(s.name)}</h1><div class="muted">카드 ${all.length}장${a.pct !== null ? ` · 정답률 ${a.pct}%` : ''}</div></div>
    <span class="spacer"></span><div><button class="icon-btn" id="more">${I.more}</button></div></div>
  <div class="modes">
    <button class="mode" data-m="flash">${I.cards}낱말카드</button>
    <button class="mode" data-m="test">${I.test}테스트</button>
    <button class="mode" data-m="match">${I.match}매칭</button>
    <button class="mode" data-m="review">${I.review}복습</button>
  </div>
  <div class="row" style="margin-top:18px">
    <div class="seg" id="vf"><button data-v="all" class="${filter === 'all' ? 'on' : ''}">전체 ${all.length}</button><button data-v="star" class="${filter === 'star' ? 'on' : ''}">별표 ${all.filter((c) => c.star).length}</button><button data-v="wrong" class="${filter === 'wrong' ? 'on' : ''}">오답 ${all.filter((c) => c.p?.wrong).length}</button></div>
    <span class="spacer"></span>
    <a class="btn sm" href="#/import?set=${sid}">${I.import} 가져오기</a>
    <a class="btn sm primary" href="#/edit/${sid}">${I.edit} 카드 편집</a>
  </div>
  <div class="term-list" style="margin-top:12px">
    ${cs.map((c) => `<div class="term-row ${c.p?.wrong ? 'wrong' : ''}"><div class="a">${esc(c.term)}</div><div class="b">${esc(c.def)}</div>
      <div class="acts"><button class="icon-btn ${c.star ? 'star-on' : ''}" data-star="${c.id}" title="별표">${c.star ? I.starFill : I.star}</button>
      <a class="icon-btn" href="#/edit/${sid}?focus=${c.id}" title="편집">${I.edit}</a></div></div>`).join('')}
  </div>
  ${all.length ? (cs.length ? '' : '<div class="empty">해당하는 카드가 없어요.</div>') : `<div class="empty"><div class="big">🃏</div><p>카드가 없어요.<br>「카드 편집」에서 직접 쓰거나, 「가져오기」로 엑셀 표를 붙여넣으세요.</p><a class="btn primary" href="#/edit/${sid}">카드 만들기</a></div>`}`;
  $$('#vf button').forEach((b) => (b.onclick = () => go(`#/s/${sid}${b.dataset.v === 'all' ? '' : '?v=' + b.dataset.v}`)));
  $$('[data-star]').forEach((b) => (b.onclick = () => { st.toggleStar(b.dataset.star); setView(sid, q); }));
  $$('[data-m]').forEach((b) => (b.onclick = () => {
    const m = b.dataset.m; const title = `${f.name} ${s.name}`;
    if (!all.length) return toast('먼저 카드를 추가해 주세요.');
    if (m === 'test') return go(`#/study?mode=test&sets=${sid}`);
    study.start(m, all, { title, shuffle: m !== 'flash', dir: 'term', key: 's:' + sid });
  }));
  $('#more').onclick = (e) => menu(e.currentTarget, [
    { label: '단원 이름 바꾸기', run: async () => { const n = await ask('단원 이름', s.name); if (n) { st.rename('set', sid, n); route(); } } },
    { label: '위로 이동', run: () => { st.moveOrder('set', sid, -1); toast('순서를 바꿨어요'); } },
    { label: '아래로 이동', run: () => { st.moveOrder('set', sid, 1); toast('순서를 바꿨어요'); } },
    { label: '다른 과목으로 옮기기', run: () => moveSet(sid) },
    { label: '단원 삭제', danger: true, run: async () => { if (await confirmBox(`'${s.name}'을(를) 삭제할까요?`, `카드 ${all.length}장도 함께 삭제됩니다.`, '삭제', true)) { st.deleteSet(sid); go('#/f/' + f.id); } } },
  ]);
}
async function moveSet(sid) {
  const s = st.S.sets[sid];
  const fs = st.folders().filter((f) => f.id !== s.folderId);
  if (!fs.length) return toast('옮길 다른 과목이 없어요.');
  const to = await modal(`<h3>어느 과목으로 옮길까요?</h3><div class="list">${fs.map((f) => `<button class="btn block" data-f="${f.id}">${esc(f.name)}</button>`).join('')}</div>
    <div class="row end"><button class="btn ghost" data-x>취소</button></div>`, (m, close) => {
    $$('[data-f]', m).forEach((b) => (b.onclick = () => close(b.dataset.f))); $('[data-x]', m).onclick = () => close(null);
  });
  if (!to) return;
  s.folderId = to; s.order = st.setsOf(to).length; s.u = Date.now(); st.save(); toast('옮겼어요'); route();
}

// ================================================================ 카드 편집기 (퀴즐렛식, 자동 저장)
function editor(sid, q = {}) {
  const s = st.S.sets[sid]; if (!s || s.del) return go('#/');
  const f = st.S.folders[s.folderId];
  let rows = st.cardsOf(sid).map((c) => ({ id: c.id, term: c.term, def: c.def }));
  if (!rows.length) rows = [{ term: '', def: '' }, { term: '', def: '' }, { term: '', def: '' }];
  const removed = new Set();
  let dirty = false, timer = null;

  const flush = () => {
    clearTimeout(timer); if (!dirty) return; dirty = false;
    // 순서/내용 저장
    let order = 0;
    $$('.ed-row').forEach((el) => {
      const r = rows[+el.dataset.i]; if (!r) return;
      const term = r.term.trim(), def = r.def.trim();
      if (r.id && st.S.cards[r.id] && !st.S.cards[r.id].del) {
        const c = st.S.cards[r.id];
        if (!term && !def) { st.deleteCard(r.id); r.id = null; return; }
        if (c.term !== term || c.def !== def || c.order !== order) { c.term = term; c.def = def; c.order = order; c.cu = Date.now(); }
        order++;
      } else if (term || def) { const c = st.newCard(sid, term, def, order); r.id = c.id; order++; }
    });
    for (const id of removed) st.deleteCard(id);
    removed.clear(); st.save(true);
    const sv = $('#saved'); if (sv) { sv.textContent = '저장됨 ✓'; }
  };
  const touch = () => { dirty = true; const sv = $('#saved'); if (sv) sv.textContent = '저장 중…'; clearTimeout(timer); timer = setTimeout(flush, 600); };
  leaveHook = flush;

  const rowHtml = (r, i, n) => `<div class="ed-row" data-i="${i}"><div class="ed-head"><span>${n}</span><span class="spacer"></span>
      <button class="icon-btn" data-swap title="용어↔정의 바꾸기">${I.flip}</button><button class="icon-btn" data-del title="삭제">${I.trash}</button></div>
    <div class="ed-body"><div><textarea rows="1" data-k="term" placeholder="용어 (A)">${esc(r.term)}</textarea><div class="cap">용어</div></div>
    <div><textarea rows="1" data-k="def" placeholder="정의 (B)">${esc(r.def)}</textarea><div class="cap">정의</div></div></div></div>`;
  const draw = () => {
    view().innerHTML = `
    <div class="crumb"><a href="#/">홈</a> › <a href="#/f/${f.id}">${esc(f.name)}</a> › <a href="#/s/${sid}">${esc(s.name)}</a></div>
    <div class="sticky-bar"><h1 style="margin:0;font-size:22px">카드 편집</h1><span class="muted small" id="saved">자동 저장</span><span class="spacer"></span>
      <a class="btn primary" href="#/s/${sid}">완료</a></div>
    <div id="rows">${rows.map((r, i) => rowHtml(r, i, i + 1)).join('')}</div>
    <button class="ed-add" id="add"><span>+ 카드 추가</span></button>
    <p class="muted small" style="text-align:center">마지막 칸에서 Tab을 누르면 새 카드가 생겨요. 줄바꿈은 Enter.</p>`;
    bind();
  };
  const renumber = () => $$('.ed-row').forEach((el, k) => { $('.ed-head span', el).textContent = k + 1; });
  const bindRow = (el) => {
    const i = +el.dataset.i;
    $$('textarea', el).forEach((ta) => {
      autoGrow(ta);
      ta.oninput = () => { rows[i][ta.dataset.k] = ta.value; autoGrow(ta); touch(); };
      ta.onkeydown = (e) => {
        if (e.key === 'Tab' && !e.shiftKey && ta.dataset.k === 'def' && el === $$('.ed-row').at(-1)) { e.preventDefault(); addRow(); }
      };
    });
    $('[data-del]', el).onclick = () => { if (rows[i].id) removed.add(rows[i].id); rows[i] = null; el.remove(); renumber(); dirty = true; flush(); };
    $('[data-swap]', el).onclick = () => {
      const r = rows[i]; [r.term, r.def] = [r.def, r.term];
      const [a, b] = $$('textarea', el); a.value = r.term; b.value = r.def; autoGrow(a); autoGrow(b); touch();
    };
  };
  const addRow = () => {
    rows.push({ term: '', def: '' });
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
  const fs = st.folders();
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
      <p class="muted small" style="margin:6px 0 0">카드팩에는 과목·단원 이름이 들어 있어서 알맞은 곳에 자동으로 들어갑니다.</p>
    </div>
    <h2>붙여넣기</h2>
    <div class="card">
      <div class="grid2">
        <div><label class="f">과목</label><select class="input" id="fsel">${fs.map((f) => `<option value="${f.id}" ${f.id === P.fid ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}<option value="new" ${P.fid === 'new' ? 'selected' : ''}>+ 새 과목…</option></select>
          ${P.fid === 'new' ? `<input class="input" id="newF" style="margin-top:8px" placeholder="새 과목 이름" value="${esc(P.newF)}">` : ''}</div>
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
    if (fid === 'new') { if (!P.newF.trim()) return toast('새 과목 이름을 입력해 주세요.'); fid = st.addFolder(P.newF).id; sid = 'new'; }
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
  // 카드팩
  const rows = st.previewPack(parsed.data);
  const add = rows.filter((r) => !r.dup).length, dup = rows.length - add;
  const newSets = [...new Set(rows.filter((r) => r.newSet).map((r) => `${r.folder} › ${r.set}`))];
  view().innerHTML = `
  <div class="crumb"><a href="#/">홈</a> › <a href="#/import">가져오기</a></div>
  <h1>카드팩 확인</h1>
  <p class="muted">${esc(file.name)} · 카드 ${rows.length}장${parsed.data.title ? ` · ${esc(parsed.data.title)}` : ''}</p>
  ${newSets.length ? `<div class="banner">새로 만들어질 단원: ${newSets.map(esc).join(', ')}</div>` : ''}
  <p class="small muted">표의 용어·정의 칸을 눌러 바로 고칠 수 있어요. 회색 줄은 이미 같은 카드가 있어서 건너뜁니다.</p>
  <div class="pv"><table><tr><th>과목 › 단원</th><th>용어 (A)</th><th>정의 (B)</th><th></th></tr>
  ${rows.map((r, i) => `<tr class="${r.dup ? 'dup' : ''}" data-i="${i}"><td class="muted">${esc(r.folder)} › ${esc(r.set)}</td><td contenteditable data-k="term">${esc(r.term)}</td><td contenteditable data-k="def">${esc(r.def)}</td>
    <td><label class="chk"><input type="checkbox" ${r.dup ? 'disabled' : 'checked'} data-use></label></td></tr>`).join('')}</table></div>
  <div class="row end" style="margin-top:14px"><a class="btn ghost" href="#/import">취소</a><button class="btn primary" id="apply">${add}장 추가${dup ? ` (중복 ${dup}장 제외)` : ''}</button></div>`;
  $$('.pv td[contenteditable]').forEach((td) => (td.oninput = () => { rows[+td.parentElement.dataset.i][td.dataset.k] = td.innerText.trim(); }));
  $$('[data-use]').forEach((cb) => (cb.onchange = () => { rows[+cb.closest('tr').dataset.i].skip = !cb.checked; }));
  $('#apply').onclick = () => {
    const r = st.applyPack(rows);
    toast(`${r.added}장 추가${r.skipped ? `, ${r.skipped}장 건너뜀` : ''}`, 3000);
    go('#/');
  };
}

async function importBackupFlow(d) {
  const nCards = (d.cards || []).filter((c) => !c.del).length;
  const ok = await confirmBox('백업 파일 합치기',
    `${esc((d.exportedAt || '').slice(0, 16).replace('T', ' '))} 에 저장된 백업 (카드 ${nCards}장)<br><br>
    이 기기의 데이터와 <b>합칩니다</b>. 같은 카드는 더 최근에 바뀐 쪽이 남고, 어느 쪽에만 있는 카드는 모두 유지됩니다. 학습 기록도 함께 합쳐집니다.`, '합치기');
  if (!ok) return;
  const r = st.mergeBackup(d);
  await modal(`<h3>합치기 완료</h3><p>카드 ${r.cards}장 추가·수정, 학습 기록 ${r.progress}건 갱신, 과목 ${r.folders} · 단원 ${r.sets} · 시험 기록 ${r.history}건 반영</p>
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
    shuffle: last.shuffle ?? true, dir: last.dir || 'term', filter: q.filter || 'all', count: last.count || 0,
  };
  if (q.sets) q.sets.split(',').forEach((id) => st.S.sets[id] && P.sel.add(id));
  else if (q.folder) st.setsOf(q.folder).forEach((s) => P.sel.add(s.id));
  else if (q.all) fs.forEach((f) => st.setsOf(f.id).forEach((s) => P.sel.add(s.id)));
  else (last.sets || []).forEach((id) => st.S.sets[id] && !st.S.sets[id].del && P.sel.add(id));
  const open = new Set(fs.filter((f) => st.setsOf(f.id).some((s) => P.sel.has(s.id))).map((f) => f.id));
  if (!open.size && fs[0]) open.add(fs[0].id);

  const filtered = () => {
    let cs = st.cardsIn([...P.sel]);
    if (P.filter === 'star') cs = cs.filter((c) => c.star);
    if (P.filter === 'wrong') cs = cs.filter((c) => c.p?.wrong);
    return cs;
  };
  const draw = () => {
    const cs = filtered();
    const n = P.mode === 'review' ? study.reviewCounts(cs).total : (P.count && P.count < cs.length ? P.count : cs.length);
    const modeName = { flash: '낱말카드', test: '테스트', match: '매칭', review: '복습' }[P.mode];
    view().innerHTML = `
    <h1>학습하기</h1>
    <div class="seg" id="msg" style="margin:10px 0 4px">
      ${[['flash', '낱말카드'], ['test', '테스트'], ['match', '매칭'], ['review', '복습(Anki)']].map(([k, l]) => `<button data-v="${k}" class="${P.mode === k ? 'on' : ''}">${l}</button>`).join('')}</div>
    <p class="muted small">${{ flash: '카드를 넘기며 외워요. 오른쪽으로 밀면 "알고 있음", 왼쪽은 "학습 중".', test: '문제를 보고 떠올린 뒤 정답을 확인하고 맞음/틀림을 직접 표시해요. 틀린 문제는 오답노트로 갑니다.', match: '용어와 정의 짝을 빠르게 맞히는 게임이에요.', review: 'Anki의 FSRS 알고리즘으로 잊어버릴 때쯤 다시 보여줘요. 매일 하면 가장 효율적이에요.' }[P.mode]}</p>
    <div class="row" style="margin-top:18px"><h2 style="margin:0">범위</h2><span class="spacer"></span>
      <button class="btn sm ghost" id="selAll">전체 선택</button><button class="btn sm ghost" id="selNone">선택 해제</button></div>
    <div class="tree" style="margin-top:10px">
      ${fs.map((f) => { const ss = st.setsOf(f.id); const k = ss.filter((s) => P.sel.has(s.id)).length;
        return `<div class="fold"><div class="fh"><label class="chk"><input type="checkbox" data-f="${f.id}" ${k && k === ss.length ? 'checked' : ''}><span>${esc(f.name)}</span></label>
          <span class="cnt pill ${k ? 'pr' : ''}">${k}/${ss.length}</span><button class="icon-btn" data-open="${f.id}">${open.has(f.id) ? I.up : I.down}</button></div>
          ${open.has(f.id) ? `<div class="sets">${ss.map((s) => `<label class="chip ${P.sel.has(s.id) ? 'on' : ''}"><input type="checkbox" data-s="${s.id}" ${P.sel.has(s.id) ? 'checked' : ''}>${esc(s.name)}<span class="c">${st.cardsOf(s.id).length}</span></label>`).join('') || '<span class="muted small">단원이 없어요</span>'}</div>` : ''}</div>`; }).join('') || '<div class="empty">먼저 과목과 카드를 만들어 주세요.</div>'}
    </div>
    <h2>옵션</h2>
    <div class="card">
      ${P.mode !== 'review' ? `<div class="switch"><span>순서 섞기 (랜덤)</span><label class="toggle"><input type="checkbox" id="shuf" ${P.shuffle ? 'checked' : ''}><span></span></label></div>` : ''}
      ${P.mode !== 'match' ? `<div class="switch"><span>먼저 보여줄 면</span><div class="seg" id="dsg">${[['term', '용어'], ['def', '정의'], ...(P.mode === 'review' ? [] : [['mix', '섞기']])].map(([k, l]) => `<button data-v="${k}" class="${P.dir === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>` : ''}
      <div class="switch"><span>대상 카드</span><div class="seg" id="fsg">${[['all', '전체'], ['star', '별표만'], ['wrong', '오답만']].map(([k, l]) => `<button data-v="${k}" class="${P.filter === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
      ${P.mode === 'test' || P.mode === 'flash' ? `<div class="switch"><span>문제 수</span><select class="input" id="cnt" style="width:auto">${[0, 10, 20, 30, 50, 100].map((v) => `<option value="${v}" ${+P.count === v ? 'selected' : ''}>${v ? v + '개' : '전부'}</option>`).join('')}</select></div>` : ''}
    </div>
    <div class="pick-bar">
      <div class="card row" style="width:100%;padding:10px 12px 10px 18px"><div><b>${n}장</b> <span class="muted small">${esc(scopeLabel([...P.sel]))}</span></div><span class="spacer"></span>
      <button class="btn primary" id="go" ${n ? '' : 'disabled'}>${modeName} 시작</button></div>
    </div>`;
    bind();
  };
  const bind = () => {
    $$('#msg button').forEach((b) => (b.onclick = () => { P.mode = b.dataset.v; if (P.mode === 'review' && P.dir === 'mix') P.dir = 'term'; draw(); }));
    $('#selAll').onclick = () => { fs.forEach((f) => st.setsOf(f.id).forEach((s) => P.sel.add(s.id))); draw(); };
    $('#selNone').onclick = () => { P.sel.clear(); draw(); };
    $$('[data-f]').forEach((cb) => {
      const ss = st.setsOf(cb.dataset.f); const k = ss.filter((s) => P.sel.has(s.id)).length;
      cb.indeterminate = k > 0 && k < ss.length;
      cb.onchange = () => { ss.forEach((s) => (cb.checked ? P.sel.add(s.id) : P.sel.delete(s.id))); open.add(cb.dataset.f); draw(); };
    });
    $$('[data-open]').forEach((b) => (b.onclick = () => { const id = b.dataset.open; open.has(id) ? open.delete(id) : open.add(id); draw(); }));
    $$('[data-s]').forEach((cb) => (cb.onchange = () => { cb.checked ? P.sel.add(cb.dataset.s) : P.sel.delete(cb.dataset.s); draw(); }));
    const sh = $('#shuf'); if (sh) sh.onchange = () => { P.shuffle = sh.checked; };
    $$('#dsg button').forEach((b) => (b.onclick = () => { P.dir = b.dataset.v; draw(); }));
    $$('#fsg button').forEach((b) => (b.onclick = () => { P.filter = b.dataset.v; draw(); }));
    const cn = $('#cnt'); if (cn) cn.onchange = () => { P.count = +cn.value; draw(); };
    $('#go').onclick = () => {
      const sets = [...P.sel];
      st.S.local.lastPick = { mode: P.mode, sets, shuffle: P.shuffle, dir: P.dir, count: P.count }; st.save();
      const cards = st.cardsIn(sets).sort((a, b) => {
        const sa = st.S.sets[a.setId], sb = st.S.sets[b.setId];
        const fa = st.S.folders[sa.folderId], fb = st.S.folders[sb.folderId];
        return (fa.order ?? 0) - (fb.order ?? 0) || (sa.order ?? 0) - (sb.order ?? 0) || (a.order ?? 0) - (b.order ?? 0);
      });
      study.start(P.mode, cards, { title: scopeLabel(sets), shuffle: P.shuffle, dir: P.dir, filter: P.filter, count: P.count, key: 'p:' + sets.sort().join(',') });
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
  const keys = [...groups.keys()].sort((a, b) => {
    const sa = st.S.sets[a], sb = st.S.sets[b]; const fa = st.S.folders[sa.folderId], fb = st.S.folders[sb.folderId];
    return (fa.order ?? 0) - (fb.order ?? 0) || (sa.order ?? 0) - (sb.order ?? 0);
  });
  view().innerHTML = `
  <h1>오답노트</h1>
  <p class="muted">테스트에서 틀린 카드가 모여요. <b>연속 ${grad}번</b> 맞히면 자동으로 빠집니다.</p>
  ${ws.length ? `<div class="row" style="margin:12px 0">
    <button class="btn primary" id="t">${I.test} 오답 전체 시험 (${ws.length})</button>
    <button class="btn" id="fl">${I.cards} 오답 낱말카드</button>
    <a class="btn" href="#/study?mode=test&filter=wrong">범위 골라 오답 시험</a></div>` : ''}
  ${keys.map((k) => { const s = st.S.sets[k]; const f = st.S.folders[s.folderId]; const cs = groups.get(k);
    return `<div class="row" style="margin-top:22px"><h2 style="margin:0">${esc(f.name)} › ${esc(s.name)}</h2><span class="pill ng">${cs.length}</span><span class="spacer"></span>
      <button class="btn sm" data-tset="${k}">이 단원 오답 시험</button></div>
      <div class="term-list" style="margin-top:10px">${cs.map((c) => `<div class="term-row wrong"><div class="a">${esc(c.term)}</div><div class="b">${esc(c.def)}<div class="small muted" style="margin-top:6px">틀림 ${c.p.ng}회 · 연속 정답 ${c.p.streak}/${grad}</div></div>
        <div class="acts"><button class="btn sm ghost" data-clear="${c.id}" title="오답노트에서 빼기">✓ 외웠음</button></div></div>`).join('')}</div>`; }).join('')}
  ${ws.length ? '' : '<div class="empty"><div class="big">🎯</div><p>오답이 없어요!<br>테스트에서 틀린 문제가 여기에 모입니다.</p><a class="btn primary" href="#/study?mode=test">테스트 보러 가기</a></div>'}`;
  const t = $('#t'); if (t) t.onclick = () => study.start('test', ws, { title: '오답노트 전체', shuffle: true, dir: 'term' });
  const fl = $('#fl'); if (fl) fl.onclick = () => study.start('flash', ws, { title: '오답노트', shuffle: true, dir: 'term' });
  $$('[data-tset]').forEach((b) => (b.onclick = () => { const s = st.S.sets[b.dataset.tset]; study.start('test', groups.get(b.dataset.tset), { title: `${st.S.folders[s.folderId].name} ${s.name} 오답`, shuffle: true, dir: 'term' }); }));
  $$('[data-clear]').forEach((b) => (b.onclick = () => { const c = st.S.cards[b.dataset.clear]; c.p.wrong = false; c.p.streak = 0; st.touchProgress(c); toast('오답노트에서 뺐어요'); wrongView(); }));
}

// ================================================================ 통계
function statsView() {
  const all = st.allCards();
  const started = all.filter((c) => c.p?.fsrs).length;
  const hist = Object.values(st.S.history).sort((a, b) => b.at - a.at);
  const days = [];
  for (let i = 13; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); const k = st.today(d); const v = st.S.days[k] || {}; days.push({ k, d, n: (v.r || 0) + (v.t || 0) + (v.f || 0) }); }
  const max = Math.max(1, ...days.map((d) => d.n));
  const setsAcc = st.folders().flatMap((f) => st.setsOf(f.id).map((s) => ({ f, s, a: acc(st.cardsOf(s.id)), w: st.cardsOf(s.id).filter((c) => c.p?.wrong).length }))).filter((x) => x.a.n > 0).sort((x, y) => x.a.pct - y.a.pct);
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
    ${setsAcc.map((x) => `<tr><td><a href="#/s/${x.s.id}">${esc(x.f.name)} › ${esc(x.s.name)}</a></td><td><b>${x.a.pct}%</b></td><td style="width:30%"><div class="meter"><i style="width:${x.a.pct}%"></i></div></td><td>${x.a.n}</td><td>${x.w ? `<span class="pill ng">${x.w}</span>` : '-'}</td></tr>`).join('')}</table></div>`
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
  <p class="muted small" style="margin-top:24px">한의 암기노트 · 복습 일정은 Anki의 FSRS 알고리즘(ts-fsrs, MIT)을 사용합니다.</p>`;

  const fname = (ext) => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `암기노트-백업-${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}-${z(d.getHours())}${z(d.getMinutes())}.${ext}`; };
  $('#exp').onclick = () => { download(fname('json'), JSON.stringify(st.exportBackup(), null, 1)); st.markExported(); toast('백업 파일을 저장했어요 (다운로드 폴더)'); setTimeout(settingsView, 600); };
  const sh = $('#share');
  if (sh) sh.onclick = async () => {
    const file = new File([JSON.stringify(st.exportBackup(), null, 1)], fname('txt'), { type: 'text/plain' });
    try { await navigator.share({ files: [file], title: '암기노트 백업' }); st.markExported(); settingsView(); }
    catch (e) { if (e.name !== 'AbortError') toast('공유에 실패했어요. 「백업 파일 저장」을 사용해 주세요.'); }
  };
  $('#imp').onclick = () => $('#file').click();
  $('#file').onchange = (e) => { const f = e.target.files[0]; e.target.value = ''; if (f) importFile(f); };
  $('#exam').onchange = (e) => { st.setSettings({ examDate: e.target.value }); toast('저장했어요'); };
  $('#npd').onchange = (e) => { st.setSettings({ newPerDay: Math.max(0, +e.target.value || 0) }); toast('저장했어요'); };
  $('#grad').onchange = (e) => { st.setSettings({ gradStreak: Math.min(10, Math.max(1, +e.target.value || 2)) }); toast('저장했어요'); };
  $$('#thm button').forEach((b) => (b.onclick = () => { st.S.local.theme = b.dataset.v; st.save(); applyTheme(); settingsView(); }));
  $('#reset').onclick = async () => {
    if (!(await confirmBox('정말 모든 데이터를 삭제할까요?', '이 기기의 과목, 카드, 학습 기록이 모두 지워집니다. 먼저 백업 파일을 저장해 두세요.', '모두 삭제', true))) return;
    const n = await ask('확인을 위해 "삭제"라고 입력하세요', '', '삭제', '삭제');
    if (n !== '삭제') return toast('취소했어요');
    st.resetAll(); toast('삭제했어요'); go('#/');
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
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
