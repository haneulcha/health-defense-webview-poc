# 건강 디펜스 — 웹뷰 PoC

React Native WebView에 얹는 것을 전제로 한 정통 타워디펜스 프로토타입. 지키는 대상은 "건강", 적은 건강을 해치는 요소들(초과 칼로리, 포화지방, 야식, 수면부채)이다.

이 PoC가 답하려는 질문은 두 개다.

1. **성능** — 저사양 안드로이드 WebView에서 TD 규모가 60fps로 도는가
2. **재미** — 디펜스를 해본 사람과 안 해본 사람 둘 다 몰입하는가

## 배포된 빌드

**https://haneulcha.github.io/health-defense-webview-poc/**

성능 하네스는 같은 URL에 `?perf` 를 붙이면 됩니다.

푸시하면 GitHub Actions가 타입체크와 테스트를 돌린 뒤 배포합니다 — 컴파일되지 않거나 테스트가 깨진 빌드가 테스터에게 넘어가지 않습니다.

## 실행

```bash
npm install
npm run dev          # 게임
npm run dev          # http://localhost:5173/?perf 로 M0 성능 하네스
npm test             # 단위 테스트
npm run build        # RN WebView용 단일 HTML 파일 (dist/index.html)
```

`npm run dev` 는 `--host` 로 뜨므로 같은 네트워크의 실기기에서 바로 열 수 있다.

## React Native 셸 (`shell/`)

실제로 얹힐 환경을 흉내내는 Expo 앱입니다. 브라우저가 답할 수 없는 질문 하나 — **WebView 안에서도 똑같이 동작하는가** — 를 위해 존재합니다.

```bash
cd shell
npm install
npm run ios        # 웹 빌드 → HTML 인라인 → 시뮬레이터
npm run android
```

`npm run ios` 는 먼저 `scripts/sync-game-html.mjs` 를 돌려 웹을 빌드하고, `dist/index.html` 을 `shell/game-html.ts` 문자열로 넣습니다.

**왜 에셋 파일이 아니라 문자열인가** — 에셋 로딩이 WebView 포팅에서 며칠을 잡아먹는 지점입니다. 안드로이드는 `file:///android_asset/...`, iOS는 다른 번들 경로로 해석하고, 파일 접근 플래그도 dev/release가 다릅니다. 문자열로 넘기면 이 문제군이 통째로 사라집니다. 그리고 이게 가능한 건 프로덕션 빌드가 **외부 참조가 하나도 없는 단일 HTML** 이기 때문입니다 — `vite-plugin-singlefile` 과 코드 생성 텍스처를 고른 이유가 여기서 회수됩니다. 동기화 스크립트는 외부 참조가 하나라도 있으면 빌드 타임에 실패합니다.

셸 하단에는 브릿지 로그가 있습니다. 게임이 `ready` 를 보내면 셸이 `ping` 을 돌려주고 게임이 `pong` 하는 왕복 한 번이 화면에 찍힙니다 — 디버거 없이 기기에서 브릿지 동작을 눈으로 확인하려고요.

빠른 반복이 필요하면 `shell/App.tsx` 의 `REMOTE_URL` 에 배포 URL이나 dev 서버 주소를 넣으면 됩니다.

## 구조

```
src/
  core/         렌더러를 모르는 순수 게임 로직 (테스트 대상 전부)
    sim.ts        월드 상태, 고정 60Hz timestep, 오브젝트 풀
    wave-runner.ts  준비 → 웨이브 → 클리어 사이클
    path.ts       적이 걷는 레인(웨이포인트), 건설 가능 판정
    rng.ts        시드 PRNG (Math.random 사용 금지 — 결정론이 깨진다)
  content/      ★ 밸런스와 컨셉이 사는 곳. 코드가 아니라 데이터 테이블
    enemies.ts / towers.ts / waves.ts
  render/       Pixi 어댑터. sim 상태를 스프라이트에 반영할 뿐
  ui/           DOM HUD (레터박스 밴드)
  perf/         M0 계측 (`?perf`)
  platform/     웹뷰 처리 + 건강 데이터 연동 자리(seam)
```

### 왜 이렇게 되어 있는지

- **168×312 백킹스토어 + 정수배 업스케일** — fill-rate가 구조적으로 상한에 묶인다. DPR 3x 저사양 안드로이드에서 프레임을 지키는 가장 큰 레버이고, 픽셀아트 룩과 방향이 같다.
- **7열 그리드** — 미학이 아니라 터치 타깃 결정. 360 CSS px 폭 폰에서 타일이 정확히 48 CSS px(= 최소 권장 48dp)가 된다. 9열이면 40px로 기준 미달.
- **고정 60Hz 시뮬 + 시드 PRNG** — 프레임이 떨어져도 게임 속도가 변하지 않고, 같은 시드·같은 입력이면 같은 결과가 나온다. 밸런스 봇이 성립하는 근거.
- **발사체·파티클만 풀링** — 저사양 웹뷰 렉의 최대 원인은 GC 스파이크. 적은 웨이브당 수십 마리라 풀링 가치가 없다.
- **스프라이트 아틀라스 1장** — 씬 전체가 2 draw call로 배칭된다. 이 숫자가 엔티티 수를 따라 오르면 배칭이 깨진 것이고, 그때 성능 측정은 전부 무효다.
- **텍스처를 코드로 생성** — 단일 파일 번들이 성립하는 전제. 외부 에셋이 없으면 안드로이드 `file:///android_asset/` 와 iOS 번들 경로 차이 문제가 애초에 생기지 않는다.
- **DOM HUD** — 저해상도 버퍼에 텍스트를 굽지 않아 선명하고, draw call을 쓰지 않고, 버튼이 진짜 터치 타깃을 갖는다.

## 밸런스 조정

수치는 전부 `src/content/` 에 있다. 고친 뒤:

```bash
npx vitest run src/core/balance-report.test.ts   # docs/balance-report.txt 갱신
```

스크립트 플레이어가 난이도 배율 × 전략 격자를 돌아 결과를 표로 남긴다. 손으로 플레이해 조정하면 느리고 재현되지 않는다 — 현재 곡선도 이 도구로 찾았다.

`campaign.test.ts` 가 양쪽 경계를 지킨다: 합리적으로 플레이하면 이기고, 아무것도 안 하면 지고, 후반 웨이브는 실제로 체력을 깎고, 일찍 강화하는 쪽이 넓게 펴는 쪽보다 낫다.

## 현황

- **M0** 렌더 경로·계측·웹뷰 처리 완료 (`docs/m0-measurements.md`)
- **M1** 코어 루프 완료 — 웨이브 10개, 배치·강화·판매, 승패, 재도전
- **M4** RN 셸 완료 — iOS/Android WebView 양쪽에서 렌더·브릿지 왕복 확인, 안드로이드에서 터치 배치까지 검증

PoC가 답하려던 두 질문(저사양 안드로이드 성능 / 재미)은 **아직 둘 다 미해결**입니다. 답할 준비가 끝난 상태입니다.

다음 작업과 완료 기준은 **[`docs/roadmap.md`](docs/roadmap.md)**, 코드를 만지기 전에 알아야 할 결정과 이유는 **[`AGENTS.md`](AGENTS.md)** 에 있습니다.

적/타워 로스터는 임시안이다. 컨셉 고도화는 별도 트랙이고, 결과는 `src/content/` 교체로 반영된다.
