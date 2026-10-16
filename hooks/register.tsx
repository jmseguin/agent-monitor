import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { LiveAgent, LiveShell } from '../types'

const MAX_SUBAGENT_ROWS = 4
const KEEP_AGENTS = 50
const KEEP_SHELLS = 50

const agents = atom({ plugin: 'agent-monitor', key: 'agents' } as const, {})
const shells = atom(
  { plugin: 'agent-monitor', key: 'shells' } as const,
  {} as Record<string, LiveShell>,
)

const elapsed = (since: number): string => {
  const s = Math.max(0, Math.round((Date.now() - since) / 1000))
  if (s >= 3600) {
    return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`
  }
  if (s >= 60) {
    return `${Math.floor(s / 60)}m${s % 60}s`
  }

  return `${s}s`
}
const rev = atom({ plugin: 'agent-monitor', key: 'rev' } as const, 0)

const ENDED = ['completed', 'failed', 'killed']

const compact = (n: number | null | undefined): string => {
  if (n === null || n === undefined) {
    return '-'
  }
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}k`
  }

  return String(n)
}

const bar = (percent: number | null): string => {
  const filled =
    percent === null ? 0 : Math.round(Math.min(100, Math.max(0, percent)) / 10)

  return '█'.repeat(filled) + '░'.repeat(10 - filled)
}

const percentColor = (percent: number | null): string => {
  if (percent !== null && percent >= 85) {
    return 'error'
  }
  if (percent !== null && percent >= 70) {
    return 'warning'
  }

  return 'success'
}

async function addShell(
  $: EngineInterface,
  id: string,
  kind: string,
  command: string,
) {
  await update($, shells, all =>
    Object.fromEntries(
      Object.entries({
        ...all,
        [id]: { kind, command, startedAt: Date.now(), ended: false },
      }).slice(-KEEP_SHELLS),
    ),
  )
}

async function endShell($: EngineInterface, id: string | undefined) {
  if (id === undefined) {
    return
  }
  await update($, shells, all =>
    all[id] ? { ...all, [id]: { ...all[id], ended: true } } : all,
  )
}

export const register: Register = on => {
  on('session.measure', async ($, e, next) => {
    await update($, rev, n => n + 1)

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    const spawned = await next(e)
    await update($, rev, n => n + 1)

    return spawned
  })

  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    const id = e.agentId

    if (id !== undefined) {
      const usage = result.usage
      const tokens = usage
        ? usage.input_tokens +
          usage.cache_read_input_tokens +
          usage.cache_creation_input_tokens
        : null

      await update($, agents, all => {
        const known: LiveAgent | undefined = all[id]
        const merged: Record<string, LiveAgent> = {
          ...all,
          [id]: {
            model: usage?.model ?? e.model,
            tokens: tokens ?? known?.tokens ?? null,
          },
        }

        return Object.fromEntries(Object.entries(merged).slice(-KEEP_AGENTS))
      })
    }

    return result
  })

  // Background shells (Bash/PowerShell) and monitors: registered from the
  // tool result, which carries the task id however the backgrounding happened
  // (run_in_background, Ctrl+B, or an auto-background on timeout).
  on('tool.call', async ($, e, next) => {
    const out = await next(e)
    const input = e as unknown as Record<string, unknown>
    const result = (out as { result?: Record<string, unknown> }).result

    if (e.tool === 'Bash' || e.tool === 'PowerShell') {
      const id = result?.backgroundTaskId
      if (typeof id === 'string') {
        await addShell($, id, e.tool, String(input.command ?? ''))
      }
    } else if (e.tool === 'Monitor') {
      const id = result?.taskId
      if (typeof id === 'string') {
        await addShell(
          $,
          id,
          'Monitor',
          String(input.command ?? input.description ?? 'monitor'),
        )
      }
    } else if (e.tool === 'TaskStop') {
      const id = input.task_id ?? input.shell_id
      await endShell($, typeof id === 'string' ? id : undefined)
    }

    return out
  })

  // A finished background task arrives as a task-notification prompt naming its id.
  on('prompt.submit', async ($, e, next) => {
    if (e.origin.kind === 'task-notification') {
      const id = /<task-id>\s*([^<\s]+)\s*<\/task-id>/.exec(e.text)?.[1]
      await endShell($, id)
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await update($, rev, n => n + 1)

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.maxRows < 3) {
      return next(e)
    }

    await read($, rev)
    const live = await read($, agents)
    const shellMap = await read($, shells)
    const [model, usage, roster] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      $.agent.list(),
    ])
    const { Box, Text } = $.ui.resolve(e)

    const context = usage.context
    const percent = context.percent ?? null
    const running = roster.filter(agent => !ENDED.includes(agent.status))
    const activeShells = Object.entries(shellMap).filter(([, s]) => !s.ended)
    const items = [
      ...running.map(agent => ({ agent, shell: undefined })),
      ...activeShells.map(([id, shell]) => ({ agent: undefined, id, shell })),
    ]
    const room = Math.max(0, Math.min(MAX_SUBAGENT_ROWS, e.props.maxRows - 3))
    const overflow = items.length > room
    const shown = items.slice(0, overflow ? Math.max(0, room - 1) : room)

    return (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderDimColor
        paddingX={1}
      >
        <Box gap={2} height={1} overflow="hidden">
          <Text bold color="claude">
            main
          </Text>
          <Text>{model}</Text>
          <Text color={percentColor(percent)}>
            {bar(percent)} {percent === null ? '-' : `${Math.round(percent)}%`}
          </Text>
          <Text dimColor>
            {compact(context.tokens)} / {compact(context.window)}
          </Text>
        </Box>
        {shown.map(item =>
          item.agent ? (
            <Box gap={2} height={1} overflow="hidden">
              <Text dimColor>└</Text>
              <Text bold>{item.agent.type}</Text>
              <Text>{live[item.agent.id]?.model ?? '(starting)'}</Text>
              <Text dimColor>{compact(live[item.agent.id]?.tokens)} tok</Text>
              <Text dimColor wrap="truncate-end">
                {item.agent.status} · {item.agent.description}
              </Text>
            </Box>
          ) : (
            <Box gap={2} height={1} overflow="hidden">
              <Text dimColor>└</Text>
              <Text bold color="warning">
                {item.shell.kind === 'Monitor' ? 'monitor' : 'shell'}
              </Text>
              <Text dimColor>{elapsed(item.shell.startedAt)}</Text>
              <Text dimColor wrap="truncate-end">
                {item.shell.command}
              </Text>
            </Box>
          ),
        )}
        {overflow && (
          <Text dimColor>
            └ +{items.length - shown.length} more
          </Text>
        )}
      </Box>
    )
  })
}
