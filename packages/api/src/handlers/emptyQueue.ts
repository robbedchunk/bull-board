import { BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';

async function emptyQueue(
  _req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  await queue.empty();

  return { status: 200, body: {} };
}

export const emptyQueueHandler = connectionAwareQueueProvider(emptyQueue);
