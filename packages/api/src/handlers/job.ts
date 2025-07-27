import { BullBoardRequestWithConnections, ControllerHandlerReturnType, QueueJob } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { connectionAwareJobProvider } from '../providers/job';
import { BaseAdapter } from '../queueAdapters/base';
import { formatJob } from './queues';

async function getJobState(
  _req: BullBoardRequestWithConnections,
  job: QueueJob,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  const status = await job.getState();

  return {
    status: 200,
    body: {
      job: formatJob(job, queue),
      status,
    },
  };
}

export const jobHandler = connectionAwareQueueProvider(connectionAwareJobProvider(getJobState), {
  skipReadOnlyModeCheck: true,
});
