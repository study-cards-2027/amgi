// 학습 모드: 낱말카드 / 테스트 / 매칭 / 복습(FSRS) / 결과
import * as st from './store.js';
import { $, $$, esc, I, shuffle, toast, confirmBox, fmtDur, starsHTML, pickRating } from './ui.js';
import { photoBlock, hydrate, pickOne } from './media.js';
import { kindOf, clozeHTML, clozeAnswers, clozeCount, clozePlain, fixedChoices, qAnswerText, listHTML, circ, isRot, rotAnswers, pickTarget, rotChoices, groupKey } from './kinds.js';

export let session = null;
const view = () => $('#view');
const go = (h) => { if (location.hash === h) window.dispatchEvent(new HashChangeEvent('hashchange')); else location.hash = h; };

// 카드의 앞/뒤 (dir: term | def | mix)
function sides(c, dir, photo = 'one') {
  const d = dir === 'mix' ? (Math.random() < 0.5 ? 'term' : 'def') : dir;
  const imgs = photo === 'all' ? (c.imgs || []).slice() : pickOne(c.imgs);
  return d === 'def'
    ? { q: c.def, a: c.term, ql: '정의', al: '용어', qi: [], ai: imgs, ak: 'term' }
    : { q: c.term, a: c.def, ql: '용어', al: '정의', qi: imgs, ai: [], ak: 'def' };
}
// v2.1: 모든 형식의 카드 → 화면용 면. 확인문제·빈칸은 방향(dir)과 상관없이 문제 → 정답
function faceOf(c, dir, photo = 'one') {
  const k = kindOf(c);
  if (k === 'question') return { kind: k, ql: '문제', q: c.term, qi: photo === 'all' ? (c.imgs || []).slice() : pickOne(c.imgs), al: '정답', a: qAnswerText(c), ai: [], ex: c.def, exl: '해설' };
  if (k === 'cloze') return { kind: k, ql: '빈칸', q: c.term, qi: [], al: '정답', a: clozePlain(c.term, 'answer'), ai: [], ex: c.def, exl: '메모', n: clozeCount(c.term) };
  return { kind: 'basic', ...sides(c, dir, photo) };
}
// 문제 칸 HTML (빈칸은 cz 옵션: open/all/target/tap)
function promptHTML(f, cz = {}, extra = '') {
  const body = f.kind === 'cloze' ? clozeHTML(f.q, cz) : esc(f.q);
  return `<div class="q ${f.kind !== 'basic' ? 'q-' + f.kind : ''}" id="q"><div class="lab">${f.ql}${extra}</div>${photoBlock(f.qi)}<div class="txt">${body}</div></div>`;
}
const exHTML = (f) => (f.ex ? `<div class="ans ex"><div class="lab">${f.exl}</div><div class="txt">${esc(f.ex)}</div></div>` : '');
// 직접 채점 영역: 정답 보기 전/후
function selfHTML(f, s) {
  if (f.kind === 'cloze') {
    const opened = s.cz ? s.cz.size : 0;
    return `${promptHTML(f, { open: s.cz, all: s.revealed, tap: !s.revealed })}
      ${s.revealed ? exHTML(f) : `<div class="row small muted" style="margin-top:10px;justify-content:center">빈칸을 누르면 하나씩 열려요 (${opened}/${f.n})</div>
      <div style="margin-top:10px"><button class="btn primary block" style="min-height:60px;font-size:18px" data-reveal>${opened ? '나머지 모두 보기' : '모두 보기'}</button></div>`}`;
  }
  return `${promptHTML(f)}
    ${s.revealed ? `<div class="ans"><div class="lab">정답 · ${f.al}</div>${photoBlock(f.ai)}<div class="txt">${esc(f.a)}</div></div>`
      : `<div style="margin-top:18px"><button class="btn primary block" style="min-height:60px;font-size:18px" data-reveal>정답 보기</button></div>`}`;
}
function bindSelf(f, s, rerender) {
  const reveal = () => { s.revealed = true; rerender(); };
  if (s.revealed) return reveal;
  const rb = $('[data-reveal]'); if (rb) rb.onclick = reveal;
  if (f.kind === 'cloze') {
    $$('.cz.tap').forEach((el) => (el.onclick = (e) => {
      e.stopPropagation(); s.cz = s.cz || new Set(); s.cz.add(+el.dataset.cz);
      if (s.cz.size >= f.n) s.revealed = true; rerender();
    }));
  } else { const q = $('#q'); if (q) q.onclick = reveal; }
  return reveal;
}
// 객관식 보기: 확인문제는 고정 보기, 빈칸은 다른 빈칸 정답으로, 기본은 다른 카드로. 만들 수 없으면 null(직접 채점)
function mcFor(c, f, s, how) {
  if (f.kind === 'question' && isRot(c)) {
    if (!s.choices[c.id]) { const t = rotTarget(c, s); s.choices[c.id] = { ch: rotChoices(c, t), ans: t }; }
    return s.choices[c.id];
  }
  if (f.kind === 'question') return s.choices[c.id] || (s.choices[c.id] = { ch: fixedChoices(c, !!st.S.settings.qShuffle) });
  if (how !== 'mc') return null;
  const x = s.choices[c.id] || (s.choices[c.id] = f.kind === 'cloze' ? clozeMC(c, s.src) : { ch: buildChoices(c, f, s.src) });
  return x.ch ? x : null;
}
// v2.2 정답 돌려쓰기: 이번에 정답으로 낼 처방 고르기
// 학습하기: 틀려서 다시 나온 카드는 같은 처방, 아니면 묶음에서 아직 못 맞힌 처방 중 덜 나온 것. 그 밖: 덜 맞힌·덜 나온 처방
function rotTarget(c, s) {
  if (s.mode === 'learn') {
    if (s.keepT && s.keepT[c.id]) { const t = s.keepT[c.id]; delete s.keepT[c.id]; return t; }
    const g = s.groups && s.groups[s.gk[c.id]];
    if (g) { const left = rotAnswers(c).filter((t) => g.left.has(t)); if (left.length) return pickTarget(c, left); }
  }
  return pickTarget(c);
}
// 돌려쓰기 카드의 묶음 준비 (학습하기)
function buildGroups(s, list) {
  s.groups = {}; s.gk = {}; s.keepT = {}; s.app = {};
  let total = 0;
  for (const c of list) {
    if (!isRot(c)) { total++; continue; }
    const k = groupKey(c); s.gk[c.id] = k;
    const g = s.groups[k] || (s.groups[k] = { left: new Set(), cards: [], done: new Set(), all: new Set() });
    g.cards.push(c.id); rotAnswers(c).forEach((t) => { g.left.add(t); g.all.add(t); });
  }
  for (const g of Object.values(s.groups)) { g.units = Math.max(g.cards.length, g.all.size); total += g.units; }
  return total;
}
const ansItem = (c, mc, ok) => (mc && mc.ans ? [c.id, ok ? 1 : 0, mc.ans] : [c.id, ok ? 1 : 0]);
const resetItem = (s) => { s.picked = null; s.revealed = false; s.cz = new Set(); };

