# 사방점검 (Sabang Inspection PWA)

경상남도 사방시설 외관점검 조사 앱.
산림청고시 제2018-27호 별표 7~10 기준.

## 폰에서 사용하기 — Vercel 무료 배포

### 1. GitHub에 업로드

1. https://github.com 가입 (이미 있으면 로그인)
2. 우측 상단 **+** → **New repository**
3. Repository name: `sabang-inspection` (아무 이름 OK)
4. **Public** 선택 (Private도 가능)
5. **Create repository** 클릭
6. 다음 화면에서 **uploading an existing file** 링크 클릭
7. 이 폴더의 **모든 파일**을 드래그해서 업로드 (`node_modules`, `dist` 폴더는 제외)
8. 하단 **Commit changes** 클릭

### 2. Vercel로 배포

1. https://vercel.com 접속 → **Sign Up** → **Continue with GitHub**
2. GitHub 계정 권한 승인
3. 대시보드에서 **Add New → Project**
4. 방금 만든 `sabang-inspection` 저장소 옆 **Import** 클릭
5. Framework Preset: **Vite** 자동 감지됨 (그대로 두기)
6. **Deploy** 클릭 → 1~2분 대기
7. 완료되면 `https://sabang-inspection-xxx.vercel.app` 같은 주소가 나옵니다

### 3. 폰에 설치 (PWA)

**아이폰 (Safari)**
1. Safari로 Vercel 주소 접속
2. 하단 가운데 **공유 버튼** (□↑) 탭
3. **홈 화면에 추가** 선택
4. 우측 상단 **추가** 탭
5. 홈 화면에 "사방점검" 아이콘 생성

**안드로이드 (Chrome)**
1. Chrome으로 Vercel 주소 접속
2. 우측 상단 **⋮** 메뉴 탭
3. **홈 화면에 추가** 또는 **앱 설치** 선택
4. **설치** 탭
5. 홈 화면에 "사방점검" 아이콘 생성

### 4. 오프라인 사용

한 번 실행하면 자동으로 캐시되어 **인터넷 없이도** 산속 현장에서 작동합니다.
사진·GPS·로컬 저장 모두 정상 동작.

## 로컬 개발

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # dist/ 폴더에 빌드
```

## 데이터 백업

앱의 「점검 결과 및 통계」→「DB 백업 저장」으로 JSON 파일로 내보낼 수 있습니다.
폰 변경 시 새 폰에서 「복원 가져오기」로 복구.

## 라이선스

내부 사용 전용.
