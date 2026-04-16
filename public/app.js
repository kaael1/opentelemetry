const state = {
  filter: '',
  laneFocusedAgent: '',
  laneSort: 'recent',
  liveOnly: false,
  aiAnswer: null,
  aiLoading: false,
  aiResults: null,
  aiStatus: null,
  guideOpen: false,
  guideTab: 'start',
  problemsOnly: false,
  replayEnabled: false,
  replaySpeed: 1,
  showCompletedLanes: true,
  snapshot: null,
  timelineAgent: '',
  timelineType: '',
  timelineWindow: 'all',
  storyQuestions: [],
};

let replayTimer = null;

const el = {
  agentCards: document.querySelector('#agentCards'),
  agentCount: document.querySelector('#agentCount'),
  aiExplainFailure: document.querySelector('#aiExplainFailure'),
  aiNarrate: document.querySelector('#aiNarrate'),
  aiQuestion: document.querySelector('#aiQuestion'),
  aiResults: document.querySelector('#aiResults'),
  aiSearch: document.querySelector('#aiSearch'),
  aiSimilar: document.querySelector('#aiSimilar'),
  aiStatusText: document.querySelector('#aiStatusText'),
  clearLaneFocus: document.querySelector('#clearLaneFocus'),
  connectionDot: document.querySelector('#connectionDot'),
  connectionText: document.querySelector('#connectionText'),
  eventCount: document.querySelector('#eventCount'),
  events: document.querySelector('#events'),
  filterInput: document.querySelector('#filterInput'),
  guideBackdrop: document.querySelector('#guideBackdrop'),
  guideClose: document.querySelector('#guideClose'),
  guideContent: document.querySelector('#guideContent'),
  guideDontShow: document.querySelector('#guideDontShow'),
  helpButton: document.querySelector('#helpButton'),
  laneCount: document.querySelector('#laneCount'),
  laneSort: document.querySelector('#laneSort'),
  lanes: document.querySelector('#lanes'),
  lastUpdate: document.querySelector('#lastUpdate'),
  liveOnly: document.querySelector('#liveOnly'),
  metricAgents: document.querySelector('#metricAgents'),
  metricEvents: document.querySelector('#metricEvents'),
  metricRunning: document.querySelector('#metricRunning'),
  metricSessions: document.querySelector('#metricSessions'),
  openState: document.querySelector('#openState'),
  problemsOnly: document.querySelector('#problemsOnly'),
  replayClock: document.querySelector('#replayClock'),
  replayScrubber: document.querySelector('#replayScrubber'),
  replaySpeed: document.querySelector('#replaySpeed'),
  replayToggle: document.querySelector('#replayToggle'),
  rootCount: document.querySelector('#rootCount'),
  rootSessions: document.querySelector('#rootSessions'),
  showCompletedLanes: document.querySelector('#showCompletedLanes'),
  storyChips: document.querySelector('#storyChips'),
  timelineAgent: document.querySelector('#timelineAgent'),
  timelineSummary: document.querySelector('#timelineSummary'),
  timelineType: document.querySelector('#timelineType'),
  timelineWindow: document.querySelector('#timelineWindow'),
};

const liveStatuses = new Set(['running', 'active', 'waiting', 'recent']);
const problemStatuses = new Set(['failed', 'aborted', 'timeout']);

const statusLabel = {
  aborted: 'abortado',
  active: 'ativo',
  closed: 'fechado',
  completed: 'feito',
  failed: 'falha',
  idle: 'idle',
  recent: 'recente',
  running: 'rodando',
  stale: 'stale',
  timeout: 'timeout',
  unknown: 'n/a',
  waiting: 'esperando',
};

const eventLabel = {
  agent_message: 'mensagem',
  apply_patch: 'patch',
  assigned: 'assign',
  close_agent: 'close',
  function_call: 'tool',
  session_started: 'sessão',
  shell_command: 'cmd',
  spawn_agent: 'spawn',
  subagent_notification: 'notify',
  task_complete: 'complete',
  task_started: 'start',
  turn_aborted: 'abort',
  update_plan: 'plan',
  user_message: 'user',
  wait_agent: 'wait',
};

