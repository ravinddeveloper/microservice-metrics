import js from '@eslint/js';

export default [
    js.configs.recommended,
    {
        files: ['src/**/*.js', 'test/**/*.js', 'benchmarks/**/*.js', 'scripts/**/*.mjs', 'eslint.config.js'],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: 'module',
            globals: {
                console: 'readonly',
                process: 'readonly',
                Buffer: 'readonly',
                setTimeout: 'readonly',
                clearTimeout: 'readonly',
                setInterval: 'readonly',
                clearInterval: 'readonly',
                setImmediate: 'readonly',
                clearImmediate: 'readonly',
                URL: 'readonly',
                AbortController: 'readonly',
                AbortSignal: 'readonly',
                Float64Array: 'readonly',
                Symbol: 'readonly',
                WeakSet: 'readonly',
                Map: 'readonly',
                Set: 'readonly',
                Promise: 'readonly',
                fetch: 'readonly',
            },
        },
        rules: {
            'no-unused-vars': [
                'warn',
                { argsIgnorePattern: '.*', varsIgnorePattern: '.*', caughtErrorsIgnorePattern: '.*' },
            ],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-console': 'off',
            'no-useless-assignment': 'off',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', 'coverage/**', 'graphify-out/**', 'examples/**'],
    },
];
