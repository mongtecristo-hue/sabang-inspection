import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Ruler, Crosshair, Undo2, X, Check, Compass, Download, Save, RotateCcw, Trash2, Camera, FileSpreadsheet, MapPin } from 'lucide-react';
import { MODES, solve, uncertainty, offsetElevation, destinationPoint, fmtM, fmtNum, fmtDeg } from './geometry.js';
import { useDeviceTilt, requestTiltPermission } from './useDeviceTilt.js';

/* =========================================================================
   카메라 거리측정
   - 십자선으로 지점을 조준·촬영 → 사진 위 탭으로 조준점 미세 보정
   - 수평거리 · 사거리 · 높이차 산출, 오차 범위·표적 추정 좌표 제시
   ========================================================================= */

const SETTINGS_KEY = 'sabang.measure.settings';
const LOG_KEY = 'sabang.measure.log';

const DEFAULT_SETTINGS = { cameraHeight: '1.5', refHeight: '2.0', fov: '65', declination: '-8.5', calib: { beta: 0, gamma: 0 } };

const loadJSON = (key, fallback) => {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
};
const saveJSON = (key, value) => {
  try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch { return false; }
};

const captureFrame = (video) => {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || !vh) return null;
  const scale = Math.min(1, 1280 / Math.max(vw, vh));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(vw * scale); canvas.height = Math.round(vh * scale);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
  return { dataUrl: canvas.toDataURL('image/jpeg', 0.75), w: canvas.width, h: canvas.height };
};

const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });

// 촬영 사진을 나란히 배치하고 조준점·결과를 합성한 기록 사진
const buildComposite = async (points, result, unc, meta) => {
  const cell = 420, cols = Math.min(3, points.length), rows = Math.ceil(points.length / cols);
  const imgs = await Promise.all(points.map(p => loadImage(p.frame)));
  const cellH = Math.max(...imgs.map(im => cell * im.height / im.width));
  const lines = [
    `수평거리 ${fmtM(result.summary.horizontal)}${unc ? ` ±${unc.horizontal.toFixed(2)}` : ''} · 사거리 ${fmtM(result.summary.slope)}`,
    `높이차 ${fmtM(result.summary.heightDiff)}${unc ? ` ±${unc.heightDiff.toFixed(2)}` : ''} (${result.summary.heightDiffBasis})`,
    `${MODES[meta.mode].label} · ${meta.paramText}`,
    `${meta.title ? `[${meta.title}] ` : ''}${meta.time}`,
    ...(meta.gps ? [`관측점 N ${meta.gps.lat.toFixed(6)}, E ${meta.gps.lng.toFixed(6)}`] : [])
  ];
  const band = 22 * lines.length + 28;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(cell * cols, 560); canvas.height = Math.round(cellH * rows + band);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#0F172A'; ctx.fillRect(0, 0, canvas.width, canvas.height);

  imgs.forEach((im, i) => {
    const p = points[i];
    const x0 = (i % cols) * cell, y0 = Math.floor(i / cols) * cellH, h = cell * im.height / im.width;
    ctx.drawImage(im, x0, y0, cell, h);
    const s = cell / p.frameW, mx = x0 + p.markX * s, my = y0 + p.markY * s;
    ctx.strokeStyle = p.isRef ? '#34D399' : '#FBBF24'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mx, my, 12, 0, Math.PI * 2); ctx.moveTo(mx - 20, my); ctx.lineTo(mx + 20, my); ctx.moveTo(mx, my - 20); ctx.lineTo(mx, my + 20); ctx.stroke();
    ctx.fillStyle = 'rgba(15,23,42,0.75)'; ctx.fillRect(x0, y0, cell, 44);
    ctx.fillStyle = '#FFFFFF'; ctx.font = 'bold 15px sans-serif'; ctx.textBaseline = 'top';
    ctx.fillText(`${i + 1}. ${p.label}  앙각 ${fmtDeg(p.elev)}`, x0 + 8, y0 + 5);
    ctx.font = '13px sans-serif';
    ctx.fillText(`사거리 ${fmtM(p.slope)}  기저 대비 ${fmtM(p.fromBase)}`, x0 + 8, y0 + 25);
  });

  ctx.fillStyle = '#FFFFFF'; ctx.textBaseline = 'top';
  lines.forEach((t, i) => { ctx.font = i < 2 ? 'bold 16px sans-serif' : '13px sans-serif'; ctx.fillText(t, 10, cellH * rows + 12 + i * 22); });
  return canvas.toDataURL('image/jpeg', 0.7);
};

