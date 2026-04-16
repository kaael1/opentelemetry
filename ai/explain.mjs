import { aiConfig } from './embeddings.mjs';
import { findStoryQuestion } from './story-questions.mjs';
import { search, similarEvent } from './index.mjs';

const prompts = {
  agent_comparison: 'Compare os agentes como papéis narrativos e operacionais. Explique missão, contribuição, sinais de sucesso/falha e relação com o agente principal.',
  agent_impact: 'Explique qual agente parece ter desbloqueado mais trabalho, separando evidência direta de inferência.',
  blocker_analysis: 'Identifique o primeiro bloqueio importante, o evento que melhor o prova, agentes afetados, impacto provável e próxima ação.',
  file_story: 'Explique quais arquivos ou caminhos ajudam a contar a história principal da sessão.',
  follow_up: 'Gere uma checklist curta de follow-up, ligando cada item a uma evidência da telemetria.',
  session_story: 'Conte a sessão como narrativa técnica: contexto, personagens, conflito, clímax, resolução e próximos passos.',
  turning_point: 'Identifique o momento decisivo da sessão e por que ele mudou o rumo do trabalho.',
  wait_timeout_analysis: 'Explique esperas, waits, timeouts ou gargalos e seus impactos.',
};

function evidenceText(docs) {
  return docs
    .slice(0, 10)
    .map((doc, index) => {
      const meta = doc.metadata || {};
      return [
        `Evidência ${index + 1}`,
        `Tipo: ${doc.kind}`,
        `Título: ${doc.title}`,
        `Agente: ${meta.agentName || meta.agentId || 'main'}`,
        `Evento: ${meta.eventType || ''}`,
        `Status: ${meta.status || ''}`,
        `Timestamp: ${meta.timestamp || ''}`,
        `Texto: ${doc.text}`,
      ].join('\n');
    })
    .join('\n\n');
}

async function callLocalLlm({ docs, mode, question }) {
  const config = aiConfig();
  const system = [
    'Você é um analista de telemetria Codex.',
    'Responda em português.',
    'Use apenas as evidências fornecidas.',
    'Separe evidência direta de inferência.',
    'Cite agentes, tipos de evento, timestamps ou arquivos quando existirem.',
    'Se não houver dados suficientes, diga isso claramente.',
  ].join(' ');
  const modePrompt = prompts[mode] || prompts.session_story;
  const body = {
    messages: [
      { content: system, role: 'system' },
      { content: `${modePrompt}\n\nPergunta: ${question}\n\n${evidenceText(docs)}`, role: 'user' },
    ],
    model: config.llmModel,
    stream: false,
    temperature: 0.2,
  };

  const response = await fetch(`${config.llmBaseUrl}/chat/completions`, {
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error(`Local LLM returned ${response.status}`);
  const json = await response.json();
  return json.choices?.[0]?.message?.content || '';
}

function fallbackExplanation({ docs, question }) {
  const evidence = docs.slice(0, 5).map((doc) => ({
    agent: doc.metadata?.agentName || doc.metadata?.agentId || 'main',
    eventType: doc.metadata?.eventType || doc.kind,
    status: doc.metadata?.status || '',
    summary: doc.text.slice(0, 260),
    timestamp: doc.metadata?.timestamp || '',
    title: doc.title,
  }));

  return {
    answer: [
      `Não encontrei um LLM local ativo para responder com narrativa completa.`,
      `Ainda assim, estas são as evidências mais relevantes para: "${question}".`,
      ...evidence.map((item, index) => `${index + 1}. ${item.agent} · ${item.eventType} · ${item.status} · ${item.timestamp}: ${item.title}`),
    ].join('\n'),
    evidence,
    inference: 'Inicie um servidor LLM local OpenAI-compatible em AI_LLM_BASE_URL para obter explicações narrativas completas.',
  };
}

export async function explain(snapshot, { id, kind = 'session_story', question = '' } = {}) {
  const storyQuestion = findStoryQuestion(question) || findStoryQuestion(kind);
  const mode = storyQuestion?.explanationMode || kind || 'session_story';
  const retrievalQuery = storyQuestion?.retrievalQuery || question || kind;
  const results = id
    ? await similarEvent(snapshot, { id, limit: 10 }).catch(() => search(snapshot, { limit: 10, query: retrievalQuery, rerank: true }))
    : await search(snapshot, { limit: 10, query: retrievalQuery, rerank: true });
  const docs = results.docs || [];

  try {
    const answer = await callLocalLlm({ docs, mode, question: question || storyQuestion?.label || retrievalQuery });
    return { answer, docs, llm: 'ok', mode, question: question || storyQuestion?.label || retrievalQuery };
  } catch (error) {
    return {
      ...fallbackExplanation({ docs, question: question || storyQuestion?.label || retrievalQuery }),
      docs,
      llm: `unavailable: ${error.message}`,
      mode,
      question: question || storyQuestion?.label || retrievalQuery,
    };
  }
}
