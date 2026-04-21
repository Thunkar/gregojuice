import js from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

/**
 * Shared ESLint config for the whole monorepo.
 *
 * Apps extend this directly; library packages (non-React) can cherry-pick
 * just the base + TS parts by re-exporting without the React bits.
 */
export const baseConfig = tseslint.config(
  {
    ignores: [
      "**/dist",
      "**/target",
      "**/artifacts",
      "**/generated",
      "**/out",
      "**/.turbo",
      "**/codegenCache.json",
      "packages/contracts/ethereum/solidity/lib",
    ],
  },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended, eslintConfigPrettier],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2025,
    },
    rules: {
      // Let callers mark intentionally-unused args/vars with a leading `_`.
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
    },
  },
  {
    // Profiling module intercepts arbitrary framework calls — `any` is the
    // shape of the underlying API, so forcing stricter typing here is
    // counterproductive.
    files: ["**/profiling/**/*.ts", "**/profiling/**/*.tsx"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },
);

export const reactConfig = tseslint.config(...baseConfig, {
  files: ["**/*.{ts,tsx}"],
  languageOptions: {
    globals: globals.browser,
  },
  plugins: {
    "react-hooks": reactHooks,
    "react-refresh": reactRefresh,
  },
  rules: {
    ...reactHooks.configs.recommended.rules,
    "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],
  },
});

export default baseConfig;
