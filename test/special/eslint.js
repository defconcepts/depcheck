/* global describe, it */

import 'should';
import yaml from 'js-yaml';
import eslintSpecialParser from '../../src/special/eslint';

const testCases = [
  {
    name: 'ignore when user not extends any config in `.eslintrc`',
    content: {},
    expected: [],
  },
  {
    name: 'detect specific parser',
    content: {
      parser: 'babel-eslint',
    },
    expected: [
      'babel-eslint',
    ],
  },
  {
    name: 'detect specific plugins',
    content: {
      plugins: ['mocha'],
    },
    expected: [
      'eslint-plugin-mocha',
    ],
  },
  {
    name: 'handle eslint config with short name',
    content: {
      extends: 'preset',
    },
    expected: [
      'eslint-config-preset',
    ],
  },
  {
    name: 'handle eslint config with full name',
    content: {
      extends: 'eslint-config-preset',
    },
    expected: [
      'eslint-config-preset',
    ],
  },
  {
    name: 'handle eslint config from package module',
    content: {
      extends: 'airbnb/base',
    },
    expected: [
      'eslint-config-airbnb',
    ],
  },
  {
    name: 'handle eslint config with undeclared plugins',
    content: {
      extends: 'airbnb/react',
    },
    expected: [
      'eslint-config-airbnb',
      'eslint-plugin-react',
    ],
  },
  {
    name: 'handle eslint config with nested extends',
    content: {
      extends: 'airbnb',
    },
    expected: [
      'eslint-config-airbnb',
      'eslint-plugin-react',
    ],
  },
  {
    name: 'skip eslint recommended config',
    content: {
      extends: 'eslint:recommended',
    },
    expected: [],
  },
  {
    name: 'handle config of absolute local path',
    content: {
      extends: '/path/to/config',
    },
    expected: [],
  },
  {
    name: 'handle config of relative local path',
    content: {
      extends: './config',
    },
    expected: [],
  },
];

function testEslint(deps, content) {
  const result = eslintSpecialParser(
    content, '/path/to/.eslintrc', deps, __dirname);

  result.should.deepEqual(deps);
}

describe('eslint special parser', () => {
  it('should ignore when filename is not `.eslintrc`', () => {
    const result = eslintSpecialParser('content', '/a/file');
    result.should.deepEqual([]);
  });

  it(`should handle parse error`, () =>
    testEslint([], '{ this is an invalid JSON string'));

  it(`should handle non-standard JSON content`, () =>
    testEslint(
      testCases[1].expected,
      JSON.stringify(testCases[1].content) + '\n// this is ignored'));

  describe('with JSON format', () =>
    testCases.forEach(testCase =>
      it(`should ${testCase.name}`, () =>
        testEslint(testCase.expected, JSON.stringify(testCase.content)))));

  describe('with YAML format', () =>
    testCases.forEach(testCase =>
      it(`should ${testCase.name}`, () =>
        testEslint(testCase.expected, yaml.safeDump(testCase.content)))));
});
