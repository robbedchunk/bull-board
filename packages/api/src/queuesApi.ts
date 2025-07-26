import { BaseAdapter } from './queueAdapters/base';
import { BullBoardQueues } from '../typings/app';
import { ConnectionManager } from './services/connectionManager';

export function getQueuesApi(queues: ReadonlyArray<BaseAdapter>, connectionManager?: ConnectionManager) {
  const bullBoardQueues: BullBoardQueues = new Map<string, BaseAdapter>();

  function addQueue(queue: BaseAdapter): void {
    const name = queue.getName();
    bullBoardQueues.set(name, queue);
  }

  function removeQueue(queueOrName: string | BaseAdapter) {
    const name = typeof queueOrName === 'string' ? queueOrName : queueOrName.getName();

    bullBoardQueues.delete(name);
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
      return;
    }

    try {
      const connections = await connectionManager.getAllConnections();
      
      // This is a basic implementation - in a production system,
      // you might want to store queue-to-connection mappings separately
      for (const connection of connections) {
        try {
          // You could implement logic here to automatically load
          // previously configured queues for each connection
          // For now, we'll leave this as a placeholder
        } catch (error) {
          console.warn(`Failed to load queues for connection ${connection.name}:`, error instanceof Error ? error.message : String(error));
        }
      }
    } catch (error) {
      console.warn('Failed to load queues from connections:', error instanceof Error ? error.message : String(error));
    }
  }

  function getConnectionManager(): ConnectionManager | undefined {
    return connectionManager;
  }

  // Initialize with static queues (backward compatibility)
  setQueues(queues);

  // Load dynamic queues if connection manager is available
  if (connectionManager) {
    loadQueuesFromConnections().catch(error => {
      console.warn('Failed to load dynamic queues:', error.message);
    });
  }

  return { 
    bullBoardQueues, 
    setQueues, 
    replaceQueues, 
    addQueue, 
    removeQueue,
    // New dynamic functions
    addQueueFromConnection,
    loadQueuesFromConnections,
    getConnectionManager
  };
}
