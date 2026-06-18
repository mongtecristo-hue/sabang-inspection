import React, { useState, useEffect, useMemo } from 'react';
import * as XLSX from 'xlsx';
import {
  Camera, Download, ClipboardList, AlertTriangle, Layers, Home, Info, ShieldCheck,
  CheckSquare, ChevronLeft, ChevronRight, UserCircle, Map, AlertOctagon, Plus, Trash2,
  FileSpreadsheet, Database, Upload, Bell, CalendarClock
} from 'lucide-react';

/* =========================================================================
   사방시설 외관점검 조사 시스템
   - 산림청고시 제2018-27호 「사방시설의 유지관리 지침」 별표 7~10 외관점검 조사서
   - 별표 4 사방댐준설 대상지 평가표 / 별표 7 외관점검 등급판정 및 점검주기 반영
   ========================================================================= */

const GYEONGNAM_CITIES = [
  '남해군', '사천시', '창원시', '진주시', '통영시', '김해시', '밀양시', '거제시', '양산시',
  '의령군', '함안군', '창녕군', '고성군', '하동군', '산청군', '함양군', '거창군', '합천군'
];

const DAM_TYPES = [
  '콘크리트댐', '큰돌댐', '콘크리트 큰돌댐', '콘크리트 흙댐',
  '버트리스 댐', '슬릿댐', '콘크리트 H빔댐', '테트라포트댐', '기타'
];

const SAFETY_KEYS = [
  { id: 'signStone', label: '표지석' },
  { id: 'infoBoard', label: '안내간판' },
  { id: 'warnBoard', label: '경고판' },
  { id: 'fence', label: '안전휀스' },
  { id: 'natlPoint', label: '국가 지점 번호판' }
];

// 별표 7 외관점검 등급판정 → 등급별 점검주기
const GRADE_CYCLE = {
  '양호': '2년 주기 외관점검',
  '관찰필요': '1년 주기 외관점검 또는 필요시 정밀점검',
  '불량': '당해 또는 차년도 정밀점검'
};

// 별표 7~10 주요시설 부재별 결함 항목(중복체크)
const DEFECT_CONFIG = {
  '사방댐': [
    { key: 'damMain', label: '본댐', defects: ['파손', '변위', '변형', '균열', '누수', '기초부 세굴', '물받이 유탈', '콘크리트 박리·박락·백화·마모', '석재 유실·이격·풍화', '강재 접합부·부식·도장손실', '방수로 파손·마모'] },
    { key: 'damWall', label: '측벽', defects: ['파손', '변위', '변형', '균열', '누수', '기초부 세굴', '물받이 유탈'] },
    { key: 'damApron', label: '물받이', defects: ['파손', '변위', '변형', '균열', '누수', '기초부 세굴', '수직벽(앞댐) 유탈'] },
  ],
  '계류보전': [
    { key: 'streamCheck', label: '골막이', defects: ['파손', '변위', '변형', '균열', '기초부 세굴', '석재 유실·이격·풍화', '돌망태 철선 등 부속시설 손실', '채움콘크리트 열화·이탈'] },
    { key: 'streamRevetment', label: '기슭막이', defects: ['파손', '변위', '변형', '균열', '기초부 세굴', '석재 유실·이격·풍화', '돌망태 철선 등 부속시설 손실', '채움콘크리트 열화·이탈'] },
    { key: 'streamBed', label: '바닥막이', defects: ['파손', '변위', '변형', '균열', '기초부 세굴', '석재 유실·이격·풍화', '돌망태 철선 등 부속시설 손실', '채움콘크리트 열화·이탈'] },
  ],
  '산지사방': [
    { key: 'mountainRetaining', label: '보강시설(옹벽·돌붙임 등)', defects: ['파손', '변위', '변형', '균열', '누수', '기초부 세굴', '물받이 유탈', '콘크리트 박리·박락·백화·마모', '석재 유실·이격·풍화', '목재 유실·마모·부식'] },
    { key: 'mountainProtection', label: '보호시설(낙석방지 등)', defects: ['낙석방지망 파손·변형', '낙석방지울타리 파손·변형', '콘크리트 기초 파손·변형'] },
    { key: 'mountainDrainage', label: '배수시설', defects: ['산마루측구', '종배수구', '소단배수로', '수평배수공', '집수정 상태'] },
  ],
  '해안사방': [
    { key: 'coastFence', label: '주요 구조물(방재시설·울타리)', defects: ['파손', '유실', '변위', '변형', '마모', '부식', '체결부 등 부속시설'] },
  ]
};

// 결함 중복체크 외에 등급만 판정하는 부재
const EXTRA_GRADE_MEMBERS = {
  '사방댐': [{ key: 'damGate', label: '수문 상태 (배수관 막힘·도장 등)' }],
  '계류보전': [{ key: 'streamCondition', label: '계류 상태 (침식·붕괴·전석·퇴적 등)' }],
  '산지사방': [{ key: 'mountainSlope', label: '사면 상태 (땅밀림·붕괴·표층유실 등)' }],
  '해안사방': [
    { key: 'coastForest', label: '방재림 생육·활착 상태' },
    { key: 'coastDune', label: '사구 지형 안정 상태' },
    { key: 'coastErosion', label: '해안 침식 정도' },
  ]
};

// 공정별 18장 사진 대지 라벨
const PHOTO_LABELS = {
  '사방댐': ['원경', '근경', '대수면', '반수면', '측면', '측벽 좌', '측벽 우', '물받이', '배수공', '바닥막이', '기슭막이', '녹화 상태', '표지석', '안전 시설물', '점검 사항1', '점검 사항2', '점검 사항3', '점검 사항4'],
  '계류보전': ['상류 전경', '하류 전경', '진입로 전경', '골막이', '기슭막이', '바닥막이', '물받이', '계류 상태', '녹화 상태', '배수 구역', '부대 시설', '구조물 전경', '점검 사항1', '점검 사항2', '점검 사항3', '점검 사항4', '사진 17', '사진 18'],
  '산지사방': ['원경', '근경', '사면 전경', '보강시설', '보호시설', '배수공', '사면 녹화', '편축 옹벽', '돌붙임 수로', '식생 수로', '표지석', '안전 시설물', '점검 사항1', '점검 사항2', '점검 사항3', '점검 사항4', '사진 17', '사진 18'],
  '해안사방': ['원경', '근경', '방재림 전경', '모래막이 울타리', '퇴사울 울타리', '방사울 정면', '식생 생육', '사구 전경', '정면 정경', '배면 정경', '표지석', '안전 시설물', '점검 사항1', '점검 사항2', '점검 사항3', '점검 사항4', '사진 17', '사진 18']
};

/* ---------------- 좌표 / 국가지점번호 / 유틸 ---------------- */
const wgs84ToUtmk = (lat, lng) => {
  const a = 6378137.0, f = 1 / 298.257222101, k0 = 0.9996;
  const lon0 = 127.5 * Math.PI / 180, lat0 = 38.0 * Math.PI / 180;
  const x0 = 1000000.0, y0 = 2000000.0;
  const latRad = lat * Math.PI / 180, lonRad = lng * Math.PI / 180;
  const e2 = 2 * f - f * f, e4 = e2 * e2, e6 = e4 * e2;
  const m = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * latRad - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * latRad) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * latRad) - (35 * e6 / 3072) * Math.sin(6 * latRad));
  const m0 = a * ((1 - e2 / 4 - 3 * e4 / 64 - 5 * e6 / 256) * lat0 - (3 * e2 / 8 + 3 * e4 / 32 + 45 * e6 / 1024) * Math.sin(2 * lat0) + (15 * e4 / 256 + 45 * e6 / 1024) * Math.sin(4 * lat0) - (35 * e6 / 3072) * Math.sin(6 * lat0));
  const nu = a / Math.sqrt(1 - e2 * Math.sin(latRad) * Math.sin(latRad));
  const p = lonRad - lon0, sinLat = Math.sin(latRad), cosLat = Math.cos(latRad), tanLat = Math.tan(latRad);
  const ep2 = e2 / (1 - e2), c = ep2 * cosLat * cosLat, t = tanLat * tanLat, p2 = p * p;
  const x = x0 + k0 * nu * p * cosLat * (1 + p2 / 6 * cosLat * cosLat * (1 - t + c) + p2 * p2 / 120 * Math.pow(cosLat, 4) * (5 - 18 * t + t * t + 72 * c - 58 * ep2));
  const y = y0 + k0 * (m - m0 + nu * sinLat * p2 / 2 * cosLat * (1 + p2 / 12 * cosLat * cosLat * (5 - t + 9 * c + 4 * c * c) + p2 * p2 / 360 * Math.pow(cosLat, 4) * (61 - 58 * t + t * t + 600 * c - 330 * ep2)));
  return { x, y };
};

const getNationalPointNumber = (lat, lng) => {
  if (!lat || !lng) return '';
  const { x, y } = wgs84ToUtmk(parseFloat(lat), parseFloat(lng));
  const chars = ['가', '나', '다', '라', '마', '바', '사', '아', '자', '차', '카', '타', '파', '하'];
  const xIdx = Math.floor(x / 100000) - 7, yIdx = Math.floor(y / 100000) - 13;
  if (xIdx < 0 || xIdx >= chars.length || yIdx < 0 || yIdx >= chars.length) return '영역 외';
  return `${chars[xIdx]}${chars[yIdx]} ${Math.floor((x % 100000) / 10).toString().padStart(4, '0')} ${Math.floor((y % 100000) / 10).toString().padStart(4, '0')}`;
};

