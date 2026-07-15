import { describe, expect, it } from 'vitest';
import { ActionSubmissionStore } from './ActionSubmissionStore.js';

describe('ActionSubmissionStore', () => {
  it('allows cancel and replacement before everyone submits', () => {
    const store = new ActionSubmissionStore();
    expect(store.submit('a', { actionId: 'charge' })).toBe(true);
    expect(store.allSubmitted(['a', 'b'])).toBe(false);
    expect(store.cancel('a')).toBe(true);
    expect(store.submit('a', { actionId: 'defend' })).toBe(true);
    expect(store.asReadonlyMap().get('a')?.actionId).toBe('defend');
  });

  it('detects the final submission and rejects replacement without cancel', () => {
    const store = new ActionSubmissionStore();
    store.submit('a', { actionId: 'charge' });
    expect(store.submit('a', { actionId: 'wave', targetId: 'b' })).toBe(false);
    store.submit('b', { actionId: 'defend' });
    expect(store.allSubmitted(['a', 'b'])).toBe(true);
    store.clear();
    expect(store.allSubmitted(['a', 'b'])).toBe(false);
  });

  it('fills deferred targets without replacing the submitted action', () => {
    const store = new ActionSubmissionStore();
    store.submit('a', { actionId: 'stardust', power: 3 });
    expect(store.setTargets('a', ['b', 'b', 'c'])).toBe(true);
    expect(store.get('a')).toEqual({ actionId: 'stardust', power: 3, targetIds: ['b', 'b', 'c'], targetId: undefined });
  });
});
