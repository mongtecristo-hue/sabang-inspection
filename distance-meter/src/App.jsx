import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Ruler, Crosshair, Undo2, X, Check, Compass, Download, Save, RotateCcw, Trash2, Camera, FileSpreadsheet,
  MapPin, AlertTriangle, Settings, List, Share2, Bell, Maximize2, Mountain, Footprints, MoveHorizontal, Timer
} from 'lucide-react';
import {
  MODES, solve, uncertainty, offsetElevation, effectiveFov, destinationPoint, deviceLongAxisSlope, fmtM, fmtNum, fmtDeg
} from './geometry.js';
import { useDeviceTilt, requestTiltPermission } from './useDeviceTilt.js';
import { listRecords, putRecord, deleteRecord, loadJSON, saveJSON } from './storage.js';
import { REF_NOTICE, captureFrame, buildComposite, dataUrlToBlob, saveBlob, shareBlob, stamp } from './media.js';

/* =========================================================================
   거리측정 — 폰 카메라·기울기 센서 기반 단독 앱
   ========================================================================= */

const SETTINGS_KEY = 'distance-meter.settings';
const DEFAULT_SETTINGS = {
  cameraHeight: '1.5', stature: '', stride: '0.7', fov: '65', declination: '-8.5',
  sigma: '0.5', calibDistance: '10', autoCapture: true, calib: { beta: 0, gamma: 0 }
};
const AUTO_HOLD_MS = 1200;

/* ---------- 안드로이드 뒤로가기: 열린 화면을 하나씩 닫는다 ----------
   화면 하나가 열릴 때 기록(history) 항목 하나를 쌓는다. 뒤로가기로 닫히면 그 항목이 소비되고,
   화면 버튼으로 닫히면 history.back()으로 항목을 직접 소비해 둘의 개수를 항상 맞춘다. */
const backStack = [];
let ignorePops = 0;
if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    if (ignorePops > 0) { ignorePops -= 1; return; }
    const top = backStack.pop();
    if (top) { top.popped = true; top.fn(); }
  });
}
const useBackHandler = (active, onBack) => {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return undefined;
    const entry = { fn: () => ref.current(), popped: false };
    backStack.push(entry);
    history.pushState({ dm: backStack.length }, '');
    return () => {
      const i = backStack.indexOf(entry);
      if (i >= 0) backStack.splice(i, 1);
      if (!entry.popped) { ignorePops += 1; history.back(); }
    };
  }, [active]);
};

/* ---------- 공용 UI ---------- */
const Field = ({ label, value, onChange, unit, step = '0.1', hint, placeholder }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-500 mb-1">{label}</label>
    <div className="flex items-center bg-slate-50 border border-slate-200 rounded-xl focus-within:ring-2 focus-within:ring-emerald-500">
      <input type="number" inputMode="decimal" step={step} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} className="w-full p-3 bg-transparent text-base font-bold text-slate-800 outline-none" />
      {unit && <span className="pr-3 text-sm font-bold text-slate-400">{unit}</span>}
    </div>
    {hint && <p className="text-[11px] text-slate-400 mt-1 leading-snug">{hint}</p>}
  </div>
);

const Card = ({ title, children, className = '' }) => (
  <section className={`bg-white p-4 rounded-2xl border border-slate-200 shadow-sm ${className}`}>
    {title && <h3 className="font-extrabold text-slate-800 text-sm mb-3">{title}</h3>}
    {children}
  </section>
);

const Toggle = ({ checked, onChange, label, hint }) => (
  <label className="flex items-start justify-between gap-3 py-1">
    <span><span className="block text-sm font-bold text-slate-700">{label}</span>{hint && <span className="block text-[11px] text-slate-400 mt-0.5">{hint}</span>}</span>
    <button type="button" onClick={() => onChange(!checked)} className={`shrink-0 w-12 h-7 rounded-full p-1 transition ${checked ? 'bg-emerald-500' : 'bg-slate-300'}`}>
      <span className={`block w-5 h-5 bg-white rounded-full shadow transition ${checked ? 'translate-x-5' : ''}`} />
    </button>
  </label>
);

// 전체 화면 사진 보기: 탭하면 원본 크기(스크롤로 이동)와 화면 맞춤을 전환
const PhotoViewer = ({ src, name, onClose, showToast }) => {
  const [actual, setActual] = useState(false);
  useBackHandler(true, onClose);
  const save = async () => { saveBlob(await dataUrlToBlob(src), name); showToast('다운로드 폴더에 저장했습니다. 갤러리 앱에서도 볼 수 있습니다.', 'success'); };
  const share = async () => { if (!(await shareBlob(await dataUrlToBlob(src), name))) showToast('이 브라우저는 공유를 지원하지 않습니다. 저장을 이용해 주십시오.', 'error'); };
  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col">
      <div className="flex justify-between items-center p-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-white">
        <button onClick={onClose} className="p-2 bg-white/10 rounded-full"><X size={20} /></button>
        <span className="text-xs text-white/60">{actual ? '원본 크기 · 끌어서 이동' : '탭하면 원본 크기'}</span>
        <div className="flex gap-2">
          <button onClick={share} className="p-2 bg-white/10 rounded-full"><Share2 size={20} /></button>
          <button onClick={save} className="p-2 bg-white/10 rounded-full"><Download size={20} /></button>
        </div>
      </div>
      <div className={`flex-1 min-h-0 ${actual ? 'overflow-auto' : 'flex items-center justify-center'}`} onClick={() => setActual(a => !a)}>
        <img src={src} alt="측정 기록 사진" className={actual ? 'max-w-none' : 'max-w-full max-h-full object-contain'} />
      </div>
    </div>
  );
};

/* =========================================================================
   측정 화면
   ========================================================================= */
