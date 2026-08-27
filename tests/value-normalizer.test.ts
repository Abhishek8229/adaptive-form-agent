import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeDate,
  normalizeTime,
  normalizeNumber,
  normalizeTelephone,
  normalizeUrl
} from '../src/background/value-normalizer.js';

test('normalizeDate', () => {
  assert.equal(normalizeDate('1998-08-15'), '1998-08-15');
  assert.equal(normalizeDate('15 August 1998'), '1998-08-15');
  assert.equal(normalizeDate('15 Aug 1998'), '1998-08-15');
  assert.equal(normalizeDate('15/08/1998'), '1998-08-15');
  assert.equal(normalizeDate('08/15/1998'), '1998-08-15');
  assert.equal(normalizeDate('1998/08/15'), '1998-08-15');
  assert.equal(normalizeDate('05/06/2020'), null, 'Ambiguous DD/MM vs MM/DD should be null');
  assert.equal(normalizeDate('not a date'), null);
});

test('normalizeTime', () => {
  assert.equal(normalizeTime('14:30'), '14:30');
  assert.equal(normalizeTime('02:30'), '02:30');
  assert.equal(normalizeTime('2:30 PM'), '14:30');
  assert.equal(normalizeTime('2:30 am'), '02:30');
  assert.equal(normalizeTime('2 PM'), '14:00');
  assert.equal(normalizeTime('12:00 PM'), '12:00');
  assert.equal(normalizeTime('12:00 AM'), '00:00');
  assert.equal(normalizeTime('12 PM'), '12:00');
  assert.equal(normalizeTime('25:00'), null);
  assert.equal(normalizeTime('not a time'), null);
});

test('normalizeNumber', () => {
  assert.equal(normalizeNumber('75000'), '75000');
  assert.equal(normalizeNumber('75,000'), '75000');
  assert.equal(normalizeNumber(' 75000 '), '75000');
  assert.equal(normalizeNumber('$75,000'), '75000');
  assert.equal(normalizeNumber('€ 1,234.56'), '1234.56');
  assert.equal(normalizeNumber('-123.45'), '-123.45');
  assert.equal(normalizeNumber('75,000 xyz'), null);
});

test('normalizeTelephone', () => {
  assert.equal(normalizeTelephone('+91 98765 43210'), '+919876543210');
  assert.equal(normalizeTelephone('98765-43210'), '9876543210');
  assert.equal(normalizeTelephone('(555) 123-4567'), '5551234567');
  assert.equal(normalizeTelephone('123'), null, 'Too short');
});

test('normalizeUrl', () => {
  assert.equal(normalizeUrl('github.com/Abhishek8229'), 'https://github.com/Abhishek8229');
  assert.equal(normalizeUrl('www.example.com'), 'https://www.example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizeUrl('not a url'), null);
});
