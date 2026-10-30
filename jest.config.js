const path = require('path');

// `ui/` needs its own project: its .tsx files need JSX support (ui/tsconfig.json has `jsx: react`;
// no tsconfig.json exists at the repo root, so plain ts-jest defaults have none) and CSS/SCSS side-
// effect imports need stubbing out. Splitting into separate Jest `projects` avoids the two configs
// interfering with each other -- a single shared `transform` map with per-glob ts-jest options was
// tried first, but ts-jest silently dropped the `.tsx` entry's `jsx`/`tsconfig` options once a .tsx
// file was pulled in as a *dependency* of a .ts test file (only .tsx test entry points picked them
// up), for reasons not fully understood; `projects` sidesteps that entirely by giving `ui/` its own
// fully independent Jest config.
module.exports = {
  projects: [
    {
      displayName: 'default',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/shared/**/*.test.ts', '<rootDir>/task/**/*.test.ts'],
      transform: {
        // Same module interop as task/ and ui/ tsconfig.json, so `import md5 from 'md5'` works here too
        '^.+\\.ts$': ['ts-jest', { tsconfig: { esModuleInterop: true } }],
      },
    },
    {
      displayName: 'ui',
      testEnvironment: 'node',
      testMatch: ['<rootDir>/ui/**/*.test.ts', '<rootDir>/ui/**/*.test.tsx'],
      transform: {
        '^.+\\.tsx?$': ['ts-jest', { tsconfig: path.join(__dirname, 'ui/tsconfig.json'), isolatedModules: true }],
        // azure-devops-ui (and some of its own deps) ship raw ESM .js with no CommonJS build, which
        // Node's `require()` can't load directly. Run those through ts-jest too (allowJs) instead of
        // the usual babel-jest, so `export ... from` gets converted to `require`/`exports`.
        '^.+\\.js$': [
          'ts-jest',
          {
            isolatedModules: true,
            tsconfig: { allowJs: true, esModuleInterop: true, module: 'commonjs', target: 'es2019' },
          },
        ],
      },
      transformIgnorePatterns: ['node_modules/(?!(azure-devops-ui|recharts)/)'],
      moduleNameMapper: {
        '\\.(css|scss)$': '<rootDir>/ui/test/styleMock.js',
      },
    },
  ],
};
