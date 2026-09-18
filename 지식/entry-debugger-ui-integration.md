# Entry Debugger UI 통합 기록

확인 날짜: 2026-05-23

## 대상 파일

| 파일 | 내용 |
| --- | --- |
| `entry-debugger-extension/content.js` | Entry 속성 패널의 `.propertyTab`에 디버깅 탭 DOM 추가 |
| `entry-debugger-extension/style.css` | 디버깅 탭 아이콘과 선택 상태 스타일 |
| `entryjs-develop/src/css/components/property_panel.less` | Entry 기본 속성 탭 크기와 배경 이미지 규칙 |

## propertyTab 디자인 규칙

Entry 기본 속성 탭은 `.propertyTabElement` 공통 클래스를 사용한다.

- 탭 실제 크기: `25px x 38px`
- 원본 아이콘 이미지 크기: 주로 `50px x 76px`
- 축소 규칙: `background-size: 25px auto`
- 선택 상태: 별도 `*_on.png` 배경 이미지 사용
- 탭 텍스트: `font-size: 0`으로 숨김

따라서 확장 탭도 텍스트 버튼처럼 꾸미기보다, `.propertyTabElement.propertyTabdebugging` 조합을 유지하고 `50x76` 크기의 배경 이미지를 제공하는 편이 Entry UI와 가장 잘 맞는다.

## 디버깅 탭 적용 방식

`style.css`의 `.propertyTabdebugging`은 데이터 URI SVG를 사용한다. Entry 서버 이미지 폴더에 파일을 추가하지 않기 위해 확장 CSS 안에 비활성/활성 SVG를 직접 포함한다.

- 비활성: 연한 파란 탭 배경(`#aac5d5`) + 밝은 파란 디버깅 아이콘(`#d6e9f4`)
- 활성: 파란 탭 배경 + 흰색 디버깅 아이콘
- 배치: `background-position: 0 0`

`background-position: center center`처럼 중앙 정렬을 강제하면 Entry의 기본 탭 이미지 규칙과 어긋난다. 특히 접힘 상태에서는 `.collapsed .propertyTabElement` 규칙이 배경 위치를 조정하므로, 디버깅 탭은 기본 탭과 같은 좌표계를 쓰는 것이 안전하다.

## 속성 사용 위치 목록 디자인

Entry 기본 속성 패널의 사용 위치 목록은 다음 구조와 스타일을 중심으로 한다.

- 제목: `.box_sjt`
- 목록: `.obj_list`
- 항목 왼쪽 표시: `.thmb`
- 항목 오른쪽 텍스트: 12px, 굵기 600, `#2c313d`
- 배경 영역: 속성 패널의 연한 파란색 배경 위에 별도 카드 없이 배치

따라서 `함수에서 사용` 확장 UI도 독립 카드 스타일을 피하고, 제목에는 `.box_sjt`, 목록에는 `.obj_list`, 왼쪽 표식에는 `.thmb`를 함께 붙인다. 함수 내부 위치에는 실제 오브젝트 썸네일이 없으므로 Entry의 함수 속성 아이콘과 같은 형태의 작은 함수 아이콘을 사용하되, 크기와 테두리는 Entry 기본 썸네일 칸에 맞춘다.

## 팝업 기능 토글

팝업은 기능별 설정을 `chrome.storage.local`에 저장한다.

| 키 | 의미 |
| --- | --- |
| `enabled` | 전체 기능 중 하나라도 켜져 있는지 |
| `debuggerTabEnabled` | 속성 패널의 `디버깅` 탭과 디버거 패널 사용 여부 |
| `functionUsageEnabled` | 속성 탭의 `함수에서 사용` 바로가기 표시 여부 |

`background.js`는 `SET_SETTINGS` 메시지를 받으면 저장 후 열린 Entry 워크스페이스 탭에 `APPLY_SETTINGS`를 브로드캐스트한다. `content.js`는 이 설정을 받아 두 기능을 별도로 적용한다.

- `debuggerTabEnabled` 꺼짐: `.propertyTabdebugging`과 `#ed-debugger-panel` 제거
- `functionUsageEnabled` 꺼짐: `STOP_FUNCTION_USAGE_POLLING` 전송, `.ed-native-function-usage` 제거
- 모두 꺼짐: 두 기능 모두 정리

## 실시간 값 갱신 시 스크롤·편집 상태 유지

확인 날짜: 2026-09-18

`content.js`는 스냅샷을 받을 때 카드와 입력창을 연결된 DOM에 유지해야 한다.
기존 카드를 `DocumentFragment`로 이동한 뒤 목록을 비우고 다시 붙이면 실제 Chromium에서
입력창의 `blur`가 발생한다. 이때 `ed-editing`이 해제되어 다음 스냅샷이 입력 중인 값을
덮어쓰고, 변수 목록의 스크롤 위치도 위로 이동했다.

- 변수·리스트·기본 변수·신호·장면 카드에는 `reconcileChildren`을 사용한다.
  사라진 카드만 제거하고, 같은 위치에 있는 카드는 이동시키지 않는다.
- 펼친 리스트는 인덱스별 행을 재사용하고 추가·삭제된 행만 삽입·제거한다.
  편집 중인 행의 값은 유지하면서 나머지 행은 계속 갱신한다.
- 새 항목 입력창도 교체하거나 분리하지 않아 포커스와 선택 영역이 유지된다.

회귀 검사: `npm run build:release` 후 `npm run smoke:live-values`.
실제 `playentry.org` 편집기에 임시 변수 45개와 리스트 60개 항목을 추가하고,
Entry 모델 변경 → 확장의 200ms 폴링 → UI 갱신 경로를 검사한다.
확인 항목은 스크롤, 입력값·포커스·선택 방향, 적용 버튼·Enter, 새 항목 입력,
행 증감·삭제, 변수 추가·제거·검색, 기본 변수 편집이다. 작품은 저장하지 않는다.
결과와 화면 캡처는 `dist/live-values-evidence/`에 생성된다.
