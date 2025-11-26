import js from "@eslint/js";
import globals from "globals";

const jsRecommended = js.configs.recommended;

export default [
  {
    ignores: [
      "node_modules/**",
      ".svelte-kit/**",
      ".vercel/**",
      "build/**",
      "dist/**",
    ],
  },
  {
    ...jsRecommended,
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      ...jsRecommended.languageOptions,
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
  },
];
