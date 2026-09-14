/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/src'],
  testMatch: ['**/*.test.ts'],
  globalSetup: '<rootDir>/src/tests/globalSetup.ts',
  globalTeardown: '<rootDir>/src/tests/globalTeardown.ts',
  setupFilesAfterEnv: ['<rootDir>/src/tests/setup.ts'],
  // mongodb-memory-server needs headroom to download/boot on first run
  testTimeout: 60000,
  clearMocks: true,
  collectCoverageFrom: ['src/**/*.ts', '!src/tests/**', '!src/**/*.d.ts', '!src/db/seed.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
};
