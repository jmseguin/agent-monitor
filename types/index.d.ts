export type LiveAgent = {
  model: string
  tokens: number | null
}

export type LiveShell = {
  kind: string
  command: string
  startedAt: number
  ended: boolean
}

declare module 'claude-code' {
  interface PluginState {
    'agent-monitor': {
      agents: Record<string, LiveAgent>
      shells: Record<string, LiveShell>
      rev: number
    }
  }
}
