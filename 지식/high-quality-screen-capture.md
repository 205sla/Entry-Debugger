# 실행화면 초고화질 캡처

확인 날짜: 2026-09-08. 구현 전 조사, 구현 및 검증 기록. 배포 대상: 2.7.0.

## 기준과 출처

- 작업 시작: main, HEAD `b978bc5c557dbba906c316fa92fc6acb334575a2`, 변경 없음. 상위 경로 및 저장소에 AGENTS.md 없음.
- BetterEntryScreen: https://github.com/muno9748/BetterEntryScreen/tree/76265ba7a553fbb8bb2c52751cf0a4950405c30a
  의 `BetterEntryScreen.js` 전체 및 `LICENSE` 직접 확인. MIT, Copyright (c) 2022 muno.
  캔버스 크기/중심/배율 조정과 PNG 캐시 대신 원본 SVG 로딩이 핵심이다. WebGL은 원본 texture와
  크기 보정, Canvas2D는 draw 대체를 사용한다. 원본은 영구 패치 및 마우스 이벤트 교체,
  clone 생성 코드 대체, 변수 쓰기까지 수행하므로 그대로 도입하지 않는다. MIT 전문을 배포 고지에 추가한다.
- Entry 소스: `entryjs-develop/src/class/engine.js`, `stage.js`, `entity.js`,
  `graphicEngine/GEHelper.ts`, `class/pixi/init/PIXIGlobal.ts`, `plugins/PIXISprite.ts`,
  `atlas/loader/AtlasImageLoadingInfo.ts`, `text/PIXIText.js`.
  이 로컬 소스에는 git 메타데이터가 없어 upstream 커밋은 단정하지 않는다.

## 확인한 실행/렌더링 경로

- `engine.togglePause()`는 state=pause와 프로젝트/엔진 타이머, 소리, timerInstances를 정지하고
  `dispatchEventDidTogglePause`를 발행한다. 동일 API가 재개와 버튼 모양을 복원한다.
- `engine.update()`는 run일 때 script.tick을 실행한다. 캡처에서는 호출하지 않는다.
- stage.render의 별도 타이머는 requestUpdate에 따라 `_app.render()`를 실행한다.
  Canvas2D의 stage.update는 CreateJS tick도 발생시킬 수 있으므로 캡처는 update 대신 draw를 사용한다.
- boost-mode.js는 Entry.init 전에 useWebGL을 설정한다. 토글만 바꾸면 렌더러는 교체되지 않고
  새로고침이 필요하므로 옵션값 대신 실제 `_app.renderer`로 분기한다. WebGL은 PIXI scene graph,
  Canvas2D는 CreateJS display tree를 사용한다. 부스트 임시 해제는 하지 않는다.
- WebGL의 PIXISprite는 효과를 저해상도 RenderTexture에 캐시할 수 있다. 캡처에서는 원본 texture와
  필터를 사용해 다시 그린 후 캐시 참조를 복원해야 한다. PIXIText는 renderer.resolution으로 재생성한다.
- AtlasImageLoadingInfo는 SVG 모양도 기본 .png URL로 읽는다. SVG 원본 재로딩이 필요하다.
- thumbnail-override.js는 Entry.canvas_ 인스턴스의 toDataURL을 바꾼다. 별도 출력 canvas의 toBlob으로 우회한다.
- turbo는 isTurbo/FPS만 바꾸고 profiler는 기존 pause 이벤트를 관찰한다. 정식 pause 경로를 유지한다.

## 구현 계획과 위험

1. 기존 설정 정규화/브리지/로더에 기본 OFF 설정을 추가한다. 설정의 블록 이미지 저장 바로 아래에 둔다.
2. 실제 engine.pauseButton/pauseButtonFull을 실행 상태에서 같은 폭의 일시정지/캡처 버튼 그룹으로 나눈다.
   원래 이벤트는 제거하지 않는다. OFF, DOM/엔진 교체, SPA에서는 그룹/리스너를 정리한다.
3. pause 직후 자산/폰트 준비를 제한 시간 내 기다린다. 장면/엔진/주소/실행 상태 변경은 취소한다.
4. 장면 데이터를 4배(기본 480×270 → 1920×1080)로 재렌더한다. 출력 최대 8,294,400픽셀,
   축 최대 8192 및 실제 GL 한도를 적용한다. 준비용 이미지 총량도 제한한다.
5. 라이브 뷰 변경은 await 없는 동기 구간에서만 하고 finally에서 복원한다.
   독립 canvas의 PNG 인코딩/검증/다운로드 후 실제 해상도를 안내한다.
