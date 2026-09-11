import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve, sep } from 'node:path';

const INJECTION_DECLARATION = /const\s+INJECTION_FILES\s*=\s*Object\.freeze\(\s*\[([\s\S]*?)\]\s*\);/;
const QUOTED_JAVASCRIPT_PATH = /(['"])([^'"\r\n]+\.js)\1/g;
const SAFE_RELATIVE_JAVASCRIPT_PATH = /^[A-Za-z0-9][A-Za-z0-9_./-]*\.js$/;

export function parseProductionInjectionFiles(popupSource) {
  const declaration = String(popupSource || '').match(INJECTION_DECLARATION);
  if (!declaration) {
    throw new Error('popup.js does not contain the canonical INJECTION_FILES declaration');
  }

  const files = [...declaration[1].matchAll(QUOTED_JAVASCRIPT_PATH)]
    .map(match => match[2]);
  if (!files.length) {
    throw new Error('popup.js INJECTION_FILES is empty');
  }

  const seen = new Set();
  for (const relativePath of files) {
    if (
      !SAFE_RELATIVE_JAVASCRIPT_PATH.test(relativePath)
      || relativePath.includes('..')
      || relativePath.includes('\\')
      || isAbsolute(relativePath)
    ) {
      throw new Error(`Unsafe production injection path: ${relativePath}`);
    }
    if (seen.has(relativePath)) {
      throw new Error(`Duplicate production injection path: ${relativePath}`);
    }
    seen.add(relativePath);
  }
  return Object.freeze(files);
}

export async function readProductionRuntimeSources(projectRoot, options = {}) {
  const canonicalRoot = resolve(projectRoot);
  const popupPath = resolve(canonicalRoot, 'popup.js');
  const popupSource = await readFile(popupPath, 'utf8');
  const injectionFiles = parseProductionInjectionFiles(popupSource);
  const through = options.through || 'src/core/autofill-engine.js';
  const throughIndex = injectionFiles.indexOf(through);
  if (throughIndex < 0) {
    throw new Error(`Production injection boundary is absent from popup.js: ${through}`);
  }

  const excludedPrefixes = Object.freeze([
    ...(options.excludedPrefixes || ['src/floating-ui/']),
  ]);
  const selected = injectionFiles
    .slice(0, throughIndex + 1)
    .filter(relativePath => !excludedPrefixes.some(prefix => relativePath.startsWith(prefix)));

  return Promise.all(selected.map(async relativePath => {
    const absolutePath = resolve(canonicalRoot, relativePath);
    if (!absolutePath.startsWith(`${canonicalRoot}${sep}`)) {
      throw new Error(`Production injection path escapes project root: ${relativePath}`);
    }
    return Object.freeze({
      relativePath,
      source: await readFile(absolutePath, 'utf8'),
    });
  }));
}
