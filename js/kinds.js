// v2.1: 카드 형식 — 기본(용어/정의), 확인문제(증례 + 고정 보기 5개), 빈칸(문장 속 {{정답}})
// 확인문제: term = 문제(증례), choices = 보기[], answer = 정답 번호(1~), def = 해설
// 빈칸:    term = 본문 ({{정답}} 표시), def = 메모(출처 등, 선택)
import { esc, shuffle } from './ui.js';

export const kindOf = (c) => (c && (c.kind === 'question' || c.kind === 'cloze') ? c.kind : 'basic');
export const KIND_LABEL = { basic: '기본', question: '확인문제', cloze: '빈칸' };

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circ = (n) => CIRC[n - 1] || `(${n})`;

// ---------- 빈칸 ----------
const CL = /\{\{([\s\S]*?)\}\}/g;
// [{t, blank:false} | {t, blank:true, i}]
export function clozeParts(text) {
  const s = String(text || ''); const out = []; let last = 0, i = 0;
  for (const m of s.matchAll(CL)) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), blank: false });
    out.push({ t: m[1].trim(), blank: true, i: i++ });
    last = m.index + m[0].length;
  }
  if (last < s.length) out.push({ t: s.slice(last), blank: false });
  return out;
}
export const clozeAnswers = (text) => clozeParts(text).filter((p) => p.blank).map((p) => p.t);
export const clozeCount = (text) => clozeAnswers(text).length;
// 글자만: mode 'answer' → 정답을 넣은 문장, 'blank' → [ ① ] 로 가린 문장
export function clozePlain(text, mode = 'answer') {
  return clozeParts(text).map((p) => (!p.blank ? p.t : mode === 'answer' ? p.t : `[ ${circ(p.i + 1)} ]`)).join('');
}
// 화면용 HTML. open: Set(열린 빈칸 번호), all: 전부 열기, target: 객관식으로 묻는 빈칸(다른 빈칸은 열어 둠)
export function clozeHTML(text, { open = null, all = false, target = -1, tap = false } = {}) {
  const parts = clozeParts(text);
  const html = parts.map((p) => {
    if (!p.blank) return esc(p.t);
    const isT = target === p.i;
    const isOpen = !isT && (all || target >= 0 || (open && open.has(p.i)));
    const w = Math.min(14, Math.max(3, [...p.t].length * 0.9));
    if (isOpen) return `<span class="cz open" data-cz="${p.i}"><span class="n">${circ(p.i + 1)}</span>${esc(p.t)}</span>`;
    return `<span class="cz ${isT ? 'tgt' : ''} ${tap && !isT ? 'tap' : ''}" data-cz="${p.i}"><span class="n">${circ(p.i + 1)}</span><span class="gap" style="min-width:${w}em">${isT ? '?' : ''}</span></span>`;
  }).join('');
  return `<div class="cz-text">${html}</div>`;
}

