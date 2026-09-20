// Working with real files, so a map is something you can keep, back up and
// reopen -- not just a row in this browser's storage.
//
// Chrome and Edge expose the File System Access API, which gives a true
// Open/Save: the app holds a handle to the file you opened and writes back to
// it. Firefox and Safari have no such thing, so those fall back to a file input
// and a download, and "Save" behaves as "Save a copy".

import { parseOutline, toOutline } from './parser.js';

export const FILE_TYPES = [
  {
    description: 'Mind map',
    accept: { 'application/json': ['.json'], 'text/markdown': ['.md'], 'text/plain': ['.txt'] },
  },
];

export function supportsFileHandles() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

/**
 * Turns file contents into a document root. JSON keeps everything -- formatting,
 * colours, collapse state, line labels -- while markdown or plain text is
 * parsed as an outline.
 *
 * Pure, so it is unit-testable without a browser.
 *
 * @param {string} name file name, used as a hint
 * @param {string} text file contents
 * @returns {{kind: 'json'|'outline', data: object}}
 * @throws {Error} when a .json file cannot be read
 */
export function parseFileContents(name, text) {
  const looksJson = /\.json$/i.test(name ?? '') || text.trimStart().startsWith('{');
  if (!looksJson) {
    return { kind: 'outline', data: parseOutline(text, { title: baseName(name) || 'Mind map' }) };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`${name || 'That file'} is not valid JSON`);
  }
  // Either a full document ({ version, root }) or a bare root node.
  const root = parsed?.root ?? parsed;
  if (!root || typeof root !== 'object' || typeof root.text !== 'string') {
    throw new Error(`${name || 'That file'} does not look like a mind map`);
  }
  return { kind: 'json', data: parsed };
}

/** The document as the bytes we write to disk. */
export function serialiseDoc(docJSON) {
  return `${JSON.stringify(docJSON, null, 2)}\n`;
}

export function serialiseOutline(root) {
  return `${toOutline(root)}\n`;
}

export function baseName(name = '') {
  return String(name).replace(/\.[^.]+$/, '');
}

export function ensureExtension(name, extension = '.json') {
  return /\.[a-z0-9]+$/i.test(name) ? name : `${name}${extension}`;
}

/**
 * Asks for a file to open.
 * @returns {Promise<{name: string, text: string, handle: object|null}|null>}
 *          null when the person cancelled
 */
export async function openFile() {
  if (supportsFileHandles()) {
    let handle;
    try {
      [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
    const file = await handle.getFile();
    return { name: file.name, text: await file.text(), handle };
  }

  // Fallback: a hidden file input.
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.md,.txt,application/json,text/markdown,text/plain';
    input.style.display = 'none';
    // `cancel` is not fired everywhere, so the input is simply discarded when
    // nothing arrives -- the promise settles on the first change either way.
    input.addEventListener('change', async () => {
      const file = input.files?.[0];
      input.remove();
      resolve(file ? { name: file.name, text: await file.text(), handle: null } : null);
    });
    document.body.append(input);
    input.click();
  });
}

/** Reads a file that was dropped onto the page. */
export async function readDroppedFile(file) {
  return { name: file.name, text: await file.text(), handle: null };
}

/** Writes back to a handle we already hold. */
export async function writeToHandle(handle, text) {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
  return true;
}

/**
 * Save As. Returns the new handle when the browser supports one, otherwise
 * downloads a copy and returns null.
 * @returns {Promise<{handle: object|null, name: string}|null>} null when cancelled
 */
export async function saveFileAs(suggestedName, text, { download }) {
  if (supportsFileHandles()) {
    let handle;
    try {
      handle = await window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
    } catch (error) {
      if (error?.name === 'AbortError') return null;
      throw error;
    }
    await writeToHandle(handle, text);
    return { handle, name: handle.name ?? suggestedName };
  }
  download(suggestedName, text, 'application/json');
  return { handle: null, name: suggestedName };
}
