const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3789';

/**
 * Helper: navigate to the app and wait for React to boot.
 * If the wizard is already showing it will be visible immediately;
 * if not, the main dashboard will be visible.
 */
async function gotoApp(page) {
  await page.goto(BASE);
  await page.waitForTimeout(1500);
}

/**
 * Helper: open the wizard via the Change Project button in the icon sidebar.
 */
async function openWizardViaButton(page) {
  await gotoApp(page);
  await page.click('.change-project-btn');
  await page.waitForTimeout(400);
}

// ─── Setup Wizard presence ─────────────────────────────────────────────────

test.describe('Setup Wizard — initial load', () => {

  test('no JS errors on load', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await gotoApp(page);
    expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('Change Project button is visible in icon sidebar', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await gotoApp(page);
    await expect(page.locator('.change-project-btn')).toBeVisible();
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
    console.log('  ✓ Change Project button present in sidebar');
  });

  test('repo-switcher-btn is no longer in topbar', async ({ page }) => {
    await gotoApp(page);
    // The old topbar dropdown button should be gone
    await expect(page.locator('.repo-switcher-btn')).toHaveCount(0);
    console.log('  ✓ repo-switcher-btn removed from topbar');
  });

});

// ─── Wizard opens / closes ────────────────────────────────────────────────

test.describe('Setup Wizard — open & close', () => {

  test('wizard opens when Change Project button is clicked', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await openWizardViaButton(page);
    await expect(page.locator('.setup-backdrop')).toBeVisible();
    await expect(page.locator('.setup-card')).toBeVisible();
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
    console.log('  ✓ Wizard backdrop and card visible');
  });

  test('wizard shows step indicator with 3 steps', async ({ page }) => {
    await openWizardViaButton(page);
    const steps = page.locator('.setup-step-item');
    await expect(steps.first()).toBeVisible();
    const count = await steps.count();
    expect(count).toBe(3);
    console.log(`  ✓ Step indicator shows ${count} steps`);
  });

});

// ─── Step 1: Choose Project ───────────────────────────────────────────────

test.describe('Setup Wizard — Step 1', () => {

  test('Step 1 shows both option cards', async ({ page }) => {
    await openWizardViaButton(page);
    const cards = page.locator('.setup-option-card');
    await expect(cards.first()).toBeVisible();
    const count = await cards.count();
    expect(count).toBe(2);
    console.log(`  ✓ ${count} option cards rendered (existing / new)`);
  });

  test('Step 1 has a path input and Browse button in new-repo mode', async ({ page }) => {
    await openWizardViaButton(page);
    // Click "New directory" option card
    const cards = page.locator('.setup-option-card');
    // Second card = "New directory"
    await cards.nth(1).click();
    await page.waitForTimeout(300);
    await expect(page.locator('.setup-path-input-row input')).toBeVisible();
    await expect(page.locator('.setup-browse-btn')).toBeVisible();
    console.log('  ✓ Path input and Browse button visible in new-repo mode');
  });

  test('Continue button is disabled without a path entered', async ({ page }) => {
    await openWizardViaButton(page);
    // Click "New directory" card
    const cards = page.locator('.setup-option-card');
    await cards.nth(1).click();
    await page.waitForTimeout(300);
    const nextBtn = page.locator('.setup-next-btn');
    await expect(nextBtn).toBeVisible();
    const isDisabled = await nextBtn.evaluate(el => el.disabled);
    expect(isDisabled).toBe(true);
    console.log('  ✓ Continue button disabled when no path entered');
  });

  test('Continue button enables after entering a valid path', async ({ page }) => {
    await openWizardViaButton(page);
    const cards = page.locator('.setup-option-card');
    await cards.nth(1).click();
    await page.waitForTimeout(300);
    await page.locator('.setup-path-input-row input').fill('/tmp');
    await page.waitForTimeout(400);
    const nextBtn = page.locator('.setup-next-btn');
    const isDisabled = await nextBtn.evaluate(el => el.disabled);
    expect(isDisabled).toBe(false);
    console.log('  ✓ Continue button enabled after path entered');
  });

  test('existing repos list is visible when existing option is selected', async ({ page }) => {
    await openWizardViaButton(page);
    // First card = "Existing repo"
    const cards = page.locator('.setup-option-card');
    await cards.nth(0).click();
    await page.waitForTimeout(400);
    // Either a repo list or an empty-state message should appear
    const listOrEmpty = page.locator('.setup-repo-list, .setup-repo-empty');
    await expect(listOrEmpty.first()).toBeVisible();
    console.log('  ✓ Existing repo list area visible');
  });

});

// ─── Step 1 → Step 2 transition ──────────────────────────────────────────

test.describe('Setup Wizard — Step 1 → Step 2', () => {

  test('clicking Continue on existing repo navigates to Step 2', async ({ page }) => {
    await openWizardViaButton(page);
    // Click existing repo card
    const cards = page.locator('.setup-option-card');
    await cards.nth(0).click();
    await page.waitForTimeout(400);

    // Pick first available repo item (if any)
    const repoItems = page.locator('.setup-repo-item');
    const repoCount = await repoItems.count();
    if (repoCount > 0) {
      await repoItems.first().click();
      await page.waitForTimeout(300);
    }

    const nextBtn = page.locator('.setup-next-btn');
    const isDisabled = await nextBtn.evaluate(el => el.disabled);
    if (!isDisabled) {
      await nextBtn.click();
      await page.waitForTimeout(500);
      // Should now be on Step 2 — pipeline visible
      await expect(page.locator('.setup-pipeline')).toBeVisible();
      console.log('  ✓ Navigated to Step 2 via existing repo');
    } else {
      console.log('  ⚠ No repos available to select — skipping transition check');
    }
  });

});

// ─── Repo Switcher (updated tests) ───────────────────────────────────────

test.describe('Repo Switcher (via wizard)', () => {

  test('active project button is visible in topbar when repo loaded', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await gotoApp(page);
    // project-btn is rendered only when activeRepoPath is set
    const btn = page.locator('.project-btn');
    const count = await btn.count();
    if (count > 0) {
      await expect(btn).toBeVisible();
      const label = await btn.innerText();
      console.log(`  ✓ Project button visible with label: "${label.trim()}"`);
    } else {
      console.log('  ℹ No active repo — project-btn not rendered (expected on first run)');
    }
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('clicking project-btn in topbar opens the wizard', async ({ page }) => {
    await gotoApp(page);
    const btn = page.locator('.project-btn');
    const count = await btn.count();
    if (count > 0) {
      await btn.click();
      await page.waitForTimeout(400);
      await expect(page.locator('.setup-backdrop')).toBeVisible();
      console.log('  ✓ Clicking project-btn opens wizard');
    } else {
      console.log('  ℹ No project-btn rendered (no active repo) — skipping');
    }
  });

});