const guideTabs = {
  ask: {
    title: 'Ask Telemetry',
    body: 'Use o campo de pergunta para buscar evidências, narrar uma sessão ou explicar falhas. A busca textual funciona sempre; embeddings, rerank e LLM local aparecem quando a IA estiver configurada.',
    bullets: ['Buscar encontra eventos parecidos.', 'Narrar sessão transforma logs em arco técnico.', 'Explicar falha separa evidência de inferência.', 'Resultados clicáveis focam agentes e eventos.'],
  },
  lanes: {
    title: 'Parallel Lanes',
    body: 'Cada lane é uma thread de trabalho. A main thread fica junto dos subagentes para mostrar paralelismo, waits e conclusões.',
    bullets: ['Segmentos mostram fases reais.', 'Heatmap mostra intensidade.', 'Badges resumem comandos, patches, waits e erros.', 'Focar segue um agente no painel todo.'],
  },
  questions: {
    title: 'Perguntas',
    body: 'As perguntas prontas são atalhos de storytelling. Elas ajudam a transformar telemetria bruta em começo, conflito, clímax, resolução e próximos passos.',
    bullets: ['Use perguntas simples primeiro.', 'Abra evidências antes de confiar na conclusão.', 'Se não houver IA local, os chips ainda filtram a investigação.'],
  },
  start: {
    title: 'Comece aqui',
    body: 'Este painel lê suas sessões locais do Codex e mostra agentes, comandos, patches e eventos em tempo real.',
    bullets: ['Confirme que o topo está ao vivo.', 'Olhe métricas e agentes ativos.', 'Use Parallel Lanes para ver quem trabalhou.', 'Use Timeline para abrir a evidência.'],
  },
  timeline: {
    title: 'Timeline',
    body: 'A Timeline é a história detalhada. Ela agrupa eventos por sessão, mostra duração, status, comandos, arquivos e outputs resumidos.',
    bullets: ['Filtre por agente, tipo e janela.', 'Marque problemas para ver falhas.', 'Expanda eventos para ver detalhes.', 'Use evidências para validar narrativas.'],
  },
};

