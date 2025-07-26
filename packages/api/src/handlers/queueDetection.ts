import { 
  BullBoardRequestWithConnections, 
  ControllerHandlerReturnType, 
  QueueDetectionResult,
  DetectedQueue,
  QueueRegistrationError
} from '../../typings/app';
import { ConnectionManager } from '../services/connectionManager';

/**
 * Detect queues across all connections
 * POST /api/queues/detect
 */
export async function detectQueuesHandler(
  req: BullBoardRequestWithConnections
): Promise<ControllerHandlerReturnType> {
  const connectionManager = req.connectionManager as ConnectionManager;
  
  if (!connectionManager) {
    return {
      status: 500,
      body: { error: 'Connection manager not initialized' },
    };
  }

  try {
    // Detect all queues across all connections
    const detectedQueues = await connectionManager.detectQueuesOnAllConnections();
    
    // Filter to only NEW queues (not already registered)
    const newQueues: DetectedQueue[] = [];
    
    for (const detectedQueue of detectedQueues) {
      const isRegistered = req.queues.has(detectedQueue.name);
      
      if (!isRegistered) {
        newQueues.push(detectedQueue);
      }
    }

    // Build the base result focusing on discoveries
    const result: QueueDetectionResult = {
      success: true,
      discovered: newQueues.length,
      queues: newQueues
    };

    // Optionally auto-register new queues (based on query parameter)
    const autoRegister = req.query.autoRegister === 'true';

    if (autoRegister && newQueues.length > 0) {
      let registeredCount = 0;
      const registrationErrors: QueueRegistrationError[] = [];

      for (const queue of newQueues) {
        try {
          if (queue.connectionId) {
            // Register queue from dynamic connection (including master)
            const adapter = await connectionManager.createQueueAdapter(
              queue.connectionId,
              queue.name,
              queue.type,
              {}
            );
            (req as any).addQueueGlobally(adapter);
            registeredCount++;
          } else {
            registrationErrors.push({
              queueName: queue.name,
              connectionName: queue.connectionName || 'Unknown',
              error: 'No connection ID available for queue'
            });
          }
        } catch (error) {
          registrationErrors.push({
            queueName: queue.name,
            connectionName: queue.connectionName || 'Unknown', 
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Add registration results to response
      result.registered = registeredCount;
      
      if (registrationErrors.length > 0) {
        result.failed = registrationErrors;
      }
    }

    return {
      body: result,
    };
  } catch (error) {
    console.error('Queue detection failed:', error);
    
    const result: QueueDetectionResult = {
      success: false,
      discovered: 0,
      queues: []
    };

    return {
      status: 500,
      body: {
        ...result,
        error: `Queue detection failed: ${error instanceof Error ? error.message : String(error)}`
      },
    };
  }
}

/**
 * Detect queues for a specific connection
 * POST /api/connections/:id/detect
 */
export async function detectConnectionQueuesHandler(
  req: BullBoardRequestWithConnections
): Promise<ControllerHandlerReturnType> {
  const connectionManager = req.connectionManager as ConnectionManager;
  const connectionId = req.params.id;
  
  if (!connectionManager) {
    return {
      status: 500,
      body: { error: 'Connection manager not initialized' },
    };
  }

  try {
    // Check if connection exists
    const config = await connectionManager.getConnection(connectionId);
    if (!config) {
      return {
        status: 404,
        body: { error: 'Connection not found' },
      };
    }

    // Detect queues for this specific connection
    const detectedQueues = await connectionManager.detectQueuesForConnection(connectionId);
    
    // Filter to only NEW queues (not already registered)
    const newQueues: DetectedQueue[] = [];
    
    for (const detectedQueue of detectedQueues) {
      const isRegistered = req.queues.has(detectedQueue.name);
      
      if (!isRegistered) {
        newQueues.push(detectedQueue);
      }
    }

    // Build the base result focusing on discoveries
    const result: QueueDetectionResult = {
      success: true,
      discovered: newQueues.length,
      queues: newQueues
    };

    // Optionally auto-register new queues
    const autoRegister = req.query.autoRegister === 'true';

    if (autoRegister && newQueues.length > 0) {
      let registeredCount = 0;
      const registrationErrors: QueueRegistrationError[] = [];

      for (const queue of newQueues) {
        try {
          const adapter = await connectionManager.createQueueAdapter(
            connectionId,
            queue.name,
            queue.type,
            {}
          );
          (req as any).addQueueGlobally(adapter);
          registeredCount++;
        } catch (error) {
          registrationErrors.push({
            queueName: queue.name,
            connectionName: queue.connectionName || 'Unknown',
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }

      // Add registration results to response
      result.registered = registeredCount;
      
      if (registrationErrors.length > 0) {
        result.failed = registrationErrors;
      }
    }

    return {
      body: result,
    };
  } catch (error) {
    console.error(`Queue detection failed for connection ${connectionId}:`, error);
    
    const result: QueueDetectionResult = {
      success: false,
      discovered: 0,
      queues: []
    };

    return {
      status: 500,
      body: {
        ...result,
        error: `Queue detection failed: ${error instanceof Error ? error.message : String(error)}`
      },
    };
  }
}