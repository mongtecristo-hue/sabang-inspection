/* =========================================================================
   카메라 거리측정 기하 연산 (순수 함수)
   - 각도 입력·출력: 도(°), 길이: m
   - 앙각(elevation): 수평 기준 위(+)/아래(−)
   - 방위(yaw): 0=기준 방향, 시계방향(+)
   ========================================================================= */

const RAD = Math.PI / 180;
const DEG = 180 / Math.PI;
const tan = (deg) => Math.tan(deg * RAD);

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

// 후면 카메라 광축의 수평 방위. alpha가 절대값이면 진북·자북 기준, 상대값이면 임의 기준.
export const cameraHeading = (alpha, beta, gamma) => {
  const R = rotationMatrix(alpha, beta, gamma);
  const east = -R[0][2], north = -R[1][2];
  if (Math.hypot(east, north) < 0.05) return null; // 연직 조준 시 방위 불확정
  return (Math.atan2(east, north) * DEG + 360) % 360;
};

// 폰을 지면에 눕혔을 때 긴 축(기기 +Y)의 경사. 윗변이 올라가면 +.
export const deviceLongAxisSlope = (beta) => Math.asin(Math.sin(beta * RAD)) * DEG;

// 두 방위의 차이(−180~180)
export const yawDelta = (a, b) => ((b - a + 540) % 360) - 180;

// 줌을 반영한 긴 변 화각
export const effectiveFov = (fovDeg, zoom = 1) => 2 * Math.atan(Math.tan((fovDeg / 2) * RAD) / (zoom || 1)) * DEG;

// 사진 위 조준점 보정: 화면 중심 대비 세로 픽셀 편차(위 +)를 앙각에 더한다.
export const offsetElevation = (centerElev, dyPx, frameW, frameH, longSideFovDeg) => {
  const longPx = Math.max(frameW, frameH);
  const f = (longPx / 2) / Math.tan((longSideFovDeg / 2) * RAD);
  return centerElev + Math.atan(dyPx / f) * DEG;
};

/* ---------- 측정 방식 ---------- */

export const MODES = {
  ground: {
    label: '높이·거리',
    short: '기본',
    desc: '표적 기저부(지면 접점)를 조준해 수평거리를 구하고, 이어서 상단 등 원하는 지점을 조준해 높이차를 구합니다.',
    refSteps: ['표적 기저부(지면 접점)'],
    extraLabel: (i) => (i === 1 ? '상단' : `지점 ${i + 1}`),
    usesSlope: true
  },
  move: {
    label: '이동 측정',
    short: '기저부 안 보임',
    desc: '기저부가 물·수풀에 가려 보이지 않을 때 사용합니다. 같은 지점을 두 위치에서 조준하고, 표적 쪽으로 곧게 이동한 거리를 입력합니다.',
    refSteps: ['1차 위치에서 표적 지점', '앞으로 이동 후 같은 지점'],
    extraLabel: (i) => `지점 ${i}`
  },
  width: {
    label: '폭·간격',
    short: '두 지점 사이',
    desc: '같은 자리에서 몸을 돌려 A·B 지점의 기저부를 차례로 조준합니다. 두 지점 사이의 수평거리(폭)를 구합니다.',
    refSteps: ['A 지점 기저부', 'B 지점 기저부'],
    extraLabel: (i) => `${String.fromCharCode(65 + i)} 지점 기저부`,
    usesSlope: true
  },
  staff: {
    label: '기준 높이법',
    short: '높이를 아는 물체',
    desc: '높이를 아는 표척·폴의 하단과 상단을 조준해 수평거리를 구합니다. 경사지에서도 사용할 수 있습니다.',
    refSteps: ['기준물 하단', '기준물 상단'],
    extraLabel: (i) => `지점 ${i + 1}`,
    advanced: true
  },
  known: {
    label: '거리 입력법',
    short: '거리를 아는 경우',
    desc: '줄자·도면으로 확인한 수평거리를 입력하고, 조준한 지점의 높이차·사거리를 구합니다.',
    refSteps: [],
    extraLabel: (i) => `지점 ${i + 1}`,
    advanced: true
  },
  ar: {
    label: 'AR 측정',
    short: '10 m 이내 정밀',
    desc: '카메라가 지면·벽 등 표면을 인식해 A·B 두 점 사이를 측정합니다. 표적까지 걸어가며 표면을 계속 비추면 10 m 내외에서 가장 정확합니다.',
    refSteps: [],
    extraLabel: () => '',
    hidden: true
  },
  calib: {
    label: '카메라 높이 보정',
    short: '보정',
    desc: '거리를 아는 지점의 바닥을 조준해 평소 자세의 카메라 높이를 역산합니다.',
    refSteps: ['거리를 아는 지점의 바닥'],
    extraLabel: () => '',
    hidden: true
  }
};