6. PNG를 Node에서 독립 디코딩해 위치·색상·벡터 선명도 및 상태 불변을 검사한다.
   실제 playentry.org 편집기와 부스트/전체화면, 실패·취소·재개·썸네일 조합을 확인한다.

위험: Entry 내부 API 변경, CORS 원본 접근 실패, 폰트 지연, 큰 자산, GL context 소실,
외부 코드가 pause 중 장면/오브젝트를 바꾸는 경우. 원본 비트맵·이미 찍힌 도장·영상은 새 디테일을
만들 수 없다. DOM 입력창 등 canvas 밖 요소는 제외하며 확인하지 못한 환경은 검증과 구분해 기록한다.

## 구현 결과

- 런타임: `high-quality-screen-capture.js`. `screenCaptureEnabled` 기본 false.
  `enabled && screenCaptureEnabled`로 활성화하며 실험실/디버깅 탭 OFF와 독립적이다.
  저장/전파는 기존 content → background → chrome.storage.local 경로다.
- 브리지: `SCREEN_CAPTURE_READY`, `SET_SCREEN_CAPTURE_ENABLED`, `SCREEN_CAPTURE_RESULT`.
  결과에는 success/message만 보내고 이미지나 작품 데이터를 브리지/서버에 보내지 않는다.
- UI: `engine.pauseButton`/`pauseButtonFull` 원본 요소와 이벤트를 보존하고 run 상태에서만 그룹으로 감싼다.
  그룹 왼쪽은 원래 일시정지, 오른쪽은 카메라 아이콘·title·aria-label을 가진 별도 캡처 버튼이다.
  일반 화면은 기존 50% 영역 안에서 반씩 나누고, 전체화면은 200px 그룹 안에서 반씩 나눈다.
  pause/stop/OFF/DOM 교체에서는 그룹을 제거하고 원본 버튼을 복원한다. 일시정지만 눌러도 다운로드하지 않는다.
  document capture-phase click 하나와 200ms 수명주기 폴링을 활성 중에만 사용한다.
  `setPauseButton`은 PatchRegistry의 기능별 래퍼로 즉시 동기화하고 OFF일 때 원래 동작에 위임한다.
  DOM Observer를 추가하지 않는다. 오래된 DOM은 Map에서 해제하고 OFF/pagehide에서 이벤트·타이머를 제거한다.
- 정식 togglePause 후 장면/엔진/프로젝트/주소를 고정하고, 현재 엔티티 JSON·효과·변수·리스트의
  스냅샷을 준비 전후/다운로드 전에 비교한다. 외부 변경이 발견되면 실패 처리하며 자동 재개하지 않는다.
- Canvas2D: 별도 canvas에 root.updateContext + root.draw. stage.update/engine.update/ticker를 호출하지 않는다.
  원본 SVG를 고밀도 이미지로 준비하고 draw 경로에서 기존 로컬 크기를 유지한다. 효과 없는 캐시는
  잠시 우회하고 효과 캐시는 고배율로 재생성한다. 실사이트의 구형 `_cacheWidth/_cacheHeight` 방식과
  신형 bitmapCache 참조를 모두 지원하며 기존 cacheCanvas/offset/scale/id를 finally에서 복원한다.
- WebGL: 원본 texture와 필터를 사용해 활성 PIXI renderer로 렌더한다. 저해상도 효과 캐시를 우회한다.
  최초 resolution-only 구현은 85.33px 필터 영역이 86px로 반올림되면서 가는 선을 흐리게 했다.
  최종 구현은 동기 구간에서 root 중심/배율과 renderer 화면을 출력 픽셀 좌표로 변경하고,
  글자 texture는 별도 고밀도로 재생성한다. 렌더/출력 복사 후 root, renderer 크기·resolution·CSS,
  texture·효과·필터 resolution·텍스트 resolution을 복원하고 정상 크기로 렌더한다.
  복원 하나가 실패해도 나머지 정리를 수행한다. 부스트 옵션·isTurbo·FPS·엔진 루프는 바꾸지 않는다.
- 인코딩은 별도 canvas.toBlob. 투명 빈 결과를 거부하고 PNG를 실제 디코딩하여 크기도 검사한 뒤 다운로드한다.
  Entry.canvas_.toDataURL은 읽지도 바꾸지도 않는다. Object URL은 다운로드 요청 뒤 1초에 해제한다.
