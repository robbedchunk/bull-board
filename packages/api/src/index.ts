import path from 'path';
import { BoardOptions, IServerAdapter, DynamicBoardOptions, BullBoardRequestWithConnections } from '../typings/app';
import { errorHandler } from './handlers/error';
import { BaseAdapter } from './queueAdapters/base';
import { getQueuesApi } from './queuesApi';
import { appRoutes } from './routes';
import { ConnectionManager } from './services/connectionManager';

// Function overloads for backward compatibility
export function createBullBoard(params: {
  queues: ReadonlyArray<BaseAdapter>;
  serverAdapter: IServerAdapter;
  options?: BoardOptions;
}): {
  setQueues: (newBullQueues: ReadonlyArray<BaseAdapter>) => void;
  replaceQueues: (newBullQueues: ReadonlyArray<BaseAdapter>) => void;
  addQueue: (queue: BaseAdapter) => void;
  removeQueue: (queueOrName: string | BaseAdapter) => void;
};

export function createBullBoard(params: {
  queues: ReadonlyArray<BaseAdapter>;
  serverAdapter: IServerAdapter;
  options?: DynamicBoardOptions;
}): {
  setQueues: (newBullQueues: ReadonlyArray<BaseAdapter>) => void;
  replaceQueues: (newBullQueues: ReadonlyArray<BaseAdapter>) => void;
  addQueue: (queue: BaseAdapter) => void;
  removeQueue: (queueOrName: string | BaseAdapter) => void;
  connectionManager?: ConnectionManager;
  addQueueFromConnection?: (connectionId: string, queueName: string, queueType?: 'bull' | 'bullmq', options?: any) => Promise<BaseAdapter>;
};

export function createBullBoard({
  queues,
  serverAdapter,
  options = { uiConfig: {} },
}: {
  queues: ReadonlyArray<BaseAdapter>;
  serverAdapter: IServerAdapter;
  options?: DynamicBoardOptions;
}) {
  // Initialize connection manager if encryption key and master Redis are provided
  let connectionManager: ConnectionManager | undefined;
  
  if (options.encryptionKey && options.masterRedis) {
    connectionManager = new ConnectionManager(options.masterRedis, options.encryptionKey);
  }

  const { 
    bullBoardQueues, 
    setQueues, 
    replaceQueues, 
    addQueue, 
    removeQueue,
    addQueueFromConnection
  } = getQueuesApi(queues, connectionManager);

  const uiBasePath =
    // oxlint-disable-next-line no-eval
    options.uiBasePath || path.dirname(eval(`require.resolve('@bull-board/ui/package.json')`));

  // Create enhanced error handler that injects connection manager
  const enhancedErrorHandler = (error: Error) => {
    console.error('Bull Board Error:', error);
    return errorHandler(error);
  };

  // Middleware to inject connection manager into requests
  const originalSetApiRoutes = serverAdapter.setApiRoutes.bind(serverAdapter);
  serverAdapter.setApiRoutes = (routes) => {
    const enhancedRoutes = routes.map(route => ({
      ...route,
      handler: async (req: any) => {
        // Inject connection manager into request for connection-related endpoints
        if (connectionManager && route.route.toString().includes('/api/connections')) {
          (req as BullBoardRequestWithConnections).connectionManager = connectionManager;
        }
        return route.handler(req);
      }
    }));
    
    return originalSetApiRoutes(enhancedRoutes);
  };

  serverAdapter
    .setQueues(bullBoardQueues)
    .setViewsPath(path.join(uiBasePath, 'dist'))
    .setStaticPath('/static', path.join(uiBasePath, 'dist/static'))
    .setUIConfig({
      boardTitle: 'Bull Dashboard',
      favIcon: {
        default: 'static/images/logo.svg',
        alternative: 'static/favicon-32x32.png',
      },
      ...options.uiConfig,
    })
    .setEntryRoute(appRoutes.entryPoint)
    .setErrorHandler(enhancedErrorHandler)
    .setApiRoutes(appRoutes.api);

  // Return enhanced API with backward compatibility
  const result: any = { 
    setQueues, 
    replaceQueues, 
    addQueue, 
    removeQueue 
  };

  // Add dynamic connection features if available
  if (connectionManager) {
    result.connectionManager = connectionManager;
    result.addQueueFromConnection = addQueueFromConnection;
  }

  return result;
}

// Export types and services for external use
export { ConnectionManager } from './services/connectionManager';
export type { 
  RedisConnectionConfig,
  CreateConnectionRequest, 
  AddQueueToConnectionRequest,
  ConnectionHealthStatus,
  DynamicBoardOptions,
  BullBoardRequestWithConnections
} from '../typings/app';