/* ---------- 결과 연산 ---------- */

const CARD_LABELS = {
  horizontal: '수평거리', slope: '사거리', heightDiff: '높이차',
  width: 'A–B 간격', total: '총 길이', dA: 'A 수평거리', dB: 'B 수평거리', cameraHeight: '카메라 높이',
  grade: '경사도'
};

// 결과 항목 단위: 경사도는 %, 나머지는 m
export const CARD_UNITS = { grade: '%' };
export const cardUnit = (k) => CARD_UNITS[k] || 'm';
export const fmtCard = (k, v, digits = 2) => (v == null || !isFinite(v)) ? '-' : `${fmtNum(v, k === 'grade' ? 1 : digits)} ${cardUnit(k)}`;
// 경사도(%) → 경사각(°)
export const gradeToDeg = (pct) => Math.atan(pct / 100) * DEG;

// 연직선 위 지점들(같은 수평거리 D)의 결과
const verticalPoints = (D, shots, h, nRef) => {
  const base = shots[0];
  const points = shots.map((s, i) => {
    const fromEye = D * tan(s.elev);
    const fromGround = h > 0 ? h + fromEye : null;
    return {
      ...s, isRef: i < nRef, horizontal: D,
      grade: ((fromGround ?? fromEye) / D) * 100,  // 관측자 발밑(카메라 높이 미입력 시 카메라) → 지점 경사도
      slope: D / Math.cos(s.elev * RAD),
      fromEye,
      fromGround,
      fromBase: D * (tan(s.elev) - tan(base.elev))
    };
  });
  const last = points[points.length - 1];
  const multi = points.length > 1;
  return {
    points,
    summary: {
      horizontal: D,
      slope: last.slope,
      heightDiff: multi ? last.fromBase : (last.fromGround ?? last.fromEye),
      grade: last.grade
    },
    basis: multi ? `${base.label} → ${last.label}` : (last.fromGround != null ? '관측자 발밑 → 지점' : '카메라 → 지점'),
    cards: ['horizontal', 'slope', 'heightDiff', 'grade']
  };
};

// 지면 기준 수평거리: 발밑에서 표적까지 지면이 일정 경사(slopeDeg, 오르막 +)라고 가정
const groundDistance = (h, elev, slopeDeg = 0) => {
  const denom = tan(slopeDeg) - tan(elev);
  return denom > tan(1) ? h / denom : null;
};

