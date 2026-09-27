/**
 * Keep reader scaling in the layout tree so scroll metrics match the pixels
 * the reader displays. A transform would scale the pixels without updating
 * the scrollable layout used by the end-of-chapter detector.
 */
export function getReaderZoomStyle(zoom) {
  const level = Number.isFinite(Number(zoom)) ? Number(zoom) : 1;
  return { zoom: level };
}
