export const getUserVisibleTaskId = (job) => {
  return String(job?.providerTaskId || '');
};
