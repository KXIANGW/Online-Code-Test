import { JUDGE_TASKS_QUEUE, getChannel } from "./client";

export type SubmissionType = "simple" | "formal";

export interface JudgeTask {
  submissionId: number;
  type: SubmissionType;
}

export async function publishJudgeTask(task: JudgeTask): Promise<void> {
  const channel = await getChannel();
  const ok = channel.sendToQueue(JUDGE_TASKS_QUEUE, Buffer.from(JSON.stringify(task)), {
    contentType: "application/json",
    persistent: true,
  });

  if (!ok) {
    await new Promise((resolve) => channel.once("drain", resolve));
  }
}
