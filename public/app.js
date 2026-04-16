const state = {
  filter: '',
  laneFocusedAgent: '',
  laneSort: 'recent',
  liveOnly: false,
  problemsOnly: false,
  replayEnabled: false,
  replaySpeed: 1,
  showCompletedLanes: true,
  snapshot: null,
  timelineAgent: '',
  timelineType: '',
  timelineWindow: 'all',
};

let replayTimer = null;

const el = {
  agentCards: document.querySelector('#agentCards'),
  agentCount: document.querySelector('#agentCount'),
  clearLaneFocus: document.querySelector('#clearLaneFocus'),
  connectionDot: document.querySelector('#connectionDot'),
  connectionText: document.querySelector('#connectionText'),
  eventCount: document.querySelector('#eventCount'),
  events: document.querySelector('#events'),
  filterInput: document.querySelector('#filterInput'),
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
  renderLanes();
  renderAgentCards(filteredAgents());
  renderRootSessions(snapshot);
  renderTimelineControls(snapshot);
  renderEvents();
}

async function fetchInitial() {
  const response = await fetch('/api/state', { cache: 'no-store' });
  if (!response.ok) return;
  state.snapshot = await response.json();
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

setConnection(false);
await fetchInitial();
connectStream();
setInterval(render, 1000);
