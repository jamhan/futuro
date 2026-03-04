module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/jest.setup.js'],
  roots: ['<rootDir>/src'],
  testMatch: ['**/__tests__/**/*.ts', '**/?(*.)+(spec|test).ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/**/*.d.ts',
    '!src/**/*.test.ts',
  ],
  projects: [
    {
      displayName: 'unit',
      testMatch: ['<rootDir>/src/**/*.test.ts'],
      testPathIgnorePatterns: ['/node_modules/', '/tests/'],
      setupFiles: ['<rootDir>/jest.setup.js', '<rootDir>/jest.setup.fast.js'],
      transform: { '^.+\\.ts$': 'ts-jest' },
      moduleFileExtensions: ['ts', 'js'],
      roots: ['<rootDir>/src'],
    },
    {
      displayName: 'integration',
      testMatch: ['<rootDir>/tests/integration/**/*.test.ts'],
      setupFiles: ['<rootDir>/jest.setup.js'],
      transform: { '^.+\\.ts$': 'ts-jest' },
      moduleFileExtensions: ['ts', 'js'],
      roots: ['<rootDir>/tests/integration', '<rootDir>/src'],
    },
  ],
};
