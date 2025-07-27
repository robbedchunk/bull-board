import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
  QueueJob,
} from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { connectionAwareJobProvider } from '../providers/job';

async function promoteJob(
  _req: BullBoardRequestWithConnections,
  job: QueueJob
): Promise<ControllerHandlerReturnType> {
  await job.promote();

  return {
    status: 204,
    body: {},
  };
}

export const promoteJobHandler = connectionAwareQueueProvider(connectionAwareJobProvider(promoteJob));
