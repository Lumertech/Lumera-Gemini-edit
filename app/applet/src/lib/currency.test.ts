import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { formatINR, formatINRInt } from './currency.ts';

describe('Lumera INR currency formatter', () => {
  it('formats amounts using Indian grouping and INR symbol', () => {
    const formatted = formatINR(123456.78);
    assert.match(formatted, /₹/);
    assert.match(formatted, /1,23,456\.78/);
  });

  it('formats integer amounts correctly', () => {
    const formatted = formatINRInt(5000);
    assert.match(formatted, /₹/);
    assert.match(formatted, /5,000/);
  });

  it('handles zero and invalid inputs gracefully', () => {
    assert.equal(formatINR(0), '₹0.00');
    assert.equal(formatINR(undefined), '₹0.00');
  });
});
