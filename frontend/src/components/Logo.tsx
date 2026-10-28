import Image from "next/image";
import clsx from "clsx";

type LogoProps = {
  /** Pixel size of the emblem. Default 36. */
  size?: number;
  /** Show the "SSC PrepHub" wordmark next to the emblem. Default true. */
  withWordmark?: boolean;
  className?: string;
};

/**
 * Official SSC Prep Hub emblem + wordmark. Swap this one file if the logo
 * ever changes instead of editing every page.
 */
export function Logo({ size = 36, withWordmark = true, className }: LogoProps) {
  return (
    // the emblem-only variant is what the old per-page admin headers used; the admin shell hides those (see globals.css)
    <span className={clsx("flex items-center gap-2.5", className)} data-legacy-chrome={withWordmark ? undefined : ""}>
      <Image
        src="/logo.png"
        alt="SSC Prep Hub"
        width={size}
        height={size}
        priority
        className="rounded-xl ring-1 ring-border"
        style={{ width: size, height: size }}
      />
      {withWordmark && (
        <span className="text-[1.05rem] font-extrabold leading-none tracking-tight">
          SSC<span className="text-primary">PrepHub</span>
        </span>
      )}
    </span>
  );
}
