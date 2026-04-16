import { createServer } from 'node:http';
import { createReadStream, existsSync } from 'node:fs';
import { readFile, readdir, stat } from 'node:fs/promises';
import { extname, join, normalize, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = resolve(fileURLToPath(new URL('.', import.meta.url)));
const publicDir = join(__dirname, 'public');
const codexDir = process.env.CODEX_HOME || join(process.env.USERPROFILE || process.env.HOME || '.', '.codex');
const sessionsDir = join(codexDir, 'sessions');
const port = Number(process.env.PORT || 8787);
const clients = new Set();

let latestSnapshot = {};
let latestText = '{}';

const mime = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const agentColors = ['#b8f35d', '#76d9ff', '#ffcc66', '#ff8a7a', '#9bb7ff', '#7ff0c6', '#f3a3ff', '#f5df79'];
const problemStatuses = new Set(['failed', 'aborted', 'timeout']);

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function parseJson(value) {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function compact(value, max = 420) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function textFromContent(content) {
  if (!Array.isArray(content)) return typeof content === 'string' ? content : '';
  return content.map((part) => part?.text || part?.input_text || part?.output_text || '').filter(Boolean).join('\n');
}

function stableHash(value) {
  let hash = 0;
  for (const char of String(value || 'main')) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash;
}

function colorForKey(value) {
  return agentColors[stableHash(value) % agentColors.length];
}

function normalizeStatus(value) {
  const status = String(value || 'unknown').toLowerCase();
  if (status.includes('timeout') || status.includes('timed_out')) return 'timeout';
  if (status.includes('fail') || status.includes('error')) return 'failed';
  if (status.includes('abort') || status.includes('interrupt')) return 'aborted';
  if (status.includes('complete') || status.includes('success')) return 'completed';
  if (status.includes('close')) return 'closed';
  if (status.includes('wait')) return 'waiting';
  if (status.includes('run') || status.includes('active')) return 'running';
  return status;
}

function timestampMs(timestamp) {
  const value = Date.parse(timestamp || '');
  return Number.isFinite(value) ? value : 0;
}

function durationMsFromPayload(duration) {
  if (!duration || typeof duration !== 'object') return null;
  const seconds = Number(duration.secs || 0);
  const nanos = Number(duration.nanos || 0);
  return Math.round(seconds * 1000 + nanos / 1_000_000);
}

function durationBetween(start, end) {
  const startMs = timestampMs(start);
  const endMs = timestampMs(end);
  return startMs && endMs && endMs >= startMs ? endMs - startMs : null;
}

function filesFromText(text) {
  const files = new Set();
  const pathPattern = /(?:[A-Z]:[\\/][^\s)]+|(?:packages|src|docker-compose|\.env)[^\s):,]+(?:\.[a-zA-Z0-9]+)?)/g;
  for (const match of String(text || '').matchAll(pathPattern)) files.add(match[0].replace(/[.>,;]+$/g, ''));
  return [...files].slice(0, 12);
}

function filesFromPatchInput(input) {
  const files = new Set();
  for (const line of String(input || '').split(/\r?\n/)) {
    const match = line.match(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/);
    if (match?.[1]) files.add(match[1].trim());
  }
  return [...files].slice(0, 16);
}

function titleForCall(name) {
  return {
    apply_patch: 'Patch',
    close_agent: 'Close agent',
    shell_command: 'Command',
    spawn_agent: 'Spawn agent',
    update_plan: 'Update checklist',
    wait_agent: 'Wait for agents',
  }[name] || name || 'Tool call';
}

function summaryForCall(name, args = {}) {
  if (name === 'spawn_agent') return compact(args.message, 520);
  if (name === 'shell_command') return compact(args.command, 520);
  if (name === 'wait_agent') return compact((args.targets || []).join(', '), 520);
  if (name === 'close_agent') return compact(args.target || args.id, 520);
  if (name === 'update_plan') return compact((args.plan || []).map((item) => `${item.status}:${item.step}`).join(' | '), 520);
  return compact(JSON.stringify(args), 520);
}

function statusFromToolOutput(raw, parsed) {
  if (parsed?.timed_out) return 'timeout';
  const exitCode = raw.match(/Exit code:\s*(-?\d+)/)?.[1];
  if (exitCode !== undefined) return Number(exitCode) === 0 ? 'completed' : 'failed';
  if (parsed?.error) return 'failed';
  return 'completed';
}

