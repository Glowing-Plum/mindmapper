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
  ['Genesis', 'Gen|Ge|Gn|창세기|창'],
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
  ['Song of Solomon', 'Song of Songs|Song|SOS|Canticles|아가|아'],
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
  ['Matthew', 'Matt|Mat|Mt|마태복음|마'],
  ['Mark', 'Mrk|Mk|Mr|마가복음|막'],
  ['Luke', 'Luk|Lk|Lu|누가복음|눅'],
  ['John', 'Jhn|Jn|Jo|요한복음|요'],
  ['Acts', 'Act|Ac|사도행전|행'],
  ['Romans', 'Rom|Ro|Rm|로마서|롬'],
  ['1 Corinthians', '1 Cor|1Cor|1 Co|1Co|고린도전서|고전'],
  ['2 Corinthians', '2 Cor|2Cor|2 Co|2Co|고린도후서|고후'],
  ['Galatians', 'Gal|Ga|갈라디아서|갈'],
  ['Ephesians', 'Eph|Ep|에베소서|엡'],
  ['Philippians', 'Phil|Php|Pp|빌립보서|빌'],
  ['Colossians', 'Col|Co|골로새서|골'],
  ['1 Thessalonians', '1 Thess|1Thess|1 Th|1Th|데살로니가전서|살전'],
  ['2 Thessalonians', '2 Thess|2Thess|2 Th|2Th|데살로니가후서|살후'],
  ['1 Timothy', '1 Tim|1Tim|1 Ti|1Ti|디모데전서|딤전'],
  ['2 Timothy', '2 Tim|2Tim|2 Ti|2Ti|디모데후서|딤후'],
  ['Titus', 'Tit|Ti|디도서|딛'],
  ['Philemon', 'Philem|Phlm|Pm|빌레몬서|몬'],
  ['Hebrews', 'Heb|He|히브리서|히'],
  ['James', 'Jas|Jm|야고보서|약'],
  ['1 Peter', '1 Pet|1Pet|1 Pe|1Pe|베드로전서|벧전'],
  ['2 Peter', '2 Pet|2Pet|2 Pe|2Pe|베드로후서|벧후'],
  ['1 John', '1 Jn|1Jn|1 Jo|1Jo|요한일서|요일'],
  ['2 John', '2 Jn|2Jn|2 Jo|2Jo|요한이서|요이'],
  ['3 John', '3 Jn|3Jn|3 Jo|3Jo|요한삼서|요삼'],
  ['Jude', 'Jud|Jd|유다서|유'],
  ['Revelation', 'Rev|Re|Rv|요한계시록|계'],
];

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Longest aliases first, so "1 John" wins over "John" and "시편" over "시".
const ALIASES = BOOKS.flatMap(([canonical, aliases]) =>
  [canonical, ...aliases.split('|')].map((alias) => ({ alias, canonical })),
).sort((a, b) => b.alias.length - a.alias.length);

const LOOKUP = new Map(ALIASES.map(({ alias, canonical }) => [alias.toLowerCase(), canonical]));

// book, optional ".", space (optional before Korean/CJK), chapter, optional :verses
const PATTERN = new RegExp(
  `(?<![\\p{Letter}\\p{Number}])(${ALIASES.map(({ alias }) => escape(alias)).join('|')})\\.?\\s*` +
  '(\\d{1,3})' +
  '(?:\\s*[:：]\\s*(\\d{1,3}(?:\\s*[-–—,]\\s*\\d{1,3})*))?',
  'giu',
);

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
    const [whole, bookRaw, chapterRaw, versesRaw] = match;
    const canonicalBook = LOOKUP.get(bookRaw.toLowerCase());
    if (canonicalBook) {
      const verses = versesRaw ? versesRaw.replace(/\s+/g, '') : null;
      found.push({
        start: match.index,
        end: match.index + whole.length,
        text: whole,
        book: canonicalBook,
        chapter: Number(chapterRaw),
        verses,
        canonical: `${canonicalBook} ${chapterRaw}${verses ? `:${verses}` : ''}`,
      });
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

/** Where to send a reference. `null` means references are not links. */
export const LINK_TEMPLATES = [
  { id: 'none', name: 'No links', template: null },
  { id: 'biblegateway', name: 'BibleGateway', template: 'https://www.biblegateway.com/passage/?search={ref}' },
  { id: 'youversion', name: 'YouVersion', template: 'https://www.bible.com/search/bible?query={ref}' },
  { id: 'blueletter', name: 'Blue Letter Bible', template: 'https://www.blueletterbible.org/search/search.cfm?Criteria={ref}' },
  { id: 'wol', name: 'Watchtower Library (wol.jw.org)', template: 'https://wol.jw.org/en/wol/l/r1/lp-e?q={ref}' },
  { id: 'custom', name: 'Custom link…', template: '' },
];

/**
 * Builds a URL for a reference. `{ref}`, `{book}`, `{chapter}` and `{verse}`
 * are replaced; everything is URL-encoded.
 */
export function referenceUrl(reference, template) {
  if (!template || !reference) return null;
  const values = {
    ref: reference.canonical,
    book: reference.book,
    chapter: String(reference.chapter),
    verse: reference.verses ?? '',
  };
  return template.replace(/\{(ref|book|chapter|verse)\}/g, (_, key) => encodeURIComponent(values[key]));
}

/** Every reference in a tree, in reading order, with the node that holds it. */
export function collectReferences(root) {
  const found = [];
  const walk = (node) => {
    for (const reference of findReferences(node.text)) found.push({ node, reference });
    for (const child of node.children) walk(child);
  };
  walk(root);
  return found;
}
