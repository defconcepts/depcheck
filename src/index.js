import fs from 'fs';
import path from 'path';
import walkdir from 'walkdir';
import minimatch from 'minimatch';
import component from './component';
import getNodes from './utils/get-nodes';
import requirePackageName from 'require-package-name';
import discoverPropertyDep from './utils/discover-property-dep';

function constructComponent(source, name) {
  return source[name].reduce((result, current) =>
    Object.assign(result, {
      [current]: require(path.resolve(__dirname, name, current)),
    }), {});
}

function objectValues(object) {
  return Object.keys(object).map(key => object[key]);
}

const availableParsers = constructComponent(component, 'parser');

const availableDetectors = constructComponent(component, 'detector');

const availableSpecials = constructComponent(component, 'special');

const defaultOptions = {
  withoutDev: false,
  ignoreBinPackage: false,
  ignoreMatches: [
  ],
  ignoreDirs: [
    '.git',
    '.svn',
    '.hg',
    '.idea',
    'node_modules',
    'bower_components',
  ],
  parsers: {
    '*.js': availableParsers.jsx,
    '*.jsx': availableParsers.jsx,
    '*.coffee': availableParsers.coffee,
    '*.litcoffee': availableParsers.coffee,
    '*.coffee.md': availableParsers.coffee,
  },
  detectors: [
    availableDetectors.importDeclaration,
    availableDetectors.requireCallExpression,
    availableDetectors.gruntLoadTaskCallExpression,
  ],
  specials: objectValues(availableSpecials),
};

function getOrDefault(opt, key) {
  return typeof opt[key] !== 'undefined' ? opt[key] : defaultOptions[key];
}

function unifyParser(parsers) {
  return Object.assign({}, ...Object.keys(parsers).map(key => ({
    [key]: parsers[key] instanceof Array ? parsers[key] : [parsers[key]],
  })));
}

function safeDetect(detector, node) {
  try {
    return detector(node);
  } catch (error) {
    return [];
  }
}

function minus(array1, array2) {
  return array1.filter(item => array2.indexOf(item) === -1);
}

function intersect(array1, array2) {
  return array1.filter(item => array2.indexOf(item) !== -1);
}

function unique(array, item) {
  return array.indexOf(item) === -1 ? array.concat([item]) : array;
}

function concat(array, item) {
  return array.concat(item);
}

function isStringArray(obj) {
  return obj instanceof Array && obj.every(item => typeof item === 'string');
}

function getDependencies(dir, filename, deps, parser, detectors) {
  const detect = node =>
    detectors.map(detector => safeDetect(detector, node)).reduce(concat, []);

  return new Promise((resolve, reject) => {
    fs.readFile(filename, 'utf8', (error, content) => {
      if (error) {
        reject(error);
      }

      try {
        resolve(parser(content, filename, deps, dir));
      } catch (syntaxError) {
        reject(syntaxError);
      }
    });
  }).then(ast => {
    // when parser returns string array, skip detector step and treat them as dependencies directly.
    if (isStringArray(ast)) {
      return ast;
    }

    const dependencies = getNodes(ast)
      .map(detect)
      .reduce(concat, [])
      .reduce(unique, [])
      .map(requirePackageName);

    const peerDeps = dependencies
      .map(dep => discoverPropertyDep(dep, 'peerDependencies', deps, dir))
      .reduce(concat, []);

    const optionalDeps = dependencies
      .map(dep => discoverPropertyDep(dep, 'optionalDependencies', deps, dir))
      .reduce(concat, []);

    return dependencies.concat(peerDeps).concat(optionalDeps);
  });
}

function checkFile(dir, filename, deps, devDeps, parsers, detectors) {
  const basename = path.basename(filename);
  const targets = [].concat(...Object.keys(parsers)
    .filter(glob => minimatch(basename, glob, { dot: true }))
    .map(key => parsers[key]));

  return targets.map(parser =>
    getDependencies(dir, filename, deps.concat(devDeps), parser, detectors)
      .then(used => ({
        dependencies: minus(deps, used),
        devDependencies: minus(devDeps, used),
      }), error => ({
        dependencies: deps,
        devDependencies: devDeps,
        invalidFiles: {
          [filename]: error,
        },
      })));
}

function checkDirectory(dir, ignoreDirs, deps, devDeps, parsers, detectors) {
  return new Promise(resolve => {
    const promises = [];
    const finder = walkdir(dir, { 'no_recurse': true });

    finder.on('directory', subdir =>
      ignoreDirs.indexOf(path.basename(subdir)) === -1 &&
      promises.push(
        checkDirectory(subdir, ignoreDirs, deps, devDeps, parsers, detectors)));

    finder.on('file', filename =>
      promises.push(
        ...checkFile(dir, filename, deps, devDeps, parsers, detectors)));

    finder.on('error', (dirPath, error) =>
      promises.push(Promise.resolve({
        dependencies: deps,
        devDependencies: devDeps,
        invalidDirs: {
          [dirPath]: error,
        },
      })));

    finder.on('end', () =>
      resolve(Promise.all(promises).then(results =>
        results.reduce((obj, current) => ({
          dependencies: intersect(obj.dependencies, current.dependencies),
          devDependencies: intersect(obj.devDependencies, current.devDependencies),
          invalidFiles: Object.assign(obj.invalidFiles, current.invalidFiles),
          invalidDirs: Object.assign(obj.invalidDirs, current.invalidDirs),
        }), {
          dependencies: deps,
          devDependencies: devDeps,
          invalidFiles: {},
          invalidDirs: {},
        }))));
  });
}

function isIgnored(ignoreMatches, dependency) {
  return ignoreMatches.some(match => minimatch(dependency, match));
}

function hasBin(rootDir, dependency) {
  try {
    const depPkg = require(path.join(rootDir, 'node_modules', dependency, 'package.json'));
    return depPkg.hasOwnProperty('bin');
  } catch (error) {
    return false;
  }
}

function filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, dependencies) {
  return Object.keys(dependencies).filter(dependency =>
    ignoreBinPackage && hasBin(rootDir, dependency) ||
    isIgnored(ignoreMatches, dependency)
    ? false
    : true);
}

export default function depcheck(rootDir, options, cb) {
  const withoutDev = getOrDefault(options, 'withoutDev');
  const ignoreBinPackage = getOrDefault(options, 'ignoreBinPackage');
  const ignoreMatches = getOrDefault(options, 'ignoreMatches');
  const ignoreDirs = defaultOptions.ignoreDirs.concat(options.ignoreDirs).reduce(unique, []);

  const detectors = getOrDefault(options, 'detectors');
  const parsers = Object.assign(
    { '*': getOrDefault(options, 'specials') },
    unifyParser(getOrDefault(options, 'parsers')));

  const metadata = options.package || require(path.join(rootDir, 'package.json'));
  const dependencies = metadata.dependencies || {};
  const devDependencies = metadata.devDependencies || {};
  const deps = filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, dependencies);
  const devDeps = filterDependencies(rootDir, ignoreBinPackage, ignoreMatches, withoutDev ? [] : devDependencies);

  return checkDirectory(rootDir, ignoreDirs, deps, devDeps, parsers, detectors)
    .then(cb);
}

depcheck.parser = availableParsers;
depcheck.detector = availableDetectors;
depcheck.special = availableSpecials;