function makeEvent(session, event) {
  const id = event.id || `${session.id}:${session.events.length}:${event.callId || event.eventType || 'event'}`;
  return {
    id,
    timestamp: event.timestamp || '',
    completedAt: event.completedAt || null,
    rootSessionId: session.isSubagent ? session.parentId || session.id : session.id,
    sessionId: session.id,
    parentId: session.parentId || '',
    agentId: session.isSubagent ? session.id : '',
    agentName: session.nickname || (session.isSubagent ? session.id.slice(0, 8) : 'main'),
    role: session.role || 'main',
    eventType: event.eventType || 'event',
    status: event.status || 'completed',
    title: event.title || 'Event',
    summary: compact(event.summary, 900),
    details: event.details || null,
    command: event.command || null,
    output: event.output ? compact(event.output, 2400) : null,
    exitCode: event.exitCode ?? null,
    durationMs: event.durationMs ?? null,
    files: event.files || [],
    callId: event.callId || null,
    targetAgentId: event.targetAgentId || null,
    targetAgentName: event.targetAgentName || null,
    sourcePath: session.relativePath,
  };
}

function finishCallEvent(call, timestamp, raw, parsed) {
  if (!call?.event) return;
  const event = call.event;
  event.completedAt = timestamp;
  event.durationMs = durationBetween(event.timestamp, timestamp);
  event.status = statusFromToolOutput(raw, parsed);
  event.output = compact(raw, 2400);
  event.details = { ...(event.details || {}), output: parsed || compact(raw, 1200) };

  if (call.name === 'spawn_agent' && parsed?.agent_id) {
    event.status = 'completed';
    event.targetAgentId = parsed.agent_id;
    event.targetAgentName = parsed.nickname || parsed.agent_id.slice(0, 8);
    event.title = `Spawn ${event.targetAgentName}`;
    event.summary = compact(`${call.args.agent_type || 'agent'} · ${call.args.message || ''}`, 900);
  }

  if (call.name === 'wait_agent' && parsed?.status) {
    const completed = Object.entries(parsed.status)
      .filter(([, value]) => value?.completed)
      .map(([id]) => id.slice(0, 8));
    event.status = parsed.timed_out ? 'timeout' : 'completed';
    event.summary = completed.length > 0 ? `Completed: ${completed.join(', ')}` : event.summary;
  }
}

async function findJsonlFiles(root) {
  if (!existsSync(root)) return [];
  const files = [];
  const stack = [root];

  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) stack.push(full);
      if (entry.isFile() && entry.name.endsWith('.jsonl')) {
        try {
          const info = await stat(full);
          files.push({ full, mtimeMs: info.mtimeMs, size: info.size });
        } catch {
          // File can disappear while Codex writes/rotates sessions.
        }
      }
    }
  }

  return files.sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 140);
}

