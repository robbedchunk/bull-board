import { BaseAdapter } from '../queueAdapters/base';
import { BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { formatJob } from './queues';

async function addJob(
  req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  const { name, data, options } = req.body;

  const job = await queue.addJob(name, data, options);

  return {
    status: 200,
    body: {
      job: formatJob(job, queue),
      status: job.getState(),
    },
  };
}

export const addJobHandler = connectionAwareQueueProvider(addJob);
