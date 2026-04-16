let extractorPromise = null;
let rerankerPromise = null;

export function aiConfig() {
  return {
    cacheDir: process.env.AI_CACHE_DIR || '.opentelemetry-cache',
    device: process.env.AI_DEVICE || 'auto',
    embedModel: process.env.AI_EMBED_MODEL || 'BAAI/bge-small-en-v1.5',
    enabled: process.env.AI_ENABLED === '1',
    llmBaseUrl: process.env.AI_LLM_BASE_URL || 'http://127.0.0.1:8791/v1',
    llmModel: process.env.AI_LLM_MODEL || 'qwen3-4b',
    rerankModel: process.env.AI_RERANK_MODEL || 'Xenova/bge-reranker-base',
  };
}

export async function dependencyStatus() {
  try {
    await import('@huggingface/transformers');
    return { available: true };
  } catch (error) {
    return {
      available: false,
      install: 'npm install',
      message: `Optional dependency @huggingface/transformers is not available: ${error.message}`,
    };
  }
}

async function loadPipeline(task, model) {
  const status = await dependencyStatus();
  if (!status.available) {
    const error = new Error(status.message);
    error.code = 'AI_DEPENDENCY_MISSING';
    error.status = 503;
    throw error;
  }

  const { env, pipeline } = await import('@huggingface/transformers');
  env.allowLocalModels = true;
  env.allowRemoteModels = true;
  const config = aiConfig();
  const options = {};
  if (config.device && config.device !== 'auto') options.device = config.device;
  return pipeline(task, model, options);
}

export async function getExtractor() {
  const config = aiConfig();
  extractorPromise ||= loadPipeline('feature-extraction', config.embedModel);
  return extractorPromise;
}

export async function embedText(text) {
  const extractor = await getExtractor();
  const output = await extractor(String(text || ''), { normalize: true, pooling: 'mean' });
  return Array.from(output.data || output);
}

export async function getReranker() {
  const config = aiConfig();
  rerankerPromise ||= loadPipeline('text-classification', config.rerankModel);
  return rerankerPromise;
}

export async function rerankPairs(query, docs) {
  const reranker = await getReranker();
  const pairs = docs.map((doc) => ({ text: query, text_pair: doc.text }));
  const results = await reranker(pairs, { topk: 1 });
  return docs
    .map((doc, index) => {
      const result = Array.isArray(results[index]) ? results[index][0] : results[index];
      return { ...doc, rerankScore: Number(result?.score || 0) };
    })
    .sort((a, b) => b.rerankScore - a.rerankScore);
}
