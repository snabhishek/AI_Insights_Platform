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
    // Start standard interval to monitor memory and process queue
    setInterval(() => this.processQueue(), 2000);
  }

  async enqueue(jobId: string, projectId: string, connectorId: string[], userPrompt: string, runFn: () => Promise<any>): Promise<void> {
    // 1. Save job with 'queued' status in database
    await this.db.insert(agentJobs).values({
      id: jobId,
      projectId,
      connectorId,
      userPrompt,
      status: "queued",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 2. Add to local queue array
    this.pending.push({ jobId, projectId, runFn });
    
    // 3. Process immediately
    this.processQueue();
  }

  private async processQueue() {
    if (this.isCheckingMemory) return;
    this.isCheckingMemory = true;

    try {
      while (this.activeCount < this.maxConcurrency && this.pending.length > 0) {
        // Check free memory
        const freeMemMb = os.freemem() / (1024 * 1024);
        if (freeMemMb < 500) {
          console.warn(`[QueueService] System free memory (${freeMemMb.toFixed(2)} MB) is below 500MB! Pausing queue...`);
          // Notify the UI/Tauri frontend that execution is held back due to memory
          const oldestJob = this.pending[0];
          agentJobEvents.emit(`job:update:${oldestJob.jobId}`, {
            status: "queued",
            summary: `Waiting for resources (System free memory: ${freeMemMb.toFixed(0)} MB)`,
          });
          break; // Stop taking jobs
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
      // 1. Update database status to 'running'
      await this.db.update(agentJobs)
        .set({ status: "running", updatedAt: new Date() })
        .where(eq(agentJobs.id, task.jobId));

      // 2. Execute task
      await task.runFn();

      // 3. Update database status to 'completed'
      await this.db.update(agentJobs)
        .set({ status: "completed", updatedAt: new Date() })
        .where(eq(agentJobs.id, task.jobId));

    } catch (err: any) {
      console.error(`[QueueService] Job ${task.jobId} failed:`, err.message || err);

      // Update database status to 'failed' with error info
      await this.db.update(agentJobs)
        .set({ status: "failed", error: err.message || String(err), updatedAt: new Date() })
        .where(eq(agentJobs.id, task.jobId));

      agentJobEvents.emit(`job:update:${task.jobId}`, {
        status: "failed",
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
