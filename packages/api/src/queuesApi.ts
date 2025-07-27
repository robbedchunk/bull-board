import { BaseAdapter } from './queueAdapters/base';
import { BullBoardQueues } from '../typings/app';
import { ConnectionManager } from './services/connectionManager';

export function getQueuesApi(queues: ReadonlyArray<BaseAdapter>, connectionManager?: ConnectionManager) {
  const bullBoardQueues: BullBoardQueues = new Map<string, BaseAdapter>();
  let serverAdapter: any = null; // Will be set from index.ts

  function addQueue(queue: BaseAdapter): void {
    const name = queue.getName();
    bullBoardQueues.set(name, queue);
    // Notify server adapter of queue changes
    if (serverAdapter) {
      serverAdapter.setQueues(bullBoardQueues);
    }
  }

  function removeQueue(queueOrName: string | BaseAdapter) {
    const name = typeof queueOrName === 'string' ? queueOrName : queueOrName.getName();

    bullBoardQueues.delete(name);
    // Notify server adapter of queue changes
    if (serverAdapter) {
      serverAdapter.setQueues(bullBoardQueues);
    }
  }

  function setServerAdapter(adapter: any): void {
    serverAdapter = adapter;
  }

  function setQueues(newBullQueues: ReadonlyArray<BaseAdapter>): void {
    newBullQueues.forEach((queue) => {
      const name = queue.getName();

      bullBoardQueues.set(name, queue);
    });
  }

  function replaceQueues(newBullQueues: ReadonlyArray<BaseAdapter>): void {
    const queuesToPersist: string[] = newBullQueues.map((queue) => queue.getName());

    bullBoardQueues.forEach((_queue, name) => {
      if (queuesToPersist.indexOf(name) === -1) {
        bullBoardQueues.delete(name);
      }
    });

    return setQueues(newBullQueues);
  }

  // Enhanced functions for dynamic connection management
  async function addQueueFromConnection(
    connectionId: string,
    queueName: string,
    queueType: 'bull' | 'bullmq' = 'bullmq',
    options: any = {}
  ): Promise<BaseAdapter> {
    if (!connectionManager) {
      throw new Error('Connection manager not available');
    }

    const queueAdapter = await connectionManager.createQueueAdapter(
      connectionId,
      queueName,
      queueType,
      options
    );

    addQueue(queueAdapter);
    return queueAdapter;
  }

  async function loadQueuesFromConnections(): Promise<void> {
    if (!connectionManager) {
      console.log('Queue lazy loading enabled - queues will be created on first access');
      return;
    }

    console.log('🔄 Loading queues from master registry...');
    
    try {
      const restoredQueues = await connectionManager.loadQueuesFromMasterRegistry();
      
      // Add all restored queues to the board
      restoredQueues.forEach(adapter => {
        addQueue(adapter);
        console.log(`➕ Added restored queue: ${adapter.getName()}`);
      });
      
      console.log(`🎉 Successfully restored ${restoredQueues.size} queues from registry`);
    } catch (error) {
      console.error('❌ Failed to load queues from registry:', error instanceof Error ? error.message : String(error));
    }
  }

  function getConnectionManager(): ConnectionManager | undefined {
    return connectionManager;
  }

  // Initialize with static queues (backward compatibility)
  setQueues(queues);

  return { 
    bullBoardQueues, 
    setQueues, 
    replaceQueues, 
    addQueue, 
    removeQueue,
    setServerAdapter,
    // New dynamic functions
    addQueueFromConnection,
    loadQueuesFromConnections,
    getConnectionManager
  };
}
