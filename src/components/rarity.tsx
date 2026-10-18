import { useEffect, useState } from "react";
import { Button, Modal } from "@/components/ui";
import {
  fetchRarityGuide,
  fallbackGuide,
  rarityName,
  rarityRank,
  type RarityGuide,
} from "@/services/rarity";
import type { RarityId } from "@/types";

/* ==========================================================================
   Friend-code rarity

   Two small pieces that both read from the one published table: a badge that
   marks a profile with the tier the server drew, and the guide that states the
   odds. Neither of them can change a rarity — nothing on the client can, which
   is the point of drawing it server-side.
   ========================================================================== */

/**
 * The tier badge. Renders nothing for an unknown or absent rarity rather than
 * guessing: a guest, or a build talking to an older server, should show no
 * badge instead of the wrong one.
 */
export function RarityBadge({
  rarity,
  showLabel = true,
  showRank = false,
}: {
  rarity?: RarityId;
  showLabel?: boolean;
  /** Adds "3 of 7" style position, which is how the guide is ordered. */
  showRank?: boolean;
}) {
  if (rarityRank(rarity) < 0) return null;
  const tier = rarity as RarityId;
  const name = rarityName(tier) ?? tier;
  return (
    <span
      className={`cr-rarity cr-rarity--${tier}`}
      data-rarity={tier}
      title={`Friend-code rarity: ${name}`}
      aria-label={`Friend-code rarity: ${name}`}
    >
      <span className="cr-rarity__mark" aria-hidden="true" />
      {showLabel && <span className="cr-rarity__name">{name}</span>}
      {showRank && <span className="cr-rarity__rank">{rarityRank(tier) + 1}/7</span>}
    </span>
  );
}

/** One row per tier: the odds, and what the tier actually changes. */
export function RarityGuideTable({ guide }: { guide: RarityGuide }) {
  const total = guide.tiers.reduce((sum, tier) => sum + tier.percent, 0);
  return (
    <div className="cr-rarity-guide">
      {guide.tiers.map((tier) => (
        <div className="cr-rarity-guide__row" key={tier.id}>
          <RarityBadge rarity={tier.id} />
          <div className="cr-rarity-guide__text">
            <span className="cr-rarity-guide__odds">
              {tier.percent}% — {formatOneIn(tier.percent)}
            </span>
            <span className="cr-rarity-guide__desc">{tier.description}</span>
          </div>
        </div>
      ))}
      <p className="cr-row__desc">
        These percentages add up to {Math.round(total * 10) / 10}% and are the generator's own weights —
        the draw uses them directly, so there is no second table to drift. Rarity is cosmetic: it changes
        how a profile is painted and nothing else. It grants no permissions, no moderation rights, and no
        account privileges, and it is not a measure of trustworthiness.
      </p>
    </div>
  );
}

function formatOneIn(percent: number): string {
  if (percent >= 1) {
    const oneIn = Math.round(100 / percent);
    return `about 1 in ${oneIn}`;
  }
  return `about 1 in ${Math.round(100 / percent).toLocaleString()}`;
}

/**
 * The guide as a modal. The table is fetched on open; while it is in flight the
 * mirror is shown with a note, so the numbers are never blank and never
 * presented as live when they are not.
 */
export function RarityGuideModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [guide, setGuide] = useState<RarityGuide>(() => fallbackGuide());

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void fetchRarityGuide().then((next) => {
      if (!cancelled) setGuide(next);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Modal
      open={open}
      title="Friend-code rarity"
      onClose={onClose}
      width={560}
      footer={<Button onClick={onClose}>Close</Button>}
    >
      <p className="cr-row__desc">
        When your account was created, the server drew one rarity for your friend code from the table
        below and stored it with the account. It is drawn once — there is no control in CrystalOS, and no
        API, that can re-roll it.
      </p>
      <RarityGuideTable guide={guide} />
      {!guide.live && (
        <p className="cr-row__desc">
          Showing this build's mirror of the table — the account server is not reachable right now. The
          mirror is checked against the server's table by the test suite, so the odds above are still the
          real ones.
        </p>
      )}
    </Modal>
  );
}