function parseSession(file, raw) {
  const idFromName = file.full.match(/rollout-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-(.+)\.jsonl$/)?.[1] || '';
  const session = {
    id: idFromName,
    path: file.full,
    relativePath: relative(codexDir, file.full),
    mtimeMs: file.mtimeMs,
    size: file.size,
    cwd: '',
    nickname: '',
    role: '',
    parentId: '',
    isSubagent: false,
    startedAt: new Date(file.mtimeMs).toISOString(),
    updatedAt: new Date(file.mtimeMs).toISOString(),
    prompt: '',
    lastAssistant: '',
    finalMessage: '',
    status: 'unknown',
    toolCalls: [],
    events: [],
    spawns: [],
    waits: 0,
    closes: 0,
    outputs: new Map(),
    calls: new Map(),
  };

  let hasSessionStart = false;

  for (const line of raw.split(/\r?\n/)) {
    if (!line) continue;
    const item = parseJson(line);
    if (!item) continue;
    const ts = item.timestamp || '';
    if (ts) session.updatedAt = ts;

    if (item.type === 'session_meta') {
      const p = item.payload || {};
      const spawned = p.source?.subagent?.thread_spawn;
      session.id = p.id || session.id;
      session.parentId = p.forked_from_id || spawned?.parent_thread_id || session.parentId;
      session.nickname = p.agent_nickname || spawned?.agent_nickname || session.nickname;
      session.role = p.agent_role || spawned?.agent_role || session.role;
      session.cwd = p.cwd || session.cwd;
      session.startedAt = p.timestamp || ts || session.startedAt;
      session.isSubagent = Boolean(spawned || p.agent_role);
      session.status = session.isSubagent ? 'running' : 'active';

      if (!hasSessionStart) {
        hasSessionStart = true;
        session.events.push(
          makeEvent(session, {
            eventType: 'session_started',
            status: 'completed',
            timestamp: session.startedAt,
            title: session.isSubagent ? `Agent ${session.nickname || session.id.slice(0, 8)} started` : 'Session started',
            summary: session.cwd,
          }),
        );
      }
    }

    if (item.type === 'response_item') {
      const p = item.payload || {};

      if (p.type === 'message') {
        const text = textFromContent(p.content);
        if (p.role === 'user' && !session.prompt) session.prompt = compact(text, 900);
        if (p.role === 'assistant') session.lastAssistant = compact(text, 900);

        if (p.role === 'user' && text.includes('<subagent_notification>')) {
          session.events.push(
            makeEvent(session, {
              eventType: 'subagent_notification',
              status: 'completed',
              timestamp: ts,
              title: 'Subagent notification',
              summary: compact(text.replace(/<\/?subagent_notification>/g, ''), 900),
            }),
          );
        }
      }

      if (p.type === 'function_call') {
        const args = parseJson(p.arguments || '{}') || {};
        const call = { args, callId: p.call_id, name: p.name, timestamp: ts };
        const event = makeEvent(session, {
          callId: p.call_id,
          command: p.name === 'shell_command' ? args.command : null,
          details: args,
          eventType: p.name || 'function_call',
          files: filesFromText(args.command || args.message || ''),
          status: 'running',
          summary: summaryForCall(p.name, args),
          timestamp: ts,
          title: titleForCall(p.name),
        });

        call.event = event;
        session.calls.set(p.call_id, call);
        session.toolCalls.push(call);
        session.events.push(event);
        if (p.name === 'spawn_agent') session.spawns.push(call);
        if (p.name === 'wait_agent') session.waits += 1;
        if (p.name === 'close_agent') session.closes += 1;
      }

      if (p.type === 'custom_tool_call') {
        const name = p.name || 'custom_tool';
        const call = { args: { input: p.input }, callId: p.call_id, name, timestamp: ts };
        const files = name === 'apply_patch' ? filesFromPatchInput(p.input) : filesFromText(p.input);
        const event = makeEvent(session, {
          callId: p.call_id,
          details: { input: compact(p.input, 1200) },
          eventType: name,
          files,
          status: 'running',
          summary: files.length > 0 ? files.join(', ') : compact(p.input, 520),
          timestamp: ts,
          title: titleForCall(name),
        });

        call.event = event;
        session.calls.set(p.call_id, call);
        session.toolCalls.push(call);
        session.events.push(event);
      }

      if (p.type === 'function_call_output' || p.type === 'custom_tool_call_output') {
        const parsed = parseJson(p.output || '');
        const call = session.calls.get(p.call_id);
        session.outputs.set(p.call_id, { parsed, raw: p.output || '', sourceCall: call, timestamp: ts });
        finishCallEvent(call, ts, p.output || '', parsed);
      }
    }

    if (item.type === 'event_msg') {
      const p = item.payload || {};

      if (p.type === 'user_message') {
        session.events.push(
          makeEvent(session, {
            eventType: 'user_message',
            status: 'completed',
            timestamp: ts,
            title: 'User message',
            summary: compact(p.message, 900),
          }),
        );
      }

      if (p.type === 'agent_message') {
        session.lastAssistant = compact(p.message, 900);
        session.events.push(
          makeEvent(session, {
            eventType: 'agent_message',
            status: 'completed',
            timestamp: ts,
            title: 'Agent message',
            summary: compact(p.message, 900),
          }),
        );
      }

      if (p.type === 'task_started') {
        session.status = 'running';
        session.events.push(makeEvent(session, { eventType: 'task_started', status: 'running', timestamp: ts, title: 'Task started', summary: p.turn_id }));
      }

      if (p.type === 'task_complete') {
        session.status = 'completed';
        session.finalMessage = compact(p.last_agent_message || session.lastAssistant, 1600);
        session.events.push(
          makeEvent(session, {
            eventType: 'task_complete',
            files: filesFromText(session.finalMessage),
            status: 'completed',
            summary: session.finalMessage,
            timestamp: ts,
            title: 'Task complete',
          }),
        );
      }

      if (p.type === 'turn_aborted') {
        session.status = 'aborted';
        session.events.push(makeEvent(session, { eventType: 'turn_aborted', status: 'aborted', timestamp: ts, title: 'Turn aborted', summary: p.reason || 'aborted' }));
      }

      if (p.type === 'exec_command_end') {
        const call = session.calls.get(p.call_id);
        const command = Array.isArray(p.command) ? p.command.join(' ') : p.command || '';
        const failed = p.status === 'failed' || Number(p.exit_code || 0) !== 0;
        const durationMs = durationMsFromPayload(p.duration) ?? durationBetween(call?.timestamp, ts);
        const output = p.aggregated_output || p.stdout || p.stderr || '';

        if (call?.event) {
          call.event.completedAt = ts;
          call.event.command = command;
          call.event.durationMs = durationMs;
          call.event.exitCode = Number(p.exit_code || 0);
          call.event.files = [...new Set([...(call.event.files || []), ...filesFromText(command), ...filesFromText(output)])].slice(0, 16);
          call.event.output = compact(output, 2400);
          call.event.status = failed ? 'failed' : 'completed';
          call.event.summary = compact(command, 900);
          call.event.title = failed ? 'Command failed' : 'Command done';
        } else {
          session.events.push(
            makeEvent(session, {
              command,
              durationMs,
              eventType: 'shell_command',
              exitCode: Number(p.exit_code || 0),
              files: filesFromText(command + output),
              output,
              status: failed ? 'failed' : 'completed',
              summary: command,
              timestamp: ts,
              title: failed ? 'Command failed' : 'Command done',
            }),
          );
        }

        if (failed) session.status = 'failed';
      }

      if (p.type === 'patch_apply_end') {
        const call = session.calls.get(p.call_id);
        const files = Object.keys(p.changes || {});
        if (call?.event) {
          call.event.completedAt = ts;
          call.event.durationMs = durationBetween(call.timestamp, ts);
          call.event.files = files;
          call.event.output = compact(p.stdout || p.stderr || '', 2400);
          call.event.status = p.success ? 'completed' : 'failed';
          call.event.summary = files.join(', ');
          call.event.title = p.success ? 'Patch applied' : 'Patch failed';
        } else {
          session.events.push(makeEvent(session, { eventType: 'apply_patch', files, status: p.success ? 'completed' : 'failed', summary: files.join(', '), timestamp: ts, title: 'Patch applied' }));
        }
      }

      if (p.type === 'collab_close_end') {
        session.events.push(
          makeEvent(session, {
            eventType: 'close_agent',
            status: 'completed',
            summary: compact(p.status?.completed || 'closed', 900),
            targetAgentId: p.receiver_thread_id,
            targetAgentName: p.receiver_agent_nickname || p.receiver_thread_id?.slice(0, 8),
            timestamp: ts,
            title: `Closed ${p.receiver_agent_nickname || 'agent'}`,
          }),
        );
      }
    }
  }

  if (session.status === 'running' && Date.now() - file.mtimeMs > 5 * 60 * 1000) {
    session.status = session.finalMessage ? 'completed' : 'idle';
  }

  for (const event of session.events) {
    if (event.status === 'running' && Date.now() - timestampMs(event.timestamp) > 5 * 60 * 1000) event.status = 'unknown';
  }

  return session;
}

