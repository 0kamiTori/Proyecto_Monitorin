import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, statSync } from 'node:fs';
import { resolve, join, relative } from 'node:path';
// Incluye exclusivamente código, configuraciones de ejemplo y documentación.
// No incorpora credenciales, bases locales, dependencias ni reportes técnicos.
const root = process.cwd(),
  output = resolve('output');
mkdirSync(output, { recursive: true });
const files = [
  'package.json',
  'package-lock.json',
  'tsconfig.base.json',
  '.gitignore',
  '.env.example',
  '.dockerignore',
  '.editorconfig',
  '.prettierrc.json',
  '.prettierignore',
  'pyproject.toml',
  'Dockerfile',
  'compose.yaml',
  'README.md',
];
const directories = [
  'apps/api/src',
  'apps/api/tests',
  'apps/web/src',
  'apps/web/public',
  'packages/shared/src',
  'docs',
  'scripts',
  'deployment',
  'agent/smtel_agent',
  'agent/tests',
];
for (const directory of directories) {
  const visit = (path) => {
    for (const name of readdirSync(path)) {
      const child = join(path, name);
      if (name === '__pycache__') continue;
      if (statSync(child).isDirectory()) visit(child);
      else if (!name.endsWith('.pyc')) files.push(relative(root, child).replaceAll('\\', '/'));
    }
  };
  visit(resolve(directory));
}
files.push(
  'apps/api/package.json',
  'apps/api/tsconfig.json',
  'apps/web/package.json',
  'apps/web/tsconfig.json',
  'apps/web/index.html',
  'apps/web/vite.config.ts',
  'packages/shared/package.json',
  'packages/shared/tsconfig.json',
  'agent/requirements.txt',
  'agent/requirements-dev.txt',
  'agent/config.example.json',
);
execFileSync('tar.exe', ['-a', '-c', '-f', resolve(output, 'SMTEL-fuentes.zip'), ...files], {
  stdio: 'inherit',
});
console.log(
  `Proyecto empaquetado: ${files.length} archivos de código y documentación en output/SMTEL-fuentes.zip`,
);