// shots: [{ elev, yaw?, label }]
export const solve = (mode, shots, params) => {
  const h = Number(params.cameraHeight);
  const H = Number(params.refHeight);
  const slopeDeg = Number(params.groundSlope) || 0;
  const M = MODES[mode];
  const nRef = M.refSteps.length;
  const withLabels = (res) => ({ ...res, cardLabels: CARD_LABELS });

  if (mode === 'ground') {
    if (!shots[0]) return { error: '기저부 촬영이 필요합니다.' };
    if (!(h > 0)) return { error: '카메라 높이를 입력해 주십시오.' };
    const D = groundDistance(h, shots[0].elev, slopeDeg);
    if (D == null) return { error: '기저부가 수평선에 너무 가깝습니다(1° 미만). 표적이 너무 멀거나 지면 경사 보정이 맞지 않습니다.' };
    return withLabels({ D, ...verticalPoints(D, shots, h, nRef) });
  }

  if (mode === 'move') {
    if (shots.length < 2) return { error: '두 위치에서 같은 지점을 촬영해야 합니다.' };
    const b = Number(params.baseline);
    if (!(b > 0)) return { error: '이동 거리를 입력해 주십시오.' };
    const t1 = tan(shots[0].elev), t2 = tan(shots[1].elev);
    if (Math.abs(shots[0].elev) < 1) return { error: '표적 지점이 눈높이와 너무 가깝습니다. 더 높거나 낮은 지점을 조준해 주십시오.' };
    if (Math.abs(t2 - t1) < 0.005) return { error: '두 위치의 앙각 차이가 너무 작습니다. 더 많이 이동해 주십시오.' };
    const D = b * t1 / (t2 - t1); // 2차 위치 → 표적 수평거리
    if (!(D > 0)) return { error: '앙각 변화가 이동 방향과 맞지 않습니다. 표적 쪽으로 이동했는지, 같은 지점을 조준했는지 확인해 주십시오.' };
    const res = verticalPoints(D, shots.slice(1), h, 1);
    res.points = [{ ...shots[0], isRef: true, station1: true, horizontal: D + b, slope: (D + b) / Math.cos(shots[0].elev * RAD), fromEye: null, fromGround: null, fromBase: null }, ...res.points];
    return withLabels({ D, ...res });
  }

  if (mode === 'width') {
    if (shots.length < 2) return { error: '두 지점 이상 촬영해야 합니다.' };
    if (!(h > 0)) return { error: '카메라 높이를 입력해 주십시오.' };
    if (shots.some(s => s.yaw == null)) return { error: '방향 센서 값이 없어 폭을 계산할 수 없습니다.' };
    const Ds = shots.map(s => groundDistance(h, s.elev, slopeDeg));
    if (Ds.some(d => d == null)) return { error: '기저부가 수평선에 너무 가까운 지점이 있습니다(1° 미만).' };
    const segs = Ds.slice(1).map((d, i) => {
      const d0 = Ds[i], dy = yawDelta(shots[i].yaw, shots[i + 1].yaw) * RAD;
      return Math.sqrt(Math.max(0, d0 * d0 + d * d - 2 * d0 * d * Math.cos(dy)));
    });
    const points = shots.map((s, i) => ({
      ...s, isRef: i < 2, horizontal: Ds[i], slope: Ds[i] / Math.cos(s.elev * RAD),
      fromEye: Ds[i] * tan(s.elev), fromGround: h + Ds[i] * tan(s.elev), fromBase: null,
      segment: i > 0 ? segs[i - 1] : null,
      turn: i > 0 ? yawDelta(shots[i - 1].yaw, s.yaw) : null
    }));
    const summary = { width: segs[0], dA: Ds[0], dB: Ds[1] };
    const cards = ['width', 'dA', 'dB'];
    if (segs.length > 1) { summary.total = segs.reduce((a, b) => a + b, 0); cards.splice(1, 0, 'total'); cards.pop(); }
    return withLabels({ D: Ds[0], points, summary, cards, basis: segs.length > 1 ? '인접 지점 사이 직선 합' : 'A → B 직선' });
  }

  if (mode === 'staff') {
    if (shots.length < 2) return { error: '기준물 하단·상단 촬영이 필요합니다.' };
    if (!(H > 0)) return { error: '기준물 높이를 입력해 주십시오.' };
    const d = tan(shots[1].elev) - tan(shots[0].elev);
    if (d < 0.005) return { error: '상단 앙각이 하단보다 충분히 크지 않습니다. 순서를 확인하거나 더 가까이에서 측정해 주십시오.' };
    const D = H / d;
    return withLabels({ D, ...verticalPoints(D, shots, h, nRef) });
  }

  if (mode === 'known') {
    const D = Number(params.knownDistance);
    if (!(D > 0)) return { error: '수평거리를 입력해 주십시오.' };
    if (!shots.length) return { error: '조준 지점을 1개 이상 촬영해 주십시오.' };
    return withLabels({ D, ...verticalPoints(D, shots, h, nRef) });
  }

  if (mode === 'calib') {
    const D = Number(params.knownDistance);
    if (!(D > 0)) return { error: '기준 거리를 입력해 주십시오.' };
    if (!shots[0]) return { error: '바닥 지점을 촬영해 주십시오.' };
    if (shots[0].elev > -1) return { error: '바닥 앙각이 수평에 너무 가깝습니다. 더 가까운 지점으로 보정해 주십시오.' };
    const ch = D * tan(-shots[0].elev);
    return withLabels({ D, points: [{ ...shots[0], isRef: true, horizontal: D, slope: D / Math.cos(shots[0].elev * RAD), fromEye: -ch, fromGround: 0, fromBase: 0 }], summary: { cameraHeight: ch }, cards: ['cameraHeight'], basis: '지면 → 렌즈' });
  }

  return { error: '알 수 없는 측정 방식입니다.' };
};

