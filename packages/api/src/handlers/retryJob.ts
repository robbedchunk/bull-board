import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
  QueueJob,
} from '../../typings/app';
import { connectionAwareJobProvider } from '../providers/job';
import { connectionAwareQueueProvider } from '../providers/queue';

async function retryJob(
  req: BullBoardRequestWithConnections,
  job: QueueJob
): Promise<ControllerHandlerReturnType> {
  const { queueStatus } = req.params;

  await job.retry(queueStatus);

  return {
    status: 204,
    body: {},
  };
}

export const retryJobHandler = connectionAwareQueueProvider(connectionAwareJobProvider(retryJob));
