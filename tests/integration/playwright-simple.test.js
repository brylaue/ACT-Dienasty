import { test, expect } from '@playwright/test';

test.describe('Simple Integration Tests', () => {
  test('should have Playwright working correctly', async ({ page }) => {
    await page.goto('data:text/html,<html><body><h1>Test</h1></body></html>');
    const heading = await page.textContent('h1');
    expect(heading).toBe('Test');
  });

  test('should be able to handle async operations', async ({ page }) => {
    await page.goto('data:text/html,<div id="async-test">Loading...</div>');
    
    // Simulate async operation
    await page.evaluate(() => {
      setTimeout(() => {
        document.getElementById('async-test').textContent = 'Loaded!';
      }, 100);
    });

    // Wait for the async operation to complete
    await page.waitForFunction(() => {
      return document.getElementById('async-test').textContent === 'Loaded!';
    });

    const content = await page.textContent('#async-test');
    expect(content).toBe('Loaded!');
  });

  test('should be able to interact with DOM elements', async ({ page }) => {
    await page.goto('data:text/html,<button id="test-btn">Click me</button><div id="result"></div>');
    
    // Click the button
    await page.click('#test-btn');
    
    // Verify the click worked
    const button = page.locator('#test-btn');
    await expect(button).toBeVisible();
  });

  test('should be able to evaluate JavaScript', async ({ page }) => {
    await page.goto('data:text/html,<div id="test">Hello</div>');
    
    const result = await page.evaluate(() => {
      return document.getElementById('test').textContent;
    });
    
    expect(result).toBe('Hello');
  });
});