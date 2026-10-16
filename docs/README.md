# agent-monitor

I am just experimenting with Claude Mods.

A Claude Code mod that draws a boxed band above the prompt listing the main agent (model and context usage), each running subagent, and each background shell or monitor the main agent started.

## Install

In a Claude Code session:

```
/plugin install agent-monitor --marketplace jmseguin/agent-monitor
```

From a shell:

```
claude plugin install agent-monitor --marketplace jmseguin/agent-monitor
```

## Notes

- Background shells are tracked from tool results seen in the current session; shells started before a reload are not listed.
- Shells clear when stopped with TaskStop or when their completion notification arrives.