function collectAssignments(sessions) {
  const assignments = new Map();

  for (const session of sessions) {
    for (const spawn of session.spawns) {
      const output = session.outputs.get(spawn.callId)?.parsed;
      if (!output?.agent_id) continue;
      assignments.set(output.agent_id, {
        agentId: output.agent_id,
        assignedAt: spawn.timestamp,
        designation: spawn.args.message || '',
        forkContext: Boolean(spawn.args.fork_context),
        nickname: output.nickname || '',
        parentId: session.id,
        reasoning: spawn.args.reasoning_effort || '',
        role: spawn.args.agent_type || 'default',
      });
    }

    for (const output of session.outputs.values()) {
      if (!output.parsed?.status || typeof output.parsed.status !== 'object') continue;
      for (const [agentId, value] of Object.entries(output.parsed.status)) {
        const assignment = assignments.get(agentId) || { agentId, parentId: session.id };
        if (value?.completed) {
          assignment.reportedStatus = 'completed';
          assignment.report = value.completed;
        }
        assignments.set(agentId, assignment);
      }
    }
  }

  return assignments;
}

function enrichEvent(event, agentsById) {
  const agent = event.agentId ? agentsById.get(event.agentId) : null;
  const targetAgent = event.targetAgentId ? agentsById.get(event.targetAgentId) : null;
  const key = event.agentId || event.targetAgentId || event.sessionId || event.rootSessionId || 'main';
  return {
    ...event,
    agentName: agent?.nickname || event.agentName,
    color: agent?.color || targetAgent?.color || colorForKey(key),
    files: [...new Set(event.files || [])].slice(0, 16),
    isProblem: problemStatuses.has(event.status) || event.eventType.includes('failed'),
    targetAgentName: targetAgent?.nickname || event.targetAgentName,
  };
}