const downloadDataUrl = (url, name) => {
  const a = document.createElement('a'); a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
};

const stamp = (d = new Date()) => `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}_${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;

const Field = ({ label, value, onChange, unit, step = '0.1', hint }) => (
  <div>
    <label className="block text-[10px] font-bold text-slate-400 mb-1">{label}</label>
    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-lg focus-within:ring-1 focus-within:ring-emerald-500">
      <input type="number" inputMode="decimal" step={step} value={value} onChange={e => onChange(e.target.value)} className="w-full p-2.5 bg-transparent text-sm font-bold text-slate-700 outline-none" />
      {unit && <span className="pr-3 text-xs font-bold text-slate-400">{unit}</span>}
    </div>
    {hint && <p className="text-[10px] text-slate-400 mt-1 leading-snug">{hint}</p>}
  </div>
);

const DistanceMeasure = ({ showToast, defaultTitle = '' }) => {
  const [stage, setStage] = useState('setup'); // setup | camera | review | result
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) }));
  const [mode, setMode] = useState('ground');
  const [knownDistance, setKnownDistance] = useState('');
  const [title, setTitle] = useState(defaultTitle);
  const [memo, setMemo] = useState('');
  const [shots, setShots] = useState([]);
  const [pending, setPending] = useState(null);
  const [tiltActive, setTiltActive] = useState(false);
  const [gps, setGps] = useState(null);
  const [composite, setComposite] = useState(null);
  const [log, setLog] = useState(() => loadJSON(LOG_KEY, []));
  const [camError, setCamError] = useState('');
  const [calibPending, setCalibPending] = useState(false);
  const [imgBox, setImgBox] = useState(null); // 검토 사진의 화면상 표시 영역

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const reviewImgRef = useRef(null);
  const tilt = useDeviceTilt(tiltActive, settings.calib);

  useEffect(() => { saveJSON(SETTINGS_KEY, settings); }, [settings]);
  useEffect(() => () => stopCamera(), []);

  const setS = (k) => (v) => setSettings(s => ({ ...s, [k]: v }));
  const params = { cameraHeight: settings.cameraHeight, refHeight: settings.refHeight, knownDistance };
  const nRef = MODES[mode].refSteps.length;

  /* ---------- 카메라 ---------- */
  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
  };

  const attachStream = () => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  };
  useEffect(attachStream, [stage]);

  const startCamera = async () => {
    const perm = await requestTiltPermission(); // 사용자 제스처 안에서 먼저 요청
    setTiltActive(true);
    if (perm !== 'granted') showToast('기울기 센서 권한이 없습니다. 결과 화면에서 각도를 직접 입력해야 합니다.', 'error');
    setCamError('');
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
        });
      }
    } catch (err) {
      setCamError(err?.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주십시오.' : '카메라를 열 수 없습니다. HTTPS 접속과 기기 카메라를 확인해 주십시오.');
    }
    if (!gps && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => {}, { enableHighAccuracy: true, timeout: 15000 }
      );
    }
    setStage('camera');
  };

  const shoot = () => {
    const frame = videoRef.current ? captureFrame(videoRef.current) : null;
    const centerElev = tilt.elev;
    const i = shots.length;
    const label = i < nRef ? MODES[mode].refSteps[i] : (mode === 'ground' && i === 1 ? '상단' : `지점 ${i + 1}`);
    setPending({
      label, centerElev: centerElev ?? 0, elev: centerElev ?? 0, manual: centerElev == null, heading: tilt.heading,
      frame: frame?.dataUrl, frameW: frame?.w || 1, frameH: frame?.h || 1,
      markX: (frame?.w || 1) / 2, markY: (frame?.h || 1) / 2, time: new Date().toISOString()
    });
    setStage('review');
  };

  // object-contain으로 표시된 사진의 배율·여백
  const imgLayout = () => {
    const img = reviewImgRef.current;
    if (!img || !pending?.frame) return null;
    const r = img.getBoundingClientRect();
    const sc = Math.min(r.width / pending.frameW, r.height / pending.frameH);
    return { r, sc, ox: (r.width - pending.frameW * sc) / 2, oy: (r.height - pending.frameH * sc) / 2 };
  };
  const measureImgBox = () => setImgBox(imgLayout());
  useEffect(() => {
    const img = reviewImgRef.current;
    if (stage !== 'review' || !img) return undefined;
    const ro = new ResizeObserver(measureImgBox);
    ro.observe(img);
    return () => ro.disconnect();
  }, [stage, pending?.frame]);

  // 사진 위 탭 → 조준점 이동 및 앙각 보정
  const onReviewTap = (e) => {
    const L = imgLayout();
    if (!L) return;
    const fx = (e.clientX - L.r.left - L.ox) / L.sc, fy = (e.clientY - L.r.top - L.oy) / L.sc;
    if (fx < 0 || fy < 0 || fx > pending.frameW || fy > pending.frameH) return;
    const elev = offsetElevation(pending.centerElev, pending.frameH / 2 - fy, pending.frameW, pending.frameH, Number(settings.fov) || 65);
    setPending(p => ({ ...p, markX: fx, markY: fy, elev }));
  };

  const confirmShot = () => {
    setShots(s => [...s, pending]);
    setPending(null);
    setStage('camera');
  };

  /* ---------- 결과 ---------- */
  const result = useMemo(() => solve(mode, shots, params), [mode, shots, settings.cameraHeight, settings.refHeight, knownDistance]);
  const unc = useMemo(() => uncertainty(mode, shots, params), [mode, shots, settings.cameraHeight, settings.refHeight, knownDistance]);

  const live = useMemo(() => {
    if (tilt.elev == null) return null;
    const r = solve(mode, [...shots, { elev: tilt.elev, label: '조준' }], params);
    return r.error ? null : r;
  }, [tilt.elev, mode, shots, settings.cameraHeight, settings.refHeight, knownDistance]);

  const target = useMemo(() => {
    if (result.error || !gps) return null;
    const hd = shots.find(s => s.heading != null)?.heading;
    if (hd == null) return null;
    const bearing = (hd + (Number(settings.declination) || 0) + 360) % 360;
    return { ...destinationPoint(gps.lat, gps.lng, bearing, result.D), bearing };
  }, [result, gps, shots, settings.declination]);

  const meta = () => ({
    mode, title, time: new Date().toLocaleString('ko-KR'), gps,
    paramText: mode === 'ground' ? `카메라 높이 ${settings.cameraHeight} m` : mode === 'staff' ? `기준 높이 ${settings.refHeight} m` : `입력 수평거리 ${knownDistance} m`
  });

  useEffect(() => {
    if (stage !== 'result' || result.error || !result.points.every(p => p.frame)) { setComposite(null); return; }
    let alive = true;
    buildComposite(result.points, result, unc, meta()).then(url => { if (alive) setComposite(url); }).catch(() => {});
    return () => { alive = false; };
  }, [stage, result, unc, title]);

  const goResult = () => { stopCamera(); setStage('result'); };
  const updateShot = (i, patch) => setShots(s => s.map((x, j) => j === i ? { ...x, ...patch } : x));

  const resetMeasure = () => { setShots([]); setPending(null); setComposite(null); setStage('setup'); };

  const saveRecord = () => {
    if (result.error) return;
    const rec = {
      id: Date.now().toString(), time: new Date().toISOString(), title, memo, mode,
      params: { ...params }, gps, target,
      summary: result.summary, uncertainty: unc,
      points: result.points.map(p => ({ label: p.label, elev: p.elev, slope: p.slope, fromBase: p.fromBase, fromGround: p.fromGround, manual: !!p.manual })),
      image: composite
    };
    let next = [rec, ...log];
    if (!saveJSON(LOG_KEY, next)) {
      next = [{ ...rec, image: null }, ...log];
      if (!saveJSON(LOG_KEY, next)) { showToast('저장 공간이 부족합니다. 이전 기록을 정리해 주십시오.', 'error'); return; }
      showToast('저장 공간이 부족해 사진 없이 수치만 저장했습니다. 이미지는 따로 내려받아 주십시오.', 'info');
    } else showToast('측정 기록을 저장했습니다.', 'success');
    setLog(next);
  };

  const deleteRecord = (id) => { const next = log.filter(r => r.id !== id); setLog(next); saveJSON(LOG_KEY, next); };

  const exportCsv = () => {
    const head = ['일시', '제목', '방식', '수평거리(m)', '수평거리 오차(±m)', '사거리(m)', '높이차(m)', '높이차 오차(±m)', '높이차 기준', '지점별(라벨:앙각°/사거리m/기저대비m)', '관측점 위도', '관측점 경도', '추정 표적 위도', '추정 표적 경도', '메모'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = log.map(r => [
      new Date(r.time).toLocaleString('ko-KR'), r.title, MODES[r.mode]?.label,
      r.summary.horizontal?.toFixed(2), r.uncertainty?.horizontal?.toFixed(2), r.summary.slope?.toFixed(2), r.summary.heightDiff?.toFixed(2), r.uncertainty?.heightDiff?.toFixed(2), r.summary.heightDiffBasis,
      r.points.map(p => `${p.label}:${p.elev.toFixed(2)}/${p.slope.toFixed(2)}/${p.fromBase.toFixed(2)}`).join(' | '),
      r.gps?.lat?.toFixed(6), r.gps?.lng?.toFixed(6), r.target?.lat?.toFixed(6), r.target?.lng?.toFixed(6), r.memo
    ].map(q).join(','));
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    downloadDataUrl(url, `거리측정기록_${stamp()}.csv`);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const calibrate = async () => {
    const perm = await requestTiltPermission();
    if (perm !== 'granted') { showToast('기울기 센서를 사용할 수 없습니다.', 'error'); return; }
    setTiltActive(true);
    showToast('휴대폰을 수평면에 화면이 위로 향하게 놓고 기다려 주십시오.', 'info');
    setTimeout(() => setCalibPending(true), 2500);
  };
  useEffect(() => {
    if (!calibPending) return;
    setCalibPending(false);
    const raw = tilt.raw;
    if (!raw || Math.abs(raw.beta) > 10 || Math.abs(raw.gamma) > 10) { showToast('수평 상태가 아닙니다(±10° 초과). 다시 시도해 주십시오.', 'error'); return; }
    setSettings(s => ({ ...s, calib: { beta: raw.beta, gamma: raw.gamma } }));
    showToast(`영점 보정 완료 (β ${raw.beta.toFixed(2)}°, γ ${raw.gamma.toFixed(2)}°)`, 'success');
  }, [calibPending]);

  /* ============================ 렌더 ============================ */

  if (stage === 'camera' || stage === 'review') {
    const i = shots.length;
    const stepText = i < nRef ? `${nRef > 1 ? `${i + 1}/${nRef}. ` : ''}${MODES[mode].refSteps[i]}에 십자선을 맞추고 촬영` : '추가 지점을 조준하거나 [결과]를 누르십시오';
    const canFinish = !result.error;
    return (
      <div className="fixed inset-0 z-40 bg-black text-white select-none">
        <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 w-full h-full object-cover ${stage === 'review' ? 'invisible' : ''}`} />

        {stage === 'camera' && (
          <>
            {camError && <div className="absolute inset-x-4 top-1/3 bg-rose-600/90 p-4 rounded-2xl text-xs font-bold text-center">{camError}<br />사진 없이 각도만 기록할 수 있습니다.</div>}
            {/* 십자선 */}
            <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" width="120" height="120" viewBox="0 0 120 120">
              <g stroke={tilt.stable ? '#34D399' : '#FBBF24'} strokeWidth="2" fill="none">
                <circle cx="60" cy="60" r="18" />
                <path d="M0 60H42M78 60H120M60 0V42M60 78V120" />
              </g>
              <circle cx="60" cy="60" r="2" fill="#F43F5E" />
            </svg>
            {/* 상단 HUD */}
            <div className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/80 to-transparent">
              <div className="flex justify-between items-start">
                <div>
                  <div className="text-[10px] font-bold text-emerald-300">{MODES[mode].label}</div>
                  <div className="text-sm font-black mt-0.5">{stepText}</div>
                </div>
                <button onClick={() => { stopCamera(); setStage('setup'); }} className="p-2 bg-white/10 rounded-full"><X size={18} /></button>
              </div>
              <div className="mt-3 flex gap-2 text-xs font-bold">
                <span className="bg-black/50 px-2.5 py-1 rounded-lg">앙각 {tilt.elev == null ? '센서 없음' : fmtDeg(tilt.elev)}</span>
                <span className={`px-2.5 py-1 rounded-lg ${tilt.stable ? 'bg-emerald-600' : 'bg-amber-600'}`}>{tilt.stable ? '안정' : '흔들림'}</span>
                {tilt.heading != null && <span className="bg-black/50 px-2.5 py-1 rounded-lg flex items-center gap-1"><Compass size={12} />{Math.round(tilt.heading)}°</span>}
              </div>
              {live && (
                <div className="mt-2 text-xs font-bold text-white/90">
                  예상 수평거리 {fmtM(live.summary.horizontal, 1)} · 사거리 {fmtM(live.summary.slope, 1)}{live.points.length > 1 ? ` · 높이차 ${fmtM(live.summary.heightDiff, 1)}` : ''}
                </div>
              )}
            </div>
            {/* 하단 조작부 */}
            <div className="absolute bottom-0 inset-x-0 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/80 to-transparent">
              {shots.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 text-[11px] font-bold">
                  {shots.map((s, j) => <span key={j} className={`px-2 py-1 rounded-lg ${j < nRef ? 'bg-emerald-700/80' : 'bg-amber-700/80'}`}>{j + 1}. {s.label} {fmtDeg(s.elev)}</span>)}
                </div>
              )}
              <div className="flex items-center justify-between">
                <button disabled={!shots.length} onClick={() => setShots(s => s.slice(0, -1))} className="w-16 flex flex-col items-center text-[10px] font-bold disabled:opacity-30"><Undo2 size={22} />되돌리기</button>
                <button onClick={shoot} className={`w-20 h-20 rounded-full border-4 flex items-center justify-center ${tilt.stable || tilt.elev == null ? 'border-emerald-400 bg-white/20' : 'border-amber-400 bg-white/10'}`}><Crosshair size={30} /></button>
                <button disabled={!canFinish} onClick={goResult} className="w-16 flex flex-col items-center text-[10px] font-bold disabled:opacity-30"><Check size={22} />결과</button>
              </div>
            </div>
          </>
        )}

        {stage === 'review' && pending && (
          <div className="absolute inset-0 flex flex-col bg-slate-950">
            <div className="p-4 pt-[max(1rem,env(safe-area-inset-top))] text-xs font-bold text-slate-300">사진을 탭하면 조준점을 옮겨 앙각을 보정합니다.</div>
            <div className="flex-1 relative min-h-0" onClick={onReviewTap}>
              {pending.frame
                ? <img ref={reviewImgRef} src={pending.frame} alt="촬영 지점" onLoad={measureImgBox} className="absolute inset-0 w-full h-full object-contain" />
                : <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">사진 없음(각도만 기록)</div>}
              {pending.frame && imgBox && (
                <div className="absolute w-8 h-8 -ml-4 -mt-4 rounded-full border-2 border-rose-500 pointer-events-none"
                  style={{ left: imgBox.ox + pending.markX * imgBox.sc, top: imgBox.oy + pending.markY * imgBox.sc }}>
                  <div className="absolute left-1/2 top-1/2 w-1 h-1 -ml-0.5 -mt-0.5 bg-rose-500 rounded-full" />
                </div>
              )}
            </div>
            <div className="p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-3 bg-slate-900">
              <div className="flex gap-2 items-center">
                <input value={pending.label} onChange={e => setPending(p => ({ ...p, label: e.target.value }))} className="flex-1 p-2.5 bg-slate-800 rounded-lg text-sm font-bold outline-none" />
                <span className="text-sm font-black text-emerald-300 w-24 text-right">{fmtDeg(pending.elev)}</span>
              </div>
              <div className="text-[10px] text-slate-400 h-4">{pending.elev !== pending.centerElev ? `중심 앙각 ${fmtDeg(pending.centerElev)} → 보정 ${fmtDeg(pending.elev)} (화각 ${settings.fov}° 기준)` : `중심 앙각 ${fmtDeg(pending.centerElev)}`}</div>
              <div className="flex gap-2">
                <button onClick={() => { setPending(null); setStage('camera'); }} className="flex-1 py-3 bg-slate-700 rounded-xl font-bold text-sm">다시 촬영</button>
                <button onClick={confirmShot} className="flex-1 py-3 bg-emerald-600 rounded-xl font-bold text-sm">확정</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  if (stage === 'result') {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xl">
          <div className="text-[10px] font-bold text-emerald-300">{MODES[mode].label}{title ? ` · ${title}` : ''}</div>
          {result.error ? (
            <p className="mt-2 text-sm font-bold text-rose-300">{result.error}</p>
          ) : (
            <div className="grid grid-cols-3 gap-2 mt-3 text-center">
              {[['수평거리', result.summary.horizontal, unc?.horizontal], ['사거리', result.summary.slope, unc?.slope], ['높이차', result.summary.heightDiff, unc?.heightDiff]].map(([k, v, u]) => (
                <div key={k} className="bg-white/5 rounded-xl p-3">
                  <div className="text-[10px] font-bold text-slate-400">{k}</div>
                  <div className="text-xl font-black mt-1">{v.toFixed(2)}<span className="text-xs text-slate-400 ml-0.5">m</span></div>
                  {u != null && <div className="text-[10px] text-slate-400">±{u.toFixed(2)} m</div>}
                </div>
              ))}
            </div>
          )}
          {!result.error && <p className="text-[10px] text-slate-400 mt-3">높이차 기준: {result.summary.heightDiffBasis} · 사거리: 카메라 → 마지막 지점 · 오차: 각도 ±0.5° 가정</p>}
        </div>

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
          <h3 className="font-extrabold text-slate-800 text-xs mb-3">지점별 결과(m) <span className="font-normal text-slate-400">· 앙각은 직접 수정할 수 있습니다</span></h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400 text-[10px] border-b border-slate-100">
                <th className="text-left py-2">지점</th><th className="text-right">앙각(°)</th><th className="text-right pl-2">사거리</th><th className="text-right pl-2">기저 대비</th><th className="text-right pl-2">발밑 대비</th>
              </tr></thead>
              <tbody>
                {shots.map((s, i) => {
                  const p = result.points?.[i];
                  return (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2 font-bold"><span className={`inline-block w-2 h-2 rounded-full mr-1.5 ${i < nRef ? 'bg-emerald-500' : 'bg-amber-500'}`} />{s.label}{s.manual && <span className="text-rose-500 ml-1">(수동)</span>}</td>
                      <td className="text-right"><input type="number" step="0.1" value={Number(s.elev.toFixed(2))} onChange={e => updateShot(i, { elev: Number(e.target.value) || 0, manual: true })} className="w-16 p-1 text-right bg-slate-50 border border-slate-200 rounded font-bold" /></td>
                      <td className="text-right font-bold">{fmtNum(p?.slope)}</td>
                      <td className="text-right font-bold">{fmtNum(p?.fromBase)}</td>
                      <td className="text-right font-bold">{fmtNum(p?.fromGround)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {mode === 'ground' && <Field label="카메라 높이" unit="m" value={settings.cameraHeight} onChange={setS('cameraHeight')} />}
            {mode === 'staff' && <Field label="기준물 높이" unit="m" value={settings.refHeight} onChange={setS('refHeight')} />}
            {mode === 'known' && <Field label="수평거리" unit="m" value={knownDistance} onChange={setKnownDistance} />}
          </div>
        </div>

        {(gps || target) && (
          <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm text-xs space-y-1.5">
            <h3 className="font-extrabold text-slate-800 mb-2 flex items-center gap-1.5"><MapPin size={14} className="text-blue-600" />위치</h3>
            {gps && <p><span className="text-slate-400 font-bold">관측점</span> N {gps.lat.toFixed(6)}, E {gps.lng.toFixed(6)} (GPS ±{Math.round(gps.acc)} m)</p>}
            {target && <p><span className="text-slate-400 font-bold">표적(추정)</span> N {target.lat.toFixed(6)}, E {target.lng.toFixed(6)} · 방위 {Math.round(target.bearing)}°</p>}
            {target && <p className="text-[10px] text-slate-400">나침반 오차(±5° 이상)와 GPS 오차가 함께 반영되므로 참고용입니다. 자편각 {settings.declination}° 보정.</p>}
          </div>
        )}

        {composite && (
          <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm">
            <img src={composite} alt="측정 기록 사진" className="w-full rounded-xl" />
          </div>
        )}

        <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
          <input value={title} onChange={e => setTitle(e.target.value)} placeholder="제목 (예: 1688 사방댐 본댐 높이)" className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm font-bold outline-none" />
          <textarea value={memo} onChange={e => setMemo(e.target.value)} placeholder="메모" rows={2} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm outline-none" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <button onClick={startCamera} className="py-3.5 bg-slate-200 hover:bg-slate-300 rounded-2xl font-bold text-sm text-slate-700 flex items-center justify-center gap-1.5"><Camera size={16} />지점 추가 촬영</button>
          <button onClick={resetMeasure} className="py-3.5 bg-slate-200 hover:bg-slate-300 rounded-2xl font-bold text-sm text-slate-700 flex items-center justify-center gap-1.5"><RotateCcw size={16} />새 측정</button>
          <button disabled={!composite} onClick={() => downloadDataUrl(composite, `거리측정_${title || '기록'}_${stamp()}.jpg`)} className="py-3.5 bg-slate-800 disabled:opacity-40 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-1.5"><Download size={16} />사진 저장</button>
          <button disabled={!!result.error} onClick={saveRecord} className="py-3.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-40 rounded-2xl font-bold text-sm text-white flex items-center justify-center gap-1.5"><Save size={16} />기록 저장</button>
        </div>
      </div>
    );
  }

  /* ----- setup ----- */
  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="bg-slate-900 text-white p-5 rounded-2xl shadow-xl">
        <h2 className="text-lg font-black flex items-center gap-2"><Ruler size={20} className="text-emerald-400" />카메라 거리측정</h2>
        <p className="text-xs text-slate-300 mt-1">십자선으로 지점을 조준·촬영하면 수평거리·사거리·높이차를 산출합니다.</p>
      </div>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <h3 className="font-extrabold text-slate-800 text-xs mb-3">1. 측정 방식</h3>
        <div className="grid grid-cols-3 gap-2">
          {Object.entries(MODES).map(([k, m]) => (
            <button key={k} onClick={() => { setMode(k); setShots([]); }} className={`p-3 rounded-xl border text-left transition ${mode === k ? 'bg-emerald-50 border-emerald-500' : 'bg-slate-50 border-slate-200'}`}>
              <div className={`text-xs font-black ${mode === k ? 'text-emerald-700' : 'text-slate-700'}`}>{m.label}</div>
              <div className="text-[10px] text-slate-400 font-bold mt-0.5">{m.short}</div>
            </button>
          ))}
        </div>
        <p className="text-[11px] text-slate-500 mt-3 leading-relaxed">{MODES[mode].desc}</p>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label="카메라 높이 (지면→렌즈)" unit="m" value={settings.cameraHeight} onChange={setS('cameraHeight')}
            hint={mode === 'ground' ? '결과 정확도를 좌우합니다. 폴·삼각대 사용을 권장합니다.' : '발밑 기준 높이차 계산에 사용합니다.'} />
          {mode === 'staff' && <Field label="기준물 높이" unit="m" value={settings.refHeight} onChange={setS('refHeight')} hint="표척·측량폴·사람 키·설계 높이 등" />}
          {mode === 'known' && <Field label="수평거리" unit="m" value={knownDistance} onChange={setKnownDistance} hint="줄자·도면·레이저 측정값" />}
        </div>
        <div className="mt-4 p-3 bg-slate-50 rounded-xl text-[11px] text-slate-500 leading-relaxed">
          <b className="text-slate-700">촬영 순서</b> · {nRef ? MODES[mode].refSteps.join(' → ') + ' → (선택) 추가 지점' : '조준 지점 1개 이상'}<br />
          모든 지점은 같은 연직선 위(같은 수평거리)에 있다고 가정합니다.
        </div>
      </div>

      <button onClick={startCamera} className="w-full py-4 bg-emerald-600 hover:bg-emerald-700 rounded-2xl font-black text-white flex items-center justify-center gap-2"><Camera size={18} />카메라 시작</button>

      <details className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <summary className="font-extrabold text-slate-800 text-xs cursor-pointer">보정 설정</summary>
        <div className="grid grid-cols-2 gap-3 mt-4">
          <Field label="카메라 화각(긴 변)" unit="°" step="1" value={settings.fov} onChange={setS('fov')} hint="사진 위 조준점 보정에 사용. 일반 광각 65° 내외" />
          <Field label="자편각" unit="°" step="0.1" value={settings.declination} onChange={setS('declination')} hint="남한 약 −8~−9° (서편)" />
        </div>
        <div className="mt-4 flex items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">영점 보정: β {settings.calib.beta.toFixed(2)}°, γ {settings.calib.gamma.toFixed(2)}°</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setSettings(s => ({ ...s, calib: { beta: 0, gamma: 0 } }))} className="px-3 py-2 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">초기화</button>
            <button onClick={calibrate} className="px-3 py-2 bg-slate-800 rounded-lg text-xs font-bold text-white">수평면 보정</button>
          </div>
        </div>
      </details>

      <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
        <div className="flex justify-between items-center mb-3">
          <h3 className="font-extrabold text-slate-800 text-xs">측정 기록 ({log.length})</h3>
          <button disabled={!log.length} onClick={exportCsv} className="text-xs font-bold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-xl border border-emerald-200 flex items-center gap-1 disabled:opacity-40"><FileSpreadsheet size={14} />CSV</button>
        </div>
        {!log.length && <p className="text-xs text-slate-400">저장한 기록이 없습니다.</p>}
        <div className="space-y-2">
          {log.map(r => (
            <div key={r.id} className="flex gap-3 items-center p-2.5 bg-slate-50 rounded-xl border border-slate-100">
              {r.image ? <img src={r.image} alt="" className="w-14 h-14 object-cover rounded-lg" /> : <div className="w-14 h-14 bg-slate-200 rounded-lg" />}
              <div className="flex-1 min-w-0 text-xs">
                <div className="font-black text-slate-700 truncate">{r.title || MODES[r.mode]?.label}</div>
                <div className="text-slate-500 font-bold">수평 {fmtM(r.summary.horizontal)} · 사거리 {fmtM(r.summary.slope)} · 높이차 {fmtM(r.summary.heightDiff)}</div>
                <div className="text-[10px] text-slate-400">{new Date(r.time).toLocaleString('ko-KR')}</div>
              </div>
              <div className="flex flex-col gap-1">
                {r.image && <button onClick={() => downloadDataUrl(r.image, `거리측정_${r.title || '기록'}_${stamp(new Date(r.time))}.jpg`)} className="p-1.5 text-slate-500"><Download size={14} /></button>}
                <button onClick={() => deleteRecord(r.id)} className="p-1.5 text-rose-500"><Trash2 size={14} /></button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DistanceMeasure;
