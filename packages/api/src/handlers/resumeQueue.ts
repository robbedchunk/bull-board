import { BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';

async function resumeQueue(
  _req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  await queue.resume();

  return { status: 200, body: {} };
}

export const resumeQueueHandler = connectionAwareQueueProvider(resumeQueue);
