# Popover

Popover는 YouTube 팝송을 문장 단위로 듣고 받아쓰며 영어를 학습하는 PC용 웹 애플리케이션입니다. 영상은 YouTube IFrame Player로 재생하고, 가사·번역·학습 기록은 브라우저에 저장합니다.

## 주요 기능

- YouTube URL 또는 영상 ID로 곡 등록 및 재생
- Genie 동기화 가사 또는 LRC 형식 가사 등록
- 현재 문장 이동, 구간 반복, 재생 속도 조절
- 듣기와 받아쓰기에 각각 최적화된 학습 화면
- 어절별 받아쓰기와 줄별 학습 기록
- GPT를 이용한 노래방식 가사 줄의 학습 문장 단위 자동 정리
- 곡 전체 문맥을 참고하는 GPT 한국어 번역과 영어 학습 노트 자동 생성
- 기존 JSON 번역 가져오기 기능을 수동 대안으로 유지
- 곡과 학습 진행 상황을 Local Storage에 자동 저장

## 기술 스택

- Next.js 16
- React 19
- TypeScript
- YouTube IFrame Player API
- OpenAI Responses API + Structured Outputs

## 시작하기

### 요구 사항

- Node.js 20 이상
- npm
- OpenAI API 키 — GPT 문장 정리·자동 번역·학습 노트를 사용할 때 필요

### 설치

```bash
git clone https://github.com/vividhyeok/popover.git
cd popover
npm install
npm run dev
```

브라우저에서 `http://localhost:3000`을 열고 `설정 → OpenAI 자동화`에서 API 키를 저장합니다. 기본 모델은 품질 우선의 GPT-6 Astra이며 설정에서 다른 지원 모델로 바꿀 수 있습니다.

API 키는 학습 데이터와 별도의 브라우저 Local Storage 항목에 저장되므로 Popover 백업 JSON에는 포함되지 않습니다. 개인 키를 앱에 넣고 싶지 않다면 서버의 `.env.local` 또는 Vercel 환경 변수에 `OPENAI_API_KEY`를 설정할 수도 있습니다.

```env
OPENAI_API_KEY=your_openai_api_key

# 선택 사항: 앱 안에서 YouTube 검색 결과를 표시할 때만 필요
YOUTUBE_API_KEY=your_youtube_data_api_key
```

YouTube URL이나 영상 ID를 직접 등록하는 경우 `YOUTUBE_API_KEY`는 필요하지 않습니다.

## 사용 방법

1. `설정 → OpenAI 자동화`에서 OpenAI API 키와 사용할 모델을 정합니다.
2. `곡 추가`에서 YouTube URL 또는 영상 ID와 Genie/LRC 가사를 등록합니다.
3. `문장 단위 자동 정리`를 켜 두면 GPT가 노래방 표시용으로 잘린 가사를 듣기·받아쓰기에 적당한 짧은 학습 단위로 정리합니다.
4. `추가 후 번역 자동 준비`를 켜 두면 곡 전체 문맥을 참고해 한국어 번역과 필요한 영어 학습 노트를 자동 생성합니다.
5. 이미 등록한 곡은 곡 메뉴의 `GPT 번역 · 노트`로 다시 번역할 수 있습니다.
6. 듣기 화면에서 문장별 재생과 번역·학습 노트를 확인하고, 받아쓰기 화면에서 어절별로 입력합니다.
7. 필요하면 기존 `번역 가져오기`에서 외부 AI JSON을 수동으로 적용할 수도 있습니다.

GPT 문장 정리는 완전한 문법 문장을 무조건 길게 합치는 대신 반복 청취와 타이핑이 버겁지 않은 학습 단위를 우선합니다. 한 소스 가사 줄 자체가 이미 매우 긴 경우에는 타임스탬프를 임의 추정해 내부를 쪼개지 않습니다.

## 키보드 조작

| 화면 | 키 | 동작 |
| --- | --- | --- |
| 듣기 | `Space` | 재생·일시정지 |
| 듣기 | `J` / `K` | 이전·다음 문장 |
| 듣기 | `R` | 현재 문장 반복 전환 |
| 받아쓰기 | `Space` / `Enter` | 현재 어절 채점 또는 빈칸 보류 |
| 받아쓰기 | `←` / `→` | 이전·다음 어절 |
| 받아쓰기 | `↑` / `↓` | 이전·다음 가사 줄 |

## 데이터 저장

- 곡, 번역, 싱크 보정값, 받아쓰기 기록은 브라우저 Local Storage에 저장됩니다.
- OpenAI API 키와 모델 선택은 학습 데이터와 별도 저장되며 백업 JSON에 포함되지 않습니다.
- 영상 파일은 저장하지 않습니다.
- 데이터는 브라우저와 도메인별로 분리되므로 `localhost`의 기록은 배포 주소로 자동 이전되지 않습니다.

## 배포

개인용 키 입력 방식을 쓰면 Vercel에 OpenAI 키를 등록할 필요가 없습니다. 배포 전체가 하나의 서버 키를 공유하도록 하려면 Vercel Environment Variables에 `OPENAI_API_KEY`를 등록합니다.

```bash
npm run lint
npm run build
```

## 유의 사항

- GPT 기능을 실행하면 곡 제목, 아티스트, 가사 원문과 해당 요청에 필요한 기존 번역·노트가 OpenAI API로 전송됩니다.
- 브라우저에 저장한 API 키는 해당 브라우저 프로필에서 읽을 수 있으므로 공용 PC에서는 저장하지 마세요.
- YouTube 영상 재생 가능 여부는 영상의 공개 상태와 임베드 정책을 따릅니다.
- 가사는 사용 권한이 있는 콘텐츠를 개인 학습 범위에서 사용하세요.
