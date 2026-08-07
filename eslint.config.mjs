import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/src/generated/**',
      'docs/**',
      'scripts/legacy-validation/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // 저장소 루트의 도구 스크립트와 워크스페이스의 스크립트(예: CC-170 화면
    // 캡처)는 Node에서 직접 돈다. 브라우저 전역이 아니라 Node 전역을 쓴다.
    files: ['scripts/**/*.mjs', '**/scripts/**/*.mjs'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        setTimeout: 'readonly',
      },
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
);