function buildTimelineGroups(events, rootSessions) {
  const roots = new Map(rootSessions.map((root) => [root.id, root]));
  const groups = new Map();

  for (const event of events) {
    const rootId = event.rootSessionId || event.sessionId;
    if (!groups.has(rootId)) {
      const root = roots.get(rootId);
      groups.set(rootId, {
        id: rootId,
        cwd: root?.cwd || '',
        events: [],
        prompt: root?.prompt || '',
        status: root?.status || 'unknown',
        title: rootId ? rootId.slice(0, 8) : 'session',
        updatedAt: root?.updatedAt || event.timestamp,
      });
    }
    groups.get(rootId).events.push(event);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      agents: [...new Set(group.events.map((event) => event.agentName).filter(Boolean))],
      eventCount: group.events.length,
      events: group.events.sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp)),
      lastEventAt: group.events.reduce((latest, event) => (timestampMs(event.timestamp) > timestampMs(latest) ? event.timestamp : latest), group.updatedAt),
      problemCount: group.events.filter((event) => event.isProblem).length,
    }))
    .sort((a, b) => timestampMs(b.lastEventAt) - timestampMs(a.lastEventAt));
}

function phaseForEvent(event) {
  if (event.isProblem || problemStatuses.has(event.status)) return 'failed';
  if (event.eventType === 'spawn_agent' || event.eventType === 'assigned') return 'assigned';
  if (event.eventType === 'apply_patch') return 'patching';
  if (event.eventType === 'wait_agent') return 'waiting';
  if (event.eventType === 'task_complete' || event.eventType === 'close_agent') return 'done';
  if (event.eventType === 'agent_message' || event.eventType === 'user_message' || event.eventType === 'subagent_notification') return 'reading';
  if (event.eventType === 'shell_command') {
    const text = `${event.command || ''} ${event.summary || ''}`.toLowerCase();
    return /test|check|build|lint|tsgo|tsc|eslint|vitest|docker compose .*config|cargo check/.test(text) ? 'verifying' : 'tooling';
  }
  if (String(event.eventType || '').startsWith('mcp__')) return 'tooling';
  return 'tooling';
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, value));
}

function segmentForEvent(event, groupStartMs, groupEndMs) {
  const total = Math.max(1, groupEndMs - groupStartMs);
  const start = timestampMs(event.timestamp) || groupStartMs;
  const rawEnd = timestampMs(event.completedAt) || (event.durationMs ? start + event.durationMs : start + 20_000);
  const end = Math.max(start + 1000, rawEnd);
  const left = clampPercent(((start - groupStartMs) / total) * 100);
  const right = clampPercent(((end - groupStartMs) / total) * 100);
  return {
    durationMs: Math.max(0, end - start),
    eventId: event.id,
    eventType: event.eventType,
    left,
    phase: phaseForEvent(event),
    status: event.status,
    title: event.title,
    width: Math.max(0.9, right - left),
  };
}

function buildPhaseSegments(events, groupStartMs, groupEndMs) {
  return events
    .filter((event) => timestampMs(event.timestamp))
    .sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp))
    .slice(-100)
    .map((event) => segmentForEvent(event, groupStartMs, groupEndMs));
}

function buildHeatBuckets(events, groupStartMs, groupEndMs) {
  const total = Math.max(60_000, groupEndMs - groupStartMs);
  const bucketCount = Math.min(80, Math.max(8, Math.ceil(total / 60_000)));
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    count: 0,
    index,
    intensity: 0,
    left: (index / bucketCount) * 100,
    problemCount: 0,
    width: 100 / bucketCount,
  }));

  for (const event of events) {
    const at = timestampMs(event.timestamp);
    if (!at) continue;
    const index = Math.max(0, Math.min(bucketCount - 1, Math.floor(((at - groupStartMs) / total) * bucketCount)));
    buckets[index].count += 1;
    if (event.isProblem || problemStatuses.has(event.status)) buckets[index].problemCount += 1;
  }

  const max = Math.max(1, ...buckets.map((bucket) => bucket.count));
  return buckets.map((bucket) => ({ ...bucket, intensity: bucket.count / max }));
}

function buildToolStats(events) {
  return {
    cmd: events.filter((event) => event.eventType === 'shell_command').length,
    err: events.filter((event) => event.isProblem || problemStatuses.has(event.status)).length,
    events: events.length,
    patch: events.filter((event) => event.eventType === 'apply_patch').length,
    wait: events.filter((event) => event.eventType === 'wait_agent').length,
  };
}

function deriveLaneStatus(events, fallbackStatus, nowMs) {
  const lastEvent = events.reduce((winner, event) => (timestampMs(event.timestamp) > timestampMs(winner?.timestamp) ? event : winner), null);
  const idleMs = lastEvent ? nowMs - timestampMs(lastEvent.timestamp) : Number.POSITIVE_INFINITY;
  const status = normalizeStatus(fallbackStatus || lastEvent?.status || 'unknown');
  if (lastEvent && problemStatuses.has(lastEvent.status)) return lastEvent.status;
  if (problemStatuses.has(status)) return status;
  if (['running', 'active', 'waiting', 'unknown'].includes(status) && idleMs > 5 * 60 * 1000) return 'stale';
  if (status === 'completed' && idleMs <= 5 * 60 * 1000) return 'recent';
  return status;
}

