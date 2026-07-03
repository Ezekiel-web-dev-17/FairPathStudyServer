import { createDefaultEsmPreset } from 'ts-jest';

const presetConfig = createDefaultEsmPreset({});

/** @type {import('jest').Config} */
const config = {
    ...presetConfig,
    testEnvironment: 'node',
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
    globalTeardown: '<rootDir>/jest.teardown.js',
    // Run suites serially — integration tests share a single DB instance and
    // collide when run in parallel (unique constraint violations, pool races).
    maxWorkers: 1,
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/'],
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
};

export default config;
