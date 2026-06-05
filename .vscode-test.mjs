import { defineConfig } from '@vscode/test-cli';

export default defineConfig({
  files: 'out/test/**/*.test.js',
  // Open this folder as the workspace so .vscode/tasks.json is discoverable.
  workspaceFolder: '.',
  mocha: {
    timeout: 30000,
  },
});
