import { BaseAdapter } from '../queueAdapters/base';
import {
  BullBoardRequestWithConnections,
  ControllerHandlerReturnType,
} from '../../typings/app';
import { connectionAwareQueueProvider } from '../providers/queue';

async function jobLogs(
  req: BullBoardRequestWithConnections,
  queue: BaseAdapter
): Promise<ControllerHandlerReturnType> {
  const { jobId } = req.params;
  const logs = await queue.getJobLogs(jobId);

  return {
    status: 200,
    body: logs,
  };
}

export const jobLogsHandler = connectionAwareQueueProvider(jobLogs, {
  skipReadOnlyModeCheck: true,
});
