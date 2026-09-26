import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cameraElevation, cameraHeading, deviceLongAxisSlope, yawDelta, effectiveFov, offsetElevation,
  solve, uncertainty, destinationPoint, fmtCard, gradeToDeg
} from './geometry.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const elevTo = (dy, dx) => Math.atan2(dy, dx) * 180 / Math.PI;

test('카메라 앙각: 세로 직립 0°, 평면 −90°, 뒤로 젖힘 +', () => {
  near(cameraElevation(90, 0), 0);
  near(cameraElevation(0, 0), -90);
  near(cameraElevation(100, 0), 10);
  near(cameraElevation(80, 0), -10);
});

test('카메라 앙각: 가로 방향·롤에도 광축 기준으로 계산', () => {
  near(cameraElevation(0, 90), 0);
  near(cameraElevation(0, 80), -10);
  near(cameraElevation(180, 80), 10);
});

test('카메라 방위: 직립 alpha=0 → 0°, alpha=90 → 270°, 연직 조준은 불확정', () => {
  near(cameraHeading(0, 90, 0), 0);
  near(cameraHeading(90, 90, 0), 270);
  assert.equal(cameraHeading(0, 0, 0), null);
});

test('보조 함수: 긴 축 경사, 방위 차, 줌 화각, 조준점 보정', () => {
  near(deviceLongAxisSlope(12), 12);
  near(deviceLongAxisSlope(-7), -7);
  near(yawDelta(350, 10), 20);
  near(yawDelta(10, 350), -20);
  near(effectiveFov(60, 1), 60);
  near(effectiveFov(60, 2), 2 * Math.atan(Math.tan(Math.PI / 6) / 2) * 180 / Math.PI);
  near(offsetElevation(0, 960, 1080, 1920, 60), 30);
});

test('높이·거리: 평지', () => {
  const shots = [{ elev: elevTo(-1.5, 20), label: '기저부' }, { elev: elevTo(4.5, 20), label: '상단' }];
  const r = solve('ground', shots, { cameraHeight: 1.5 });
  near(r.summary.horizontal, 20);
  near(r.summary.heightDiff, 6);
  near(r.summary.slope, Math.hypot(20, 4.5));
});

test('높이·거리: 지면 경사 보정(오르막 10°)', () => {
  const D = 25, rise = D * Math.tan(10 * Math.PI / 180);
  const shots = [{ elev: elevTo(rise - 1.5, D), label: '기저부' }, { elev: elevTo(rise - 1.5 + 5, D), label: '상단' }];
  const r = solve('ground', shots, { cameraHeight: 1.5, groundSlope: 10 });
  near(r.summary.horizontal, D);
  near(r.summary.heightDiff, 5);
  near(r.points[0].fromGround, rise);
  // 경사 보정 없이 계산하면 크게 틀린다
  const wrong = solve('ground', shots, { cameraHeight: 1.5 });
  assert.ok(wrong.error || Math.abs(wrong.summary.horizontal - D) > 5);
});

test('이동 측정: 기저부 없이 상단만 두 위치에서 조준', () => {
  // 1차 위치 수평거리 40 m, 10 m 전진, 표적은 눈높이보다 8 m 위
  const shots = [{ elev: elevTo(8, 40), label: '1차' }, { elev: elevTo(8, 30), label: '2차' }];
  const r = solve('move', shots, { baseline: 10, cameraHeight: 1.5 });
  near(r.D, 30);
  near(r.summary.horizontal, 30);
  near(r.summary.heightDiff, 9.5);
  near(r.points[0].horizontal, 40);
});

test('이동 측정: 눈높이 아래 지점, 이동 방향 오류 검출', () => {
  const shots = [{ elev: elevTo(-3, 40), label: '1차' }, { elev: elevTo(-3, 30), label: '2차' }];
  near(solve('move', shots, { baseline: 10, cameraHeight: 1.5 }).D, 30);
  assert.ok(solve('move', [shots[1], shots[0]], { baseline: 10, cameraHeight: 1.5 }).error);
});

test('폭·간격: 두 지점 사이 거리(코사인 법칙)', () => {
  // A: 20 m 정면, B: 30 m 오른쪽 60°
  const shots = [{ elev: elevTo(-1.5, 20), yaw: 350, label: 'A' }, { elev: elevTo(-1.5, 30), yaw: 50, label: 'B' }];
  const r = solve('width', shots, { cameraHeight: 1.5 });
  near(r.summary.width, Math.sqrt(400 + 900 - 2 * 20 * 30 * 0.5));
  near(r.summary.dA, 20);
  assert.ok(solve('width', [{ elev: -5 }, { elev: -5 }], { cameraHeight: 1.5 }).error);
});

test('경사도(%): 관측자 발밑 → 지점, 단위 표기', () => {
  // 수평 10 m, 발밑 대비 +2.5 m → 25 %
  const r = solve('known', [{ elev: elevTo(1, 10), label: 'A' }], { knownDistance: 10, cameraHeight: 1.5 });
  near(r.summary.grade, 25);
  near(gradeToDeg(100), 45);
  assert.equal(fmtCard('grade', 25), '25.0 %');
  assert.equal(fmtCard('horizontal', 10), '10.00 m');
  // 평지 높이 측정: 발밑 → 상단 6 m / 20 m = 30 %
  const g = solve('ground', [{ elev: elevTo(-1.5, 20) }, { elev: elevTo(4.5, 20) }], { cameraHeight: 1.5 });
  near(g.summary.grade, 30);
  assert.deepEqual(g.cards, ['horizontal', 'slope', 'heightDiff', 'grade']);
});

test('기준 높이법·거리 입력법', () => {
  const s = [{ elev: elevTo(-4.5, 35), label: '하단' }, { elev: elevTo(-2.5, 35), label: '상단' }, { elev: elevTo(3, 35), label: '댐마루' }];
  const r = solve('staff', s, { refHeight: 2, cameraHeight: 1.5 });
  near(r.summary.horizontal, 35);
  near(r.summary.heightDiff, 7.5);
  const k = solve('known', [{ elev: elevTo(8.5, 50), label: 'A' }], { knownDistance: 50, cameraHeight: 1.5 });
  near(k.summary.heightDiff, 10);
});

test('카메라 높이 보정: 10 m 바닥 조준으로 1.45 m 역산', () => {
  const r = solve('calib', [{ elev: elevTo(-1.45, 10) }], { knownDistance: 10 });
  near(r.summary.cameraHeight, 1.45);
});

test('오류 처리', () => {
  assert.ok(solve('ground', [{ elev: -0.5 }], { cameraHeight: 1.5 }).error);
  assert.ok(solve('staff', [{ elev: -3 }, { elev: -3 }], { refHeight: 2 }).error);
  assert.ok(solve('known', [], { knownDistance: 10 }).error);
  assert.ok(solve('move', [{ elev: 5 }], { baseline: 10 }).error);
});

test('오차 추정: 먼 표적일수록 수평거리 오차가 커진다', () => {
  const u = (d) => uncertainty('ground', [{ elev: elevTo(-1.5, d) }], { cameraHeight: 1.5 }).horizontal;
  assert.ok(u(40) > u(10) * 4);
  const w = uncertainty('width', [{ elev: elevTo(-1.5, 20), yaw: 0 }, { elev: elevTo(-1.5, 20), yaw: 30 }], { cameraHeight: 1.5 });
  assert.ok(w.width > 0);
});

test('표적 좌표: 북쪽 1 km', () => {
  const p = destinationPoint(35, 128, 0, 1000);
  near(p.lng, 128);
  near((p.lat - 35) * 111195, 1000, 1);
});
