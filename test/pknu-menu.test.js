// PKNU 식단 파서와 자동 게시 흐름이 휴무/식단 없음 조건까지 올바르게 처리되는지 검증하는 테스트입니다.

import test from 'node:test';
import assert from 'node:assert/strict';

import { runMenuBot } from '../src/app.js';
import { extractMenuPostCandidates, fetchLatestMenuForDate, getKstDateParts, parseMenuPost } from '../src/pknu-menu.js';
import { buildMissingMenuSlackPayload, buildSlackPayload } from '../src/slack.js';

const LIST_HTML = `
  <html>
    <body>
      <a href="/main/399?action=view&no=723995">교내 식당 주간 식단표: 2026. 3. 23.(월) ~ 3. 27.(금)</a>
      <a href="/main/399?action=view&no=723817">교내 식당 주간 식단표: 2026. 3. 16.(월) ~ 3. 20.(금)</a>
    </body>
  </html>
`;

const HOLIDAY_LIST_HTML = `
  <html>
    <body>
      <a href="/main/399?action=view&no=723576">교내 식당 주간 식단표: 2026. 3. 2.(월) ~ 3. 6.(금)</a>
    </body>
  </html>
`;

const DETAIL_HTML = `
  <html>
    <body>
      <table class="brdList subbrd">
        <tr><td class="title_b">교내 식당 주간 식단표: 2026. 3. 23.(월) ~ 3. 27.(금)</td></tr>
      </table>
      <p>미래관 라일락 레스토랑</p>
      <table class="con03_sub_2">
        <tr>
          <td colspan="2" rowspan="2">구분</td>
          <td>Monday</td>
          <td>Tuesday</td>
          <td>Wednesday</td>
          <td>Thursday</td>
          <td>Friday</td>
          <td rowspan="2">운영정보</td>
        </tr>
        <tr>
          <td>3월 23일</td>
          <td>3월 24일</td>
          <td>3월 25일</td>
          <td>3월 26일</td>
          <td>3월 27일</td>
        </tr>
        <tr>
          <td colspan="2">중식<br>(학생, 교직원: 5,500원, 외부인: 6,500원)</td>
          <td>월요일 메뉴</td>
          <td>화요일 메뉴</td>
          <td>수요일 메뉴</td>
          <td>잡곡밥/현미밥<br>콩나물국<br>돈육김치볶음<br>연근탕수<br>연두부&amp;양념장<br>돌나물무침<br>토페샐러드<br>그린샐러드<br>발사믹/흑임자드레싱<br>깍두기</td>
          <td>금요일 메뉴</td>
          <td>11:30~14:00</td>
        </tr>
      </table>
      <p>용당 C - 한미르관 한미락 레스토랑</p>
      <table class="con03_sub_2">
        <tr>
          <td colspan="2" rowspan="2">구분</td>
          <td>Monday</td>
          <td>Tuesday</td>
          <td>Wednesday</td>
          <td>Thursday</td>
          <td>Friday</td>
          <td rowspan="2">운영정보</td>
        </tr>
        <tr>
          <td>3월 23일</td>
          <td>3월 24일</td>
          <td>3월 25일</td>
          <td>3월 26일</td>
          <td>3월 27일</td>
        </tr>
        <tr>
          <td colspan="2">중식<br>(5,500원)</td>
          <td>월요일 메뉴</td>
          <td>화요일 메뉴</td>
          <td>수요일 메뉴</td>
          <td>흑미밥/현미밥<br>김치콩나물국<br>매운돈육떡찜<br>분홍소세지전<br>해파리냉채<br>시금치나물<br>그린샐러드<br>참깨/오렌지드레싱<br>마카로니샐러드<br>깍두기</td>
          <td>금요일 메뉴</td>
          <td>11:30~14:00</td>
        </tr>
      </table>
    </body>
  </html>
`;

const HOLIDAY_DETAIL_HTML = `
  <html>
    <body>
      <table class="brdList subbrd">
        <tr><td class="title_b">교내 식당 주간 식단표: 2026. 3. 2.(월) ~ 3. 6.(금)</td></tr>
      </table>
      <p>미래관 라일락 레스토랑</p>
      <table class="con03_sub_2">
        <tr>
          <td colspan="2" rowspan="2">구분</td>
          <td>Monday</td>
          <td>Tuesday</td>
          <td>Wednesday</td>
          <td>Thursday</td>
          <td>Friday</td>
          <td rowspan="2">운영정보</td>
        </tr>
        <tr>
          <td>3월 2일</td>
          <td>3월 3일</td>
          <td>3월 4일</td>
          <td>3월 5일</td>
          <td>3월 6일</td>
        </tr>
        <tr>
          <td colspan="2">중식<br>(학생, 교직원: 5,500원, 외부인: 6,500원)</td>
          <td>대체 휴일</td>
          <td>화요일 메뉴</td>
          <td>수요일 메뉴</td>
          <td>목요일 메뉴</td>
          <td>금요일 메뉴</td>
          <td>11:30~14:00</td>
        </tr>
      </table>
      <p>용당 C - 한미르관 한미락 레스토랑</p>
      <table class="con03_sub_2">
        <tr>
          <td colspan="2" rowspan="2">구분</td>
          <td>Monday</td>
          <td>Tuesday</td>
          <td>Wednesday</td>
          <td>Thursday</td>
          <td>Friday</td>
          <td rowspan="2">운영정보</td>
        </tr>
        <tr>
          <td>3월 2일</td>
          <td>3월 3일</td>
          <td>3월 4일</td>
          <td>3월 5일</td>
          <td>3월 6일</td>
        </tr>
        <tr>
          <td colspan="2">중식<br>(5,500원)</td>
          <td>대체 휴일</td>
          <td>화요일 메뉴</td>
          <td>수요일 메뉴</td>
          <td>목요일 메뉴</td>
          <td>금요일 메뉴</td>
          <td>11:30~14:00</td>
        </tr>
      </table>
    </body>
  </html>
`;

