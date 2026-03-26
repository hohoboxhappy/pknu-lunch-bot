// PKNU 식단 게시판에서 최신 식단 글을 찾고 라일락/한미르관의 오늘 메뉴를 파싱하는 모듈입니다.

export const PKNU_MENU_LIST_URL = 'https://www.pknu.ac.kr/main/399';

export class MenuUnavailableError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'MenuUnavailableError';
    this.code = options.code;
    this.cause = options.cause;
  }
}

const DEFAULT_HEADERS = {
  'user-agent': 'Mozilla/5.0 (compatible; PKNUMenuBot/1.0; +https://www.pknu.ac.kr/main/399)',
};

const CAFETERIA_LABELS = {
  lilac: '라일락',
  hanmir: '한미르관',
};

export function getKstDateParts(input = undefined) {
  if (typeof input === 'string') {
    const match = input.match(/^(\d{4})-(\d{2})-(\d{2})$/);

    if (!match) {
      throw new Error(`날짜 형식이 잘못되었습니다: ${input}`);
    }

    const [, year, month, day] = match;
    const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

    return {
      year: Number(year),
      month: Number(month),
      day: Number(day),
      isoDate: `${year}-${month}-${day}`,
      weekday: date.getUTCDay(),
      weekdayKorean: ['일', '월', '화', '수', '목', '금', '토'][date.getUTCDay()],
    };
  }

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = formatter.formatToParts(input instanceof Date ? input : new Date());
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const isoDate = `${lookup.year}-${lookup.month}-${lookup.day}`;

  return getKstDateParts(isoDate);
}

export function isWeekend(dateParts) {
  return dateParts.weekday === 0 || dateParts.weekday === 6;
}

export function isHolidayClosureMenu(menuResult) {
  const cafeterias = Object.values(menuResult.cafeterias);

  return cafeterias.length > 0 && cafeterias.every((cafeteria) => (
    cafeteria.menuLines.length > 0 && cafeteria.menuLines.every((line) => isHolidayClosureLine(line))
  ));
}

export function extractMenuPostCandidates(listHtml, baseUrl = PKNU_MENU_LIST_URL) {
  const anchorRegex = /<a\b[^>]*href="([^"]*action=view(?:&amp;|&)no=\d+[^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  const seen = new Set();
  const candidates = [];

  for (const match of listHtml.matchAll(anchorRegex)) {
    const [, href, innerHtml] = match;
    const title = htmlFragmentToText(innerHtml).trim();

    if (!title.includes('교내 식당 주간 식단표')) {
      continue;
    }

    const url = new URL(decodeHtmlEntities(href), baseUrl).toString();

    if (seen.has(url)) {
      continue;
    }

    seen.add(url);
    candidates.push({ url, title });
  }

  return candidates;
}

