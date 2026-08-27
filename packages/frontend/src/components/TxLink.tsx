import { BLOCK_EXPLORER_URL } from "../config/chain";

interface TxLinkProps {
  hash: string;
  /** Falls back to plain text when the chain has no explorer configured. */
  color: string;
}

/**
 * A transaction hash the player can actually follow.
 *
 * The hash was already on screen; without the link it is 66 characters the
 * player has to copy into an explorer by hand to learn anything from it.
 */
export function TxLink({ hash, color }: TxLinkProps) {
  if (!BLOCK_EXPLORER_URL) return <>{hash}</>;

  return (
    <a
      href={`${BLOCK_EXPLORER_URL}/tx/${hash}`}
      target="_blank"
      rel="noreferrer"
      style={{ color, textDecoration: "underline", textUnderlineOffset: 3 }}
    >
      {hash}
    </a>
  );
}