// 입력 오차가 결과에 미치는 영향(RSS). 앙각 ±sigmaDeg, 방위 ±2·sigmaDeg, 카메라 높이 ±5 cm, 이동 거리 ±3 %, 입력 거리 ±1 %
export const uncertainty = (mode, shots, params, sigmaDeg = 0.5) => {
  const base = solve(mode, shots, params);
  if (base.error) return null;
  const keys = base.cards;
  const acc = Object.fromEntries(keys.map(k => [k, 0]));
  const add = (res) => {
    if (res.error) return;
    keys.forEach(k => { acc[k] += (res.summary[k] - base.summary[k]) ** 2; });
  };
  const perturb = (i, patch) => shots.map((s, j) => (j === i ? { ...s, ...patch(s) } : s));
  shots.forEach((_, i) => {
    add(solve(mode, perturb(i, s => ({ elev: s.elev + sigmaDeg })), params));
    if (mode === 'width') add(solve(mode, perturb(i, s => ({ yaw: s.yaw + sigmaDeg * 2 })), params));
  });
  const p = (patch) => add(solve(mode, shots, { ...params, ...patch }));
  if (['ground', 'width', 'move'].includes(mode)) p({ cameraHeight: Number(params.cameraHeight) + 0.05 });
  if (MODES[mode].usesSlope && Number(params.groundSlope)) p({ groundSlope: Number(params.groundSlope) + sigmaDeg });
  if (mode === 'move') p({ baseline: Number(params.baseline) * 1.03 });
  if (mode === 'known' || mode === 'calib') p({ knownDistance: Number(params.knownDistance) * 1.01 });
  return Object.fromEntries(keys.map(k => [k, Math.sqrt(acc[k])]));
};

/* ---------- AR 측정(WebXR, 좌표 단위 m, Y축이 연직 위) ---------- */

// 두 3차원 점 A→B의 수평거리·사거리·높이차·경사도
export const arMeasure = (a, b) => {
  const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z;
  const horizontal = Math.hypot(dx, dz);
  return {
    horizontal,
    slope: Math.hypot(dx, dy, dz),
    heightDiff: dy,
    grade: horizontal > 1e-6 ? (dy / horizontal) * 100 : null
  };
};

// 점 A를 지나는 연직선과 카메라 광선(o + s·d) 사이의 최근접점 → 표면이 없는 높이(벽 상단·나무 끝) 측정
export const verticalLineRayPoint = (a, o, d) => {
  const n = Math.hypot(d.x, d.y, d.z);
  const dx = d.x / n, dy = d.y / n, dz = d.z / n;
  const denom = 1 - dy * dy;
  if (denom < 1e-4) return null; // 광선이 연직선과 평행
  const w = { x: a.x - o.x, y: a.y - o.y, z: a.z - o.z };
  const e = dx * w.x + dy * w.y + dz * w.z;
  const t = (dy * e - w.y) / denom;
  return { x: a.x, y: a.y + t, z: a.z };
};

// 쿼터니언 회전으로 카메라 정면(−Z) 방향 구하기
export const forwardFromQuaternion = (q) => ({
  x: -2 * (q.x * q.z + q.w * q.y),
  y: -2 * (q.y * q.z - q.w * q.x),
  z: -(1 - 2 * (q.x * q.x + q.y * q.y))
});

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
