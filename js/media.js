// v2.0: 카드 사진 (첨부·배치·전체화면 보기)
import * as st from './store.js';
import { $, $$, esc } from './ui.js';

// ---------- 첨부: 크게 찍은 사진을 화면용 크기로 줄여 저장 ----------
export async function fileToStoredImage(file) { return st.putImage(await st.shrinkImage(file)); }

// ---------- 배치 ----------
// 1장: 크게 / 2~4장: 격자 / 5장 이상: 옆으로 넘기는 띠 + "n/N"
export function photoBlock(ids, { compact = false } = {}) {
  ids = (ids || []).filter(Boolean);
  if (!ids.length) return '';
  const n = ids.length;
  const data = esc(ids.join(','));
  const img = (id, i) => `<img data-img="${esc(id)}" data-i="${i}" alt="사진 ${i + 1}" draggable="false">`;
  if (compact) return `<div class="ph ph-thumb" data-ids="${data}">${img(ids[0], 0)}${n > 1 ? `<span class="ph-badge">+${n - 1}</span>` : ''}</div>`;
  if (n === 1) return `<div class="ph ph1" data-ids="${data}">${img(ids[0], 0)}</div>`;
  if (n <= 4) return `<div class="ph ph-grid ph-g${n}" data-ids="${data}">${ids.map(img).join('')}</div>`;
  return `<div class="ph ph-strip-wrap" data-ids="${data}"><div class="ph-strip">${ids.map(img).join('')}</div><span class="ph-count">1/${n}</span></div>`;
}

// 화면에 그려진 사진 칸에 실제 이미지를 채우고, 누르면 크게 보기
export function hydrate(root = document) {
  $$('img[data-img]', root).forEach(async (im) => {
    if (im.dataset.loaded) return; im.dataset.loaded = '1';
    const u = await st.imageURL(im.dataset.img);
    if (u) im.src = u; else im.classList.add('ph-missing');
  });
  $$('.ph', root).forEach((box) => {
    if (box.dataset.bound) return; box.dataset.bound = '1';
    const ids = box.dataset.ids.split(',');
    box.addEventListener('click', (e) => {
      const im = e.target.closest('img[data-img]'); if (!im) return;
      e.stopPropagation(); openViewer(ids, +im.dataset.i || 0);
    });
    box.addEventListener('pointerdown', (e) => e.stopPropagation()); // 낱말카드 뒤집기·스와이프와 겹치지 않게
    const strip = $('.ph-strip', box), cnt = $('.ph-count', box);
    if (strip && cnt) strip.addEventListener('scroll', () => {
      const i = Math.round(strip.scrollLeft / Math.max(1, strip.clientWidth));
      cnt.textContent = `${Math.min(ids.length, i + 1)}/${ids.length}`;
    }, { passive: true });
  });
}

// ---------- 전체화면 보기: 좌우 넘기기, 두 손가락 확대, 두 번 탭 확대 ----------
export function openViewer(ids, start = 0) {
  let i = start, scale = 1, tx = 0, ty = 0;
  const v = document.createElement('div');
  v.className = 'viewer';
  v.innerHTML = `<div class="vw-top"><span class="vw-count"></span><button class="vw-btn" data-x aria-label="닫기">✕</button></div>
    <div class="vw-stage"><img class="vw-img" alt="" draggable="false"></div>
    ${ids.length > 1 ? '<button class="vw-nav vw-prev" aria-label="이전">‹</button><button class="vw-nav vw-next" aria-label="다음">›</button>' : ''}`;
  document.body.appendChild(v);
  const img = $('.vw-img', v), stage = $('.vw-stage', v), cnt = $('.vw-count', v);
  const apply = () => { img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`; };
  const show = async () => {
    scale = 1; tx = ty = 0; apply();
    cnt.textContent = ids.length > 1 ? `${i + 1} / ${ids.length}` : '';
    img.src = (await st.imageURL(ids[i])) || '';
  };
  const go = (d) => { if (ids.length < 2) return; i = (i + d + ids.length) % ids.length; show(); };
  const close = () => { v.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    else if (e.key === 'ArrowLeft') { e.stopPropagation(); go(-1); }
    else if (e.key === 'ArrowRight') { e.stopPropagation(); go(1); }
  };
  document.addEventListener('keydown', onKey, true);
  $('[data-x]', v).onclick = close;
  const p = $('.vw-prev', v), n = $('.vw-next', v);
  if (p) p.onclick = (e) => { e.stopPropagation(); go(-1); };
  if (n) n.onclick = (e) => { e.stopPropagation(); go(1); };

  const pts = new Map(); let start0 = null, pinch0 = null, lastTap = 0, moved = false;
  stage.addEventListener('pointerdown', (e) => {
    stage.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false;
    if (pts.size === 1) start0 = { x: e.clientX, y: e.clientY, tx, ty };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; pinch0 = { d: Math.hypot(a.x - b.x, a.y - b.y), scale }; }
  });
  stage.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch0) {
      const [a, b] = [...pts.values()];
      scale = Math.min(5, Math.max(1, pinch0.scale * Math.hypot(a.x - b.x, a.y - b.y) / Math.max(1, pinch0.d)));
      if (scale === 1) { tx = ty = 0; }
      moved = true; apply();
    } else if (pts.size === 1 && start0) {
      const dx = e.clientX - start0.x, dy = e.clientY - start0.y;
      if (Math.abs(dx) > 6 || Math.abs(dy) > 6) moved = true;
      if (scale > 1) { tx = start0.tx + dx; ty = start0.ty + dy; apply(); }
      else { img.style.transform = `translateX(${dx}px)`; }
    }
  });
  const up = (e) => {
    if (!pts.has(e.pointerId)) return;
    pts.delete(e.pointerId);
    if (pts.size === 1) { const [q] = [...pts.values()]; start0 = { x: q.x, y: q.y, tx, ty }; pinch0 = null; return; }
    if (pts.size) return;
    pinch0 = null;
    if (start0 && scale === 1) {
      const dx = e.clientX - start0.x;
      if (moved && Math.abs(dx) > 60) { go(dx < 0 ? 1 : -1); start0 = null; return; }
      apply();
    }
    if (!moved) {
      const t = Date.now();
      if (t - lastTap < 300) { scale = scale > 1 ? 1 : 2.5; tx = ty = 0; apply(); lastTap = 0; }
      else { lastTap = t; if (e.target === stage && scale === 1) setTimeout(() => { if (lastTap === t) close(); }, 310); }
    }
    start0 = null;
  };
  stage.addEventListener('pointerup', up);
  stage.addEventListener('pointercancel', up);
  stage.addEventListener('wheel', (e) => { e.preventDefault(); scale = Math.min(5, Math.max(1, scale * (e.deltaY < 0 ? 1.15 : 1 / 1.15))); if (scale === 1) tx = ty = 0; apply(); }, { passive: false });
  show();
}

// 시험 모드: 여러 장 중 한 장만 무작위로 (같은 회차 안에서는 같은 사진 유지)
export const pickOne = (ids) => (ids && ids.length ? [ids[Math.floor(Math.random() * ids.length)]] : []);