function buildDependencyEdges(events) {
  const edges = [];
  for (const event of events) {
    if (event.eventType === 'spawn_agent' && event.targetAgentId) {
      edges.push({ from: 'main', status: event.status, timestamp: event.timestamp, to: event.targetAgentId, type: 'spawn' });
    }
    if (event.eventType === 'close_agent' && event.targetAgentId) {
      edges.push({ from: 'main', status: event.status, timestamp: event.timestamp, to: event.targetAgentId, type: 'close' });
    }
    if (event.eventType === 'wait_agent' && Array.isArray(event.details?.targets)) {
      for (const target of event.details.targets) edges.push({ from: 'main', status: event.status, timestamp: event.timestamp, to: target, type: 'wait' });
    }
  }
  return edges.slice(-32);
}

function laneMiniLog(events) {
  return events
    .slice()
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp))
    .slice(0, 5)
    .map((event) => ({
      durationMs: event.durationMs || null,
      eventType: event.eventType,
      files: event.files || [],
      status: event.status,
      summary: compact(event.summary || event.command || '', 260),
      timestamp: event.timestamp,
      title: event.title,
    }));
}

function buildLaneGroups(timelineGroups, agents) {
  const nowMs = Date.now();
  const agentsByParent = new Map();
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  for (const agent of agents) {
    if (!agent.parentId) continue;
    if (!agentsByParent.has(agent.parentId)) agentsByParent.set(agent.parentId, []);
    agentsByParent.get(agent.parentId).push(agent);
  }

  return timelineGroups.map((group) => {
    const groupEvents = group.events || [];
    const groupAgents = [...(agentsByParent.get(group.id) || [])];
    const seenAgentIds = new Set(groupAgents.map((agent) => agent.id));

    for (const event of groupEvents) {
      const id = event.agentId || event.targetAgentId;
      if (id && !seenAgentIds.has(id)) {
        const knownAgent = agentsById.get(id);
        groupAgents.push(
          knownAgent || {
            color: colorForKey(id),
            id,
            nickname: event.agentName || event.targetAgentName || id.slice(0, 8),
            parentId: group.id,
            role: 'agent',
            status: 'unknown',
            updatedAt: event.timestamp,
          },
        );
        seenAgentIds.add(id);
      }
    }

    const timeValues = [
      ...groupEvents.flatMap((event) => [timestampMs(event.timestamp), timestampMs(event.completedAt)]),
      ...groupAgents.flatMap((agent) => [timestampMs(agent.assignedAt), timestampMs(agent.updatedAt), timestampMs(agent.lastEventAt)]),
    ].filter(Boolean);
    const groupStartMs = Math.min(...timeValues, nowMs);
    const groupEndMs = Math.max(...timeValues, group.status === 'running' ? nowMs : 0, groupStartMs + 60_000);

    const mainEvents = groupEvents.filter((event) => !event.agentId || event.sessionId === group.id);
    const mainStatus = deriveLaneStatus(mainEvents, group.status, nowMs);

    const lanes = [
      {
        agentId: 'main',
        agentName: 'main',
        color: colorForKey(group.id),
        durationMs: Math.max(0, groupEndMs - groupStartMs),
        endedAt: new Date(groupEndMs).toISOString(),
        heatBuckets: buildHeatBuckets(mainEvents, groupStartMs, groupEndMs),
        idleMs: nowMs - Math.max(...mainEvents.map((event) => timestampMs(event.timestamp)).filter(Boolean), groupStartMs),
        lastEvent: laneMiniLog(mainEvents)[0] || null,
        lastEventAt: mainEvents.reduce((latest, event) => (timestampMs(event.timestamp) > timestampMs(latest) ? event.timestamp : latest), group.lastEventAt),
        miniLog: laneMiniLog(mainEvents),
        phaseSegments: buildPhaseSegments(mainEvents, groupStartMs, groupEndMs),
        problemEvents: mainEvents.filter((event) => event.isProblem || problemStatuses.has(event.status)).slice(-8),
        role: 'main',
        sourcePath: mainEvents[0]?.sourcePath || '',
        startedAt: new Date(groupStartMs).toISOString(),
        status: mainStatus,
        toolStats: buildToolStats(mainEvents),
      },
    ];

    for (const agent of groupAgents.sort((a, b) => timestampMs(a.assignedAt || a.startedAt) - timestampMs(b.assignedAt || b.startedAt))) {
      const syntheticAssigned = agent.assignedAt
        ? [
            {
              agentId: agent.id,
              agentName: agent.nickname,
              color: agent.color,
              eventType: 'assigned',
              id: `${agent.id}:assigned`,
              isProblem: false,
              status: 'completed',
              summary: agent.designation || '',
              timestamp: agent.assignedAt,
              title: 'Assigned',
            },
          ]
        : [];
      const laneEvents = [
        ...syntheticAssigned,
        ...groupEvents.filter((event) => event.agentId === agent.id || event.targetAgentId === agent.id),
      ].sort((a, b) => timestampMs(a.timestamp) - timestampMs(b.timestamp));
      const laneStartMs = Math.min(...laneEvents.map((event) => timestampMs(event.timestamp)).filter(Boolean), timestampMs(agent.startedAt) || groupStartMs);
      const laneEndMs = Math.max(...laneEvents.flatMap((event) => [timestampMs(event.completedAt), timestampMs(event.timestamp)]).filter(Boolean), timestampMs(agent.updatedAt) || laneStartMs);
      const lastAt = Math.max(...laneEvents.map((event) => timestampMs(event.timestamp)).filter(Boolean), laneEndMs);

      lanes.push({
        agentId: agent.id,
        agentName: agent.nickname || agent.id.slice(0, 8),
        color: agent.color || colorForKey(agent.id),
        durationMs: Math.max(0, laneEndMs - laneStartMs),
        endedAt: laneEndMs ? new Date(laneEndMs).toISOString() : null,
        heatBuckets: buildHeatBuckets(laneEvents, groupStartMs, groupEndMs),
        idleMs: nowMs - lastAt,
        lastEvent: laneMiniLog(laneEvents)[0] || null,
        lastEventAt: lastAt ? new Date(lastAt).toISOString() : agent.updatedAt,
        miniLog: laneMiniLog(laneEvents),
        phaseSegments: buildPhaseSegments(laneEvents, groupStartMs, groupEndMs),
        problemEvents: laneEvents.filter((event) => event.isProblem || problemStatuses.has(event.status)).slice(-8),
        role: agent.role || 'agent',
        sourcePath: agent.relativePath || laneEvents[0]?.sourcePath || '',
        startedAt: laneStartMs ? new Date(laneStartMs).toISOString() : agent.startedAt,
        status: deriveLaneStatus(laneEvents, agent.status, nowMs),
        toolStats: buildToolStats(laneEvents),
      });
    }

    return {
      activeAgentCount: lanes.filter((lane) => ['active', 'running', 'waiting', 'recent'].includes(lane.status)).length,
      durationMs: Math.max(0, groupEndMs - groupStartMs),
      edges: buildDependencyEdges(groupEvents),
      endedAt: new Date(groupEndMs).toISOString(),
      laneCount: lanes.length,
      lanes,
      problemCount: lanes.reduce((count, lane) => count + lane.problemEvents.length, 0),
      rootSessionId: group.id,
      startedAt: new Date(groupStartMs).toISOString(),
      status: group.status,
      title: group.title,
      updatedAt: group.lastEventAt,
    };
  });
}

