// PKNU 식단 슬랙 자동 게시 앱을 실행하고 종료 코드를 처리하는 진입점입니다.

import { runMenuBot } from './app.js';

try {
  await runMenuBot();
} catch {
  process.exit(1);
}
