// 부경대 교내식당과 행복기숙사 식단을 슬랙 메시지로 조합해 전송하는 모듈입니다.

export function buildDailySlackPayload(dailyMenu) {
  const dateText = `${dailyMenu.date.isoDate}(${dailyMenu.date.weekdayKorean})`;
  const blocks = [
    {
      type: 'header',
      text: {
        type: 'plain_text',
        text: `부경대 식단 알림 · ${dateText}`,
      },
    },
  ];

  if (dailyMenu.pknu) {
    blocks.push({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: buildPknuSectionText(dailyMenu.pknu),
      },
    });
  }

  if (dailyMenu.happyDorm) {
    blocks.push(...buildHappyDormBlocks(dailyMenu.happyDorm));
  }

  blocks.push({
    type: 'context',
    elements: buildContextElements(dailyMenu),
  });

  return {
    text: buildFallbackText(dailyMenu, dateText),
    blocks,
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

function buildPknuSectionText(pknu) {
  if (pknu.status === 'holiday') {
    return `*부경대 교내식당*\n휴일/휴무로 운영하지 않습니다.`;
  }

  if (pknu.status === 'missing') {
    return `*부경대 교내식당*\n오늘 식단이 없습니다. 홈페이지를 확인해 보세요.`;
  }

  const cafeterias = ['lilac', 'hanmir']
    .map((key) => pknu.cafeterias[key])
    .filter(Boolean)
    .map((cafeteria) => {
      const heading = [cafeteria.cafeteriaName, cafeteria.mealLabel, cafeteria.priceLabel]
        .filter(Boolean)
        .join(' · ');

      return `*${heading}*\n${cafeteria.menuLines.map((line) => `• ${line}`).join('\n')}`;
    });

  return ['*부경대 교내식당*', ...cafeterias].join('\n\n');
}

function buildHappyDormBlocks(happyDorm) {
  if (happyDorm.status === 'holiday') {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*행복기숙사 식당*\n휴일/휴무로 운영하지 않습니다.',
        },
      },
    ];
  }

  if (happyDorm.status === 'missing') {
    return [
      {
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: '*행복기숙사 식당*\n오늘 식단이 없습니다. 홈페이지를 확인해 보세요.',
        },
      },
    ];
  }

  const mealOrder = ['조식', '중식', '석식'];

  return mealOrder
    .filter((meal) => happyDorm.meals[meal]?.length)
    .map((meal) => ({
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*행복기숙사 ${meal}*\n${happyDorm.meals[meal]
          .filter((section) => section.lines.length > 0)
          .map((section) => `• ${section.label}: ${section.lines.join(' / ')}`)
          .join('\n')}`,
      },
    }));
}

function buildContextElements(dailyMenu) {
  const elements = [];

  if (dailyMenu.pknu) {
    if (dailyMenu.pknu.sourceUrl) {
      elements.push({
        type: 'mrkdwn',
        text: `<${dailyMenu.pknu.sourceUrl}|PKNU 원문 보기>`,
      });
    }

    elements.push({
      type: 'mrkdwn',
      text: `<${dailyMenu.pknu.homepageUrl}|PKNU 홈페이지>`,
    });
  }

  if (dailyMenu.happyDorm) {
    elements.push({
      type: 'mrkdwn',
      text: `<${dailyMenu.happyDorm.homepageUrl}|행복기숙사 식단표>`,
    });
  }

  return elements;
}

function buildFallbackText(dailyMenu, dateText) {
  const lines = [`[부경대 식단] ${dateText}`];

  if (dailyMenu.pknu) {
    if (dailyMenu.pknu.status === 'available') {
      for (const cafeteria of ['lilac', 'hanmir'].map((key) => dailyMenu.pknu.cafeterias[key]).filter(Boolean)) {
        lines.push(`${cafeteria.cafeteriaName}: ${cafeteria.menuLines.join(', ')}`);
      }
      if (dailyMenu.pknu.sourceUrl) {
        lines.push(`PKNU 원문: ${dailyMenu.pknu.sourceUrl}`);
      }
    } else if (dailyMenu.pknu.status === 'holiday') {
      lines.push('부경대 교내식당: 휴일/휴무');
    } else {
      lines.push('부경대 교내식당: 오늘 식단이 없습니다. 홈페이지를 확인해 보세요.');
    }
  }

  if (dailyMenu.happyDorm) {
    if (dailyMenu.happyDorm.status === 'available') {
      for (const [meal, sections] of Object.entries(dailyMenu.happyDorm.meals)) {
        const summary = sections
          .filter((section) => section.lines.length > 0)
          .map((section) => `${section.label}: ${section.lines.join(' / ')}`)
          .join(' | ');

        lines.push(`행복기숙사 ${meal}: ${summary}`);
      }
    } else if (dailyMenu.happyDorm.status === 'holiday') {
      lines.push('행복기숙사 식당: 휴일/휴무');
    } else {
      lines.push('행복기숙사 식당: 오늘 식단이 없습니다. 홈페이지를 확인해 보세요.');
    }
  }

  if (dailyMenu.pknu) {
    lines.push(`PKNU 홈페이지: ${dailyMenu.pknu.homepageUrl}`);
  }

  if (dailyMenu.happyDorm) {
    lines.push(`행복기숙사 식단표: ${dailyMenu.happyDorm.homepageUrl}`);
  }

  return lines.join('\n');
}
