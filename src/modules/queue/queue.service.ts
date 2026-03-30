import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import type { FastifyBaseLogger } from "fastify";

import type { MessageJobPayload } from "./types.js";

const QUEUE_NAME = "message-processing";

export type QueueService = {
  addMessage: (payload: MessageJobPayload) => Promise<void>;
  shutdown: () => Promise<void>;
};

function createRedisConnection(redisUrl: string): Redis {
  const useTls = redisUrl.startsWith("rediss://");
  return new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    ...(useTls ? { tls: { rejectUnauthorized: false } } : {}),
  });
}

export function createQueueService(deps: {
  redisUrl: string;
  processor: (payload: MessageJobPayload) => Promise<void>;
  log: FastifyBaseLogger;
}): QueueService {
  const queueConnection = createRedisConnection(deps.redisUrl);
  const workerConnection = createRedisConnection(deps.redisUrl);

  queueConnection.on("error", (err) => {
    deps.log.error({ err }, "redis.queue_connection.error");
  });
  workerConnection.on("error", (err) => {
    deps.log.error({ err }, "redis.worker_connection.error");
  });

  const queue = new Queue<MessageJobPayload>(QUEUE_NAME, { connection: queueConnection });

  const worker = new Worker<MessageJobPayload>(
    QUEUE_NAME,
    async (job) => {
      deps.log.info({ jobId: job.id, chatId: job.data.chatId }, "queue.job.processing");
      await deps.processor(job.data);
      deps.log.info({ jobId: job.id, chatId: job.data.chatId }, "queue.job.completed");
    },
    {
      connection: workerConnection,
      concurrency: 10,
    },
  );

  worker.on("failed", (job, err) => {
    deps.log.error({ jobId: job?.id, err }, "queue.worker.job_failed");
  });

  worker.on("error", (err) => {
    deps.log.error({ err }, "queue.worker.error");
  });

  return {
    async addMessage(payload: MessageJobPayload): Promise<void> {
      await queue.add("process-message", payload, {
        attempts: 2,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: 100,
        removeOnFail: 50,
      });
      deps.log.info({ chatId: payload.chatId }, "queue.message.enqueued");
    },

    async shutdown(): Promise<void> {
      await worker.close();
      await queue.close();
      await queueConnection.quit();
      await workerConnection.quit();
      deps.log.info("queue.shutdown.complete");
    },
  };
}
