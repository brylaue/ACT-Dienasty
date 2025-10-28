/**
 * Common utility functions to reduce redundancy across the codebase
 */

/**
 * Validates and normalizes year parameter
 * @param {number|string} year - The year to validate
 * @param {Object} teamManagers - Team managers object with currentSeason
 * @returns {number} Normalized year
 */
export const normalizeYear = (year, teamManagers) => {
  if (!year || year > teamManagers.currentSeason) {
    return teamManagers.currentSeason;
  }
  return year;
};

/**
 * Safely gets team managers for a specific year
 * @param {Object} teamManagers - Team managers object
 * @param {number} year - The year to get managers for
 * @returns {Object|null} Team managers for the year or null
 */
export const getTeamManagersForYear = (teamManagers, year) => {
  const normalizedYear = normalizeYear(year, teamManagers);
  return teamManagers.teamManagersMap[normalizedYear] || null;
};

/**
 * Safely gets team data for a specific roster and year
 * @param {Object} teamManagers - Team managers object
 * @param {string} rosterID - The roster ID
 * @param {number} year - The year
 * @returns {Object|null} Team data or null
 */
export const getTeamDataForRoster = (teamManagers, rosterID, year) => {
  const yearManagers = getTeamManagersForYear(teamManagers, year);
  if (!yearManagers || !yearManagers[rosterID]) {
    return null;
  }
  return yearManagers[rosterID];
};

/**
 * Creates a standardized fetch function with error handling
 * @param {string} url - The URL to fetch
 * @param {Object} options - Fetch options
 * @returns {Promise<Response>} Fetch response
 */
export const createFetch = (url, options = {}) => {
  const defaultOptions = {
    compress: true,
    ...options
  };
  
  return fetch(url, defaultOptions);
};

/**
 * Creates a standardized API fetch function
 * @param {string} endpoint - The API endpoint
 * @param {string} baseUrl - Base URL (defaults to Sleeper API)
 * @returns {Promise<Response>} Fetch response
 */
export const createApiFetch = (endpoint, baseUrl = 'https://api.sleeper.app/v1') => {
  return createFetch(`${baseUrl}${endpoint}`);
};

/**
 * Safe array access with fallback
 * @param {Array} array - The array to access
 * @param {number} index - The index to access
 * @param {*} fallback - Fallback value if index is out of bounds
 * @returns {*} Array element or fallback
 */
export const safeArrayAccess = (array, index, fallback = null) => {
  if (!Array.isArray(array) || index < 0 || index >= array.length) {
    return fallback;
  }
  return array[index];
};

/**
 * Safe object property access with fallback
 * @param {Object} obj - The object to access
 * @param {string} path - Dot notation path (e.g., 'user.profile.name')
 * @param {*} fallback - Fallback value if path doesn't exist
 * @returns {*} Property value or fallback
 */
export const safeGet = (obj, path, fallback = null) => {
  if (!obj || typeof obj !== 'object') {
    return fallback;
  }
  
  const keys = path.split('.');
  let current = obj;
  
  for (const key of keys) {
    if (current === null || current === undefined || !(key in current)) {
      return fallback;
    }
    current = current[key];
  }
  
  return current;
};

/**
 * Debounce function to limit function calls
 * @param {Function} func - Function to debounce
 * @param {number} wait - Wait time in milliseconds
 * @returns {Function} Debounced function
 */
export const debounce = (func, wait) => {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
};

/**
 * Throttle function to limit function calls
 * @param {Function} func - Function to throttle
 * @param {number} limit - Time limit in milliseconds
 * @returns {Function} Throttled function
 */
export const throttle = (func, limit) => {
  let inThrottle;
  return function executedFunction(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
};