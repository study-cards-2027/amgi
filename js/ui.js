// 화면 공통 도구
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export function shuffle(a) {
  a = a.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const P = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
export const I = {
  star: P('<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/>'),
  starFill: `<svg viewBox="0 0 24 24" fill="currentColor"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.6l6.2-.9z"/></svg>`,
  edit: P('<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="m14 6 4 4"/>'),
  trash: P('<path d="M4 7h16M10 11v6m4-6v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  more: P('<circle cx="5" cy="12" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="19" cy="12" r="1.3"/>'),
  back: P('<path d="M15 18 9 12l6-6"/>'),
  close: P('<path d="M6 6l12 12M18 6 6 18"/>'),
  shuffle: P('<path d="M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>'),
  cards: P('<rect x="3" y="5" width="14" height="15" rx="2"/><path d="M7 2h12a2 2 0 0 1 2 2v13"/>'),
  test: P('<path d="M9 4h6M8 4H5v17h14V4h-3"/><path d="m8.5 13 2.5 2.5 4.5-5"/>'),
  match: P('<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'),
  review: P('<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5M12 7v5l3 2"/>'),
  plus: P('<path d="M12 5v14M5 12h14"/>'),
  import: P('<path d="M12 3v12m0 0-4-4m4 4 4-4M4 17v3h16v-3"/>'),
  up: P('<path d="m6 15 6-6 6 6"/>'),
  down: P('<path d="m6 9 6 6 6-6"/>'),
  wrong: P('<path d="M4 4h12l4 4v12H4z"/><path d="m9 11 6 6m0-6-6 6"/>'),
  flip: P('<path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3"/><path d="M18 3v4h-4M6 21v-4h4"/>'),
  undo: P('<path d="M9 14 4 9l5-5"/><path d="M4 9h11a5 5 0 0 1 0 10h-3"/>'),
  folder: P('<path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>'),
};

let toastTimer;
export function toast(msg, ms = 2200) {
  let t = $('#toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; t.className = 'toast'; document.body.appendChild(t); }
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, ms);
}

export function modal(inner, onMount) {
  return new Promise((resolve) => {
    const bg = document.createElement('div');
    bg.className = 'modal-bg';
    bg.innerHTML = `<div class="modal" role="dialog" aria-modal="true">${inner}</div>`;
    document.body.appendChild(bg);
    const close = (v) => { bg.remove(); document.removeEventListener('keydown', onKey, true); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(null); } };
    document.addEventListener('keydown', onKey, true);
    bg.addEventListener('click', (e) => { if (e.target === bg) close(null); });
    onMount && onMount(bg.firstElementChild, close);
  });
}

export function ask(title, value = '', placeholder = '', okLabel = '확인') {
  return modal(`<h3>${esc(title)}</h3>
    <input class="input" id="m-in" value="${esc(value)}" placeholder="${esc(placeholder)}" autocomplete="off">
    <div class="row end"><button class="btn ghost" data-x>취소</button><button class="btn primary" data-ok>${esc(okLabel)}</button></div>`,
  (m, close) => {
    const inp = $('#m-in', m); setTimeout(() => { inp.focus(); inp.select(); }, 30);
    const ok = () => { const v = inp.value.trim(); if (v) close(v); else inp.focus(); };
    $('[data-ok]', m).onclick = ok; $('[data-x]', m).onclick = () => close(null);
    inp.onkeydown = (e) => { if (e.key === 'Enter' && !e.isComposing) ok(); };
  });
}

export function confirmBox(title, msg = '', okLabel = '확인', danger = false) {
  return modal(`<h3>${esc(title)}</h3>${msg ? `<p class="muted">${msg}</p>` : ''}
    <div class="row end"><button class="btn ghost" data-x>취소</button><button class="btn ${danger ? 'ng' : 'primary'}" data-ok>${esc(okLabel)}</button></div>`,
  (m, close) => { $('[data-ok]', m).onclick = () => close(true); $('[data-x]', m).onclick = () => close(false); setTimeout(() => $('[data-ok]', m).focus(), 30); });
}

// 점 3개 메뉴
export function menu(anchorBtn, items) {
  document.querySelectorAll('.menu-pop').forEach((x) => x.remove());
  const pop = document.createElement('div');
  pop.className = 'menu-pop';
  pop.innerHTML = items.map((it, i) => `<button data-i="${i}" class="${it.danger ? 'danger' : ''}">${esc(it.label)}</button>`).join('');
  anchorBtn.parentElement.classList.add('menu');
  anchorBtn.parentElement.appendChild(pop);
  const off = (e) => { if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener('pointerdown', off, true); } };
  setTimeout(() => document.addEventListener('pointerdown', off, true), 0);
  pop.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; pop.remove(); document.removeEventListener('pointerdown', off, true); items[+b.dataset.i].run(); };
}

export function fmtDur(ms) {
  const m = ms / 60000;
  if (m < 0.9) return '1분 미만';
  if (m < 60) return `${Math.max(1, Math.round(m))}분`;
  const h = m / 60; if (h < 24) return `${Math.round(h)}시간`;
  const d = h / 24; if (d < 30) return `${Math.round(d)}일`;
  const mo = d / 30; if (mo < 12) return `${mo.toFixed(mo < 3 ? 1 : 0)}개월`;
  return `${(d / 365).toFixed(1)}년`;
}
export function fmtDate(ts) {
  const d = new Date(ts); const z = (n) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}/${d.getDate()} ${z(d.getHours())}:${z(d.getMinutes())}`;
}
export function autoGrow(ta) { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; }

export function download(filename, text, type = 'application/json') {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}
export function readFile(file) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(file, 'utf-8'); });
}

// ---------- 별점 (v2.0) ----------
// v: null(없음) 또는 0~5. inherited: 단원·폴더에서 물려받은 별점이면 흐리게
export function starsHTML(v, inherited = false, size = '') {
  if (v === null || v === undefined) return `<span class="stars none ${size}" title="별점 없음">☆<small>없음</small></span>`;
  return `<span class="stars ${inherited ? 'inh' : ''} ${size}" title="${inherited ? '물려받은 별점 ' : '별점 '}${v}개">${'★'.repeat(v)}<span class="off">${'★'.repeat(5 - v)}</span></span>`;
}
// 별점 고르기 창. 결과: 0~5 | null(없음) | undefined(취소)
export function pickRating(title, current, { inheritNote = '' } = {}) {
  return new Promise((resolve) => {
    let done = false;
    modal(`<h3>${esc(title)}</h3>
      <div class="rate-pick">${[5, 4, 3, 2, 1, 0].map((n) => `<button class="btn block ${current === n ? 'primary' : ''}" data-r="${n}">${starsHTML(n)} <span class="small">${n}개</span></button>`).join('')}
      <button class="btn block ghost ${current === null || current === undefined ? 'primary' : ''}" data-r="none">별점 없음${inheritNote ? ` <span class="small muted">(${esc(inheritNote)})</span>` : ''}</button></div>
      <div class="row end"><button class="btn ghost" data-x>취소</button></div>`,
    (m, close) => {
      $$('[data-r]', m).forEach((b) => (b.onclick = () => { done = true; close(); resolve(b.dataset.r === 'none' ? null : +b.dataset.r); }));
      $('[data-x]', m).onclick = () => close();
    }).then(() => { if (!done) resolve(undefined); });
  });
}
