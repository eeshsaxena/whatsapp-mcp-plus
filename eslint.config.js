import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  {
    ignores: ["dist/**", "node_modules/**", "_ref-ts/**", "_ref-go/**", "**/*.map", "scratch*/**"],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  // Source (TypeScript)
  {
    files: ["src/**/*.ts"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      // MCP tool handlers intentionally take zod-parsed `any` args; the schema is
      // the validation boundary, so explicit-any there is a deliberate choice.
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" },
      ],
      "no-empty": ["error", { allowEmptyCatch: true }],
      eqeqeq: ["error", "smart"],
      "no-var": "error",
      "prefer-const": "error",
    },
  },
  // Tests + scripts (plain ESM JS)
  {
    files: ["test/**/*.mjs", "scripts/**/*.mjs", "eslint.config.js"],
    languageOptions: { globals: { ...globals.node } },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", caughtErrors: "none" }],
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
);
