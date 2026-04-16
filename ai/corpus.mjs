const MAX_TEXT = 1800;

function compact(value, max = MAX_TEXT) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function joinParts(parts) {
  return parts.filter(Boolean).map((part) => String(part).trim()).filter(Boolean).join('\n');
}

function eventDocument(event) {
  const text = joinParts([
    `Tipo: ${event.eventType}`,
    `Status: ${event.status}`,
    `Agente: ${event.agentName || 'main'}`,
    `Titulo: ${event.title}`,
    `Resumo: ${event.summary}`,
    event.command ? `Comando: ${event.command}` : '',
    event.output ? `Saida: ${compact(event.output, 900)}` : '',
    event.files?.length ? `Arquivos: ${event.files.join(', ')}` : '',
    event.durationMs ? `DuracaoMs: ${event.durationMs}` : '',
  ]);

  return {
    id: `event:${event.id}`,
    kind: 'event',
    metadata: {
      agentId: event.agentId || '',
      agentName: event.agentName || 'main',
      eventId: event.id,
      eventType: event.eventType,
      files: event.files || [],
      rootSessionId: event.rootSessionId,
      sessionId: event.sessionId,
      status: event.status,
      timestamp: event.timestamp,
    },
    text: compact(text),
    title: event.title || event.eventType,
  };
}

function agentDocument(agent) {
  const text = joinParts([
    `Agente: ${agent.nickname}`,
    `Papel: ${agent.role}`,
    `Status: ${agent.status}`,
    `Designacao: ${agent.designation}`,
    `Relatorio: ${agent.report}`,
    agent.changedFiles?.length ? `Arquivos: ${agent.changedFiles.join(', ')}` : '',
  ]);

  return {
    id: `agent:${agent.id}`,
    kind: 'agent',
    metadata: {
      agentId: agent.id,
      agentName: agent.nickname,
      parentId: agent.parentId,
      role: agent.role,
      status: agent.status,
      timestamp: agent.updatedAt,
    },
    text: compact(text),
    title: agent.nickname || agent.id,
  };
}

function laneDocument(lane, group) {
  const text = joinParts([
    `Sessao: ${group.title}`,
    `Lane: ${lane.agentName}`,
    `Papel: ${lane.role}`,
    `Status: ${lane.status}`,
    `Ultimo evento: ${lane.lastEvent?.title || ''} ${lane.lastEvent?.summary || ''}`,
    `Stats: cmd ${lane.toolStats?.cmd || 0}, patch ${lane.toolStats?.patch || 0}, wait ${lane.toolStats?.wait || 0}, err ${lane.toolStats?.err || 0}`,
    lane.problemEvents?.length ? `Problemas: ${lane.problemEvents.map((event) => event.summary).join(' | ')}` : '',
  ]);

  return {
    id: `lane:${group.rootSessionId}:${lane.agentId}`,
    kind: 'lane',
    metadata: {
      agentId: lane.agentId === 'main' ? '' : lane.agentId,
      agentName: lane.agentName,
      rootSessionId: group.rootSessionId,
      role: lane.role,
      status: lane.status,
      timestamp: lane.lastEventAt,
    },
    text: compact(text),
    title: `${group.title} / ${lane.agentName}`,
  };
}

function sessionDocument(group) {
  const text = joinParts([
    `Sessao: ${group.title}`,
    `Status: ${group.status}`,
    `Prompt: ${group.prompt}`,
    `Agentes: ${group.agents?.join(', ') || ''}`,
    `Eventos: ${group.eventCount}`,
    `Problemas: ${group.problemCount}`,
  ]);

  return {
    id: `session:${group.id}`,
    kind: 'session',
    metadata: {
      rootSessionId: group.id,
      status: group.status,
      timestamp: group.lastEventAt,
    },
    text: compact(text),
    title: group.title,
  };
}

export function buildCorpus(snapshot) {
  const docs = [];
  for (const event of snapshot.events || []) docs.push(eventDocument(event));
  for (const agent of snapshot.agents || []) docs.push(agentDocument(agent));
  for (const group of snapshot.timelineGroups || []) docs.push(sessionDocument(group));
  for (const group of snapshot.laneGroups || []) {
    for (const lane of group.lanes || []) docs.push(laneDocument(lane, group));
  }

  const seen = new Set();
  return docs.filter((doc) => {
    if (seen.has(doc.id) || !doc.text) return false;
    seen.add(doc.id);
    return true;
  });
}
