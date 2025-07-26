import { Redis } from 'ioredis';
import { DetectedQueue } from '../../typings/app';

export class QueueDetector {
  private redis: Redis;

  constructor(redis: Redis) {
    this.redis = redis;
  }

  /**
   * Detects BullMQ queues by scanning for meta keys only
   */
  async detectBullMQQueues(): Promise<DetectedQueue[]> {
    try {
      // Only scan meta keys - they're required for every BullMQ queue
      const keys = await this.redis.keys('bull:*:meta');
      
      const queues: DetectedQueue[] = [];
      for (const key of keys) {
        const queueName = this.extractBullMQQueueName(key);
        if (queueName) {
          queues.push({ name: queueName, type: 'bullmq' });
        }
      }
      
      return queues;
    } catch (error) {
      console.error('Error detecting BullMQ queues:', error);
      throw error;
    }
  }

  /**
   * Detects Bull queues by scanning for completed/failed/active keys
   */
  async detectBullQueues(): Promise<DetectedQueue[]> {
    try {
      // Bull queues use patterns like bull:queueName:active, bull:queueName:completed, etc.
      const keys = await this.redis.keys('bull:*:active');
      const queues: DetectedQueue[] = [];
      
      for (const key of keys) {
        const queueName = this.extractBullQueueName(key);
        if (queueName) {
          queues.push({ name: queueName, type: 'bull' });
        }
      }
      
      return queues;
    } catch (error) {
      console.error('Error detecting Bull queues:', error);
      throw error;
    }
  }

  /**
   * Detects all queue types
   */
  async detectAllQueues(): Promise<DetectedQueue[]> {
    const [bullmqQueues, bullQueues] = await Promise.all([
      this.detectBullMQQueues(),
      this.detectBullQueues(),
    ]);
    
    // Remove duplicates by name
    const queueMap = new Map<string, DetectedQueue>();
    
    // BullMQ queues take precedence
    bullmqQueues.forEach(queue => {
      queueMap.set(queue.name, queue);
    });
    
    // Add Bull queues only if not already detected as BullMQ
    bullQueues.forEach(queue => {
      if (!queueMap.has(queue.name)) {
        queueMap.set(queue.name, queue);
      }
    });
    
    return Array.from(queueMap.values());
  }

  /**
   * Extract queue name from BullMQ meta key: bull:queueName:meta
   */
  private extractBullMQQueueName(key: string): string | null {
    const parts = key.split(':');
    if (parts.length === 3 && parts[0] === 'bull' && parts[2] === 'meta') {
      return parts[1];
    }
    return null;
  }

  /**
   * Extract queue name from Bull active key: bull:queueName:active
   */
  private extractBullQueueName(key: string): string | null {
    const parts = key.split(':');
    if (parts.length === 3 && parts[0] === 'bull' && parts[2] === 'active') {
      return parts[1];
    }
    return null;
  }

  /**
   * Check if queue detection can run on this Redis instance
   */
  async canDetectQueues(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch (error) {
      return false;
    }
  }
}