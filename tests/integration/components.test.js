import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('Component Integration Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Champion Section Interactions', () => {
    it('should be clickable when champion data is available', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for champion section
      const champSection = page.locator('#champ');
      
      if (await champSection.isVisible()) {
        // Check if it's clickable (has onclick handler)
        const isClickable = await champSection.evaluate(el => el.onclick !== null);
        
        if (isClickable) {
          // Click on champion
          await champSection.click();
          await page.waitForLoadState('networkidle');
          
          // Should navigate to manager page
          expect(page.url()).toContain('manager');
        }
      }
    });

    it('should display champion team name when available', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for champion label
      const champLabel = page.locator('.label');
      
      if (await champLabel.isVisible()) {
        const labelText = await champLabel.textContent();
        expect(labelText).toBeTruthy();
        expect(labelText.trim().length).toBeGreaterThan(0);
      }
    });
  });

  describe('Transactions Component', () => {
    it('should load transactions data', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for transactions section
      const transactionsSection = page.locator('.transactions');
      await expect(transactionsSection).toBeVisible();
      
      // Check if transactions content is loaded
      const transactionsContent = await transactionsSection.textContent();
      expect(transactionsContent).toBeTruthy();
    });
  });

  describe('Power Rankings Component', () => {
    it('should load power rankings data', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for power rankings in main section
      const mainSection = page.locator('#main');
      await expect(mainSection).toBeVisible();
      
      // Power rankings should be rendered within the main section
      const mainContent = await mainSection.textContent();
      expect(mainContent).toBeTruthy();
    });
  });

  describe('Loading States', () => {
    it('should show loading indicators during data fetch', async () => {
      await page.goto('/');
      
      // Look for loading indicators
      const loadingElements = page.locator('text=Retrieving, text=Loading, .linear-progress');
      
      // At least one loading indicator should be visible initially
      const loadingCount = await loadingElements.count();
      expect(loadingCount).toBeGreaterThan(0);
    });

    it('should hide loading indicators after data loads', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Wait a bit more for all async operations to complete
      await page.waitForTimeout(2000);
      
      // Loading indicators should be hidden
      const loadingElements = page.locator('text=Retrieving, text=Loading');
      const visibleLoadingCount = await loadingElements.filter({ hasText: /Retrieving|Loading/ }).count();
      expect(visibleLoadingCount).toBe(0);
    });
  });

  describe('Error Handling', () => {
    it('should display error messages when data fails to load', async () => {
      // Mock network failures
      await page.route('**/api/**', route => {
        route.abort('failed');
      });
      
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for error messages
      const errorElements = page.locator('text=Something went wrong, text=Error');
      const errorCount = await errorElements.count();
      
      // Should show at least one error message
      expect(errorCount).toBeGreaterThan(0);
    });
  });

  describe('Responsive Behavior', () => {
    it('should adapt layout on mobile screens', async () => {
      await page.setViewportSize({ width: 375, height: 667 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Check that the layout adapts
      const homeContainer = page.locator('#home');
      await expect(homeContainer).toBeVisible();
      
      // On mobile, the league data section should take full width
      const leagueDataSection = page.locator('.leagueData');
      const styles = await leagueDataSection.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          maxWidth: computed.maxWidth,
          minWidth: computed.minWidth,
          width: computed.width
        };
      });
      
      expect(styles.maxWidth).toBe('100%');
    });

    it('should adapt layout on desktop screens', async () => {
      await page.setViewportSize({ width: 1200, height: 800 });
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Check that the layout adapts
      const homeContainer = page.locator('#home');
      await expect(homeContainer).toBeVisible();
      
      // On desktop, the league data section should have fixed width
      const leagueDataSection = page.locator('.leagueData');
      const styles = await leagueDataSection.evaluate(el => {
        const computed = window.getComputedStyle(el);
        return {
          maxWidth: computed.maxWidth,
          minWidth: computed.minWidth
        };
      });
      
      expect(styles.maxWidth).toBe('470px');
      expect(styles.minWidth).toBe('470px');
    });
  });

  describe('Footer Component', () => {
    it('should display footer', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      // Look for footer
      const footer = page.locator('footer, [role="contentinfo"]').first();
      await expect(footer).toBeVisible();
    });
  });
});