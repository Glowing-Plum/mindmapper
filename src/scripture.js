// Recognising scripture references in node text.
//
// This is what makes the map a talk-preparation tool rather than a general
// diagram: references are detected, shown as references, counted, and can be
// opened in whichever Bible site you prefer.
//
// Pure and DOM-free, so it is unit-testable.

/**
 * Canonical book name -> the ways people write it. English abbreviations and
 * Korean names are both accepted; add your own aliases here as needed.
 */
const BOOKS = [
  ['Genesis', 'Gen|Ge|Gn|창세기|창세|창'],
  ['Exodus', 'Exod|Exo|Ex|출애굽기|출'],
  ['Leviticus', 'Lev|Le|Lv|레위기|레'],
  ['Numbers', 'Num|Nu|Nm|민수기|민'],
  ['Deuteronomy', 'Deut|Deu|Dt|신명기|신'],
  ['Joshua', 'Josh|Jos|Jsh|여호수아|수'],
  ['Judges', 'Judg|Jdg|Jg|사사기|삿'],
  ['Ruth', 'Rth|Ru|룻기|룻'],
  ['1 Samuel', '1 Sam|1Sam|1 Sa|1Sa|사무엘상|삼상'],
  ['2 Samuel', '2 Sam|2Sam|2 Sa|2Sa|사무엘하|삼하'],
  ['1 Kings', '1 Kgs|1Kgs|1 Ki|1Ki|열왕기상|왕상'],
  ['2 Kings', '2 Kgs|2Kgs|2 Ki|2Ki|열왕기하|왕하'],
  ['1 Chronicles', '1 Chron|1Chron|1 Chr|1Chr|역대상|대상'],
  ['2 Chronicles', '2 Chron|2Chron|2 Chr|2Chr|역대하|대하'],
  ['Ezra', 'Ezr|에스라|스'],
  ['Nehemiah', 'Neh|Ne|느헤미야|느'],
  ['Esther', 'Esth|Est|에스더|에'],
  ['Job', 'Jb|욥기|욥'],
  ['Psalms', 'Psalm|Pslm|Psa|Pss|Ps|시편|시'],
  ['Proverbs', 'Prov|Pro|Prv|Pr|잠언|잠'],
  ['Ecclesiastes', 'Eccles|Eccl|Ecc|Ec|전도서|전'],
  ['Song of Solomon', 'Song of Songs|Song|SOS|Canticles|아가서|아가|아'],
  ['Isaiah', 'Isa|Is|이사야|사'],
  ['Jeremiah', 'Jer|Je|예레미야|렘'],
  ['Lamentations', 'Lam|La|예레미야애가|애가|애'],
  ['Ezekiel', 'Ezek|Eze|Ezk|에스겔|겔'],
  ['Daniel', 'Dan|Da|Dn|다니엘|단'],
  ['Hosea', 'Hos|Ho|호세아|호'],
  ['Joel', 'Jl|요엘|욜'],
  ['Amos', 'Am|아모스|암'],
  ['Obadiah', 'Obad|Ob|오바댜|옵'],
  ['Jonah', 'Jon|Jnh|요나|욘'],
  ['Micah', 'Mic|Mc|미가|미'],
  ['Nahum', 'Nah|Na|나훔|나'],
  ['Habakkuk', 'Hab|Hb|하박국|합'],
  ['Zephaniah', 'Zeph|Zep|Zp|스바냐|습'],
  ['Haggai', 'Hag|Hg|학개|학'],
  ['Zechariah', 'Zech|Zec|Zc|스가랴|슥'],
  ['Malachi', 'Mal|Ml|말라기|말'],
  ['Matthew', 'Matt|Mat|Mt|마태복음|마태|마'],
  ['Mark', 'Mrk|Mk|Mr|마가복음|마가|막'],
  ['Luke', 'Luk|Lk|Lu|누가복음|누가|눅'],
  ['John', 'Jhn|Jn|Jo|요한복음|요한|요'],
  ['Acts', 'Act|Ac|사도행전|사도|행'],
  ['Romans', 'Rom|Ro|Rm|로마서|로마|롬'],
  ['1 Corinthians', '1 Cor|1Cor|1 Co|1Co|고린도전서|고린도 전서|고린도1서|고전'],
  ['2 Corinthians', '2 Cor|2Cor|2 Co|2Co|고린도후서|고린도 후서|고린도2서|고후'],
  ['Galatians', 'Gal|Ga|갈라디아서|갈라디아|갈'],
  ['Ephesians', 'Eph|Ep|에베소서|에베소|엡'],
  ['Philippians', 'Phil|Php|Pp|빌립보서|빌립보|빌'],
  ['Colossians', 'Col|Co|골로새서|골로새|골'],
  ['1 Thessalonians', '1 Thess|1Thess|1 Th|1Th|데살로니가전서|데살로니가 전서|살전'],
  ['2 Thessalonians', '2 Thess|2Thess|2 Th|2Th|데살로니가후서|데살로니가 후서|살후'],
  ['1 Timothy', '1 Tim|1Tim|1 Ti|1Ti|디모데전서|디모데 전서|딤전'],
  ['2 Timothy', '2 Tim|2Tim|2 Ti|2Ti|디모데후서|디모데 후서|딤후'],
  ['Titus', 'Tit|Ti|디도서|디도|딛'],
  ['Philemon', 'Philem|Phlm|Pm|빌레몬서|빌레몬|몬'],
  ['Hebrews', 'Heb|He|히브리서|히브리|히'],
  ['James', 'Jas|Jm|야고보서|야고보|약'],
  ['1 Peter', '1 Pet|1Pet|1 Pe|1Pe|베드로전서|베드로 전서|베드로1서|베드로 1서|벧전'],
  ['2 Peter', '2 Pet|2Pet|2 Pe|2Pe|베드로후서|베드로 후서|베드로2서|베드로 2서|벧후'],
  ['1 John', '1 Jn|1Jn|1 Jo|1Jo|요한일서|요한1서|요한 1서|요일'],
  ['2 John', '2 Jn|2Jn|2 Jo|2Jo|요한이서|요한2서|요한 2서|요이'],
  ['3 John', '3 Jn|3Jn|3 Jo|3Jo|요한삼서|요한3서|요한 3서|요삼'],
  ['Jude', 'Jud|Jd|유다서|유다|유'],
  ['Revelation', 'Rev|Re|Rv|요한계시록|계시록|계'],
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest aliases first, so "1 John" wins over "John" and "시편" over "시".
const ALIASES = BOOKS.flatMap(([canonical, aliases]) =>
  [canonical, ...aliases.split('|')].map((alias) => ({ alias, canonical })),
).sort((a, b) => b.alias.length - a.alias.length);

const LOOKUP = new Map(ALIASES.map(({ alias, canonical }) => [alias.toLowerCase(), canonical]));

// A run of verse numbers: "18", "18-19", "28, 29", "3~5".
const VERSES = '\\d{1,3}(?:\\s*[-–—~〜,、，]\\s*\\d{1,3})*';

/**
 * A reference is a book, then a chapter, then optionally verses. Two ways of
 * writing the verses are accepted:
 *
 *   요한복음 3:16   Ps 34:18      a colon (full-width too)
 *   요한복음 3장 16절   시편 83편 18절   the Korean chapter and verse markers
 *
 * The chapter marker alone is enough — "시편 23편" is a whole chapter.
 */
const PATTERN = new RegExp(
  `(${ALIASES.map(({ alias }) => escape(alias)).join('|')})(?:서)?\\.?\\s*` +
  '(\\d{1,3})' +
  '(?:' +
    `\\s*[장편](?:\\s*(${VERSES})(?:\\s*절)?)?` +
    '|' +
    `\\s*[:：]\\s*(${VERSES})(?:\\s*절)?` +
  ')?',
  'giu',
);

// A reference must start on a word boundary. This is a plain test rather than
// a lookbehind in the pattern, because Safari before 16.4 throws on one, and a
// regex that will not compile takes the whole page down with it.
const WORDISH = /[\p{Letter}\p{Number}]/u;

/**
 * Books with only one chapter. "Jude 20" means verse 20, not chapter 20, so
 * the bare number after these is read as the verse.
 */
const SINGLE_CHAPTER = new Set(['Obadiah', 'Philemon', '2 John', '3 John', 'Jude']);

/** The rest of a verse list, for picking up the ", 21" of "Jude 20, 21". */
const TRAILING_VERSES = /^(?:\s*[-–—~〜,、，]\s*\d{1,3})*(?:\s*절)?/u;

/**
 * Finds every scripture reference in a string.
 *
 * @param {string} text
 * @returns {Array<{start:number,end:number,text:string,book:string,chapter:number,verses:string|null,canonical:string}>}
 */
export function findReferences(text) {
  const source = String(text ?? '');
  const found = [];
  PATTERN.lastIndex = 0;
  let match = PATTERN.exec(source);
  while (match !== null) {
    const [whole, bookRaw, chapterRaw, koreanVerses, colonVerses] = match;
    const canonicalBook = LOOKUP.get(bookRaw.toLowerCase());
    const startsAWord = match.index === 0 || !WORDISH.test(source[match.index - 1]);
    if (canonicalBook && startsAWord) {
      let versesRaw = koreanVerses ?? colonVerses;
      let chapter = Number(chapterRaw);
      let text = whole;

      // In a one-chapter book the number that looks like a chapter is the
      // verse, and any list after it belongs to the same reference.
      if (versesRaw == null && SINGLE_CHAPTER.has(canonicalBook)) {
        const [tail] = TRAILING_VERSES.exec(source.slice(match.index + whole.length));
        versesRaw = chapterRaw + tail;
        chapter = 1;
        text = whole + tail;
        PATTERN.lastIndex = match.index + text.length;
      }

      const verses = versesRaw
        ? versesRaw.replace(/\s+/g, '').replace(/[~〜]/g, '-').replace(/[、，]/g, ',').replace(/절$/, '')
        : null;
      found.push({
        start: match.index,
        end: match.index + text.length,
        text,
        book: canonicalBook,
        chapter,
        verses,
        canonical: `${canonicalBook} ${chapter}${verses ? `:${verses}` : ''}`,
      });
    } else if (!startsAWord) {
      // Step past this false start rather than over it, so a real reference
      // beginning one character later is still found.
      PATTERN.lastIndex = match.index + 1;
    }
    match = PATTERN.exec(source);
  }
  return found;
}

/** True when the text contains at least one reference. */
export function hasReference(text) {
  return findReferences(text).length > 0;
}

/**
 * Splits a line into alternating plain and reference runs, for rendering.
 * @returns {Array<{text: string, reference: object|null}>}
 */
export function segmentLine(line) {
  const references = findReferences(line);
  if (references.length === 0) return [{ text: line, reference: null }];
  const segments = [];
  let cursor = 0;
  for (const reference of references) {
    if (reference.start > cursor) segments.push({ text: line.slice(cursor, reference.start), reference: null });
    segments.push({ text: reference.text, reference });
    cursor = reference.end;
  }
  if (cursor < line.length) segments.push({ text: line.slice(cursor), reference: null });
  return segments;
}

/**
 * JW Library deep links.
 *
 * Both jw.org and the app address a verse by an eight digit number: two digits
 * of book, three of chapter, three of verse, so Psalm 34:18 is 19034018. That
 * part is just the fixed order of the books and is reliable.
 *
 * The shape of the address around it is not something this project can verify,
 * so both templates are editable. `{bible}` and `{locale}` are filled in.
 */
// The app is given no language: it opens the verse in the Bible it is already
// set to, so a Korean reader gets the Korean Bible without choosing anything.
export const JW_APP_TEMPLATE = 'jwlibrary:///finder?bible={bible}&pub=nwtsty';
export const JW_WEB_TEMPLATE = 'https://www.jw.org/finder?bible={bible}&wtlocale={locale}&pub=nwtsty';
// The way through to jw.org when the app may not be there. It leaves the
// language to the site too, as the app does, rather than asking for one.
export const JW_WEB_FALLBACK_TEMPLATE = 'https://www.jw.org/finder?bible={bible}&pub=nwtsty';

// The link JW Library itself writes when you share a verse. It is an ordinary
// web address that the app has claimed, so on a device with the app it opens
// straight in the app: iOS asks "Open in JW Library?" every time a page uses
// the jwlibrary: scheme, but not for this. Without the app it opens on jw.org.
// No language is sent, so the app keeps the Bible it is set to.
export const JW_SHARE_TEMPLATE = 'https://www.jw.org/finder?srcid=jwlshare&prefer=lang&bible={bible}&pub=nwtsty';

/** Watchtower language codes, as used by `wtlocale`. */
export const JW_LOCALES = [
  { id: 'E', name: 'English' },
  { id: 'KO', name: '한국어 — Korean' },
  { id: 'S', name: 'Español' },
  { id: 'J', name: '日本語 — Japanese' },
  { id: 'CHS', name: '简体中文 — Chinese (Simplified)' },
  { id: 'F', name: 'Français' },
  { id: 'X', name: 'Deutsch' },
  { id: 'T', name: 'Português' },
  { id: 'TG', name: 'Tagalog' },
  { id: 'VT', name: 'Tiếng Việt — Vietnamese' },
  { id: 'custom', name: 'Other — type the code…' },
];

/**
 * What tapping a verse does. `app` means a handoff to an installed app rather
 * than a page, which the browser cannot confirm either way.
 */
export const VERSE_ACTIONS = [
  { id: 'jwshare', name: 'Open in JW Library', template: JW_SHARE_TEMPLATE, app: false },
  { id: 'jwlibrary', name: 'Open in JW Library (app link, asks first on iPad)', template: JW_APP_TEMPLATE, app: true },
  { id: 'jworg', name: 'Open jw.org in a new tab', template: JW_WEB_TEMPLATE, app: false },
  { id: 'custom', name: 'Custom link…', template: '', app: false },
  { id: 'none', name: 'Do nothing', template: null, app: false },
];

const BOOK_NUMBERS = new Map(BOOKS.map(([canonical], index) => [canonical, index + 1]));

/** First and last verse of "18", "18-19" or "34, 35". Zero means a chapter. */
function verseRange(verses) {
  if (!verses) return [0, 0];
  const numbers = verses.split(/[-–—~〜,、，]/).map(Number).filter(Number.isFinite);
  if (numbers.length === 0) return [0, 0];
  return [numbers[0], numbers[numbers.length - 1]];
}

const pad = (value, width) => String(value).padStart(width, '0');

/**
 * The reference as the number jw.org and JW Library use: BBCCCVVV, or a
 * dash-joined pair for a range.
 *
 * @returns {string|null} null when the book is not one we know
 */
export function bibleNumber(reference) {
  const book = BOOK_NUMBERS.get(reference?.book);
  if (!book) return null;
  const [first, last] = verseRange(reference.verses);
  const start = `${pad(book, 2)}${pad(reference.chapter, 3)}${pad(first, 3)}`;
  if (last === first) return start;
  return `${start}-${pad(book, 2)}${pad(reference.chapter, 3)}${pad(last, 3)}`;
}

/**
 * Builds a JW Library (or jw.org) address for a reference.
 * @returns {string|null}
 */
export function jwUrl(reference, { template, locale = 'E' } = {}) {
  const number = bibleNumber(reference);
  if (!number || !template) return null;
  return template
    .replace(/\{bible\}/g, number)
    .replace(/\{locale\}/g, encodeURIComponent(locale || 'E'))
    .replace(/\{ref\}/g, encodeURIComponent(reference.canonical));
}

/**
 * Every reference in a tree, in reading order, with the node that holds it.
 * A reference written on the line into a node counts as that node's: people
 * put the citation on the connector as readily as in the card.
 */
export function collectReferences(root) {
  const found = [];
  const walk = (node) => {
    for (const reference of findReferences(node.edgeLabel)) found.push({ node, reference, onLabel: true });
    for (const reference of findReferences(node.text)) found.push({ node, reference, onLabel: false });
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}
