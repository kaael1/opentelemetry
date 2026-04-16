export const storyQuestions = [
  {
    category: 'visao_geral',
    explanationMode: 'session_story',
    id: 'story_session_short',
    label: 'Conta essa sessão como uma história curta.',
    preferredEventTypes: ['user_message', 'spawn_agent', 'shell_command', 'apply_patch', 'task_complete'],
    preferredStatuses: [],
    retrievalQuery: 'história sessão começo missão agentes conflito resolução resultado',
    scope: ['session'],
  },
  {
    category: 'conflito',
    explanationMode: 'blocker_analysis',
    id: 'story_first_problem',
    label: 'Qual foi o primeiro sinal de problema?',
    preferredEventTypes: ['shell_command', 'wait_agent', 'turn_aborted', 'task_complete'],
    preferredStatuses: ['failed', 'timeout', 'aborted'],
    retrievalQuery: 'primeiro erro falha timeout abortado bloqueio comando problema',
    scope: ['session', 'timeline'],
  },
  {
    category: 'personagens',
    explanationMode: 'agent_comparison',
    id: 'story_parallel_roles',
    label: 'Quem fez o quê em paralelo?',
    preferredEventTypes: ['spawn_agent', 'close_agent', 'task_complete', 'agent_message'],
    preferredStatuses: [],
    retrievalQuery: 'agentes paralelo designação papel worker explorer contribuição',
    scope: ['session', 'agent', 'lanes'],
  },
  {
    category: 'personagens',
    explanationMode: 'agent_impact',
    id: 'story_unlocking_agent',
    label: 'Qual agente desbloqueou mais trabalho?',
    preferredEventTypes: ['task_complete', 'close_agent', 'apply_patch', 'shell_command'],
    preferredStatuses: ['completed'],
    retrievalQuery: 'agente desbloqueou entrega completou patch comando contribuição evidência',
    scope: ['agent', 'lanes'],
  },
  {
    category: 'conflito',
    explanationMode: 'wait_timeout_analysis',
    id: 'story_wait_timeout',
    label: 'Onde houve espera ou timeout?',
    preferredEventTypes: ['wait_agent', 'shell_command', 'turn_aborted'],
    preferredStatuses: ['timeout', 'failed', 'aborted'],
    retrievalQuery: 'wait espera timeout demorou lento travou bloqueio',
    scope: ['session', 'timeline'],
  },
  {
    category: 'evidencias',
    explanationMode: 'file_story',
    id: 'story_files',
    label: 'Quais arquivos contam a história principal?',
    preferredEventTypes: ['apply_patch', 'shell_command', 'task_complete'],
    preferredStatuses: [],
    retrievalQuery: 'arquivos modificados patch changed files source path evidências entrega',
    scope: ['session', 'timeline'],
  },
  {
    category: 'climax',
    explanationMode: 'turning_point',
    id: 'story_turning_point',
    label: 'Qual decisão mudou o rumo da execução?',
    preferredEventTypes: ['apply_patch', 'shell_command', 'spawn_agent', 'wait_agent', 'task_complete'],
    preferredStatuses: [],
    retrievalQuery: 'momento decisivo mudou rumo decisão comando patch clímax impacto',
    scope: ['session', 'timeline'],
  },
  {
    category: 'proximos_passos',
    explanationMode: 'follow_up',
    id: 'story_next_check',
    label: 'O que eu deveria checar antes de rodar de novo?',
    preferredEventTypes: ['shell_command', 'task_complete', 'apply_patch', 'turn_aborted'],
    preferredStatuses: ['failed', 'timeout', 'aborted', 'completed'],
    retrievalQuery: 'próximos passos verificar antes rodar de novo testes riscos pendências',
    scope: ['session', 'timeline'],
  },
];

export function getStoryQuestions({ limit = 8, rootSessionId } = {}) {
  const ranked = rootSessionId
    ? storyQuestions
    : storyQuestions.filter((question) => question.scope.includes('session') || question.scope.includes('timeline'));
  return ranked.slice(0, Number(limit) || 8);
}

export function findStoryQuestion(idOrLabel) {
  const needle = String(idOrLabel || '').trim().toLowerCase();
  return storyQuestions.find((question) => question.id === idOrLabel || question.label.toLowerCase() === needle) || null;
}
