// v2.1: 카드 형식 — 기본(용어/정의), 확인문제(증례 + 고정 보기 5개), 빈칸(문장 속 {{정답}})
// 확인문제: term = 문제(증례), choices = 보기[], answer = 정답 번호(1~), def = 해설
// 빈칸:    term = 본문 ({{정답}} 표시), def = 메모(출처 등, 선택)
import { esc, shuffle } from './ui.js';

export const kindOf = (c) => (c && (c.kind === 'question' || c.kind === 'cloze') ? c.kind : 'basic');
export const KIND_LABEL = { basic: '기본', question: '확인문제', cloze: '빈칸' };

const CIRC = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
export const circ = (n) => CIRC[n - 1] || `(${n})`;

// ---------- 굵게 (v2.6) ----------
// **글자** → 굵게. 한 덩어리(글 한 토막, 표 한 칸) 안에서 짝을 맞추고, 빈칸 {{ }}을 사이에 둬도 된다(**{{도담탕}}**).
export function boldState() {
  let on = false;
  return {
    txt(t) { const ps = String(t ?? '').split('**'); let o = esc(ps[0]); for (let i = 1; i < ps.length; i++) { o += on ? '</b>' : '<b>'; on = !on; o += esc(ps[i]); } return o; },
    close() { const o = on ? '</b>' : ''; on = false; return o; },
  };
}
export const fmt = (t) => { if (!String(t ?? '').includes('**')) return esc(t); const B = boldState(); return B.txt(t) + B.close(); };
export const unbold = (t) => String(t ?? '').replace(/\*\*/g, '');

