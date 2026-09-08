# 실험실 작품 썸네일 변경 (2026-09-08)

## 동작과 참고 출처

- 사용자 요청: 원하는 썸네일 선택, GIF·영상의 자동 APNG 변환, 용량 조절, GitHub ID 기반 크레딧.
- 참고: https://github.com/qwert1566/changeThumb/releases/tag/1.0 (`script.js`, tag 1.0).
  `Entry.canvas_.toDataURL` 반환값을 선택한 PNG data URL로 바꾸고 사용자가 작품을 저장하는 방식이다.
- 원본은 1,000,000바이트 초과 시 경고만 한다. 이 값이 Entry 서버의 강제 제한이라는 근거는 없다.
- 새 구현은 900,000바이트 이하 결과만 적용한다. 서버 저장 성공을 보장하는 제한값으로 표현하지 않는다.
- 크레딧에는 GitHub ID `qwert1566`을 기존 기여자와 같은 형식으로 표시한다.
  원본 LICENSE의 저작권 표기는 `qwert1366`이므로 고지 파일에는 원문 그대로 보존했다.

## 구현

- `thumbnail-media.js`: 격리된 content script에서 네이티브 ImageDecoder, video/canvas,
  CompressionStream을 사용한다. PNG Sub 필터, RGBA, zlib, CRC32와 APNG 시퀀스 청크를 직접 구성한다.
  외부 코덱/스크립트/변환 서비스는 사용하지 않는다.
- 입력 50MiB 이하, 최대 약 1,600만 화소. 처음 6초, 최대 480×270/12fps.
  디코딩한 GIF는 합성된 프레임을 샘플링하고 표시 시간을 합산한다. 샘플링한 RGBA 프레임만 보관한다.
- 예산 초과 시 480×270/간격1 → 384×216/간격2 → 320×180/간격3 →
  240×135/간격4 → 160×90/간격6으로 다시 압축한다. 프레임 간격을 늘려도 총 재생 시간은 유지한다.
  어느 프로필도 예산을 만족하지 않으면 적용을 차단한다.
- `thumbnail-ui.js`: 파일 선택, 진행 상태, 미리보기, 명시적 적용, 취소/해제, 응답 확인.
  변환은 90초, 미디어 이벤트는 15초, 모듈 로드는 10초, 적용 응답은 5초 제한을 둔다.
  늦게 끝난 변환의 결과는 revision으로 폐기한다. Object URL/VideoFrame/decoder/미디어 소스를 정리한다.
- `thumbnail-override.js`: 필요할 때만 main world로 로드한다. API 존재 여부와 PNG URL/크기 확인 후
  현재 canvas 인스턴스의 메서드만 교체한다. 중복 적용 시 wrapper를 쌓지 않는다.
  원래 property descriptor를 보존하고, 다른 확장의 나중 wrapper를 덮어쓰지 않는다.
  해제/실험실 OFF/디버깅 패널 제거/pagehide에서 복원한다. 작품 경로나 canvas가 바뀌면
  이전 wrapper는 원래 함수로 위임하며 다른 작품의 썸네일을 반환하지 않는다.
- 권한은 기존 `storage` 그대로다. 새로운 WAR은 `thumbnail-override.js` 하나이며 기존 origin 범위다.
  production allowlist는 라이선스 고지 포함 30개 파일이다. 이미지/영상은 storage에 저장하지 않는다.

## 검증

실행 환경: Chrome for Testing 131.0.6778.204, Node 22.17.0.

```powershell
npm run verify
$env:ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE='C:\Users\young\.cache\puppeteer\chrome\win64-131.0.6778.204\chrome-win64\chrome.exe'
npm run smoke:thumbnail
npm run smoke:settings-sync
```

- `verify`: lint 경고 0, 기존 검사 및 새 override 검사 통과, 개발/제출 빌드 생성 성공.
- 새 override 검사: 원래 메서드/descriptor 복원, 중복 적용, 다른 확장 wrapper, 경로 변경,
  잘못된 데이터/과대 URL/다른 origin·source 메시지 거부, canvas 없음, pagehide.
- 썸네일 스모크: Chromium에서 GIF → APNG → APNG 재입력을 실행하고, Node zlib로 독립 복원한
  픽셀이 빨강/파랑이며 지연이 0.2/0.3초임을 확인. 모든 청크 CRC·시퀀스·프레임 수 검사.
  투명 정적 PNG, 비어 있거나 손상/과대 입력, 취소 검사도 통과.
- 7.2초 잡음 WebM은 6초 APNG로 잘리고, 자동 축소 후 160×90/12프레임/590,721바이트였다.
  영상 인코딩은 실행마다 차이가 있을 수 있어 테스트는 정확한 바이트 수 대신 900KB 상한을 검증한다.
- 실제 Entry 공개 작품에서 production 확장의 GIF 선택 → 미리보기 → 적용 → 원래 함수 복원 →
  재적용 → 실험실 OFF 복원 통과. 프로젝트 저장/서버 업로드는 실행하지 않았다.
- `smoke:settings-sync`: 실제 팝업 OFF/ON 4회, 열린 편집기 2곳의 탭/패널 0↔1개 전환 통과.
- 미리보기 스크린샷: `dist/thumbnail-review/thumbnail-preview.png`.

검증 중 발견하고 처리한 사항:

