#!/usr/bin/env node
import { Cron } from 'croner';
import { initDatabase, createTask, getActiveTasks, getTasksForChat } from './db.js';
import { updateTaskStatus } from './db.js';

// Initialize DB
initDatabase();

const [, , command, ...args] = process.argv;

function usage() {
  console.log(`
ClaudeClaw Schedule CLI

Usage:
  schedule-cli create <chat_id> <cron_expr> <timezone> <prompt>
  schedule-cli list [chat_id]
  schedule-cli delete <task_id>
  schedule-cli pause <task_id>
  schedule-cli resume <task_id>

Examples:
  schedule-cli create 12345 "0 9 * * *" "America/Chicago" "Good morning summary"
  schedule-cli list
  schedule-cli delete 3
  `);
}

switch (command) {
  case 'create': {
    const [chatId, cronExpr, timezone, ...promptParts] = args;
    const prompt = promptParts.join(' ');

    if (!chatId || !cronExpr || !timezone || !prompt) {
      console.error('Missing arguments for create');
      usage();
      process.exit(1);
    }

    // Validate cron expression
    try {
      new Cron(cronExpr);
    } catch (err) {
      console.error(`Invalid cron expression: ${cronExpr}`);
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    }

    const id = createTask(chatId, prompt, cronExpr, timezone);
    console.log(`Created task #${id}`);
    break;
  }

  case 'list': {
    const chatId = args[0];
    const tasks = chatId ? getTasksForChat(chatId) : getActiveTasks();
    if (tasks.length === 0) {
      console.log('No tasks found.');
    } else {
      for (const t of tasks) {
        console.log(`#${t.id} [${t.status}] chat=${t.chat_id} cron="${t.schedule}" tz=${t.timezone}`);
        console.log(`  prompt: ${t.prompt.slice(0, 100)}`);
        if (t.last_run) console.log(`  last_run: ${new Date(t.last_run * 1000).toISOString()}`);
        console.log();
      }
    }
    break;
  }

  case 'delete': {
    const id = parseInt(args[0]);
    if (isNaN(id)) {
      console.error('Invalid task ID');
      process.exit(1);
    }
    updateTaskStatus(id, 'deleted');
    console.log(`Task #${id} deleted`);
    break;
  }

  case 'pause': {
    const id = parseInt(args[0]);
    if (isNaN(id)) {
      console.error('Invalid task ID');
      process.exit(1);
    }
    updateTaskStatus(id, 'paused');
    console.log(`Task #${id} paused`);
    break;
  }

  case 'resume': {
    const id = parseInt(args[0]);
    if (isNaN(id)) {
      console.error('Invalid task ID');
      process.exit(1);
    }
    updateTaskStatus(id, 'active');
    console.log(`Task #${id} resumed`);
    break;
  }

  default:
    usage();
    break;
}
