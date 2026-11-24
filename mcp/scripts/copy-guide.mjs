// Bundle a copy of docs/AGENT.md and the skills/ folder so guide_read still works when the package is used outside the repo.
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = resolve(root, '..', 'docs', 'AGENT.md');
if (existsSync(src)) {
  mkdirSync(resolve(root, 'guide'), { recursive: true });
  copyFileSync(src, resolve(root, 'guide', 'AGENT.md'));
  console.error('[copy-guide] bundled docs/AGENT.md');
} else {
  console.error('[copy-guide] ../docs/AGENT.md not found, keeping existing guide/AGENT.md');
}

const skills = resolve(root, '..', 'skills');
if (existsSync(resolve(skills, 'README.md'))) {
  rmSync(resolve(root, 'guide', 'skills'), { recursive: true, force: true });
  cpSync(skills, resolve(root, 'guide', 'skills'), { recursive: true });
  console.error('[copy-guide] bundled skills/');
} else {
  console.error('[copy-guide] ../skills not found, keeping existing guide/skills');
}