// 별점 버튼 (카드 자체 별점, 없으면 물려받은 별점을 흐리게)
function rateBtn(c, attr = 'data-rate') {
  const r = st.effRating(c);
  return `<button class="rate-btn" ${attr}="${c.id}" title="별점">${starsHTML(r.v, r.inherited)}</button>`;
}
async function askRate(cid, after) {
  const c = st.S.cards[cid]; if (!c) return;
  const inh = st.inheritedRating(c.setId);
  const v = await pickRating('카드 별점', c.rating, { inheritNote: inh ? `물려받기: ${inh.name} ★${inh.v}` : '' });
  if (v === undefined) return;
  st.setRating('card', cid, v); after && after();
}
function bindRate(after) { $$('[data-rate]').forEach((b) => (b.onclick = (e) => { e.stopPropagation(); askRate(b.dataset.rate, after); })); }
const isLong = (s) => (s || '').length > 90 || (s || '').split('\n').length > 3;

// ---------------------------------------------------------------- 시작
export function start(mode, cards, opts = {}) {
  let list = cards.slice();
  if (opts.filter === 'wrong') list = list.filter((c) => c.p && c.p.wrong);
  if (opts.ratings && opts.ratings.length) { const allow = new Set(opts.ratings); list = list.filter((c) => st.ratingOk(c, allow)); }
  if (mode !== 'review') {
    if (opts.shuffle) list = shuffle(list);
    if (opts.count && opts.count > 0) list = list.slice(0, opts.count);
  }
  if (mode === 'review') return startReview(list, opts);
  if (!list.length) { toast('조건에 맞는 카드가 없습니다.'); return false; }
  if (mode === 'match') {
    list = list.filter((c) => kindOf(c) === 'basic');
    if (list.length < 2) { toast('매칭은 기본(용어–정의) 카드가 2장 이상 필요합니다. 확인문제·빈칸 카드는 매칭에 나오지 않아요.', 3500); return false; }
  }
  session = { mode, title: opts.title || '', opts, src: cards.map((c) => c.id) };
  if (mode === 'flash') Object.assign(session, { order: list.map((c) => c.id), i: 0, known: [], learning: [], flipped: false, undo: [], faces: {} });
  if (mode === 'test') Object.assign(session, { order: list.map((c) => c.id), i: 0, revealed: false, answers: [], faces: {}, choices: {}, picked: null, cz: new Set() });
  if (mode === 'match') Object.assign(session, { pool: list.map((c) => c.id), phase: 'intro', best: st.S.local.matchBest[opts.key || 'all'] || 0 });
  if (mode === 'mc') Object.assign(session, { order: list.map((c) => c.id), i: 0, answers: [], faces: {}, choices: {}, picked: null, revealed: false, cz: new Set() });
  if (mode === 'learn') { Object.assign(session, { queue: list.map((c) => c.id), mastered: [], missed: [], tries: 0, faces: {}, choices: {}, picked: null, revealed: false, cz: new Set() }); session.total = buildGroups(session, list); }
  go('#/play');
  return true;
}

export function render() {
  if (!session) { go('#/'); return; }
  document.onkeydown = null;
  if (session.mode === 'flash') return renderFlash();
  if (session.mode === 'test') return renderTest();
  if (session.mode === 'match') return renderMatch();
  if (session.mode === 'review') return renderReview();
  if (session.mode === 'mc') return renderMC();
  if (session.mode === 'learn') return renderLearn();
}

function topbar(title, sub = '') {
  return `<div class="study-top">
    <button class="icon-btn" data-exit aria-label="닫기">${I.close}</button>
    <div class="title">${esc(title)}${sub ? ` <span class="muted small">· ${esc(sub)}</span>` : ''}</div>
    <span style="width:44px"></span></div>`;
}
function bindExit(onExit) {
  const b = $('[data-exit]'); if (b) b.onclick = onExit || (() => { session = null; history.length > 1 ? history.back() : go('#/'); });
}

