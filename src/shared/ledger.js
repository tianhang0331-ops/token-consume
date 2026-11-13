'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const { computeCostCny, safeNumber } = require('./pricing');

const SCHEMA_VERSION = 1;
const DEFAULT_MAX_EVENTS = 20000;

function pad2(value) {
  return String(value).padStart(2, '0');
}

function localDateKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function localMonthKey(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function isSameDay(left, right) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function isSameMonth(left, right) {
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth();
}

function normalizeEvent(raw) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const createdAt = toDate(source.ts || source.createdAt || Date.now());

  const inputTokens = Math.round(safeNumber(source.inputTokens ?? source.promptTokens));
  const outputTokens = Math.round(safeNumber(source.outputTokens ?? source.completionTokens));
  const cacheReadTokens = Math.round(safeNumber(source.cacheReadTokens));
  const cacheWriteTokens = Math.round(safeNumber(source.cacheWriteTokens));
  const explicitTotal = Math.round(safeNumber(source.totalTokens));
  const totalTokens = explicitTotal || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens;

  const providerId = String(source.providerId || 'deepseek');
  const model = String(source.model || '');

  const costCny = Number.isFinite(Number(source.costCny))
    ? Math.max(0, Number(source.costCny))
    : computeCostCny({ providerId, model, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens });

  return {
    id: String(source.id || crypto.randomUUID()),
    ts: createdAt.toISOString(),
    providerId,
    model: model || 'unknown',
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens,
    costCny,
    estimated: Boolean(source.estimated),
    source: ['proxy', 'platform', 'manual'].includes(source.source) ? source.source : 'proxy'
  };
}

function emptyBucket() {
  return {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 0,
    costCny: 0,
    estimatedCount: 0
  };
}

function addToBucket(bucket, event) {
  bucket.requests += 1;
  bucket.inputTokens += event.inputTokens;
  bucket.outputTokens += event.outputTokens;
  bucket.cacheReadTokens += event.cacheReadTokens;
  bucket.cacheWriteTokens += event.cacheWriteTokens;
  bucket.totalTokens += event.totalTokens;
  bucket.costCny += event.costCny;
  if (event.estimated) bucket.estimatedCount += 1;
}

function sumEvents(events) {
  const bucket = emptyBucket();
  const models = new Map();

  for (const event of events) {
    addToBucket(bucket, event);
    const key = event.model || 'unknown';
    if (!models.has(key)) {
      models.set(key, { model: key, requests: 0, totalTokens: 0, costCny: 0 });
    }
    const item = models.get(key);
    item.requests += 1;
    item.totalTokens += event.totalTokens;
    item.costCny += event.costCny;
  }

  bucket.costCny = Math.round(bucket.costCny * 1e6) / 1e6;
  for (const item of models.values()) {
    item.costCny = Math.round(item.costCny * 1e6) / 1e6;
  }

  bucket.models = [...models.values()].sort(
    (left, right) => right.costCny - left.costCny || right.totalTokens - left.totalTokens
  );

  return bucket;
}

function coerceEvent(event) {
  const inputTokens = Math.round(safeNumber(event.inputTokens));
  const outputTokens = Math.round(safeNumber(event.outputTokens));
  const cacheReadTokens = Math.round(safeNumber(event.cacheReadTokens));
  const cacheWriteTokens = Math.round(safeNumber(event.cacheWriteTokens));
  const explicitTotal = Math.round(safeNumber(event.totalTokens));

  return {
    ...event,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: explicitTotal || inputTokens + outputTokens + cacheReadTokens + cacheWriteTokens,
    costCny: Number.isFinite(Number(event.costCny))
      ? Math.max(0, Number(event.costCny))
      : computeCostCny({
          providerId: event.providerId,
          model: event.model,
          inputTokens,
          outputTokens,
          cacheReadTokens,
          cacheWriteTokens
        })
  };
}

/**
 * Build the renderer snapshot from raw ledger events.
 * Exported separately so it can be unit tested without touching the disk.
 */
