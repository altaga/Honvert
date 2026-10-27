// Unit and fuzz tests run fully offline: no device, no network, no native build.
// `npm test` runs everything; tests/README.md explains the deeper runs.
module.exports = {
  testEnvironment: "node",
  roots: ["<rootDir>/tests"],
  testMatch: ["**/*.test.js"],
  transform: {
    "\\.[jt]sx?$": ["babel-jest", { babelrc: false, configFile: false, presets: ["babel-preset-expo"] }],
  },
  // The app imports react-native for theme and i18n. The tests only need its I18nManager stub.
  moduleNameMapper: {
    "^react-native$": "<rootDir>/tests/mocks/react-native.js",
  },
};
