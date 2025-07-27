import { BullBoardRequestWithConnections, ControllerHandlerReturnType } from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';
import { BaseAdapter } from '../queueAdapters/base';

async function promoteAll(
  _req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  await queue.promoteAll();

  return { status: 200, body: {} };
}

export const promoteAllHandler = connectionAwareQueueProvider(promoteAll);
