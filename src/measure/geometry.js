/* =========================================================================
   카메라 거리측정 기하 연산 (순수 함수)
   - 각도 입력·출력: 도(°), 길이: m
   - 앙각(elevation): 수평 기준 위(+)/아래(−)
   ========================================================================= */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;

/* ---------- 센서 → 카메라 광축 ---------- */

// W3C DeviceOrientation(Z-X'-Y'') 회전행렬
const rotationMatrix = (alpha, beta, gamma) => {
  const a = alpha * RAD, b = beta * RAD, g = gamma * RAD;
  const ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b), cg = Math.cos(g), sg = Math.sin(g);
  return [
    [ca * cg - sa * sb * sg, -cb * sa, ca * sg + cg * sa * sb],
    [cg * sa + ca * sb * sg, ca * cb, sa * sg - ca * cg * sb],
    [-cb * sg, sb, cb * cg]
  ];
};

// 후면 카메라 광축(기기 −Z)의 앙각. 화면 방향(세로/가로)·롤과 무관하다.
export const cameraElevation = (beta, gamma) => {
  const z = -Math.cos(beta * RAD) * Math.cos(gamma * RAD);
  return Math.asin(Math.max(-1, Math.min(1, z))) * DEG;
};

// 후면 카메라 광축의 방위각(0=북, 시계방향). alpha가 절대 방위일 때만 의미가 있다.
export const cameraHeading = (alpha, beta, gamma) => {
  const R = rotationMatrix(alpha, beta, gamma);
  const east = -R[0][2], north = -R[1][2];
  if (Math.hypot(east, north) < 0.05) return null; // 연직 조준 시 방위 불확정
  return (Math.atan2(east, north) * DEG + 360) % 360;
};

// 사진 위 조준점 보정: 화면 중심 대비 세로 픽셀 편차(위 +)를 앙각에 더한다.
export const offsetElevation = (centerElev, dyPx, frameW, frameH, longSideFovDeg) => {
  const longPx = Math.max(frameW, frameH);
  const f = (longPx / 2) / Math.tan((longSideFovDeg / 2) * RAD);
  return centerElev + Math.atan(dyPx / f) * DEG;
};

/* ---------- 측정 방식 ---------- */

export const MODES = {
  ground: {
    label: '지면 기준법',
    short: '평지',
    desc: '카메라 높이(h)와 표적 기저부 앙각으로 수평거리를 구합니다. 관측자와 표적 사이 지면이 수평일 때 정확합니다.',
    refSteps: ['표적 기저부(지면 접점)']
  },
  staff: {
    label: '기준 높이법',
    short: '경사지',
    desc: '높이를 아는 표척·폴·구조물의 하단과 상단을 조준해 수평거리를 구합니다. 경사지·계곡에서도 사용할 수 있습니다.',
    refSteps: ['기준물 하단', '기준물 상단']
  },
  known: {
    label: '수평거리 입력법',
    short: '거리 입력',
    desc: '줄자·도면·레이저로 확인한 수평거리를 입력하고, 조준한 지점의 높이차·사거리를 구합니다.',
    refSteps: []
  }
};

/* ---------- 결과 연산 ---------- */

