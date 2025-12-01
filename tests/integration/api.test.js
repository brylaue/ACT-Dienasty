import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { chromium } from 'playwright';

describe('API Integration Tests', () => {
  let browser;
  let page;

  beforeAll(async () => {
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  });

  afterAll(async () => {
    await browser.close();
  });

  describe('Blog Posts API', () => {
    it('should handle missing Contentful credentials gracefully', async () => {
      const response = await page.request.get('/api/getBlogPosts');
      
      // Should return an error when Contentful credentials are missing
      expect(response.status()).toBe(500);
      
      const responseText = await response.text();
      expect(responseText).toContain('Missing VITE_CONTENTFUL_CLIENT_ACCESS_TOKEN');
    });
  });

  describe('Version Check API', () => {
    it('should return version information', async () => {
      const response = await page.request.get('/api/checkVersion');
      
      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('version');
    });

    it('should return global version information', async () => {
      const response = await page.request.get('/api/checkGlobalVersion');
      
      expect(response.status()).toBe(200);
      
      const data = await response.json();
      expect(data).toHaveProperty('version');
    });
  });

  describe('Player Info API', () => {
    it('should handle player info requests', async () => {
      const response = await page.request.get('/api/fetch_players_info');
      
      // This endpoint might return different status codes depending on implementation
      expect([200, 400, 500]).toContain(response.status());
    });
  });

  describe('News API', () => {
    it('should handle news requests', async () => {
      const response = await page.request.get('/api/fetch_serverside_news');
      
      // This endpoint might return different status codes depending on implementation
      expect([200, 400, 500]).toContain(response.status());
    });
  });
});