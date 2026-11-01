# DeepSeek Harness Hook bridges

The three published JS modules are unmodified MIT source from the exact npm packages/versions recorded in `provenance.json`. Their adjacent LICENSE files must ship with them. `hook-guard.mjs` is AgentForge-owned glue that fails explicitly on dynamic outputs the pinned bridges would otherwise ignore.

`dsh.mjs` materializes selected modules in the private Trace directory. `dsh-extensions.mjs` generates separate executable copies with native peer import URLs, source tool names and scoped plugin variables. It never changes these upstream files or installs global packages. Peer APIs must match Harness 0.2.1-rc.2.

References: https://www.npmjs.com/package/@deepseek-ai/dsh-hooks-claude-code/v/0.2.1-rc.2 and https://www.npmjs.com/package/@deepseek-ai/dsh-hooks-codex/v/0.2.1-rc.2 .
