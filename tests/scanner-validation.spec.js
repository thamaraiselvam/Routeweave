const { test, expect } = require('@playwright/test');

const BASE = 'http://localhost:3789';

test.describe('Scanner View', () => {

  test('loads without JS errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(2000);
    expect(errors, `JS errors on load: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('Scanner tab renders stat cards', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    await page.click('.nav-scanner');
    await page.waitForTimeout(1000);
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
    const statCards = page.locator('.scanner-stat-card');
    await expect(statCards.first()).toBeVisible();
    const count = await statCards.count();
    expect(count).toBeGreaterThan(0);
    console.log(`  ✓ ${count} stat cards visible`);
  });

  test('Scanner tab has repo path input and Scan button', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    await page.click('.nav-scanner');
    await page.waitForTimeout(800);
    await expect(page.locator('.scan-path-input')).toBeVisible();
    await expect(page.locator('.btn-scan')).toBeVisible();
    console.log('  ✓ Scan input and button present');
  });

  test('can trigger a scan and see progress + done badge', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(1000);
    await page.click('.nav-scanner');
    await page.waitForTimeout(800);
    await page.locator('.scan-path-input').fill('.');
    await page.locator('.btn-scan').click();
    await page.waitForSelector('.scan-done-badge', { timeout: 30000 });
    expect(errors, `JS errors during scan: ${errors.join(', ')}`).toHaveLength(0);
    await expect(page.locator('.scan-done-badge')).toBeVisible();
    const logCount = await page.locator('.scan-live-log-line').count();
    console.log(`  ✓ Scan done — ${logCount} log lines`);
  });

});

test.describe('Repo Switcher', () => {

  test('project button is visible in topbar when a repo is active', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    // New UI: topbar shows .project-btn instead of old .repo-switcher-btn
    const btn = page.locator('.project-btn');
    await expect(btn).toBeVisible();
    const label = await btn.innerText();
    console.log(`  ✓ Project button label: "${label.trim().replace(/\n/g, ' ')}"`);
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('clicking project button opens Setup Wizard', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.click('.project-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('.setup-backdrop')).toBeVisible();
    const count = await page.locator('.setup-repo-item, .setup-repo-empty').count();
    console.log(`  ✓ Wizard opened — ${count} repo entry/entries visible`);
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('wizard shows existing repos including active one', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.click('.change-project-btn');
    await page.waitForTimeout(400);
    // Select "existing" option (first card)
    const cards = page.locator('.setup-option-card');
    await cards.nth(0).click();
    await page.waitForTimeout(400);
    const items = page.locator('.setup-repo-item');
    const count = await items.count();
    expect(count).toBeGreaterThan(0);
    console.log(`  ✓ Wizard lists ${count} known repo(s)`);
  });

  test('Change Project button in sidebar also opens wizard', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(1500);
    await page.click('.change-project-btn');
    await page.waitForTimeout(400);
    await expect(page.locator('.setup-backdrop')).toBeVisible();
    console.log('  ✓ Change Project sidebar button opens wizard');
  });

});

test.describe('AI Status Banner', () => {

  test('banner appears when repo has parser-only data', async ({ page }) => {
    const errors = [];
    page.on('pageerror', err => errors.push(err.message));
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    // The Routeweave repo itself was scanned with the parser co-engine
    // so it should show parser_only state → banner visible
    const banner = page.locator('.ai-banner');
    await expect(banner).toBeVisible();
    const cls = await banner.getAttribute('class');
    console.log(`  ✓ Banner visible with classes: "${cls}"`);
    expect(errors, `JS errors: ${errors.join(', ')}`).toHaveLength(0);
  });

  test('ai banner shows an actionable command when visible', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    // Banner may be parser-only or prompt-ready depending on dataset state —
    // both variants show a clickable .ai-banner-cmd element.
    const banner = page.locator('.ai-banner');
    await expect(banner).toBeVisible();
    const cmd = banner.locator('.ai-banner-cmd');
    await expect(cmd).toBeVisible();
    const cmdText = await cmd.innerText();
    expect(cmdText.trim().length).toBeGreaterThan(0);
    const cls = await banner.getAttribute('class');
    console.log(`  ✓ Banner (${cls}) shows command: "${cmdText.trim().substring(0, 60)}"`);
  });

  test('banner dismiss button hides the banner', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    await expect(page.locator('.ai-banner')).toBeVisible();
    await page.click('.ai-banner-dismiss');
    await page.waitForTimeout(300);
    await expect(page.locator('.ai-banner')).not.toBeVisible();
    console.log('  ✓ Banner dismissed successfully');
  });

  test('copy button copies command to clipboard', async ({ page }) => {
    // Grant clipboard permissions
    await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);

    await page.goto(BASE);
    await page.waitForTimeout(2000);

    const cmd = page.locator('.ai-banner .ai-banner-cmd');
    await expect(cmd).toBeVisible();
    await cmd.click();
    await page.waitForTimeout(400);

    // Copy-ok indicator should appear
    const copyOk = page.locator('.ai-banner .copy-ok');
    await expect(copyOk).toBeVisible();
    const okText = await copyOk.innerText();
    console.log(`  ✓ Copy feedback shown: "${okText}"`);
  });

  test('banner re-appears after switching to repo with parser-only data', async ({ page }) => {
    await page.goto(BASE);
    await page.waitForTimeout(2000);

    // Dismiss banner
    await page.click('.ai-banner-dismiss');
    await page.waitForTimeout(300);
    await expect(page.locator('.ai-banner')).not.toBeVisible();

    // Trigger a scan (same repo) — should re-show banner since it's still parser-only
    await page.click('.nav-scanner');
    await page.waitForTimeout(800);
    await page.locator('.scan-path-input').fill('.');
    await page.locator('.btn-scan').click();
    await page.waitForSelector('.scan-done-badge', { timeout: 30000 });
    await page.waitForTimeout(800);

    // Banner should reappear (dismiss is reset on scan complete)
    await expect(page.locator('.ai-banner')).toBeVisible();
    console.log('  ✓ Banner reappears after new scan');
  });

});
