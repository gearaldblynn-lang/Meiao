export const submitVirtualModelDelete = async ({
  target,
  pendingRef,
  setPending,
  setNotice,
  setError,
  deleteModel,
  close,
  reload,
}) => {
  if (!target || pendingRef.current) return false;
  pendingRef.current = true;
  setPending(true);
  setNotice('');
  setError('');
  try {
    await deleteModel(target.id);
    close();
    await reload();
    return true;
  } catch (error) {
    setError(error instanceof Error ? error.message : '删除失败');
    return false;
  } finally {
    pendingRef.current = false;
    setPending(false);
  }
};
