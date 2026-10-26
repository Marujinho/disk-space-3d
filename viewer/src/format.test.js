import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { humanBytes, percent, formatInt } from './format.js';

describe('humanBytes', () => {
  it('formats boundaries', () => {
    assert.equal(humanBytes(0), '0 B');
    assert.equal(humanBytes(1023), '1023 B');
    assert.equal(humanBytes(1024), '1.0 KB');
    assert.equal(humanBytes(1.5e9), '1.4 GB');
    assert.equal(humanBytes(2 ** 50 * 3), '3.0 PB');
  });
});

describe('percent', () => {
  it('formats with one decimal and survives a zero total', () => {
    assert.equal(percent(1, 3), '33.3%');
    assert.equal(percent(0, 0), '0%');
    assert.equal(percent(5, 5), '100.0%');
  });
});

describe('formatInt', () => {
  it('groups thousands', () => {
    assert.equal(formatInt(0), '0');
    assert.equal(formatInt(999), '999');
    assert.equal(formatInt(1234567), '1 234 567');
  });
});
