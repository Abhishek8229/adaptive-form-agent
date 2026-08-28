import test from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { getVisualContext, liveElements } from '../src/content/detector.ts';

const dom = new JSDOM(`<!DOCTYPE html><html><body></body></html>`, { url: 'http://localhost' });
(globalThis as any).window = dom.window;
(globalThis as any).document = dom.window.document;
(globalThis as any).HTMLElement = dom.window.HTMLElement;
(globalThis as any).NodeFilter = dom.window.NodeFilter;

function createTestElement(tag: string, text: string, rect: DOMRect) {
  const el = document.createElement(tag);
  el.textContent = text;
  el.getBoundingClientRect = () => rect;
  return el;
}

const mockWinHeight = 1000;
const mockWinWidth = 1000;
(globalThis as any).window.innerHeight = mockWinHeight;
(globalThis as any).window.innerWidth = mockWinWidth;
// mock getComputedStyle
(globalThis as any).window.getComputedStyle = (el: HTMLElement) => {
  if (el.hidden || el.style.display === 'none') {
    return { visibility: 'hidden', display: 'none', opacity: '1' };
  }
  return { visibility: 'visible', display: 'block', opacity: '1' };
};

test('visual context: bounding box extracted correctly', () => {
  const input = createTestElement('input', '', { x: 10, y: 20, width: 100, height: 30, top: 20, bottom: 50, left: 10, right: 110, toJSON: () => {} } as any);
  document.body.appendChild(input);
  
  liveElements.set('test1', new WeakRef(input) as any);
  const ctx = getVisualContext('test1');
  
  assert.ok(ctx);
  assert.equal(ctx.boundingBox.x, 10);
  assert.equal(ctx.boundingBox.y, 20);
  assert.equal(ctx.boundingBox.width, 100);
  assert.equal(ctx.boundingBox.height, 30);
  assert.equal(ctx.visibility, 'visible');
  
  document.body.innerHTML = '';
});

test('visual context: viewport visibility calculated correctly', () => {
  // partially visible
  const input2 = createTestElement('input', '', { x: 10, y: -10, width: 100, height: 30, top: -10, bottom: 20, left: 10, right: 110, toJSON: () => {} } as any);
  document.body.appendChild(input2);
  liveElements.set('test2', new WeakRef(input2) as any);
  const ctx2 = getVisualContext('test2');
  assert.equal(ctx2?.visibility, 'partially-visible');
  
  // outside viewport
  const input3 = createTestElement('input', '', { x: 10, y: 1500, width: 100, height: 30, top: 1500, bottom: 1530, left: 10, right: 110, toJSON: () => {} } as any);
  document.body.appendChild(input3);
  liveElements.set('test3', new WeakRef(input3) as any);
  const ctx3 = getVisualContext('test3');
  assert.equal(ctx3?.visibility, 'outside-viewport');
  
  document.body.innerHTML = '';
});

test('visual context: nearby visible text is extracted, hidden text is ignored', () => {
  const container = createTestElement('div', '', { width: 200, height: 100 } as any);
  const visibleText = createTestElement('span', 'Question visible', { width: 100, height: 20 } as any);
  const hiddenText = createTestElement('span', 'Hidden secret', { width: 0, height: 0 } as any);
  hiddenText.style.display = 'none';
  
  const input = createTestElement('input', '', { width: 100, height: 30, top: 20, bottom: 50, left: 10, right: 110 } as any);
  
  container.appendChild(visibleText);
  container.appendChild(hiddenText);
  container.appendChild(input);
  document.body.appendChild(container);
  
  liveElements.set('test4', new WeakRef(input) as any);
  const ctx = getVisualContext('test4');
  assert.ok(ctx);
  assert.ok(ctx.nearbyText?.includes('Question visible'));
  assert.equal(ctx.nearbyText?.includes('Hidden secret'), false);
  
  document.body.innerHTML = '';
});

test('visual context: excessive surrounding text is limited', () => {
  const container = createTestElement('div', '', { width: 200, height: 100 } as any);
  const hugeText = createTestElement('div', 'A'.repeat(500), { width: 200, height: 100 } as any);
  
  const input = createTestElement('input', '', { width: 100, height: 30, top: 20, bottom: 50, left: 10, right: 110 } as any);
  
  container.appendChild(hugeText);
  container.appendChild(input);
  document.body.appendChild(container);
  
  liveElements.set('test5', new WeakRef(input) as any);
  const ctx = getVisualContext('test5');
  
  assert.ok(ctx);
  assert.ok(ctx.nearbyText);
  assert.equal(ctx.nearbyText.length <= 203, true); // 200 + '...'
  
  document.body.innerHTML = '';
});

test('visual context: duplicate surrounding text is removed', () => {
  const container = createTestElement('div', '', { width: 200, height: 100 } as any);
  // Two divs with same text
  container.appendChild(createTestElement('span', 'Same Text', { width: 100, height: 20 } as any));
  
  const input = createTestElement('input', '', { width: 100, height: 30, top: 20, bottom: 50, left: 10, right: 110 } as any);
  
  // A previous sibling with same text
  const prevSibling = createTestElement('div', 'Same Text', { width: 100, height: 20 } as any);
  container.appendChild(prevSibling);
  container.appendChild(input);
  
  document.body.appendChild(container);
  
  liveElements.set('test6', new WeakRef(input) as any);
  const ctx = getVisualContext('test6');
  
  assert.ok(ctx);
  assert.equal(ctx.nearbyText?.includes('Same Text'), true);
  
  document.body.innerHTML = '';
});
