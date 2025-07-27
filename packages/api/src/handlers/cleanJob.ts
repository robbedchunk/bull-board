import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
  QueueJob,
} from '../../typings/app';
import { connectionAwareJobProvider } from '../providers/job';
import { connectionAwareQueueProvider } from '../providers/queue';

async function cleanJob(
  _req: BullBoardRequestWithConnections,
  job: QueueJob
): Promise<ControllerHandlerReturnType> {
  await job.remove();

  return {
    status: 204,
    body: {},
  };
}

export const cleanJobHandler = connectionAwareQueueProvider(connectionAwareJobProvider(cleanJob));