// ---------- 빈칸 ----------
const CL = /\{\{([\s\S]*?)\}\}/g;
// [{t, blank:false} | {t, blank:true, i}]
export function clozeParts(text) {
  const s = String(text || ''); const out = []; let last = 0, i = 0;
  for (const m of s.matchAll(CL)) {
    if (m.index > last) out.push({ t: s.slice(last, m.index), blank: false });
    out.push({ t: m[1].replace(/\*\*/g, '').trim(), blank: true, i: i++ }); // 정답 글자에서는 굵게 표시(**)를 뺀다
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
// v2.4: 본문에 마크다운 표가 있으면 표로 그리고, 칸 안의 빈칸도 순서대로 번호를 매긴다.
// v2.7: fixed = 미리 열어 두고 누를 수 없는 빈칸(변증만·처방만). tap이면 열린 빈칸도 눌러서 다시 닫을 수 있다.
export function clozeHTML(text, { open = null, all = false, target = -1, tap = false, hide = null, fixed = null } = {}) {
  let k = 0;
  const inl = (seg) => { const B = boldState(); return clozeParts(seg).map((p) => {
    if (!p.blank) return B.txt(p.t);
    const i = k++;
    const isT = target === i;
    const isOpen = !isT && (all || (target >= 0 && !(hide && hide.has(i))) || (open && open.has(i)));
    if (isOpen) return `<span class="cz open ${tap && !(fixed && fixed.has(i)) ? 'tap' : ''}" data-cz="${i}">${czInner(p.t, i, true)}</span>`;
    return `<span class="cz ${isT ? 'tgt' : ''} ${tap && !isT ? 'tap' : ''}" data-cz="${i}">${czInner(p.t, i, false, isT)}</span>`;
  }).join('') + B.close(); };
  return `<div class="cz-text">${richBlocks(text, inl)}</div>`;
}

// 빈칸 하나의 속 HTML (열림: 번호+정답 / 닫힘: 번호+빈 칸). 눌러서 바꿀 때도 같은 모양을 쓴다.
export function czInner(t, i, open, isT = false) {
  if (open) return `<span class="n">${circ(i + 1)}</span>${esc(t)}`;
  const w = Math.min(14, Math.max(3, [...String(t)].length * 0.9));
  return `<span class="n">${circ(i + 1)}</span><span class="gap" style="min-width:${w}em">${isT ? '?' : ''}</span>`;
}

// ---------- 표 (v2.4) ----------
// 마크다운 표: '|'로 시작하고 끝나는 줄이 2줄 이상 이어지면 표. 둘째 줄이 |---|---| 이면 첫 줄은 머리글.
// 칸 안의 줄바꿈은 <br>. 칸 안 '|'는 \| 로 쓰거나 {{ }} 안에 있으면 칸을 나누지 않는다.
const TROW = /^\s*\|.*\|\s*$/;
const TSEP = /^\s*\|(\s*:?-{2,}:?\s*\|)+\s*$/;
export const hasTable = (s) => /^\s*\|.*\|\s*$/m.test(String(s || ''));
function splitCells(line) {
  const s = line.trim().replace(/^\|/, '').replace(/\|$/, '');
  const out = []; let cur = '', depth = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' && s[i + 1] === '{') { depth++; cur += '{{'; i++; continue; }
    if (s[i] === '}' && s[i + 1] === '}' && depth) { depth--; cur += '}}'; i++; continue; }
    if (s[i] === '\\' && s[i + 1] === '|') { cur += '|'; i++; continue; }
    if (s[i] === '|' && !depth) { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map((c) => c.trim().replace(/<br\s*\/?>/gi, '\n'));
}
// v2.7 합친 칸: 칸에 `^`만 쓰면 바로 위 칸과, `<`만 쓰면 바로 왼쪽 칸과 하나로 합친다(rowspan/colspan).
export const MERGE_UP = '^', MERGE_LEFT = '<';
function spanGrid(rows, n) {
  const own = [], out = rows.map(() => []);
  rows.forEach((cells, r) => {
    own[r] = [];
    for (let c = 0; c < n; c++) {
      const t = String(cells[c] ?? '').trim();
      if (t === MERGE_UP && r > 0 && own[r - 1][c]) { const o = own[r - 1][c]; if (o.lastR !== r) { o.rs++; o.lastR = r; } own[r][c] = o; continue; }
      if (t === MERGE_LEFT && c > 0 && own[r][c - 1]) { const o = own[r][c - 1]; if (o.r === r) o.cs++; own[r][c] = o; continue; }
      const o = { r, c, rs: 1, cs: 1, lastR: r, t: cells[c] ?? '' }; own[r][c] = o; out[r].push(o);
    }
  });
  return out;
}
function tableHTML(lines, inl) {
  let head = null, body = lines;
  if (lines.length >= 2 && TSEP.test(lines[1])) { head = splitCells(lines[0]); body = lines.slice(2); }
  body = body.filter((l) => !TSEP.test(l)).map(splitCells);
  const n = Math.max(head ? head.length : 0, ...body.map((r) => r.length));
  const rowsHTML = (rows, tag) => spanGrid(rows, n).map((cells) => `<tr>${cells.map((o) => `<${tag}${o.rs > 1 ? ` rowspan="${o.rs}"` : ''}${o.cs > 1 ? ` colspan="${o.cs}"` : ''}${o.rs > 1 || o.cs > 1 ? ' class="mg"' : ''}>${inl(o.t)}</${tag}>`).join('')}</tr>`).join('');
  // 잘림 방지: 표는 자기 칸 안에서만 가로로 밀리고(.tbl-wrap), 오른쪽 위 ⤢로 언제든 전체 화면 보기(table.js)
  return `<div class="tbl-box"><div class="tbl-wrap"><table class="ct">${head ? `<thead>${rowsHTML([head], 'th')}</thead>` : ''}<tbody>${rowsHTML(body, 'td')}</tbody></table></div><span class="tbl-zoom" role="button" tabindex="0" title="표 크게 보기" aria-label="표 크게 보기">⤢</span></div>`;
}
// 글 + 표를 순서대로 HTML로. inl(글조각) → HTML (빈칸 번호를 이어 매기려고 순서대로 부른다)
export function richBlocks(text, inl = fmt) {
  const s = String(text ?? '');
  if (!hasTable(s)) return inl(s);
  const lines = s.split('\n'); const out = []; let buf = [];
  const flushText = () => { if (buf.length) out.push(`<span class="rt-p">${inl(buf.join('\n'))}</span>`); buf = []; };
  for (let i = 0; i < lines.length;) {
    if (TROW.test(lines[i]) && i + 1 < lines.length && TROW.test(lines[i + 1])) {
      let j = i; while (j < lines.length && TROW.test(lines[j])) j++;
      flushText(); out.push(tableHTML(lines.slice(i, j), inl)); i = j;
    } else { buf.push(lines[i]); i++; }
  }
  flushText();
  return out.join('');
}
// ---------- 빈칸 종류 (v2.5) ----------
// 'dx' = 변증(용어), 'rx' = 처방, 'bj' = 병증·병명, '' = 그 밖. 빈칸 순서(①②…)대로 배열을 돌려준다.
// 표: 그 칸의 머리글로 판단(변증 / 처방·치방·방제 / 병증·병명). 표 밖: 줄 맨 앞 `{{…}}:` = 변증, 그 줄의 – · → 뒤 빈칸 = 처방.
export const BLANK_LABEL = { all: '전체', dx: '변증·용어', rx: '처방' };
const DX_H = /변증|증형|증후/;
const BJ_H = /병증|병명/;
const RX_H = /처방|치방|방제|주방|방약/;
const RX_SUFFIX = /(탕|산|환|음|고|단|전|방|湯|散|丸|飮|膏|丹|煎)(\s*[(（].*[)）])?$/;
export function clozeTypes(text) {
  const s = String(text ?? ''); const out = [];
  const lines = s.split('\n');
  let head = null;
  const blanksIn = (t) => clozeParts(t).filter((p) => p.blank);
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const inTable = TROW.test(l) && ((i + 1 < lines.length && TROW.test(lines[i + 1])) || (i > 0 && TROW.test(lines[i - 1])));
    if (inTable) {
      if (TSEP.test(l)) continue;
      const cs = splitCells(l);
      if (i + 1 < lines.length && TSEP.test(lines[i + 1])) { cs.forEach((h, j) => { if (h.trim() === MERGE_LEFT && j > 0) cs[j] = cs[j - 1]; }); head = cs.map((h) => (DX_H.test(h) ? 'dx' : RX_H.test(h) ? 'rx' : BJ_H.test(h) ? 'bj' : '')); cs.forEach((c) => blanksIn(c).forEach(() => out.push(''))); continue; }
      cs.forEach((c, j) => blanksIn(c).forEach(() => out.push(head ? head[j] || '' : '')));
      continue;
    }
    head = null;
    const parts = clozeParts(l); let before = '', hasDx = false; const mine = [];
    parts.forEach((p, k) => {
      if (!p.blank) { before += p.t; return; }
      const after = parts[k + 1] && !parts[k + 1].blank ? parts[k + 1].t : '';
      let t = '';
      if (!hasDx && /^[\s\d.)(①-⑳·•\-]*$/.test(before) && /^\s*[:：]/.test(after)) { t = 'dx'; hasDx = true; }
      else if (hasDx && (/[–—→]/.test(before) || RX_SUFFIX.test(p.t))) t = 'rx';
      mine.push(t); before += p.t;
    });
    out.push(...mine);
  }
  // 줄을 넘는 빈칸 등으로 개수가 어긋나면 종류를 모른다고 본다
  return out.length === clozeCount(s) ? out : clozeAnswers(s).map(() => '');
}
// 이 카드에서 물을 수 있는 빈칸 번호 (want: 'all' | 'dx' | 'rx')
export function clozeTargets(text, want = 'all') {
  const ty = clozeTypes(text);
  return ty.map((t, i) => i).filter((i) => want === 'all' || ty[i] === want);
}
// 물은 빈칸 종류에 따라 정답 확인 전까지 가려 둘 다른 빈칸: 처방 → 다른 처방 / 변증 → 다른 변증 + 처방 전부
export function clozeHide(types, target) {
  const tt = types[target]; const hide = new Set();
  types.forEach((t, i) => { if (i === target) return; if ((tt === 'rx' && t === 'rx') || (tt === 'dx' && (t === 'dx' || t === 'rx'))) hide.add(i); });
  return hide;
}

// 일반 글(기본 카드·확인문제·해설 등) 화면용: 표가 있으면 표로, 없으면 그대로
// v2.6.1: 굵게(<b>)가 섞이면 한 덩어리(span)로 감싼다. 글 칸(.txt)이 flex라서, 감싸지 않으면 글 조각과 <b>가 옆으로 칸칸이 놓였다.
export const rich = (text) => { if (hasTable(text)) return `<div class="rt">${richBlocks(text, fmt)}</div>`; const h = fmt(text); return h.includes('<') ? `<span class="rtx">${h}</span>` : h; };

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
      a: `<span class="kind-tag q">확인문제 · 돌려쓰기</span>${rich(c.term)}<div class="q-list">오답 풀 ${w.length}개: ${esc(w.join(', '))}</div>`,
      b: `<b>정답 ${rotAnswers(c).length}개: ${esc(rotAnswers(c).join(' · '))}</b>${c.def ? `\n${rich(c.def)}` : ''}`,
    };
  }
  if (k === 'question') {
    const qs = qChoices(c).map((t, i) => `${circ(i + 1)} ${esc(t)}`).join('\n');
    return {
      a: `<span class="kind-tag q">확인문제</span>${rich(c.term)}${qs ? `<div class="q-list">${qs}</div>` : ''}`,
      b: `<b>정답 ${esc(qAnswerText(c))}</b>${c.def ? `\n${rich(c.def)}` : ''}`,
    };
  }
  if (k === 'cloze') {
    const ans = clozeAnswers(c.term);
    return {
      a: `<span class="kind-tag cz">빈칸 ${ans.length}</span>${clozeHTML(c.term, { all: true })}`,
      b: `${ans.map((t, i) => `${circ(i + 1)} ${esc(t)}`).join('\n')}${c.def ? `\n<span class="muted small">${esc(c.def)}</span>` : ''}`,
    };
  }
  // v2.6 기본 카드의 앞면 설명(fx)·뒷면 해설(bx)
  return { a: rich(c.term) + (c.fx ? `<div class="q-list">${rich(c.fx)}</div>` : ''), b: rich(c.def) + (c.bx ? `<div class="q-list">해설 · ${rich(c.bx)}</div>` : '') };
}
// 텍스트 비교·미리보기용
export function plainA(c) {
  const k = kindOf(c);
  if (isRot(c)) return `${c.term}\n오답 풀: ${rotWrong(c).join(', ')}`;
  if (k === 'question') return `${c.term}\n${qChoices(c).map((t, i) => `${circ(i + 1)} ${t}`).join('\n')}`;
  if (k === 'cloze') return clozePlain(c.term, 'blank');
  return c.fx ? `${c.term}\n(앞면 설명) ${c.fx}` : c.term;
}
export function plainB(c) {
  const k = kindOf(c);
  if (isRot(c)) return `정답(돌려쓰기): ${rotAnswers(c).join(' · ')}${c.def ? '\n' + c.def : ''}`;
  if (k === 'question') return `정답 ${qAnswerText(c)}${c.def ? '\n' + c.def : ''}`;
  if (k === 'cloze') return clozeAnswers(c.term).map((t, i) => `${circ(i + 1)} ${t}`).join('\n') + (c.def ? `\n(${c.def})` : '');
  return c.bx ? `${c.def}\n(해설) ${c.bx}` : c.def;
}
