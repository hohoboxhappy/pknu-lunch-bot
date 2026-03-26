// 부경대 교내식당과 행복기숙사 식단을 조합해 슬랙 전송 여부와 메시지를 결정하는 애플리케이션 진입 로직입니다.

import { MenuUnavailableError, fetchLatestMenuForDate, getKstDateParts, isHolidayClosureMenu, isWeekend } from './pknu-menu.js';
import { fetchHappyDormMenuForDate, isHappyDormClosedDay } from './happydorm-menu.js';
import { buildDailySlackPayload, postToSlack } from './slack.js';

export async function runMenuBot(options = {}) {
  const {
    args = process.argv.slice(2),
    env = process.env,
    fetchImpl = globalThis.fetch,
    postToSlackImpl = postToSlack,
    fetchPknuMenuForDateImpl = fetchLatestMenuForDate,
    fetchHappyDormMenuForDateImpl = fetchHappyDormMenuForDate,
    stdout = console,
    stderr = console,
  } = options;

  const argSet = new Set(args);
  const dryRun = argSet.has('--dry-run');
  const targetDate = env.TARGET_DATE ? getKstDateParts(env.TARGET_DATE) : getKstDateParts();
  const pknuHomepageUrl = env.PKNU_MENU_URL || 'https://www.pknu.ac.kr/main/399';

  try {
    if (isWeekend(targetDate)) {
      stdout.log(`[skip] ${targetDate.isoDate}는 주말이라 게시하지 않습니다.`);
      return { status: 'skipped', reason: 'weekend', date: targetDate };
    }

    const dailyMenu = {
      date: targetDate,
      pknu: null,
      happyDorm: null,
    };

    try {
      const menuResult = await fetchPknuMenuForDateImpl({
        date: targetDate,
        fetchImpl,
        listUrl: pknuHomepageUrl,
      });

      if (isHolidayClosureMenu(menuResult)) {
        dailyMenu.pknu = {
          status: 'holiday',
          homepageUrl: pknuHomepageUrl,
          sourceUrl: menuResult.sourceUrl,
        };
      } else {
        dailyMenu.pknu = {
          status: 'available',
          ...menuResult,
          homepageUrl: pknuHomepageUrl,
        };
      }
    } catch (error) {
      if (!(error instanceof MenuUnavailableError)) {
        throw error;
      }

      dailyMenu.pknu = {
        status: 'missing',
        date: targetDate,
        homepageUrl: pknuHomepageUrl,
      };
    }

    try {
      const happyDormResult = await fetchHappyDormMenuForDateImpl({
        date: targetDate,
      });

      dailyMenu.happyDorm = isHappyDormClosedDay(happyDormResult)
        ? {
          status: 'holiday',
          homepageUrl: happyDormResult.homepageUrl,
          sourceUrl: happyDormResult.sourceUrl,
        }
        : {
          status: 'available',
          ...happyDormResult,
        };
    } catch (error) {
      if (!(error instanceof MenuUnavailableError)) {
        throw error;
      }

      dailyMenu.happyDorm = {
        status: 'missing',
        date: targetDate,
        homepageUrl: 'https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/',
      };
    }

    const payload = buildDailySlackPayload(dailyMenu);

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
