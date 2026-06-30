const PREFIX = 'projektgedaechtnis:';

export const storage = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(PREFIX + key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      console.warn('Storage get failed', error);
      return fallback;
    }
  },
  set(key, value) {
    localStorage.setItem(PREFIX + key, JSON.stringify(value));
  },
  remove(key) {
    localStorage.removeItem(PREFIX + key);
  },
  clearAll() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => localStorage.removeItem(key));
  },
  exportAll() {
    const data = {};
    Object.keys(localStorage)
      .filter((key) => key.startsWith(PREFIX))
      .forEach((key) => {
        data[key.replace(PREFIX, '')] = JSON.parse(localStorage.getItem(key));
      });
    return data;
  },
  importAll(data) {
    Object.entries(data || {}).forEach(([key, value]) => this.set(key, value));
  }
};
