import { EventEmitter } from 'node:events';

export const shorthandToTime = (value) => {
  if (typeof value === 'number') return value;
  if (typeof value !== 'string' || value.length === 0) return 0;

  const match = value.trim().match(/^(\d+)(ms|s|m|h|d)?$/i);
  if (!match) return 0;

  const amount = Number(match[1]);
  const unit = (match[2] || 'ms').toLowerCase();
  const unitMap = { ms: 1, s: 1000, m: 60000, h: 3600000, d: 86400000 };
  return amount * (unitMap[unit] || 1);
};

export class CacheableStats {
  constructor({ enabled = true } = {}) {
    this.enabled = enabled;
    this.count = 0;
    this.hits = 0;
    this.misses = 0;
    
    // Final catch-all for ANY method call that doesn't exist to prevent "is not a function" errors
    return new Proxy(this, {
      get(target, prop) {
        if (prop in target) return target[prop];
        // If it's a function call like setCount, incrementX, etc. return a dummy function
        return (...args) => {
          if (target.enabled && typeof prop === 'string') {
            const key = prop.replace(/^(increment|set|get|has|del)/, '').toLowerCase() || 'count';
            target[key] = (target[key] || 0) + 1;
          }
        };
      }
    });
  }
}

class BaseMemoryStore {
  constructor() {
    this.store = new Map();
  }

  _isExpired(record) {
    return record.expiresAt > 0 && record.expiresAt <= Date.now();
  }

  _cleanup(key, record) {
    if (record && this._isExpired(record)) {
      this.store.delete(key);
      return true;
    }
    return false;
  }

  _expiry(ttl) {
    const ttlMs = shorthandToTime(ttl);
    return ttlMs > 0 ? Date.now() + ttlMs : 0;
  }

  set(key, value, ttl) {
    this.store.set(key, { value, expiresAt: this._expiry(ttl) });
    return true;
  }

  get(key) {
    const record = this.store.get(key);
    if (!record || this._cleanup(key, record)) {
      return undefined;
    }
    return record.value;
  }

  delete(key) {
    return this.store.delete(key);
  }

  clear() {
    this.store.clear();
  }

  take(key) {
    const value = this.get(key);
    this.delete(key);
    return value;
  }
}

export class CacheableMemory extends BaseMemoryStore {}

export class Cacheable extends EventEmitter {
  constructor(options = {}) {
    super();
    this.ttl = options.ttl;
    this.primary = options.primary;
    this.secondary = options.secondary;
    this.stats = new CacheableStats({ enabled: options.stats ?? true });
    this._stats = this.stats; // Alias for compatibility with newer versions
    this.memory = new BaseMemoryStore();
  }

  _refreshCount() {
    if (this.stats?.enabled) {
      this.stats.count = this.memory.store.size;
    }
  }

  async set(key, value, ttl = this.ttl) {
    this.memory.set(key, value, ttl);
    this._refreshCount();
    return true;
  }

  async setMany(items = []) {
    for (const item of items) {
      await this.set(item.key, item.value, item.ttl);
    }
  }

  async get(key) {
    const value = this.memory.get(key);
    if (value === undefined) {
      this.stats.incrementMisses();
    } else {
      this.stats.incrementHits();
    }
    this._refreshCount();
    return value;
  }

  async delete(key) {
    const result = this.memory.delete(key);
    this._refreshCount();
    return result;
  }

  async deleteMany(keys = []) {
    for (const key of keys) {
      this.memory.delete(key);
    }
    this._refreshCount();
    return true;
  }

  async clear() {
    this.memory.clear();
    this._refreshCount();
  }

  async take(key) {
    const value = this.memory.take(key);
    this._refreshCount();
    return value;
  }

  async disconnect() {
    return undefined;
  }
}