1. 녹화 WebM의 duration=Infinity: 끝으로 seek하여 Chromium이 길이를 파악한 뒤 처음부터 샘플링하도록 수정.
2. 실사이트 첫 방문 안내가 클릭을 가림: 기존 실사이트 스모크와 같은 테스트 전용 CSS로 처리.
3. 스위치 내부 input은 숨김: 테스트에서 실제 보이는 스위치 label을 클릭하도록 수정.

## 실 서버 저장 검증 (2026-09-08, 완료)

- 사용자가 연결한 로그인된 Chrome에서 실험실 UI의 파일 선택 → 변환 → 적용 → 엔트리의
  저장하기를 실행했다. 새 테스트 작품 하나에 정적 PNG, GIF, WebM을 순서대로 저장했다.
- 작품: https://playentry.org/project/6a9fde98e808d8e59db2b6ec
  이름은 서버에서 `Entry Debugger 썸네일 서버 검증 2026-`로 잘려 저장됐다.
  마이페이지에서 비공개임을 확인했으며 공개 설정은 변경하지 않았다. 기존 작품은 수정하지 않았다.
- 최초의 비로그인/브라우저 미연결 문제와 파일 선택의 `Not allowed`는 사용자의 Chrome 연결 및
  ChatGPT 브라우저 확장 파일 URL 접근 허용 후 해소됐다. 제품 오류로 분류하지 않는다.

| 입력 | 변환 및 실제 저장 후 결과 | 확인 범위 |
| --- | --- | --- |
| 생성한 녹색 정적 PNG, 입력 2,644바이트 | 미리보기 PNG 2.9KB, 480×270 | 저장 완료 모달, 새 작품 주소, 별도 마이페이지의 녹색 이미지와 글자 확인 |
| 빨강/파랑 GIF, 입력 2,844바이트 | 서버 APNG 4,548바이트, 480×270, 2프레임, 200/300ms | 마이페이지 새로고침, 파란 프레임 표시, 서버 파일의 두 색상·재생 시간·CRC·청크 시퀀스 확인 |
| 7.2초 잡음 VP9 WebM, 입력 2,547,488바이트 | 서버 APNG 319,549바이트, 160×90, 12프레임, 총 6초 | 자동 축소 안내, 마이페이지 새로고침 및 편집기 재접속, 서버 파일의 서로 다른 12프레임·CRC·청크 시퀀스 확인 |

- 서버 이미지 URL은 마이페이지 해당 작품 카드의 실제 DOM에서 읽었다.
  GIF 저장 시 `?c=2026-09-08T10:12:02.777Z`, 영상 저장 시 `?c=2026-09-08T10:13:13.523Z`로 갱신됐다.
  브라우저의 pageAssets로 해당 서버 PNG만 내려받고 Python Pillow로 독립 디코딩했다.
- 증거 파일: `dist/thumbnail-review/server/saved-gif.png`, `saved-video.png`, `verification.json`.
  JSON에는 크기·프레임별 시간·픽셀·고유 프레임 수·SHA-256이 들어 있다.
- GIF SHA-256: `793fd66803af46a1a0e3b79122c69e7f04547234f4185c4c1514068bcb7ad959`.
  영상 SHA-256: `15e8d2e4906316f88d966a87582b181d1cbcab8e67004e0856ab29a503dfc31d`.
- 테스트 작품은 최종 영상 APNG가 적용된 비공개 상태로 남겼다. 편집기는 새로고침했으므로
  페이지 내 임시 썸네일 적용은 해제됐으며, 서버에 저장된 썸네일은 유지됐다.

## 남은 범위와 배포 상태

- 실제 저장은 위 세 사례에서 통과했다. 900KB 근처의 서버 경계값, 모든 MP4/MOV/WebM 코덱,
  공개 작품 목록의 별도 이미지 처리, 장기 캐시 유지 여부까지 검증한 것은 아니다.
  900KB를 서버의 공식 최대 용량이나 모든 파일의 저장 성공 보장으로 해석하지 않는다.
- API를 교체하는 동안 같은 canvas의 일반 이미지 추출도 선택한 썸네일을 사용한다. UI에 명시했다.
- 최신 Chrome과 저사양 장치의 변환 속도는 추가 확인 대상이다.
- 버전은 2.6.3을 유지했다. 사용자 푸시 요청에 따라 `npm run verify`를 다시 실행해 통과했고,
  루트 `Entry-Debugger-2.6.3-chrome-web-store.zip`을 썸네일 기능이 포함된 30파일 빌드로 갱신했다.
- ZIP: 156,564바이트, SHA-256
  `2EB8DD58C8B8284469E14C49DB47398E63968B7F22D7F9C7039665A42CFBC265`.
  루트 manifest의 MV3/2.6.3, 전체 파일 집합 및 원본·release 빌드와의 바이트 일치를 확인했다.
  결과는 `dist/thumbnail-review/release-zip-verification.json`에 기록했다.
- 이전 B66A16DA… ZIP은 `dist/thumbnail-review/before-thumbnail-<SHA-256>.zip`에 보관했다.
  ZIP과 dist는 기존 .gitignore에 따라 로컬 산출물로 유지하며, 코드·테스트·문서를 커밋 대상으로 한다.
  Web Store 제출은 수행하지 않았다.
