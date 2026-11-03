const axios = require('axios');
const { config } = require('./config');

class AzuraCastClient {
  constructor() {
    this.baseUrl = config.azuracast.baseUrl;
    this.apiKey = config.azuracast.apiKey;
    this.cachedStations = null;
    this.lastStationsFetch = 0;
    this.cacheTTL = 30 * 1000; // 30 seconds
  }

  getHeaders() {
    const headers = {
      'User-Agent': 'Discord-AzuraCast-Bot/1.0',
      'Accept': 'application/json'
    };
    if (this.apiKey) {
      headers['X-API-Key'] = this.apiKey;
    }
    return headers;
  }

  /**
   * Fetch all stations from AzuraCast
   * @param {boolean} forceRefresh 
   * @returns {Promise<Array>}
   */
  async getStations(forceRefresh = false) {
    const now = Date.now();
    if (!forceRefresh && this.cachedStations && (now - this.lastStationsFetch < this.cacheTTL)) {
      return this.cachedStations;
    }

    try {
      const response = await axios.get(`${this.baseUrl}/api/stations`, {
        headers: this.getHeaders(),
        timeout: 8000,
      });

      this.cachedStations = response.data;
      this.lastStationsFetch = now;
      return this.cachedStations;
    } catch (err) {
      console.error(`[AzuraCast] Failed to fetch stations: ${err.message}`);
      if (this.cachedStations) {
        return this.cachedStations; // Fallback to stale cache
      }
      throw err;
    }
  }

  /**
   * Find a station by shortcode, ID, or case-insensitive name
   * @param {string|number} query 
   * @returns {Promise<Object|null>}
   */
  async findStation(query) {
    if (!query) return null;
    const stations = await this.getStations();
    const q = String(query).trim().toLowerCase();

    // 1. Exact match by shortcode
    let match = stations.find(s => s.shortcode && s.shortcode.toLowerCase() === q);
    if (match) return match;

    // 2. Exact match by ID
    match = stations.find(s => String(s.id) === q);
    if (match) return match;

    // 3. Exact match by name
    match = stations.find(s => s.name && s.name.toLowerCase() === q);
    if (match) return match;

    // 4. Partial / contains match by name
    match = stations.find(s => s.name && s.name.toLowerCase().includes(q));
    if (match) return match;

    // 5. Partial match by shortcode
    match = stations.find(s => s.shortcode && s.shortcode.toLowerCase().includes(q));
    return match || null;
  }

  /**
   * Get the primary audio stream URL for a station
   * @param {Object} station 
   * @returns {string}
   */
  getStreamUrl(station) {
    if (!station) return null;

    // Direct listen_url from AzuraCast station object
    if (station.listen_url) {
      return station.listen_url;
    }

    // Check default mount
    if (Array.isArray(station.mounts) && station.mounts.length > 0) {
      const defaultMount = station.mounts.find(m => m.is_default) || station.mounts[0];
      if (defaultMount.url) return defaultMount.url;
    }

    // Fallback: standard AzuraCast public listen endpoint format
    return `${this.baseUrl}/listen/${station.shortcode}/radio.mp3`;
  }

  /**
   * Fetch now-playing data for all stations or a specific station
   * @param {string|number} [stationIdOrShortcode]
   * @returns {Promise<Object|Array>}
   */
  async getNowPlaying(stationIdOrShortcode = null) {
    try {
      const url = stationIdOrShortcode
        ? `${this.baseUrl}/api/nowplaying/${stationIdOrShortcode}`
        : `${this.baseUrl}/api/nowplaying`;

      const response = await axios.get(url, {
        headers: this.getHeaders(),
        timeout: 6000,
      });

      return response.data;
    } catch (err) {
      console.error(`[AzuraCast] Failed to fetch now playing info: ${err.message}`);
      return null;
    }
  }
}

module.exports = new AzuraCastClient();
