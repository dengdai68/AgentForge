import { dirname, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { accessSync, statSync, constants } from 'node:fs';
import { delimiter, resolve } from 'node:path';

// Presence only: use the same executable search environment as actual calls.
// Never start a CLI, load credentials or equate installation with login/health.
export function runtimeInstalled(provider, options = {}) {
  const command = { 'claude-code': 'claude', codex: 'codex', dsh: 'dsh' }[provider];
  if (!command) return false;
  const environment = cliEnvironment(command, {}, options);
  return (environment.PATH || '').split(delimiter).filter(Boolean).some(directory => {
    try {
      const path = resolve(directory, command);
      accessSync(path, constants.X_OK);
      return statSync(path).isFile();
    } catch { return false; }
  });
}

// GUI apps do not inherit interactive shell profiles. Preserve the operator's
// existing precedence; only append documented, deterministic fallback paths.
export function cliEnvironment(command, extra = {}, { environment = process.env, platform = process.platform, homeDirectory = homedir() } = {}) {
  const result = { ...environment, ...extra };
  delete result.ELECTRON_RUN_AS_NODE;
  delete result.AGENTFORGE_BOOTSTRAP_TOKEN;
  // Plugin installations are immutable inputs, not Python cache directories.
  // Inherited by local tools; not a filesystem sandbox or an access restriction.
  result.PYTHONDONTWRITEBYTECODE = '1';
  if (platform === 'darwin') {
    const fallback = [
      ...(isAbsolute(command) ? [dirname(command)] : []),
      join(homeDirectory, '.local', 'bin'), join(homeDirectory, '.npm-global', 'bin'), join(homeDirectory, '.volta', 'bin'),
      '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin'
    ];
    result.PATH = [...new Set([...(result.PATH ? result.PATH.split(':') : []), ...fallback])].join(':');
  }
  return result;
}
