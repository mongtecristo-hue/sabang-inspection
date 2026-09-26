import React, { useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import {
  WebGLRenderer, Scene, PerspectiveCamera, Mesh, RingGeometry, CircleGeometry, MeshBasicMaterial,
  SphereGeometry, BufferGeometry, Line, LineBasicMaterial, Vector3
} from 'three';
import { X, RotateCcw, Check, ArrowUpFromLine, Scan, AlertTriangle, Save } from 'lucide-react';
import { arMeasure, verticalLineRayPoint, forwardFromQuaternion, fmtCard, fmtNum, gradeToDeg } from './geometry.js';
import { putRecord } from './storage.js';
import { REF_NOTICE } from './media.js';
import { useBackHandler } from './useBackHandler.js';

/* =========================================================================
   AR 측정 (WebXR immersive-ar + hit-test, 안드로이드 Chrome의 ARCore 사용)
   - A: 표면 인식점(지면 등)
   - B: 표면 인식점, 또는 A를 지나는 연직선 위의 조준점(벽·나무 높이)
   ========================================================================= */

const CARDS = ['horizontal', 'slope', 'heightDiff', 'grade'];
const LABELS = { horizontal: '수평거리', slope: '사거리', heightDiff: '높이차', grade: '경사도' };

const ArMeasure = ({ showToast, onSaved, onExit }) => {
  const overlayRef = useRef(null);
  const xr = useRef({});             // three·세션 객체
  const [active, setActive] = useState(false);
  const [tracking, setTracking] = useState(false);   // 표면 인식 여부
  const [bMode, setBMode] = useState('surface');     // surface | vertical
  const [a, setA] = useState(null);
  const [b, setB] = useState(null);
  const [live, setLive] = useState(null);
  const [title, setTitle] = useState('');
  const [memo, setMemo] = useState('');
  const [saved, setSaved] = useState(false);
  const stateRef = useRef({});
  stateRef.current = { a, b, bMode };

  const cleanup = () => {
    const o = xr.current;
    o.renderer?.setAnimationLoop(null);
    o.hitSource?.cancel?.();
    o.renderer?.domElement.remove();
    o.renderer?.dispose();
    xr.current = {};
  };
  useEffect(() => () => { xr.current.session?.end().catch(() => {}); cleanup(); }, []);

  const addMarker = (p, color) => {
    const m = new Mesh(new SphereGeometry(0.04, 16, 12), new MeshBasicMaterial({ color }));
    m.position.set(p.x, p.y, p.z);
    xr.current.scene.add(m);
    return m;
  };

  const start = async () => {
    flushSync(() => setActive(true)); // dom-overlay 루트가 보이는 상태에서 세션을 요청한다
    try {
      const session = await navigator.xr.requestSession('immersive-ar', {
        requiredFeatures: ['hit-test'],
        optionalFeatures: ['dom-overlay', 'local-floor'],
        domOverlay: { root: overlayRef.current }
      });
      const renderer = new WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.xr.enabled = true;
      renderer.xr.setReferenceSpaceType('local');
      document.body.appendChild(renderer.domElement);
      await renderer.xr.setSession(session);

      const scene = new Scene();
      const camera = new PerspectiveCamera();
      const reticle = new Mesh(new RingGeometry(0.06, 0.08, 32).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0x34d399 }));
      reticle.add(new Mesh(new CircleGeometry(0.01, 16).rotateX(-Math.PI / 2), new MeshBasicMaterial({ color: 0xf43f5e })));
      reticle.matrixAutoUpdate = false;
      reticle.visible = false;
      scene.add(reticle);
      const line = new Line(new BufferGeometry().setFromPoints([new Vector3(), new Vector3()]), new LineBasicMaterial({ color: 0xfbbf24 }));
      line.visible = false;
      scene.add(line);

      const viewerSpace = await session.requestReferenceSpace('viewer');
      const hitSource = await session.requestHitTestSource({ space: viewerSpace });
      Object.assign(xr.current, { session, renderer, scene, camera, reticle, line, hitSource, hit: null, aim: null, lastUi: 0, markers: [] });

      session.addEventListener('end', () => { cleanup(); setActive(false); setTracking(false); setLive(null); });
      // 오버레이 버튼을 누를 때 AR select 이벤트가 겹치지 않게 한다
      overlayRef.current.addEventListener('beforexrselect', (e) => e.preventDefault());

      renderer.setAnimationLoop((_, frame) => {
        if (!frame) return;
        const o = xr.current;
        const ref = renderer.xr.getReferenceSpace();
        const hits = frame.getHitTestResults(hitSource);
        if (hits.length) {
          const pose = hits[0].getPose(ref);
          reticle.visible = true;
          reticle.matrix.fromArray(pose.transform.matrix);
          const p = pose.transform.position;
          o.hit = { x: p.x, y: p.y, z: p.z };
        } else {
          reticle.visible = false;
          o.hit = null;
        }
        // 연직 모드: A를 지나는 연직선과 화면 중심 광선의 최근접점
        const { a: A, bMode: mode } = stateRef.current;
        const vp = frame.getViewerPose(ref);
        o.aim = o.hit;
        if (A && mode === 'vertical' && vp) {
          const t = vp.transform;
          o.aim = verticalLineRayPoint(A, t.position, forwardFromQuaternion(t.orientation));
        }
        if (A && o.aim) {
          line.visible = true;
          line.geometry.setFromPoints([new Vector3(A.x, A.y, A.z), new Vector3(o.aim.x, o.aim.y, o.aim.z)]);
        } else if (!stateRef.current.b) line.visible = false;

        const now = performance.now();
        if (now - o.lastUi > 100) {
          o.lastUi = now;
          setTracking(!!o.hit);
          setLive(A && o.aim && !stateRef.current.b ? arMeasure(A, o.aim) : null);
        }
        renderer.render(scene, camera);
      });
    } catch (err) {
      cleanup();
      setActive(false);
      showToast(err?.name === 'NotSupportedError' ? '이 기기는 AR을 지원하지 않습니다.' : `AR을 시작하지 못했습니다: ${err?.message || err}`, 'error');
    }
  };

  const placePoint = () => {
    const o = xr.current;
    if (!a) {
      if (!o.hit) { showToast('표면이 인식되지 않았습니다. 폰을 천천히 움직여 지면을 비춰 주십시오.', 'error'); return; }
      setA(o.hit); o.markers.push(addMarker(o.hit, 0x34d399));
      navigator.vibrate?.(40);
    } else if (!b) {
      if (!o.aim) { showToast(bMode === 'vertical' ? '조준 방향이 연직선과 평행합니다.' : '표면이 인식되지 않았습니다.', 'error'); return; }
      setB(o.aim); o.markers.push(addMarker(o.aim, 0xfbbf24));
      navigator.vibrate?.([40, 60, 40]);
    }
  };

  const resetPoints = () => {
    xr.current.markers?.forEach(m => xr.current.scene.remove(m));
    if (xr.current.markers) xr.current.markers = [];
    if (xr.current.line) xr.current.line.visible = false;
    setA(null); setB(null); setLive(null); setSaved(false);
  };

  const finish = () => xr.current.session?.end();
  useBackHandler(active, finish);
  const result = a && b ? arMeasure(a, b) : null;

  const save = async () => {
    const rec = {
      id: Date.now().toString(), time: new Date().toISOString(), title, memo, mode: 'ar',
      paramText: bMode === 'vertical' ? 'AR · B는 A 위 연직선' : 'AR · 표면 인식 두 점',
      gps: null, target: null, summary: result, cards: CARDS, cardLabels: LABELS,
      basis: 'A → B', uncertainty: null,
      points: [{ label: 'A', elev: null, horizontal: 0 }, { label: 'B', elev: null, horizontal: result.horizontal }],
      image: null
    };
    try { await putRecord(rec); setSaved(true); onSaved(); showToast('AR 측정 기록을 저장했습니다.', 'success'); }
    catch { showToast('기록 저장에 실패했습니다.', 'error'); }
  };

  const shown = result || live;

  return (
    <>
      {/* AR 세션 중 화면 위에 겹치는 조작부(dom-overlay) */}
      <div ref={overlayRef} className={active ? 'fixed inset-0 z-50 text-white select-none' : 'hidden'}>
        {active && (
          <>
            <div className="absolute top-0 inset-x-0 p-4 pt-[max(1rem,env(safe-area-inset-top))] bg-gradient-to-b from-black/70 to-transparent">
              <div className="flex justify-between items-start gap-3">
                <div>
                  <div className="text-[11px] font-bold text-emerald-300">AR 측정</div>
                  <div className="text-base font-black leading-snug">
                    {!a ? '초록 원을 A 지점(지면)에 맞추고 [A 지정]' : !b ? (bMode === 'vertical' ? 'A 위쪽 높이를 조준하고 [B 지정]' : 'B 지점까지 걸어가며 비추고 [B 지정]') : '측정 완료'}
                  </div>
                  {!tracking && !(a && bMode === 'vertical') && <div className="text-xs font-bold text-amber-300 mt-1">표면 인식 중… 폰을 천천히 좌우로 움직여 주십시오</div>}
                </div>
                <button onClick={finish} className="p-2 bg-white/15 rounded-full shrink-0"><X size={20} /></button>
              </div>
              {shown && (
                <div className="grid grid-cols-2 gap-2 mt-3 text-center">
                  {CARDS.map(k => (
                    <div key={k} className="bg-black/55 rounded-xl py-2">
                      <div className="text-[10px] font-bold text-white/70">{LABELS[k]}</div>
                      <div className="text-xl font-black">{fmtCard(k, shown[k])}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div className="absolute bottom-0 inset-x-0 p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] bg-gradient-to-t from-black/70 to-transparent space-y-3">
              {a && !b && (
                <div className="flex bg-black/50 rounded-xl p-1 text-xs font-bold">
                  <button onClick={() => setBMode('surface')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1 ${bMode === 'surface' ? 'bg-emerald-600' : ''}`}><Scan size={14} />B: 표면 점</button>
                  <button onClick={() => setBMode('vertical')} className={`flex-1 py-2 rounded-lg flex items-center justify-center gap-1 ${bMode === 'vertical' ? 'bg-emerald-600' : ''}`}><ArrowUpFromLine size={14} />B: A 위 높이</button>
                </div>
              )}
              <div className="flex items-center justify-between">
                <button onClick={resetPoints} className="w-16 flex flex-col items-center text-[11px] font-bold"><RotateCcw size={24} />초기화</button>
                <button disabled={!!b} onClick={placePoint} className="w-24 h-20 rounded-2xl bg-emerald-600 disabled:opacity-40 font-black text-lg">{!a ? 'A 지정' : 'B 지정'}</button>
                <button disabled={!b} onClick={finish} className="w-16 flex flex-col items-center text-[11px] font-bold disabled:opacity-30"><Check size={24} />완료</button>
              </div>
            </div>
          </>
        )}
      </div>

      {/* 세션 밖 화면: 안내 또는 결과 */}
      {!active && (
        <div className="space-y-4">
          {result ? (
            <>
              <section className="bg-slate-900 text-white p-4 rounded-2xl shadow-xl">
                <div className="text-[11px] font-bold text-emerald-300">AR 측정 · {bMode === 'vertical' ? 'A 위 연직 높이' : '표면 두 점'}</div>
                <div className="grid grid-cols-2 gap-2 mt-3 text-center">
                  {CARDS.map(k => (
                    <div key={k} className="bg-white/5 rounded-xl p-3">
                      <div className="text-[11px] font-bold text-slate-400">{LABELS[k]}</div>
                      <div className="text-2xl font-black mt-1">{fmtNum(result[k], k === 'grade' ? 1 : 2)}<span className="text-sm text-slate-400 ml-0.5">{k === 'grade' ? '%' : 'm'}</span></div>
                      {k === 'grade' && result.grade != null && <div className="text-[11px] text-slate-300">경사각 {gradeToDeg(result.grade).toFixed(1)}°</div>}
                    </div>
                  ))}
                </div>
                <p className="text-[11px] text-slate-400 mt-3">기준: A → B (높이차·경사도는 B가 높으면 +)</p>
                <p className="text-xs font-bold text-amber-300 mt-2 flex items-start gap-1"><AlertTriangle size={14} className="shrink-0 mt-px" />{REF_NOTICE}</p>
              </section>
              <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <input value={title} onChange={e => { setSaved(false); setTitle(e.target.value); }} placeholder="제목 (예: 배수로 폭)" className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-base font-bold outline-none" />
                <textarea value={memo} onChange={e => { setSaved(false); setMemo(e.target.value); }} placeholder="메모" rows={2} className="w-full p-3 bg-slate-50 border border-slate-200 rounded-xl text-sm outline-none" />
              </section>
              <div className="grid grid-cols-2 gap-3">
                <button onClick={() => { resetPoints(); start(); }} className="py-3.5 bg-slate-200 rounded-2xl font-bold text-sm text-slate-700">다시 측정</button>
                <button onClick={onExit} className="py-3.5 bg-slate-200 rounded-2xl font-bold text-sm text-slate-700">다른 방식</button>
                <button disabled={saved} onClick={save} className="col-span-2 py-4 bg-emerald-600 disabled:opacity-50 rounded-2xl font-black text-white flex items-center justify-center gap-1.5"><Save size={18} />{saved ? '저장됨' : '기록 저장'}</button>
              </div>
              <p className="text-[11px] text-slate-400">AR 측정은 카메라 사진을 기록하지 않습니다(브라우저 AR 제약).</p>
            </>
          ) : (
            <>
              <section className="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm text-xs text-slate-600 leading-relaxed space-y-1.5">
                <p className="font-extrabold text-slate-800 text-sm">AR 측정 방법</p>
                <p>1. 폰을 천천히 좌우로 움직여 지면을 인식시킵니다(초록 원이 나타남).</p>
                <p>2. 초록 원을 A 지점에 맞추고 [A 지정]을 누릅니다.</p>
                <p>3. <b>표면 점</b>: B 지점까지 걸어가며 지면을 계속 비추고 [B 지정]. <b>A 위 높이</b>: A 바로 위(벽·댐·나무 끝)를 조준하고 [B 지정].</p>
                <p className="text-slate-400">밝고 무늬가 있는 표면에서 잘 인식됩니다. 물·유리·단색 벽은 인식이 어렵습니다.</p>
              </section>
              <button onClick={start} className="w-full py-4 bg-emerald-600 rounded-2xl font-black text-white text-lg flex items-center justify-center gap-2"><Scan size={20} />AR 시작</button>
            </>
          )}
        </div>
      )}
    </>
  );
};

export default ArMeasure;
