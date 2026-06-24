---
상태: 설계
범위: 프로젝트:Entry Debugger
갱신: 2026-06-24
---

# Entry Debugger 할 일

현재 열린 항목 없음.

> **완료(2026-06-24)**
> - `Alt` 단일 블록 드래그가 실제 마우스 이벤트에서 동작하지 않던 문제와,
>   statement 내부 첫 블록(`만일 참이라면 { x좌표 -> y좌표 }`의 `x좌표` 등)이
>   단일 분리되지 않던 문제를 수정(`ca5a6a3`).
> - `main`에 남아 있지 않은 작업 후보를 점검했다. 원격 미병합 브랜치는 없고,
>   stale 로컬 브랜치 `feature/boost-toggle-fullscreen-position`,
>   `feature/debug-tab-icon`, `feature/function-number-to-hangul`,
>   `fix/remove-eo-uploader-coordinate`와 관련 `_review` worktree를 삭제했다.

> **완료(2026-06-23)**
> - `만약~라면~아니면` 블록 텍스트 복사 오류 수정(`523bf43`), 함수 보관함
>   `numberToHangul` 예제(`86e5bde`).
> - 지식 폴더 정리: 완료 일회성 문서 10개를 [`지식/_archive/`](./_archive/)로 이관,
>   `README.md`·`_docs/INDEX.md` 갱신, `build-dev-extension-windows-crlf.md`를
>   "해결됨"으로 정정.
> - `entry-debugger-supported-features.md` 현행화: 2.6.x 기준으로 모양 탭 편의 기능·
>   프레임 프로파일러 섹션 추가, 토스트 표현 정정(네이티브 토스트), 구현 파일·소개
>   초안 보강.
