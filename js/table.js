// v2.4: 카드 안 표가 화면에서 잘리지 않게
// 1) 표는 자기 상자(.tbl-wrap) 안에서만 가로로 밀린다 → 페이지 전체가 옆으로 넘치지 않음
// 2) 상자보다 넓은 표는 .wide 표시(오른쪽 그림자 + "밀어서 보기")
// 3) ⤢ 버튼: 표를 전체 화면으로 크게 보기(글자 크기 조절, 가로·세로 스크롤)
// 4) 넓은 표를 미는 손가락이 낱말카드 스와이프·뒤집기로 잘못 읽히지 않게 막음
const BOX = '.tbl-box';
function check(box) {
  const w = box.querySelector('.tbl-wrap'); if (!w) return;
  const wide = w.scrollWidth > w.clientWidth + 2;
  box.classList.toggle('wide', wide);
  box.classList.toggle('at-end', !wide || w.scrollLeft + w.clientWidth >= w.scrollWidth - 2);
  if (!w.dataset.sc) { w.dataset.sc = '1'; w.addEventListener('scroll', () => box.classList.toggle('at-end', w.scrollLeft + w.clientWidth >= w.scrollWidth - 2), { passive: true }); }
}
export function checkTables(root = document) { root.querySelectorAll(BOX).forEach(check); }

let fs = 17;
export function openTable(box) {
  const tbl = box.querySelector('table'); if (!tbl) return;
  const v = document.createElement('div');
  v.className = 'tbl-viewer'; v.setAttribute('role', 'dialog');
  v.innerHTML = `<div class="tv-top"><button class="tv-btn" data-s="-1" aria-label="글자 작게">가−</button><button class="tv-btn" data-s="1" aria-label="글자 크게">가+</button><span class="tv-sp"></span><button class="tv-btn" data-x aria-label="닫기">✕ 닫기</button></div><div class="tv-body"></div>`;
  const body = v.querySelector('.tv-body');
  const t = tbl.cloneNode(true); body.appendChild(t);
  const size = () => { t.style.fontSize = fs + 'px'; };
  size();
  document.body.appendChild(v);
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape' || e.key === ' ' || e.key === 'Backspace') { e.preventDefault(); e.stopPropagation(); close(); } else e.stopPropagation(); };
  document.addEventListener('keydown', onKey, true);
  v.querySelector('[data-x]').onclick = close;
  v.querySelectorAll('[data-s]').forEach((b) => (b.onclick = () => { fs = Math.max(12, Math.min(30, fs + 2 * +b.dataset.s)); size(); }));
  ['pointerdown', 'pointerup', 'click'].forEach((ev) => v.addEventListener(ev, (e) => e.stopPropagation()));
}

export function initTables() {
  // 넓은 표를 밀 때·⤢를 누를 때는 카드(뒤집기·스와이프·정답 보기·보기 고르기)로 이벤트가 가지 않게
  document.addEventListener('pointerdown', (e) => {
    const z = e.target.closest && e.target.closest('.tbl-zoom');
    if (z || (e.target.closest && e.target.closest('.tbl-box.wide .tbl-wrap') && !e.target.closest('.cz.tap'))) e.stopPropagation();
  }, true);
  const zoom = (e) => {
    const z = e.target.closest && e.target.closest('.tbl-zoom'); if (!z) return;
    e.preventDefault(); e.stopPropagation(); openTable(z.closest(BOX));
  };
  document.addEventListener('click', zoom, true);
  document.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.classList && e.target.classList.contains('tbl-zoom')) zoom(e); }, true);
  // 화면이 새로 그려지거나 크기·방향이 바뀌면 다시 잰다
  let raf = 0;
  const later = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => checkTables()); };
  new MutationObserver((ms) => { if (ms.some((m) => [...m.addedNodes].some((n) => n.nodeType === 1 && (n.matches(BOX) || n.querySelector(BOX))))) later(); })
    .observe(document.body, { childList: true, subtree: true });
  window.addEventListener('resize', later);
  window.addEventListener('orientationchange', later);
  if (window.ResizeObserver) { const ro = new ResizeObserver(later); ro.observe(document.body); }
  // 낱말카드 뒤집기처럼 처음엔 안 보이던 면도 보일 때 다시 재기
  document.addEventListener('transitionend', later, true);
}
