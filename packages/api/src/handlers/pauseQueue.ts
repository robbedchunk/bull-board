import { BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';

async function pauseQueue(
  _req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  await queue.pause();

  return { status: 200, body: {} };
}

export const pauseQueueHandler = connectionAwareQueueProvider(pauseQueue);
