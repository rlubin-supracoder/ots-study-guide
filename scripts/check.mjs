import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { siteFiles } from './site-files.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => readFileSync(resolve(root, name), 'utf8');
for (const name of siteFiles) read(name);
const html = read('index.html');
const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)];
const context = vm.createContext({ window: {} });
let inlineCount = 0;
for (const [, attributes, body] of scripts) {
  const src = attributes.match(/\bsrc="([^"]+)"/i)?.[1];
  if (src) {
    assert(siteFiles.includes(src), `Missing packaged script: ${src}`);
    new vm.Script(read(src), { filename: src }).runInContext(context, { timeout: 1000 });
  } else {
    const script = new vm.Script(body, { filename: `index-inline-${++inlineCount}.js` });
    // Execute bank wiring in its original document order, without a browser DOM.
    if (!body.includes('document.')) script.runInContext(context, { timeout: 1000 });
  }
}
const banks = [
  ['SPINS', 'SPINS_QUESTIONS', 'SPINS_PARTS', 'part', 'n', 511],
  ['Academic MC', 'ACADEMIC_QUESTIONS', 'ACADEMIC_MODULES', 'module', 'title', null],
  ['Final Test Questions', 'SOB_QUESTIONS', 'SOB_MODULES', 'module', 'title', null],
  ['Concept Cards', 'CONCEPT_CARDS', 'CONCEPT_MODULES', 'module', 'title', null],
];
let total = 0;
for (const [name, itemsKey, groupsKey, itemGroup, groupKey, expected] of banks) {
  const items = context.window[itemsKey];
  const groups = context.window[groupsKey];
  assert(items?.length > 0, `${name}: empty question bank`);
  assert(groups?.length > 0, `${name}: empty groups`);
  if (expected !== null) assert.equal(items.length, expected, `${name}: count changed`);
  const groupValues = new Set(groups.map(group => group[groupKey]));
  for (const [i, item] of items.entries()) {
    const label = `${name} question ${i + 1}`;
    assert(item.q?.trim(), `${label}: missing question`);
    assert(groupValues.has(item[itemGroup]), `${label}: unknown group ${item[itemGroup]}`);
    if (item.options) {
      assert(item.options.length >= 2, `${label}: missing choices`);
      assert(item.options.every(option => typeof option === 'string' && option.trim()), `${label}: empty choice`);
      assert(Number.isInteger(item.correct) && item.correct >= 0 && item.correct < item.options.length, `${label}: invalid answer key`);
    } else {
      assert(item.a?.trim(), `${label}: missing answer`);
    }
  }
  total += items.length;
  console.log(`${name}: ${items.length} items across ${groups.length} groups`);
}
assert.notEqual(context.window.ACADEMIC_QUESTIONS, context.window.SOB_QUESTIONS, 'MC banks must remain independent');
assert(html.includes('var GUIDE_URL = "StudyGuide.md"'), 'Study guide must use a relative GitHub Pages path');
assert(read('StudyGuide.md').trim().length > 1000, 'Study guide is incomplete');
assert(!/\b(?:src|href)="\/(?!\/)/i.test(html), 'Root-relative assets break project Pages paths');
console.log(`Checked ${total} study items, script syntax and order, study guide, and GitHub Pages asset paths.`);
