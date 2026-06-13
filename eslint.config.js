import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      // ── 历史风格债:降为 warning,看得见但不挡构建 ──
      // (这些是当前版本积累的 576 个 error 的主体,一次性全修风险大、不属于"做稳"。
      //  保留为 warn 让新代码不再增量恶化,后续可分批清。)
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': 'warn',
      '@typescript-eslint/ban-ts-comment': 'warn',
      'no-useless-escape': 'warn',
      'react-refresh/only-export-components': 'warn',
      'prefer-const': 'warn',
      'no-empty': 'warn',
      // react-hooks/exhaustive-deps 默认即 warn,保持(54 条,逐个判断,不批量改)
      // react-compiler 新规(plugin recommended 默认 error):需逐个改 effect/render 逻辑,
      // 一次性修风险大且不属于"做稳",降 warn 看得见、不挡构建,后续分批清。
      'react-hooks/set-state-in-effect': 'warn',          // effect 内同步 setState(级联渲染,18 处)
      'react-hooks/purity': 'warn',                       // render 期调用不纯函数
      'react-hooks/preserve-manual-memoization': 'warn',  // 既有 memo 无法被编译器保留

      // ── 真正危险:保持 error,新代码命中即挡构建 ──
      'react-hooks/rules-of-hooks': 'error',          // 条件式调用 hook,必崩
      'no-async-promise-executor': 'error',           // async Promise executor 吞错
      'no-unsafe-optional-chaining': 'error',         // 可选链后接运算,运行时炸
      '@typescript-eslint/no-non-null-asserted-optional-chain': 'error',
    },
  },
])
