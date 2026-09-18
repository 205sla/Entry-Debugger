'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const extensionDir = path.join(rootDir, 'dist', 'entry-debugger-extension-release');
const evidenceDir = path.join(rootDir, 'dist', 'live-values-evidence');
const entryUrl = process.env.ENTRY_DEBUGGER_SMOKE_URL ||
  'https://playentry.org/ws/590e746f150c3963bf86078e';
const { chromium } = require(require.resolve('playwright', {
  paths: [rootDir, path.resolve(rootDir, '../../apps/MYentry-game')]
}));
const variableCard = '.ed-var-card[data-id="edSmokeVar30"]';
const listCard = '.ed-list-card[data-id="edSmokeList"]';
const listRow = listCard + ' .ed-list-row:nth-child(25)';
const scrollArea = '#ed-scroll-area';

async function fixture(page) {
  await page.evaluate(() => {
    if (Entry.engine.state !== 'stop') Entry.engine.toggleStop();
    for (let index = 0; index < 45; index++) {
      Entry.variableContainer.addVariable({
        id: 'edSmokeVar' + index, name: 'Live variable ' + index, value: 'initial-' + index,
        visible: false
      });
    }
    Entry.variableContainer.addList({
      id: 'edSmokeList', name: 'Live list', variableType: 'list', visible: false,
      array: Array.from({ length: 60 }, (_, index) => ({ data: 'item-' + index }))
    });
    window.edLiveValuesSmoke = { pulse: 0 };
  });
  if (await page.locator('.tooltipGuide .close').count()) {
    await page.locator('.tooltipGuide .close').click();
  }
  await page.locator('.propertyTabdebugging').click();
  await page.waitForSelector(variableCard);
}

// Use the real Entry models and the extension's 200 ms poll, never fake SNAPSHOT messages.
async function refresh(page, updates = {}) {
  const pulse = await page.evaluate((changes) => {
    const vc = Entry.variableContainer;
    const next = ++window.edLiveValuesSmoke.pulse;
    vc.getVariable('edSmokeVar0').setValue('pulse-' + next);
    if (changes.variable !== undefined) vc.getVariable('edSmokeVar30').setValue(changes.variable);
    if (changes.item !== undefined) vc.getList('edSmokeList').array_[24].data = changes.item;
    if (changes.otherItem !== undefined) vc.getList('edSmokeList').array_[25].data = changes.otherItem;
    return next;
  }, updates);
  await page.waitForFunction((next) =>
    document.querySelector('.ed-var-card[data-id="edSmokeVar0"] .ed-var-display')?.textContent ===
      'pulse-' + next, pulse);
}

async function edit(page, card, inputSelector, displaySelector, draft) {
  await page.locator(card + ' ' + displaySelector).click();
  await page.locator(card + ' ' + inputSelector).fill(draft);
  return page.locator(card + ' ' + inputSelector).evaluate((input) => {
    input.setSelectionRange(2, 7, 'backward');
    window.edLiveValuesSmoke.input = input;
    return {
      value: input.value, start: input.selectionStart, end: input.selectionEnd,
      direction: input.selectionDirection, scroll: document.querySelector('#ed-scroll-area').scrollTop
    };
  });
}

async function readEdit(page, card, inputSelector) {
  return page.locator(card + ' ' + inputSelector).evaluate((input) => ({
    value: input.value, start: input.selectionStart, end: input.selectionEnd,
    direction: input.selectionDirection, scroll: document.querySelector('#ed-scroll-area').scrollTop,
    focused: document.activeElement === input,
    sameNode: window.edLiveValuesSmoke.input === input,
    editing: input.closest('.ed-var-card, .ed-list-row').classList.contains('ed-editing')
  }));
}

function assertEdit(before, after) {
  assert.deepStrictEqual(after, { ...before, focused: true, sameNode: true, editing: true });
}