async function buildSnapshot() {
  const files = await findJsonlFiles(sessionsDir);
  const sessions = [];
  for (const file of files) {
    try {
      sessions.push(parseSession(file, await readFile(file.full, 'utf8')));
    } catch {
      // Mid-write JSONL files are picked up on the next scan.
    }
  }

  const assignments = collectAssignments(sessions);
  const byId = new Map(sessions.map((session) => [session.id, session]));
  const agents = [];

  for (const session of sessions) {
    if (!session.isSubagent && !assignments.has(session.id)) continue;
    const assignment = assignments.get(session.id) || {};
    const report = assignment.report || session.finalMessage || session.lastAssistant;
    const id = session.id;
    agents.push({
      id,
      assignedAt: assignment.assignedAt || session.startedAt,
      changedFiles: filesFromText(report),
      color: colorForKey(id),
      cwd: session.cwd,
      designation: compact(assignment.designation || session.prompt, 1200),
      eventCount: session.events.length,
      forkContext: assignment.forkContext,
      lastEventAt: session.updatedAt,
      nickname: session.nickname || assignment.nickname || id.slice(0, 8),
      parentId: session.parentId || assignment.parentId || '',
      reasoning: assignment.reasoning,
      relativePath: session.relativePath,
      report: compact(report, 1400),
      role: session.role || assignment.role || 'agent',
      startedAt: session.startedAt,
      status: normalizeStatus(assignment.reportedStatus || session.status),
      statusRank: problemStatuses.has(normalizeStatus(assignment.reportedStatus || session.status)) ? 100 : 0,
      toolCallCount: session.toolCalls.length,
      updatedAt: session.updatedAt,
    });
  }

  for (const [agentId, assignment] of assignments) {
    if (byId.has(agentId)) continue;
    agents.push({
      id: agentId,
      assignedAt: assignment.assignedAt,
      changedFiles: filesFromText(assignment.report),
      color: colorForKey(agentId),
      designation: compact(assignment.designation, 1200),
      eventCount: 0,
      forkContext: assignment.forkContext,
      lastEventAt: assignment.assignedAt,
      nickname: assignment.nickname || agentId.slice(0, 8),
      parentId: assignment.parentId || '',
      reasoning: assignment.reasoning,
      relativePath: '',
      report: compact(assignment.report, 1400),
      role: assignment.role || 'agent',
      startedAt: assignment.assignedAt,
      status: normalizeStatus(assignment.reportedStatus || 'waiting'),
      statusRank: 0,
      toolCallCount: 0,
      updatedAt: assignment.assignedAt,
    });
  }

  agents.sort((a, b) => timestampMs(b.updatedAt) - timestampMs(a.updatedAt));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  const rootSessions = sessions
    .filter((session) => !session.isSubagent)
    .sort((a, b) => b.mtimeMs - a.mtimeMs)
    .slice(0, 12)
    .map((session) => ({
      id: session.id,
      closes: session.closes,
      cwd: session.cwd,
      prompt: compact(session.prompt || session.lastAssistant, 540),
      relativePath: session.relativePath,
      spawns: session.spawns.length,
      startedAt: session.startedAt,
      status: normalizeStatus(session.status),
      updatedAt: session.updatedAt,
      waits: session.waits,
    }));

  const allEvents = sessions
    .flatMap((session) => session.events)
    .map((event) => enrichEvent(event, agentsById))
    .sort((a, b) => timestampMs(b.timestamp) - timestampMs(a.timestamp));

  const events = allEvents.slice(0, 320);
  const timelineGroups = buildTimelineGroups(events, rootSessions);
  const laneGroups = buildLaneGroups(timelineGroups, agents);
  const runningAgents = agents.filter((agent) => ['active', 'running', 'waiting'].includes(agent.status)).length;
  const eventTypes = [...new Set(events.map((event) => event.eventType))].sort();
  const longestEvent = events.reduce((winner, event) => (Number(event.durationMs || 0) > Number(winner?.durationMs || 0) ? event : winner), null);

  return {
    agents,
    codexDir,
    eventTypes,
    events,
    generatedAt: new Date().toISOString(),
    laneGroups,
    rootSessions,
    sessionsDir,
    stats: {
      agents: agents.length,
      commands: events.filter((event) => event.eventType === 'shell_command').length,
      longestEvent,
      patches: events.filter((event) => event.eventType === 'apply_patch').length,
      problems: events.filter((event) => event.isProblem).length,
      recentEvents: events.length,
      rootSessions: rootSessions.length,
      runningAgents,
      sessionFiles: files.length,
      waits: events.filter((event) => event.eventType === 'wait_agent').length,
    },
    timelineGroups,
  };
}

