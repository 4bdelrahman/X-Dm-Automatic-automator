const Bull = require('bull');

// Redis connection is automatically provided by Railway Redis plugin
// The REDIS_URL env var is set automatically
const createQueue = (name) => {
  const queue = new Bull(name, {
    redis: process.env.REDIS_URL,
    defaultJobOptions: {
      attempts: 2,
      backoff: {
        type: 'exponential',
        delay: 5000,
      },
      removeOnComplete: 100, // Keep last 100 completed jobs
      removeOnFail: 50,      // Keep last 50 failed jobs
    },
  });

  queue.on('error', (error) => {
    console.error(`[Queue] ${name} error:`, error.message);
  });

  queue.on('waiting', (jobId) => {
    console.log(`[Queue] Job ${jobId} is waiting`);
  });

  queue.on('active', (job) => {
    console.log(`[Queue] Job ${job.id} is now active`);
  });

  queue.on('completed', (job) => {
    console.log(`[Queue] Job ${job.id} completed`);
  });

  queue.on('failed', (job, err) => {
    console.error(`[Queue] Job ${job.id} failed:`, err.message);
  });

  return queue;
};

module.exports = { createQueue };
