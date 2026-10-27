const { defineConfig } = require("eslint/config");
const expo = require("eslint-config-expo/flat");

module.exports = defineConfig([
  expo,
  { ignores: ["dist/*"] },
  {
    // Jest suites and the test runners run in Node, so they get Jest and Node globals.
    files: ["tests/**/*.js", "jest.config.js"],
    languageOptions: {
      globals: {
        describe: "readonly",
        it: "readonly",
        expect: "readonly",
        jest: "readonly",
        __dirname: "readonly",
        process: "readonly",
        require: "readonly",
        TextEncoder: "readonly",
        Buffer: "readonly",
        console: "readonly",
      },
    },
  },
]);
