import { BaseAdapter } from '../queueAdapters/base';
import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
} from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';

async function cleanAll(
  req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  const { queueStatus } = req.params;

  const GRACE_TIME_MS = 5000;

  await queue.clean(queueStatus as any, GRACE_TIME_MS);

  return {
    status: 200,
    body: {},
  };
}

export const cleanAllHandler = connectionAwareQueueProvider(cleanAll);
