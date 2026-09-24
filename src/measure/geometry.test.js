import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cameraElevation, cameraHeading, offsetElevation, solve, uncertainty, destinationPoint } from './geometry.js';

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
  near(cameraElevation(180, 80), 10); // 가로 상태에서 위로 젖힘(β 반전)
});

test('카메라 방위각: 직립 상태 alpha=0 → 북, alpha=90 → 서', () => {
  near(cameraHeading(0, 90, 0), 0);
  near(cameraHeading(90, 90, 0), 270);
  assert.equal(cameraHeading(0, 0, 0), null);
});

test('조준점 보정: 화각 끝 픽셀은 반화각만큼 더해진다', () => {
  near(offsetElevation(0, 960, 1080, 1920, 60), 30);
  near(offsetElevation(5, 0, 1080, 1920, 60), 5);
});

test('지면 기준법: 수평거리·높이·사거리', () => {
  // 카메라 1.5 m, 수평거리 20 m, 표적 높이 6 m
  const shots = [{ elev: elevTo(-1.5, 20), label: '기저부' }, { elev: elevTo(4.5, 20), label: '상단' }];
  const r = solve('ground', shots, { cameraHeight: 1.5 });
  near(r.summary.horizontal, 20);
  near(r.summary.heightDiff, 6);
  near(r.summary.slope, Math.hypot(20, 4.5));
  near(r.points[1].fromGround, 6);
});

test('기준 높이법: 경사지(표적 기저부가 3 m 낮음)', () => {
  // 수평거리 35 m, 표척 2 m, 표척 하단은 카메라보다 4.5 m 아래
  const shots = [{ elev: elevTo(-4.5, 35), label: '하단' }, { elev: elevTo(-2.5, 35), label: '상단' }, { elev: elevTo(3, 35), label: '댐마루' }];
  const r = solve('staff', shots, { refHeight: 2, cameraHeight: 1.5 });
  near(r.summary.horizontal, 35);
  near(r.points[0].fromGround, -3);
  near(r.summary.heightDiff, 7.5);
});

test('수평거리 입력법: 지점 1개면 관측자 지면 기준 높이차', () => {
  const r = solve('known', [{ elev: elevTo(8.5, 50), label: 'A' }], { knownDistance: 50, cameraHeight: 1.5 });
  near(r.summary.heightDiff, 10);
  near(r.summary.slope, Math.hypot(50, 8.5));
});

test('오류 처리', () => {
  assert.ok(solve('ground', [{ elev: -0.5 }], { cameraHeight: 1.5 }).error);
  assert.ok(solve('staff', [{ elev: -3 }, { elev: -3 }], { refHeight: 2 }).error);
  assert.ok(solve('known', [], { knownDistance: 10 }).error);
});

test('오차 추정: 먼 표적일수록 수평거리 오차가 커진다', () => {
  const u = (d) => uncertainty('ground', [{ elev: elevTo(-1.5, d) }], { cameraHeight: 1.5 }).horizontal;
  assert.ok(u(40) > u(10) * 4);
});

test('표적 좌표: 북쪽 1 km', () => {
  const p = destinationPoint(35, 128, 0, 1000);
  near(p.lng, 128);
  near((p.lat - 35) * 111195, 1000, 1);
});