- 출력 상한 8,294,400픽셀(32MiB RGBA), 축 8192, GL MAX_TEXTURE_SIZE/MAX_RENDERBUFFER_SIZE를 적용한다.
  원본 이미지·임시 래스터·출력·효과/텍스트 캔버스의 처리 예산은 32×1024×1024픽셀이다.
  인코더·getImageData·GPU 버퍼 등 브라우저 부가 메모리는 별도로 발생하므로 전체 프로세스 메모리 보장은 아니다.
  큰 원본 이미지의 디코딩 자체는 브라우저가 수행하며, 로딩 직후 크기를 검사한다.
- 준비/인코딩에는 15초 제한과 취소 신호를 적용한다. 동기 JS/GPU 호출 자체를 선점 중단할 수는 없으며,
  반환 후 제한 시간을 확인한다. 렌더링 임시 상태를 가진 채 비동기 대기하지 않는다.

## 검증 환경과 재현

Windows / Chrome for Testing 131.0.6778.204, 실제 playentry.org 편집기, 확장을 로드한 새 프로필.
기준 공개 작품: `https://playentry.org/ws/590e746f150c3963bf86078e`.
처음에는 해당 작품 그대로의 1920×1080 다운로드를 확인했고, 정밀 검사에서는 저장하지 않는
임시 테스트 오브젝트·스크립트·변수/리스트를 실제 Entry 모델 API로 구성했다.

```powershell
$env:ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE='C:\Users\young\.cache\puppeteer\chrome\win64-131.0.6778.204\chrome-win64\chrome.exe'
npm run verify
npm run smoke:screen-capture

# 기존 스모크도 실사이트 URL로 실행 (로컬 서버 검증과 구분)
$env:ENTRY_DEBUGGER_SMOKE_URL='https://playentry.org/ws/590e746f150c3963bf86078e'
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE=$env:ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE
npm run smoke:local
npm run smoke:frame-profiler
npm run smoke:block-text-copy
npm run smoke:thumbnail
npm run smoke:settings-sync
```

`smoke-screen-capture.js`의 `ENTRY_CAPTURE_FOCUS=lifecycle`/`cors`는 특정 실패를 좁히기 위한 부분 실행이다.
완전 검증에서는 이 환경변수를 지정하지 않는다. PNG와 결과 JSON은 `dist/screen-capture-evidence/`에 둔다.
`png-test-utils.js`는 CRC와 IDAT 압축, PNG 필터 0~4를 Node에서 직접 해독한다.

실사이트의 최초 사용 안내는 닫기 UI로 닫는다. 재접속 시 서버 저장 없이도 Entry의 로컬 자동복구
안내가 뜰 수 있으므로 테스트 작품 복구에서 **아니요**를 눌러 새 편집기 초기화를 기다린다.
이 안내를 처리하지 않으면 Entry 객체는 있지만 stage가 아직 없어 테스트가 시간 초과된다.

### 최종 실행 결과 (2026-09-08)

| 검사 | 결과 |
|---|---|
| npm run verify | lint 0 warning, 정적/설정/로더/상한/복원 검사와 dev/release 빌드 통과. production 31파일 |
| 부스트 OFF/ON × 일반/전체화면 | 4조합 모두 1920×1080 PNG, 독립 디코딩 및 색상/좌표 일치 |
| SVG 화질 | 0.5 논리 단위 흑백 선의 56쌍 분리. 밝기 효과 + 터보 상태에서도 통과 |
| 글상자 | 한글/영문/숫자 포함. 기본 장면 텍스트 검출 픽셀 Canvas2D 5079 / WebGL 5049 |
| 실행 상태 | 캡처 직전 pause 스냅샷과 엔티티·변수·리스트·타이머·script.tick 횟수·FPS·좌표/배율 일치 |
| 재개/재캡처 | 기본 재개 버튼 사용, 일시정지 유지 및 재캡처 성공 |
| 분할 버튼 후속 검증 | 부스트 OFF/ON × 일반/전체화면 모두 두 버튼의 동일 폭·인접 배치 확인. 왼쪽 클릭 시 PNG 다운로드/캡처 결과 0, 재개 시 재분할 |
| 설정 이동 후속 검증 | 설정 섹션에서 블록 이미지 저장 다음 행인지 확인. 실험실 OFF 상태에서도 캡처 설정 유지 및 PNG 저장 성공 |
| 반복 전환 | 캡처 OFF/ON, 부스트 역순 전환 3회. 재시작 버튼은 캡처로 변하지 않음 |
| 썸네일 | 실제 파일 선택/적용 UI로 자홍색 썸네일 적용. 실행화면 PNG 정상, 캡처 후 적용 문자열 유지 |
| 오류/취소 | render·encode·font 실패, 실제 15초 timeout, OFF 취소, Canvas2D CORS 오염에서 다운로드 0, 상태 복원 |
| 중복 클릭 | 처리 중 일반/전체화면 버튼으로 추가 click 주입해 작업/결과 중복 없음 |
| 변수/리스트/펜/말풍선 | 독립 디코딩 픽셀의 정지 화면 일치율 Canvas2D 96.82% / WebGL 97.01% (가는 선/글자 경계 포함) |
| 수명주기 | 실제 장면 추가/복귀, 모의 history 주소 왕복, 실제 팝업 OFF/ON 및 reload 후 단일 토글·캡처 정상 |
| 기존 회귀 | smoke:local(실사이트 URL), smoke:frame-profiler, smoke:block-text-copy, smoke:thumbnail, smoke:settings-sync 통과 |

