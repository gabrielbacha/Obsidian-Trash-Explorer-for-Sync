import obsidianmd from "eslint-plugin-obsidianmd";
// Obsidian review rules (the same rules the community review bot runs).
// Oxlint does the general static analysis.
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["node_modules", "main.js", "tests", "*.mjs", "scripts"]),
  ...obsidianmd.configs.recommended,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
  },
]);
