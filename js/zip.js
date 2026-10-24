// v2.4: 카드팩 zip(카드팩.json + 사진 파일) 읽기. 라이브러리 없이 브라우저 DecompressionStream 사용.
// 지원: 저장(0)·deflate(8) 방식. 한글 파일 이름은 UTF-8 → 안 되면 EUC-KR(윈도우 압축)로 읽는다.
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', bmp: 'image/bmp', json: 'application/json' };
export const extOf = (n) => (String(n).toLowerCase().match(/\.([a-z0-9]+)$/) || [])[1] || '';
export const isImageName = (n) => ['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp'].includes(extOf(n));
export const baseName = (n) => String(n).split(/[\\/]/).pop();

function decodeName(bytes, utf8Flag) {
  if (utf8Flag) return new TextDecoder('utf-8').decode(bytes);
  try { return new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
  catch (_) { try { return new TextDecoder('euc-kr').decode(bytes); } catch (__) { return new TextDecoder('utf-8').decode(bytes); } }
}

// → [{ name, blob }]  (폴더·__MACOSX 제외)
export async function unzip(file) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let e = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('zip 파일을 읽을 수 없습니다.');
  const n = dv.getUint16(e + 10, true); let p = dv.getUint32(e + 16, true);
  const out = [];
  for (let k = 0; k < n; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) break;
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lh = dv.getUint32(p + 42, true);
    const name = decodeName(buf.subarray(p + 46, p + 46 + nl), flags & 0x800);
    p += 46 + nl + xl + cl;
    if (name.endsWith('/') || /(^|\/)(__MACOSX|\.)/.test(name)) continue;
    const start = lh + 30 + dv.getUint16(lh + 26, true) + dv.getUint16(lh + 28, true);
    const raw = buf.subarray(start, start + csize);
    const type = MIME[extOf(name)] || '';
    let blob;
    if (method === 0) blob = new Blob([raw], { type });
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('이 브라우저는 zip 압축 풀기를 지원하지 않아요. 크롬을 최신으로 업데이트해 주세요.');
      const ab = await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer();
      blob = new Blob([ab], { type });
    } else continue;
    out.push({ name, blob });
  }
  return out;
}
