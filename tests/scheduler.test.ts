import { describe, it, expect, vi, afterEach } from 'vitest';
import { Cron } from 'croner';

describe('scheduler (Croner)', () => {
  const activeCrons: Cron[] = [];

  afterEach(() => {
    for (const cron of activeCrons) {
      cron.stop();
    }
    activeCrons.length = 0;
  });

  it('validates cron expressions', () => {
    // Valid expressions
    expect(() => new Cron('0 9 * * *')).not.toThrow();
    expect(() => new Cron('*/5 * * * *')).not.toThrow();
    expect(() => new Cron('0 0 1 * *')).not.toThrow();

    // Invalid expressions
    expect(() => new Cron('invalid')).toThrow();
    expect(() => new Cron('60 * * * *')).toThrow();
  });

  it('supports timezone configuration', () => {
    const job = new Cron('0 9 * * *', {
      timezone: 'America/Chicago',
      paused: true,
    });
    activeCrons.push(job);
    expect(job).toBeDefined();
    // The job should know its next run based on Chicago time
    const next = job.nextRun();
    expect(next).toBeInstanceOf(Date);
  });

  it('supports pause and resume', () => {
    const fn = vi.fn();
    const job = new Cron('* * * * * *', { paused: true }, fn);
    activeCrons.push(job);

    expect(job.isStopped()).toBe(false);

    // Pause
    job.pause();
    // Resume
    job.resume();
    // Stop
    job.stop();
    expect(job.isStopped()).toBe(true);
  });

  it('catches errors in task callback', async () => {
    const errorHandler = vi.fn();
    const job = new Cron(
      '* * * * * *', // every second
      {
        catch: errorHandler,
        maxRuns: 1,
      },
      () => {
        throw new Error('Task error');
      },
    );
    activeCrons.push(job);

    // Wait for one execution
    await new Promise((resolve) => setTimeout(resolve, 1500));

    expect(errorHandler).toHaveBeenCalled();
    job.stop();
  });

  it('calculates next run date correctly', () => {
    const job = new Cron('0 9 * * 1-5', { paused: true }); // 9 AM weekdays
    activeCrons.push(job);
    const next = job.nextRun();
    expect(next).not.toBeNull();
    if (next) {
      expect(next.getHours()).toBe(9);
      expect(next.getMinutes()).toBe(0);
      const day = next.getDay();
      expect(day).toBeGreaterThanOrEqual(1);
      expect(day).toBeLessThanOrEqual(5);
    }
  });

  it('respects maxRuns', async () => {
    const fn = vi.fn();
    const job = new Cron('* * * * * *', { maxRuns: 2 }, fn);
    activeCrons.push(job);

    await new Promise((resolve) => setTimeout(resolve, 3500));

    expect(fn).toHaveBeenCalledTimes(2);
    job.stop();
  });
});
