import { BullBoardRequest, BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { BaseAdapter } from '../queueAdapters/base';
import { ConnectionManager } from '../services/connectionManager';

export function queueProvider(
  next: (req: BullBoardRequest, queue: BaseAdapter) => Promise<ControllerHandlerReturnType>,
  {
    skipReadOnlyModeCheck = false,
  }: {
    skipReadOnlyModeCheck?: boolean;
  } = {}
) {
  return async (req: BullBoardRequest): Promise<ControllerHandlerReturnType> => {
    const { queueName } = req.params;

    const queue = req.queues.get(queueName);
    if (!queue || !(await queue.isVisible(req))) {
      return { status: 404, body: { error: 'Queue not found' } };
    } else if (queue.readOnlyMode && !skipReadOnlyModeCheck) {
      return {
        status: 405,
        body: { error: 'Method not allowed on read only queue' },
      };
    }

    return next(req, queue);
  };
}

export function connectionAwareQueueProvider(
  next: (req: BullBoardRequestWithConnections, queue: BaseAdapter) => Promise<ControllerHandlerReturnType>,
  {
    skipReadOnlyModeCheck = false,
  }: {
    skipReadOnlyModeCheck?: boolean;
  } = {}
) {
  return async (req: BullBoardRequestWithConnections): Promise<ControllerHandlerReturnType> => {
    const { queueName, connectionId } = req.params;
    const connectionManager = req.connectionManager as ConnectionManager;

    // connectionId is now mandatory
    if (!connectionId) {
      return { 
        status: 400, 
        body: { error: 'connectionId parameter is required' } 
      };
    }

    if (!connectionManager) {
      return { 
        status: 500, 
        body: { error: 'Connection manager not available' } 
      };
    }

    let queue: BaseAdapter | undefined;

    try {
      // First, try to get existing queue adapter from cache
      queue = req.queues.get(queueName);
      
      if (!queue) {
        // Lazy loading: Check if queue exists in the connection's registry
        const queuesForConnection = await connectionManager.getQueuesForConnection(connectionId);
        
        if (queuesForConnection.includes(queueName)) {
          // Create queue adapter on-demand
          console.log(`Lazy loading queue ${queueName} from connection ${connectionId}`);
          queue = await connectionManager.createQueueAdapter(connectionId, queueName);
          
          // Cache the created adapter for future requests
          req.queues.set(queueName, queue);
        } else {
          // Check if queue exists in master registry but not in connection mapping
          const allQueues = await connectionManager.getAllQueuesFromMasterRegistry();
          const compositeKey = `${connectionId}:${queueName}`;
          
          if (allQueues[compositeKey]) {
            console.log(`Restoring queue ${queueName} mapping for connection ${connectionId}`);
            // Restore the connection mapping
            await connectionManager.addQueueToConnection(connectionId, queueName);
            
            // Create the adapter
            queue = await connectionManager.createQueueAdapter(connectionId, queueName);
            req.queues.set(queueName, queue);
          }
        }
      }
    } catch (error) {
      console.warn(`Failed to resolve queue ${queueName} from connection ${connectionId}:`, error);
      return { 
        status: 404, 
        body: { error: `Connection ${connectionId} not found or failed to load queue ${queueName}` } 
      };
    }

    if (!queue) {
      return { 
        status: 404, 
        body: { 
          error: `Queue '${queueName}' not found in connection '${connectionId}'`,
          details: `Queue may not be registered or connection may not exist`
        } 
      };
    }

    // Check queue visibility
    try {
      if (!(await queue.isVisible(req))) {
        return { 
          status: 404, 
          body: { 
            error: `Queue '${queueName}' is not accessible`,
            details: `Queue exists but is not visible for the current request context`
          } 
        };
      }
    } catch (error) {
      console.warn(`Failed to check visibility for queue ${queueName}:`, error);
      return { 
        status: 500, 
        body: { 
          error: `Failed to access queue '${queueName}'`,
          details: error instanceof Error ? error.message : String(error)
        } 
      };
    }

    // Check read-only mode
    if (queue.readOnlyMode && !skipReadOnlyModeCheck) {
      return {
        status: 405,
        body: { 
          error: `Queue '${queueName}' is in read-only mode`,
          details: 'Modification operations are not allowed on this queue'
        },
      };
    }

    return next(req, queue);
  };
}
