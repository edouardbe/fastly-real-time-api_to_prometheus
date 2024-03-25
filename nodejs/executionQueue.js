class ExecutionQueue {
  constructor() {
    this.queue = [];
    this.isExecuting = false;
  }

  push(func) {
    return new Promise((resolve, reject) => {
      const task = async () => {
        try {
          this.isExecuting = true;
          resolve(await func());
        } catch (error) {
          reject(error);
        } finally {
          this.isExecuting = false;
          this.processQueue();
        }
      };

      this.queue.push(task);
      if (!this.isExecuting) {
        this.processQueue();
      }
    });
  }

  processQueue() {
    if (this.queue.length > 0 && !this.isExecuting) {
      const nextTask = this.queue.shift();
      nextTask();
    }
  }
}

module.exports = ExecutionQueue;
