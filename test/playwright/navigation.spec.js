// Playwright smoke tests for navigation and job creation routing
import { test, expect } from '@playwright/test';

// Helpers
const jobsUrlPart = '#/jobs';
const dashboardUrlPart = '#/dashboard';

async function login(page, baseURL) {
  await page.goto(baseURL || 'http://localhost:9998');
  await page.getByRole('textbox', { name: 'Username' }).fill('admin');
  await page.getByRole('textbox', { name: 'Password' }).fill('admin');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(/#\/(dashboard|jobs)/);
}

test.describe('Navigation', () => {
  test.beforeEach(async ({ page, baseURL }) => {
    await login(page, baseURL);
  });

  test('can go to Jobs via nav and back to Dashboard', async ({ page }) => {
    const menu = page.getByRole('menu');

    // Navigate to Jobs
    await menu.getByText('Jobs', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${jobsUrlPart}$`));

    // Navigate to Dashboard
    await menu.getByText('Dashboard', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${dashboardUrlPart}$`));
  });

  test('can open New Job form from Jobs page', async ({ page }) => {
    const menu = page.getByRole('menu');
    // Go to Jobs
    await menu.getByText('Jobs', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${jobsUrlPart}$`));

    // Click New Job button
    const newJobButton = page.getByRole('button', { name: /New Job/i });
    await newJobButton.click();
    const heading = page.locator('.app__content > h3');
    await expect(page).toHaveURL(new RegExp('#/jobs/new$'));
    await expect(heading).toHaveText('Create new Job');
  });

  test('can open Jobs list form from New Job page', async ({ page }) => {
    const menu = page.getByRole('menu');
    // Go to Jobs
    await menu.getByText('Jobs', { exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${jobsUrlPart}$`));

    // Click New Job button
    const newJobButton = page.getByRole('button', { name: /New Job/i });
    await newJobButton.click();
    const heading = page.locator('.app__content > h3');
    await expect(heading).toHaveText('Create new Job');

    // Navigate back via nav; confirm discard in modal
    await page.getByRole('menuitem', { name: 'Jobs' }).click();

    // First, wait for either navigation or modal
    const dontSave = page.getByRole('button', { name: /Don't Save/i });
    const navigationPromise = page.waitForURL(new RegExp(`${jobsUrlPart}$`), { timeout: 3000 }).catch(() => null);
    await expect(dontSave).toBeVisible({ timeout: 10000 });
    await dontSave.click();
    const navigated = await navigationPromise;
    expect(navigated).not.toBeNull();
    await page.waitForURL(new RegExp(`${jobsUrlPart}$`));
    await expect(page).toHaveURL(new RegExp(`${jobsUrlPart}$`));
    await expect(newJobButton).toBeVisible();
  });
});
