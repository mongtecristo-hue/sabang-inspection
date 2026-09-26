import { MODES, fmtM, fmtDeg } from './geometry.js';

export const REF_NOTICE = '참고용 측정값입니다. 공식 수치는 줄자·측량기기로 확인하십시오.';

export const captureFrame = (video) => {
  const vw = video?.videoWidth, vh = video?.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, 1280 / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.8), w: canvas.width, h: canvas.height };
};

const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });

const pointCaption = (p) => {
  if (p.station1) return `1차 위치 수평 ${fmtM(p.horizontal)}`;
  if (p.segment != null) return `수평 ${fmtM(p.horizontal)} · 앞 지점과 ${fmtM(p.segment)}`;
  return `수평 ${fmtM(p.horizontal)} · 사거리 ${fmtM(p.slope)}${p.fromBase != null ? ` · 기저 대비 ${fmtM(p.fromBase)}` : ''}`;
};

// 촬영 사진을 나란히 배치하고 조준점·결과를 합성한 기록 사진
export const buildComposite = async (result, unc, meta) => {
  const points = result.points;
  const cell = 480, cols = Math.min(2, points.length), rows = Math.ceil(points.length / cols);
  const imgs = await Promise.all(points.map(p => (p.frame ? loadImage(p.frame) : null)));
  const cellH = Math.max(...imgs.map(im => (im ? cell * im.height / im.width : cell * 0.75)));
  const values = result.cards.map(k => `${result.cardLabels[k]} ${fmtM(result.summary[k])}${unc ? ` ±${unc[k].toFixed(2)}` : ''}`);
  const lines = [
    values.slice(0, 2).join(' · '),
    ...(values.length > 2 ? [values.slice(2).join(' · ')] : []),
    `기준: ${result.basis} · ${MODES[meta.mode].label} · ${meta.paramText}`,
    `${meta.title ? `[${meta.title}] ` : ''}${meta.time}`,
    ...(meta.gps ? [`관측점 N ${meta.gps.lat.toFixed(6)}, E ${meta.gps.lng.toFixed(6)}`] : []),
    `※ ${REF_NOTICE}`
  ];
  const band = 24 * lines.length + 28;
  const canvas = document.createElement('canvas');
  canvas.width = cell * cols; canvas.height = Math.round(cellH * rows + band);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  imgs.forEach((im, i) => {
    const p = points[i];
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cellH;
    if (im) {
      const h = cell * im.height / im.width;
      ctx.drawImage(im, x0, y0, cell, h);
      const s = cell / p.frameW, mx = x0 + p.markX * s, my = y0 + p.markY * s;
      ctx.strokeStyle = p.isRef ? '#34D399' : '#FBBF24'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(mx, my, 14, 0, Math.PI * 2); ctx.moveTo(mx - 24, my); ctx.lineTo(mx + 24, my); ctx.moveTo(mx, my - 24); ctx.lineTo(mx, my + 24); ctx.stroke();
    }
    ctx.fillStyle = 'rgba(15,23,42,0.78)'; ctx.fillRect(x0, y0, cell, 50);
    ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'top';
    ctx.font = 'bold 17px sans-serif'; ctx.fillText(`${i + 1}. ${p.label}  앙각 ${fmtDeg(p.elev)}`, x0 + 10, y0 + 6);
    ctx.font = '14px sans-serif'; ctx.fillText(pointCaption(p), x0 + 10, y0 + 28);
  });

  ctx.textBaseline = 'top';
  lines.forEach((t, i) => {
    ctx.font = i < (values.length > 2 ? 2 : 1) ? 'bold 18px sans-serif' : '14px sans-serif';
    ctx.fillStyle = i === lines.length - 1 ? '#FBBF24' : '#FFFFFF';
    ctx.fillText(t, 12, cellH * rows + 14 + i * 24);
  });
  return canvas.toDataURL('image/jpeg', 0.8);
};

export const dataUrlToBlob = async (dataUrl) => (await fetch(dataUrl)).blob();

// 파일 저장: 안드로이드 Chrome은 「다운로드」 폴더에 저장되며 갤러리 앱에서도 보인다.
export const saveBlob = (blob, name) => {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
};

// 공유 시트(카카오톡·메일·드라이브 등). 지원하지 않으면 false.
export const shareBlob = async (blob, name, text) => {
  const file = new File([blob], name, { type: blob.type });
  if (!navigator.canShare?.({ files: [file] })) return false;
  try { await navigator.share({ files: [file], title: name, text }); } catch { /* 사용자가 취소 */ }
  return true;
};

export const stamp = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}${String(d.getSeconds()).padStart(2, '0')}`;