function sendEvent(response, name, payload) {
  response.write(`event: ${name}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function refreshLoop() {
  while (true) {
    try {
      latestSnapshot = await buildSnapshot();
      latestText = JSON.stringify(latestSnapshot);
      for (const client of clients) sendEvent(client, 'snapshot', latestSnapshot);
    } catch (error) {
      for (const client of clients) sendEvent(client, 'scan_error', { message: error.message });
    }
    await sleep(1500);
  }
}

async function serveStatic(request, response) {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);
  const pathname = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
  const target = normalize(join(publicDir, pathname));

  if (!target.startsWith(publicDir)) return response.writeHead(403).end('Forbidden');
  if (!existsSync(target)) return response.writeHead(404).end('Not found');

  response.writeHead(200, {
    'Cache-Control': 'no-store',
    'Content-Type': mime[extname(target)] || 'application/octet-stream',
  });
  createReadStream(target).pipe(response);
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || 'localhost'}`);

  if (url.pathname === '/api/state') {
    response.writeHead(200, { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' });
    response.end(latestText);
    return;
  }

  if (url.pathname === '/events') {
    response.writeHead(200, {
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'Content-Type': 'text/event-stream; charset=utf-8',
      'X-Accel-Buffering': 'no',
    });
    response.write(': connected\n\n');
    clients.add(response);
    sendEvent(response, 'snapshot', latestSnapshot);
    request.on('close', () => clients.delete(response));
    return;
  }

  await serveStatic(request, response);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Codex Agent Dashboard: http://127.0.0.1:${port}`);
  console.log(`Watching: ${sessionsDir}`);
});

refreshLoop();
