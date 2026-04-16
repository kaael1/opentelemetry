import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { buildCorpus } from './corpus.mjs';
import { aiConfig, dependencyStatus, embedText, rerankPairs } from './embeddings.mjs';

let memoryIndex = null;

function cosine(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const length = Math.min(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    normA += a[index] * a[index];
    normB += b[index] * b[index];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1);
}

function textScore(query, doc) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${doc.title} ${doc.text}`.toLowerCase();
  if (terms.length === 0) return 0;
  return terms.reduce((score, term) => score + (text.includes(term) ? 1 : 0), 0) / terms.length;
}

function cachePaths() {
  const dir = resolve(process.cwd(), aiConfig().cacheDir);
  return {
    dir,
    embeddings: join(dir, 'embeddings.json'),
    meta: join(dir, 'meta.json'),
  };
}

async function readCache() {
  const paths = cachePaths();
  if (!existsSync(paths.embeddings)) return null;
  try {
    return JSON.parse(await readFile(paths.embeddings, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCache(index) {
  const paths = cachePaths();
  await mkdir(paths.dir, { recursive: true });
  await writeFile(paths.embeddings, JSON.stringify(index), 'utf8');
  await writeFile(paths.meta, JSON.stringify({ generatedAt: new Date().toISOString(), docs: index.docs.length }), 'utf8');
}

export async function aiStatus(snapshot) {
  const config = aiConfig();
  const dependency = await dependencyStatus();
  const paths = cachePaths();
  const cacheInfo = existsSync(paths.embeddings) ? await stat(paths.embeddings).catch(() => null) : null;
  const loaded = memoryIndex?.docs?.length || 0;

  let llm = { available: false, baseUrl: config.llmBaseUrl, model: config.llmModel };
  try {
    const response = await fetch(`${config.llmBaseUrl}/models`, { signal: AbortSignal.timeout(1200) });
    llm = { ...llm, available: response.ok };
  } catch {
    // Local LLM is optional.
  }

  return {
    cache: cacheInfo
      ? { ageMs: Date.now() - cacheInfo.mtimeMs, docs: loaded, path: paths.embeddings, size: cacheInfo.size }
      : { ageMs: null, docs: loaded, path: paths.embeddings, size: 0 },
    config,
    dependency,
    enabled: config.enabled,
    llm,
  };
}

export async function ensureIndex(snapshot, { force = false } = {}) {
  const config = aiConfig();
  const docs = buildCorpus(snapshot);

  if (!config.enabled) {
    memoryIndex = { createdAt: new Date().toISOString(), docs, mode: 'text' };
    return memoryIndex;
  }

  if (!force && memoryIndex?.docs?.length) return memoryIndex;

  if (!force) {
    const cached = await readCache();
    if (cached?.docs?.length) {
      memoryIndex = cached;
      return memoryIndex;
    }
  }

  const vectors = [];
  for (const doc of docs) {
    vectors.push({ ...doc, embedding: await embedText(doc.text) });
  }

  memoryIndex = {
    createdAt: new Date().toISOString(),
    docs: vectors,
    embedModel: config.embedModel,
    mode: 'semantic',
  };
  await writeCache(memoryIndex);
  return memoryIndex;
}

export async function search(snapshot, { limit = 10, query = '', rerank = true } = {}) {
  const config = aiConfig();
  const index = await ensureIndex(snapshot);
  const safeLimit = Math.min(50, Math.max(1, Number(limit) || 10));

  let results = [];
  let mode = index.mode || 'text';
  if (config.enabled && index.mode === 'semantic') {
    const queryEmbedding = await embedText(query);
    results = index.docs
      .map((doc) => ({ ...doc, score: cosine(queryEmbedding, doc.embedding || []) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(safeLimit, 30));
  } else {
    mode = 'text';
    results = index.docs
      .map((doc) => ({ ...doc, score: textScore(query, doc) }))
      .filter((doc) => doc.score > 0 || String(doc.text).toLowerCase().includes(String(query).toLowerCase()))
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(safeLimit, 30));
  }

  let rerankStatus = 'skipped';
  if (rerank && config.enabled && results.length > 1) {
    try {
      results = await rerankPairs(query, results.slice(0, 30));
      rerankStatus = 'ok';
    } catch (error) {
      rerankStatus = `unavailable: ${error.message}`;
    }
  }

  return {
    docs: results.slice(0, safeLimit).map(({ embedding, ...doc }) => doc),
    mode,
    query,
    rerank: rerankStatus,
  };
}

export async function similarEvent(snapshot, { id, limit = 8 } = {}) {
  const event = (snapshot.events || []).find((item) => item.id === id);
  if (!event) {
    const error = new Error(`Event not found: ${id}`);
    error.status = 404;
    throw error;
  }

  return search(snapshot, {
    limit,
    query: [event.title, event.summary, event.command, event.output, ...(event.files || [])].filter(Boolean).join(' '),
    rerank: true,
  });
}
