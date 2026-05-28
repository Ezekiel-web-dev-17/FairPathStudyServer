import eslint from '@eslint/js';
import prettierRecommended from 'eslint-plugin-prettier/recommended';
import globals from 'globals';

export default [
    {
        ignores: ['dist/**/*'],
    },
    eslint.configs.recommended,
    prettierRecommended,
    {
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'module',
            globals: {
                ...globals.node,
                ...globals.jest,
            },
        },
        rules: {
            'no-console': 'warn',
            'no-unused-vars': 'warn',
        },
    },
];
