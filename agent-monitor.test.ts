import { describe, expect, test } from 'claude-code/testing'

const PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 100,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
} as const

describe('agent-monitor', () => {
  test('shows the main agent with its model and context fill', async ($, on) => {
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 120_000, window: 1_000_000, percent: 12 },
        rateLimits: [],
      },
    }))
    on('agent.list', () => ({ value: [] }))

    const band = await $.ui.mount({
      plugin: 'agent-monitor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: PROPS,
    })
    const main = await band.find({ text: /claude-sonnet-5-5/ })
    const fill = await band.find({ text: /12%/ })
    const size = await band.find({ text: /120\.0k \/ 1\.0M/ })

    expect(main).toBeDefined()
    expect(fill).toBeDefined()
    expect(size).toBeDefined()
  })

  test('lists each running subagent and hides finished ones', async ($, on) => {
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    on('session.usage', () => ({
      value: {
        startedAt: 0,
        context: { tokens: 1_000, window: 1_000_000, percent: 0 },
        rateLimits: [],
      },
    }))
    on('agent.list', () => ({
      value: [
        { id: 'a1', description: 'scan repo', type: 'Explore', status: 'running' },
        { id: 'a2', description: 'old job', type: 'Plan', status: 'completed' },
      ],
    }))

    const band = await $.ui.mount({
      plugin: 'agent-monitor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: PROPS,
    })

    expect(await band.find({ text: /Explore/ })).toBeDefined()
    expect(await band.find({ text: /Plan/ })).toBeUndefined()
  })

  test('lists a background shell started by the main agent', async ($, on) => {
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    on('session.usage', () => ({
      value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] },
    }))
    on('agent.list', () => ({ value: [] }))
    on('tool.call', { tool: 'Bash' }, () => ({
      result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' },
    }))

    await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true })

    const band = await $.ui.mount({
      plugin: 'agent-monitor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: PROPS,
    })

    expect(await band.find({ text: /npm run dev/ })).toBeDefined()
  })

  test('yields to a survey', async ($, on) => {
    on('session.model', () => ({ value: 'claude-sonnet-5-5' }))
    on('session.usage', () => ({
      value: { startedAt: 0, context: { window: 1_000_000 }, rateLimits: [] },
    }))
    on('agent.list', () => ({ value: [] }))
    on('ui.render', { component: 'AbovePrompt' }, () => ({
      type: 'Text',
      props: {},
      children: ['engine band'],
    }))

    const band = await $.ui.mount({
      plugin: 'agent-monitor',
      surface: 'terminal',
      component: 'AbovePrompt',
      props: { ...PROPS, hasSurvey: true },
    })

    expect(await band.find({ text: /claude-sonnet-5-5/ })).toBeUndefined()
    expect(await band.find({ text: /engine band/ })).toBeDefined()
  })
})