async function main() {
  fs.mkdirSync(evidenceDir, { recursive: true });
  const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'entry-live-values-'));
  let context;
  const results = [];
  try {
    context = await chromium.launchPersistentContext(profileDir, {
      ...(process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE
        ? { executablePath: process.env.ENTRY_DEBUGGER_CHROMIUM_EXECUTABLE } : {}),
      headless: false,
      viewport: { width: 1440, height: 1000 },
      ignoreDefaultArgs: ['--disable-extensions'],
      args: ['--disable-extensions-except=' + extensionDir, '--load-extension=' + extensionDir]
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(entryUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForSelector('.propertyTabdebugging', { timeout: 60000 });
    await page.waitForFunction(() => window.Entry?.variableContainer?.getVariable);
    await fixture(page);

    async function check(name, run) {
      try {
        const details = await run();
        results.push({ name, passed: true, details });
      } catch (error) {
        results.push({ name, passed: false, error: error.message });
        await page.screenshot({ path: path.join(evidenceDir, name + '-failed.png') });
      }
      console.log(JSON.stringify(results.at(-1)));
    }

    await check('variable-scroll', async () => {
      await page.locator(scrollArea).evaluate((el) => { el.scrollTop = 1200; });
      const before = await page.locator(scrollArea).evaluate((el) => el.scrollTop);
      assert(before > 0, 'fixture must overflow');
      await refresh(page, { variable: 'runtime-1' });
      const after = await page.locator(scrollArea).evaluate((el) => el.scrollTop);
      assert.strictEqual(after, before);
      return { before, after };
    });

    await check('variable-edit-and-apply', async () => {
      const before = await edit(page, variableCard, '.ed-var-input', '.ed-var-display', 'draft-variable');
      for (let index = 0; index < 3; index++) await refresh(page, { variable: 'runtime-' + index });
      const after = await readEdit(page, variableCard, '.ed-var-input');
      assertEdit(before, after);
      await page.screenshot({ path: path.join(evidenceDir, 'variable-edit.png') });
      await page.locator(variableCard + ' .ed-btn-apply').click();
      await page.waitForFunction(() => Entry.variableContainer.getVariable('edSmokeVar30').getValue() === 'draft-variable');
      await page.waitForFunction(() => document.querySelector('.ed-var-card[data-id="edSmokeVar30"] .ed-var-display').textContent === 'draft-variable');
      await refresh(page, { variable: 'after-apply' });
      assert.strictEqual(await page.locator(variableCard + ' .ed-var-display').innerText(), 'after-apply');
      return after;
    });

    await page.locator('.ed-subtab[data-tab="lists"]').click();
    await page.locator(listCard + ' .ed-list-header').click();

    await check('list-scroll', async () => {
      await page.locator(scrollArea).evaluate((el) => { el.scrollTop = 500; });
      const before = await page.locator(scrollArea).evaluate((el) => el.scrollTop);
      assert(before > 0, 'fixture must overflow');
      await refresh(page, { item: 'runtime-item' });
      const after = await page.locator(scrollArea).evaluate((el) => el.scrollTop);
      assert.strictEqual(after, before);
      return { before, after };
    });

    await check('list-edit-and-enter', async () => {
      const before = await edit(page, listRow, '.ed-list-input', '.ed-list-display', 'draft-list-item');
      for (let index = 0; index < 3; index++) {
        await refresh(page, { item: 'runtime-item-' + index, otherItem: 'other-item-' + index });
      }
      const after = await readEdit(page, listRow, '.ed-list-input');
      assertEdit(before, after);
      assert.strictEqual(await page.locator(listCard + ' .ed-list-row:nth-child(26) .ed-list-display').innerText(), 'other-item-2');
      await page.screenshot({ path: path.join(evidenceDir, 'list-edit.png') });
      await page.locator(listRow + ' .ed-list-input').press('Enter');
      await page.waitForFunction(() => Entry.variableContainer.getList('edSmokeList').array_[24].data === 'draft-list-item');
      await refresh(page, { item: 'after-list-apply' });
      assert.strictEqual(await page.locator(listRow + ' .ed-list-display').getAttribute('title'), 'after-list-apply');
      return after;
    });

    await check('list-add-input', async () => {
      const input = page.locator(listCard + ' .ed-list-add-input');
      await input.fill('new-list-item');
      const before = await input.evaluate((el) => {
        el.setSelectionRange(1, 4);
        window.edLiveValuesSmoke.input = el;
        return { scroll: document.querySelector('#ed-scroll-area').scrollTop };
      });
      for (let index = 0; index < 3; index++) await refresh(page, { item: 'runtime-add-' + index });
      const after = await input.evaluate((el) => ({
        value: el.value, start: el.selectionStart, end: el.selectionEnd,
        focused: document.activeElement === el, sameNode: window.edLiveValuesSmoke.input === el,
        scroll: document.querySelector('#ed-scroll-area').scrollTop
      }));
      assert.deepStrictEqual(after, { value: 'new-list-item', start: 1, end: 4, focused: true, sameNode: true, ...before });
      await input.press('Enter');
      await page.waitForFunction(() => Entry.variableContainer.getList('edSmokeList').array_.at(-1).data === 'new-list-item');
      await page.waitForFunction(() => document.querySelectorAll('.ed-list-card[data-id="edSmokeList"] .ed-list-row').length === 61);
      return after;
    });

    await check('list-growth-shrink-and-delete', async () => {
      const before = await edit(page, listRow, '.ed-list-input', '.ed-list-display', 'draft-resize');
      await page.evaluate(() => {
        Entry.variableContainer.getList('edSmokeList').array_.push({ data: 'runtime-tail' });
      });
      await refresh(page, { item: 'runtime-resize' });
      assert.strictEqual(await page.locator(listCard + ' .ed-list-row').count(), 62);
      assertEdit(before, await readEdit(page, listRow, '.ed-list-input'));
      await page.evaluate(() => { Entry.variableContainer.getList('edSmokeList').array_.length = 40; });
      await refresh(page);
      assert.strictEqual(await page.locator(listCard + ' .ed-list-row').count(), 40);
      assertEdit(before, await readEdit(page, listRow, '.ed-list-input'));
      await page.locator(listRow + ' .ed-list-input').press('Escape');
      await refresh(page);
      assert.strictEqual(await page.locator(listRow + ' .ed-list-display').getAttribute('title'), 'runtime-resize');
      // Reused rows must still apply/delete the correct positional index.
      await page.locator(listRow + ' .ed-btn-del').click();
      await page.waitForFunction(() => Entry.variableContainer.getList('edSmokeList').array_.length === 39);
      await page.waitForFunction(() => document.querySelectorAll('.ed-list-card[data-id="edSmokeList"] .ed-list-row').length === 39);
      const value = await page.evaluate(() => Entry.variableContainer.getList('edSmokeList').array_[24].data);
      assert.strictEqual(value, 'other-item-2');
      assert.strictEqual(await page.locator(listRow + ' .ed-list-display').getAttribute('title'), value);
      return { count: 39, value };
    });

    await check('variable-add-remove-and-search', async () => {
      await page.locator('.ed-subtab[data-tab="variables"]').click();
      await edit(page, variableCard, '.ed-var-input', '.ed-var-display', 'draft-structure');
      await page.evaluate(() => Entry.variableContainer.addVariable({
        id: 'edSmokeAdded', name: 'Live added variable', value: 'added', visible: false
      }));
      await refresh(page);
      assert.strictEqual(await page.locator('.ed-var-card[data-id="edSmokeAdded"]').count(), 1);
      await page.evaluate(() => {
        const vc = Entry.variableContainer;
        vc.removeVariable(vc.getVariable('edSmokeAdded'));
      });
      await refresh(page);
      const after = await readEdit(page, variableCard, '.ed-var-input');
      assert(after.focused && after.sameNode && after.editing);
      assert.strictEqual(after.value, 'draft-structure');
      assert.strictEqual(after.start, 2);
      assert.strictEqual(after.end, 7);
      assert.strictEqual(after.direction, 'backward');
      assert.strictEqual(await page.locator('.ed-var-card[data-id="edSmokeAdded"]').count(), 0);
      await page.locator(variableCard + ' .ed-var-input').press('Escape');
      await page.locator('#ed-search').fill('Live variable 30');
      assert.strictEqual(await page.locator('#ed-var-list .ed-var-card').count(), 1);
      await page.locator('#ed-search').fill('edSmokeNoMatch');
      assert.strictEqual(await page.locator('#ed-var-list .ed-var-card').count(), 0);
      assert(await page.locator('#ed-var-empty').isVisible());
      await page.locator('#ed-search').fill('');
      await refresh(page);
      assert.strictEqual(await page.locator(variableCard).count(), 1);
      return { editingSurvived: true, searchRestored: true };
    });

    await check('system-variable-edit', async () => {
      await page.locator('#ed-settings-tab-btn').click();
      await page.locator('label.ed-lab-switch[aria-label="실험실 탭"]').click();
      await page.locator('.ed-subtab[data-tab="others"]').click();
      const card = '.ed-other-card[data-kind="answer"]';
      const before = await edit(page, card, '.ed-var-input', '.ed-var-display', 'draft-answer');
      for (let index = 0; index < 3; index++) {
        await page.evaluate((value) => Entry.container.inputValue.setValue(value), 'answer-' + index);
        await refresh(page);
      }
      const after = await readEdit(page, card, '.ed-var-input');
      assertEdit(before, after);
      await page.locator(card + ' .ed-var-input').press('Enter');
      await page.waitForFunction(() => Entry.container.inputValue.getValue() === 'draft-answer');
      return after;
    });

    fs.writeFileSync(path.join(evidenceDir, 'results.json'), JSON.stringify({ entryUrl, results }, null, 2));
    assert(results.every((result) => result.passed), 'Live value regressions: ' +
      results.filter((result) => !result.passed).map((result) => result.name).join(', '));
  } finally {
    if (context) await context.close();
    const resolvedProfile = path.resolve(profileDir);
    assert.strictEqual(path.dirname(resolvedProfile), path.resolve(os.tmpdir()));
    assert(path.basename(resolvedProfile).startsWith('entry-live-values-'));
    fs.rmSync(resolvedProfile, { recursive: true, force: true, maxRetries: 3 });
  }
}

main().catch((error) => {
  console.error('[smoke-live-values] ' + error.stack);
  process.exitCode = 1;
});
