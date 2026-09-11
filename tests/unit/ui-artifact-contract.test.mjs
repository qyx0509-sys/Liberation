import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { parseProductionInjectionFiles } from '../e2e/support/production-runtime-loader.mjs';

const root = resolve(import.meta.dirname, '../..');
const read = path => readFileSync(resolve(root, path), 'utf8');
const require = createRequire(import.meta.url);
const UI = require(resolve(root, 'src/ui/design-system.js'));
const popup = read('popup.html');
const options = read('options.html');
const panel = read('src/floating-ui/floating-panel.js');
const build = read('scripts/build.mjs');
const injection = parseProductionInjectionFiles(read('popup.js'));
const sharedRuntime = ['src/ui/design-system.js', 'src/ui/profile-coverage.js', 'src/ui/review-presenter.js'];

function declarationArray(source, name) {
  const body = source.match(new RegExp(`const\\s+${name}\\s*=\\s*(?:Object\\.freeze\\()?\\s*\\[([\\s\\S]*?)\\]`))?.[1];
  assert.ok(body, `missing build/runtime declaration ${name}`);
  return [...body.matchAll(/['"]([^'"]+)['"]/g)].map(match => match[1]);
}

function assertNoRemoteResources(source, label) {
  // Match actual resource attributes, not SVG xmlns namespaces or example
  // URLs in text fields. Inline/local SVG is intentionally allowed.
  const resourceTags = [...source.matchAll(/<(?:script|link|img|iframe|audio|video|source|use)\b[^>]*>/gi)];
  for (const [tag] of resourceTags) {
    assert.doesNotMatch(tag, /\b(?:src|href|xlink:href|srcset)\s*=\s*['"]\s*(?:https?:)?\/\//i, `${label} has a remote resource`);
  }
  assert.doesNotMatch(source, /@import\s+(?:url\()?\s*['"]?\s*(?:https?:)?\/\//i, `${label} imports remote CSS`);
  assert.doesNotMatch(source, /url\(\s*['"]?\s*(?:https?:)?\/\//i, `${label} loads a remote CSS asset`);
}

test('All three UI surfaces keep their HTML, CSS and SVG resources local', () => {
  for (const [label, source] of [
    ['Popup', popup], ['Options', options], ['Shadow panel', panel],
    ['Popup CSS', read('src/ui/popup.css')], ['Options CSS', read('src/ui/options.css')],
    ['shared tokens', UI.tokensCSS], ['shared icons', read('src/ui/design-system.js')],
  ]) assertNoRemoteResources(source, label);
  assertNoRemoteResources('<svg xmlns="http://www.w3.org/2000/svg"><use href="#local-icon"/></svg>', 'namespace control');
  assert.throws(() => assertNoRemoteResources('<img src="https://remote.invalid/image.png">', 'remote control'));
  assert.throws(() => assertNoRemoteResources('body{background:url(//remote.invalid/image.png)}', 'CSS control'));
});

test('Shared UI runtime has no network client or remote dependency loader', () => {
  for (const file of [...sharedRuntime, 'src/ui/options-workspace.js']) {
    assert.doesNotMatch(read(file), /\bfetch\s*\(|\bXMLHttpRequest\b|new\s+WebSocket\b|\bsendBeacon\s*\(/, file);
  }
});

test('Popup and Options use the generated token sheet while Shadow DOM uses the same token source', () => {
  for (const [label, html] of [['Popup', popup], ['Options', options]]) {
    assert.match(html, /<link\b[^>]*href=["']src\/ui\/design-tokens\.css["']/, `${label}: shared token CSS`);
    assert.match(html, /<script\b[^>]*src=["']src\/ui\/design-system\.js["']/, `${label}: shared UI script`);
  }
  assert.match(panel, /JFUI\.tokensCSS/);
  assert.match(build, /tokensCSS[\s\S]*writeFile\(join\(projectRoot,\s*['"]src\/ui\/design-tokens\.css/);
  const generated = read('src/ui/design-tokens.css').replace(/^\/\*[^]*?\*\/\s*/, '').trim();
  assert.equal(generated, UI.tokensCSS.trim(), 'generated tokens must match the shared light/dark/focus source');
  assert.match(UI.tokensCSS, /prefers-color-scheme:dark/);
  assert.match(UI.tokensCSS, /prefers-reduced-motion:reduce/);
  assert.match(UI.tokensCSS, /focus-visible/);
});

test('Every shared runtime module is injected exactly once before floating UI and controller', () => {
  const panelIndex = injection.indexOf('src/floating-ui/floating-panel.js');
  const controllerIndex = injection.indexOf('src/content-controller.js');
  assert.ok(panelIndex >= 0 && controllerIndex > panelIndex);
  for (const file of sharedRuntime) {
    assert.equal(injection.filter(path => path === file).length, 1, file);
    assert.ok(injection.indexOf(file) < panelIndex, `${file} must be ready before Shadow DOM creation`);
    assert.ok(existsSync(resolve(root, file)), `${file} source is missing`);
  }
  const globals = declarationArray(read('src/content-controller.js'), 'REQUIRED_GLOBALS');
  for (const globalName of ['JFUI', 'JFProfileCoverage', 'JFReviewPresenter']) assert.ok(globals.includes(globalName));
});

test('All local surface references and injected runtime files are covered by the existing build pipeline', () => {
  const required = declarationArray(build, 'requiredPaths');
  const optional = declarationArray(build, 'optionalPaths');
  const sources = new Set([...sharedRuntime, 'src/ui/design-tokens.css', ...injection]);
  for (const html of [popup, options]) {
    for (const [, source] of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)=["']([^"']+)["'][^>]*>/g)) sources.add(source);
  }
  for (const file of sources) {
    assert.ok(!file.includes('..') && !/^(?:\w+:|\/)/.test(file), `unsafe/nonlocal resource ${file}`);
    assert.ok(existsSync(resolve(root, file)), `missing UI resource ${file}`);
    assert.ok(required.includes(file) || optional.some(base => file === base || file.startsWith(`${base}/`)), `build does not cover ${file}`);
  }
  for (const file of sharedRuntime) assert.ok(required.includes(file), `${file} must fail the build if missing`);
});

test('E2E runtimes that instantiate the Shadow panel load its local shared design dependency first', () => {
  const wizard = read('tests/e2e/wizard.e2e.mjs');
  const visual = read('tests/e2e/ui-final-polish.e2e.mjs');
  for (const [name, source] of [['wizard', wizard], ['UI visual', visual]]) {
    const designIndex = source.indexOf("'src/ui/design-system.js'");
    const panelIndex = source.indexOf("'src/floating-ui/floating-panel.js'");
    assert.ok(designIndex >= 0 && panelIndex > designIndex, `${name} loads the panel without its design dependency`);
  }
  assert.match(read('tests/e2e/support/production-runtime-loader.mjs'), /parseProductionInjectionFiles\(popupSource\)/);
});

test('Static icon-only buttons have accessible names and shared icons remain decorative local SVG', () => {
  for (const [name, source] of [['Popup', popup], ['Options', options], ['Shadow panel markup', panel]]) {
    for (const [, attributes, body] of source.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)) {
      const visibleText = body.replace(/\$\{icon\([^)]*\)\}/g, '').replace(/<[^>]*>/g, '').replace(/\s+/g, '').trim();
      if (!visibleText) assert.match(attributes, /\baria-(?:label|labelledby)\s*=\s*["'][^"']+["']/, `${name}: unnamed icon button ${attributes}`);
    }
  }
  const usedIcons = new Set([...popup.matchAll(/data-icon="([^"]+)"/g), ...options.matchAll(/data-icon="([^"]+)"/g)].map(match => match[1]));
  for (const name of usedIcons) {
    const icon = UI.icon(name);
    assert.match(icon, /^<svg\b/);
    assert.match(icon, /viewBox="0 0 20 20"/);
    assert.match(icon, /aria-hidden="true"/);
    assert.match(icon, /focusable="false"/);
    assertNoRemoteResources(icon, `icon ${name}`);
    if (name !== 'circle') assert.notEqual(icon, UI.icon('unknown-icon-name'), `${name} falls back to a placeholder`);
  }
});
