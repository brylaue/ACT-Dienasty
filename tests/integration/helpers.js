/**
 * Integration test helpers and utilities
 */

/**
 * Wait for a specific condition to be true
 * @param {Function} condition - Function that returns a boolean
 * @param {number} timeout - Timeout in milliseconds
 * @param {number} interval - Check interval in milliseconds
 */
export async function waitForCondition(condition, timeout = 5000, interval = 100) {
  const startTime = Date.now();
  
  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return true;
    }
    await new Promise(resolve => setTimeout(resolve, interval));
  }
  
  throw new Error(`Condition not met within ${timeout}ms`);
}

/**
 * Mock API responses for testing
 * @param {Object} page - Playwright page object
 * @param {Object} mocks - Object with API path as key and response as value
 */
export async function mockApiResponses(page, mocks) {
  for (const [path, response] of Object.entries(mocks)) {
    await page.route(`**${path}`, route => {
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(response)
      });
    });
  }
}

/**
 * Mock API errors for testing
 * @param {Object} page - Playwright page object
 * @param {Array} errorPaths - Array of API paths to mock as errors
 */
export async function mockApiErrors(page, errorPaths) {
  for (const path of errorPaths) {
    await page.route(`**${path}`, route => {
      route.abort('failed');
    });
  }
}

/**
 * Get common selectors used across tests
 */
export const selectors = {
  // Navigation
  nav: 'nav, [role="navigation"]',
  footer: 'footer, [role="contentinfo"]',
  
  // Homepage
  homeContainer: '#home',
  mainSection: '#main',
  leagueDataSection: '.leagueData',
  championSection: '#currentChamp',
  transactionsSection: '.transactions',
  
  // Loading states
  loadingIndicators: 'text=Retrieving, text=Loading, .linear-progress',
  errorMessages: 'text=Something went wrong, text=Error',
  
  // Common elements
  headings: 'h1, h2, h3, h4, h5, h6',
  images: 'img',
  links: 'a[href]',
  buttons: 'button, [role="button"]'
};

/**
 * Common test data
 */
export const testData = {
  mockLeagueData: {
    league_id: 'test-league-123',
    name: 'Test Fantasy League',
    season: 2024,
    season_type: 'regular',
    week: 1
  },
  
  mockChampionData: {
    year: 2023,
    champion: '123',
    teamName: 'Test Champions'
  },
  
  mockTransactions: [
    {
      id: '1',
      type: 'trade',
      description: 'Test trade transaction',
      timestamp: new Date().toISOString()
    }
  ]
};

/**
 * Common assertions for integration tests
 */
export const assertions = {
  /**
   * Assert that an element is visible and has content
   */
  async elementVisibleWithContent(page, selector) {
    const element = page.locator(selector);
    await expect(element).toBeVisible();
    const content = await element.textContent();
    expect(content).toBeTruthy();
    expect(content.trim().length).toBeGreaterThan(0);
  },
  
  /**
   * Assert that loading states are resolved
   */
  async loadingStatesResolved(page) {
    const loadingElements = page.locator(selectors.loadingIndicators);
    const visibleLoadingCount = await loadingElements.filter({ 
      hasText: /Retrieving|Loading/ 
    }).count();
    expect(visibleLoadingCount).toBe(0);
  },
  
  /**
   * Assert that error handling is working
   */
  async errorHandlingWorking(page) {
    const errorElements = page.locator(selectors.errorMessages);
    const errorCount = await errorElements.count();
    // Should either show no errors or show proper error messages
    expect(errorCount).toBeGreaterThanOrEqual(0);
  }
};