// ---------- 확인문제 ----------
// v2.2 정답 돌려쓰기: answers(정답 후보 여러 개) + wrong(오답 풀). 나올 때마다 정답 1개 + 오답 4개.
const nk = (t) => String(t ?? '').replace(/\s+/g, '');
export const isRot = (c) => kindOf(c) === 'question' && Array.isArray(c.answers);
export const rotAnswers = (c) => (c.answers || []).map((x) => String(x ?? '').trim()).filter(Boolean);
export function rotWrong(c) {
  const ans = new Set(rotAnswers(c).map(nk)); const seen = new Set();
  return (c.wrong || []).map((x) => String(x ?? '').trim()).filter((t) => { const k = nk(t); if (!t || ans.has(k) || seen.has(k)) return false; seen.add(k); return true; });
}
// 같은 단원에서 정답 후보가 같은 카드끼리 한 묶음 (group을 직접 쓰면 그것을 사용)
export const groupKey = (c) => (c.group ? `${c.setId}|g|${c.group}` : `${c.setId}|a|${rotAnswers(c).map(nk).sort().join('·')}`);
// 덜 맞힌(→ 덜 나온) 정답부터. pool: 후보로 한정할 정답 목록
export function pickTarget(c, pool = null) {
  const list = (pool && pool.length ? pool : rotAnswers(c));
  const hits = c.p?.hits || {}, seen = c.p?.seen || {};
  const score = (t) => (hits[t] || 0) * 1000 + (seen[t] || 0) + Math.random() * 0.5;
  return list.slice().sort((a, b) => score(a) - score(b))[0] || '(정답을 입력하세요)';
}
export function rotChoices(c, target) {
  const wrong = shuffle(rotWrong(c)).slice(0, 4);
  return shuffle([{ t: target, ok: true }, ...wrong.map((t) => ({ t, ok: false }))]);
}
export function qChoices(c) {
  const ch = Array.isArray(c.choices) ? c.choices.map((x) => String(x ?? '').trim()) : [];
  return ch;
}
export const qAnswer = (c) => Math.max(1, Math.min(qChoices(c).length || 1, +c.answer || 1));
// 고정 보기 → [{t, ok, no}] (no = 원래 번호). mix면 순서를 섞는다.
export function fixedChoices(c, mix = false) {
  const a = qAnswer(c);
  const list = qChoices(c).map((t, k) => ({ t, ok: k + 1 === a, no: k + 1 })).filter((o) => o.t || o.ok);
  return mix ? shuffle(list) : list;
}
export const qAnswerText = (c) => { if (isRot(c)) return rotAnswers(c).join(' · '); const a = qAnswer(c); return `${circ(a)} ${qChoices(c)[a - 1] || ''}`.trim(); };

// ---------- 목록·검색용 글자 ----------
// 카드 목록(단원 화면, 결과, 오답노트)의 왼쪽(A)·오른쪽(B) HTML
export function listHTML(c) {
  const k = kindOf(c);
  if (isRot(c)) {
    const w = rotWrong(c);
    return {
      a: `<span class="kind-tag q">확인문제 · 돌려쓰기</span>${esc(c.term)}<div class="q-list">오답 풀 ${w.length}개: ${esc(w.join(', '))}</div>`,
      b: `<b>정답 ${rotAnswers(c).length}개: ${esc(rotAnswers(c).join(' · '))}</b>${c.def ? `\n${esc(c.def)}` : ''}`,
    };
  }
  if (k === 'question') {
    const qs = qChoices(c).map((t, i) => `${circ(i + 1)} ${esc(t)}`).join('\n');
    return {
      a: `<span class="kind-tag q">확인문제</span>${esc(c.term)}${qs ? `<div class="q-list">${qs}</div>` : ''}`,
      b: `<b>정답 ${esc(qAnswerText(c))}</b>${c.def ? `\n${esc(c.def)}` : ''}`,
    };
  }
  if (k === 'cloze') {
    const ans = clozeAnswers(c.term);
    return {
      a: `<span class="kind-tag cz">빈칸 ${ans.length}</span>${clozeHTML(c.term, { all: true })}`,
      b: `${ans.map((t, i) => `${circ(i + 1)} ${esc(t)}`).join('\n')}${c.def ? `\n<span class="muted small">${esc(c.def)}</span>` : ''}`,
    };
  }
  return { a: esc(c.term), b: esc(c.def) };
}
// 텍스트 비교·미리보기용
export function plainA(c) {
  const k = kindOf(c);
  if (isRot(c)) return `${c.term}\n오답 풀: ${rotWrong(c).join(', ')}`;
  if (k === 'question') return `${c.term}\n${qChoices(c).map((t, i) => `${circ(i + 1)} ${t}`).join('\n')}`;
  if (k === 'cloze') return clozePlain(c.term, 'blank');
  return c.term;
}
export function plainB(c) {
  const k = kindOf(c);
  if (isRot(c)) return `정답(돌려쓰기): ${rotAnswers(c).join(' · ')}${c.def ? '\n' + c.def : ''}`;
  if (k === 'question') return `정답 ${qAnswerText(c)}${c.def ? '\n' + c.def : ''}`;
  if (k === 'cloze') return clozeAnswers(c.term).map((t, i) => `${circ(i + 1)} ${t}`).join('\n') + (c.def ? `\n(${c.def})` : '');
  return c.def;
}
