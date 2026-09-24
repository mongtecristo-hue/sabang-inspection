import { useEffect, useRef, useState } from 'react';
import { cameraElevation, cameraHeading } from './geometry.js';

const WINDOW = 20;        // 평균 창(표본 수)
const STABLE_STD = 0.2;   // 안정 판정 표준편차(°)
const UI_INTERVAL = 80;   // 화면 갱신 간격(ms)

// iOS 13+는 사용자 제스처 안에서 권한을 요청해야 한다.
export const requestTiltPermission = async () => {
  const E = typeof window !== 'undefined' ? window.DeviceOrientationEvent : undefined;
  if (!E) return 'unsupported';
  if (typeof E.requestPermission === 'function') {
    try { return await E.requestPermission(); } catch { return 'denied'; }
  }
  return 'granted';
};

// 카메라 광축 앙각·방위각을 이동평균으로 제공한다. calib = { beta, gamma } 영점 오프셋.
export const useDeviceTilt = (active, calib) => {
  const buf = useRef([]);
  const rawBuf = useRef([]);
  const headingRef = useRef(null);
  const lastUi = useRef(0);
  const calibRef = useRef(calib);
  calibRef.current = calib;
  const [state, setState] = useState({ ready: false, elev: null, std: null, stable: false, heading: null, raw: null });

  useEffect(() => {
    if (!active) return undefined;
    buf.current = [];
    rawBuf.current = [];

    const onAbsolute = (e) => {
      if (e.alpha == null || e.beta == null) return;
      headingRef.current = cameraHeading(e.alpha, e.beta, e.gamma);
    };
    const onOrient = (e) => {
      if (e.beta == null || e.gamma == null) return;
      const c = calibRef.current || { beta: 0, gamma: 0 };
      const elev = cameraElevation(e.beta - c.beta, e.gamma - c.gamma);
      buf.current.push(elev);
      if (buf.current.length > WINDOW) buf.current.shift();
      rawBuf.current.push([e.beta, e.gamma]);
      if (rawBuf.current.length > WINDOW) rawBuf.current.shift();
      // iOS: webkitCompassHeading(자북 기준) 사용
      if (typeof e.webkitCompassHeading === 'number') headingRef.current = e.webkitCompassHeading;
      else if (e.absolute && e.alpha != null) headingRef.current = cameraHeading(e.alpha, e.beta, e.gamma);

      const now = performance.now();
      if (now - lastUi.current < UI_INTERVAL) return;
      lastUi.current = now;
      const n = buf.current.length;
      const mean = buf.current.reduce((a, b) => a + b, 0) / n;
      const std = Math.sqrt(buf.current.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
      const rn = rawBuf.current.length;
      const raw = {
        beta: rawBuf.current.reduce((a, r) => a + r[0], 0) / rn,
        gamma: rawBuf.current.reduce((a, r) => a + r[1], 0) / rn
      };
      setState({ ready: true, elev: mean, std, stable: n >= WINDOW / 2 && std < STABLE_STD, heading: headingRef.current, raw });
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
