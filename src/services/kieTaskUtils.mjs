export const getUserVisibleTaskId = (job) => {
  return String(job?.providerTaskId || job?.result?.providerTaskId || '').trim();
};
