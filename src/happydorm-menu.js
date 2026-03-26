// 행복기숙사 식단 페이지에서 지정 날짜의 조식·중식·석식을 가져와 파싱하는 모듈입니다.

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { MenuUnavailableError } from './pknu-menu.js';

export const HAPPY_DORM_MENU_URL = 'https://happydorm.or.kr/busan/ko/0605/cafeteria/menu/';

const execFileAsync = promisify(execFile);
const CURL_BINARY = process.platform === 'win32' ? 'curl.exe' : 'curl';
const CURL_HEADERS = [
  'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  'Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer: https://happydorm.or.kr/',
  'Upgrade-Insecure-Requests: 1',
];

export async function fetchHappyDormMenuForDate(options = {}) {
  const {
    date,
    fetchHtmlImpl = fetchHappyDormHtmlForDate,
    homepageUrl = HAPPY_DORM_MENU_URL,
  } = options;

  if (!date) {
    throw new Error('행복기숙사 식단 조회에는 date가 필요합니다.');
  }

  const html = await fetchHtmlImpl(date);

  return buildHappyDormResult(html, date, homepageUrl);
}

export function buildHappyDormResult(html, date, homepageUrl = HAPPY_DORM_MENU_URL) {
  const parsed = parseHappyDormMenu(html, date);

  if (!Object.keys(parsed.meals).length) {
    throw new MenuUnavailableError(`${date.isoDate} 행복기숙사 식단을 찾지 못했습니다.`, {
      code: 'HAPPY_DORM_NOT_FOUND',
    });
  }

  return {
    ...parsed,
    homepageUrl,
    sourceUrl: buildHappyDormWeeklyUrl(date),
  };
}

export function parseHappyDormMenu(html, date) {
  const tableHtml = extractDateTableHtml(html, date);

  if (!tableHtml) {
    throw new MenuUnavailableError(`${date.isoDate} 행복기숙사 날짜 테이블을 찾지 못했습니다.`, {
      code: 'HAPPY_DORM_DATE_NOT_FOUND',
    });
  }

  const rows = [...tableHtml.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)];
  const meals = {};
  let currentMeal = null;

  for (const rowMatch of rows) {
    const desktopCells = extractDesktopCells(rowMatch[1]);

    if (desktopCells.length < 2) {
      continue;
    }

    const firstValue = desktopCells[0].text;
    let labelCell;
    let menuCell;

    if (['조식', '중식', '석식'].includes(firstValue)) {
      currentMeal = firstValue;
      labelCell = desktopCells[1];
      menuCell = desktopCells[2];
    } else {
      labelCell = desktopCells[0];
      menuCell = desktopCells[1];
    }

    if (!currentMeal || !labelCell || !menuCell) {
      continue;
    }

    const lines = htmlFragmentToLines(menuCell.html);

    if (!meals[currentMeal]) {
      meals[currentMeal] = [];
    }

    meals[currentMeal].push({
      label: normalizeWhitespace(labelCell.text),
      lines,
    });
  }

  return {
    title: '행복기숙사 식단표',
    date,
    meals: Object.fromEntries(
      Object.entries(meals).filter(([, sections]) => sections.some((section) => section.lines.length > 0)),
    ),
  };
}

export function isHappyDormClosedDay(menuResult) {
  const sections = Object.values(menuResult.meals).flat();

  return sections.length > 0 && sections.every((section) => (
    section.lines.length > 0 && section.lines.every((line) => isClosedLine(line))
  ));
}

export function buildHappyDormWeeklyUrl(date) {
  return `${HAPPY_DORM_MENU_URL}weekly/${date.isoDate.replaceAll('-', '')}`;
}

async function fetchHappyDormHtmlForDate(date) {
  const args = [
    '-L',
    buildHappyDormWeeklyUrl(date),
    '--silent',
    '--show-error',
    '--max-time',
    '30',
  ];

  for (const header of CURL_HEADERS) {
    args.push('-H', header);
  }

  try {
    const { stdout } = await execFileAsync(CURL_BINARY, args, {
      maxBuffer: 10 * 1024 * 1024,
    });

    if (!stdout || /HTTP 상태 403/.test(stdout) || /Access Denied/.test(stdout)) {
      throw new Error('행복기숙사 페이지 응답이 비정상입니다.');
    }

    return stdout;
  } catch (error) {
    throw new Error(`행복기숙사 식단 페이지 요청에 실패했습니다: ${error instanceof Error ? error.message : String(error)}`);
  }
}

function extractDateTableHtml(html, date) {
  const classPattern = new RegExp(`<table class="[^"]*week_menu_${date.isoDate}[^"]*"[^>]*>([\\s\\S]*?)<\\/table>`, 'i');
  const classMatch = html.match(classPattern);

  if (classMatch) {
    return classMatch[0];
  }

  const datePattern = new RegExp(`\\(${date.isoDate}\\)`);
  const tables = [...html.matchAll(/<table class="[^"]*table__week[^"]*"[\s\S]*?<\/table>/gi)];

  for (const match of tables) {
    if (datePattern.test(match[0])) {
      return match[0];
    }
  }

  return null;
}

function extractDesktopCells(rowHtml) {
  const cells = [];

  for (const cellMatch of rowHtml.matchAll(/<(th|td)\b([^>]*)>([\s\S]*?)<\/\1>/gi)) {
    const [, tag, attrs, innerHtml] = cellMatch;
    const classMatch = attrs.match(/class="([^"]*)"/i);
    const className = classMatch ? classMatch[1] : '';

    if (!className.includes('meal__PC')) {
      continue;
    }

    cells.push({
      tag: tag.toLowerCase(),
      className,
      html: innerHtml,
      text: htmlFragmentToText(innerHtml),
    });
  }

  return cells;
}

function isClosedLine(line) {
  const normalized = line.replace(/\s+/g, '');

  return /(휴무|휴일|설날|설날연휴|연휴|추석|추석연휴|미운영|운영없음|없음)/.test(normalized);
}

function htmlFragmentToText(html) {
  return htmlFragmentToLines(html).join(' ');
}

function htmlFragmentToLines(html) {
  const text = decodeHtmlEntities(
    html
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|div|li|tr|td|th|h[1-6]|ul|ol|table)>/gi, '\n')
      .replace(/<(p|div|li|tr|td|th|h[1-6])\b[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  );

  return text
    .split('\n')
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);
}

function normalizeWhitespace(text) {
  return text.replace(/[ \t]+/g, ' ').trim();
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}
