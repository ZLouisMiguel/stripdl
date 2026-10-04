export function getReaderContentState({ loading, error, pageCount }) {
  if (loading) return "loading";
  if (error) return "error";
  return pageCount > 0 ? "ready" : "empty";
}
