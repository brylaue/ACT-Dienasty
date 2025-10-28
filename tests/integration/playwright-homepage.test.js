import { test, expect } from '@playwright/test';

test.describe('Homepage Integration Tests', () => {
  test('should load the homepage successfully', async ({ page }) => {
    await page.goto('/');
    
    // Check that the page loads without errors
    expect(page.url()).toContain('localhost:5173');
    
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  test('should display the league name', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the league name element (h6 tag)
    const leagueNameElement = page.locator('h6').first();
    await expect(leagueNameElement).toBeVisible();
  });

  test('should show NFL state information', async ({ page }) => {
    await page.goto('/');
    
    // Wait for the NFL state section to load
    const nflStateSection = page.locator('.homeBanner');
    await expect(nflStateSection).toBeVisible();
    
    // Check that it shows either loading state or actual data
    const content = await nflStateSection.textContent();
    expect(content).toMatch(/NFL|Retrieving|Something went wrong/);
  });

  test('should display champion section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the champion section
    const champSection = page.locator('#currentChamp');
    await expect(champSection).toBeVisible();
    
    // Check that it shows either loading state, champion data, or no champs message
    const content = await champSection.textContent();
    expect(content).toMatch(/Retrieving|Fantasy Champ|No former champs|Something went wrong/);
  });

  test('should display transactions section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the transactions section
    const transactionsSection = page.locator('.transactions');
    await expect(transactionsSection).toBeVisible();
  });

  test('should display power rankings section', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the power rankings component (it should be in the main section)
    const mainSection = page.locator('#main');
    await expect(mainSection).toBeVisible();
  });

  test('should handle responsive design', async ({ page }) => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Test mobile viewport
    await page.setViewportSize({ width: 375, height: 667 });
    
    // Check that the layout adapts
    const homeContainer = page.locator('#home');
    await expect(homeContainer).toBeVisible();
    
    // Test desktop viewport
    await page.setViewportSize({ width: 1200, height: 800 });
    await expect(homeContainer).toBeVisible();
  });

  test('should handle errors gracefully', async ({ page }) => {
    // Mock network failures by intercepting requests
    await page.route('**/api/**', route => {
      route.abort('failed');
    });
    
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // The page should still load and show error states
    const pageContent = await page.textContent('body');
    expect(pageContent).toBeTruthy();
  });
});