test('목록 페이지에서 최신 식단 글 후보를 순서대로 수집한다', () => {
  const candidates = extractMenuPostCandidates(LIST_HTML);

  assert.equal(candidates.length, 2);
  assert.equal(candidates[0].url, 'https://www.pknu.ac.kr/main/399?action=view&no=723995');
});

test('상세 페이지에서 라일락/한미르관의 지정 날짜 메뉴를 파싱한다', () => {
  const parsed = parseMenuPost(DETAIL_HTML, getKstDateParts('2026-03-26'));

  assert.equal(parsed.title, '교내 식당 주간 식단표: 2026. 3. 23.(월) ~ 3. 27.(금)');
  assert.equal(parsed.foundDate, true);
  assert.deepEqual(parsed.cafeterias.lilac.menuLines.slice(0, 3), ['잡곡밥/현미밥', '콩나물국', '돈육김치볶음']);
  assert.deepEqual(parsed.cafeterias.hanmir.menuLines.slice(0, 3), ['흑미밥/현미밥', '김치콩나물국', '매운돈육떡찜']);
});

test('최신 글 탐색부터 메뉴 추출까지 end-to-end로 동작한다', async () => {
  const routes = new Map([
    ['https://www.pknu.ac.kr/main/399', LIST_HTML],
    ['https://www.pknu.ac.kr/main/399?action=view&no=723995', DETAIL_HTML],
  ]);

  const fetchImpl = async (url) => {
    const html = routes.get(url);

    if (!html) {
      return new Response('not found', { status: 404, statusText: 'Not Found' });
    }

    return new Response(html, { status: 200, statusText: 'OK' });
  };

  const result = await fetchLatestMenuForDate({
    date: getKstDateParts('2026-03-26'),
    fetchImpl,
  });

  assert.equal(result.sourceUrl, 'https://www.pknu.ac.kr/main/399?action=view&no=723995');
  assert.equal(result.cafeterias.lilac.menuLines.at(-1), '깍두기');
  assert.equal(result.cafeterias.hanmir.priceLabel, '(5,500원)');
});

test('정상 식단 payload에 원문 링크와 홈페이지 주소를 함께 담는다', async () => {
  const result = await fetchLatestMenuForDate({
    date: getKstDateParts('2026-03-26'),
    fetchImpl: async (url) => new Response(url.includes('no=723995') ? DETAIL_HTML : LIST_HTML, {
      status: 200,
      statusText: 'OK',
    }),
  });
  const payload = buildSlackPayload(result);

  assert.match(payload.text, /원문: https:\/\/www\.pknu\.ac\.kr\/main\/399\?action=view&no=723995/);
  assert.match(payload.text, /홈페이지: https:\/\/www\.pknu\.ac\.kr\/main\/399/);
});

test('식단이 없으면 안내 payload와 홈페이지 주소를 만든다', () => {
  const payload = buildMissingMenuSlackPayload(getKstDateParts('2026-03-31'));

  assert.match(payload.text, /오늘 식단이 없습니다\. 홈페이지를 확인해 보세요\./);
  assert.match(payload.text, /홈페이지: https:\/\/www\.pknu\.ac\.kr\/main\/399/);
  assert.equal(payload.blocks[1].type, 'section');
});

test('식단표가 휴일/휴무로 표기된 날에는 슬랙 전송 없이 skip 한다', async () => {
  let posted = false;
  const logs = [];

  const result = await runMenuBot({
    env: {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
      TARGET_DATE: '2026-03-02',
      PKNU_MENU_URL: 'https://www.pknu.ac.kr/main/399',
    },
    fetchImpl: async (url) => new Response(url.includes('no=723576') ? HOLIDAY_DETAIL_HTML : HOLIDAY_LIST_HTML, {
      status: 200,
      statusText: 'OK',
    }),
    postToSlackImpl: async () => {
      posted = true;
      return 'ok';
    },
    stdout: { log: (message) => logs.push(message) },
    stderr: { error: () => {} },
  });

  assert.equal(result.status, 'skipped');
  assert.equal(result.reason, 'holiday-menu');
  assert.equal(posted, false);
  assert.match(logs[0], /휴일\/휴무/);
});

test('평일에 식단이 없으면 안내 메시지를 전송한다', async () => {
  let postedPayload;
  const missingDetailHtml = DETAIL_HTML.replace(/3월 26일/g, '3월 30일');

  const result = await runMenuBot({
    env: {
      SLACK_WEBHOOK_URL: 'https://hooks.slack.com/services/test',
      TARGET_DATE: '2026-03-26',
      PKNU_MENU_URL: 'https://www.pknu.ac.kr/main/399',
    },
    fetchImpl: async (url) => new Response(url.includes('no=723995') ? missingDetailHtml : LIST_HTML, {
      status: 200,
      statusText: 'OK',
    }),
    postToSlackImpl: async (_webhookUrl, payload) => {
      postedPayload = payload;
      return 'ok';
    },
    stdout: { log: () => {} },
    stderr: { error: () => {} },
  });

  assert.equal(result.status, 'posted');
  assert.match(postedPayload.text, /오늘 식단이 없습니다\. 홈페이지를 확인해 보세요\./);
});
