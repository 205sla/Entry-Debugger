# EntryJS 4.56.0 (PR #3085) × Entry Debugger — 영향 분석 보고서

- 분석일: 2026-07-29
- 대상: Entry Debugger 확장 (14개 inject 스크립트)
- 업스트림: entrylabs/entryjs PR #3085 (4.56.0)

---

## 요약 판정

| Inject 스크립트 | 판정 | 비고 |
|---|---|---|
| **picture-tools.js** | ⚠️ 주의 | 스크롤 이중 보존 — 무해하나 모니터링 필요 |
| **frame-profiler.js** | ✅ 안전 | scope/executor 구조 변경 없음 |
| **inject.js** | ✅ 안전 | setX(500)/setY(0) 모두 clamp 범위 내 |
| **turbo-mode.js** | ✅ 안전 | Engine prototype 변경 없음 |
| **boost-mode.js** | ✅ 안전 (보완적) | fullscreen 입력 수정이 오히려 도움 |
| **single-block-drag.js** | ✅ 안전 | BlockView 변경 없음 |
| **console-debugging.js** | ✅ 안전 | dialog/dialog_time 블록 변경 없음 |
| **function-usage-inspector.js** | ✅ 안전 | 읽기 전용, 구조 변경 없음 |
| **entry-adapter.js** | ✅ 안전 | 접근 API 변경 없음 |
| **patch-registry.js** | ✅ 안전 | 인프라, 업스트림 무관 |

**종합: 차단(breaking) 변경 없음. 코드 수정 불필요. 1건 모니터링 권장.**

---

## A. 상세 호환성 분석

### 1. picture-tools.js × `runWithScrollPreserved` (⚠️ 주의)

**변경 내용:**
- 4.56.0에서 `playground.updatePictureView()` 내부가 `Entry.Utils.runWithScrollPreserved(this.pictureListView_, callback)`로 감싸짐
- callback 안에서 `pictureSortableListWidget.setData({items:[]})` → `setData({items: list})`

**Entry Debugger 경로:**
- `picture-tools.js`의 `keepScroll()` (라인 717-724)은 `getScroller()` → `.rcs-inner-container`의 `scrollTop`을 저장/복원
- `patchIncrementalInject()` (라인 1950-1977)은 `pg.injectPicture`를 패치하여 append-only 시나리오를 최적화

**코드 경로 추적:**

```
모양 드래그 순서 변경
  → Entry 내부: updatePictureView() 호출
    → runWithScrollPreserved(pictureListView_, () => {
        setData({items:[]})  ← DOM 전부 파괴
        setData({items:list}) ← DOM 재생성, .rcs-inner-container 새로 생김
      })
    → scrollTop 복원 (새 .rcs-inner-container에)
    → reloadPlayground() 호출
      → picture-tools의 patchIncrementalInject가 인터셉트
        → append-only가 아니면 orig(원본 injectPicture) 호출
          → 이 안에서 keepScroll()이 또 scrollTop 저장/복원
```

**결론:**
- `runWithScrollPreserved`가 먼저 복원 → `injectPicture`는 `reloadPlayground()` 안에서 호출됨 → 이 시점에 스크롤은 이미 복원된 상태
- picture-tools의 `keepScroll()`이 같은 값을 다시 한번 복원 = **이중 복원이지만 같은 값이라 무해**
- `requestAnimationFrame(restore)` (라인 723)도 같은 값 재적용 → flicker 없음

**주의 사항:**
- `setData({items:[]})` 시점에 `.rcs-inner-container`가 파괴되고 재생성되는데, `runWithScrollPreserved`는 callback 후 `containerEl.querySelector('.rcs-inner-container')`로 새 요소를 재취득 → 정상
- picture-tools의 `getScroller()`도 매번 DOM에서 탐색 → 정상
- **타이밍 이상 시나리오**: `withSuppressedPictureRender`로 `injectPicture`가 no-op으로 교체된 상태에서 `updatePictureView` 진입 시 → `runWithScrollPreserved`는 정상 실행되고, `reloadPlayground()`도 suppress됨 → 스크롤은 `runWithScrollPreserved`가 복원 → 정상

**심각도: P4 (무해, 모니터링만)**

---

### 2. frame-profiler.js × scope/executor (✅ 안전)

**`deriveHat()` (라인 119-128):**
```javascript
function deriveHat(ex) {
  var b = ex.scope && ex.scope.block;
  if (!b || typeof b.getThread !== 'function') return null;
  var th = b.getThread();
  var hat = th && typeof th.getFirstBlock === 'function' ? th.getFirstBlock() : null;
  ...
}
```

