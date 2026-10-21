/** Renders a score line unchanged (same text), but lets it wrap at " | " on narrow screens. */
export default function ScoreLineText({ text }: { text: string }) {
  const parts = text.split(" | ");
  return <>{parts.map((p, i) => <span key={i} className="inline-block max-w-full break-words">{i > 0 ? "| " : ""}{p}{i < parts.length - 1 ? " " : ""}</span>)}</>;
}
