export const isImeComposing = (event: {
  isComposing?: boolean;
  nativeEvent?: Event | { isComposing?: boolean; keyCode?: number };
}) => {
  const nativeEvent = event.nativeEvent as { isComposing?: boolean; keyCode?: number } | undefined;
  return Boolean(event.isComposing || (nativeEvent && nativeEvent.isComposing) || (nativeEvent && nativeEvent.keyCode === 229));
};
