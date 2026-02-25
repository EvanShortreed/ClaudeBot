import { Cron } from 'croner';
import { getActiveTasks, updateTaskRun, updateTaskStatus } from './db.js';
import { createLogger } from './logger.js';
import type { ScheduledTask } from './types.js';

const log = createLogger('scheduler');

type SendFn = (chatId: string, text: string) => Promise<void>;

const activeCrons = new Map<number, Cron>();

/**
 * Initialize the scheduler by loading all active tasks from DB and creating Cron instances.
 */
export function initScheduler(sendFn: SendFn, runTaskFn?: (prompt: string) => Promise<string>): void {
  const tasks = getActiveTasks();
  log.info({ count: tasks.length }, 'Loading scheduled tasks');

  for (const task of tasks) {
    scheduleTask(task, sendFn, runTaskFn);
  }
}

/**
 * Schedule a single task.
 */
export function scheduleTask(
  task: ScheduledTask,
  sendFn: SendFn,
  runTaskFn?: (prompt: string) => Promise<string>,
): void {
  if (activeCrons.has(task.id)) {
    activeCrons.get(task.id)!.stop();
  }

  try {
    const job = new Cron(
      task.schedule,
      {
        timezone: task.timezone,
        name: `task-${task.id}`,
        catch: (err) => {
          log.error({ err, taskId: task.id }, 'Scheduled task error');
        },
      },
      async () => {
        log.info({ taskId: task.id, prompt: task.prompt.slice(0, 50) }, 'Task fired');

        try {
          let result: string;
          if (runTaskFn) {
            result = await runTaskFn(task.prompt);
          } else {
            result = `[Scheduled] ${task.prompt}`;
          }

          updateTaskRun(task.id, result.slice(0, 1000));
          await sendFn(task.chat_id, `⏰ <b>Scheduled Task #${task.id}</b>\n\n${result}`);
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          updateTaskRun(task.id, `ERROR: ${errMsg}`);
          await sendFn(task.chat_id, `⏰ Task #${task.id} failed: ${errMsg}`).catch(() => {});
          log.error({ err, taskId: task.id }, 'Task execution failed');
        }
      },
    );

    activeCrons.set(task.id, job);
    log.debug({ taskId: task.id, schedule: task.schedule, tz: task.timezone }, 'Task scheduled');
  } catch (err) {
    log.error({ err, taskId: task.id, schedule: task.schedule }, 'Failed to schedule task');
  }
}

/**
 * Pause a scheduled task.
 */
export function pauseTask(taskId: number): boolean {
  const cron = activeCrons.get(taskId);
  if (cron) {
    cron.pause();
    updateTaskStatus(taskId, 'paused');
    log.info({ taskId }, 'Task paused');
    return true;
  }
  return false;
}

/**
 * Resume a paused task.
 */
export function resumeTask(taskId: number): boolean {
  const cron = activeCrons.get(taskId);
  if (cron) {
    cron.resume();
    updateTaskStatus(taskId, 'active');
    log.info({ taskId }, 'Task resumed');
    return true;
  }
  return false;
}

/**
 * Delete (stop) a scheduled task.
 */
export function deleteTask(taskId: number): boolean {
  const cron = activeCrons.get(taskId);
  if (cron) {
    cron.stop();
    activeCrons.delete(taskId);
  }
  updateTaskStatus(taskId, 'deleted');
  log.info({ taskId }, 'Task deleted');
  return true;
}

/**
 * Stop all scheduled tasks (for shutdown).
 */
export function stopAllTasks(): void {
  for (const [id, cron] of activeCrons) {
    cron.stop();
    log.debug({ taskId: id }, 'Task stopped');
  }
  activeCrons.clear();
}
