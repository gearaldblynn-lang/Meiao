export const planBuyerShowSetsConcurrently = async <T,>(
  setCount: number,
  planner: (setIndex: number) => Promise<T>,
): Promise<T[]> => {
  const normalizedSetCount = Math.max(0, Math.floor(Number(setCount) || 0));
  return Promise.all(
    Array.from({ length: normalizedSetCount }, (_, setIndex) => planner(setIndex)),
  );
};
