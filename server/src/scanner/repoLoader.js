import { getRepo, getTree, getBlobBuffer } from '../github.js';
import { MAX_FILES_TO_READ, MAX_TEXT_FILE_BYTES, MAX_TOTAL_SCAN_BYTES } from '../config.js';
import { isProbablyText, languageOf, sha256, normalizePath } from './utils.js';

const SKIP_DIRS = /(^|\/)(node_modules|\.git|dist|build|coverage|\.next|vendor|__MACOSX)(\/|$)/;

export async function loadRepository(fullName) {
  const repo = await getRepo(fullName);
  const tree = await getTree(fullName, repo.defaultBranch);
  const files = [];
  const contents = [];
  let totalBytes = 0;
  let readCount = 0;

  for (const entry of tree) {
    if (entry.type !== 'blob') continue;
    const filePath = normalizePath(entry.path);
    const size = entry.size || 0;
    const language = languageOf(filePath);
    const baseMeta = {
      path: filePath,
      sha: entry.sha,
      size,
      language,
      read: false,
      skippedReason: null,
      hash: null,
      lines: null
    };

    if (SKIP_DIRS.test(filePath)) {
      files.push({ ...baseMeta, skippedReason: 'ignorierter Ordner' });
      continue;
    }
    if (!isProbablyText(filePath, size)) {
      files.push({ ...baseMeta, skippedReason: 'keine Textdatei oder zu groß' });
      continue;
    }
    if (size > MAX_TEXT_FILE_BYTES) {
      files.push({ ...baseMeta, skippedReason: `Datei größer als ${MAX_TEXT_FILE_BYTES} Bytes` });
      continue;
    }
    if (readCount >= MAX_FILES_TO_READ || totalBytes + size > MAX_TOTAL_SCAN_BYTES) {
      files.push({ ...baseMeta, skippedReason: 'Scan-Limit erreicht' });
      continue;
    }

    try {
      const buffer = await getBlobBuffer(fullName, entry.sha);
      const text = buffer.toString('utf8');
      const hash = sha256(buffer);
      const lines = text.split(/\r?\n/).length;
      readCount++;
      totalBytes += buffer.length;
      files.push({ ...baseMeta, read: true, hash, lines });
      contents.push({ path: filePath, language, size: buffer.length, hash, lines, text });
    } catch (e) {
      files.push({ ...baseMeta, skippedReason: `Lesefehler: ${e.message}` });
    }
  }

  return {
    repo,
    inventory: {
      totalFiles: files.length,
      readFiles: contents.length,
      totalBytesRead: totalBytes,
      files,
      languageCounts: countBy(files, 'language'),
      skipped: files.filter(f => f.skippedReason).slice(0, 100)
    },
    contents
  };
}

function countBy(items, key) {
  const out = {};
  for (const item of items) out[item[key]] = (out[item[key]] || 0) + 1;
  return out;
}
