import { SyncTaskQueueLike, SyncTaskStats } from './types';
import { WebDAVUnavailableError } from './errors';

export class SyncTaskQueue implements SyncTaskQueueLike {
  private queue: Array<() => void> = [];
  private runningTasks = 0;
  private totalTasks = 0;
  private completedTasks = 0;
  private hasFailedTasks = false;
  private downloadedSize = 0;
  private maxConcurrency: number;

  constructor(maxConcurrency = 3) {
    this.maxConcurrency = maxConcurrency;
  }

  async addTask<T>(task: () => Promise<T>): Promise<T> {
    this.totalTasks++;
    return await new Promise<T>((resolve, reject) => {
      if (this.hasFailedTasks) {
        reject(new WebDAVUnavailableError());
        return;
      }

      const run = async () => {
        this.runningTasks++;
        try {
          const result = await task();
          this.completedTasks++;
          resolve(result);
        } catch (error) {
          this.completedTasks++;
          reject(error);
        } finally {
          this.runningTasks--;
          this.runNext();
        }
      };

      if (this.runningTasks < this.maxConcurrency) {
        run();
      } else {
        this.queue.push(() => {
          run().catch((error) => {
            console.error('Task failed:', error);
          });
        });
      }
    });
  }

  runNext() {
    if (this.hasFailedTasks) return;
    if (this.queue.length === 0) return;
    if (this.runningTasks >= this.maxConcurrency) return;
    const next = this.queue.shift();
    if (next) next();
  }

  clearQueue() {
    this.queue = [];
  }

  getStats(): SyncTaskStats {
    return {
      total: this.totalTasks,
      completed: this.completedTasks,
      pending: this.queue.length,
      running: this.runningTasks,
      hasFailedTasks: this.hasFailedTasks,
    };
  }

  resetCounters() {
    this.totalTasks = 0;
    this.completedTasks = 0;
    this.hasFailedTasks = false;
  }

  fail() {
    this.hasFailedTasks = true;
    this.clearQueue();
  }

  getDownloadedSize() {
    return this.downloadedSize;
  }

  setDownloadedSize(size: number) {
    this.downloadedSize = size;
  }
}
