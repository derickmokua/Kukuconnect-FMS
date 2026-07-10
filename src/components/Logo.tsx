import Image from "next/image";

/**
 * Brand logo with transparent PNG + drop-shadow so it stays visible on light UI.
 */
export default function Logo({
  size = 80,
  className = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center justify-center shrink-0 ${className}`}
      style={{ width: size, height: size }}
    >
      <Image
        src="/logo_transparent.png?v=3"
        alt="KukuConnect"
        width={size}
        height={size}
        priority={priority}
        unoptimized
        className="object-contain w-full h-full drop-shadow-[0_1px_2px_rgba(0,0,0,0.12)]"
        style={{ background: "transparent" }}
      />
    </span>
  );
}