**scope 구조 (4.56.0에서 변경 없음):**
- 7월 diff의 11개 파일에 `src/playground/scope.js`가 없다 — scope 읽기 경로는 그대로다
- `scope.block`은 Block 인스턴스 프로퍼티이고, `scope`에 새 프로퍼티가 추가되지도 않았다

> 정정(2026-07-31): 초판은 이 자리에서 `filterReservedKeywords` / `Scope._reservedKeywords` 강화를
> 4.56.0 변경으로 들었으나, 그 코드는 **5월 29일 커밋 `668c3d6f8`**(prototype pollution Stored XSS 차단,
> 6월 2일 PR #3073으로 머지)에서 들어왔다.
> 6월 5일 시점의 로컬 `upstream/entryjs` HEAD에 이미 포함돼 있어 4.56.0 영향 범위 밖이다.
> frame-profiler에 대한 판정(안전)은 바뀌지 않는다 — 오히려 근거가 더 단순해진다(변경 자체가 없음).

**`wrapExecute` 접근:**
- `this.id`, `this.scope.block`, `this.code.object`, `this.isEnd()` — 모두 Executor 인스턴스 프로퍼티
- PR #3085에서 Executor/Code 클래스 변경 없음

**결론: 완전 안전. scope 읽기 경로에 변경 없음.**

---

### 3. inject.js × `Variable.sanitizeCoordinate` (✅ 안전)

**Entry Debugger의 좌표 사용:**
```javascript
const SYSTEM_VARIABLE_HIDE_X = 500;   // 화면 밖으로 숨기기
const SYSTEM_VARIABLE_HIDE_Y = 0;
const SYSTEM_VARIABLE_SHOW_X = 0;     // 원점 복귀
const SYSTEM_VARIABLE_SHOW_Y = 0;
```

**4.56.0 clamp 범위:** `±10000`

**검증:**
- `sanitizeCoordinate(500)` → `500` (범위 내, 변환 없음)
- `sanitizeCoordinate(0)` → `0` (범위 내, 변환 없음)
- `writeVariableCoordinate`는 `v.setX(value)`를 호출 → 4.56.0에서 `this.x_ = Variable.sanitizeCoordinate(x)` → `500` 그대로

**`Entry.Variable.create(json)` 호환:**
- inject.js 라인 724에서 `new Entry.Variable(varData)` 호출
- 4.56.0 생성자: `this.x_ = variable.x ? Variable.sanitizeCoordinate(variable.x) : null`
- varData에 x/y가 없으면 `null` (기존과 동일), 있으면 clamp 적용 (정상 범위면 무변환)

**결론: 완전 안전. 모든 좌표값이 ±10000 범위 내.**

---

### 4. boost-mode.js × `_bindInputFieldFullScreenChange` (✅ 안전 — 보완적)

**boost-mode.js의 동작:**
- `entry.options.useWebGL = '1'` 설정 (Entry.init 전)
- CSS fullscreen이 아닌 **WebGL 렌더러 전환**  `requestFullscreen` API 미사용
- DOM 수준에서 `document.fullscreenElement`에 영향 없음

**4.56.0의 `_bindInputFieldFullScreenChange`:**
```javascript
const inputParent = document.fullscreenElement || document.webkitFullscreenElement || document.body;
if (hiddenInput.parentNode !== inputParent) {
  inputParent.appendChild(hiddenInput);
}
```
- `fullscreenchange` 이벤트 리스너 등록
- boost-mode는 fullscreen 이벤트를 트리거하지 않음 → 이 핸들러 미실행

**Entry Save의 전체화면 (iframe.requestFullscreen)과의 관계:**
- Entry Save가 `requestFullscreen`을 호출하면 `fullscreenchange` 발생
- 4.56.0의 핸들러가 `hiddenInput`을 fullscreen element로 이동 → **이전에 입력 안 되던 문제 해결**
- Entry Debugger 관점에서는 이 수정이 오히려 도움이 됨

**결론: 충돌 없음. 오히려 전체화면 입력 문제를 업스트림이 해결해줌.**

---

### 5. turbo-mode.js (✅ 안전)

**접근 API:**
- `Entry.Engine.prototype.setSpeedMeter` — PR에서 변경 없음
- `Entry.Engine.prototype.toggleSpeedPanel` — PR에서 변경 없음
- `Entry.isTurbo` — 플래그 직접 쓰기, PR에서 참조하지 않음
- `entry.engine.speeds` — PR에서 변경 없음

**결론: Engine 관련 변경 없음. 완전 안전.**

---

### 6. single-block-drag.js (✅ 안전)

**접근 API:**
- `Entry.BlockView.prototype.onMouseDown` / `terminateDrag` — PR에서 BlockView 변경 없음
- `entry.do('separateBlock'/'insertBlock')` — 명령 시스템 변경 없음
- `block.getBlockType()` / `getNextBlock()` / `getPrevBlock()` / `getThread()` — 변경 없음

**결론: 완전 안전.**

---

### 7. console-debugging.js (✅ 안전)

**접근 API:**
- `Entry.block.dialog` / `Entry.block.dialog_time` — PR에서 이 블록 정의 변경 없음
- `script.getField`/`getValue`/`callReturn` — 런타임 프로토콜 변경 없음
- `Entry.console.print` — 변경 없음
- `Entry.playground.blockMenu.deleteRendered('looks')` — 변경 없음

**결론: 완전 안전.**

---

### 8. function-usage-inspector.js (✅ 안전)

**접근 API:**
- `variableContainer.functions_` (object), `variables_`, `lists_`, `messages_` — 구조 변경 없음
- `func.content.getBlockList(false)` / `_blockMap` — 변경 없음
- 읽기 전용 + 500ms 폴링 → side-effect 없음

**새 하드웨어 블록(codingboxv2) 추가 관련:**
- inspector는 block type에 관계없이 `block.params`를 순회하며 ID 매칭
- unknown 블록 type은 무시됨 (known types만 기록)
- try/catch 보호 있음

**결론: 완전 안전.**

---

## B. 잠재적 회귀 시나리오

### 시나리오 1: 스크롤 이중 복원 (P4 — 무해)

| 항목 | 내용 |
|---|---|
| **재현 조건** | 모양 탭 → 모양 20개+ → 스크롤 중간 → 모양 순서 드래그 변경 |
| **예상 동작** | `runWithScrollPreserved` 복원 → `keepScroll()` 동일 값 재복원 |
| **증상** | 없음 (같은 값 이중 적용) |
| **발생 확률** | 100% (항상 이중 복원 경로 탐) |
| **심각도** | P4 — 기능 영향 없음, 미세한 성능 오버헤드(무시 가능) |
| **조치** | 불필요. 향후 최적화로 `keepScroll()` 제거 고려 가능하나 우선순위 낮음 |

### 시나리오 2: 전체화면 + 입력 필드 (P5 — 이미 해결됨)

| 항목 | 내용 |
|---|---|
| **재현 조건** | Entry Save v1.3.7 전체화면 + "묻고 답하기" 블록 실행 |
| **예상 동작** | 4.56.0의 `_bindInputFieldFullScreenChange`가 `hiddenInput`을 fullscreen element로 이동 |
| **증상** | 이전: 입력 불가 → 이후: 정상 입력 가능 |
| **발생 확률** | 100% |
| **심각도** | P5 — 긍정적 변화 (기존 문제 해결) |
| **조치** | 불필요 |

### 시나리오 3: 변수 좌표 극단값 (P5 — 해당 없음)

| 항목 | 내용 |
|---|---|
| **재현 조건** | Debugger가 `setX(값 > 10000)` 호출 시 |
| **현재 코드** | `HIDE_X = 500`, `SHOW_X = 0` — 극단값 미사용 |
| **증상** | 해당 없음 |
| **발생 확률** | 0% |
| **조치** | 불필요. 향후 좌표를 바꿀 일이 있으면 ±10000 제한 인지 |

### 시나리오 4: patchIncrementalInject + updatePictureView 타이밍 (P4 — 무해)

| 항목 | 내용 |
|---|---|
| **재현 조건** | 모양 대량 추가(GIF 대량업로드 등) 중 append-only 경로 진입 |
| **경로** | `updatePictureView()` → `runWithScrollPreserved` → `setData` → `reloadPlayground()` → patched `injectPicture` → append-only 판정 → `flushAppend` (50ms 후) |
| **분석** | `runWithScrollPreserved`는 `setData` 내에서 동기적으로 완료. `reloadPlayground()` → `injectPicture()` 호출 시 이미 스크롤 복원 완료. `flushAppend`는 50ms 후 `setData`로 최종 렌더 — 이때 스크롤은 그 시점의 현재값 사용 |
| **증상** | 없음 |
| **심각도** | P4 |

### 시나리오 5: withSuppressedPictureRender 중 updatePictureView 호출 (P4)

| 항목 | 내용 |
|---|---|
| **재현 조건** | 다중선택 삭제 등 batch 작업 중 `injectPicture`가 no-op으로 교체된 상태에서 다른 경로로 `updatePictureView` 진입 |
| **분석** | `updatePictureView` 내부의 `setData`는 정상 실행 (suppress 대상이 아님). `runWithScrollPreserved`도 정상. 후속 `reloadPlayground()`가 suppress되어도 `setData`로 이미 리스트 갱신됨 |
| **증상** | 없음 — suppress는 `pg.injectPicture`와 `pg.reloadPlayground` 인스턴스 메서드를 교체하는데, `updatePictureView`는 `this.pictureSortableListWidget.setData`를 직접 호출 |
| **심각도** | P4 |

---

## C. 검증 테스트 체크리스트

### 필수 (업데이트 후 즉시)

- [ ] **모양 탭 스크롤 보존**: 모양 20개 추가 → 중간 스크롤 → 드래그로 순서 변경 → 스크롤 위치 유지 확인
- [ ] **모양 다중선택 삭제**: 중간 스크롤 → 3개 선택 → 삭제 → 스크롤 위치 유지
- [ ] **GIF 대량업로드**: GIF 5장 동시 업로드 → 모양 리스트에 전부 표시 → 스크롤 정상
- [ ] **변수 숨기기/보이기**: 디버거에서 타이머/대답 숨기기 → 보이기 → 좌표 (0,0) 정상
- [ ] **프레임 프로파일러**: 실험실 ON → 작품 실행 → tick/execute 시간 정상 → "코드로 이동" 정상
- [ ] **전체화면 입력**: 작품보기 전체화면(⛶) → "묻고 답하기" 실행 → 텍스트 입력 가능
- [ ] **터보 모드**: 속도패널 → ∞ 클릭 → 실행 속도 증가 확인
- [ ] **콘솔 디버깅**: 말하기 블록 드롭다운 → [LOG] 선택 → Entry 콘솔에 출력

### 권장 (시간 되면)

- [ ] **부스트 모드(WebGL)**: 활성화 → 새로고침 → WebGL 렌더링 확인 → "묻고 답하기" 입력 정상
- [ ] **단일블록 드래그**: Alt+드래그 → 스택 중간 블록만 분리 → Ctrl+Z 1회로 복원
- [ ] **함수 사용처**: 변수 패널 → 함수 선택 → 사용처 목록 정상 표시
- [ ] **SPA 전환**: 만들기 → 작품보기 → 만들기 복귀 → 모든 기능 정상
- [ ] **모양 순서 변경 Undo**: 드래그로 순서 변경 → Ctrl+Z → 원래 순서 복원

---

## D. 선제적 코드 수정

**수정 불필요.** 4.56.0의 변경사항과 Entry Debugger 사이에 breaking change가 없다.

향후 최적화 고려사항 (우선순위 낮음):
- `picture-tools.js`의 `keepScroll()`이 이제 `runWithScrollPreserved`와 중복되므로, EntryJS 4.56.0 이후 버전만 지원한다면 `keepScroll()` 호출을 제거하여 코드 단순화 가능. 단, 이전 버전 호환을 유지하려면 현재 상태 유지가 안전.

---

## E. 결론

EntryJS 4.56.0 (PR #3085)는 Entry Debugger에 대해 **하위 호환**이다.

- 11개 변경 파일 중 Entry Debugger가 사용하는 API를 직접 변경하는 것은 `Variable.setX`/`setY`뿐이며, 디버거의 좌표값(500, 0)은 clamp 범위(±10000) 내에 있어 동작 변화 없음
- `runWithScrollPreserved`는 picture-tools의 `keepScroll()`과 기능 중복이나, 이중 적용은 무해(같은 scrollTop 값 재적용)
- `_bindInputFieldFullScreenChange`는 전체화면 입력 문제를 업스트림에서 해결 — 디버거/Entry Save에 긍정적
- 하드웨어 블록 변경(`block_altino_neo.js` 수정, `block_codingboxv2.js` 신규)은 Entry Debugger와 무관

> 정정(2026-07-31): 초판은 여기서 `filterReservedKeywords` 강화와 "lodash 변경"을 4.56.0 항목으로 들었으나
> 둘 다 7월 diff에 없다(전자는 6월 PR #3073, 후자는 아예 부재). 4.56.0의 실제 변경 파일 목록은
> [`upstream/지식/entryjs-4.56.0-2026-07-update.md`](../../../upstream/지식/entryjs-4.56.0-2026-07-update.md) 참조.

**조치**: 코드 변경 없이 4.56.0 배포 후 필수 테스트 체크리스트 실행으로 충분.
