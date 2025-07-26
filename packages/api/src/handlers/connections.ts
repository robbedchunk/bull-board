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

    // Create connection config with generated ID and hash
    const baseConfig = {
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

    // Check for existing connection before creating
    const existingConnection = await connectionManager.findExistingConnection(baseConfig);
    if (existingConnection) {
      return {
        status: 400,
        body: {
          error: `Connection already exists with name "${existingConnection.name}" (ID: ${existingConnection.id})`,
          existingConnection: {
            id: existingConnection.id,
            name: existingConnection.name,
            host: existingConnection.host,
            port: existingConnection.port,
          },
        },
      };
    }

    const config: RedisConnectionConfig = {
      id: randomUUID(),
      hash: connectionManager.generateConnectionHash(baseConfig),
      ...baseConfig,
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
    const { password, hash, ...safeConfig } = config;
    return {
      status: 201,
      body: {
        message: 'Connection created successfully',
        connection: safeConfig,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: `Failed to create connection: ${error instanceof Error ? error.message : String(error)}`,
      },
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
    const safeConnections = connections.map(({ password, hash, ...config }) => config);

    return {
      body: { connections: safeConnections },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: `Failed to list connections: ${error instanceof Error ? error.message : String(error)}`,
      },
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
      body: {
        error: `Failed to check connection health: ${error instanceof Error ? error.message : String(error)}`,
      },
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
    const errorMessage = error instanceof Error ? error.message : String(error);
    
    // Handle master connection deletion attempt
    if (errorMessage.includes('Master connection cannot be deleted')) {
      return {
        status: 400,
        body: {
          error: errorMessage,
        },
      };
    }

    return {
      status: 500,
      body: {
        error: `Failed to delete connection: ${errorMessage}`,
      },
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

    // Add queue to global bull board queues map (not just request-local)
    const queueName = queueAdapter.getName();
    (req as any).addQueueGlobally(queueAdapter);

    return {
      status: 201,
      body: {
        message: 'Queue added successfully',
        queueName,
        connectionId,
        connectionName: config.name,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: `Failed to add queue to connection: ${error instanceof Error ? error.message : String(error)}`,
      },
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

    // Get queues specifically mapped to this connection
    const connectionQueues = await connectionManager.getQueuesForConnection(connectionId);

    return {
      body: {
        connectionId,
        connectionName: config.name,
        queues: connectionQueues,
      },
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: `Failed to get connection queues: ${error instanceof Error ? error.message : String(error)}`,
      },
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
  const connectionManager = req.connectionManager as ConnectionManager;
  const connectionId = req.params.id;
  const queueName = req.params.queueName;

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

    // Remove queue from connection mapping
    await connectionManager.removeQueueFromConnection(connectionId, queueName);
    
    // Remove queue from master registry
    await connectionManager.removeQueueFromMasterRegistry(queueName, connectionId);

    // Remove queue from global bull board queues map (not just request-local)
    (req as any).removeQueueGlobally(queueName);
    const removed = true; // Global removal always succeeds if queue exists

    if (!removed) {
      return {
        status: 404,
        body: { error: 'Queue not found in queue registry' },
      };
    }

    return {
      status: 204,
      body: {},
    };
  } catch (error) {
    return {
      status: 500,
      body: {
        error: `Failed to remove queue from connection: ${error instanceof Error ? error.message : String(error)}`,
      },
    };
  }
}
