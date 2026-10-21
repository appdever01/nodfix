import { access, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { delimiter, join } from 'node:path';
import semver from 'semver';

export type Manager = 'nvm' | 'fnm' | 'volta' | 'asdf' | 'mise';
export async function detectManagers(env: NodeJS.ProcessEnv = process.env, platform = process.platform): Promise<Manager[]> {
  const managers: Manager[] = [];
  if (env.NVM_DIR) {
    try { if ((await stat(join(env.NVM_DIR, 'nvm.sh'))).isFile()) managers.push('nvm'); } catch { return detectPathManagers(env, platform, managers); }
  }
  return detectPathManagers(env, platform, managers);
}
async function detectPathManagers(env: NodeJS.ProcessEnv, platform: NodeJS.Platform, managers: Manager[]): Promise<Manager[]> {
  const directories = (env.PATH ?? '').split(delimiter).filter(Boolean);
  for (const manager of ['nvm', 'fnm', 'volta', 'asdf', 'mise'] as const) {
    for (const directory of directories) {
      const extensions = platform === 'win32' ? ['', '.exe', '.cmd', '.bat'] : [''];
      let found = false;
      for (const extension of extensions) {
        try {
          const path = join(directory, `${manager}${extension}`);
          await access(path, platform === 'win32' ? constants.F_OK : constants.X_OK);
          if ((await stat(path)).isFile()) found = true;
        } catch { continue; }
      }
      if (found) { if (!managers.includes(manager)) managers.push(manager); break; }
    }
  }
  return managers;
}
export function upgradeCommands(manager: Manager, version: string): string[] {
  if (!semver.valid(version)) throw new Error('Invalid upgrade target');
  switch (manager) {
    case 'nvm': return [`nvm install ${version}`, `nvm use ${version}`];
    case 'fnm': return [`fnm install ${version}`, `fnm use ${version}`];
    case 'volta': return [`volta install node@${version}`];
    case 'asdf': return [`asdf install nodejs ${version}`, `asdf set nodejs ${version}`];
    case 'mise': return [`mise install node@${version}`, `mise use node@${version}`];
  }
}