// ---------------------------------------------------------------- 낱말카드
function renderFlash() {
  const s = session;
  if (s.i >= s.order.length) return flashDone();
  const c = st.S.cards[s.order[s.i]];
  if (!c || c.del) { s.i++; return renderFlash(); }
  const f = s.faces[c.id] || (s.faces[c.id] = faceOf(c, s.opts.dir || 'term', 'all'));
  const pct = (s.i / s.order.length) * 100;
  const face = (cls, lab, txt, imgs, html = null) => `<div class="face ${cls} ${html !== null || isLong(txt) ? 'long' : ''} ${imgs.length ? 'has-ph' : ''}"><span class="lab">${lab}</span>${photoBlock(imgs)}<div class="txt">${html !== null ? html : esc(txt)}</div></div>`;
  let frontH = null, backH = null;
  if (f.kind === 'question' && isRot(c)) {
    frontH = `<div>${esc(f.q)}<div class="q-list">정답 ${rotAnswers(c).length}개를 떠올려 보세요</div></div>`;
    backH = `<div><b>${esc(rotAnswers(c).join(' · '))}</b>${f.ex ? `<div class="ex-txt">${esc(f.ex)}</div>` : ''}</div>`;
  } else if (f.kind === 'question') {
    const ch = fixedChoices(c).map((o) => `${circ(o.no)} ${esc(o.t)}`).join('\n');
    frontH = `<div>${esc(f.q)}<div class="q-list">${ch}</div></div>`;
    backH = `<div><b>${esc(f.a)}</b>${f.ex ? `<div class="ex-txt">${esc(f.ex)}</div>` : ''}</div>`;
  } else if (f.kind === 'cloze') {
    frontH = clozeHTML(f.q, {});
    backH = `<div>${clozeHTML(f.q, { all: true })}${f.ex ? `<div class="ex-txt">${esc(f.ex)}</div>` : ''}</div>`;
  }
  view().innerHTML = `${topbar(`${s.i + 1} / ${s.order.length}`, s.title)}
  <div class="progress"><i style="width:${pct}%"></i></div>
  <div class="counter-pair"><span class="l">학습 중 ${s.learning.length}</span><span class="r">알고 있음 ${s.known.length}</span></div>
  <div class="flip-wrap"><div class="flip ${s.flipped ? 'flipped' : ''}" id="fc">
    <div class="flip-hint" id="hint"></div>
    ${face('front', f.ql, f.q, f.qi, frontH)}
    ${face('back', f.al, f.a, f.ai, backH)}
  </div></div>
  <div class="study-btns">
    <button class="btn ng" data-l>✕ 학습 중</button>
    <button class="icon-btn" data-undo title="되돌리기" ${s.undo.length ? '' : 'disabled'}>${I.undo}</button>
    ${rateBtn(c)}
    <button class="btn ok" data-r>○ 알고 있음</button>
  </div>
  <div class="kbd-hint">스페이스: 뒤집기 · ←: 학습 중 · →: 알고 있음 · Backspace: 되돌리기</div>`;
  bindExit();
  hydrate(view());
  const card = $('#fc'), hint = $('#hint');
  const flip = () => { s.flipped = !s.flipped; card.classList.toggle('flipped', s.flipped); };
  const mark = (known) => {
    s.undo.push({ i: s.i, known });
    (known ? s.known : s.learning).push(c.id);
    s.i++; s.flipped = false; st.bumpDay('f');
    renderFlash();
  };
  $('[data-l]').onclick = () => mark(false);
  $('[data-r]').onclick = () => mark(true);
  bindRate(renderFlash);
  $('[data-undo]').onclick = () => {
    const u = s.undo.pop(); if (!u) return;
    (u.known ? s.known : s.learning).pop(); s.i = u.i; s.flipped = false; renderFlash();
  };
  // 스와이프 + 탭
  let sx = null, sy = 0, dx = 0, moved = false;
  card.onpointerdown = (e) => { sx = e.clientX; sy = e.clientY; dx = 0; moved = false; card.setPointerCapture(e.pointerId); card.style.transition = 'none'; };
  card.onpointermove = (e) => {
    if (sx === null) return;
    dx = e.clientX - sx; const dy = e.clientY - sy;
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) moved = true;
    if (!moved) return;
    card.style.transform = `translateX(${dx}px) rotate(${dx / 30}deg) ${s.flipped ? 'rotateY(180deg)' : ''}`;
    hint.style.opacity = Math.min(1, Math.abs(dx) / 90);
    hint.textContent = dx > 0 ? '알고 있음' : '학습 중';
    hint.style.background = dx > 0 ? 'var(--ok-soft)' : 'var(--ng-soft)';
    hint.style.color = dx > 0 ? 'var(--ok)' : 'var(--ng)';
    hint.style.transform = s.flipped ? 'rotateY(180deg)' : '';
  };
  const end = () => {
    if (sx === null) return; sx = null;
    card.style.transition = ''; card.style.transform = '';
    hint.style.opacity = 0;
    if (!moved) return flip();
    if (dx > 90) mark(true); else if (dx < -90) mark(false);
  };
  card.onpointerup = end; card.onpointercancel = () => { sx = null; card.style.transition = ''; card.style.transform = ''; hint.style.opacity = 0; };
  document.onkeydown = (e) => {
    if (e.key === ' ' || e.key === 'Enter' || e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); flip(); }
    else if (e.key === 'ArrowRight') mark(true);
    else if (e.key === 'ArrowLeft') mark(false);
    else if (e.key === 'Backspace') $('[data-undo]').click();
  };
}

function flashDone() {
  const s = session;
  view().innerHTML = `${topbar('낱말카드 완료', s.title)}
  <div class="card" style="max-width:620px;margin:20px auto;text-align:center">
    <div style="font-size:44px">🎉</div>
    <h2 style="margin-top:6px">한 바퀴 끝!</h2>
    <div class="row" style="justify-content:center;gap:28px;margin:10px 0 18px">
      <div><div style="font-size:30px;font-weight:800;color:var(--ok)">${s.known.length}</div><div class="muted">알고 있음</div></div>
      <div><div style="font-size:30px;font-weight:800;color:var(--ng)">${s.learning.length}</div><div class="muted">학습 중</div></div>
    </div>
    <div class="list">
      ${s.learning.length ? `<button class="btn primary block" data-again>학습 중 카드 ${s.learning.length}장 계속하기</button>` : ''}
      <button class="btn block" data-restart>처음부터 다시</button>
      <button class="btn block" data-test>이 카드들로 테스트 보기</button>
      <button class="btn ghost block" data-exit2>끝내기</button>
    </div>
  </div>`;
  bindExit();
  const reset = (ids) => Object.assign(s, { order: s.opts.shuffle ? shuffle(ids) : ids, i: 0, known: [], learning: [], undo: [], flipped: false, faces: {} });
  const a = $('[data-again]'); if (a) a.onclick = () => { reset(s.learning.slice()); renderFlash(); };
  $('[data-restart]').onclick = () => { reset(s.order.slice()); renderFlash(); };
  $('[data-test]').onclick = () => start('test', s.order.map((id) => st.S.cards[id]).filter(Boolean), { ...s.opts, filter: 'all', count: 0, ratings: [] });
  $('[data-exit2]').onclick = () => $('[data-exit]').click();
  document.onkeydown = null;
}

