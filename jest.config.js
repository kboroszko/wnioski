/** @type {import('jest').Config} */
const config = {
  roots: ['<rootDir>/'],
  testMatch: ['<rootDir>/**/*.test.js'],
  transform: {
    '^.+\\.m?js$': '@swc/jest',
  },
  collectCoverage: true,
  collectCoverageFrom: [
    '<rootDir>/solver.js',
  ],
  coverageDirectory: '<rootDir>/coverage',
  coverageReporters: ['text', 'html'],
};

module.exports = config;
