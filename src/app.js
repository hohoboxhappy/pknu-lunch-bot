// 식단 유무와 식단표상의 휴일 표기를 판단해 슬랙 전송 여부와 메시지를 결정하는 애플리케이션 진입 로직입니다.

import { MenuUnavailableError, fetchLatestMenuForDate, getKstDateParts, isHolidayClosureMenu, isWeekend } from './pknu-menu.js';
import { buildMissingMenuSlackPayload, buildSlackPayload, postToSlack } from './slack.js';

export async function runMenuBot(options = {}) {
  const {
    args = process.argv.slice(2),
    env = process.env,
    fetchImpl = globalThis.fetch,
    postToSlackImpl = postToSlack,
    stdout = console,
    stderr = console,
  } = options;

  const argSet = new Set(args);
  const dryRun = argSet.has('--dry-run');
  const targetDate = env.TARGET_DATE ? getKstDateParts(env.TARGET_DATE) : getKstDateParts();
  const homepageUrl = env.PKNU_MENU_URL || 'https://www.pknu.ac.kr/main/399';

  try {
    if (isWeekend(targetDate)) {
      stdout.log(`[skip] ${targetDate.isoDate}는 주말이라 게시하지 않습니다.`);
      return { status: 'skipped', reason: 'weekend', date: targetDate };
    }

    let payload;

    try {
      const menuResult = await fetchLatestMenuForDate({
        date: targetDate,
        fetchImpl,
        listUrl: homepageUrl,
      });

      if (isHolidayClosureMenu(menuResult)) {
        stdout.log(`[skip] ${targetDate.isoDate}는 식단표에 휴일/휴무로 표기되어 게시하지 않습니다.`);
        return { status: 'skipped', reason: 'holiday-menu', date: targetDate, menuResult };
      }

      payload = buildSlackPayload(menuResult, homepageUrl);
    } catch (error) {
      if (!(error instanceof MenuUnavailableError)) {
        throw error;
      }

      payload = buildMissingMenuSlackPayload(targetDate, homepageUrl);
    }

    if (dryRun) {
      stdout.log(JSON.stringify(payload, null, 2));
      return { status: 'dry-run', date: targetDate, payload };
    }

    const responseText = await postToSlackImpl(env.SLACK_WEBHOOK_URL, payload, fetchImpl);
    stdout.log(`[ok] 슬랙 전송 완료: ${responseText}`);

    return { status: 'posted', date: targetDate, payload };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.error(`[error] ${message}`);
    throw error;
  }
}