const formatDMS = (decimal, isLat) => {
  if (!decimal) return '';
  const val = Math.abs(parseFloat(decimal)), d = Math.floor(val), m = Math.floor((val - d) * 60), s = ((val - d - m / 60) * 3600).toFixed(1);
  return `${d}° ${m}′ ${s}″ ${isLat ? (parseFloat(decimal) >= 0 ? 'N' : 'S') : (parseFloat(decimal) >= 0 ? 'E' : 'W')}`;
};

const sanitizeFileName = (text) => (text || '').toString().replace(/[\/\\?%*:|"<>\s]/g, '_');

// 공정별 시설년도 키
const yearKeyOf = (type) => type === '사방댐' ? 'specDamYear' : type === '계류보전' ? 'specStreamYear' : 'specYear';

const getInitialFormState = (type = '사방댐', g = { inspector: '', siGun: '남해군' }) => {
  const labels = PHOTO_LABELS[type] || PHOTO_LABELS['사방댐'];
  return {
    siGun: g.siGun, eupMyeon: '', riDong: '', jibun: '', sokching: '',
    inspector: g.inspector, facilityType: type, facilityName: '', date: new Date().toISOString().split('T')[0],
    locMainLat: '', locMainLng: '', locEndLat: '', locEndLng: '', natlPointNumber: '', refLocations: [],
    // 제원
    specForm: '계단상 떼붙임 공법',
    specDamYear: '', specDamType: '콘크리트댐', specDamTopLen: '', specDamBottomLen: '', specDamHeight: '', specDamTotalHeight: '', specDamSpillwayWidth: '',
    specStreamYear: '', specStreamWidth: '', specStreamLength: '', specStreamDepth: '',
    specStreamCheckDamType: '큰돌댐', specStreamCheckDamTopLen: '', specStreamCheckDamBottomLen: '', specStreamCheckDamHeight: '', specStreamCheckDamTotalHeight: '', specStreamCheckDamSpillwayWidth: '',
    specYear: '', specMountainArea: '', specMountainSlope: '', specMountainHeight: '', specMountainLength: '',
    specCoastLength: '', specCoastWidth: '', specCoastArea: '', specCoastType: '해송',
    // 점검 등급
    inspections: {
      damMain: '양호', damWall: '양호', damApron: '양호', damGate: '양호',
      streamCheck: '양호', streamRevetment: '양호', streamBed: '양호', streamCondition: '양호',
      mountainRetaining: '양호', mountainProtection: '양호', mountainDrainage: '양호', mountainSlope: '양호',
      coastFence: '양호', coastForest: '양호', coastDune: '양호', coastErosion: '양호'
    },
    defects: {},                 // { memberKey: [선택 결함...] }
    damSiltLevel: '저',          // 별표7 저사상태 저/중/고
    precisionInspected: false,   // 정밀점검 이력 (사방댐 20년 규정용)
    dredging: { factor1: 1.0, factor2: 1.0, factor3: 1.0, factor4: 1.0, totalScore: '0.0', isRequired: false },
    ancillary: { vegetation: '양호', road: '양호', etc: '양호' },
    safetyItems: { signStone: false, infoBoard: false, warnBoard: false, fence: false, natlPoint: false },
    safetyFenceQuantity: '',
    overallNotes: '', finalResult: '양호', actionRequired: '', releaseStatus: '유지',
    photos: Array.from({ length: 18 }, (_, i) => ({ id: i, label: labels[i] || `사진 ${i + 1}`, dataUrl: null }))
  };
};

const computeYearsElapsed = (year, date) => {
  if (!year) return null;
  const base = date ? new Date(date).getFullYear() : new Date().getFullYear();
  const y = parseInt(year, 10);
  if (isNaN(y)) return null;
  return base - y;
};

/* ---------------- 모듈 레벨 컴포넌트 (포커스 유실 방지) ---------------- */
const InputField = ({ label, value, onChange, type = 'text', placeholder = '' }) => (
  <div>
    <label className="block text-[11px] font-bold text-slate-500 mb-1">{label}</label>
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 font-medium" />
  </div>
);

const RadioGroup = ({ label, value, onChange, options }) => (
  <div className="mb-3">
    <label className="block text-[12px] font-bold text-slate-700 mb-2">{label}</label>
    <div className="flex gap-2">
      {options.map(opt => (
        <button key={opt} onClick={() => onChange(opt)}
          className={`flex-1 py-2 text-xs font-bold border rounded transition-colors ${value === opt ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-300'}`}>
          {opt}
        </button>
      ))}
    </div>
  </div>
);

const DefectChips = ({ items, selected, onToggle }) => (
  <div className="flex flex-wrap gap-1.5 mt-1.5 mb-2">
    {items.map(d => {
      const on = selected.includes(d);
      return (
        <button key={d} onClick={() => onToggle(d)}
          className={`px-2 py-1 rounded-full text-[10px] font-bold border transition-colors ${on ? 'bg-rose-500 text-white border-rose-500' : 'bg-white text-slate-400 border-slate-300'}`}>
          {d}
        </button>
      );
    })}
  </div>
);

/* ============================== App ============================== */
const App = () => {
  const [db, setDb] = useState([]);
  const [currentView, setCurrentView] = useState('home');
  const [activeTab, setActiveTab] = useState('list');
  const [photoPage, setPhotoPage] = useState(1);
  const [globalSettings, setGlobalSettings] = useState({ inspector: '', siGun: '남해군' });
  const [toast, setToast] = useState({ visible: false, message: '', type: 'info' });
  const [formData, setFormData] = useState(() => getInitialFormState('사방댐', { inspector: '', siGun: '남해군' }));

  const showToast = (message, type = 'info') => {
    setToast({ visible: true, message, type });
    setTimeout(() => setToast(prev => ({ ...prev, visible: false })), 3200);
  };

  // 모의 DB 초기화
  useEffect(() => {
    setDb([
      {
        siGun: '남해군', eupMyeon: '서면', riDong: '중현리', jibun: '1548구', sokching: '중현계곡',
        inspector: '박순영', facilityType: '사방댐', facilityName: '1688', date: '2026-03-29',
        locMainLat: '34.867778', locMainLng: '127.853889', locEndLat: '', locEndLng: '', natlPointNumber: getNationalPointNumber('34.867778', '127.853889'),
        refLocations: [], specDamYear: '1994', specDamType: '큰돌댐', specDamTopLen: '23', specDamBottomLen: '13.5', specDamHeight: '2.5', specDamTotalHeight: '3.5', specDamSpillwayWidth: '5',
        inspections: { damMain: '양호', damWall: '양호', damApron: '양호', damGate: '양호' },
        defects: {}, damSiltLevel: '중', precisionInspected: false,
        dredging: { factor1: 1.6, factor2: 1.6, factor3: 1.0, factor4: 1.0, totalScore: '12.7', isRequired: false },
        ancillary: { vegetation: '양호', road: '양호', etc: '양호' },
        safetyItems: { signStone: true, infoBoard: true, warnBoard: true, fence: true, natlPoint: true }, safetyFenceQuantity: '30',
        overallNotes: '1994년 시설된 큰돌 댐으로 본댐·측벽 상태 전반 양호. 준공 20년 이상 경과·정밀점검 미실시로 정밀점검 대상.', finalResult: '양호', actionRequired: '', releaseStatus: '유지',
        photos: Array.from({ length: 18 }, (_, i) => ({ id: i, label: PHOTO_LABELS['사방댐'][i], dataUrl: null }))
      },
      {
        siGun: '남해군', eupMyeon: '남해읍', riDong: '아산리', jibun: '1417-13', sokching: '아산천',
        inspector: '박순영', facilityType: '계류보전', facilityName: 'R01', date: '2026-04-25',
        locMainLat: '34.842111', locMainLng: '127.915241', locEndLat: '34.843105', locEndLng: '127.916110', natlPointNumber: getNationalPointNumber('34.842111', '127.915241'),
        refLocations: [], specStreamYear: '1973', specStreamWidth: '10', specStreamLength: '200', specStreamDepth: '1.5',
        specStreamCheckDamType: '큰돌댐', specStreamCheckDamTopLen: '12', specStreamCheckDamBottomLen: '4', specStreamCheckDamHeight: '1.8', specStreamCheckDamTotalHeight: '2.4', specStreamCheckDamSpillwayWidth: '3',
        inspections: { streamCheck: '관찰필요', streamRevetment: '양호', streamBed: '양호', streamCondition: '양호' },
        defects: { streamCheck: ['변형', '기초부 세굴'] }, damSiltLevel: '저', precisionInspected: false,
        dredging: { factor1: 1.0, factor2: 1.0, factor3: 1.0, factor4: 1.0, totalScore: '0.0', isRequired: false },
        ancillary: { vegetation: '양호', road: '양호', etc: '양호' },
        safetyItems: { signStone: false, infoBoard: false, warnBoard: true, fence: false, natlPoint: false }, safetyFenceQuantity: '',
        overallNotes: '골막이 변형 경미하나 세굴 발달 가능성 관찰됨.', finalResult: '관찰필요', actionRequired: '보수', releaseStatus: '유지',
        photos: Array.from({ length: 18 }, (_, i) => ({ id: i, label: PHOTO_LABELS['계류보전'][i], dataUrl: null }))
      },
      {
        siGun: '남해군', eupMyeon: '이동면', riDong: '신전리', jibun: '산45-1', sokching: '망운산구역',
        inspector: '박순영', facilityType: '산지사방', facilityName: 'M01', date: '2026-05-12',
        locMainLat: '34.811245', locMainLng: '127.934125', locEndLat: '', locEndLng: '', natlPointNumber: getNationalPointNumber('34.811245', '127.934125'),
        refLocations: [], specForm: '계단상 떼붙임 공법', specYear: '2015', specMountainArea: '1.2', specMountainSlope: '28', specMountainHeight: '15', specMountainLength: '85',
        inspections: { mountainRetaining: '양호', mountainProtection: '양호', mountainDrainage: '양호', mountainSlope: '양호' },
        defects: {}, damSiltLevel: '저', precisionInspected: false,
        dredging: { factor1: 1.0, factor2: 1.0, factor3: 1.0, factor4: 1.0, totalScore: '0.0', isRequired: false },
        ancillary: { vegetation: '양호', road: '양호', etc: '양호' },
        safetyItems: { signStone: true, infoBoard: false, warnBoard: false, fence: false, natlPoint: false }, safetyFenceQuantity: '',
        overallNotes: '떼공법 사면 활착 양호, 상부 배수로 토사 누적 없음.', finalResult: '양호', actionRequired: '', releaseStatus: '유지',
        photos: Array.from({ length: 18 }, (_, i) => ({ id: i, label: PHOTO_LABELS['산지사방'][i], dataUrl: null }))
      },
      {
        siGun: '남해군', eupMyeon: '삼동면', riDong: '물건리', jibun: '동지해안가', sokching: '방조어부림배후지',
        inspector: '박순영', facilityType: '해안사방', facilityName: 'C01', date: '2026-05-18',
        locMainLat: '34.799412', locMainLng: '128.041245', locEndLat: '34.800512', locEndLng: '128.042512', natlPointNumber: getNationalPointNumber('34.799412', '128.041245'),
        refLocations: [], specForm: '해안방재림 식재 및 정사 울타리 공법', specYear: '2018', specCoastLength: '500', specCoastWidth: '30', specCoastArea: '15000', specCoastType: '해송',
        inspections: { coastFence: '양호', coastForest: '관찰필요', coastDune: '양호', coastErosion: '양호' },
        defects: {}, damSiltLevel: '저', precisionInspected: false,
        dredging: { factor1: 1.0, factor2: 1.0, factor3: 1.0, factor4: 1.0, totalScore: '0.0', isRequired: false },
        ancillary: { vegetation: '양호', road: '양호', etc: '양호' },
        safetyItems: { signStone: true, infoBoard: true, warnBoard: false, fence: false, natlPoint: true }, safetyFenceQuantity: '',
        overallNotes: '해풍에 의한 외곽 방재림 일부 고사목 발견되어 보수 요망.', finalResult: '관찰필요', actionRequired: '보수', releaseStatus: '유지',
        photos: Array.from({ length: 18 }, (_, i) => ({ id: i, label: PHOTO_LABELS['해안사방'][i], dataUrl: null }))
      }
    ]);
  }, []);

  /* ---------- 시작/전환 ---------- */
  const startNewInspection = () => {
    if (!globalSettings.inspector) { showToast('점검 책임자 성명을 먼저 입력해 주십시오.', 'error'); return; }
    setFormData(getInitialFormState(formData.facilityType || '사방댐', globalSettings));
    setPhotoPage(1);
    setCurrentView('form');
  };

  const handleFacilityTypeChangeOnForm = (type) => {
    const labels = PHOTO_LABELS[type] || PHOTO_LABELS['사방댐'];
    setFormData(prev => ({
      ...prev,
      facilityType: type,
      defects: {},
      photos: prev.photos.map((p, i) => ({ ...p, label: labels[i] || `사진 ${i + 1}` }))
    }));
  };

  /* ---------- 준설 총점(별표4) ---------- */
  useEffect(() => {
    if (formData.facilityType === '사방댐') {
      const f = formData.dredging;
      const score = parseFloat(f.factor1) * 3.4 + parseFloat(f.factor2) * 2.8 + parseFloat(f.factor3) * 1.6 + parseFloat(f.factor4) * 1.2;
      setFormData(prev => ({ ...prev, dredging: { ...prev.dredging, totalScore: score.toFixed(1), isRequired: score >= 17.0 } }));
    }
  }, [formData.dredging.factor1, formData.dredging.factor2, formData.dredging.factor3, formData.dredging.factor4, formData.facilityType]);

  /* ---------- 국가지점번호 ---------- */
  useEffect(() => {
    setFormData(prev => ({ ...prev, natlPointNumber: (prev.locMainLat && prev.locMainLng) ? getNationalPointNumber(prev.locMainLat, prev.locMainLng) : '' }));
  }, [formData.locMainLat, formData.locMainLng]);

  /* ---------- 위치 / 참고좌표 ---------- */
  const handleGetLocation = (target) => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setFormData(p => ({ ...p, [target === 'main' ? 'locMainLat' : 'locEndLat']: pos.coords.latitude.toFixed(6), [target === 'main' ? 'locMainLng' : 'locEndLng']: pos.coords.longitude.toFixed(6) }));
          showToast('GPS 정밀 좌표를 수신했습니다.', 'success');
        },
        () => {
          setFormData(p => ({ ...p, [target === 'main' ? 'locMainLat' : 'locEndLat']: '34.867778', [target === 'main' ? 'locMainLng' : 'locEndLng']: '127.853889' }));
          showToast('환경 제약으로 남해군 표준 모의 좌표를 주입했습니다.', 'info');
        }
      );
    } else {
      showToast('이 장치는 좌표 수신을 지원하지 않습니다.', 'error');
    }
  };

  const addRefLocation = () => setFormData(prev => ({ ...prev, refLocations: [...prev.refLocations, { id: Date.now().toString(), label: '', lat: '', lng: '' }] }));
  const removeRefLocation = (id) => setFormData(prev => ({ ...prev, refLocations: prev.refLocations.filter(loc => loc.id !== id) }));
  const updateRefLabel = (id, val) => setFormData(prev => ({ ...prev, refLocations: prev.refLocations.map(l => l.id === id ? { ...l, label: val } : l) }));
  const handleRefLocationGPS = (id) => {
    setFormData(prev => ({ ...prev, refLocations: prev.refLocations.map(loc => loc.id === id ? { ...loc, lat: '34.868112', lng: '127.854201' } : loc) }));
    showToast('참고 좌표를 수신했습니다.', 'success');
  };

  /* ---------- 사진 (타임스탬프 합성, 불변 갱신) ---------- */
  const handleImageChange = (index, e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const MAX_WIDTH = 1280;
        canvas.width = MAX_WIDTH;
        canvas.height = img.height * (MAX_WIDTH / img.width);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

        const now = new Date();
        const dateStr = now.toLocaleDateString('ko-KR');
        const timeStr = now.toLocaleTimeString('ko-KR');
        const facilityText = formData.facilityName ? `[고유 번호] ${formData.facilityName}` : '[고유 번호] 미상';
        const gpsText = (formData.locMainLat && formData.locMainLng) ? `[좌표] N ${formData.locMainLat}, E ${formData.locMainLng}` : '[좌표] 미수신';

        const fontSize = Math.floor(canvas.width * 0.03);
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = '#FFFFFF';
        ctx.textAlign = 'right';
        ctx.textBaseline = 'bottom';
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4; ctx.shadowOffsetX = 2; ctx.shadowOffsetY = 2;
        const padX = canvas.width - 20, padY = canvas.height - 20, lh = fontSize * 1.4;
        ctx.fillText(gpsText, padX, padY);
        ctx.fillText(`${dateStr} ${timeStr}`, padX, padY - lh);
        ctx.fillText(facilityText, padX, padY - lh * 2);

        const url = canvas.toDataURL('image/jpeg', 0.6);
        setFormData(prev => ({ ...prev, photos: prev.photos.map((p, i) => i === index ? { ...p, dataUrl: url } : p) }));
        showToast('이미지 변환·타임스탬프 합성 완료.', 'success');
      };
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  };

  const downloadSinglePhoto = (photo) => {
    if (!photo.dataUrl) { showToast('다운로드 가능한 이미지가 없습니다.', 'error'); return; }
    const link = document.createElement('a');
    link.href = photo.dataUrl;
    link.download = `${sanitizeFileName(formData.siGun || '지역')}-${sanitizeFileName(formData.facilityName || '고유번호')}-${sanitizeFileName(photo.label || '사진')}.jpg`;
    document.body.appendChild(link); link.click(); document.body.removeChild(link);
  };

  /* ---------- 점검/결함/안전 ---------- */
  const updateGrade = (k, v) => setFormData(p => ({ ...p, inspections: { ...p.inspections, [k]: v } }));
  const toggleDefect = (memberKey, d) => setFormData(prev => {
    const cur = prev.defects[memberKey] || [];
    const next = cur.includes(d) ? cur.filter(x => x !== d) : [...cur, d];
    return { ...prev, defects: { ...prev.defects, [memberKey]: next } };
  });
  const toggleSafetyItem = (key) => setFormData(prev => ({
    ...prev,
    safetyItems: { ...prev.safetyItems, [key]: !prev.safetyItems[key] },
    safetyFenceQuantity: (key === 'fence' && prev.safetyItems[key]) ? '' : prev.safetyFenceQuantity
  }));

  const handleFinalResultChange = (result) => {
    let newAction = formData.actionRequired;
    if (result === '양호') newAction = '';
    else if (result === '불량') newAction = '정밀점검';
    else if (result === '관찰필요' && !newAction) newAction = '보수';
    setFormData(prev => ({ ...prev, finalResult: result, actionRequired: newAction }));
  };

  // 주요부재 등급 기준 자동 판정값
  const suggestedResult = useMemo(() => {
    const members = [...(DEFECT_CONFIG[formData.facilityType] || []), ...(EXTRA_GRADE_MEMBERS[formData.facilityType] || [])];
    const grades = members.map(m => formData.inspections[m.key]).filter(Boolean);
    if (grades.includes('불량')) return '불량';
    if (grades.includes('관찰필요')) return '관찰필요';
    return '양호';
  }, [formData.facilityType, formData.inspections]);

  // 시설년도 기반 알림
  const yearsElapsed = computeYearsElapsed(formData[yearKeyOf(formData.facilityType)], formData.date);
  const needReleaseOpinion = yearsElapsed != null && yearsElapsed >= 5;
  const needPrecision20 = formData.facilityType === '사방댐' && yearsElapsed != null && yearsElapsed >= 20 && !formData.precisionInspected;

  const handleSaveToDB = () => {
    if (!formData.facilityName) { showToast('필수 항목인 고유 번호를 확인해 주십시오.', 'error'); return; }
    setDb([...db, formData]);
    showToast('점검 결과가 DB에 등록되었습니다.', 'success');
    setCurrentView('home');
  };

  /* ---------- 엑셀 다중 시트 ---------- */
  const handleExportMultiSheetExcel = () => {
    if (db.length === 0) { showToast('내보낼 검사 기록이 없습니다.', 'error'); return; }
    const wb = XLSX.utils.book_new();

    const summary = [
      ['사방시설 외관 점검 종합 통계 집계표'],
      ['출력 일자: ' + new Date().toLocaleDateString('ko-KR')],
      [],
      ['순번', '관할 시군', '읍면', '리동', '지번', '속칭', '점검자', '시설 종류', '시설명', '점검 일자', '국가 지점 번호', '최종 결과', '점검 주기', '조치 지시', '해제 여부']
    ];
    db.forEach((r, i) => summary.push([
      i + 1, r.siGun, r.eupMyeon, r.riDong, r.jibun, r.sokching, r.inspector, r.facilityType, r.facilityName, r.date,
      r.natlPointNumber, r.finalResult, GRADE_CYCLE[r.finalResult] || '', r.actionRequired || '무조치', r.releaseStatus
    ]));
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '종합 집계표');

    const used = {};
    db.forEach(r => {
      let spec = '';
      if (r.facilityType === '사방댐') spec = `사방댐 / 형식 ${r.specDamType} / 시설년도 ${r.specDamYear || '-'} / 상장 ${r.specDamTopLen}m / 하장 ${r.specDamBottomLen}m / 유효고 ${r.specDamHeight}m / 전고 ${r.specDamTotalHeight}m / 방수로폭 ${r.specDamSpillwayWidth}m`;
      else if (r.facilityType === '계류보전') spec = `계류보전 / 시설년도 ${r.specStreamYear} / 길이 ${r.specStreamLength}m / 폭 ${r.specStreamWidth}m / 깊이 ${r.specStreamDepth}m`;
      else if (r.facilityType === '산지사방') spec = `산지사방 / 공법 ${r.specForm} / 시설년도 ${r.specYear} / 면적 ${r.specMountainArea}ha / 경사 ${r.specMountainSlope}° / 높이 ${r.specMountainHeight}m / 길이 ${r.specMountainLength}m`;
      else if (r.facilityType === '해안사방') spec = `해안사방 / 공법 ${r.specForm} / 시설년도 ${r.specYear} / 연장 ${r.specCoastLength}m / 폭 ${r.specCoastWidth}m / 사구면적 ${r.specCoastArea}㎡ / 수종 ${r.specCoastType}`;

      const memberRows = [];
      const members = [...(DEFECT_CONFIG[r.facilityType] || []), ...(EXTRA_GRADE_MEMBERS[r.facilityType] || [])];
      members.forEach(m => {
        const def = (r.defects && r.defects[m.key]) ? r.defects[m.key].join(', ') : '';
        memberRows.push([`  · ${m.label}`, `${r.inspections[m.key] || '-'}${def ? `  [결함: ${def}]` : ''}`]);
      });

      const safety = (r.safetyItems.signStone ? '표지석 ' : '') + (r.safetyItems.infoBoard ? '안내판 ' : '') +
        (r.safetyItems.warnBoard ? '경고판 ' : '') + (r.safetyItems.fence ? `안전휀스(${r.safetyFenceQuantity}m) ` : '') +
        (r.safetyItems.natlPoint ? '지점번호판' : '');

      const detail = [
        ['사방 외관 점검 정밀 상세서', ''],
        ['', ''],
        ['[기본 정보]', ''],
        ['관할 행정구역', r.siGun],
        ['세부 소재지', `경상남도 ${r.siGun} ${r.eupMyeon} ${r.riDong} ${r.jibun} (${r.sokching || '속칭 없음'})`],
        ['점검 책임자', r.inspector],
        ['시설 종류', r.facilityType],
        ['고유 번호', r.facilityName],
        ['점검 일자', r.date],
        ['국가 지점 번호', r.natlPointNumber],
        ['', ''],
        ['[위치 정보]', ''],
        ['기준 위경도(WGS84)', r.locMainLat ? `${r.locMainLat}, ${r.locMainLng}` : '미수신'],
        ['기준 도분초(DMS)', r.locMainLat ? `${formatDMS(r.locMainLat, true)}, ${formatDMS(r.locMainLng, false)}` : '미수신'],
        ['종점 도분초(DMS)', r.locEndLat ? `${formatDMS(r.locEndLat, true)}, ${formatDMS(r.locEndLng, false)}` : '해당 없음'],
        ['', ''],
        ['[설계 규격·제원]', ''],
        ['구조 제원', spec],
        ['', ''],
        ['[주요 부재 점검 현황]', ''],
        ...memberRows,
        ...(r.facilityType === '사방댐' ? [['  · 저사상태(별표7)', r.damSiltLevel || '-']] : []),
        ['', ''],
        ['[부대·안전 시설]', ''],
        ['부대 시설', `식생 ${r.ancillary.vegetation} / 접근도로 ${r.ancillary.road} / 기타 ${r.ancillary.etc}`],
        ['안전 시설물', safety || '없음'],
        ['', ''],
        ['[의견·판정]', ''],
        ['종합 의견', r.overallNotes],
        ['최종 점검 결과', r.finalResult],
        ['점검 주기(별표7)', GRADE_CYCLE[r.finalResult] || ''],
        ['보수 조치 지시', r.actionRequired || '해당 없음'],
        ['사방지 해제 여부', r.releaseStatus]
      ];

      const ws = XLSX.utils.aoa_to_sheet(detail);
      ws['!cols'] = [{ wch: 22 }, { wch: 70 }];
      let name = `${r.facilityType}_${r.facilityName}`.replace(/[\/\\?*:[\]]/g, '').substring(0, 30);
      if (used[name]) { used[name] += 1; name = `${name.substring(0, 27)}_${used[name]}`; } else used[name] = 1;
      XLSX.utils.book_append_sheet(wb, ws, name);
    });

    const now = new Date();
    const ts = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0') + '_' + String(now.getHours()).padStart(2, '0') + String(now.getMinutes()).padStart(2, '0');
    XLSX.writeFile(wb, `사방시설_외관점검대장_${ts}.xlsx`);
    showToast('다중 시트 엑셀 대장을 내보냈습니다.', 'success');
  };

  /* ---------- 백업/복원 ---------- */
  const handleImportDB = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const parsed = JSON.parse(event.target.result);
        if (Array.isArray(parsed)) { setDb(parsed); showToast(`${parsed.length}건을 복원했습니다.`, 'success'); }
        else showToast('올바른 백업 파일이 아닙니다.', 'error');
      } catch { showToast('파일 구문 분석 오류.', 'error'); }
    };
    reader.readAsText(file);
  };
  const exportDBAsJSON = () => {
    const now = new Date();
    const ts = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + String(now.getDate()).padStart(2, '0');
    const a = document.createElement('a');
    a.href = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(db, null, 2));
    a.download = `사방시설_DB백업_${ts}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    showToast('DB 백업 완료.', 'success');
  };

  /* ---------- 통계 ---------- */
  const stats = useMemo(() => {
    const siGunStats = {}, typeStats = { '사방댐': 0, '계류보전': 0, '산지사방': 0, '해안사방': 0 }, resultStats = { '양호': 0, '관찰필요': 0, '불량': 0 };
    db.forEach(r => {
      if (!siGunStats[r.siGun]) siGunStats[r.siGun] = { total: 0, 양호: 0, 관찰필요: 0, 불량: 0 };
      siGunStats[r.siGun].total += 1;
      if (siGunStats[r.siGun][r.finalResult] !== undefined) siGunStats[r.siGun][r.finalResult] += 1;
      if (typeStats[r.facilityType] !== undefined) typeStats[r.facilityType] += 1;
      if (resultStats[r.finalResult] !== undefined) resultStats[r.finalResult] += 1;
    });
    return { siGunStats, typeStats, resultStats };
  }, [db]);

  /* ---------- 제원 렌더 ---------- */
  const renderSpecifications = () => {
    switch (formData.facilityType) {
      case '사방댐': return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><label className="block text-[11px] font-bold text-slate-500 mb-1">사방댐 종류</label>
            <select value={formData.specDamType} onChange={e => setFormData({ ...formData, specDamType: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-700 focus:outline-none">{DAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <InputField label="시설년도" type="number" value={formData.specDamYear} onChange={e => setFormData({ ...formData, specDamYear: e.target.value })} placeholder="예: 1994" />
          <InputField label="상장 (m)" type="number" value={formData.specDamTopLen} onChange={e => setFormData({ ...formData, specDamTopLen: e.target.value })} />
          <InputField label="하장 (m)" type="number" value={formData.specDamBottomLen} onChange={e => setFormData({ ...formData, specDamBottomLen: e.target.value })} />
          <InputField label="유효고 (m)" type="number" value={formData.specDamHeight} onChange={e => setFormData({ ...formData, specDamHeight: e.target.value })} />
          <InputField label="전고 (m)" type="number" value={formData.specDamTotalHeight} onChange={e => setFormData({ ...formData, specDamTotalHeight: e.target.value })} />
          <InputField label="방수로 폭 (m)" type="number" value={formData.specDamSpillwayWidth} onChange={e => setFormData({ ...formData, specDamSpillwayWidth: e.target.value })} />
        </div>
      );
      case '계류보전': return (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3 pb-3 border-b border-slate-100">
            <InputField label="시설 년도" value={formData.specStreamYear} onChange={e => setFormData({ ...formData, specStreamYear: e.target.value })} />
            <InputField label="폭 (m)" type="number" value={formData.specStreamWidth} onChange={e => setFormData({ ...formData, specStreamWidth: e.target.value })} />
            <InputField label="길이 (m)" type="number" value={formData.specStreamLength} onChange={e => setFormData({ ...formData, specStreamLength: e.target.value })} />
            <InputField label="깊이 (m)" type="number" value={formData.specStreamDepth} onChange={e => setFormData({ ...formData, specStreamDepth: e.target.value })} />
          </div>
          <div><h4 className="text-[12px] font-bold text-slate-700 mb-2">[골막이 제원]</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="block text-[11px] font-bold text-slate-500 mb-1">골막이 종류</label>
                <select value={formData.specStreamCheckDamType} onChange={e => setFormData({ ...formData, specStreamCheckDamType: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-700 focus:outline-none">{DAM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
              <InputField label="상장 (m)" type="number" value={formData.specStreamCheckDamTopLen} onChange={e => setFormData({ ...formData, specStreamCheckDamTopLen: e.target.value })} />
              <InputField label="하장 (m)" type="number" value={formData.specStreamCheckDamBottomLen} onChange={e => setFormData({ ...formData, specStreamCheckDamBottomLen: e.target.value })} />
              <InputField label="유효고 (m)" type="number" value={formData.specStreamCheckDamHeight} onChange={e => setFormData({ ...formData, specStreamCheckDamHeight: e.target.value })} />
              <InputField label="전고 (m)" type="number" value={formData.specStreamCheckDamTotalHeight} onChange={e => setFormData({ ...formData, specStreamCheckDamTotalHeight: e.target.value })} />
              <InputField label="방수로 폭 (m)" type="number" value={formData.specStreamCheckDamSpillwayWidth} onChange={e => setFormData({ ...formData, specStreamCheckDamSpillwayWidth: e.target.value })} />
            </div></div>
        </div>
      );
      case '산지사방': return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><InputField label="시행 공법 명칭" value={formData.specForm} onChange={e => setFormData({ ...formData, specForm: e.target.value })} placeholder="예: 계단상 떼붙임 공법" /></div>
          <InputField label="시설 년도" type="number" value={formData.specYear} onChange={e => setFormData({ ...formData, specYear: e.target.value })} />
          <InputField label="면적 (ha)" type="number" value={formData.specMountainArea} onChange={e => setFormData({ ...formData, specMountainArea: e.target.value })} />
          <InputField label="사면 경사 (도)" type="number" value={formData.specMountainSlope} onChange={e => setFormData({ ...formData, specMountainSlope: e.target.value })} />
          <InputField label="사면 높이 (m)" type="number" value={formData.specMountainHeight} onChange={e => setFormData({ ...formData, specMountainHeight: e.target.value })} />
          <div className="col-span-2"><InputField label="사면 길이 (m)" type="number" value={formData.specMountainLength} onChange={e => setFormData({ ...formData, specMountainLength: e.target.value })} /></div>
        </div>
      );
      case '해안사방': return (
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2"><InputField label="시행 공법 명칭" value={formData.specForm} onChange={e => setFormData({ ...formData, specForm: e.target.value })} placeholder="예: 해안 정사 울타리 공법" /></div>
          <InputField label="시설 년도" type="number" value={formData.specYear} onChange={e => setFormData({ ...formData, specYear: e.target.value })} />
          <InputField label="시설 연장 (m)" type="number" value={formData.specCoastLength} onChange={e => setFormData({ ...formData, specCoastLength: e.target.value })} />
          <InputField label="사구 폭 (m)" type="number" value={formData.specCoastWidth} onChange={e => setFormData({ ...formData, specCoastWidth: e.target.value })} />
          <InputField label="사구 면적 (㎡)" type="number" value={formData.specCoastArea} onChange={e => setFormData({ ...formData, specCoastArea: e.target.value })} />
          <div className="col-span-2"><label className="block text-xs font-bold text-slate-500 mb-1">식재 방재림 수종</label>
            <select value={formData.specCoastType} onChange={e => setFormData({ ...formData, specCoastType: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded text-sm font-bold text-slate-700 focus:outline-none">
              <option value="해송">해송</option><option value="곰솔">곰솔</option><option value="아까시나무">아까시나무</option><option value="기타">기타</option></select></div>
        </div>
      );
      default: return null;
    }
  };

  /* ---------- 주요부재 점검 (등급 + 결함 중복체크) ---------- */
  const renderMainInspections = () => {
    const opts = ['양호', '관찰필요', '불량'];
    const defectMembers = DEFECT_CONFIG[formData.facilityType] || [];
    const extra = EXTRA_GRADE_MEMBERS[formData.facilityType] || [];
    return (
      <div className="space-y-3">
        {defectMembers.map(m => (
          <div key={m.key} className="p-3 bg-slate-50 rounded-xl border border-slate-200">
            <RadioGroup label={`${m.label} 상태`} value={formData.inspections[m.key]} onChange={v => updateGrade(m.key, v)} options={opts} />
            <label className="block text-[10px] font-bold text-rose-500 mb-0.5">결함 항목 (중복체크 · 별표7~10)</label>
            <DefectChips items={m.defects} selected={formData.defects[m.key] || []} onToggle={d => toggleDefect(m.key, d)} />
          </div>
        ))}
        {extra.map(m => (
          <div key={m.key} className="px-1"><RadioGroup label={m.label} value={formData.inspections[m.key]} onChange={v => updateGrade(m.key, v)} options={opts} /></div>
        ))}
        {formData.facilityType === '사방댐' && (
          <div className="px-1">
            <label className="block text-[12px] font-bold text-slate-700 mb-2">저사상태 (별표7)</label>
            <div className="flex gap-2">
              {['저', '중', '고'].map(lv => (
                <button key={lv} onClick={() => setFormData({ ...formData, damSiltLevel: lv })}
                  className={`flex-1 py-2 text-xs font-bold border rounded transition-colors ${formData.damSiltLevel === lv ? 'bg-slate-700 text-white border-slate-700' : 'bg-white text-slate-500 border-slate-300'}`}>
                  {lv === '저' ? '저(50%미만)' : lv === '중' ? '중(50~80%미만)' : '고(80%이상)'}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    );
  };

  /* ============================ 렌더 ============================ */
  return (
    <div className="bg-slate-50 min-h-screen text-slate-800 font-sans pb-16">
      {toast.visible && (
        <div className="fixed top-5 left-1/2 -translate-x-1/2 z-50 animate-bounce">
          <div className={`flex items-center gap-2 px-5 py-3 rounded-2xl shadow-xl text-white font-extrabold text-xs ${toast.type === 'success' ? 'bg-emerald-600' : toast.type === 'error' ? 'bg-rose-600' : 'bg-indigo-600'}`}>
            <Bell size={16} /><span>{toast.message}</span>
          </div>
        </div>
      )}

      <header className="bg-slate-900 text-white px-6 py-4 shadow-md flex justify-between items-center">
        <div className="flex items-center space-x-3 cursor-pointer" onClick={() => setCurrentView('home')}>
          <Database className="text-emerald-400" size={26} />
          <div>
            <h1 className="text-md font-black tracking-tight leading-tight">경상남도 사방시설 외관점검 시스템</h1>
            <p className="text-[10px] text-slate-400">산림청고시 제2018-27호 별표 7~10 기준</p>
          </div>
        </div>
        {currentView !== 'home' && (
          <button onClick={() => setCurrentView('home')} className="text-xs bg-slate-800 hover:bg-slate-700 px-3 py-1.5 rounded-lg font-bold text-slate-300 flex items-center gap-1 transition">
            <Home size={14} /> 메인으로
          </button>
        )}
      </header>

      <main className="max-w-7xl mx-auto p-4 md:p-6">
        {/* ===== HOME ===== */}
        {currentView === 'home' && (
          <div className="max-w-2xl mx-auto space-y-6 pt-6">
            <div className="bg-slate-900 text-white p-6 rounded-2xl shadow-xl relative overflow-hidden">
              <div className="absolute right-0 bottom-0 opacity-10 translate-y-1/4 translate-x-1/4"><Database size={240} /></div>
              <div className="relative z-10">
                <span className="bg-emerald-500/20 text-emerald-400 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider">4대 공정 · 외관점검 조사서 표준화</span>
                <h2 className="text-xl font-black mt-3 mb-1">관할 구역 외관 정밀 실태 조사</h2>
                <p className="text-xs text-slate-300 font-medium">별표 7~10 부재별 결함 중복체크, 별표 4 준설 평가, 별표 7 등급별 점검주기를 자동 산출합니다.</p>
              </div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
              <h3 className="font-extrabold text-slate-800 text-xs mb-3 flex items-center gap-1.5"><UserCircle size={16} className="text-indigo-500" /> 1. 기초 기재 사항 설정</h3>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">조사 대상 시군</label>
                  <select value={globalSettings.siGun} onChange={e => { setGlobalSettings({ ...globalSettings, siGun: e.target.value }); setFormData(prev => ({ ...prev, siGun: e.target.value })); }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-bold text-slate-700 focus:outline-none">
                    {GYEONGNAM_CITIES.map(c => <option key={c} value={c}>{c}</option>)}</select>
                </div>
                <div>
                  <label className="block text-[10px] font-bold text-slate-400 mb-1">점검 책임자 성명 *</label>
                  <input type="text" value={globalSettings.inspector} onChange={e => { setGlobalSettings({ ...globalSettings, inspector: e.target.value }); setFormData(prev => ({ ...prev, inspector: e.target.value })); }}
                    className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-xs font-semibold focus:outline-none focus:ring-1 focus:ring-indigo-400" placeholder="조사자 실명 입력" />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <button onClick={startNewInspection} className="bg-white hover:bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4 transition-all text-left group">
                <div className="bg-emerald-50 text-emerald-600 p-3.5 rounded-xl group-hover:scale-105 transition-transform"><ClipboardList size={26} /></div>
                <div><h3 className="font-extrabold text-slate-800 text-sm">점검 조사 시작</h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">GPS 위치·국가지점번호 취득, 공정별 결함 중복체크, 18장 사진 대지를 구축합니다.</p></div>
              </button>
              <button onClick={() => setCurrentView('results')} className="bg-white hover:bg-slate-50 p-6 rounded-2xl border border-slate-200 shadow-sm flex items-start gap-4 transition-all text-left group">
                <div className="bg-indigo-50 text-indigo-600 p-3.5 rounded-xl group-hover:scale-105 transition-transform"><Database size={26} /></div>
                <div><h3 className="font-extrabold text-slate-800 text-sm">점검 결과 및 통계</h3>
                  <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">전수 DB·다차원 통계 조회 및 시트별 엑셀 대장(점검주기 포함)을 추출합니다.</p></div>
              </button>
            </div>
          </div>
        )}

        {/* ===== FORM ===== */}
        {currentView === 'form' && (
          <div className="max-w-2xl mx-auto space-y-4">
            {/* 위치 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center"><Map size={18} className="mr-2 text-blue-600" /> 1. 점검 대상 및 위치</h3>
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">관할 행정구역</label><input readOnly value={formData.siGun} className="w-full p-2.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-sm font-bold outline-none" /></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">점검 책임자</label><input readOnly value={formData.inspector} className="w-full p-2.5 bg-slate-100 text-slate-600 border border-slate-200 rounded-lg text-sm font-bold outline-none" /></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">시설 종류 *</label>
                    <select value={formData.facilityType} onChange={e => handleFacilityTypeChangeOnForm(e.target.value)} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg font-bold text-slate-700 focus:outline-none">
                      <option value="사방댐">사방댐</option><option value="계류보전">계류보전</option><option value="산지사방">산지사방</option><option value="해안사방">해안사방</option></select></div>
                  <div><label className="block text-xs font-bold text-slate-500 mb-1">점검 일자</label><input type="date" value={formData.date} onChange={e => setFormData({ ...formData, date: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none" /></div>
                </div>
                <div><label className="block text-xs font-bold text-slate-500 mb-1">고유 번호 (시설명) *</label>
                  <input value={formData.facilityName} onChange={e => setFormData({ ...formData, facilityName: e.target.value })} className="w-full p-2.5 bg-slate-50 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-1 focus:ring-emerald-500 font-bold" placeholder="예: 무릉-사방댐-01 또는 1688" /></div>

                <div className="p-4 bg-slate-50 rounded-xl border border-slate-200 space-y-3">
                  <h4 className="text-xs font-extrabold text-slate-600">📍 상세 소재지</h4>
                  <div className="grid grid-cols-2 gap-3">
                    <InputField label="읍 / 면" value={formData.eupMyeon} onChange={e => setFormData({ ...formData, eupMyeon: e.target.value })} placeholder="예: 서면" />
                    <InputField label="리 / 동" value={formData.riDong} onChange={e => setFormData({ ...formData, riDong: e.target.value })} placeholder="예: 중현리" />
                    <InputField label="지번" value={formData.jibun} onChange={e => setFormData({ ...formData, jibun: e.target.value })} placeholder="예: 1548구" />
                    <InputField label="산지 속칭" value={formData.sokching} onChange={e => setFormData({ ...formData, sokching: e.target.value })} placeholder="예: 중현계곡" />
                  </div>
                </div>

                <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <label className="block text-xs font-bold text-slate-500 mb-1">기준 위치 좌표 (도분초)</label>
                  <div className="flex gap-2 mb-2">
                    <input readOnly value={formData.locMainLat ? `${formatDMS(formData.locMainLat, true)}, ${formatDMS(formData.locMainLng, false)}` : ''} placeholder="GPS 수신 필요" className="w-full p-2 bg-white text-slate-600 border border-slate-300 rounded text-xs outline-none font-bold" />
                    <button onClick={() => handleGetLocation('main')} className="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded text-xs font-bold shrink-0">수신</button>
                  </div>
                  <label className="block text-[11px] font-bold text-blue-600 mb-1">↳ 국가 지점 번호 (GRS80 UTM-K, 근사)</label>
                  <input readOnly value={formData.natlPointNumber} placeholder="기준 좌표 입력 시 자동 연산" className="w-full p-2 bg-blue-50 text-blue-700 border border-blue-200 rounded text-xs outline-none font-bold" />
                  {formData.facilityType !== '사방댐' && (
                    <div className="mt-3">
                      <label className="block text-xs font-bold text-slate-500 mb-1">종점 좌표 (도분초)</label>
                      <div className="flex gap-2">
                        <input readOnly value={formData.locEndLat ? `${formatDMS(formData.locEndLat, true)}, ${formatDMS(formData.locEndLng, false)}` : ''} placeholder="종점 GPS 수신 필요" className="w-full p-2 bg-white text-slate-600 border border-slate-300 rounded text-xs outline-none font-bold" />
                        <button onClick={() => handleGetLocation('end')} className="bg-slate-700 hover:bg-slate-800 text-white px-3 rounded text-xs font-bold shrink-0">수신</button>
                      </div>
                    </div>
                  )}
                </div>

                <div className="pt-2">
                  <div className="flex justify-between items-center mb-2">
                    <label className="block text-xs font-bold text-slate-500">참고 좌표 추가</label>
                    <button onClick={addRefLocation} className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2.5 py-1 rounded-xl border border-indigo-200 flex items-center"><Plus size={14} className="mr-1" />좌표 추가</button>
                  </div>
                  <div className="space-y-3">
                    {formData.refLocations.map(loc => (
                      <div key={loc.id} className="bg-white p-3 rounded-lg border border-slate-300 relative">
                        <button onClick={() => removeRefLocation(loc.id)} className="absolute top-2 right-2 text-red-400 hover:text-red-600"><Trash2 size={16} /></button>
                        <input value={loc.label} onChange={e => updateRefLabel(loc.id, e.target.value)} className="text-xs font-bold text-slate-700 bg-transparent border-b border-slate-300 mb-2 w-2/3 outline-none focus:border-indigo-400 p-1" placeholder="참고 명칭 (예: 사면 유탈 발생지)" />
                        <div className="flex gap-2">
                          <input readOnly value={loc.lat ? `${formatDMS(loc.lat, true)}, ${formatDMS(loc.lng, false)}` : ''} placeholder="참고 좌표 미수신" className="w-full p-2 bg-slate-50 text-slate-500 border border-slate-200 rounded text-[11px] font-medium" />
                          <button onClick={() => handleRefLocationGPS(loc.id)} className="bg-slate-600 text-white px-2 rounded text-xs font-bold shrink-0">수신</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {/* 제원 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center"><Info size={18} className="mr-2 text-indigo-500" /> 2. 제원 (일반 사항)</h3>
              {renderSpecifications()}
              {formData.facilityType === '사방댐' && (
                <label className="flex items-center gap-2 mt-4 text-xs font-bold text-slate-600 cursor-pointer">
                  <input type="checkbox" checked={formData.precisionInspected} onChange={e => setFormData({ ...formData, precisionInspected: e.target.checked })} className="w-4 h-4 accent-emerald-600" />
                  정밀점검 실시 이력 있음 (준공 20년 규정 판정용)
                </label>
              )}
              {/* 연령 기반 알림 */}
              {(needReleaseOpinion || needPrecision20) && (
                <div className="mt-3 space-y-2">
                  {needPrecision20 && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-700 text-[11px] font-bold">
                      <CalendarClock size={15} className="shrink-0 mt-0.5" /><span>준공 후 {yearsElapsed}년 경과 + 정밀점검 미실시 → 별표 7에 따라 등급과 무관하게 <u>정밀점검 실시 대상</u>입니다.</span>
                    </div>
                  )}
                  {needReleaseOpinion && (
                    <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-700 text-[11px] font-bold">
                      <AlertTriangle size={15} className="shrink-0 mt-0.5" /><span>준공 후 {yearsElapsed}년 경과 → 사방지 <u>지정해제 의견 제시 대상</u>(준공 5년 경과)입니다.</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* 주요 부재 점검 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center"><ShieldCheck size={18} className="mr-2 text-emerald-600" /> 3. 주요 부재 상태 점검</h3>
              {renderMainInspections()}
            </div>

            {/* 준설 평가 (사방댐) */}
            {formData.facilityType === '사방댐' && (
              <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
                <h3 className="font-bold text-slate-800 mb-1 flex items-center"><AlertTriangle size={18} className="mr-2 text-amber-500" /> 4. 준설 대상지 평가</h3>
                <p className="text-[10px] text-slate-400 mb-4">별표 4 「사방댐준설 대상지 평가표」 가중치 적용 (참고용)</p>
                <div className="grid grid-cols-2 gap-3 text-xs">
                  <div className="mb-2"><label className="block font-bold text-slate-600 mb-1">1. 현재 저사량 (×3.4)</label><select value={formData.dredging.factor1} onChange={e => setFormData(p => ({ ...p, dredging: { ...p.dredging, factor1: e.target.value } }))} className="w-full p-2 border border-slate-200 rounded font-bold focus:outline-none"><option value={2.5}>고 (80% 이상)</option><option value={1.6}>중 (50~79%)</option><option value={1.0}>저 (50% 미만)</option></select></div>
                  <div className="mb-2"><label className="block font-bold text-slate-600 mb-1">2. 생활권 거리 (×2.8)</label><select value={formData.dredging.factor2} onChange={e => setFormData(p => ({ ...p, dredging: { ...p.dredging, factor2: e.target.value } }))} className="w-full p-2 border border-slate-200 rounded font-bold focus:outline-none"><option value={2.5}>단 (500m 이하)</option><option value={1.6}>중 (501~999m)</option><option value={1.0}>장 (1000m 이상)</option></select></div>
                  <div className="mb-2"><label className="block font-bold text-slate-600 mb-1">3. 계상 물매 (×1.6)</label><select value={formData.dredging.factor3} onChange={e => setFormData(p => ({ ...p, dredging: { ...p.dredging, factor3: e.target.value } }))} className="w-full p-2 border border-slate-200 rounded font-bold focus:outline-none"><option value={2.5}>급 (10% 이상)</option><option value={1.6}>경 (5~9%)</option><option value={1.0}>완 (5% 미만)</option></select></div>
                  <div className="mb-2"><label className="block font-bold text-slate-600 mb-1">4. 토석 이동량 (×1.2)</label><select value={formData.dredging.factor4} onChange={e => setFormData(p => ({ ...p, dredging: { ...p.dredging, factor4: e.target.value } }))} className="w-full p-2 border border-slate-200 rounded font-bold focus:outline-none"><option value={2.5}>다 (70% 이상)</option><option value={1.6}>중 (30~69%)</option><option value={1.0}>소 (30% 미만)</option></select></div>
                </div>
                <div className={`mt-3 p-3 rounded-lg font-bold text-center border ${formData.dredging.isRequired ? 'bg-red-50 text-red-700 border-red-200' : 'bg-blue-50 text-blue-700 border-blue-200'}`}>평가 총점: {formData.dredging.totalScore}점<span className="block text-sm mt-1">{formData.dredging.isRequired ? '⚠️ 준설 시행 (17점 이상)' : '✓ 준설 불요 (17점 미만)'}</span></div>
              </div>
            )}

            {/* 부대 시설 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center"><Layers size={18} className="mr-2 text-cyan-600" /> {formData.facilityType === '사방댐' ? '5' : '4'}. 부대 시설 점검</h3>
              <RadioGroup label="식생 상태" value={formData.ancillary.vegetation} onChange={v => setFormData(p => ({ ...p, ancillary: { ...p.ancillary, vegetation: v } }))} options={['양호', '관찰필요', '불량']} />
              <RadioGroup label="접근 도로" value={formData.ancillary.road} onChange={v => setFormData(p => ({ ...p, ancillary: { ...p.ancillary, road: v } }))} options={['양호', '관찰필요', '불량']} />
              <RadioGroup label="기타 부대 시설" value={formData.ancillary.etc} onChange={v => setFormData(p => ({ ...p, ancillary: { ...p.ancillary, etc: v } }))} options={['양호', '관찰필요', '불량']} />
            </div>

            {/* 안전 시설 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <h3 className="font-bold text-slate-800 mb-4 flex items-center"><AlertOctagon size={18} className="mr-2 text-red-500" /> {formData.facilityType === '사방댐' ? '6' : '5'}. 안전 시설 점검</h3>
              <div className="grid grid-cols-2 gap-3">
                {SAFETY_KEYS.map(item => (
                  <div key={item.id} className="flex flex-col gap-2">
                    <button onClick={() => toggleSafetyItem(item.id)} className={`flex items-center justify-between p-3 border rounded-lg transition-colors ${formData.safetyItems[item.id] ? 'bg-indigo-50 border-indigo-500 text-indigo-700' : 'bg-slate-50 border-slate-200 text-slate-600'}`}>
                      <span className="text-sm font-bold">{item.label}</span>
                      <span className={`text-xs font-black px-2 py-1 rounded ${formData.safetyItems[item.id] ? 'bg-indigo-600 text-white' : 'bg-slate-200 text-slate-400'}`}>{formData.safetyItems[item.id] ? '유' : '무'}</span>
                    </button>
                    {item.id === 'fence' && formData.safetyItems.fence && (
                      <input type="number" value={formData.safetyFenceQuantity} onChange={e => setFormData({ ...formData, safetyFenceQuantity: e.target.value })} className="w-full p-2 text-sm border border-indigo-300 rounded focus:outline-none" placeholder="수량(m) 기재" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 최종 결론 */}
            <div className="bg-slate-800 text-white p-5 rounded-2xl shadow-sm">
              <h3 className="font-bold mb-4 flex items-center"><CheckSquare size={18} className="mr-2 text-emerald-400" /> {formData.facilityType === '사방댐' ? '7' : '6'}. 최종 결론 및 조치</h3>
              <label className="block text-xs font-bold text-slate-300 mb-1">종합 의견</label>
              <textarea value={formData.overallNotes} onChange={e => setFormData({ ...formData, overallNotes: e.target.value })} className="w-full p-3 bg-slate-700 text-white border border-slate-600 rounded-lg text-sm mb-3 focus:outline-none font-medium" rows="3" placeholder="종합 의견을 기술해 주십시오." />

              {/* 자동 판정 제안 */}
              <div className="flex items-center justify-between bg-slate-700/60 rounded-lg px-3 py-2 mb-4">
                <span className="text-[11px] text-slate-300 font-bold">주요부재 기준 자동 판정: <span className="text-emerald-300">{suggestedResult}</span></span>
                <button onClick={() => handleFinalResultChange(suggestedResult)} className="text-[11px] font-black bg-emerald-500/90 hover:bg-emerald-500 text-white px-2.5 py-1 rounded">적용</button>
              </div>

              <div className="space-y-4">
                <div><label className="block text-xs font-bold text-slate-300 mb-2">최종 점검 결과</label>
                  <div className="flex gap-2">{['양호', '관찰필요', '불량'].map(opt => (
                    <button key={opt} onClick={() => handleFinalResultChange(opt)} className={`flex-1 py-2 text-sm font-bold border rounded transition-colors ${formData.finalResult === opt ? 'bg-emerald-500 border-emerald-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>{opt}</button>
                  ))}</div>
                  <div className="mt-2 text-[11px] text-slate-300 bg-slate-700/50 rounded px-2.5 py-1.5 font-bold">📅 점검 주기(별표7): <span className="text-amber-300">{GRADE_CYCLE[formData.finalResult]}</span></div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div><label className="block text-xs font-bold text-slate-300 mb-2">조치 사항 (자동 제어)</label>
                    <div className="flex gap-2">{['보수', '정밀점검'].map(opt => {
                      const disabled = formData.finalResult === '양호' || (formData.finalResult === '불량' && opt === '보수');
                      return <button key={opt} onClick={() => setFormData({ ...formData, actionRequired: opt })} disabled={disabled} className={`flex-1 py-2 text-xs font-bold border rounded transition-all ${formData.actionRequired === opt ? 'bg-amber-500 border-amber-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'} ${disabled ? 'opacity-30 cursor-not-allowed' : 'hover:bg-slate-600'}`}>{opt}</button>;
                    })}</div></div>
                  <div><label className="block text-xs font-bold text-slate-300 mb-2">사방지 해제 여부</label>
                    <div className="flex gap-2">{['해제가능', '유지'].map(opt => (
                      <button key={opt} onClick={() => setFormData({ ...formData, releaseStatus: opt })} className={`flex-1 py-2 text-xs font-bold border rounded transition-colors ${formData.releaseStatus === opt ? 'bg-blue-500 border-blue-500 text-white' : 'bg-slate-700 border-slate-600 text-slate-400'}`}>{opt}</button>
                    ))}</div></div>
                </div>
              </div>
            </div>

            {/* 사진 대지 */}
            <div className="bg-white p-5 rounded-2xl shadow-sm border border-slate-200">
              <div className="flex justify-between items-center mb-3">
                <h3 className="font-bold text-slate-800 flex items-center"><Camera size={18} className="mr-2 text-slate-500" /> {formData.facilityType === '사방댐' ? '8' : '7'}. 사진 대지 (18장)</h3>
                <span className="text-[11px] font-bold text-emerald-600 bg-emerald-50 px-2 py-1 rounded border border-emerald-200">Page {photoPage} / 3</span>
              </div>
              <p className="text-[11px] text-slate-500 mb-4">갤러리에서 불러오면 일시·GPS가 우측 하단에 각인되며, 개별 다운로드 시 [지역-고유번호-사진제목.jpg]로 명명됩니다.</p>
              <div className="grid grid-cols-2 gap-3 mb-4">
                {formData.photos.slice((photoPage - 1) * 6, photoPage * 6).map(photo => (
                  <div key={photo.id} className="border border-slate-300 rounded-lg overflow-hidden bg-slate-50 relative">
                    {photo.dataUrl && (
                      <button onClick={() => downloadSinglePhoto(photo)} className="absolute top-1 right-1 z-10 bg-slate-900/80 hover:bg-slate-900 text-white px-2 py-0.5 rounded text-[10px] font-black">다운로드</button>
                    )}
                    <div className="w-full text-center text-[11px] font-bold p-1 bg-slate-200 text-slate-700 border-b border-slate-300">{photo.label}</div>
                    <div className="relative h-28 flex flex-col items-center justify-center cursor-pointer hover:bg-slate-200 transition">
                      {photo.dataUrl ? <img src={photo.dataUrl} alt={photo.label} className="w-full h-full object-cover" /> : (<><Camera className="text-slate-400 mb-1" size={20} /><span className="text-[10px] text-slate-500 font-bold">터치하여 첨부</span></>)}
                      <input type="file" accept="image/*" onChange={e => handleImageChange(photo.id, e)} className="absolute inset-0 opacity-0 cursor-pointer" />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex justify-between items-center bg-slate-100 rounded-lg p-1">
                <button disabled={photoPage === 1} onClick={() => setPhotoPage(p => p - 1)} className="p-2 text-slate-600 disabled:opacity-30 active:bg-slate-200 rounded"><ChevronLeft size={20} /></button>
                <div className="flex gap-2">{[1, 2, 3].map(p => <span key={p} className={`w-2 h-2 rounded-full ${photoPage === p ? 'bg-emerald-500' : 'bg-slate-300'}`}></span>)}</div>
                <button disabled={photoPage === 3} onClick={() => setPhotoPage(p => p + 1)} className="p-2 text-slate-600 disabled:opacity-30 active:bg-slate-200 rounded"><ChevronRight size={20} /></button>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setCurrentView('home')} className="flex-1 py-4 bg-slate-200 hover:bg-slate-300 rounded-2xl font-bold text-sm text-slate-600 transition">취소</button>
              <button onClick={handleSaveToDB} className="flex-1 py-4 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-2xl text-sm shadow-md transition">점검기록 DB에 등록</button>
            </div>
          </div>
        )}

        {/* ===== RESULTS ===== */}
        {currentView === 'results' && (
          <div className="space-y-6">
            <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col md:flex-row justify-between items-center gap-4">
              <div><h3 className="font-black text-slate-800 text-sm">💾 데이터베이스 백업·복원</h3>
                <p className="text-xs text-slate-500 font-medium">전체 점검 테이블을 JSON으로 보관하거나 즉시 복원합니다.</p></div>
              <div className="flex gap-2">
                <label className="bg-slate-100 hover:bg-slate-200 text-slate-700 px-4 py-2 rounded-xl text-xs font-black transition cursor-pointer flex items-center gap-1.5 shadow-sm"><Upload size={14} /> 복원 가져오기<input type="file" accept=".json" onChange={handleImportDB} className="hidden" /></label>
                <button onClick={exportDBAsJSON} className="bg-slate-800 hover:bg-slate-700 text-white px-4 py-2 rounded-xl text-xs font-black transition flex items-center gap-1.5 shadow-sm"><Download size={14} /> 백업 저장 (.json)</button>
              </div>
            </div>

            <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
              <div className="flex gap-2">
                <button onClick={() => setActiveTab('list')} className={`px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 'list' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>점검 대장 리스트</button>
                <button onClick={() => setActiveTab('stats')} className={`px-4 py-2 rounded-xl text-xs font-black transition ${activeTab === 'stats' ? 'bg-slate-900 text-white' : 'bg-slate-100 text-slate-500'}`}>통계 집계표</button>
              </div>
              <button onClick={handleExportMultiSheetExcel} className="bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2 rounded-xl text-xs font-black shadow-sm flex items-center gap-1.5 transition"><FileSpreadsheet size={16} /> 시트 분할 엑셀 저장</button>
            </div>

            {activeTab === 'list' && (
              <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm">
                <div className="p-4 bg-slate-900 text-white font-extrabold text-sm flex justify-between items-center">
                  <span>🗄️ 외관 점검 데이터베이스</span><span className="text-[10px] text-slate-400">임의 삭제 차단</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left border-collapse">
                    <thead><tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                      <th className="p-3">관할구역</th><th className="p-3">세부 소재지</th><th className="p-3">공종</th><th className="p-3">시설명</th><th className="p-3">점검일</th><th className="p-3">국가지점번호</th><th className="p-3 text-center">결과</th><th className="p-3">점검주기</th><th className="p-3">조치</th>
                    </tr></thead>
                    <tbody className="divide-y divide-slate-100">
                      {db.map((r, i) => (
                        <tr key={i} className="hover:bg-slate-50 font-medium">
                          <td className="p-3 font-bold">{r.siGun}</td>
                          <td className="p-3 text-slate-500">{r.eupMyeon} {r.riDong} {r.jibun}</td>
                          <td className="p-3"><span className="bg-slate-200 px-2 py-0.5 rounded text-[10px] font-bold">{r.facilityType}</span></td>
                          <td className="p-3 font-bold text-slate-700">{r.facilityName}</td>
                          <td className="p-3 text-slate-500">{r.date}</td>
                          <td className="p-3 font-mono font-bold text-indigo-600">{r.natlPointNumber || '좌표필요'}</td>
                          <td className="p-3 text-center"><span className={`px-2 py-0.5 rounded font-black text-[10px] ${r.finalResult === '양호' ? 'bg-emerald-100 text-emerald-800' : r.finalResult === '관찰필요' ? 'bg-amber-100 text-amber-800' : 'bg-red-100 text-red-800'}`}>{r.finalResult}</span></td>
                          <td className="p-3 text-[10px] text-slate-500 font-bold">{GRADE_CYCLE[r.finalResult]}</td>
                          <td className="p-3 font-bold text-slate-700">{r.actionRequired || '-'}</td>
                        </tr>
                      ))}
                      {db.length === 0 && <tr><td colSpan="9" className="p-8 text-center text-slate-400 font-bold">데이터가 없습니다.</td></tr>}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {activeTab === 'stats' && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 bg-slate-900 text-white font-extrabold text-sm">📋 관할구역 등급 통계</div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left border-collapse">
                      <thead><tr className="bg-slate-100 border-b border-slate-200 font-bold text-slate-600">
                        <th className="p-3">행정구역</th><th className="p-3 text-center">총</th><th className="p-3 text-center text-emerald-600">양호</th><th className="p-3 text-center text-amber-600">관찰필요</th><th className="p-3 text-center text-red-600">불량</th>
                      </tr></thead>
                      <tbody className="divide-y divide-slate-100">
                        {Object.keys(stats.siGunStats).map(k => (
                          <tr key={k} className="hover:bg-slate-50 font-medium">
                            <td className="p-3 font-bold">{k}</td>
                            <td className="p-3 text-center font-black">{stats.siGunStats[k].total}</td>
                            <td className="p-3 text-center font-bold text-emerald-600">{stats.siGunStats[k].양호}</td>
                            <td className="p-3 text-center font-bold text-amber-600">{stats.siGunStats[k].관찰필요}</td>
                            <td className="p-3 text-center font-bold text-red-600">{stats.siGunStats[k].불량}</td>
                          </tr>
                        ))}
                        {Object.keys(stats.siGunStats).length === 0 && <tr><td colSpan="5" className="p-8 text-center text-slate-400 font-bold">자료 없음</td></tr>}
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                  <div className="p-4 bg-slate-900 text-white font-extrabold text-sm">📊 공종별·등급별 분포</div>
                  <div className="p-6 space-y-6">
                    <div>
                      <h4 className="text-xs font-black text-slate-500 mb-3">[4대 공종 수립량]</h4>
                      <div className="grid grid-cols-2 gap-3 text-center text-xs">
                        {['사방댐', '계류보전', '산지사방', '해안사방'].map(t => (
                          <div key={t} className="bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <div className="text-slate-400 font-bold mb-1 text-[10px]">{t}</div>
                            <div className="text-xl font-black text-slate-800">{stats.typeStats[t]}<span className="text-[11px] font-normal text-slate-400 ml-1">개소</span></div>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div>
                      <h4 className="text-xs font-black text-slate-500 mb-3">[등급 판정 분포]</h4>
                      <div className="grid grid-cols-3 gap-2 text-center text-xs">
                        <div className="bg-emerald-50 p-3 rounded-xl border border-emerald-100"><div className="text-emerald-500 font-bold text-[10px] mb-1">양호</div><div className="text-lg font-black text-emerald-800">{stats.resultStats['양호']}건</div></div>
                        <div className="bg-amber-50 p-3 rounded-xl border border-amber-100"><div className="text-amber-500 font-bold text-[10px] mb-1">관찰필요</div><div className="text-lg font-black text-amber-800">{stats.resultStats['관찰필요']}건</div></div>
                        <div className="bg-red-50 p-3 rounded-xl border border-red-100"><div className="text-red-500 font-bold text-[10px] mb-1">불량</div><div className="text-lg font-black text-red-800">{stats.resultStats['불량']}건</div></div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
};

export default App;
