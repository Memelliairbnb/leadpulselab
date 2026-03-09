import IORedis from 'ioredis';

const redisUrl = process.env.REDIS_URL;
if (!redisUrl) {
  throw new Error('REDIS_URL environment variable is required');
}

export const redisConnection = new IORedis(redisUrl, {
  maxRetriesPerRequest: null,
});
