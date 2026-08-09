# Popover

Popover는 YouTube 팝송을 문장 단위로 듣고 받아쓰며 영어를 학습하는 PC용 웹 애플리케이션입니다. 영상은 YouTube IFrame Player로 재생하고, 가사·번역·학습 기록은 브라우저에 저장합니다.

## 주요 기능

- YouTube URL 또는 영상 ID로 곡 등록 및 재생
- Genie 동기화 가사 또는 LRC 형식 가사 등록
- 현재 문장 이동, 구간 반복, 재생 속도 조절
- 첫 가사 시작점을 기준으로 전체 가사 싱크 일괄 보정
- 듣기와 받아쓰기에 각각 최적화된 학습 화면
- 어절별 받아쓰기, 대소문자 무시 채점, 줄별 학습 기록
- DeepSeek를 이용한 불필요한 가사 줄바꿈 자동 병합
- 외부 AI에서 만든 번역·학습 노트 JSON 가져오기
- 곡과 학습 진행 상황을 Local Storage에 자동 저장

## 기술 스택

- Next.js 16
- React 19
- TypeScript
- YouTube IFrame Player API
- DeepSeek API

## 시작하기

### 요구 사항

- Node.js 20 이상
- npm
- DeepSeek API 키 — AI 줄바꿈 정리와 자동 번역을 사용할 때 필요

### 설치

```bash
git clone https://github.com/vividhyeok/popover.git
cd popover
npm install
```

프로젝트 루트의 `.env.example`을 `.env.local`로 복사한 뒤 필요한 값을 설정합니다.

```env
DEEPSEEK_API_KEY=your_deepseek_api_key
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_MERGE_MODEL=deepseek-v4-pro

# 선택 사항: 앱 안에서 YouTube 검색 결과를 표시할 때만 필요
YOUTUBE_API_KEY=your_youtube_data_api_key
```

YouTube URL이나 영상 ID를 직접 등록하는 경우 `YOUTUBE_API_KEY`는 필요하지 않습니다. API 키는 서버에서만 사용되므로 클라이언트 공개 환경 변수에 넣지 마세요.

### 실행

```bash
npm run dev
```

브라우저에서 [http://localhost:3000](http://localhost:3000)을 엽니다.

## 사용 방법

1. `곡 추가`에서 YouTube URL 또는 영상 ID와 Genie/LRC 가사를 등록합니다.
2. 필요하면 DeepSeek 줄바꿈 정리로 문맥상 잘린 가사 줄을 병합합니다.
3. 영상에서 첫 가사가 시작되는 위치를 찾고 시작점 지정 버튼을 누릅니다.
4. 듣기 화면에서 문장별 재생과 번역·학습 노트를 확인합니다.
5. 받아쓰기 화면에서 한국어 의미를 보고 어절별로 입력합니다.
6. 고품질 번역이 필요하면 `AI 번역 가져오기`에서 프롬프트를 복사하고, 외부 AI가 반환한 JSON을 붙여넣습니다.

## 키보드 조작

| 화면 | 키 | 동작 |
| --- | --- | --- |
| 듣기 | `Space` | 재생·일시정지 |
| 듣기 | `J` / `K` | 이전·다음 문장 |
| 듣기 | `R` | 현재 문장 반복 전환 |
| 받아쓰기 | `Space` / `Enter` | 현재 어절 채점 또는 빈칸 보류 |
| 받아쓰기 | `←` / `→` | 이전·다음 어절 |
| 받아쓰기 | `↑` / `↓` | 이전·다음 가사 줄 |

받아쓰기의 미완료 구간 자동 반복은 기본으로 켜져 있으며 화면에서 끄거나 다시 켤 수 있습니다.

## 데이터 저장

- 곡, 번역, 싱크 보정값, 받아쓰기 기록은 브라우저 Local Storage에 저장됩니다.
- 영상 파일은 저장하지 않습니다.
- 저장 한도는 설정에서 3·5·8·10·12곡 중 선택할 수 있습니다.
- 한도에 도달하면 기존 곡을 삭제한 뒤 새 곡을 등록할 수 있습니다.
- 데이터는 브라우저와 도메인별로 분리되므로 `localhost`의 기록은 배포 주소로 자동 이전되지 않습니다.

## 배포

Vercel 프로젝트의 Environment Variables에 로컬과 동일한 환경 변수를 등록한 뒤 저장소를 연결합니다.

```bash
npm run lint
npm run build
```

## 유의 사항

- DeepSeek 기능을 실행하면 곡 제목, 아티스트, 가사 원문이 DeepSeek API로 전송됩니다.
- YouTube 영상 재생 가능 여부는 영상의 공개 상태와 임베드 정책을 따릅니다.
- 가사는 사용 권한이 있는 콘텐츠를 개인 학습 범위에서 사용하세요.