// ---------------------------------------------------------------- 테스트 (O/X 자가채점, 확인문제는 보기 고르기)
function renderTest() {
  const s = session;
  if (s.i >= s.order.length) return finishTest();
  const c = st.S.cards[s.order[s.i]];
  if (!c || c.del) { s.order.splice(s.i, 1); return renderTest(); }
  const f = s.faces[c.id] || (s.faces[c.id] = faceOf(c, s.opts.dir || 'term'));
  const mc = mcFor(c, f, s, 'self');
  const pct = (s.i / s.order.length) * 100;
  const okN = s.answers.filter((a) => a[1]).length;
  const done = mc && s.picked !== null;
  view().innerHTML = `${topbar(`${s.i + 1} / ${s.order.length}`, s.title)}
  <div class="progress"><i style="width:${pct}%"></i></div>
  <div class="qa">
    <div class="row small muted" style="margin-bottom:8px"><span class="pill ok">맞음 ${okN}</span><span class="pill ng">틀림 ${s.answers.length - okN}</span>${c.p && c.p.wrong ? '<span class="pill ng">오답노트</span>' : ''}<span class="spacer"></span>
      ${rateBtn(c)}</div>
    ${mc ? `${mcHTML(f, mc, s.picked)}${done ? nextBtn() : ''}`
      : `${selfHTML(f, s)}${s.revealed ? '<div class="grade-btns"><button class="btn ng" data-ng>✕ 틀렸어요</button><button class="btn ok" data-ok>○ 맞았어요</button></div>' : ''}`}
    <div class="kbd-hint">${mc ? (done ? 'Enter: 다음' : '숫자: 보기 고르기') : s.revealed ? '1 또는 ←: 틀림 · 2 또는 →: 맞음' : '스페이스: 정답 보기'}</div>
  </div>`;
  bindExit(async () => {
    if (!s.answers.length) { session = null; history.back(); return; }
    if (await confirmBox('테스트를 끝낼까요?', `지금까지 푼 ${s.answers.length}문제로 결과를 저장합니다.`, '끝내고 결과 보기')) finishTest();
  });
  hydrate(view());
  bindRate(renderTest);
  const grade = (ok) => { s.answers.push([c.id, ok ? 1 : 0]); s.i++; resetItem(s); renderTest(); };
  if (mc) {
    const next = () => { s.answers.push(ansItem(c, mc, mc.ch[s.picked].ok)); s.i++; resetItem(s); renderTest(); };
    const pick = (k) => { if (s.picked !== null || !mc.ch[k]) return; s.picked = k; if (mc.ans) st.noteRot(c, mc.ans, mc.ch[k].ok); renderTest(); };
    $$('.mc-opt').forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
    const nb = $('[data-next]'); if (nb) nb.onclick = next;
    document.onkeydown = (e) => {
      if (!done && /^[1-9]$/.test(e.key)) pick(+e.key - 1);
      else if (done && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
    };
    return;
  }
  const reveal = bindSelf(f, s, renderTest);
  if (s.revealed) { $('[data-ng]').onclick = () => grade(false); $('[data-ok]').onclick = () => grade(true); }
  document.onkeydown = (e) => {
    if (!s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (s.revealed && (e.key === '1' || e.key === 'ArrowLeft')) grade(false);
    else if (s.revealed && (e.key === '2' || e.key === 'ArrowRight')) grade(true);
  };
}

function finishTest() {
  const s = session;
  const h = st.recordTest(s.answers, (s.title || '테스트') + (s.mode === 'mc' ? ' (객관식)' : ''));
  session = { mode: 'result', hid: h.id, opts: { ...s.opts, mode: s.mode }, title: s.title };
  go('#/result/' + h.id);
}

export function renderResult(hid) {
  document.onkeydown = null;
  const h = st.S.history[hid];
  if (!h) { go('#/'); return; }
  const pct = h.total ? Math.round((h.ok / h.total) * 100) : 0;
  const items = h.items.map(([id, ok, ans]) => ({ c: st.S.cards[id], ok, ans })).filter((x) => x.c && !x.c.del);
  const wrong = items.filter((x) => !x.ok), right = items.filter((x) => x.ok);
  let tab = wrong.length ? 'ng' : 'ok';
  const opts = (session && session.hid === hid && session.opts) || { dir: 'term', shuffle: true };
  const draw = () => {
    const list = tab === 'ng' ? wrong : right;
    view().innerHTML = `${topbar('테스트 결과', h.scope)}
    <div class="result-head">
      <div class="ring" style="--p:${pct}"><div>${pct}%</div></div>
      <div>
        <div style="font-size:22px;font-weight:800">${pct >= 90 ? '훌륭해요!' : pct >= 70 ? '잘하고 있어요' : '조금 더 연습해요'}</div>
        <div class="row" style="margin:8px 0"><span class="pill ok">맞음 ${h.ok}</span><span class="pill ng">틀림 ${h.total - h.ok}</span><span class="muted small">${esc(h.scope)}</span></div>
        <div class="muted small">틀린 문제는 오답노트에 자동으로 들어갔어요. 연속 ${st.S.settings.gradStreak}번 맞히면 빠집니다.</div>
      </div>
    </div>
    <div class="row">
      ${wrong.length ? `<button class="btn primary" data-rewrong>틀린 ${wrong.length}문제 다시 시험</button>` : ''}
      <button class="btn" data-again>같은 문제 다시</button>
      <a class="btn" href="#/wrong">오답노트</a>
      <a class="btn ghost" href="#/">홈으로</a>
    </div>
    <div class="tabs"><button data-t="ng" class="${tab === 'ng' ? 'on' : ''}">틀린 것 (${wrong.length})</button><button data-t="ok" class="${tab === 'ok' ? 'on' : ''}">맞은 것 (${right.length})</button></div>
    <div class="term-list">${list.length ? list.map(({ c, ans }) => `
      <div class="term-row ${tab === 'ng' ? 'wrong' : ''}"><div class="a">${listHTML(c).a}${(c.imgs || []).length ? `<div class="ph-row">${photoBlock(c.imgs, { compact: true })}</div>` : ''}</div><div class="b">${listHTML(c).b}${ans ? `<div class="asked">이번에 물은 정답: <b>${esc(ans)}</b></div>` : ''}</div>
      <div class="acts">${rateBtn(c)}</div></div>`).join('')
      : `<div class="empty">${tab === 'ng' ? '틀린 문제가 없어요 👏' : '맞은 문제가 없어요'}</div>`}</div>`;
    bindExit(() => { session = null; go('#/'); });
    $$('[data-t]').forEach((b) => (b.onclick = () => { tab = b.dataset.t; draw(); }));
    hydrate(view()); bindRate(draw);
    const rw = $('[data-rewrong]');
    if (rw) rw.onclick = () => start(opts.mode === 'mc' ? 'mc' : 'test', wrong.map((x) => x.c), { ...opts, title: '틀린 문제 다시', filter: 'all', count: 0, ratings: [] });
    $('[data-again]').onclick = () => start(opts.mode === 'mc' ? 'mc' : 'test', items.map((x) => x.c), { ...opts, title: h.scope, filter: 'all', count: 0, ratings: [] });
  };
  draw();
}

// ---------------------------------------------------------------- 매칭
function renderMatch() {
  const s = session;
  if (s.phase === 'intro') {
    const n = Math.min(6, s.pool.length);
    view().innerHTML = `${topbar('매칭', s.title)}
    <div class="card" style="max-width:560px;margin:30px auto;text-align:center">
      <div style="font-size:42px">🧩</div><h2>용어와 정의를 짝지어 보세요</h2>
      <p class="muted">카드 ${n}쌍이 섞여 나옵니다. 틀리면 1초가 추가돼요.</p>
      ${s.best ? `<p>최고 기록 <b>${(s.best / 1000).toFixed(1)}초</b></p>` : ''}
      <button class="btn primary" style="min-width:200px;min-height:54px;font-size:18px" data-go>게임 시작</button>
    </div>`;
    bindExit();
    $('[data-go]').onclick = () => {
      const pick = shuffle(s.pool).slice(0, n);
      s.tiles = shuffle(pick.flatMap((id) => [{ id, side: 'a' }, { id, side: 'b' }]));
      s.t0 = performance.now(); s.penalty = 0; s.sel = null; s.left = pick.length; s.phase = 'play';
      renderMatch();
    };
    return;
  }
  if (s.phase === 'play') {
    view().innerHTML = `<div class="study-top"><button class="icon-btn" data-exit>${I.close}</button>
      <div class="title"><span class="timer" id="tm">0.0</span><span class="muted small"> 초</span></div><span style="width:44px"></span></div>
      <div class="match-grid">${s.tiles.map((t, i) => {
        const c = st.S.cards[t.id]; const txt = t.side === 'a' ? c.term : c.def;
        const im = t.side === 'a' && (c.imgs || []).length ? (t.img = t.img || pickOne(c.imgs)[0]) : null;
        return `<div class="mt ${im ? 'mt-ph' : ''}" data-i="${i}" style="${txt.length > 60 ? 'font-size:13px' : ''}">${im ? `<img data-img="${esc(im)}" alt="">` : ''}${txt ? `<span>${esc(txt)}</span>` : ''}</div>`;
      }).join('')}</div>`;
    bindExit(() => { clearInterval(s.timer); session = null; history.back(); });
    hydrate(view());
    const tm = $('#tm');
    clearInterval(s.timer);
    s.timer = setInterval(() => { tm.textContent = ((performance.now() - s.t0 + s.penalty) / 1000).toFixed(1); }, 100);
    $$('.mt').forEach((el) => (el.onclick = () => {
      const t = s.tiles[+el.dataset.i];
      if (el.classList.contains('gone')) return;
      if (s.sel === null) { s.sel = +el.dataset.i; el.classList.add('sel'); return; }
      const prevEl = $(`.mt[data-i="${s.sel}"]`); const p = s.tiles[s.sel];
      if (s.sel === +el.dataset.i) { el.classList.remove('sel'); s.sel = null; return; }
      if (p.id === t.id && p.side !== t.side) {
        [el, prevEl].forEach((x) => { x.classList.remove('sel'); x.classList.add('good'); setTimeout(() => x.classList.add('gone'), 180); });
        s.left--;
        if (!s.left) {
          clearInterval(s.timer);
          s.time = performance.now() - s.t0 + s.penalty;
          const key = s.opts.key || 'all';
          const best = st.S.local.matchBest[key];
          s.newBest = !best || s.time < best;
          if (s.newBest) { st.S.local.matchBest[key] = s.time; st.save(); }
          s.best = Math.min(best || Infinity, s.time);
          setTimeout(() => { s.phase = 'done'; renderMatch(); }, 350);
        }
      } else {
        [el, prevEl].forEach((x) => { x.classList.remove('sel'); x.classList.add('bad'); setTimeout(() => x.classList.remove('bad'), 450); });
        s.penalty += 1000;
      }
      s.sel = null;
    }));
    return;
  }
  // done
  view().innerHTML = `${topbar('매칭 완료', s.title)}
  <div class="card" style="max-width:560px;margin:30px auto;text-align:center">
    <div style="font-size:42px">${s.newBest ? '🏆' : '⏱️'}</div>
    <h2>${(s.time / 1000).toFixed(1)}초</h2>
    <p class="muted">${s.newBest ? '최고 기록이에요!' : `최고 기록 ${(s.best / 1000).toFixed(1)}초`}</p>
    <div class="row" style="justify-content:center"><button class="btn primary" data-again>다시 하기</button><button class="btn ghost" data-x>끝내기</button></div>
  </div>`;
  bindExit();
  $('[data-again]').onclick = () => { s.phase = 'intro'; renderMatch(); };
  $('[data-x]').onclick = () => $('[data-exit]').click();
}

// ---------------------------------------------------------------- 복습 (Anki FSRS)
let scheduler = null;
function fsrs() {
  if (!scheduler) {
    const F = window.FSRS;
    scheduler = F.fsrs(F.generatorParameters({ enable_fuzz: true, request_retention: 0.9, maximum_interval: 3650 }));
  }
  return scheduler;
}
const toCard = (p) => ({ ...p, due: new Date(p.due), last_review: p.last_review ? new Date(p.last_review) : undefined });
const fromCard = (c) => ({ ...c, due: c.due.toISOString(), last_review: c.last_review ? new Date(c.last_review).toISOString() : null });
const endOfToday = () => { const d = new Date(); d.setHours(23, 59, 59, 999); return d.getTime(); };
const LEARN_AHEAD = 20 * 60000;

function newLeft() {
  const L = st.S.local.newIntro;
  if (L.date !== st.today()) { L.date = st.today(); L.n = 0; }
  return Math.max(0, (+st.S.settings.newPerDay || 0) - L.n);
}
export function reviewCounts(cards) {
  const t = Date.now(), eod = endOfToday();
  let due = 0, fresh = 0;
  for (const c of cards) {
    const f = c.p && c.p.fsrs;
    if (!f) { fresh++; continue; }
    const d = Date.parse(f.due);
    if (f.state === 2 ? d <= eod : d <= t + LEARN_AHEAD) due++;
  }
  return { due, fresh: Math.min(fresh, newLeft()), total: due + Math.min(fresh, newLeft()) };
}

function startReview(cards, opts) {
  const t = Date.now(), eod = endOfToday();
  const learn = [], rev = [], fresh = [];
  for (const c of cards) {
    const f = c.p && c.p.fsrs;
    if (!f) fresh.push(c);
    else if (f.state === 2) { if (Date.parse(f.due) <= eod) rev.push(c); }
    else if (Date.parse(f.due) <= t + LEARN_AHEAD) learn.push(c);
  }
  learn.sort((a, b) => Date.parse(a.p.fsrs.due) - Date.parse(b.p.fsrs.due));
  const q = [...learn, ...shuffle(rev), ...fresh.slice(0, newLeft())].map((c) => c.id);
  session = { mode: 'review', title: opts.title || '복습', opts, queue: q, done: 0, revealed: false, counts: [0, 0, 0, 0, 0], choices: {}, picked: null, cz: new Set() };
  go('#/play');
  return true;
}

function renderReview() {
  const s = session;
  if (!s.queue.length) {
    view().innerHTML = `${topbar('복습', s.title)}
    <div class="card" style="max-width:560px;margin:30px auto;text-align:center">
      <div style="font-size:42px">✅</div>
      <h2>${s.done ? '오늘 복습 끝!' : '지금 복습할 카드가 없어요'}</h2>
      <p class="muted">${s.done ? `${s.done}번 복습했어요. 다음 복습일은 Anki 방식(FSRS)으로 자동 계산됩니다.` : '새 카드를 더 보려면 설정에서 "하루 새 카드 수"를 늘리세요.'}</p>
      ${s.done ? `<div class="row" style="justify-content:center;margin-bottom:14px"><span class="pill ng">다시 ${s.counts[1]}</span><span class="pill">어려움 ${s.counts[2]}</span><span class="pill ok">알맞음 ${s.counts[3]}</span><span class="pill pr">쉬움 ${s.counts[4]}</span></div>` : ''}
      <button class="btn primary" data-x>확인</button>
    </div>`;
    bindExit(); $('[data-x]').onclick = () => { session = null; go('#/'); };
    return;
  }
  const c = st.S.cards[s.queue[0]];
  if (!c || c.del) { s.queue.shift(); return renderReview(); }
  const isNew = !(c.p && c.p.fsrs);
  const counts = { n: 0, l: 0, r: 0 };
  for (const id of s.queue) { const f = st.S.cards[id]?.p?.fsrs; if (!f) counts.n++; else if (f.state === 2) counts.r++; else counts.l++; }
  const dir = s.opts.dir || 'term';
  s.faces = s.faces || {};
  const f = s.faces[c.id] || (s.faces[c.id] = faceOf(c, dir === 'def' ? 'def' : 'term', 'one'));
  const mc = mcFor(c, f, s, 'review'); // 확인문제만 보기 고르기
  let prev = null;
  if (s.revealed) {
    const now = new Date();
    const card = isNew ? window.FSRS.createEmptyCard(now) : toCard(c.p.fsrs);
    prev = fsrs().repeat(card, now);
  }
  const lab = (g) => prev ? fmtDur(prev[g].card.due.getTime() - Date.now()) : '';
  view().innerHTML = `${topbar('복습', s.title)}
  <div class="row small" style="justify-content:center;margin-bottom:14px;font-weight:800">
    <span style="color:var(--primary)">새 카드 ${counts.n}</span><span style="color:var(--ng)">학습 중 ${counts.l}</span><span style="color:var(--ok)">복습 ${counts.r}</span></div>
  <div class="qa">
    ${isNew ? '<div class="row small" style="margin-bottom:8px"><span class="pill pr">새 카드</span></div>' : ''}
    ${mc ? mcHTML(f, mc, s.picked) : f.kind === 'cloze' ? selfHTML(f, s) : promptHTML(f)}
    ${s.revealed ? `${!mc && f.kind === 'basic' ? `<div class="ans"><div class="lab">${f.al}</div>${photoBlock(f.ai)}<div class="txt">${esc(f.a)}</div></div>` : ''}
    <div class="grade4">
      <button class="btn again ${mc && !mc.ch[s.picked]?.ok ? 'sugg' : ''}" data-g="1">다시<small>${lab(1)}</small></button>
      <button class="btn hard" data-g="2">어려움<small>${lab(2)}</small></button>
      <button class="btn good" data-g="3">알맞음<small>${lab(3)}</small></button>
      <button class="btn easy" data-g="4">쉬움<small>${lab(4)}</small></button>
    </div>` : mc || f.kind === 'cloze' ? '' : `<div style="margin-top:18px"><button class="btn primary block" style="min-height:60px;font-size:18px" data-reveal>정답 보기</button></div>`}
    <div class="kbd-hint">${s.revealed ? '1 다시 · 2 어려움 · 3 알맞음 · 4 쉬움' : mc ? '숫자: 보기 고르기' : '스페이스: 정답 보기'}</div>
  </div>`;
  bindExit(() => { session = null; history.length > 1 ? history.back() : go('#/'); });
  hydrate(view());
  const reveal = () => { s.revealed = true; renderReview(); };
  const grade = (g) => {
    const now = new Date();
    const card = isNew ? window.FSRS.createEmptyCard(now) : toCard(c.p.fsrs);
    const rec = fsrs().next(card, now, g);
    if (!c.p) c.p = st.blankProgress();
    c.p.fsrs = fromCard(rec.card);
    if (isNew) st.S.local.newIntro.n++;
    st.touchProgress(c); st.bumpDay('r');
    s.queue.shift(); s.done++; s.counts[g]++; resetItem(s); delete s.choices[c.id]; delete s.faces[c.id];
    if (rec.card.due.getTime() - Date.now() < LEARN_AHEAD) {
      const pos = Math.min(s.queue.length, 3 + Math.floor(Math.random() * 3));
      s.queue.splice(pos, 0, c.id);
    }
    renderReview();
  };
  const pickQ = (k) => { if (!mc || s.revealed || !mc.ch[k]) return; s.picked = k; s.revealed = true; if (mc.ans) st.noteRot(c, mc.ans, mc.ch[k].ok); renderReview(); };
  if (!s.revealed) {
    if (mc) $$('.mc-opt').forEach((b) => (b.onclick = () => pickQ(+b.dataset.k)));
    else bindSelf(f, s, renderReview);
  } else $$('[data-g]').forEach((b) => (b.onclick = () => grade(+b.dataset.g)));
  document.onkeydown = (e) => {
    if (!s.revealed && mc) { if (/^[1-9]$/.test(e.key)) pickQ(+e.key - 1); return; }
    if (!s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (s.revealed && ['1', '2', '3', '4'].includes(e.key)) grade(+e.key);
    else if (s.revealed && e.key === ' ') { e.preventDefault(); grade(3); }
  };
}

// ---------------------------------------------------------------- 객관식 5지선다 (v2.0)
// 오답 보기: 같은 단원 → 같은 폴더(하위 포함) → 상위 폴더 → 선택 범위 → 전체 순으로 채운다.
// 정답과 "같은 답"(첫 줄에서 괄호·공백을 뺀 글자가 같은 것)은 보기에서 제외 (예: 대승기탕(215조) vs 대승기탕(239조))
const ansKey = (t) => String(t || '').split('\n').map((x) => x.trim()).filter(Boolean)[0]?.replace(/\([^)]*\)/g, '').replace(/\s+/g, '') || '';
function buildChoices(c, f, srcIds) {
  const ans = String(f.a || '').trim();
  const seen = new Set([ansKey(ans)]);
  const set = st.S.sets[c.setId];
  const tiers = [];
  if (set) {
    tiers.push(st.cardsOf(set.id));
    const path = st.folderPath(set.folderId).reverse();
    for (const fo of path) tiers.push(st.setsUnder(fo.id).flatMap((x) => st.cardsOf(x.id)));
  }
  tiers.push((srcIds || []).map((id) => st.S.cards[id]).filter((x) => x && !x.del));
  tiers.push(st.allCards());
  const out = [];
  for (const tier of tiers) {
    for (const x of shuffle(tier)) {
      if (x.id === c.id || kindOf(x) !== 'basic') continue;
      const t = String(x[f.ak] || '').trim(); if (!t) continue;
      const k = ansKey(t); if (!k || seen.has(k)) continue;
      seen.add(k); out.push(t);
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  return shuffle([{ t: ans || '(내용 없음)', ok: true }, ...out.map((t) => ({ t, ok: false }))]);
}
// 빈칸 객관식: 빈칸 하나를 골라 묻고, 오답 보기는 다른 빈칸 카드의 정답(같은 단원 → 폴더 → 상위 → 범위 → 전체)
function clozeMC(c, srcIds) {
  const ans = clozeAnswers(c.term); if (!ans.length) return { ch: null };
  const target = Math.floor(Math.random() * ans.length);
  const norm = (t) => String(t).replace(/\s+/g, '');
  const seen = new Set(ans.map(norm));
  const set = st.S.sets[c.setId]; const tiers = [];
  if (set) { tiers.push(st.cardsOf(set.id)); for (const fo of st.folderPath(set.folderId).reverse()) tiers.push(st.setsUnder(fo.id).flatMap((x) => st.cardsOf(x.id))); }
  tiers.push((srcIds || []).map((id) => st.S.cards[id]).filter((x) => x && !x.del));
  tiers.push(st.allCards());
  const out = [];
  for (const tier of tiers) {
    for (const x of shuffle(tier)) {
      if (x.id === c.id || kindOf(x) !== 'cloze') continue;
      for (const t of shuffle(clozeAnswers(x.term))) {
        const k = norm(t); if (!k || seen.has(k)) continue;
        seen.add(k); out.push(t); break;
      }
      if (out.length >= 4) break;
    }
    if (out.length >= 4) break;
  }
  if (out.length < 2) return { ch: null }; // 보기가 3개 미만이면 직접 채점으로
  return { target, ch: shuffle([{ t: ans[target], ok: true }, ...out.map((t) => ({ t, ok: false }))]) };
}
function mcHTML(f, mc, picked) {
  const choices = mc.ch;
  const done = picked !== null && picked !== undefined;
  const prompt = f.kind === 'cloze' ? promptHTML(f, done ? { all: true } : { target: mc.target }, ` · <span class="pill">${circ(mc.target + 1)}에 들어갈 말은?</span>`) : promptHTML(f);
  return `${prompt}
    <div class="mc-opts ${done ? 'done' : ''}">${choices.map((o, k) => {
      const cls = done ? (o.ok ? 'right' : k === picked ? 'wrong' : '') : '';
      return `<button class="mc-opt ${cls}" data-k="${k}" ${done ? 'disabled' : ''}><span class="no">${f.kind === 'question' ? circ(k + 1) : k + 1}</span><span>${esc(o.t)}</span></button>`;
    }).join('')}</div>
    ${done && f.ai.length ? `<div class="ans" style="margin-top:12px">${photoBlock(f.ai)}</div>` : ''}
    ${done && f.kind !== 'basic' ? exHTML(f) : ''}`;
}
function nextBtn(label = '다음 →') { return `<div style="margin-top:16px"><button class="btn primary block" style="min-height:56px;font-size:17px" data-next>${label}</button></div>`; }

function renderMC() {
  const s = session;
  if (s.i >= s.order.length) return finishTest();
  const c = st.S.cards[s.order[s.i]];
  if (!c || c.del) { s.order.splice(s.i, 1); return renderMC(); }
  const f = s.faces[c.id] || (s.faces[c.id] = faceOf(c, s.opts.dir || 'term', 'one'));
  const mc = mcFor(c, f, s, 'mc');
  const pct = (s.i / s.order.length) * 100;
  const okN = s.answers.filter((a) => a[1]).length;
  const done = mc && s.picked !== null;
  const stay = f.kind === 'question'; // 확인문제는 해설을 읽도록 자동으로 넘기지 않음
  view().innerHTML = `${topbar(`${s.i + 1} / ${s.order.length}`, (s.title ? s.title + ' · ' : '') + '객관식')}
  <div class="progress"><i style="width:${pct}%"></i></div>
  <div class="qa">
    <div class="row small muted" style="margin-bottom:8px"><span class="pill ok">맞음 ${okN}</span><span class="pill ng">틀림 ${s.answers.length - okN}</span>${c.p && c.p.wrong ? '<span class="pill ng">오답노트</span>' : ''}<span class="spacer"></span>${rateBtn(c)}</div>
    ${mc ? `${mcHTML(f, mc, s.picked)}${done && (stay || !mc.ch[s.picked].ok) ? nextBtn() : ''}`
      : `${selfHTML(f, s)}${s.revealed ? '<div class="grade-btns"><button class="btn ng" data-ng>✕ 틀렸어요</button><button class="btn ok" data-ok>○ 맞았어요</button></div>' : ''}`}
    <div class="kbd-hint">${mc ? (done ? 'Enter: 다음' : '숫자: 보기 고르기') : s.revealed ? '1 또는 ←: 틀림 · 2 또는 →: 맞음' : '스페이스: 정답 보기'}</div>
  </div>`;
  bindExit(async () => {
    if (!s.answers.length) { session = null; history.back(); return; }
    if (await confirmBox('시험을 끝낼까요?', `지금까지 푼 ${s.answers.length}문제로 결과를 저장합니다.`, '끝내고 결과 보기')) finishTest();
  });
  hydrate(view()); bindRate(renderMC);
  const next = () => { s.i++; resetItem(s); renderMC(); };
  if (mc) {
    const pick = (k) => {
      if (s.picked !== null || !mc.ch[k]) return;
      s.picked = k; s.answers.push(ansItem(c, mc, mc.ch[k].ok)); if (mc.ans) st.noteRot(c, mc.ans, mc.ch[k].ok);
      renderMC();
      if (mc.ch[k].ok && !stay) setTimeout(() => { if (session === s && s.picked === k && s.order[s.i] === c.id) next(); }, 700);
    };
    $$('.mc-opt').forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
    const nb = $('[data-next]'); if (nb) nb.onclick = next;
    document.onkeydown = (e) => {
      if (!done && /^[1-9]$/.test(e.key)) pick(+e.key - 1);
      else if (done && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); next(); }
    };
    return;
  }
  // 객관식 보기를 만들 수 없는 빈칸 카드 → 직접 채점
  const grade = (ok) => { s.answers.push([c.id, ok ? 1 : 0]); next(); };
  const reveal = bindSelf(f, s, renderMC);
  if (s.revealed) { $('[data-ng]').onclick = () => grade(false); $('[data-ok]').onclick = () => grade(true); }
  document.onkeydown = (e) => {
    if (!s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
    else if (s.revealed && (e.key === '1' || e.key === 'ArrowLeft')) grade(false);
    else if (s.revealed && (e.key === '2' || e.key === 'ArrowRight')) grade(true);
  };
}

// ---------------------------------------------------------------- 학습하기: 맞힐 때까지 반복 (v2.0)
function renderLearn() {
  const s = session;
  if (!s.queue.length) return learnDone();
  const c = st.S.cards[s.queue[0]];
  if (!c || c.del) { s.queue.shift(); s.total--; return renderLearn(); }
  const how = (s.opts.answer || 'mc') === 'mc' ? 'mc' : 'self';
  const f = s.faces[c.id] || (s.faces[c.id] = faceOf(c, s.opts.dir || 'term', 'one'));
  const mc = mcFor(c, f, s, how);
  const pct = (s.mastered.length / Math.max(1, s.total)) * 100;
  const done = mc ? s.picked !== null : false;
  const stay = f.kind === 'question';
  const again = s.missed.includes(c.id);
  view().innerHTML = `${topbar('학습하기', s.title)}
  <div class="progress"><i style="width:${pct}%;background:var(--ok)"></i></div>
  <div class="qa">
    <div class="learn-bar"><div><b>${Math.max(0, s.total - s.mastered.length)}</b><span>남은 문제</span></div><div><b style="color:var(--ok)">${s.mastered.length}</b><span>맞힘</span></div><div><b style="color:var(--ng)">${s.wrongN || 0}</b><span>틀린 횟수</span></div></div>
    <div class="row small muted" style="margin-bottom:8px">${again ? '<span class="pill ng">다시 나온 카드</span>' : ''}<span class="spacer"></span>${rateBtn(c)}</div>
    ${mc ? `${mcHTML(f, mc, s.picked)}${done && !mc.ch[s.picked].ok ? nextBtn('다음 → (이 카드는 조금 뒤에 다시 나와요)') : done && stay ? nextBtn() : ''}`
      : `${selfHTML(f, s)}${s.revealed ? '<div class="grade-btns"><button class="btn ng" data-ng>✕ 틀렸어요</button><button class="btn ok" data-ok>○ 맞았어요</button></div>' : ''}`}
    <div class="kbd-hint">${mc ? (done ? 'Enter: 다음' : '숫자: 보기 고르기') : (s.revealed ? '1 또는 ←: 틀림 · 2 또는 →: 맞음' : '스페이스: 정답 보기')}</div>
  </div>`;
  bindExit(async () => {
    if (!s.mastered.length && !s.wrongN) { session = null; history.back(); return; }
    if (await confirmBox('학습을 끝낼까요?', `${s.total}문제 중 ${s.mastered.length}문제를 맞혔어요.`, '끝내기')) { session = null; go('#/'); }
  });
  hydrate(view()); bindRate(renderLearn);
  const advance = (ok) => {
    const id = s.queue.shift();
    const ans = mc && mc.ans; const g = ans && s.groups[s.gk[id]];
    s.app[id] = (s.app[id] || 0) + 1;
    if (ok) {
      s.mastered.push(id);
      if (g) {
        // 돌려쓰기 묶음: 처방을 다 맞히고 증례도 모두 한 번씩 맞혀야 한 바퀴
        g.left.delete(ans); g.done.add(id);
        const notDone = g.cards.filter((x) => !g.done.has(x));
        const pending = s.queue.some((x) => s.gk[x] === s.gk[id]);
        if ((g.left.size || notDone.length) && !pending) {
          const pool = notDone.length ? notDone : g.cards;
          const next = pool.slice().sort((a, b) => (a === id) - (b === id) || (s.app[a] || 0) - (s.app[b] || 0))[0];
          s.queue.splice(Math.min(s.queue.length, 2), 0, next);
        }
      }
      delete s.choices[id]; delete s.faces[id];
    } else {
      if (!s.missed.includes(id)) s.missed.push(id);
      s.wrongN = (s.wrongN || 0) + 1;
      if (ans) s.keepT[id] = ans;                         // 틀린 처방은 같은 처방으로 다시
      s.queue.splice(Math.min(s.queue.length, 3), 0, id); // 3장 뒤에 다시
      delete s.choices[id]; delete s.faces[id];           // 다시 나올 땐 보기 순서·사진·빈칸을 새로
    }
    s.tries++; resetItem(s); st.bumpDay('f');
    renderLearn();
  };
  if (mc) {
    const pick = (k) => {
      if (s.picked !== null || !mc.ch[k]) return;
      s.picked = k; if (mc.ans) st.noteRot(c, mc.ans, mc.ch[k].ok); renderLearn();
      if (mc.ch[k].ok && !stay) setTimeout(() => { if (session === s && s.picked === k && s.queue[0] === c.id) advance(true); }, 650);
    };
    $$('.mc-opt').forEach((b) => (b.onclick = () => pick(+b.dataset.k)));
    const nb = $('[data-next]'); if (nb) nb.onclick = () => advance(!!mc.ch[s.picked].ok);
    document.onkeydown = (e) => {
      if (!done && /^[1-9]$/.test(e.key)) pick(+e.key - 1);
      else if (done && (!mc.ch[s.picked].ok || stay) && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); advance(!!mc.ch[s.picked].ok); }
    };
  } else {
    const reveal = bindSelf(f, s, renderLearn);
    if (s.revealed) { $('[data-ng]').onclick = () => advance(false); $('[data-ok]').onclick = () => advance(true); }
    document.onkeydown = (e) => {
      if (!s.revealed && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); reveal(); }
      else if (s.revealed && (e.key === '1' || e.key === 'ArrowLeft')) advance(false);
      else if (s.revealed && (e.key === '2' || e.key === 'ArrowRight')) advance(true);
    };
  }
}
function learnDone() {
  const s = session;
  document.onkeydown = null;
  const missed = s.missed.map((id) => st.S.cards[id]).filter((c) => c && !c.del);
  const all = [...new Set(s.mastered)].map((id) => st.S.cards[id]).filter((c) => c && !c.del);
  view().innerHTML = `${topbar('학습하기 완료', s.title)}
  <div class="card" style="max-width:640px;margin:20px auto;text-align:center">
    <div style="font-size:44px">🏁</div>
    <h2 style="margin-top:6px">${s.total}문제를 모두 맞혔어요!</h2>
    <p class="muted">${missed.length ? `한 번 이상 틀린 카드 ${missed.length}장 · 틀린 횟수 ${s.wrongN}번` : '한 번도 틀리지 않았어요 👏'}</p>
    <div class="list">
      ${missed.length ? `<button class="btn primary block" data-missed>틀렸던 카드 ${missed.length}장 다시 학습하기</button>` : ''}
      <button class="btn block" data-restart>처음부터 다시</button>
      <button class="btn block" data-test>이 카드들로 객관식 시험 보기</button>
      <button class="btn ghost block" data-x>끝내기</button>
    </div>
  </div>
  ${missed.length ? `<h2>틀렸던 카드</h2><div class="term-list">${missed.map((c) => `<div class="term-row wrong"><div class="a">${listHTML(c).a}${(c.imgs || []).length ? `<div class="ph-row">${photoBlock(c.imgs, { compact: true })}</div>` : ''}</div><div class="b">${listHTML(c).b}</div><div class="acts">${rateBtn(c)}</div></div>`).join('')}</div>` : ''}`;
  bindExit(() => { session = null; go('#/'); });
  hydrate(view()); bindRate(learnDone);
  const opts = { ...s.opts, filter: 'all', count: 0, ratings: [] };
  const m = $('[data-missed]'); if (m) m.onclick = () => start('learn', missed, { ...opts, title: (s.title || '') + ' · 틀린 카드' });
  $('[data-restart]').onclick = () => start('learn', all, opts);
  $('[data-test]').onclick = () => start('mc', all, opts);
  $('[data-x]').onclick = () => { session = null; go('#/'); };
}
