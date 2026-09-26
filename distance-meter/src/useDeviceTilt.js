import { useEffect, useRef, useState } from 'react';
import { cameraElevation, cameraHeading } from './geometry.js';

const WINDOW = 20;        // 평균 창(표본 수)
const STABLE_STD = 0.2;   // 안정 판정 표준편차(°)
const UI_INTERVAL = 80;   // 화면 갱신 간격(ms)

// iOS 13+는 사용자 제스처 안에서 권한을 요청해야 한다. 안드로이드는 즉시 허용된다.
export const requestTiltPermission = async () => {
  const E = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
  if (!E) return 'unsupported';
  if (typeof E.requestPermission === 'function') {
    try { return await E.requestPermission(); } catch { return 'denied'; }
  }
  return 'granted';
};

const mean = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;

// 방위의 원형 평균
const circularMean = (arr) => {
  const s = arr.reduce((a, d) => a + Math.sin(d * Math.PI / 180), 0);
  const c = arr.reduce((a, d) => a + Math.cos(d * Math.PI / 180), 0);
  return (Math.atan2(s, c) * 180 / Math.PI + 360) % 360;
};

/*
  카메라 광축 앙각·방위를 이동평균으로 제공한다. calib = { beta, gamma } 영점 오프셋.
  - elev: 앙각(°)
  - yaw: 자이로 기반 상대 방위(°). 짧은 시간의 회전각 비교(폭 측정)에 사용한다.
  - heading: 나침반 기반 절대 방위(°, 자북). 표적 좌표 추정 참고용.
  - raw: 보정 전 beta·gamma 평균. 영점 보정·지면 경사 측정에 사용한다.
*/
export const useDeviceTilt = (active, calib) => {
  const buf = useRef({ elev: [], yaw: [], raw: [] });
  const headingRef = useRef(null);
  const lastUi = useRef(0);
  const calibRef = useRef(calib);
  calibRef.current = calib;
  const [state, setState] = useState({ ready: false, elev: null, std: null, stable: false, yaw: null, heading: null, raw: null });

  useEffect(() => {
    if (!active) return undefined;
    buf.current = { elev: [], yaw: [], raw: [] };
    const push = (key, v) => { const b = buf.current[key]; b.push(v); if (b.length > WINDOW) b.shift(); };

    const onAbsolute = (e) => {
      if (e.alpha == null || e.beta == null) return;
      headingRef.current = cameraHeading(e.alpha, e.beta, e.gamma);
    };
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const c = calibRef.current || { beta: 0, gamma: 0 };
      push('elev', cameraElevation(e.beta - c.beta, e.gamma - c.gamma));
      push('raw', [e.beta, e.gamma]);
      if (e.alpha != null) {
        const y = cameraHeading(e.alpha, e.beta - c.beta, e.gamma - c.gamma);
        if (y != null) push('yaw', y);
      }
      if (typeof e.webkitCompassHeading === 'number') headingRef.current = e.webkitCompassHeading; // iOS
      else if (e.absolute && e.alpha != null) headingRef.current = cameraHeading(e.alpha, e.beta, e.gamma);

      const now = performance.now();
      if (now - lastUi.current < UI_INTERVAL) return;
      lastUi.current = now;
      const { elev, yaw, raw } = buf.current;
      const m = mean(elev);
      const std = Math.sqrt(mean(elev.map(v => (v - m) ** 2)));
      setState({
        ready: true, elev: m, std,
        stable: elev.length >= WINDOW / 2 && std < STABLE_STD,
        yaw: yaw.length ? circularMean(yaw) : null,
        heading: headingRef.current,
        raw: { beta: mean(raw.map(r => r[0])), gamma: mean(raw.map(r => r[1])) }
      });
    };

    window.addEventListener('deviceorientation', onOrient);
    window.addEventListener('deviceorientationabsolute', onAbsolute);
    return () => {
      window.removeEventListener('deviceorientation', onOrient);
      window.removeEventListener('deviceorientationabsolute', onAbsolute);
    };
  }, [active]);

  return state;
};
