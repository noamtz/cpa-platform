export function createRecoverableSaveQueue() {
  let tail = Promise.resolve();

  return {
    enqueue(task) {
      const current = tail.then(task);
      tail = current.catch(() => undefined);
      return current;
    },
  };
}