// shots: [{ elev, label }] — 앞쪽 refSteps 개수만큼은 기준 촬영, 나머지는 추가 지점
export const solve = (mode, shots, params) => {
  const h = Number(params.cameraHeight);
  const H = Number(params.refHeight);
  const nRef = MODES[mode].refSteps.length;
  const tan = (deg) => Math.tan(deg * RAD);
  let D;

  if (mode === 'ground') {
    if (!shots[0]) return { error: '기저부 촬영이 필요합니다.' };
    if (!(h > 0)) return { error: '카메라 높이를 입력해 주십시오.' };
    if (shots[0].elev > -1) return { error: '기저부 앙각이 수평에 가깝습니다(−1° 이상). 표적이 너무 멀거나 지면이 수평이 아닙니다.' };
    D = h / tan(-shots[0].elev);
  } else if (mode === 'staff') {
    if (shots.length < 2) return { error: '기준물 하단·상단 촬영이 필요합니다.' };
    if (!(H > 0)) return { error: '기준물 높이를 입력해 주십시오.' };
    const d = tan(shots[1].elev) - tan(shots[0].elev);
    if (d < 0.005) return { error: '상단 앙각이 하단보다 충분히 크지 않습니다. 순서를 확인하거나 더 가까이에서 측정해 주십시오.' };
    D = H / d;
  } else {
    D = Number(params.knownDistance);
    if (!(D > 0)) return { error: '수평거리를 입력해 주십시오.' };
    if (!shots.length) return { error: '조준 지점을 1개 이상 촬영해 주십시오.' };
  }

  const base = shots[0];
  const points = shots.map((s, i) => {
    const fromEye = D * tan(s.elev);
    return {
      ...s,
      isRef: i < nRef,
      slope: D / Math.cos(s.elev * RAD),        // 카메라 → 지점 사거리
      fromEye,                                  // 카메라 기준 높이차
      fromGround: h > 0 ? h + fromEye : null,   // 관측자 발밑 기준 높이차
      fromBase: D * (tan(s.elev) - tan(base.elev)) // 첫 지점(기저부) 기준 높이차
    };
  });

  const last = points[points.length - 1];
  const summary = {
    horizontal: D,
    slope: last.slope,
    // 대표 높이차: 지점이 2개 이상이면 첫 지점→마지막 지점, 1개면 관측자 발밑→지점
    heightDiff: points.length > 1 ? last.fromBase : (last.fromGround ?? last.fromEye),
    heightDiffBasis: points.length > 1 ? `${base.label} → ${last.label}` : (last.fromGround != null ? '관측자 지면 → 지점' : '카메라 → 지점')
  };
  return { D, points, summary };
};

// 각도 오차(±sigmaDeg)와 입력 오차가 결과에 미치는 영향(RSS)
export const uncertainty = (mode, shots, params, sigmaDeg = 0.5) => {
  const base = solve(mode, shots, params);
  if (base.error) return null;
  const keys = ['horizontal', 'slope', 'heightDiff'];
  const acc = Object.fromEntries(keys.map(k => [k, 0]));
  const add = (res) => {
    if (res.error) return;
    keys.forEach(k => { acc[k] += (res.summary[k] - base.summary[k]) ** 2; });
  };
  shots.forEach((_, i) => add(solve(mode, shots.map((s, j) => j === i ? { ...s, elev: s.elev + sigmaDeg } : s), params)));
  if (mode === 'ground') add(solve(mode, shots, { ...params, cameraHeight: Number(params.cameraHeight) + 0.05 }));
  if (mode === 'known') add(solve(mode, shots, { ...params, knownDistance: Number(params.knownDistance) * 1.01 }));
  return Object.fromEntries(keys.map(k => [k, Math.sqrt(acc[k])]));
};

/* ---------- 표적 좌표 추정 ---------- */

export const destinationPoint = (lat, lng, bearingDeg, distM) => {
  const R = 6371008.8, d = distM / R, b = bearingDeg * RAD, p1 = lat * RAD, l1 = lng * RAD;
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b));
  const l2 = l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return { lat: p2 * DEG, lng: ((l2 * DEG + 540) % 360) - 180 };
};

export const fmtNum = (v, digits = 2) => (v == null || !isFinite(v)) ? '-' : (Math.abs(v) < 0.5 * 10 ** -digits ? 0 : v).toFixed(digits);
export const fmtM = (v, digits = 2) => (v == null || !isFinite(v)) ? '-' : `${fmtNum(v, digits)} m`;
export const fmtDeg = (v) => (v == null || !isFinite(v)) ? '-' : `${v >= 0 ? '+' : ''}${v.toFixed(1)}°`;
