import { NodePgDatabase } from "drizzle-orm/node-postgres";
import { eq } from "drizzle-orm";
import { agentJobs } from "../../db/agentJobs";
import { agentJobEvents } from "./queueEvents";
import os from "os";

export interface QueueJobTask {
  jobId: string;
  projectId: string;
  runFn: () => Promise<any>;
}

export class QueueService {
  private activeCount = 0;
  private pending: QueueJobTask[] = [];
  private maxConcurrency = 10;
  private isCheckingMemory = false;

  constructor(private db: NodePgDatabase<any>) {

    setInterval(() => this.processQueue(), 2000);
  }

  async enqueue(jobId: string, projectId: string, connectorId: string[], userPrompt: string, runFn: () => Promise<any>): Promise<void> {

    await this.db
      .insert(agentJobs)
      .values({
        id: jobId,
        projectId,
        connectorId,
        userPrompt,
        status: "Queued",
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: agentJobs.id,
        set: {
          status: "Queued",
          updatedAt: new Date(),
          userPrompt,
        },
      });

    this.pending.push({ jobId, projectId, runFn });

    this.processQueue();
  }

  private async processQueue() {
    if (this.isCheckingMemory) return;
    this.isCheckingMemory = true;

    try {
      while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {

        const freeMemMb = os.freemem() / (1024 * 1024);
        if (freeMemMb < 500) {
          console.warn(`[QueueService] System free memory (${freeMemMb.toFixed(2)} MB) is below 500MB! Pausing queue...`);

          const oldestJob = this.pending[0];
          agentJobEvents.emit(`job:update:${oldestJob.jobId}`, {
            status: "Queued",
            summary: `Waiting for resources (System free memory: ${freeMemMb.toFixed(0)} MB)`,
          });
          break;
        }

        const task = this.pending.shift()!;
        this.activeCount++;
        this.runTask(task);
      }
    } finally {
      this.isCheckingMemory = false;
    }
  }

  private async runTask(task: QueueJobTask) {
    console.info(`[QueueService] Starting job ${task.jobId} (Active: ${this.activeCount}/${this.maxConcurrency})`);

    try {

      await this.db.update(agentJobs)
        .set({ status: "In-Progress", updatedAt: new Date() })
        .where(eq(agentJobs.id, task.jobId));

      await task.runFn();

      const currentJob = await this.db.select().from(agentJobs).where(eq(agentJobs.id, task.jobId)).limit(1);
      const curStatus = currentJob[0]?.status;
      if (curStatus !== "Stopped" && curStatus !== "Paused" && curStatus !== "Failed") {
        await this.db.update(agentJobs)
          .set({ status: "Completed", updatedAt: new Date() })
          .where(eq(agentJobs.id, task.jobId));
      }

    } catch (err: any) {
      console.error(`[QueueService] Job ${task.jobId} failed:`, err.message || err);

      await this.db.update(agentJobs)
        .set({ status: "Failed", error: err.message || String(err), updatedAt: new Date() })
        .where(eq(agentJobs.id, task.jobId));

      agentJobEvents.emit(`job:update:${task.jobId}`, {
        status: "Failed",
        summary: `Execution failed: ${err.message || String(err)}`,
      });

    } finally {
      this.activeCount--;
      this.processQueue();
    }
  }

  getQueueLength(): number {
    return this.pending.length;
  }
}
