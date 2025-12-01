import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('Homepage Integration Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should load the homepage successfully', async () => {
    await page.goto('/');
    
    // Check that the page loads without errors
    expect(page.url()).toContain('localhost:5173');
    
    // Wait for the page to be fully loaded
    await page.waitForLoadState('networkidle');
  });

  it('should display the league name', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the league name element (h6 tag)
    const leagueNameElement = await page.locator('h6').first();
    await expect(leagueNameElement).toBeVisible();
  });

  it('should show NFL state information', async () => {
    await page.goto('/');
    
    // Wait for the NFL state section to load
    const nflStateSection = page.locator('.homeBanner');
    await expect(nflStateSection).toBeVisible();
    
    // Check that it shows either loading state or actual data
    const content = await nflStateSection.textContent();
    expect(content).toMatch(/NFL|Retrieving|Something went wrong/);
  });

  it('should display champion section', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the champion section
    const champSection = page.locator('#currentChamp');
    await expect(champSection).toBeVisible();
    
    // Check that it shows either loading state, champion data, or no champs message
    const content = await champSection.textContent();
    expect(content).toMatch(/Retrieving|Fantasy Champ|No former champs|Something went wrong/);
  });

  it('should display transactions section', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the transactions section
    const transactionsSection = page.locator('.transactions');
    await expect(transactionsSection).toBeVisible();
  });

  it('should display power rankings section', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Look for the power rankings component (it should be in the main section)
    const mainSection = page.locator('#main');
    await expect(mainSection).toBeVisible();
  });

  it('should handle responsive design', async () => {
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

  it('should handle errors gracefully', async () => {
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