기본/효과/전체화면/오버레이 PNG는 `dist/screen-capture-evidence/`에서 확인할 수 있다.
`webgl-effects-turbo.png`, `webgl-overlays.png`는 실제 파일을 열어 육안으로도 구도·텍스트·선을 확인했다.
분할 UI 변경 후 `npm run verify`, `npm run smoke:screen-capture` 전체, `npm run smoke:settings-sync`를 다시 통과했다.
`canvas-split-ui.png`, `canvas-full-split-ui.png`를 열어 일반/전체화면의 버튼과 아이콘 배치도 확인했다.
결과 JSON은 기본 4조합의 해상도/선명도 수치를 기록한다. 오류/수명주기 검사는 같은 스모크의 assertion 및 로그에 있다.

## 범위와 남은 제한

- 일반/전체화면의 배경·SVG·PNG·글상자·표시 변수/리스트·펜·말풍선·밝기 효과를 검사한다.
  효과를 거친 SVG까지 0.5 단위 흑백 선이 4배 출력에서 구분되는지 확인한다.
- 비트맵과 기존 비트맵 도장은 원본 정보 이상으로 선명해지지 않는다. 오브젝트 clone은 같은
  엔티티 순회 경로에 포함하지만 복잡한 clone/도장 조합 전체를 별도 실사이트 작품으로 전수 검사하지는 않았다.
- 화면 내부 카메라/영상, 하드웨어, 입력 대기 DOM 창, 외부 확장의 사용자 정의 필터/렌더러는
  정밀 검증 대상이 아니다. DOM 입력창은 캔버스 밖에 있어 포함하지 않는다. 필요 시 이 요소를
  가진 저장하지 않는 테스트 작품에서 캡처 직전 장면과 PNG를 비교한다.
- GPU 컨텍스트 실제 소실·저메모리 기기·8백만 픽셀 경계의 장시간 스트레스는 실행하지 않았다.
  GPU 한도/출력 픽셀 상한/잘못된 배율/복원 예외 분리는 `check-screen-capture`에서 검사한다.
  특정 GPU 문제 재현 시 새 Chrome 프로필에서 위 명령을 사용하고 GL 한도와 PNG를 함께 기록한다.
- 이 작업 환경의 `upstream/entryjs-develop`에는 문서에 기재된 `serve:local` 스크립트와 dist 번들이 없다.
  따라서 localhost 스모크로 기록하지 않는다. 사용 가능한 Chromium과 실사이트 URL을 명시해 기존
  스모크 5종을 실행했으며 모두 통과했다. 로컬 서버를 복구한 환경에서는 기본 URL로 다시 실행할 수 있다.
- SPA는 실제 Entry가 떠 있는 문서에서 history 주소 왕복을 주입한 검사이며 실제 사이트 라우터의
  모든 이동 경로를 클릭한 검사는 아니다. 전체 편집기 재접속은 실제 reload로 별도 검증한다.
- CORS는 사이트 CSP가 허용하는 하위 도메인 URL을 Playwright가 브라우저 안에서만 응답하도록 한
  오염 이미지 fixture다. 보안 정책을 해제하지 않는다. 인코딩·폰트·렌더 실패·시간 초과는 실제
  렌더러/브라우저 메서드에 오류를 주입한 복원 검사이며 서버 자체 오류 재현으로 표현하지 않는다.
- 최초 구현 단계에서는 버전 2.6.3과 기존 ZIP을 유지했다. 이후 사용자 요청으로 2.7.0 배포를 준비했다.
  [2.7.0 제출 점검](./_archive/chrome-web-store-release-2.7.0.md)에 버전·검증·ZIP 및 GitHub 갱신 범위를 기록한다.
  권한은 storage 유지. 스토어 업로드·심사 제출·작품 저장/게시 없음.
