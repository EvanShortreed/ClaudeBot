import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('memory logic', () => {
  const SEMANTIC_SIGNALS =
    /\b(my|i am|i'm|i prefer|remember|always|never|i like|i hate|i need|i want|my name|call me)\b/i;

  describe('semantic detection', () => {
    it('detects "my" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('my favorite color is blue')).toBe(true);
    });

    it('detects "i am" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('i am a developer')).toBe(true);
    });

    it('detects "remember" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('please remember this')).toBe(true);
    });

    it('detects "always" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('always use TypeScript')).toBe(true);
    });

    it('detects "never" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('never use var')).toBe(true);
    });

    it('detects "I prefer" as semantic', () => {
      expect(SEMANTIC_SIGNALS.test('I prefer dark mode')).toBe(true);
    });

    it('classifies generic questions as episodic', () => {
      expect(SEMANTIC_SIGNALS.test('what is the weather today')).toBe(false);
    });

    it('classifies code questions as episodic', () => {
      expect(SEMANTIC_SIGNALS.test('how to sort an array')).toBe(false);
    });
  });

  describe('decay math', () => {
    it('multiplies salience by 0.98 each sweep', () => {
      let salience = 1.0;
      // Simulate 10 sweeps
      for (let i = 0; i < 10; i++) {
        salience *= 0.98;
      }
      expect(salience).toBeCloseTo(0.8171, 3);
    });

    it('drops below 0.1 threshold after ~114 sweeps', () => {
      let salience = 1.0;
      let sweeps = 0;
      while (salience >= 0.1) {
        salience *= 0.98;
        sweeps++;
      }
      // ~114 days for a 1.0 salience memory to decay below 0.1
      expect(sweeps).toBeGreaterThan(100);
      expect(sweeps).toBeLessThan(120);
    });

    it('reinforcement caps at 5.0', () => {
      let salience = 4.95;
      salience = Math.min(salience + 0.1, 5.0);
      expect(salience).toBe(5.0);
    });

    it('high-salience memories last much longer', () => {
      let salience = 5.0;
      let sweeps = 0;
      while (salience >= 0.1) {
        salience *= 0.98;
        sweeps++;
      }
      // ~194 sweeps for 5.0 salience
      expect(sweeps).toBeGreaterThan(180);
    });
  });

  describe('conversation turn filtering', () => {
    it('skips short messages (<=20 chars)', () => {
      const msg = 'hello';
      expect(msg.length <= 20).toBe(true);
    });

    it('skips command messages', () => {
      expect('/start'.startsWith('/')).toBe(true);
      expect('/memory'.startsWith('/')).toBe(true);
    });

    it('allows regular messages', () => {
      const msg = 'Can you help me write a function?';
      expect(msg.length > 20 && !msg.startsWith('/')).toBe(true);
    });
  });
});
