# Integration Tests

This directory contains integration tests for the League Page SvelteKit application. These tests use Playwright to perform end-to-end testing of the application's functionality.

## Test Structure

- `api.test.js` - Tests for API endpoints and server-side functionality
- `homepage.test.js` - Tests for the homepage component and data loading
- `navigation.test.js` - Tests for navigation between different pages
- `components.test.js` - Tests for component interactions and state management
- `sveltekit.test.js` - SvelteKit-specific functionality tests
- `error-handling.test.js` - Tests for error handling and fallback states
- `helpers.js` - Common utilities and helpers for integration tests

## Running Tests

### Prerequisites

Make sure you have installed all dependencies:

```bash
npm install
```

### Run All Integration Tests

```bash
npm run test:integration
```

### Run Integration Tests with UI

```bash
npm run test:integration:ui
```

### Debug Integration Tests

```bash
npm run test:integration:debug
```

### Run All Tests (Unit + Integration)

```bash
npm run test:all
```

## Test Configuration

The tests are configured in `playwright.config.js` in the project root. Key configuration:

- **Test Directory**: `./tests/integration`
- **Base URL**: `http://localhost:5173` (development server)
- **Browsers**: Chromium, Firefox, WebKit
- **Auto-start dev server**: Tests automatically start the dev server before running

## Test Categories

### 1. API Integration Tests (`api.test.js`)
- Tests all API endpoints (`/api/getBlogPosts`, `/api/checkVersion`, etc.)
- Verifies proper error handling for missing credentials
- Tests response formats and status codes

### 2. Homepage Integration Tests (`homepage.test.js`)
- Tests homepage loading and rendering
- Verifies NFL state display
- Tests champion section functionality
- Checks responsive design behavior

### 3. Navigation Tests (`navigation.test.js`)
- Tests navigation between all major pages
- Verifies client-side routing
- Tests back navigation functionality

### 4. Component Integration Tests (`components.test.js`)
- Tests component interactions and state management
- Verifies loading states and error handling
- Tests responsive behavior
- Checks accessibility features

### 5. SvelteKit Integration Tests (`sveltekit.test.js`)
- Tests SvelteKit-specific functionality
- Verifies page rendering and data loading
- Tests error boundaries and recovery
- Checks performance and accessibility

### 6. Error Handling Tests (`error-handling.test.js`)
- Comprehensive error scenario testing
- Network failure handling
- Data loading error handling
- Component error handling
- Browser compatibility error handling

## Writing New Tests

### Basic Test Structure

```javascript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('Your Test Suite', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  it('should do something', async () => {
    await page.goto('/');
    await page.waitForLoadState('networkidle');
    
    // Your test assertions here
    expect(await page.textContent('body')).toBeTruthy();
  });
});
```

### Using Helpers

The `helpers.js` file provides common utilities:

```javascript
import { mockApiErrors, selectors, assertions } from './helpers.js';

// Mock API errors
await mockApiErrors(page, ['/api/some-endpoint']);

// Use common selectors
const nav = page.locator(selectors.nav);

// Use common assertions
await assertions.elementVisibleWithContent(page, selectors.mainSection);
```

## Best Practices

1. **Always clean up**: Use `beforeAll` and `afterAll` to manage browser instances
2. **Wait for loading**: Use `page.waitForLoadState('networkidle')` to ensure data is loaded
3. **Test error scenarios**: Include tests for network failures and error states
4. **Use descriptive test names**: Make it clear what each test is verifying
5. **Mock external dependencies**: Use Playwright's route mocking for API calls
6. **Test responsive design**: Test both mobile and desktop viewports
7. **Verify accessibility**: Check for proper heading structure and alt text

## Debugging Tests

### View Test Results
- Run with `--ui` flag to see visual test results
- Check the HTML report generated in `playwright-report/`

### Debug Individual Tests
- Use `--debug` flag to step through tests
- Add `await page.pause()` in your test to pause execution

### Common Issues
- **Timeout errors**: Increase timeout in test configuration
- **Element not found**: Use `page.waitForSelector()` or check if element exists
- **Network errors**: Ensure dev server is running and accessible

## CI/CD Integration

These tests are designed to run in CI environments:

- Tests run in headless mode by default
- Automatic dev server startup
- Proper cleanup of browser instances
- Exit codes for pass/fail status

## Maintenance

- Update tests when adding new features
- Keep selectors in `helpers.js` up to date
- Add new error scenarios as they're discovered
- Regularly review and update test data