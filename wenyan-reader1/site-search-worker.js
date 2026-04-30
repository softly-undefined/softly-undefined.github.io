let latestRunId = 0;
let manifestPromise = null;
const indexCache = new Map();

function normalizeSearchText(text) {
  return String(text || '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function countOccurrences(haystack, needle) {
  if (!needle || !haystack) {
    return 0;
  }
  let count = 0;
  let index = haystack.indexOf(needle);
  while (index !== -1) {
    count += 1;
    index = haystack.indexOf(needle, index + needle.length);
  }
  return count;
}

function buildSnippet(text, query) {
  if (!text) {
    return 'No preview available.';
  }
  const lower = String(text).toLowerCase();
  const needle = String(query || '').trim().toLowerCase();
  const foundAt = needle ? lower.indexOf(needle) : -1;
  const matchIndex = foundAt === -1 ? 0 : foundAt;
  const matchLength = foundAt === -1 ? 0 : needle.length;
  const radius = 70;
  const start = Math.max(0, matchIndex - radius);
  const end = Math.min(text.length, matchIndex + matchLength + radius);
  let snippet = text.slice(start, end);
  if (start > 0) {
    snippet = '...' + snippet;
  }
  if (end < text.length) {
    snippet += '...';
  }
  return snippet;
}

function loadManifest() {
  if (!manifestPromise) {
    manifestPromise = fetch('search-index/manifest.json')
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load search manifest.');
        }
        return response.json();
      })
      .then((manifest) => {
        const documents = manifest && Array.isArray(manifest.documents)
          ? manifest.documents
          : [];
        return documents
          .filter((doc) => doc && doc.docPath && doc.searchPath)
          .map((doc) => ({
            docPath: doc.docPath,
            searchPath: doc.searchPath,
            chineseTitle: doc.chineseTitle || '',
            englishTitle: doc.englishTitle || '',
            displayTitle: doc.displayTitle || doc.chineseTitle || doc.docPath,
            titleSearch: normalizeSearchText(doc.displayTitle || doc.chineseTitle || doc.docPath),
          }));
      });
  }
  return manifestPromise;
}

function loadDocumentIndex(doc) {
  if (!indexCache.has(doc.searchPath)) {
    const promise = fetch(doc.searchPath)
      .then((response) => {
        if (!response.ok) {
          throw new Error('Unable to load document search index.');
        }
        return response.json();
      })
      .then((entries) => (Array.isArray(entries) ? entries : [])
        .filter((entry) => entry && entry.anchor && entry.text)
        .map((entry) => {
          const chunkText = entry.text || '';
          return {
            path: doc.docPath + '#' + entry.anchor,
            chineseTitle: doc.chineseTitle,
            englishTitle: doc.englishTitle,
            displayTitle: doc.displayTitle,
            chunkType: entry.type || 'translation',
            marker: entry.marker || '',
            chunkText,
            chunkSearch: normalizeSearchText(chunkText),
            titleSearch: doc.titleSearch,
          };
        }))
      .catch(() => []);
    indexCache.set(doc.searchPath, promise);
  }
  return indexCache.get(doc.searchPath);
}

function scoreEntry(item, query, rawQuery) {
  if (!item.chunkSearch.includes(query)) {
    return null;
  }
  let score = 0;
  if (item.titleSearch.includes(query)) {
    score += 12;
  }
  score += countOccurrences(item.chunkSearch, query) * 20;
  if (item.chunkSearch.startsWith(query)) {
    score += 4;
  }
  return {
    score,
    entry: {
      path: item.path,
      chineseTitle: item.chineseTitle,
      englishTitle: item.englishTitle,
      displayTitle: item.displayTitle,
      chunkType: item.chunkType,
      marker: item.marker,
      snippet: buildSnippet(item.chunkText, rawQuery),
    },
  };
}

function mergeTopMatches(current, next, maxResults) {
  if (!next.length) {
    return current;
  }
  return current
    .concat(next)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}

async function runSearch(runId, rawQuery) {
  latestRunId = runId;
  const query = normalizeSearchText(rawQuery);
  const maxResults = 250;
  const batchSize = 4;
  let matches = [];
  let totalMatches = 0;
  const documents = await loadManifest();
  if (runId !== latestRunId) {
    return;
  }
  for (let i = 0; i < documents.length; i += batchSize) {
    const batch = documents.slice(i, i + batchSize);
    const batchResults = await Promise.all(
      batch.map((doc) =>
        loadDocumentIndex(doc).then((entries) =>
          entries
            .map((entry) => scoreEntry(entry, query, rawQuery))
            .filter(Boolean)
        )
      )
    );
    if (runId !== latestRunId) {
      return;
    }
    const flatResults = batchResults.flat();
    totalMatches += flatResults.length;
    matches = mergeTopMatches(matches, flatResults, maxResults);
    self.postMessage({
      type: 'results',
      runId,
      matches,
      totalMatches,
      inProgress: i + batchSize < documents.length,
      scannedDocs: Math.min(i + batchSize, documents.length),
      totalDocs: documents.length,
    });
  }
}

self.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.type !== 'search') {
    return;
  }
  runSearch(message.runId, message.query || '').catch((error) => {
    if (message.runId !== latestRunId) {
      return;
    }
    self.postMessage({
      type: 'error',
      runId: message.runId,
      message: error && error.message ? error.message : 'Search failed.',
    });
  });
});
