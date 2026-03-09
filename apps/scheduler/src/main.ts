import { logger } from '@alh/observability';
import { registerCronJobs } from './cron-jobs';

async function main() {
  logger.info('Starting scheduler service');

  registerCronJobs();

  logger.info('All cron jobs registered. Scheduler is running.');

  // Keep the process alive
  const shutdown = (signal: string) => {
    logger.info({ signal }, 'Shutting down scheduler');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.fatal({ err }, 'Scheduler failed to start');
  process.exit(1);
});
