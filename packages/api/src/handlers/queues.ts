import {
  AppJob,
  AppQueue,
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
  JobCounts,
  JobStatus,
  Pagination,
  QueueJob,
  Status,
} from '../../typings/app';
import { BaseAdapter } from '../queueAdapters/base';
import { ConnectionManager } from '../services/connectionManager';

export const formatJob = (job: QueueJob, queue: BaseAdapter): AppJob => {
  const jobProps = job.toJSON();

  const stacktrace = jobProps.stacktrace ? jobProps.stacktrace.filter(Boolean) : [];
  stacktrace.reverse();

  return {
    id: jobProps.id,
    timestamp: jobProps.timestamp,
    processedOn: jobProps.processedOn,
    processedBy: jobProps.processedBy,
    finishedOn: jobProps.finishedOn,
    progress: jobProps.progress,
    attempts: jobProps.attemptsMade,
    delay: jobProps.delay,
    failedReason: jobProps.failedReason,
    stacktrace,
    opts: jobProps.opts,
    data: queue.format('data', jobProps.data),
    name: queue.format('name', jobProps, jobProps.name || ''),
    returnValue: queue.format('returnValue', jobProps.returnvalue),
    isFailed: !!jobProps.failedReason || (Array.isArray(stacktrace) && stacktrace.length > 0),
    externalUrl:
      typeof queue.externalJobUrl === 'function' ? queue.externalJobUrl(jobProps) : undefined,
  };
};

function getPagination(
  statuses: JobStatus[],
  counts: JobCounts,
  currentPage: number,
  jobsPerPage: number
): Pagination {
  const isLatestStatus = statuses.length > 1;
  const total = isLatestStatus
    ? statuses.reduce((total, status) => total + Math.min(counts[status], jobsPerPage), 0)
    : counts[statuses[0]];

  const start = isLatestStatus ? 0 : (currentPage - 1) * jobsPerPage;
  const pageCount = isLatestStatus ? 1 : Math.ceil(total / jobsPerPage);

  return {
    pageCount,
    range: { start, end: start + jobsPerPage - 1 },
  };
}

async function getAppQueues(
  pairs: [string, BaseAdapter, string?, string?][],
  query: Record<string, any>
): Promise<AppQueue[]> {
  return Promise.all(
    pairs.map(async ([queueName, queue, connectionName, connectionId]) => {
      const isActiveQueue = decodeURIComponent(query.activeQueue) === queueName;
      const jobsPerPage = +query.jobsPerPage || 10;

      const jobStatuses = queue.getJobStatuses();

      const status =
        !isActiveQueue || query.status === 'latest' ? jobStatuses : [query.status as JobStatus];
      const currentPage = +query.page || 1;

      const counts = await queue.getJobCounts();
      const isPaused = await queue.isPaused();

      const pagination = getPagination(status, counts, currentPage, jobsPerPage);
      const jobs = isActiveQueue
        ? await queue.getJobs(status, pagination.range.start, pagination.range.end)
        : [];

      return {
        name: queueName,
        displayName: queue.getDisplayName() || undefined,
        description: queue.getDescription() || undefined,
        connectionName: connectionName || 'Unknown',
        connectionId: connectionId || undefined,
        statuses: queue.getStatuses(),
        counts: counts as Record<Status, number>,
        jobs: jobs.filter(Boolean).map((job) => formatJob(job, queue)),
        pagination,
        readOnlyMode: queue.readOnlyMode,
        allowRetries: queue.allowRetries,
        allowCompletedRetries: queue.allowCompletedRetries,
        isPaused,
        type: queue.type,
        delimiter: queue.delimiter,
      };
    })
  );
}

export async function queuesHandler(
  req: BullBoardRequestWithConnections
): Promise<ControllerHandlerReturnType> {
  const pairs: [string, BaseAdapter, string?, string?][] = [];
  const connectionManager = req.connectionManager as ConnectionManager;

  // Track which queues belong to dynamic connections to avoid duplication
  const dynamicQueueNames = new Set<string>();

  // Add queues from dynamic connections if connection manager is available
  if (connectionManager) {
    try {
      const connections = await connectionManager.getAllConnections();

      await Promise.all(
        connections.map(async (connection) => {
          try {
            // Get queues specifically mapped to this connection
            const queueNamesForConnection = await connectionManager.getQueuesForConnection(
              connection.id
            );

            await Promise.all(
              queueNamesForConnection.map(async (queueName) => {
                const queue = req.queues.get(queueName);
                if (queue && (await queue.isVisible(req))) {
                  pairs.push([queueName, queue, connection.name, connection.id]);
                  dynamicQueueNames.add(queueName);
                }
              })
            );
          } catch (error) {
            console.warn(
              `Failed to load queues for connection ${connection.name}:`,
              error instanceof Error ? error.message : String(error)
            );
          }
        })
      );
    } catch (error) {
      console.warn(
        'Failed to load dynamic connections:',
        error instanceof Error ? error.message : String(error)
      );
    }
  }

  // Also include queues that exist in req.queues but aren't explicitly mapped
  // These will be shown under the master connection if available
  if (connectionManager) {
    try {
      const masterConnection = await connectionManager.getConnection('__master__');
      if (masterConnection) {
        for (const [queueName, queue] of req.queues.entries()) {
          if (!dynamicQueueNames.has(queueName) && await queue.isVisible(req)) {
            pairs.push([queueName, queue, masterConnection.name, masterConnection.id]);
          }
        }
      }
    } catch (error) {
      console.warn('Failed to load master connection for unmapped queues:', error instanceof Error ? error.message : String(error));
    }
  }

  const queues = pairs.length > 0 ? await getAppQueues(pairs, req.query) : [];

  return {
    body: {
      queues,
    },
  };
}
