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
    testPathIgnorePatterns: ['/node_modules/', '<rootDir>/dist/'],
    modulePathIgnorePatterns: ['<rootDir>/dist/'],
};

export default config;