function summarize(rawEvents, now = new Date()) {
  const events = (rawEvents || [])
    .filter((event) => event && Number.isFinite(new Date(event.ts).getTime()))
    .map(coerceEvent)
    .sort((left, right) => new Date(left.ts) - new Date(right.ts));

  const todayEvents = [];
  const monthEvents = [];
  const hourly = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${pad2(hour)}:00`,
    totalTokens: 0,
    costCny: 0,
    requests: 0
  }));
  const dayBuckets = new Map();

  for (let offset = 6; offset >= 0; offset -= 1) {
    const day = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
    dayBuckets.set(localDateKey(day), {
      dateKey: localDateKey(day),
      label: `${pad2(day.getMonth() + 1)}-${pad2(day.getDate())}`,
      totalTokens: 0,
      costCny: 0,
      requests: 0
    });
  }

  for (const event of events) {
    const date = toDate(event.ts);
    if (isSameMonth(date, now)) monthEvents.push(event);

    if (isSameDay(date, now)) {
      todayEvents.push(event);
      hourly[date.getHours()].totalTokens += event.totalTokens;
      hourly[date.getHours()].costCny += event.costCny;
      hourly[date.getHours()].requests += 1;
    }

    const key = localDateKey(date);
    const bucket = dayBuckets.get(key);
    if (bucket) {
      bucket.totalTokens += event.totalTokens;
      bucket.costCny += event.costCny;
      bucket.requests += 1;
    }
  }

  const today = sumEvents(todayEvents);
  const month = sumEvents(monthEvents);

  today.dateKey = localDateKey(now);
  month.monthKey = localMonthKey(now);

  for (const bucket of hourly) {
    bucket.costCny = Math.round(bucket.costCny * 1e6) / 1e6;
  }

  const last7Days = [...dayBuckets.values()].map((bucket) => ({
    ...bucket,
    costCny: Math.round(bucket.costCny * 1e6) / 1e6
  }));

  return {
    generatedAt: new Date().toISOString(),
    today,
    month,
    hourly,
    last7Days,
    totals: {
      events: events.length,
      firstEventAt: events.length ? events[0].ts : null,
      lastEventAt: events.length ? events[events.length - 1].ts : null
    }
  };
}

class Ledger {
  constructor({ filePath, maxEvents = DEFAULT_MAX_EVENTS }) {
    if (!filePath) throw new Error('Ledger requires a filePath');
    this.filePath = filePath;
    this.maxEvents = maxEvents;
    this.events = [];
    this.writeChain = Promise.resolve();
    this.loaded = false;
  }

  async load() {
    if (this.loaded) return this;
    try {
      const raw = await fs.readFile(this.filePath, 'utf8');
      const parsed = JSON.parse(raw);
      const list = Array.isArray(parsed) ? parsed : parsed.events;
      this.events = (Array.isArray(list) ? list : []).map(normalizeEvent).slice(-this.maxEvents);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        // Keep the broken file for inspection instead of silently deleting it.
        const backup = `${this.filePath}.broken-${Date.now()}`;
        await fs.rename(this.filePath, backup).catch(() => {});
      }
      this.events = [];
    }
    this.loaded = true;
    return this;
  }

  async add(rawEvent) {
    await this.load();
    const event = normalizeEvent(rawEvent);
    this.events.push(event);
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }
    await this.persist();
    return event;
  }

  async reset(scope = 'all') {
    await this.load();
    if (scope === 'today') {
      const now = new Date();
      this.events = this.events.filter((event) => !isSameDay(toDate(event.ts), now));
    } else if (scope === 'all') {
      this.events = [];
    } else {
      throw new Error(`Unknown reset scope: ${scope}`);
    }
    await this.persist();
    return this.snapshot();
  }

  snapshot(now = new Date()) {
    return summarize(this.events, now);
  }

  persist() {
    const payload = {
      version: SCHEMA_VERSION,
      updatedAt: new Date().toISOString(),
      events: this.events
    };
    const json = JSON.stringify(payload);
    this.writeChain = this.writeChain
      .catch(() => {})
      .then(async () => {
        await fs.mkdir(path.dirname(this.filePath), { recursive: true });
        const tempPath = `${this.filePath}.tmp`;
        await fs.writeFile(tempPath, json, 'utf8');
        await fs.rename(tempPath, this.filePath);
      });
    return this.writeChain;
  }
}

module.exports = {
  Ledger,
  localDateKey,
  normalizeEvent,
  summarize
};
