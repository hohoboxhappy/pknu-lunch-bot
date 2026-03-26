// 파싱한 식단 정보를 슬랙 메시지 포맷으로 만들고 Incoming Webhook으로 전송하는 모듈입니다.

export function buildSlackPayload(menuResult, homepageUrl = 'https://www.pknu.ac.kr/main/399') {
  const dateText = `${menuResult.date.isoDate}(${menuResult.date.weekdayKorean})`;
  const cafeterias = ['lilac', 'hanmir']
    .map((key) => menuResult.cafeterias[key])
    .filter(Boolean);

  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `부경대 식단 알림 · ${dateText}`,
      },
    },
  ];

  for (const cafeteria of cafeterias) {
    const heading = [cafeteria.cafeteriaName, cafeteria.mealLabel, cafeteria.priceLabel]
      .filter(Boolean)
      .join(' · ');
    const menuText = cafeteria.menuLines.map((line) => `• ${line}`).join('\n');

    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${heading}*\n${menuText}`,
      },
    });
  }

  blocks.push({
    type: 'context',
    elements: [
      {
        type: 'mrkdwn',
        text: `<${menuResult.sourceUrl}|원문 보기> · ${menuResult.title}`,
      },
      {
        type: 'mrkdwn',
        text: `<${homepageUrl}|홈페이지 보기>`,
      },
    ],
  });

  return {
    text: [
      `[부경대 식단] ${dateText}`,
      ...cafeterias.map((cafeteria) => `${cafeteria.cafeteriaName}: ${cafeteria.menuLines.join(', ')}`),
      `원문: ${menuResult.sourceUrl}`,
      `홈페이지: ${homepageUrl}`,
    ].join('\n'),
    blocks,
  };
}

export function buildMissingMenuSlackPayload(date, homepageUrl = 'https://www.pknu.ac.kr/main/399') {
  const dateText = `${date.isoDate}(${date.weekdayKorean})`;

  return {
    text: `[부경대 식단] ${dateText}\n오늘 식단이 없습니다. 홈페이지를 확인해 보세요.\n홈페이지: ${homepageUrl}`,
    blocks: [
      {
        type: 'header',
        text: {
          type: 'plain_text',
          text: `부경대 식단 알림 · ${dateText}`,
        },
      },
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*식단 안내*\n오늘 식단이 없습니다. 홈페이지를 확인해 보세요.',
        },
      },
      {
        type: 'context',
        elements: [
          {
            type: 'mrkdwn',
            text: `<${homepageUrl}|홈페이지 보기>`,
          },
        ],
      },
    ],
  };
}

export async function postToSlack(webhookUrl, payload, fetchImpl = globalThis.fetch) {
  if (!webhookUrl) {
    throw new Error('SLACK_WEBHOOK_URL 환경변수가 필요합니다.');
  }

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch API를 사용할 수 없습니다. Node.js 20 이상이 필요합니다.');
  }

  const response = await fetchImpl(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });

  const bodyText = await response.text();

  if (!response.ok) {
    throw new Error(`슬랙 전송 실패: ${response.status} ${response.statusText} - ${bodyText}`);
  }

  return bodyText;
}
