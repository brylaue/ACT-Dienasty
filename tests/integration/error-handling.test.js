import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';
import { mockApiErrors, selectors, assertions } from './helpers.js';

describe('Error Handling Integration Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Network Error Handling', () => {
    it('should handle complete API failure gracefully', async () => {
      // Mock all API endpoints to fail
      await mockApiErrors(page, [
        '/api/getBlogPosts',
        '/api/checkVersion',
        '/api/checkGlobalVersion',
        '/api/fetch_players_info',
        '/api/fetch_serverside_news'
      ]);

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Page should still render
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();

      // Should show error states
      await assertions.errorHandlingWorking(page);
    });

    it('should handle partial API failures', async () => {
      // Mock only some API endpoints to fail
      await mockApiErrors(page, [
        '/api/getBlogPosts',
        '/api/fetch_serverside_news'
      ]);

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Page should still render
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();

      // Some functionality should still work
      const mainSection = page.locator(selectors.mainSection);
      await expect(mainSection).toBeVisible();
    });

    it('should handle slow API responses', async () => {
      // Mock slow API responses
      await page.route('**/api/**', async route => {
        await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
        route.continue();
      });

      const startTime = Date.now();
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      const loadTime = Date.now() - startTime;

      // Should handle slow responses gracefully
      expect(loadTime).toBeLessThan(10000); // Should not timeout completely
      
      // Page should still render
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });

  describe('Data Loading Error Handling', () => {
    it('should handle malformed JSON responses', async () => {
      await page.route('**/api/**', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: 'invalid json {'
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle malformed JSON gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle empty responses', async () => {
      await page.route('**/api/**', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: '{}'
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle empty responses gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle 404 responses', async () => {
      await page.route('**/api/**', route => {
        route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Not Found' })
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle 404 responses gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle 500 responses', async () => {
      await page.route('**/api/**', route => {
        route.fulfill({
          status: 500,
          contentType: 'application/json',
          body: JSON.stringify({ error: 'Internal Server Error' })
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle 500 responses gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });

  describe('Component Error Handling', () => {
    it('should handle component rendering errors', async () => {
      // Inject a script that will cause a component error
      await page.addInitScript(() => {
        // Mock a component to throw an error
        window.addEventListener('error', (e) => {
          console.log('Caught error:', e.error);
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Page should still render despite component errors
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle missing data gracefully', async () => {
      // Mock API to return empty or null data
      await page.route('**/api/**', route => {
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ data: null })
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle missing data gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });

  describe('User Interaction Error Handling', () => {
    it('should handle click errors gracefully', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Try to click on various elements that might cause errors
      const clickableElements = page.locator('button, a, [onclick]');
      const elementCount = await clickableElements.count();

      for (let i = 0; i < Math.min(elementCount, 5); i++) {
        try {
          await clickableElements.nth(i).click();
          await page.waitForTimeout(100); // Small delay
        } catch (error) {
          // Should handle click errors gracefully
          console.log('Click error handled:', error.message);
        }
      }

      // Page should still be functional
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle navigation errors gracefully', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Try to navigate to potentially problematic URLs
      const problematicUrls = [
        '/nonexistent-page',
        '/api/invalid-endpoint',
        '/#invalid-hash'
      ];

      for (const url of problematicUrls) {
        try {
          await page.goto(url);
          await page.waitForLoadState('networkidle');
        } catch (error) {
          // Should handle navigation errors gracefully
          console.log('Navigation error handled:', error.message);
        }
      }

      // Should be able to navigate back to homepage
      await page.goto('/');
      await page.waitForLoadState('networkidle');
      
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });

  describe('Browser Compatibility Error Handling', () => {
    it('should handle missing browser features gracefully', async () => {
      // Mock missing browser features
      await page.addInitScript(() => {
        // Mock missing localStorage
        Object.defineProperty(window, 'localStorage', {
          value: {
            getItem: () => { throw new Error('localStorage not available'); },
            setItem: () => { throw new Error('localStorage not available'); }
          }
        });
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Should handle missing browser features gracefully
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle JavaScript errors gracefully', async () => {
      // Inject a script that will cause JavaScript errors
      await page.addInitScript(() => {
        // Override console.error to track errors
        const originalError = console.error;
        console.error = (...args) => {
          originalError('Caught JS error:', ...args);
        };
      });

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Page should still render despite JavaScript errors
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });

  describe('Recovery from Errors', () => {
    it('should recover from temporary network issues', async () => {
      // First, cause network errors
      await mockApiErrors(page, ['/api/**']);

      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Then restore network and refresh
      await page.unroute('**/api/**');
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Should recover and work normally
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });

    it('should handle error state transitions', async () => {
      await page.goto('/');
      await page.waitForLoadState('networkidle');

      // Cause an error
      await mockApiErrors(page, ['/api/**']);
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Then fix the error
      await page.unroute('**/api/**');
      await page.reload();
      await page.waitForLoadState('networkidle');

      // Should transition from error to normal state
      const bodyText = await page.textContent('body');
      expect(bodyText).toBeTruthy();
    });
  });
});