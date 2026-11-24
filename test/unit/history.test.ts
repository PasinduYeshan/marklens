import { describe, expect, it } from 'vitest';
import { NavigationHistory } from '../../src/shared/history';

describe('NavigationHistory', () => {
  it('goes back and forward like a browser', () => {
    const h = new NavigationHistory();
    h.push('a');
    h.updatePosition(10, 5);
    h.push('b');
    expect(h.canBack).toBe(true);
    expect(h.back()).toMatchObject({ uri: 'a', line: 10, offset: 5 });
    expect(h.canForward).toBe(true);
    expect(h.forward()?.uri).toBe('b');
    expect(h.forward()).toBeUndefined();
  });

  it('drops forward entries when a new location is opened', () => {
    const h = new NavigationHistory();
    h.push('a');
    h.push('b');
    h.back();
    h.push('c');
    expect(h.canForward).toBe(false);
    expect(h.snapshot().entries.map((e) => e.uri)).toEqual(['a', 'c']);
  });

  it('replaces the current entry without adding history', () => {
    const h = new NavigationHistory();
    h.push('a');
    h.replace('b');
    expect(h.canBack).toBe(false);
    expect(h.current?.uri).toBe('b');
  });

  it('round-trips through a snapshot and tolerates bad input', () => {
    const h = new NavigationHistory();
    h.push('a');
    h.push('b', 'frag');
    const copy = NavigationHistory.from(h.snapshot());
    expect(copy.current).toMatchObject({ uri: 'b', fragment: 'frag' });
    expect(NavigationHistory.from({ entries: [], index: 3 }).current).toBeUndefined();
    expect(NavigationHistory.from({ entries: [{ uri: 'x', line: 0, offset: 0 }], index: 99 }).current?.uri).toBe('x');
  });

  it('keeps at most 100 entries', () => {
    const h = new NavigationHistory();
    for (let i = 0; i < 150; i++) h.push(String(i));
    expect(h.snapshot().entries.length).toBe(100);
    expect(h.current?.uri).toBe('149');
  });
});
