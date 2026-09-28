import Image from "next/image";
import clsx from "clsx";

type LogoProps = {
  /** Pixel size of the round emblem. Default 36 (h-9 w-9, matches old badge). */
  size?: number;
  /** Show the "SSC PrepHub" wordmark next to the emblem. Default true. */
  withWordmark?: boolean;
  className?: string;
};

/**
 * Official SSC Prep Hub emblem, used everywhere the old "S" placeholder
 * badge used to be (home, dashboard, admin, profile, test, discover, signup
 * headers). Swap this one file if the logo ever changes instead of editing
 * every page.
 */
export function Logo({ size = 36, withWordmark = true, className }: LogoProps) {
  return (
    <span className={clsx("flex items-center gap-2", className)}>
      <Image
        src="/logo.png"
        alt="SSC Prep Hub"
        width={size}
        height={size}
        priority
        className="rounded-full ring-1 ring-border"
        style={{ width: size, height: size }}
      />
      {withWordmark && (
        <span className="text-lg font-bold tracking-tight">
          SSC<span className="text-primary">PrepHub</span>
        </span>
      )}
    </span>
  );
}
