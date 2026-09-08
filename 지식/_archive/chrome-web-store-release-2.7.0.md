# Chrome Web Store 2.7.0 제출 검토

확인일: 2026-09-08

## 판정과 범위

실행한 검토·검증 범위에서 제출 차단 결함 없음. 기존 2.6.3보다 큰 2.7.0으로 준비했다.
사용자가 최종 검토, 버전 변경, ZIP 생성과 GitHub 갱신을 요청한 작업이다.
Chrome Web Store 업로드·심사 제출과 Entry 작품 저장/게시는 수행하지 않았다.

- 시작: main, 로컬 HEAD 및 실제 origin/main 모두 b978bc5c557dbba906c316fa92fc6acb334575a2.
- 기존 작업 트리의 캡처 기능과 UI·문서 변경을 보존하고 검토했다.
- 기능 커밋: ba9235f (실행화면 캡처, 분할 버튼, 설정 이동 및 명칭 정리).
- 그 뒤 별도 릴리스 커밋에서 manifest·README·지원 기능 대상 버전을 2.7.0으로 맞춘다.
- GitHub 갱신 대상: 205sla/Entry-Debugger의 main과 v2.7.0 태그. 기존 태그/이력은 덮어쓰지 않는다.
- ZIP은 기존 .gitignore 정책에 따라 로컬 산출물로 유지한다.

## 검토한 동작

- 일시정지/캡처 버튼은 동일 폭이며 왼쪽은 기존 엔진 이벤트를 유지한다.
  pause/stop/OFF에서는 분할을 해제하고 재개 버튼을 복원한다.
- 캡처 설정은 블럭 이미지 초고화질 저장 바로 아래에 있고 기본 OFF, 실험실과 독립적이다.
- 캡처에서 실행 tick을 추가하지 않으며 Canvas2D/WebGL의 실제 장면을 다시 렌더링한다.
  부스트를 끄지 않고 렌더러 크기·변환·효과·텍스트 설정을 동기 구간에서 변경/복원한다.
- 별도 출력 canvas.toBlob을 사용하므로 Entry.canvas_.toDataURL의 썸네일 교체와 충돌하지 않는다.
- CORS, 이미지/폰트 준비, 인코딩, 15초 제한 시간, 취소 시 오류를 알리고 일시정지를 유지한다.
- 수명주기 정리, 중복 클릭 방지, Object URL 및 임시 이미지/캔버스 정리를 확인했다.
- Manifest V3, storage 권한만 사용, 신규 host permissions 없음. content script 범위는
  https://playentry.org/ws/* 유지. 원격 실행 코드·변환 서비스·추적 전송 추가 없음.
- BetterEntryScreen 참고 커밋 76265ba7a553fbb8bb2c52751cf0a4950405c30a의 실제 MIT LICENSE와
  배포 고지를 비교했다. Copyright (c) 2022 muno 전문 및 GitHub ID muno9748 크레딧 포함.

## 실행한 검증

기능 최종본(버전 변경 전 2.6.3 표기)에서 아래 7종을 모두 다시 실행해 통과했다.
버전 변경은 manifest·문서만 바꾸었으며 실행 코드는 동일하다.

| 검사 | 결과 |
|---|---|
| npm run verify | 버전 변경 전/후 모두 통과. 린트 0 warning, check 9종, dev/release 빌드 |
| smoke:screen-capture | 부스트 OFF/ON × 일반/전체화면 4조합, 1920×1080 PNG 독립 디코딩, SVG 가는 선 56쌍 구분 |
| 캡처 상태/복원 | pause 시 엔티티·변수·타이머·tick 횟수 보존, 재개/반복 토글/썸네일/실험실 OFF/오류/시간 초과/재접속 통과 |
| smoke:local | 핵심 UI·설정·함수 ID 재매핑·부스트 위치 통과. 2.7.0 변경 후 재실행해 팝업 v2.7.0 확인 |
| smoke:frame-profiler | 코드 이동, 일시정지·정지·재시작 통과 |
| smoke:block-text-copy | 디버깅 OFF 상태의 실제 중첩 블록 문자열 복사 통과 |
| smoke:thumbnail | GIF/APNG 픽셀·시간, 영상 축소, 취소 및 실사이트 적용/해제 통과 |
| smoke:settings-sync | 두 편집기에 실제 팝업 OFF/ON 2회 전파, 탭·패널 중복 없음 |
| smoke:picture-tools | 모양 명령·복제·재정렬·이름변경·GIF·배치·취소 통과 |
| git diff --check | 통과 |

환경: Windows, Chrome for Testing 131.0.6778.204, 별도 임시 프로필.
주소: https://playentry.org/ws/590e746f150c3963bf86078e
ENTRY_DEBUGGER_SMOKE_URL, ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE 및
PLAYWRIGHT_CHROMIUM_EXECUTABLE을 지정했다. 로컬 서버가 없는 환경이므로 localhost 검증으로 표현하지 않는다.

캡처 증거는 dist/screen-capture-evidence/에 있다. webgl-effects-turbo.png를 직접 열어
구도·글자·가는 선을 확인했다. 모양 업로드 창은 모의 DOM이고, SPA 주소 왕복은 history 주입이다.
CORS/인코딩/폰트/렌더 실패는 오류 주입 검사이며 실사이트 서버 장애 재현이 아니다.
최신 Chrome·저메모리/GPU context 소실 스트레스·모든 작품/필터/영상 조합과 원격 심사 결과는 검증 범위 밖이다.
상세 제한은 [캡처 기록](../high-quality-screen-capture.md)을 참고한다.

## 제출 ZIP

- 파일: Entry-Debugger-2.7.0-chrome-web-store.zip
- 크기: 166421바이트
- SHA-256: 982e17d71a043bd07503407788ed0a817a06d81d388a78748961e9446d2d5f40
- 파일 31개. ZIP 루트 manifest.json, 버전 2.7.0, MV3 확인.
- PowerShell Compress-Archive로 생성하고 Python zipfile로 독립 검사했다.
  모든 ZIP 항목 CRC, 중복 파일명 부재, production allowlist 집합을 확인하고
  각 파일을 원본 및 release 빌드와 바이트 단위로 비교했다. 모두 일치한다.
- 내부 문서·테스트·개발 파일·source map 제외. THIRD_PARTY_NOTICES.txt 포함.
- 이전 Entry-Debugger-2.6.3-chrome-web-store.zip은 유지했다.
- 파일별 SHA-256과 검사 결과: dist/release-2.7.0-review/zip-verification.json.

[Chrome 제출 준비](https://developer.chrome.com/docs/webstore/prepare)와
[업데이트 안내](https://developer.chrome.com/docs/webstore/update)의 새 버전 및 루트 manifest ZIP 조건을 확인했다.
실제 스토어 업로드·심사 제출은 별도 단계다.