const phaseLabel = {
  assigned: 'assigned',
  done: 'done',
  failed: 'failed',
  patching: 'patching',
  reading: 'reading',
  tooling: 'tooling',
  verifying: 'verify',
  waiting: 'waiting',
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function timestampMs(value) {
  const time = new Date(value || '').getTime();
  return Number.isFinite(time) ? time : 0;
}

function timeAgo(value) {
  if (!value) return '--';
  const delta = Date.now() - timestampMs(value);
  if (!Number.isFinite(delta)) return '--';
  const seconds = Math.max(0, Math.round(delta / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function formatClock(value) {
  if (!value) return '--';
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value));
}

function formatDuration(ms) {
  const value = Number(ms || 0);
  if (!value) return '';
  if (value < 1000) return `${value}ms`;
  const seconds = value / 1000;
  if (seconds < 60) return `${seconds.toFixed(seconds >= 10 ? 0 : 1)}s`;
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}m ${rest}s`;
}

function timelineRange() {
  const groups = state.snapshot?.laneGroups || [];
  const starts = groups.map((group) => timestampMs(group.startedAt)).filter(Boolean);
  const ends = groups.map((group) => timestampMs(group.endedAt || group.updatedAt)).filter(Boolean);
  const start = Math.min(...starts, Date.now());
  const end = Math.max(...ends, start + 60_000);
  return { end, start };
}

function replayProgress() {
  return Number(el.replayScrubber?.value || 1000) / 1000;
}

function replayCutoffMs() {
  if (!state.replayEnabled) return Number.POSITIVE_INFINITY;
  const { end, start } = timelineRange();
  return start + (end - start) * replayProgress();
}

function replayProgressForGroup(group) {
  if (!state.replayEnabled) return 100;
  const start = timestampMs(group.startedAt);
  const end = Math.max(timestampMs(group.endedAt || group.updatedAt), start + 60_000);
  return Math.max(0, Math.min(100, ((replayCutoffMs() - start) / (end - start)) * 100));
}

function cutoffForWindow() {
  const now = Date.now();
  if (state.timelineWindow === '15m') return now - 15 * 60 * 1000;
  if (state.timelineWindow === '1h') return now - 60 * 60 * 1000;
  if (state.timelineWindow === '24h') return now - 24 * 60 * 60 * 1000;
  return 0;
}

function includesFilter(text) {
  const filter = state.filter.trim().toLowerCase();
  if (!filter) return true;
  return String(text || '').toLowerCase().includes(filter);
}

function matchesAgentFilter(agent) {
  if (state.laneFocusedAgent && agent.id !== state.laneFocusedAgent) return false;
  const haystack = [agent.nickname, agent.role, agent.status, agent.designation, agent.report, agent.relativePath, ...(agent.changedFiles || [])].join(' ');
  return includesFilter(haystack);
}

function matchesEventFilter(event) {
  const focused = state.laneFocusedAgent || state.timelineAgent;
  if (focused && event.agentId !== focused && event.targetAgentId !== focused) return false;
  if (state.timelineType && event.eventType !== state.timelineType) return false;
  if (state.problemsOnly && !event.isProblem && !problemStatuses.has(event.status)) return false;
  const cutoff = cutoffForWindow();
  if (cutoff && timestampMs(event.timestamp) < cutoff) return false;
  if (timestampMs(event.timestamp) > replayCutoffMs()) return false;
  const text = [event.agentName, event.targetAgentName, event.eventType, event.status, event.title, event.summary, event.command, event.output, ...(event.files || [])].join(' ');
  return includesFilter(text);
}

function filteredAgents() {
  const agents = state.snapshot?.agents || [];
  return agents.filter((agent) => matchesAgentFilter(agent) && (!state.liveOnly || liveStatuses.has(agent.status)));
}

function filteredTimelineGroups() {
  const groups = state.snapshot?.timelineGroups || [];
  return groups
    .map((group) => ({ ...group, events: group.events.filter(matchesEventFilter) }))
    .filter((group) => group.events.length > 0);
}

function laneMatchesFilter(lane) {
  if (!state.showCompletedLanes && ['completed', 'closed', 'idle'].includes(lane.status)) return false;
  if (state.laneFocusedAgent && lane.agentId !== state.laneFocusedAgent && lane.agentId !== 'main') return false;
  const text = [
    lane.agentName,
    lane.role,
    lane.status,
    lane.sourcePath,
    lane.lastEvent?.title,
    lane.lastEvent?.summary,
    ...(lane.problemEvents || []).map((event) => event.summary),
  ].join(' ');
  return includesFilter(text);
}

function filteredLaneGroups() {
  const groups = state.snapshot?.laneGroups || [];
  return groups
    .map((group) => ({ ...group, lanes: group.lanes.filter(laneMatchesFilter) }))
    .filter((group) => group.lanes.length > 0)
    .sort((a, b) => {
      if (state.laneSort === 'active') return b.lanes.reduce((sum, lane) => sum + lane.toolStats.events, 0) - a.lanes.reduce((sum, lane) => sum + lane.toolStats.events, 0);
      if (state.laneSort === 'slow') return b.durationMs - a.durationMs;
      if (state.laneSort === 'problems') return b.problemCount - a.problemCount;
      if (state.laneSort === 'session') return String(a.title).localeCompare(String(b.title));
      return timestampMs(b.updatedAt) - timestampMs(a.updatedAt);
    });
}

function setConnection(online) {
  el.connectionDot.classList.toggle('online', online);
  el.connectionDot.classList.toggle('offline', !online);
  el.connectionText.textContent = online ? 'ao vivo' : 'desconectado';
}

function renderMetrics(snapshot) {
  el.metricAgents.textContent = snapshot.stats.agents;
  el.metricRunning.textContent = snapshot.stats.runningAgents;
  el.metricSessions.textContent = snapshot.stats.sessionFiles;
  el.metricEvents.textContent = snapshot.stats.recentEvents;
  el.lastUpdate.textContent = formatClock(snapshot.generatedAt);
}

function aiStatusLabel() {
  const status = state.aiStatus;
  if (!status) return 'checando IA';
  if (!status.enabled) return 'IA desligada · busca textual ativa';
  if (!status.dependency?.available) return 'IA sem dependência opcional';
  if (!status.llm?.available) return 'embeddings prontos · LLM local ausente';
  return 'IA local pronta';
}

function renderStoryChips() {
  const questions = state.storyQuestions || [];
  if (questions.length === 0) {
    el.storyChips.innerHTML = '<span class="story-empty">perguntas carregando</span>';
    return;
  }
  el.storyChips.innerHTML = questions
    .map((question) => `<button class="story-chip" data-question-id="${escapeHtml(question.id)}" type="button">${escapeHtml(question.label)}</button>`)
    .join('');
}

function renderAIResults() {
  if (state.aiLoading) {
    el.aiResults.innerHTML = '<div class="ai-empty">analisando telemetria...</div>';
    return;
  }

  const answer = state.aiAnswer;
  const results = state.aiResults;
  if (!answer && !results) {
    el.aiResults.innerHTML = '<div class="ai-empty">Faça uma pergunta ou escolha uma história pronta.</div>';
    return;
  }

  const answerHtml = answer
    ? `<article class="ai-answer"><h3>Resposta</h3><pre>${escapeHtml(answer.answer || answer)}</pre>${answer.llm ? `<span>${escapeHtml(answer.llm)}</span>` : ''}</article>`
    : '';
  const docs = results?.docs || answer?.docs || [];
  const docsHtml = docs.length
    ? `<div class="ai-docs">${docs
        .slice(0, 8)
        .map(
          (doc) => `
            <button class="ai-doc" data-agent-id="${escapeHtml(doc.metadata?.agentId || '')}" data-event-id="${escapeHtml(doc.metadata?.eventId || '')}" type="button">
              <strong>${escapeHtml(doc.title || doc.kind)}</strong>
              <span>${escapeHtml(doc.kind)} · ${escapeHtml(doc.metadata?.agentName || 'main')} · ${escapeHtml(doc.metadata?.status || '')}</span>
              <p>${escapeHtml(doc.text || '')}</p>
            </button>`,
        )
        .join('')}</div>`
    : '';
  el.aiResults.innerHTML = answerHtml + docsHtml;
}

function renderGuide() {
  el.guideBackdrop.hidden = !state.guideOpen;
  if (!state.guideOpen) return;
  const tab = guideTabs[state.guideTab] || guideTabs.start;
  for (const button of el.guideBackdrop.querySelectorAll('[data-guide-tab]')) {
    button.dataset.active = button.dataset.guideTab === state.guideTab ? 'true' : 'false';
  }
  el.guideContent.innerHTML = `
    <h3>${escapeHtml(tab.title)}</h3>
    <p>${escapeHtml(tab.body)}</p>
    <ul>${tab.bullets.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

function renderAIPanel() {
  el.aiStatusText.textContent = aiStatusLabel();
  renderStoryChips();
  renderAIResults();
  renderGuide();
}

function renderLaneControls() {
  if (el.clearLaneFocus) el.clearLaneFocus.textContent = state.laneFocusedAgent ? 'Limpar' : 'Foco';
  if (el.replayToggle) el.replayToggle.textContent = state.replayEnabled ? 'Pause' : 'Play';
  if (el.replayClock) {
    if (!state.replayEnabled) {
      el.replayClock.textContent = 'ao vivo';
    } else {
      el.replayClock.textContent = formatClock(new Date(replayCutoffMs()).toISOString());
    }
  }
}

function renderSegment(segment) {
  const left = Math.max(0, Math.min(100, segment.left));
  const width = Math.max(0.8, Math.min(100 - left, segment.width));
  return `<span class="phase-segment" data-phase="${escapeHtml(segment.phase)}" title="${escapeHtml(`${phaseLabel[segment.phase] || segment.phase} · ${segment.title || ''}`)}" style="left:${left}%;width:${width}%"></span>`;
}

function renderHeatBucket(bucket) {
  const opacity = Math.max(0.12, Math.min(1, bucket.intensity || 0));
  const problem = bucket.problemCount > 0 ? ' data-problem="true"' : '';
  return `<span${problem} title="${bucket.count} eventos" style="opacity:${opacity}"></span>`;
}

function renderMiniLog(lane) {
  const entries = lane.miniLog || [];
  if (entries.length === 0) return '<div class="lane-log-empty">sem eventos nessa lane</div>';
  return entries
    .map(
      (event) => `
        <div class="lane-log-row" data-status="${escapeHtml(event.status)}">
          <span>${escapeHtml(eventLabel[event.eventType] || event.eventType)}</span>
          <strong>${escapeHtml(event.title || event.eventType)}</strong>
          <small>${timeAgo(event.timestamp)}${event.durationMs ? ` · ${escapeHtml(formatDuration(event.durationMs))}` : ''}</small>
          <p>${escapeHtml(event.summary || '')}</p>
        </div>`,
    )
    .join('');
}

function renderLane(lane, group) {
  const stats = lane.toolStats || {};
  const isFocused = state.laneFocusedAgent && state.laneFocusedAgent === lane.agentId;
  const status = statusLabel[lane.status] || lane.status;
  const focusButton = lane.agentId !== 'main' ? `<button class="lane-focus-button" data-agent-id="${escapeHtml(lane.agentId)}" type="button">${isFocused ? 'focado' : 'focar'}</button>` : '';
  return `
    <details class="radar-lane" data-status="${escapeHtml(lane.status)}" data-focused="${isFocused ? 'true' : 'false'}" style="--accent:${escapeHtml(lane.color || '#b8f35d')}; --replay:${replayProgressForGroup(group)}">
      <summary>
        <div class="radar-lane-head">
          <strong>${escapeHtml(lane.agentName)}</strong>
          <span>${escapeHtml(lane.role)} · ${escapeHtml(status)} · idle ${escapeHtml(formatDuration(lane.idleMs) || '--')}</span>
        </div>
        <div class="phase-track">
          ${lane.phaseSegments.map(renderSegment).join('')}
          <i class="replay-curtain"></i>
        </div>
        <div class="lane-badges">
          <span>cmd ${stats.cmd || 0}</span>
          <span>patch ${stats.patch || 0}</span>
          <span>wait ${stats.wait || 0}</span>
          <span>err ${stats.err || 0}</span>
        </div>
        ${focusButton}
      </summary>
      <div class="lane-expanded">
        <div class="lane-facts">
          <span>runtime ${escapeHtml(formatDuration(lane.durationMs) || '--')}</span>
          <span>last ${escapeHtml(lane.lastEvent?.title || '--')}</span>
          <span>${escapeHtml(lane.sourcePath || 'sem source')}</span>
        </div>
        <div class="heatmap">${lane.heatBuckets.map(renderHeatBucket).join('')}</div>
        <div class="lane-mini-log">${renderMiniLog(lane)}</div>
      </div>
    </details>`;
}

function renderEdges(group) {
  const visibleLaneIds = new Set(group.lanes.map((lane) => lane.agentId));
  const edges = (group.edges || []).filter((edge) => visibleLaneIds.has(edge.to) || edge.to === 'main').slice(-12);
  if (edges.length === 0) return '';
  return `<div class="lane-edges">${edges.map((edge) => `<span data-edge="${escapeHtml(edge.type)}">${escapeHtml(edge.type)} → ${escapeHtml(edge.to?.slice(0, 8) || 'agent')}</span>`).join('')}</div>`;
}

function renderLanes() {
  const groups = filteredLaneGroups();
  const laneTotal = groups.reduce((sum, group) => sum + group.lanes.length, 0);
  el.laneCount.textContent = `${laneTotal} lanes`;
  renderLaneControls();

  if (groups.length === 0) {
    el.lanes.innerHTML = '<div class="empty">sem lanes para este filtro</div>';
    return;
  }

  el.lanes.innerHTML = groups
    .map(
      (group) => `
        <section class="lane-group" data-status="${escapeHtml(group.status)}">
          <header>
            <div>
              <strong>${escapeHtml(group.title)}</strong>
              <span>${escapeHtml(formatDuration(group.durationMs) || '--')} · ${group.activeAgentCount} ativos · ${group.problemCount} problemas</span>
            </div>
            <span>${timeAgo(group.updatedAt)}</span>
          </header>
          ${renderEdges(group)}
          <div class="radar-lanes">${group.lanes.map((lane) => renderLane(lane, group)).join('')}</div>
        </section>`,
    )
    .join('');
}

function renderAgentCards(agents) {
  el.agentCount.textContent = agents.length;
  if (agents.length === 0) {
    el.agentCards.innerHTML = '<div class="empty">sem designações visíveis</div>';
    return;
  }

  el.agentCards.innerHTML = agents
    .map((agent) => {
      const chips = (agent.changedFiles || []).map((file) => `<span class="chip">${escapeHtml(file)}</span>`).join('');
      return `
        <article class="agent-card" style="--accent:${escapeHtml(agent.color || '#b8f35d')}">
          <div class="agent-title">
            <strong>${escapeHtml(agent.nickname)}</strong>
            <span class="status-pill">${escapeHtml(statusLabel[agent.status] || agent.status)}</span>
          </div>
          <div class="meta">${escapeHtml(agent.role)} · ${escapeHtml(agent.reasoning || 'default')} · ${escapeHtml(agent.relativePath || 'sem arquivo')}</div>
          <p class="assignment">${escapeHtml(agent.designation || 'sem designação capturada')}</p>
          ${agent.report ? `<p class="report">${escapeHtml(agent.report)}</p>` : ''}
          ${chips ? `<div class="chips">${chips}</div>` : ''}
        </article>`;
    })
    .join('');
}

function renderRootSessions(snapshot) {
  const roots = snapshot.rootSessions || [];
  el.rootCount.textContent = roots.length;
  if (roots.length === 0) {
    el.rootSessions.innerHTML = '<div class="empty">nenhuma sessão mãe recente</div>';
    return;
  }

  el.rootSessions.innerHTML = roots
    .map(
      (root) => `
        <article class="root-card">
          <div class="root-title">
            <strong>${escapeHtml(root.id?.slice(0, 8) || 'main')}</strong>
            <span class="status-pill">${escapeHtml(statusLabel[root.status] || root.status)}</span>
          </div>
          <div class="meta">${escapeHtml(root.cwd || '')}</div>
          <p>${escapeHtml(root.prompt || 'sem prompt visível')}</p>
          <div class="chips">
            <span class="chip">spawn ${root.spawns}</span>
            <span class="chip">wait ${root.waits}</span>
            <span class="chip">close ${root.closes}</span>
            <span class="chip">${timeAgo(root.updatedAt)}</span>
          </div>
        </article>`,
    )
    .join('');
}

function setSelectOptions(select, options, currentValue) {
  const next = [''].concat(options);
  const current = [...select.options].map((option) => option.value);
  if (current.join('|') === next.join('|')) return;
  select.innerHTML = next.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value || 'todos')}</option>`).join('');
  select.value = currentValue;
}

function renderTimelineControls(snapshot) {
  const agentOptions = (snapshot.agents || []).map((agent) => agent.id);
  const agentLabels = new Map((snapshot.agents || []).map((agent) => [agent.id, `${agent.nickname} · ${agent.role}`]));
  setSelectOptions(el.timelineAgent, agentOptions, state.timelineAgent);
  for (const option of el.timelineAgent.options) option.textContent = option.value ? agentLabels.get(option.value) || option.value : 'todos';
  setSelectOptions(el.timelineType, snapshot.eventTypes || [], state.timelineType);
}

function renderTimelineSummary(events) {
  const commands = events.filter((event) => event.eventType === 'shell_command').length;
  const patches = events.filter((event) => event.eventType === 'apply_patch').length;
  const waits = events.filter((event) => event.eventType === 'wait_agent').length;
  const problems = events.filter((event) => event.isProblem || problemStatuses.has(event.status)).length;
  const longest = events.reduce((winner, event) => (Number(event.durationMs || 0) > Number(winner?.durationMs || 0) ? event : winner), null);
  el.timelineSummary.innerHTML = `
    <span>${events.length} eventos</span>
    <span>${commands} comandos</span>
    <span>${patches} patches</span>
    <span>${waits} waits</span>
    <span>${problems} problemas</span>
    <span>maior ${escapeHtml(formatDuration(longest?.durationMs) || '--')}</span>`;
}

function detailsBlock(event) {
  const files = (event.files || []).map((file) => `<span class="chip">${escapeHtml(file)}</span>`).join('');
  const details = event.details ? `<pre>${escapeHtml(JSON.stringify(event.details, null, 2))}</pre>` : '';
  const command = event.command ? `<div class="detail-row"><strong>command</strong><code>${escapeHtml(event.command)}</code></div>` : '';
  const output = event.output ? `<div class="detail-row"><strong>output</strong><pre>${escapeHtml(event.output)}</pre></div>` : '';
  return `
    <div class="event-details">
      <div class="detail-grid">
        <div><strong>session</strong><span>${escapeHtml(event.sessionId?.slice(0, 8) || '')}</span></div>
        <div><strong>source</strong><span>${escapeHtml(event.sourcePath || '')}</span></div>
        <div><strong>duration</strong><span>${escapeHtml(formatDuration(event.durationMs) || '--')}</span></div>
        <div><strong>exit</strong><span>${escapeHtml(event.exitCode ?? '--')}</span></div>
      </div>
      ${command}
      ${files ? `<div class="chips">${files}</div>` : ''}
      ${details}
      ${output}
    </div>`;
}

function renderTimelineEvent(event) {
  const type = eventLabel[event.eventType] || event.eventType;
  const status = statusLabel[event.status] || event.status;
  const duration = formatDuration(event.durationMs);
  return `
    <details class="event timeline-event" data-status="${escapeHtml(event.status)}" data-type="${escapeHtml(event.eventType)}" style="--accent:${escapeHtml(event.color || '#b8f35d')}">
      <summary>
        <span class="event-type">${escapeHtml(type)}</span>
        <span class="event-main">
          <strong>${escapeHtml(event.title || event.eventType)}</strong>
          <small>${escapeHtml(event.agentName || 'main')} · ${escapeHtml(status)} · ${timeAgo(event.timestamp)}${duration ? ` · ${escapeHtml(duration)}` : ''}</small>
        </span>
      </summary>
      <p>${escapeHtml(event.summary || event.command || '')}</p>
      ${detailsBlock(event)}
    </details>`;
}

function renderEvents() {
  const groups = filteredTimelineGroups();
  const visibleEvents = groups.flatMap((group) => group.events);
  el.eventCount.textContent = visibleEvents.length;
  renderTimelineSummary(visibleEvents);

  if (visibleEvents.length === 0) {
    el.events.innerHTML = '<div class="empty">sem eventos para estes filtros</div>';
    return;
  }

  el.events.innerHTML = groups
    .map((group) => {
      const events = [...group.events].sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));
      return `
        <section class="timeline-group">
          <header>
            <div>
              <strong>${escapeHtml(group.title)}</strong>
              <span>${escapeHtml(group.cwd || group.prompt || 'sessão')}</span>
            </div>
            <div class="group-meta">
              <span>${events.length} eventos</span>
              <span>${group.problemCount} problemas</span>
              <span>${timeAgo(group.lastEventAt)}</span>
            </div>
          </header>
          <div class="timeline-thread">${events.map(renderTimelineEvent).join('')}</div>
        </section>`;
    })
    .join('');
}

function render() {
  const snapshot = state.snapshot;
  if (!snapshot) return;
  renderMetrics(snapshot);
  renderAIPanel();
  renderLanes();
  renderAgentCards(filteredAgents());
  renderRootSessions(snapshot);
  renderTimelineControls(snapshot);
  renderEvents();
}

async function refreshAIStatus() {
  try {
    const response = await fetch('/api/ai/status', { cache: 'no-store' });
    state.aiStatus = await response.json();
  } catch (error) {
    state.aiStatus = { enabled: false, error: error.message };
  }
}

async function refreshStoryQuestions() {
  try {
    const response = await fetch('/api/ai/story-questions?limit=8', { cache: 'no-store' });
    const json = await response.json();
    state.storyQuestions = json.questions || [];
  } catch {
    state.storyQuestions = [];
  }
}

async function runAISearch(question) {
  const query = String(question || el.aiQuestion.value || '').trim();
  if (!query) return;
  state.aiLoading = true;
  state.aiAnswer = null;
  state.aiResults = null;
  renderAIPanel();
  try {
    const response = await fetch(`/api/ai/search?q=${encodeURIComponent(query)}&limit=10&rerank=1`, { cache: 'no-store' });
    state.aiResults = await response.json();
  } catch (error) {
    state.aiAnswer = { answer: `Falha ao buscar: ${error.message}` };
  } finally {
    state.aiLoading = false;
    render();
  }
}

async function runAIExplain({ id = '', kind = 'session_story', question = '' } = {}) {
  const prompt = String(question || el.aiQuestion.value || 'Conta essa sessão como uma história curta.').trim();
  el.aiQuestion.value = prompt;
  state.aiLoading = true;
  state.aiAnswer = null;
  state.aiResults = null;
  renderAIPanel();
  try {
    const response = await fetch('/api/ai/explain', {
      body: JSON.stringify({ id, kind, question: prompt }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    state.aiAnswer = await response.json();
  } catch (error) {
    state.aiAnswer = { answer: `Falha ao explicar: ${error.message}` };
  } finally {
    state.aiLoading = false;
    render();
  }
}

async function runSimilarEvents() {
  const event = (state.snapshot?.events || []).find((item) => item.isProblem) || state.snapshot?.events?.[0];
  if (!event) return;
  state.aiLoading = true;
  state.aiAnswer = null;
  state.aiResults = null;
  renderAIPanel();
  try {
    const response = await fetch(`/api/ai/similar-event?id=${encodeURIComponent(event.id)}&limit=8`, { cache: 'no-store' });
    state.aiResults = await response.json();
  } catch (error) {
    state.aiAnswer = { answer: `Falha ao buscar parecidos: ${error.message}` };
  } finally {
    state.aiLoading = false;
    render();
  }
}

async function fetchInitial() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) return;
  state.snapshot = await response.json();
  await Promise.all([refreshAIStatus(), refreshStoryQuestions()]);
  render();
}

function connectStream() {
  const source = new EventSource('/events');
  source.addEventListener('open', () => setConnection(true));
  source.addEventListener('snapshot', (event) => {
    state.snapshot = JSON.parse(event.data);
    setConnection(true);
    render();
  });
  source.addEventListener('error', () => setConnection(false));
}

function stopReplayTimer() {
  if (replayTimer) clearInterval(replayTimer);
  replayTimer = null;
}

function startReplayTimer() {
  stopReplayTimer();
  replayTimer = setInterval(() => {
    const { end, start } = timelineRange();
    const duration = Math.max(1, end - start);
    const step = (state.replaySpeed * 500 * 1000) / duration;
    const next = Math.min(1000, Number(el.replayScrubber.value) + step);
    el.replayScrubber.value = String(next);
    if (next >= 1000) {
      state.replayEnabled = false;
      stopReplayTimer();
    }
    render();
  }, 500);
}

el.filterInput.addEventListener('input', (event) => {
  state.filter = event.target.value;
  render();
});

el.liveOnly.addEventListener('change', (event) => {
  state.liveOnly = event.target.checked;
  render();
});

el.laneSort.addEventListener('change', (event) => {
  state.laneSort = event.target.value;
  render();
});

el.showCompletedLanes.addEventListener('change', (event) => {
  state.showCompletedLanes = event.target.checked;
  render();
});

el.clearLaneFocus.addEventListener('click', () => {
  state.laneFocusedAgent = '';
  render();
});

el.replayToggle.addEventListener('click', () => {
  state.replayEnabled = !state.replayEnabled;
  if (state.replayEnabled && Number(el.replayScrubber.value) >= 1000) el.replayScrubber.value = '0';
  if (state.replayEnabled) startReplayTimer();
  else stopReplayTimer();
  render();
});

el.replayScrubber.addEventListener('input', () => {
  state.replayEnabled = true;
  stopReplayTimer();
  render();
});

el.replaySpeed.addEventListener('change', (event) => {
  state.replaySpeed = Number(event.target.value || 1);
  if (state.replayEnabled) startReplayTimer();
});

el.lanes.addEventListener('click', (event) => {
  const button = event.target.closest('.lane-focus-button');
  if (!button) return;
  event.preventDefault();
  const agentId = button.dataset.agentId || '';
  state.laneFocusedAgent = state.laneFocusedAgent === agentId ? '' : agentId;
  state.timelineAgent = state.laneFocusedAgent;
  if (el.timelineAgent) el.timelineAgent.value = state.timelineAgent;
  render();
});

el.timelineAgent.addEventListener('change', (event) => {
  state.timelineAgent = event.target.value;
  state.laneFocusedAgent = event.target.value;
  render();
});

el.timelineType.addEventListener('change', (event) => {
  state.timelineType = event.target.value;
  render();
});

el.timelineWindow.addEventListener('change', (event) => {
  state.timelineWindow = event.target.value;
  render();
});

el.problemsOnly.addEventListener('change', (event) => {
  state.problemsOnly = event.target.checked;
  render();
});

el.openState.addEventListener('click', () => {
  window.open('/api/state', '_blank', 'noopener,noreferrer');
});

el.aiSearch.addEventListener('click', () => runAISearch());

el.aiNarrate.addEventListener('click', () => runAIExplain({ kind: 'session_story', question: 'Conta essa sessão como uma história curta.' }));

el.aiExplainFailure.addEventListener('click', () => runAIExplain({ kind: 'blocker_analysis', question: 'Qual foi o primeiro sinal de problema?' }));

el.aiSimilar.addEventListener('click', () => runSimilarEvents());

el.aiQuestion.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') runAISearch();
});

el.storyChips.addEventListener('click', (event) => {
  const button = event.target.closest('[data-question-id]');
  if (!button) return;
  const question = state.storyQuestions.find((item) => item.id === button.dataset.questionId);
  if (!question) return;
  el.aiQuestion.value = question.label;
  if (question.preferredStatuses?.length) state.problemsOnly = true;
  if (question.preferredEventTypes?.[0]) state.timelineType = question.preferredEventTypes[0];
  if (el.problemsOnly) el.problemsOnly.checked = state.problemsOnly;
  if (el.timelineType) el.timelineType.value = state.timelineType;
  runAIExplain({ kind: question.explanationMode, question: question.label });
});

el.aiResults.addEventListener('click', (event) => {
  const item = event.target.closest('.ai-doc');
  if (!item) return;
  const agentId = item.dataset.agentId || '';
  if (agentId) {
    state.laneFocusedAgent = agentId;
    state.timelineAgent = agentId;
    if (el.timelineAgent) el.timelineAgent.value = agentId;
  }
  document.querySelector('.event-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  render();
});

function openGuide(tab = 'start') {
  state.guideTab = tab;
  state.guideOpen = true;
  renderGuide();
}

function closeGuide() {
  state.guideOpen = false;
  if (el.guideDontShow?.checked) localStorage.setItem('otelGuideSeen', 'true');
  renderGuide();
  el.helpButton?.focus();
}

el.helpButton.addEventListener('click', () => openGuide('start'));
el.guideClose.addEventListener('click', closeGuide);
el.guideBackdrop.addEventListener('click', (event) => {
  if (event.target === el.guideBackdrop) closeGuide();
});
el.guideBackdrop.querySelectorAll('[data-guide-tab]').forEach((button) => {
  button.addEventListener('click', () => {
    state.guideTab = button.dataset.guideTab || 'start';
    renderGuide();
  });
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && state.guideOpen) closeGuide();
});

setConnection(false);
await fetchInitial();
if (!localStorage.getItem('otelGuideSeen')) openGuide('start');
connectStream();
setInterval(render, 1000);
