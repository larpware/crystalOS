/* ==========================================================================
   Crystal mark

   The one brand asset the OS draws itself: a faceted gem on the same 24px grid
   as the icon set. It is drawn in white at three opacities — a bright table, a
   mid-tone right facet and a shaded left facet — so it reads as cut stone on
   the dark boot screen and setup rail without picking up the shell accent.

   The silhouette is a kite, not a box: a low girdle, a pointed culet and a
   bright table facet. That is what makes it read as cut stone at 16px instead
   of as an isometric cube.
   ========================================================================== */

export function CrystalMark({
  size = 30,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      aria-hidden="true"
      focusable="false"
    >
      <path
        d="M12 1.9 21 7.1 12 22.1 3 7.1Z"
        fill="none"
        stroke="#fff"
        strokeWidth="1.1"
        strokeLinejoin="round"
        opacity="0.55"
      />
      <path d="M12 1.9 21 7.1 12 10.9 3 7.1Z" fill="#fff" opacity="0.95" />
      <path d="M21 7.1 12 10.9v11.2Z" fill="#fff" opacity="0.4" />
      <path d="M3 7.1 12 10.9v11.2Z" fill="#fff" opacity="0.2" />
    </svg>
  );
}

export default CrystalMark;
