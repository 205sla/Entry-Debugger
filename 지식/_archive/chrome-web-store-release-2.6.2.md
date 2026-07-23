# Chrome Web Store 2.6.2 제출 점검

확인 날짜: 2026-07-23

대상 브랜치: `fix/block-text-copy-linebreak-schema`

## 범위

- 반복문 안에 중첩된 `만일~아니면` 텍스트 복사 분기 위치 수정
- `FieldLineBreak` 생성자 이름 외에 Entry 인스턴스와 블록 스키마를 이용한 판정 추가
- 중첩 if/else 복사 정적 회귀 검사와 실제 Chromium 전용 스모크 추가
- 전체 스모크의 부스트 좌표 검사를 절대 위치 비교에서 레이아웃 변화량 비교로 수정
- 프레임 프로파일러 스모크를 `activateBlock` 호출 및 `setSelectedBlock` 미호출 기준으로 현행화
- 확장 버전 `2.6.2`

manifest 권한은 `storage`만 유지하고 production 대상 URL은
`https://playentry.org/ws/*`로 유지했다.

## 정적 검증

다음 검증을 모두 통과했다.

```powershell
npm.cmd run check
npm.cmd run build:dev
git diff --check
node --check tools\smoke-block-text-copy.js
node --check tools\smoke-local-extension.js
node --check tools\smoke-frame-profiler.js
```

`npm.cmd run check`에는 중첩 if/else와 일반 단일 statement 블록 복사를 실제
`block-text-copy.js` 전체 스크립트로 실행하는 `check-block-text-copy.js`가 포함된다.

## 실제 Chromium 검증

로컬 Entry 작업실 `http://127.0.0.1:8080/ws/abcdef0123456789abcdef01`에
`dist/entry-debugger-extension-dev`를 실제 확장으로 로드해 다음을 확인했다.

| 검증 | 결과 |
| --- | --- |
| `npm.cmd run smoke:block-text-copy` | PASS |
| `npm.cmd run smoke:local` | PASS |
| `npm.cmd run smoke:picture-tools` | PASS |
| `npm.cmd run smoke:frame-profiler` | PASS |

블록 복사 전용 스모크는 실제 Entry 블록 모델과 `FieldLineBreak` 인스턴스를 사용한다.
줄바꿈 필드의 표시 생성자 이름을 축약된 `a`로 바꾼 상태에서도 다음 결과가
클립보드에 복사되는지 확인했다.

```text
시작하기 버튼을 클릭했을 때
(10) 번 반복하기
  만일 (참) (이)라면
    이동 방향으로 (10) 만큼 움직이기
  아니면
    이동 방향으로 (10) 만큼 움직이기
```

Windows 클립보드가 줄바꿈을 CRLF로 반환하므로 비교할 때 LF로 정규화한다.

전체 스모크 검토 중 제품 결함이 아닌 오래된 테스트 기준 두 건도 정리했다.

- 좌표 표시는 원래 엔진 상단 바에 있으므로 엔진 세로 중앙과 비교하면 항상 실패한다.
  부스트 버튼을 표시하거나 숨겼을 때 네이티브 좌표 입력의 위치·크기가 변하지 않는지
  직접 비교한다. 실측 최대 변화량은 `0px`였다.
- 프레임 프로파일러 코드 점프는 실행 중 편집 선택으로 인한 정지를 피하려고
  `activateBlock()`만 호출한다. 스모크는 `activate=1`, `select=0`을 확인했다.

`playentry.org/ws` 실사이트는 현재 브라우저 세션의 사이트 접근 제한 때문에 열 수
없었다. 이를 우회하지 않았으며, 실제 EntryJS와 확장 로드는 로컬 작업실 Chromium
검증으로 수행했다.

## 제출 ZIP

- 경로: `Entry-Debugger-2.6.2-chrome-web-store.zip`
- 크기: `145,878 bytes`
- SHA-256: `4688904FFD85FFAAC4B13147A48764A41AEDE6617352DDEF492AEAAE0BBFC2EC`
- 원본 파일: `26개`
- 압축 해제 파일: `26개`
- ZIP 루트 `manifest.json`: 확인
- manifest 버전: `2.6.2`
- 원본과 압축 해제본 파일명 차이: `0개`
- 원본과 압축 해제본 파일별 SHA-256 차이: `0개`
- `dist/`, `tools/`, `지식/`, test/fixture/source map 포함: `0개`

제출 ZIP에는 `entry-debugger-extension/`의 production 파일만 포함한다.
