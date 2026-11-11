export function Mark({ size = 20 }: { size?: number }) {
  return <span className="mark" style={{ width: size, height: size }} aria-hidden="true" />;
}
