// Runs the integration suite in a real VS Code with an isolated profile.
// VSCODE_PATH overrides the VS Code executable; by default the installed app is used
// on macOS, otherwise @vscode/test-electron downloads a copy.
import { runTests } from '@vscode/test-electron';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../..', import.meta.url));
const macApp = '/Applications/Visual Studio Code.app/Contents/MacOS/Code';
const vscodeExecutablePath = process.env.VSCODE_PATH ?? (existsSync(macApp) ? macApp : undefined);
const profile = mkdtempSync(join(process.env.TMPDIR ?? tmpdir(), 'marklens-test-'));

try {
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath: root,
    extensionTestsPath: join(root, 'dist/test/suite.js'),
    launchArgs: [
      join(root, 'test-docs'),
      '--disable-extensions',
      '--disable-workspace-trust',
      '--skip-welcome',
      '--skip-release-notes',
      `--user-data-dir=${join(profile, 'user')}`,
      `--extensions-dir=${join(profile, 'extensions')}`,
    ],
  });
} catch (err) {
  console.error('Integration tests failed:', err);
  process.exit(1);
}
