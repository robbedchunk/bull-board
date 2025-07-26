import { randomUUID } from 'crypto';
import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
  CreateConnectionRequest,
  AddQueueToConnectionRequest,
  RedisConnectionConfig,
  ConnectionHealthStatus,
} from '../../typings/app';
import { ConnectionManager } from '../services/connectionManager';

/**
 * Create a new Redis connection configuration
 * POST /api/connections
 */
export async function createConnectionHandler(
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
    const connectionData = req.body as CreateConnectionRequest;
    
    // Validate required fields
    if (!connectionData.name || !connectionData.host || !connectionData.port) {
      return {
        status: 400,
        body: { error: 'Missing required fields: name, host, port' },
      };
    }

    // Create connection config with generated ID
    const config: RedisConnectionConfig = {
      id: randomUUID(),
      name: connectionData.name,
      host: connectionData.host,
      port: connectionData.port,
      password: connectionData.password,
      db: connectionData.db || 0,
      username: connectionData.username,
      family: connectionData.family || 4,
      keyPrefix: connectionData.keyPrefix,
      connectTimeout: connectionData.connectTimeout || 10000,
      lazyConnect: connectionData.lazyConnect !== false,
      tls: connectionData.tls,
    };

    // Test connection before storing
    const isConnectionValid = await connectionManager.testConnection(config);
    if (!isConnectionValid) {
      return {
        status: 400,
        body: { error: 'Failed to connect to Redis with provided configuration' },
      };
    }

    // Store encrypted configuration
    await connectionManager.storeConnection(config);

    // Return connection info (without sensitive data)
    const { password, ...safeConfig } = config;
    return {
      status: 201,
      body: { 
        message: 'Connection created successfully',
        connection: safeConfig 
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * List all stored connections
 * GET /api/connections
 */
export async function listConnectionsHandler(
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
    const connections = await connectionManager.getAllConnections();
    
    // Remove sensitive data from response
    const safeConnections = connections.map(({ password, ...config }) => config);
    
    return {
      body: { connections: safeConnections },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to list connections: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Get connection health status
 * GET /api/connections/:id/health
 */
export async function getConnectionHealthHandler(
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
    const config = await connectionManager.getConnection(connectionId);
    if (!config) {
      return {
        status: 404,
        body: { error: 'Connection not found' },
      };
    }

    const isHealthy = await connectionManager.testConnection(config);
    // Check if connection is actively managed

    const healthStatus: ConnectionHealthStatus = {
      id: config.id,
      name: config.name,
      status: isHealthy ? 'connected' : 'disconnected',
      lastChecked: Date.now(),
      error: isHealthy ? undefined : 'Connection test failed',
    };

    return {
      body: { health: healthStatus },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to check connection health: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Delete a connection configuration
 * DELETE /api/connections/:id
 */
export async function deleteConnectionHandler(
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
    const removed = await connectionManager.removeConnection(connectionId);
    
    if (!removed) {
      return {
        status: 404,
        body: { error: 'Connection not found' },
      };
    }

    return {
      status: 204,
      body: {},
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to delete connection: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Add a queue to a specific connection
 * POST /api/connections/:id/queues
 */
export async function addQueueToConnectionHandler(
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
    const queueData = req.body as AddQueueToConnectionRequest;
    
    if (!queueData.queueName) {
      return {
        status: 400,
        body: { error: 'Missing required field: queueName' },
      };
    }

    // Check if connection exists
    const config = await connectionManager.getConnection(connectionId);
    if (!config) {
      return {
        status: 404,
        body: { error: 'Connection not found' },
      };
    }

    // Create queue adapter
    const queueAdapter = await connectionManager.createQueueAdapter(
      connectionId,
      queueData.queueName,
      queueData.queueType || 'bullmq',
      queueData.options || {}
    );

    // Add queue to bull board queues map
    const queueName = queueAdapter.getName();
    req.queues.set(queueName, queueAdapter);

    return {
      status: 201,
      body: { 
        message: 'Queue added successfully',
        queueName,
        connectionId,
        connectionName: config.name
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to add queue to connection: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Get queues for a specific connection
 * GET /api/connections/:id/queues
 */
export async function getConnectionQueuesHandler(
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

    // Filter queues that belong to this connection
    // This is a simplified approach - in a more complex implementation,
    // you might want to track queue-to-connection mappings
    const connectionQueues: string[] = [];
    
    for (const [queueName, adapter] of req.queues.entries()) {
      // Check if the adapter's redis instance matches this connection
      // This is a basic check - you might need more sophisticated logic
      try {
        const redisInfo = await adapter.getRedisInfo();
        if (redisInfo) {
          connectionQueues.push(queueName);
        }
      } catch (error) {
        // Skip queues that can't provide redis info
      }
    }

    return {
      body: { 
        connectionId,
        connectionName: config.name,
        queues: connectionQueues
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to get connection queues: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}

/**
 * Remove a queue from a specific connection
 * DELETE /api/connections/:id/queues/:queueName
 */
export async function removeQueueFromConnectionHandler(
  req: BullBoardRequestWithConnections
): Promise<ControllerHandlerReturnType> {
  const queueName = req.params.queueName;
  
  try {
    // Remove queue from bull board queues map
    const removed = req.queues.delete(queueName);
    
    if (!removed) {
      return {
        status: 404,
        body: { error: 'Queue not found' },
      };
    }

    return {
      status: 204,
      body: {},
    };
  } catch (error) {
    return {
      status: 500,
      body: { error: `Failed to remove queue from connection: ${error instanceof Error ? error.message : String(error)}` },
    };
  }
}