export async function fetchLatestMenuForDate(options = {}) {
  const {
    date = getKstDateParts(),
    fetchImpl = globalThis.fetch,
    listUrl = process.env.PKNU_MENU_URL || PKNU_MENU_LIST_URL,
    candidateLimit = 8,
    postUrl = process.env.PKNU_POST_URL,
  } = options;

  if (typeof fetchImpl !== 'function') {
    throw new Error('fetch API를 사용할 수 없습니다. Node.js 20 이상이 필요합니다.');
  }

  if (postUrl) {
    const html = await fetchText(postUrl, fetchImpl);

    return buildParsedResult(html, postUrl, date);
  }

  const listHtml = await fetchText(listUrl, fetchImpl);
  const candidates = extractMenuPostCandidates(listHtml, listUrl).slice(0, candidateLimit);

  if (candidates.length === 0) {
    throw new MenuUnavailableError('식단 게시글 후보를 찾지 못했습니다.', {
      code: 'LIST_NO_CANDIDATES',
    });
  }

  let lastError;

  for (const candidate of candidates) {
    try {
      const html = await fetchText(candidate.url, fetchImpl);
      const result = buildParsedResult(html, candidate.url, date);

      if (result.foundDate && Object.keys(result.cafeterias).length > 0) {
        return result;
      }

      lastError = new MenuUnavailableError(`${candidate.url} 글에서 ${date.isoDate} 식단을 찾지 못했습니다.`, {
        code: 'DATE_NOT_FOUND',
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new MenuUnavailableError('최신 식단 글 파싱에 실패했습니다.', {
    code: 'MENU_PARSE_FAILED',
  });
}

export function buildParsedResult(html, sourceUrl, date) {
  const parsed = parseMenuPost(html, date);

  if (!parsed.foundDate) {
    throw new MenuUnavailableError(`${date.isoDate} 날짜 컬럼을 식단표에서 찾지 못했습니다.`, {
      code: 'DATE_NOT_FOUND',
    });
  }

  if (Object.keys(parsed.cafeterias).length === 0) {
    throw new MenuUnavailableError('라일락/한미르관 식단을 파싱하지 못했습니다.', {
      code: 'CAFETERIA_NOT_FOUND',
    });
  }

  return {
    ...parsed,
    sourceUrl,
  };
}

export function parseMenuPost(html, date) {
  const title = extractPostTitle(html);
  const tables = extractCafeteriaTables(html);
  const cafeterias = {};
  let foundDate = false;

  for (const tableInfo of tables) {
    const parsedTable = parseMenuTable(tableInfo.tableHtml, date);

    if (!parsedTable) {
      continue;
    }

    foundDate = foundDate || parsedTable.foundDate;

    if (!parsedTable.menuLines.length) {
      continue;
    }

    cafeterias[tableInfo.key] = {
      cafeteriaKey: tableInfo.key,
      cafeteriaName: CAFETERIA_LABELS[tableInfo.key],
      dateLabel: parsedTable.dateLabel,
      mealLabel: parsedTable.mealLabel,
      priceLabel: parsedTable.priceLabel,
      menuLines: parsedTable.menuLines,
      operatingInfo: parsedTable.operatingInfo,
    };
  }

  return {
    title,
    date,
    foundDate,
    cafeterias,
  };
}

async function fetchText(url, fetchImpl) {
  const response = await fetchImpl(url, { headers: DEFAULT_HEADERS });

  if (!response.ok) {
    throw new Error(`요청 실패: ${response.status} ${response.statusText} (${url})`);
  }

  return response.text();
}

function extractPostTitle(html) {
  const titleMatch = html.match(/<td[^>]*class="title_b"[^>]*>\s*([\s\S]*?)\s*<\/td>/i);

  if (titleMatch) {
    return htmlFragmentToText(titleMatch[1]).trim();
  }

  const headingMatch = html.match(/교내 식당 주간 식단표[^<\n]*/);

  return headingMatch ? decodeHtmlEntities(headingMatch[0]).trim() : '교내 식당 주간 식단표';
}

function extractCafeteriaTables(html) {
  const tableRegex = /<table class="([^"]*con03_sub_[^"]*)"[\s\S]*?<\/table>/gi;
  const tables = [];

  for (const match of html.matchAll(tableRegex)) {
    const tableHtml = match[0];
    const beforeHtml = html.slice(Math.max(0, match.index - 1800), match.index);
    const contextText = normalizeComparableText(htmlFragmentToText(beforeHtml));
    const lastLilacIndex = contextText.lastIndexOf('라일락');
    const lastHanmirIndex = Math.max(contextText.lastIndexOf('한미르관'), contextText.lastIndexOf('한미락'));

    if (lastLilacIndex < 0 && lastHanmirIndex < 0) {
      continue;
    }

    if (lastLilacIndex > lastHanmirIndex) {
      tables.push({ key: 'lilac', tableHtml });
      continue;
    }

    tables.push({ key: 'hanmir', tableHtml });
  }

  return tables;
}

function parseMenuTable(tableHtml, date) {
  const rows = extractTableRows(tableHtml);

  if (rows.length === 0) {
    return null;
  }

  const dateRow = rows.find((cells) => cells.filter((cell) => isDateLabel(cell.text)).length >= 5);
  const mealRow = rows.find((cells) => {
    if (cells.length < 7) {
      return false;
    }

    const firstCell = normalizeComparableText(cells[0].text);

    return firstCell.includes('중식');
  });

  if (!dateRow || !mealRow) {
    return null;
  }

  const dateLabels = dateRow
    .map((cell) => cell.text)
    .filter((text) => isDateLabel(text));
  const dateIndex = dateLabels.findIndex((label) => matchesDateLabel(label, date));
  const foundDate = dateIndex >= 0;

  if (!foundDate) {
    return { foundDate: false, menuLines: [] };
  }

  const mealMeta = htmlFragmentToLines(mealRow[0].html);
  const menuCells = mealRow.slice(1, -1);

  if (dateIndex >= menuCells.length) {
    return { foundDate: true, menuLines: [] };
  }

  return {
    foundDate: true,
    dateLabel: dateLabels[dateIndex],
    mealLabel: mealMeta[0] ?? '중식',
    priceLabel: mealMeta.slice(1).join(' ').trim(),
    menuLines: sanitizeMenuLines(htmlFragmentToLines(menuCells[dateIndex].html)),
    operatingInfo: htmlFragmentToLines(mealRow.at(-1)?.html ?? '').join(' ').trim(),
  };
}

function extractTableRows(tableHtml) {
  const rowRegex = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi;
  const rows = [];

  for (const rowMatch of tableHtml.matchAll(rowRegex)) {
    const cellRegex = /<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi;
    const cells = [];

    for (const cellMatch of rowMatch[1].matchAll(cellRegex)) {
      cells.push({
        html: cellMatch[1],
        text: htmlFragmentToText(cellMatch[1]),
      });
    }

    if (cells.length > 0) {
      rows.push(cells);
    }
  }

  return rows;
}

function sanitizeMenuLines(lines) {
  return lines
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .filter((line) => !['&', '/', '-', '·'].includes(line))
    .filter((line) => !/^open\b/i.test(line))
    .filter((line) => !/^close\b/i.test(line))
    .filter((line) => !/^☎/.test(line));
}

function isHolidayClosureLine(line) {
  const normalized = line.replace(/\s+/g, '');

  return /(휴무|휴일|설날|설연휴|추석|추석연휴|신정|광복절|개천절|한글날|성탄절|크리스마스|현충일|어린이날|삼일절|3·1절|부처님오신날|석가탄신일|제헌절)/.test(normalized);
}

function isDateLabel(text) {
  return /\d{1,2}\s*월\s*\d{1,2}\s*일/.test(text);
}

function matchesDateLabel(label, date) {
  const match = label.match(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/);

  if (!match) {
    return false;
  }

  return Number(match[1]) === date.month && Number(match[2]) === date.day;
}

function htmlFragmentToText(html) {
  return htmlFragmentToLines(html).join(' ');
}

function htmlFragmentToLines(html) {
  const withBreaks = html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|td|th|h[1-6]|ul|ol|table)>/gi, '\n')
    .replace(/<(p|div|li|tr|td|th|h[1-6])\b[^>]*>/gi, '\n')
    .replace(/<!--[\s\S]*?-->/g, ' ');

  const text = decodeHtmlEntities(withBreaks.replace(/<[^>]+>/g, ' '));

  return text
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeComparableText(text) {
  return text.replace(/\s+/g, '');
}

function decodeHtmlEntities(text) {
  const named = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
  };

  let decoded = text;

  for (const [entity, value] of Object.entries(named)) {
    decoded = decoded.split(entity).join(value);
  }

  decoded = decoded.replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)));
  decoded = decoded.replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));

  return decoded.replace(/\u00a0/g, ' ');
}
