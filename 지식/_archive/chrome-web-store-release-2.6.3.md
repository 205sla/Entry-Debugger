# Chrome Web Store 2.6.3 제출 점검

확인 날짜: 2026-09-01

대상 브랜치: `main`

기존 배포 버전: `2.6.2`

## 최종 판정

**제출 가능 — 확인된 릴리스 블로커 없음.**

Chrome Web Store 공식 문서에 따라 기존 버전보다 큰 `2.6.3`으로 manifest를 올렸고,
전체 확장 파일을 담은 ZIP의 루트에 `manifest.json`이 있도록 생성했다.

- [기존 항목 업데이트](https://developer.chrome.com/docs/webstore/update/)
- [확장 제출 준비와 ZIP 구조](https://developer.chrome.com/docs/webstore/prepare/)

## 릴리스 범위

- 디버깅 탭을 끈 새 세션에서도 블록 텍스트 복사 성공·실패 알림 표시
- `Entry.toast` 호출 예외와 비동기 clipboard 실패 뒤 브라우저 fallback 회귀 고정
- 프레임 프로파일러의 `__proto__`, `constructor`, `hasOwnProperty` 특수 ID 충돌 방지
- correctness 전용 ESLint 0-warning 게이트와 GitHub Actions 추가
- allowlist 기반 개발·제출용 빌드로 내부 문서와 개발 파일 혼입 차단
- 실사이트 안내 레이어·오브젝트 초기 선택·Chromium 경로 차이를 견디도록 smoke 안정화

## manifest·권한·보안 검토

| 항목 | 결과 |
| --- | --- |
| `manifest_version` | `3` |
| 확장 버전 | `2.6.3` |
| 권한 | `storage`만 사용, 신규 권한 없음 |
| `host_permissions` | 없음 |
| content script 범위 | `https://playentry.org/ws/*` |
| WAR 공개 범위 | `https://playentry.org/*` |
| 외부 실행 코드 | 신규 추가 없음. 실행 스크립트는 패키지 내부 파일만 사용 |
| 데이터 전송·추적 | 신규 추가 없음 |
| 설명 길이 | 56자, Web Store 제한 이내 |

제품 변경 diff에서 권한 확대, 원격 코드 로딩, 분석·추적 코드, 새 외부 API 호출은
발견되지 않았다. `picture-tools.js`의 기존 `fetch`는 Entry 작품에 이미 연결된 이미지·SVG를
사용자 명령으로 읽는 경로이며 실행 코드를 내려받지 않는다.

## 자동 검증

다음 명령을 최종 working tree에서 통과했다.

```powershell
npm run verify
git diff --check
```

`npm run verify` 결과:

- ESLint: error 0, warning 0
- `check-extension`, `check-settings`, `check-page-core-loader`: PASS
- `check-function-library`, `check-block-text-copy`, `check-frame-profiler`: PASS
- 개발용 빌드: PASS
- 제출용 allowlist 빌드: PASS, 26개 파일

수정 전 제품 코드를 대상으로 한 mutation 비교에서는 블록 복사 직접 토스트와
프레임 프로파일러 `__proto__` 특수 ID 검사가 각각 실패해 새 검사가 실제 회귀를 잡는 것도
확인했다.

## Chromium 검증

새 임시 프로필과 Chrome for Testing을 사용했다. 실사이트 검증은 공개 작품의
`https://playentry.org/ws/590e746f150c3963bf86078e`를 열어 수행했으며 저장 API는 호출하지 않았다.

| 검증 | 환경 | 결과 |
| --- | --- | --- |
| `smoke:block-text-copy` | 로컬 Entry, 디버깅 탭 OFF | PASS |
| `smoke:block-text-copy` | 실사이트, 디버깅 탭 OFF | PASS |
| `smoke:frame-profiler` | 실사이트 | PASS |
| `smoke:local` | 실사이트 종합 UI | PASS |
| `smoke:picture-tools` | 실사이트 | PASS |

블록 복사 스모크에서는 `debuggerScriptInjected=false`를 먼저 확인한 뒤 축약 생성자 이름
`a`, 중첩 if/else 복사 결과, 네이티브 성공 토스트를 검증했다. 프레임 프로파일러는 코드 이동
`activate=1`, 선택 변경 `select=0`, 일시정지·정지·재시작 수명주기를 확인했다.

종합 UI 스모크는 팝업 버전 `v2.6.3`, 디버깅 탭, 설정·실험실, 함수 보관함 ID 재매핑,
부스트 버튼의 일반·전체화면 위치를 확인했다. 모양 도구 스모크는 삭제·복제·재정렬·undo/redo,
일괄 이름변경, GIF 분해, 3개/11개 업로드 경계와 25개 업로드 취소를 확인했다.

## 제출 ZIP

- 파일: `Entry-Debugger-2.6.3-chrome-web-store.zip`
- 크기: `147,104 bytes`
- SHA-256: `D40EFDF4146E377F72F449E5743E7AA4CDADE928D8113A191D82214AB7B83BA5`
- 원본 allowlist 파일: 26개
- ZIP 내부 파일: 26개
- ZIP 루트 `manifest.json`: 확인
- manifest 버전: `2.6.3`
- 원본과 ZIP의 파일명 차이: 0개
- 원본과 ZIP의 파일별 SHA-256 차이: 0개
- `dist/`, `tools/`, `지식/`, test/fixture, `.md`, source map 포함: 0개

## 대시보드 제출 시 확인

- Package 탭에서 위 ZIP을 **Upload New Package**로 업로드한다.
- Store listing의 변경사항에는 사용자 영향이 있는 토스트 복구와 프레임 프로파일러 안정성
  개선을 우선 기재한다.
- 신규 권한이나 데이터 수집은 없으므로 기존 Privacy practices 선언과 일치하는지만 다시
  확인한다.
- 업로드 뒤 자동 manifest 검사 결과를 확인하고 새 검토를 제출한다.