const Measure = ({ visible, settings, setSettings, mode, setMode, tilt, enableTilt, showToast, onSaved, openViewer }) => {
  const [stage, setStage] = useState('setup'); // setup | camera | review | result
  const [shots, setShots] = useState([]);
  const [pending, setPending] = useState(null);
  const [inputs, setInputs] = useState({ knownDistance: '', refHeight: '2.0', baseline: '', steps: '', groundSlope: '' });
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [gps, setGps] = useState(null);
  const [composite, setComposite] = useState(null);
  const [savedId, setSavedId] = useState(null);
  const [camError, setCamError] = useState('');
  const [zoom, setZoom] = useState({ value: 1, min: 1, max: 1, step: 0.1, supported: false });
  const [imgBox, setImgBox] = useState(null);
  const [slopeTool, setSlopeTool] = useState(false);
  const [autoProgress, setAutoProgress] = useState(0);

  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const wakeRef = useRef(null);
  const reviewImgRef = useRef(null);
  const autoRef = useRef({ armed: true, since: null });

  const M = MODES[mode];
  const nRef = M.refSteps.length;
  const setIn = (k) => (v) => setInputs(s => ({ ...s, [k]: v }));
  const params = {
    cameraHeight: settings.cameraHeight, refHeight: inputs.refHeight, baseline: inputs.baseline,
    groundSlope: M.usesSlope ? inputs.groundSlope : '',
    knownDistance: mode === 'calib' ? settings.calibDistance : inputs.knownDistance
  };
  const sigma = Number(settings.sigma) || 0.5;

  /* ---------- 카메라 ---------- */
  const stopCamera = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    wakeRef.current?.release?.().catch(() => {});
    wakeRef.current = null;
  }, []);
  useEffect(() => stopCamera, [stopCamera]);

  useEffect(() => {
    if (videoRef.current && streamRef.current && videoRef.current.srcObject !== streamRef.current) {
      videoRef.current.srcObject = streamRef.current;
      videoRef.current.play().catch(() => {});
    }
  }, [stage]);

  const startCamera = async () => {
    const ok = await enableTilt();
    if (!ok) showToast('기울기 센서를 사용할 수 없습니다. 결과 화면에서 각도를 직접 입력해야 합니다.', 'error');
    setCamError('');
    try {
      if (!streamRef.current) {
        streamRef.current = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false
        });
        const track = streamRef.current.getVideoTracks()[0];
        const cap = track.getCapabilities?.() || {};
        if (cap.zoom) setZoom({ value: track.getSettings().zoom || cap.zoom.min, min: cap.zoom.min, max: Math.min(cap.zoom.max, 10), step: cap.zoom.step || 0.1, supported: true });
      }
    } catch (err) {
      setCamError(err?.name === 'NotAllowedError' ? '카메라 권한이 거부되었습니다. 브라우저 설정에서 허용해 주십시오.' : '카메라를 열 수 없습니다. HTTPS 접속과 기기 카메라를 확인해 주십시오.');
    }
    try { wakeRef.current = await navigator.wakeLock?.request('screen'); } catch { /* 미지원 */ }
    if (!gps && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        p => setGps({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
        () => {}, { enableHighAccuracy: true, timeout: 15000 }
      );
    }
    autoRef.current = { armed: true, since: null };
    setStage('camera');
  };

  const applyZoom = (v) => {
    const track = streamRef.current?.getVideoTracks()[0];
    setZoom(z => ({ ...z, value: v }));
    track?.applyConstraints({ advanced: [{ zoom: v }] }).catch(() => {});
  };

  const shoot = () => {
    const frame = captureFrame(videoRef.current);
    const i = shots.length;
    const label = i < nRef ? M.refSteps[i] : M.extraLabel(i);
    navigator.vibrate?.(40);
    autoRef.current = { armed: false, since: null };
    setAutoProgress(0);
    setPending({
      label, centerElev: tilt.elev ?? 0, elev: tilt.elev ?? 0, manual: tilt.elev == null,
      yaw: tilt.yaw, heading: tilt.heading, zoom: zoom.value,
      frame: frame?.dataUrl, frameW: frame?.w || 1, frameH: frame?.h || 1,
      markX: (frame?.w || 1) / 2, markY: (frame?.h || 1) / 2, time: new Date().toISOString()
    });
    setStage('review');
  };

  // 자동 촬영: 조준이 흔들린 뒤 다시 1.2초간 안정되면 촬영한다(같은 지점 연속 촬영 방지).
  useEffect(() => {
    const a = autoRef.current;
    if (stage !== 'camera' || !settings.autoCapture || tilt.elev == null) { a.since = null; setAutoProgress(0); return; }
    if (!tilt.stable) { a.armed = true; a.since = null; setAutoProgress(0); return; }
    if (!a.armed) return;
    const now = performance.now();
    if (a.since == null) a.since = now;
    const p = (now - a.since) / AUTO_HOLD_MS;
    setAutoProgress(Math.min(1, p));
    if (p >= 1) shoot();
  }, [tilt, stage, settings.autoCapture]);

  /* ---------- 검토(조준점 보정) ---------- */
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

  const onReviewTap = (e) => {
    const L = imgLayout();
    if (!L) return;
    const fx = (e.clientX - L.r.left - L.ox) / L.sc, fy = (e.clientY - L.r.top - L.oy) / L.sc;
    if (fx < 0 || fy < 0 || fx > pending.frameW || fy > pending.frameH) return;
    const fov = effectiveFov(Number(settings.fov) || 65, pending.zoom);
    const elev = offsetElevation(pending.centerElev, pending.frameH / 2 - fy, pending.frameW, pending.frameH, fov);
    setPending(p => ({ ...p, markX: fx, markY: fy, elev }));
  };

  const confirmShot = () => { setShots(s => [...s, pending]); setPending(null); setStage('camera'); };
  const retake = () => { setPending(null); autoRef.current = { armed: false, since: null }; setStage('camera'); };

  /* ---------- 결과 ---------- */
  const paramKey = JSON.stringify(params);
  const result = useMemo(() => solve(mode, shots, params), [mode, shots, paramKey]);
  const unc = useMemo(() => uncertainty(mode, shots, params, sigma), [mode, shots, paramKey, sigma]);
  const live = useMemo(() => {
    if (tilt.elev == null || stage !== 'camera') return null;
    const r = solve(mode, [...shots, { elev: tilt.elev, yaw: tilt.yaw, label: '조준' }], params);
    return r.error ? null : r;
  }, [tilt.elev, tilt.yaw, stage, mode, shots, paramKey]);

  const target = useMemo(() => {
    if (result.error || !gps || mode === 'width' || mode === 'calib') return null;
    const hd = shots[mode === 'move' ? 1 : 0]?.heading;
    if (hd == null) return null;
    const bearing = (hd + (Number(settings.declination) || 0) + 360) % 360;
    return { ...destinationPoint(gps.lat, gps.lng, bearing, result.D), bearing };
  }, [result, gps, shots, mode, settings.declination]);

  const paramText = () => ({
    ground: `카메라 높이 ${settings.cameraHeight} m${Number(inputs.groundSlope) ? ` · 지면 경사 ${inputs.groundSlope}°` : ''}`,
    width: `카메라 높이 ${settings.cameraHeight} m${Number(inputs.groundSlope) ? ` · 지면 경사 ${inputs.groundSlope}°` : ''}`,
    move: `이동 거리 ${inputs.baseline} m · 카메라 높이 ${settings.cameraHeight} m`,
    staff: `기준 높이 ${inputs.refHeight} m`,
    known: `입력 수평거리 ${inputs.knownDistance} m`,
    calib: `기준 거리 ${settings.calibDistance} m`
  })[mode];

  useEffect(() => {
    if (stage !== 'result' || result.error) { setComposite(null); return undefined; }
    let alive = true;
    buildComposite(result, unc, { mode, title, time: new Date().toLocaleString('ko-KR'), gps, paramText: paramText() })
      .then(url => { if (alive) setComposite(url); }).catch(() => {});
    return () => { alive = false; };
  }, [stage, result, unc, title]);

  const goResult = () => { stopCamera(); setStage('result'); };
  const toSetup = () => { stopCamera(); setPending(null); setStage('setup'); };
  const resetMeasure = () => { setShots([]); setPending(null); setComposite(null); setTitle(''); setMemo(''); setSavedId(null); setStage('setup'); };
  const updateShot = (i, patch) => { setSavedId(null); setShots(s => s.map((x, j) => (j === i ? { ...x, ...patch } : x))); };

  useBackHandler(visible && stage !== 'setup', toSetup);
  useBackHandler(visible && stage === 'review', retake);

  const saveRecord = async () => {
    if (result.error) return;
    const rec = {
      id: savedId || Date.now().toString(), time: new Date().toISOString(), title, memo, mode, paramText: paramText(),
      gps, target, summary: result.summary, cards: result.cards,
      cardLabels: Object.fromEntries(result.cards.map(k => [k, result.cardLabels[k]])),
      basis: result.basis, uncertainty: unc,
      points: result.points.map(p => ({ label: p.label, elev: p.elev, horizontal: p.horizontal, slope: p.slope, fromBase: p.fromBase, fromGround: p.fromGround, segment: p.segment ?? null, manual: !!p.manual })),
      image: composite
    };
    try {
      await putRecord(rec);
      setSavedId(rec.id);
      onSaved();
      showToast('측정 기록을 저장했습니다. 「기록」 탭에서 볼 수 있습니다.', 'success');
    } catch {
      showToast('기록 저장에 실패했습니다. 저장 공간을 확인해 주십시오.', 'error');
    }
  };

  const applyCalibration = () => {
    const ch = result.summary.cameraHeight;
    setSettings(s => ({ ...s, cameraHeight: ch.toFixed(2) }));
    showToast(`카메라 높이를 ${ch.toFixed(2)} m로 저장했습니다.`, 'success');
    setMode('ground'); resetMeasure();
  };

  /* ============================ 카메라·검토 화면 ============================ */
  if (stage === 'camera' || stage === 'review') {
    const i = shots.length;
    const stepText = i < nRef ? `${nRef > 1 ? `${i + 1}/${nRef}. ` : ''}${M.refSteps[i]}` : '추가 지점을 조준하거나 [결과]를 누르십시오';
    const moveHint = mode === 'move' && i === 1 ? `표적 쪽으로 ${inputs.baseline || '?'} m 곧게 이동한 뒤 같은 지점을 조준하십시오` : '';
    const liveText = live ? live.cards.slice(0, 3).map(k => `${live.cardLabels[k]} ${fmtM(live.summary[k], 1)}`).join(' · ') : '';
    return (
      <div className="fixed inset-0 z-40 bg-black text-white select-none">
        <video ref={videoRef} playsInline muted autoPlay className={`absolute inset-0 w-full h-full object-cover ${stage === 'review' ? 'invisible' : ''}`} />

        {stage === 'camera' && (
          <>
            {camError && <div className="absolute inset-x-4 top-1/3 bg-rose-600/90 p-4 rounded-2xl text-sm font-bold text-center">{camError}<br />사진 없이 각도만 기록할 수 있습니다.</div>}
            <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none" width="140" height="140" viewBox="0 0 140 140">
              <g stroke={tilt.stable ? '#34D399' : '#FBBF24'} strokeWidth="2.5" fill="none">
                <circle cx="70" cy="70" r="20" />
                <path d="M0 70H48M92 70H140M70 0V48M70 92V140" />
              </g>
              {autoProgress > 0 && <circle cx="70" cy="70" r="28" stroke="#34D399" strokeWidth="4" fill="none" strokeDasharray={`${2 * Math.PI * 28 * autoProgress} 999`} transform="rotate(-90 70 70)" />}
              <circle cx="70" cy="70" r="2.5" fill="#F43F5E" />
            </svg>
            <div className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/85 to-transparent">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-[11px] font-bold text-emerald-300">{M.label}</div>
                  <div className="text-base font-black mt-0.5 leading-snug">{stepText}</div>
                  {moveHint && <div className="text-xs font-bold text-amber-300 mt-1">{moveHint}</div>}
                </div>
                <button onClick={toSetup} className="p-2 bg-white/10 rounded-full shrink-0"><X size={20} /></button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2 text-xs font-bold">
                <span className="bg-black/50 px-2.5 py-1 rounded-lg">앙각 {tilt.elev == null ? '센서 없음' : fmtDeg(tilt.elev)}</span>
                <span className={`px-2.5 py-1 rounded-lg ${tilt.stable ? 'bg-emerald-600' : 'bg-amber-600'}`}>{tilt.stable ? '안정' : '흔들림'}</span>
                {settings.autoCapture && <span className="bg-black/50 px-2.5 py-1 rounded-lg flex items-center gap-1"><Timer size={12} />자동 촬영</span>}
                {tilt.heading != null && <span className="bg-black/50 px-2.5 py-1 rounded-lg flex items-center gap-1"><Compass size={12} />{Math.round(tilt.heading)}°</span>}
              </div>
              {liveText && <div className="mt-2 text-sm font-bold text-white/90">예상 {liveText}</div>}
            </div>
            <div className="absolute bottom-0 inset-x-0 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/85 to-transparent">
              {zoom.supported && zoom.max > zoom.min && (
                <div className="flex items-center gap-3 mb-3 text-xs font-bold">
                  <span>줌</span>
                  <input type="range" min={zoom.min} max={zoom.max} step={zoom.step} value={zoom.value} onChange={e => applyZoom(Number(e.target.value))} className="flex-1 accent-emerald-400" />
                  <span className="w-10 text-right">{zoom.value.toFixed(1)}×</span>
                </div>
              )}
              {shots.length > 0 && (
                <div className="flex flex-wrap gap-1.5 mb-3 text-[11px] font-bold">
                  {shots.map((s, j) => <span key={j} className={`px-2 py-1 rounded-lg ${j < nRef ? 'bg-emerald-700/80' : 'bg-amber-700/80'}`}>{j + 1}. {s.label} {fmtDeg(s.elev)}</span>)}
                </div>
              )}
              <div className="flex items-center justify-between">
                <button disabled={!shots.length} onClick={() => setShots(s => s.slice(0, -1))} className="w-16 flex flex-col items-center text-[11px] font-bold disabled:opacity-30"><Undo2 size={24} />되돌리기</button>
                <button onClick={shoot} aria-label="촬영" className={`w-20 h-20 rounded-full border-4 flex items-center justify-center ${tilt.stable || tilt.elev == null ? 'border-emerald-400 bg-white/20' : 'border-amber-400 bg-white/10'}`}><Crosshair size={32} /></button>
                <button disabled={!!result.error} onClick={goResult} className="w-16 flex flex-col items-center text-[11px] font-bold disabled:opacity-30"><Check size={24} />결과</button>
              </div>
            </div>
          </>
        )}

        {stage === 'review' && pending && (
          <div className="absolute inset-0 flex flex-col bg-slate-950">
            <div className="p-4 pt-[max(1rem,env(safe-area-inset-top))] text-sm font-bold text-slate-300">사진을 탭하면 조준점을 옮겨 앙각을 보정합니다.</div>
            <div className="flex-1 relative min-h-0" onClick={onReviewTap}>
              {pending.frame
                ? <img ref={reviewImgRef} src={pending.frame} alt="촬영 지점" onLoad={measureImgBox} className="absolute inset-0 w-full h-full object-contain" />
                : <div className="absolute inset-0 flex items-center justify-center text-slate-500 text-sm">사진 없음(각도만 기록)</div>}
              {pending.frame && imgBox && (
                <div className="absolute w-9 h-9 -ml-[18px] -mt-[18px] rounded-full border-2 border-rose-500 pointer-events-none"
                  style={{ left: imgBox.ox + pending.markX * imgBox.sc, top: imgBox.oy + pending.markY * imgBox.sc }}>
                  <div className="absolute left-1/2 top-1/2 w-1 h-1 -ml-0.5 -mt-0.5 bg-rose-500 rounded-full" />
                </div>
              )}
            </div>
            <div className="p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-3 bg-slate-900">
              <div className="flex gap-2 items-center">
                <input value={pending.label} onChange={e => setPending(p => ({ ...p, label: e.target.value }))} className="flex-1 p-3 bg-slate-800 rounded-xl text-base font-bold outline-none" />
                <span className="text-base font-black text-emerald-300 w-24 text-right">{fmtDeg(pending.elev)}</span>
              </div>
              <div className="text-[11px] text-slate-400 h-4">{pending.elev !== pending.centerElev ? `중심 앙각 ${fmtDeg(pending.centerElev)} → 보정 ${fmtDeg(pending.elev)}` : `중심 앙각 ${fmtDeg(pending.centerElev)}`}</div>
              <div className="flex gap-2">
                <button onClick={retake} className="flex-1 py-3.5 bg-slate-700 rounded-xl font-bold">다시 촬영</button>
                <button onClick={confirmShot} className="flex-1 py-3.5 bg-emerald-600 rounded-xl font-bold">확정</button>
              </div>
            </div>
          </div>
        )}
      </div>
    );
  }

  /* ============================ 결과 화면 ============================ */
  if (stage === 'result') {
    const isWidth = mode === 'width';
    return (
      <div className="space-y-4">
        <section className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl">
          <div className="text-[11px] font-bold text-emerald-300">{M.label}{title ? ` · ${title}` : ''}</div>
          {result.error ? (
            <p className="mt-2 text-sm font-bold text-rose-300">{result.error}</p>
          ) : (
            <div className={`grid gap-2 mt-3 text-center ${result.cards.length === 1 ? 'grid-cols-1' : 'grid-cols-3'}`}>
              {result.cards.map(k => (
                <div key={k} className="bg-white/5 rounded-xl p-3">
                  <div className="text-[11px] font-bold text-slate-400">{result.cardLabels[k]}</div>
                  <div className="text-xl font-black mt-1">{fmtNum(result.summary[k])}<span className="text-xs text-slate-400 ml-0.5">m</span></div>
                  {unc && <div className="text-[11px] text-slate-400">±{unc[k].toFixed(2)} m</div>}
                </div>
              ))}
            </div>
          )}
          {!result.error && <p className="text-[11px] text-slate-400 mt-3">기준: {result.basis} · 오차: 앙각 ±{sigma}° 가정</p>}
          <p className="text-xs font-bold text-amber-300 mt-2 flex items-start gap-1"><AlertTriangle size={14} className="shrink-0 mt-px" />{REF_NOTICE}</p>
        </section>

        {mode === 'calib' && !result.error && (
          <button onClick={applyCalibration} className="w-full py-4 bg-emerald-600 rounded-2xl font-black text-white">카메라 높이 {result.summary.cameraHeight.toFixed(2)} m로 저장</button>
        )}

        {composite && (
          <button onClick={() => openViewer(composite, `거리측정_${title || M.label}_${stamp()}.jpg`)} className="block w-full bg-white p-2 rounded-2xl border border-slate-200 shadow-sm relative">
            <img src={composite} alt="측정 결과 사진" className="w-full rounded-xl" />
            <span className="absolute right-4 top-4 bg-black/60 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><Maximize2 size={13} />크게 보기</span>
          </button>
        )}

        <Card title="지점별 결과(m)">
          <p className="text-[11px] text-slate-400 -mt-2 mb-2">앙각을 눌러 직접 고칠 수 있습니다.</p>
          <div className="overflow-x-auto -mx-1">
            <table className="w-full text-sm">
              <thead><tr className="text-slate-400 text-[11px] border-b border-slate-100 whitespace-nowrap">
                <th className="text-left py-2 px-1">지점</th><th className="text-right px-1">앙각°</th><th className="text-right px-1">수평</th>
                {isWidth ? <><th className="text-right px-1">간격</th><th className="text-right px-1">회전°</th></> : <><th className="text-right px-1">사거리</th><th className="text-right px-1">기저 대비</th></>}
              </tr></thead>
              <tbody>
                {shots.map((s, i) => {
                  const p = result.points?.[i];
                  return (
                    <tr key={i} className="border-b border-slate-50">
                      <td className="py-2 px-1 font-bold text-xs"><span className={`inline-block w-2 h-2 rounded-full mr-1 ${i < nRef ? 'bg-emerald-500' : 'bg-amber-500'}`} />{s.label}{s.manual && <span className="text-rose-500 ml-1">(수동)</span>}</td>
                      <td className="text-right px-1"><input type="number" inputMode="decimal" step="0.1" value={Number(s.elev.toFixed(2))} onChange={e => updateShot(i, { elev: Number(e.target.value) || 0, manual: true })} className="w-16 p-1 text-right bg-slate-50 border border-slate-200 rounded font-bold" /></td>
                      <td className="text-right px-1 font-bold">{fmtNum(p?.horizontal)}</td>
                      {isWidth
                        ? <><td className="text-right px-1 font-bold">{fmtNum(p?.segment)}</td><td className="text-right px-1 font-bold">{p?.turn == null ? '-' : p.turn.toFixed(1)}</td></>
                        : <><td className="text-right px-1 font-bold">{fmtNum(p?.slope)}</td><td className="text-right px-1 font-bold">{fmtNum(p?.fromBase)}</td></>}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="grid grid-cols-2 gap-3 mt-4">
            {['ground', 'width', 'move'].includes(mode) && <Field label="카메라 높이" unit="m" value={settings.cameraHeight} onChange={v => { setSavedId(null); setSettings(s => ({ ...s, cameraHeight: v })); }} />}
            {M.usesSlope && <Field label="지면 경사" unit="°" value={inputs.groundSlope} placeholder="0" onChange={v => { setSavedId(null); setIn('groundSlope')(v); }} />}
            {mode === 'move' && <Field label="이동 거리" unit="m" value={inputs.baseline} onChange={v => { setSavedId(null); setIn('baseline')(v); }} />}
            {mode === 'staff' && <Field label="기준물 높이" unit="m" value={inputs.refHeight} onChange={v => { setSavedId(null); setIn('refHeight')(v); }} />}
            {mode === 'known' && <Field label="수평거리" unit="m" value={inputs.knownDistance} onChange={v => { setSavedId(null); setIn('knownDistance')(v); }} />}
          </div>
        </Card>

        {(gps || target) && (
          <Card title={<span className="flex items-center gap-1.5"><MapPin size={15} className="text-blue-600" />위치</span>}>
            <div className="text-xs space-y-1.5">
              {gps && <p><span className="text-slate-400 font-bold">관측점</span> N {gps.lat.toFixed(6)}, E {gps.lng.toFixed(6)} (GPS ±{Math.round(gps.acc)} m)</p>}
              {target && <p><span className="text-slate-400 font-bold">표적(추정)</span> N {target.lat.toFixed(6)}, E {target.lng.toFixed(6)} · 방위 {Math.round(target.bearing)}°</p>}
              {target && <p className="text-[11px] text-slate-400">나침반 오차(±5° 이상)와 GPS 오차가 함께 반영된 참고값입니다.</p>}
            </div>
          </Card>
        )}

        {mode !== 'calib' && (
          <Card>
            <input value={title} onChange={e => { setSavedId(null); setTitle(e.target.value); }} placeholder="제목 (예: 3번 사방댐 높이)" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold outline-none" />
            <textarea value={memo} onChange={e => { setSavedId(null); setMemo(e.target.value); }} placeholder="메모" rows={2} className="w-full mt-2 p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none" />
          </Card>
        )}

        <div className="grid grid-cols-2 gap-3">
          <button onClick={startCamera} className="py-3.5 bg-slate-200 rounded-2xl font-bold text-sm text-slate-700 flex items-center justify-center gap-1.5"><Camera size={16} />지점 추가</button>
          <button onClick={resetMeasure} className="py-3.5 bg-slate-200 rounded-2xl font-bold text-sm text-slate-700 flex items-center justify-center gap-1.5"><RotateCcw size={16} />새 측정</button>
          {mode !== 'calib' && (
            <button disabled={!!result.error || !!savedId} onClick={saveRecord} className="col-span-2 py-4 bg-emerald-600 disabled:opacity-50 rounded-2xl font-black text-white flex items-center justify-center gap-1.5"><Save size={18} />{savedId ? '저장됨' : '기록 저장'}</button>
          )}
        </div>
      </div>
    );
  }

  /* ============================ 준비 화면 ============================ */
  const primary = Object.entries(MODES).filter(([, m]) => !m.advanced && !m.hidden);
  const advanced = Object.entries(MODES).filter(([, m]) => m.advanced);
  const modeIcon = { ground: Mountain, move: Footprints, width: MoveHorizontal };
  const pickMode = (k) => { setMode(k); setShots([]); };
  const stride = Number(settings.stride) || 0.7;

  return (
    <div className="space-y-4">
      {mode === 'calib' ? (
        <Card title="카메라 높이 보정">
          <p className="text-xs text-slate-500 leading-relaxed mb-3">줄자로 잰 거리만큼 떨어진 바닥 지점을 평소 측정 자세로 조준합니다. 조준 각도로 카메라 높이를 역산해 저장합니다.</p>
          <Field label="기준 거리(발끝 → 바닥 지점)" unit="m" value={settings.calibDistance} onChange={v => setSettings(s => ({ ...s, calibDistance: v }))} hint="5~10 m를 권장합니다. 가까울수록 정확합니다." />
          <button onClick={() => pickMode('ground')} className="mt-3 text-xs font-bold text-slate-500 underline">보정 취소</button>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {primary.map(([k, m]) => {
              const Icon = modeIcon[k];
              return (
                <button key={k} onClick={() => pickMode(k)} className={`p-3 rounded-2xl border text-left transition ${mode === k ? 'bg-emerald-50 border-emerald-500 ring-1 ring-emerald-500' : 'bg-white border-slate-200'}`}>
                  <Icon size={22} className={mode === k ? 'text-emerald-600' : 'text-slate-400'} />
                  <div className={`text-sm font-black mt-1.5 ${mode === k ? 'text-emerald-800' : 'text-slate-700'}`}>{m.label}</div>
                  <div className="text-[10px] text-slate-400 font-bold">{m.short}</div>
                </button>
              );
            })}
          </div>
          <div className="flex gap-2 text-xs">
            <span className="text-slate-400 font-bold self-center">기타</span>
            {advanced.map(([k, m]) => (
              <button key={k} onClick={() => pickMode(k)} className={`px-3 py-1.5 rounded-full border font-bold ${mode === k ? 'bg-emerald-50 border-emerald-500 text-emerald-700' : 'bg-white border-slate-200 text-slate-500'}`}>{m.label}</button>
            ))}
          </div>

          <Card>
            <p className="text-xs text-slate-600 leading-relaxed">{M.desc}</p>
            <div className="grid grid-cols-2 gap-3 mt-4">
              {['ground', 'width', 'move'].includes(mode) && (
                <Field label="카메라 높이(지면 → 렌즈)" unit="m" value={settings.cameraHeight} onChange={v => setSettings(s => ({ ...s, cameraHeight: v }))} hint="「설정」에서 한 번 보정해 두면 정확해집니다." />
              )}
              {M.usesSlope && (
                <div>
                  <Field label="지면 경사(표적 방향 오르막 +)" unit="°" value={inputs.groundSlope} placeholder="0" onChange={setIn('groundSlope')} />
                  <button onClick={async () => { await enableTilt(); setSlopeTool(true); }} className="mt-1.5 w-full py-2 bg-slate-800 text-white rounded-lg text-xs font-bold">폰으로 경사 재기</button>
                </div>
              )}
              {mode === 'move' && (
                <>
                  <Field label="이동 거리" unit="m" value={inputs.baseline} onChange={v => setInputs(s => ({ ...s, baseline: v, steps: '' }))} />
                  <Field label={`걸음 수 (보폭 ${stride} m)`} unit="걸음" step="1" value={inputs.steps} onChange={v => setInputs(s => ({ ...s, steps: v, baseline: v ? (Number(v) * stride).toFixed(2) : s.baseline }))} hint="줄자가 없으면 걸음 수로 환산합니다." />
                </>
              )}
              {mode === 'staff' && <Field label="기준물 높이" unit="m" value={inputs.refHeight} onChange={setIn('refHeight')} hint="표척·폴·사람 키 등" />}
              {mode === 'known' && <Field label="수평거리" unit="m" value={inputs.knownDistance} onChange={setIn('knownDistance')} hint="줄자·도면 값" />}
            </div>
          </Card>
        </>
      )}

      <button onClick={startCamera} className="w-full py-4 bg-emerald-600 active:bg-emerald-700 rounded-2xl font-black text-white text-lg flex items-center justify-center gap-2 shadow-lg shadow-emerald-600/20"><Camera size={20} />카메라 시작</button>

      <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-[11px] text-amber-800 leading-relaxed">
        <b>촬영 순서</b> · {nRef ? M.refSteps.join(' → ') : '조준 지점 1개 이상'}{mode !== 'calib' && ' → (선택) 추가 지점'}<br />
        폰을 양손으로 잡고 팔꿈치를 몸에 붙이면 흔들림이 줄어듭니다. 먼 표적일수록 오차가 급증합니다.
      </div>

      {slopeTool && (
        <SlopeTool tilt={tilt} calib={settings.calib} onClose={() => setSlopeTool(false)} onApply={(v) => { setInputs(s => ({ ...s, groundSlope: v.toFixed(1) })); setSlopeTool(false); showToast(`지면 경사 ${v.toFixed(1)}°를 적용했습니다.`, 'success'); }} />
      )}
    </div>
  );
};

// 지면 경사 측정: 폰을 지면에 눕히고 윗변이 표적을 향하게 둔다.
const SlopeTool = ({ tilt, calib, onClose, onApply }) => {
  useBackHandler(true, onClose);
  const raw = tilt.raw;
  const slope = raw ? deviceLongAxisSlope(raw.beta - calib.beta) : null;
  const flatOk = raw && Math.abs(raw.gamma - calib.gamma) < 15 && Math.abs(raw.beta) < 60;
  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-end">
      <div className="w-full bg-white rounded-t-3xl p-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] space-y-4">
        <h3 className="font-black text-slate-800">지면 경사 재기</h3>
        <ol className="text-xs text-slate-600 space-y-1 list-decimal pl-4">
          <li>표적 쪽을 바라보고 섭니다.</li>
          <li>폰을 발 앞 지면(또는 지면에 눕힌 막대) 위에 화면이 위로 오게 놓습니다.</li>
          <li>폰 윗변이 표적을 향하게 한 뒤 값이 멈추면 [적용]을 누릅니다.</li>
        </ol>
        <div className="text-center">
          <div className="text-5xl font-black text-slate-800">{slope == null ? '--' : `${slope >= 0 ? '+' : ''}${slope.toFixed(1)}°`}</div>
          <div className={`text-xs font-bold mt-1 ${flatOk ? 'text-emerald-600' : 'text-amber-600'}`}>{slope == null ? '센서 대기 중' : flatOk ? (slope >= 0 ? '표적 방향 오르막' : '표적 방향 내리막') : '폰을 좌우로 기울이지 말고 지면에 눕혀 주십시오'}</div>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 py-3.5 bg-slate-100 rounded-xl font-bold text-slate-600">취소</button>
          <button disabled={!flatOk} onClick={() => onApply(slope)} className="flex-1 py-3.5 bg-emerald-600 disabled:opacity-40 rounded-xl font-bold text-white">적용</button>
        </div>
      </div>
    </div>
  );
};

/* =========================================================================
   기록 화면
   ========================================================================= */
const Records = ({ records, reload, showToast, openViewer }) => {
  const [detail, setDetail] = useState(null);
  useBackHandler(!!detail, () => setDetail(null));

  const remove = async (id) => {
    if (!window.confirm('이 기록을 삭제할까요?')) return;
    await deleteRecord(id); setDetail(null); reload();
  };

  const exportCsv = async () => {
    const head = ['구분', '일시', '제목', '방식', '결과', '오차(±m)', '기준', '조건', '지점별(라벨:앙각°/수평m)', '관측점 위도', '관측점 경도', '추정 표적 위도', '추정 표적 경도', '메모'];
    const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const rows = records.map(r => [
      '참고용', new Date(r.time).toLocaleString('ko-KR'), r.title, MODES[r.mode]?.label,
      r.cards.map(k => `${r.cardLabels[k]} ${fmtNum(r.summary[k])}`).join(' / '),
      r.uncertainty ? r.cards.map(k => r.uncertainty[k].toFixed(2)).join(' / ') : '',
      r.basis, r.paramText,
      r.points.map(p => `${p.label}:${p.elev.toFixed(2)}/${fmtNum(p.horizontal)}`).join(' | '),
      r.gps?.lat?.toFixed(6), r.gps?.lng?.toFixed(6), r.target?.lat?.toFixed(6), r.target?.lng?.toFixed(6), r.memo
    ].map(q).join(','));
    const blob = new Blob(['﻿' + [head.map(q).join(','), ...rows].join('\n')], { type: 'text/csv;charset=utf-8' });
    const name = `거리측정기록_${stamp()}.csv`;
    if (!(await shareBlob(blob, name))) saveBlob(blob, name);
  };

  if (detail) {
    const r = detail;
    const name = `거리측정_${r.title || MODES[r.mode]?.label}_${stamp(new Date(r.time))}.jpg`;
    return (
      <div className="space-y-4">
        <button onClick={() => setDetail(null)} className="text-sm font-bold text-slate-500 flex items-center gap-1"><X size={16} />목록으로</button>
        <section className="bg-slate-900 text-white p-4 rounded-2xl">
          <div className="text-[11px] font-bold text-emerald-300">{MODES[r.mode]?.label} · {new Date(r.time).toLocaleString('ko-KR')}</div>
          <div className="text-lg font-black mt-1">{r.title || '제목 없음'}</div>
          <div className="grid grid-cols-3 gap-2 mt-3 text-center">
            {r.cards.map(k => (
              <div key={k} className="bg-white/5 rounded-xl p-2.5">
                <div className="text-[10px] font-bold text-slate-400">{r.cardLabels[k]}</div>
                <div className="text-lg font-black">{fmtNum(r.summary[k])}<span className="text-xs text-slate-400 ml-0.5">m</span></div>
                {r.uncertainty && <div className="text-[10px] text-slate-400">±{r.uncertainty[k].toFixed(2)}</div>}
              </div>
            ))}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">기준: {r.basis} · {r.paramText}</p>
        </section>
        {r.image
          ? <button onClick={() => openViewer(r.image, name)} className="block w-full bg-white p-2 rounded-2xl border border-slate-200 relative"><img src={r.image} alt="측정 기록 사진" className="w-full rounded-xl" /><span className="absolute right-4 top-4 bg-black/60 text-white text-xs font-bold px-2.5 py-1.5 rounded-lg flex items-center gap-1"><Maximize2 size={13} />크게 보기</span></button>
          : <Card><p className="text-xs text-slate-400">사진 없이 저장된 기록입니다.</p></Card>}
        {r.memo && <Card title="메모"><p className="text-sm text-slate-600 whitespace-pre-wrap">{r.memo}</p></Card>}
        {r.gps && <Card><p className="text-xs"><span className="text-slate-400 font-bold">관측점</span> N {r.gps.lat.toFixed(6)}, E {r.gps.lng.toFixed(6)}</p>{r.target && <p className="text-xs mt-1"><span className="text-slate-400 font-bold">표적(추정)</span> N {r.target.lat.toFixed(6)}, E {r.target.lng.toFixed(6)}</p>}</Card>}
        <div className="grid grid-cols-3 gap-2">
          <button disabled={!r.image} onClick={async () => { if (!(await shareBlob(await dataUrlToBlob(r.image), name))) showToast('공유를 지원하지 않습니다.', 'error'); }} className="py-3 bg-slate-800 disabled:opacity-40 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-1"><Share2 size={15} />공유</button>
          <button disabled={!r.image} onClick={async () => { saveBlob(await dataUrlToBlob(r.image), name); showToast('다운로드 폴더에 저장했습니다.', 'success'); }} className="py-3 bg-slate-800 disabled:opacity-40 rounded-xl text-white text-sm font-bold flex items-center justify-center gap-1"><Download size={15} />저장</button>
          <button onClick={() => remove(r.id)} className="py-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-600 text-sm font-bold flex items-center justify-center gap-1"><Trash2 size={15} />삭제</button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex justify-between items-center">
        <h2 className="font-black text-slate-800">측정 기록 {records.length}건</h2>
        <button disabled={!records.length} onClick={exportCsv} className="text-xs font-bold text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-xl border border-emerald-200 flex items-center gap-1 disabled:opacity-40"><FileSpreadsheet size={14} />CSV 내보내기</button>
      </div>
      {!records.length && <Card><p className="text-sm text-slate-400">저장한 기록이 없습니다. 측정 결과 화면에서 「기록 저장」을 누르십시오.</p></Card>}
      {records.map(r => (
        <button key={r.id} onClick={() => setDetail(r)} className="w-full flex gap-3 items-center p-2.5 bg-white rounded-2xl border border-slate-200 text-left">
          {r.image ? <img src={r.image} alt="" className="w-20 h-20 object-cover rounded-xl" /> : <div className="w-20 h-20 bg-slate-100 rounded-xl" />}
          <div className="flex-1 min-w-0">
            <div className="font-black text-slate-800 truncate">{r.title || MODES[r.mode]?.label}</div>
            <div className="text-xs text-slate-600 font-bold mt-0.5">{r.cards.slice(0, 3).map(k => `${r.cardLabels[k]} ${fmtM(r.summary[k])}`).join(' · ')}</div>
            <div className="text-[11px] text-slate-400 mt-0.5">{new Date(r.time).toLocaleString('ko-KR')}</div>
          </div>
        </button>
      ))}
    </div>
  );
};

/* =========================================================================
   설정 화면
   ========================================================================= */
const SettingsView = ({ settings, setSettings, tilt, enableTilt, showToast, startCalib }) => {
  const set = (k) => (v) => setSettings(s => ({ ...s, [k]: v }));
  const [zeroing, setZeroing] = useState(false);
  const suggested = Number(settings.stature) > 0 ? (Number(settings.stature) / 100 * 0.92).toFixed(2) : null;

  useEffect(() => {
    if (!zeroing) return undefined;
    const t = setTimeout(() => {
      setZeroing(false);
      const raw = tilt.raw;
      if (!raw || Math.abs(raw.beta) > 10 || Math.abs(raw.gamma) > 10) { showToast('수평 상태가 아닙니다(±10° 초과). 다시 시도해 주십시오.', 'error'); return; }
      setSettings(s => ({ ...s, calib: { beta: raw.beta, gamma: raw.gamma } }));
      showToast(`영점 보정 완료 (β ${raw.beta.toFixed(2)}°, γ ${raw.gamma.toFixed(2)}°)`, 'success');
    }, 2500);
    return () => clearTimeout(t);
  }, [zeroing]);

  return (
    <div className="space-y-4">
      <Card title="1. 카메라 높이">
        <Field label="카메라 높이(지면 → 렌즈)" unit="m" value={settings.cameraHeight} onChange={set('cameraHeight')} hint="높이·거리, 폭·간격 측정의 기준입니다. 5 cm 오차가 20 m에서 약 0.7 m 오차가 됩니다." />
        <div className="grid grid-cols-2 gap-3 mt-3 items-end">
          <Field label="키(선택)" unit="cm" step="1" value={settings.stature} onChange={set('stature')} />
          <button disabled={!suggested} onClick={() => setSettings(s => ({ ...s, cameraHeight: suggested }))} className="py-3 bg-slate-100 disabled:opacity-40 rounded-xl text-xs font-bold text-slate-700">{suggested ? `키 기준 ${suggested} m 적용` : '키를 입력하면 추정'}</button>
        </div>
        <button onClick={startCalib} className="mt-3 w-full py-3.5 bg-emerald-600 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-1.5"><Ruler size={16} />거리를 아는 지점으로 정밀 보정</button>
        <p className="text-[11px] text-slate-400 mt-1.5">한 번만 줄자로 5~10 m를 재어 보정하면, 이후에는 폰 센서만으로 측정합니다. 보정 때와 같은 자세로 측정하십시오.</p>
      </Card>

      <Card title="2. 센서">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-slate-500">영점: β {settings.calib.beta.toFixed(2)}°, γ {settings.calib.gamma.toFixed(2)}°</p>
          <div className="flex gap-2 shrink-0">
            <button onClick={() => setSettings(s => ({ ...s, calib: { beta: 0, gamma: 0 } }))} className="px-3 py-2 bg-slate-100 rounded-lg text-xs font-bold text-slate-600">초기화</button>
            <button disabled={zeroing} onClick={async () => { if (!(await enableTilt())) { showToast('기울기 센서를 사용할 수 없습니다.', 'error'); return; } setZeroing(true); showToast('폰을 수평한 곳에 화면이 위로 가게 놓아 주십시오.', 'info'); }} className="px-3 py-2 bg-slate-800 disabled:opacity-50 rounded-lg text-xs font-bold text-white">{zeroing ? '측정 중…' : '수평면 영점 보정'}</button>
          </div>
        </div>
        <div className="mt-3 border-t border-slate-100 pt-3">
          <Toggle checked={settings.autoCapture} onChange={set('autoCapture')} label="자동 촬영" hint="조준이 1.2초 안정되면 버튼을 누르지 않아도 촬영합니다. 버튼을 누를 때의 흔들림을 없앱니다." />
        </div>
        <div className="grid grid-cols-2 gap-3 mt-3">
          <Field label="각도 오차 가정" unit="°" value={settings.sigma} onChange={set('sigma')} hint="오차 범위 표시에 사용" />
          <Field label="보폭" unit="m" step="0.01" value={settings.stride} onChange={set('stride')} hint="이동 측정의 걸음 수 환산" />
          <Field label="카메라 화각(긴 변)" unit="°" step="1" value={settings.fov} onChange={set('fov')} hint="사진 탭 보정용. 갤럭시 기본 광각 약 65~70°" />
          <Field label="자편각" unit="°" value={settings.declination} onChange={set('declination')} hint="남한 약 −8~−9°" />
        </div>
      </Card>

      <Card title="앱 정보">
        <p className="text-xs text-slate-500 leading-relaxed">폰 카메라와 기울기 센서로 거리를 추정하는 앱입니다. 기록은 이 기기의 브라우저 저장소에만 보관됩니다. 브라우저 데이터를 지우면 기록도 삭제되므로 필요한 기록은 CSV·사진으로 내보내 주십시오.</p>
        <p className="text-xs font-bold text-amber-700 mt-2">{REF_NOTICE}</p>
      </Card>
    </div>
  );
};

/* =========================================================================
   앱 셸
   ========================================================================= */
const App = () => {
  const [tab, setTab] = useState('measure');
  const [settings, setSettings] = useState(() => ({ ...DEFAULT_SETTINGS, ...loadJSON(SETTINGS_KEY, {}) }));
  const [mode, setMode] = useState('ground');
  const [records, setRecords] = useState([]);
  const [viewer, setViewer] = useState(null);
  const [toast, setToast] = useState(null);
  const [tiltActive, setTiltActive] = useState(false);
  const tilt = useDeviceTilt(tiltActive, settings.calib);
  const toastTimer = useRef(null);

  useEffect(() => { saveJSON(SETTINGS_KEY, settings); }, [settings]);
  const reload = useCallback(() => listRecords().then(setRecords).catch(() => setRecords([])), []);
  useEffect(() => { reload(); }, [reload]);

  const showToast = useCallback((message, type = 'info') => {
    clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = setTimeout(() => setToast(null), 3200);
  }, []);

  // 센서 권한은 사용자 제스처 안에서 요청해야 한다.
  const enableTilt = useCallback(async () => {
    const perm = await requestTiltPermission();
    if (perm === 'granted') setTiltActive(true);
    return perm === 'granted';
  }, []);

  const tabs = [
    { key: 'measure', label: '측정', Icon: Ruler },
    { key: 'records', label: `기록${records.length ? ` ${records.length}` : ''}`, Icon: List },
    { key: 'settings', label: '설정', Icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 pb-24">
      {toast && (
        <div className="fixed top-4 inset-x-4 z-[60] flex justify-center pointer-events-none">
          <div className={`flex items-start gap-2 px-4 py-3 rounded-2xl shadow-xl text-white font-bold text-sm ${toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-rose-600' : 'bg-slate-800'}`}>
            <Bell size={16} className="shrink-0 mt-0.5" /><span>{toast.message}</span>
          </div>
        </div>
      )}

      <header className="bg-slate-900 text-white px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-4 flex items-center gap-2.5">
        <Ruler className="text-emerald-400" size={24} />
        <div>
          <h1 className="text-lg font-black leading-tight">거리측정</h1>
          <p className="text-[11px] text-slate-400">카메라·기울기 센서 수평거리 · 사거리 · 높이차</p>
        </div>
      </header>

      <main className="max-w-xl mx-auto p-4">
        {/* 탭을 옮겨도 진행 중인 측정이 사라지지 않도록 숨기기만 한다 */}
        <div hidden={tab !== 'measure'}>
          <Measure visible={tab === 'measure'} settings={settings} setSettings={setSettings} mode={mode} setMode={setMode} tilt={tilt} enableTilt={enableTilt}
            showToast={showToast} onSaved={reload} openViewer={(src, name) => setViewer({ src, name })} />
        </div>
        {tab === 'records' && <Records records={records} reload={reload} showToast={showToast} openViewer={(src, name) => setViewer({ src, name })} />}
        {tab === 'settings' && (
          <SettingsView settings={settings} setSettings={setSettings} tilt={tilt} enableTilt={enableTilt} showToast={showToast}
            startCalib={() => { setMode('calib'); setTab('measure'); }} />
        )}
      </main>

      <nav className="fixed bottom-0 inset-x-0 z-30 bg-white border-t border-slate-200 pb-[env(safe-area-inset-bottom)]">
        <div className="max-w-xl mx-auto grid grid-cols-3">
          {tabs.map(({ key, label, Icon }) => (
            <button key={key} onClick={() => setTab(key)} className={`py-2.5 flex flex-col items-center gap-0.5 text-[11px] font-bold ${tab === key ? 'text-emerald-600' : 'text-slate-400'}`}>
              <Icon size={22} />{label}
            </button>
          ))}
        </div>
      </nav>

      {viewer && <PhotoViewer src={viewer.src} name={viewer.name} onClose={() => setViewer(null)} showToast={showToast} />}
    </div>
  );
};

export default App;
