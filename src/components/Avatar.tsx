import { botAvatar } from "@/lib/avatar";

type AvatarBot = {
  name: string;
  avatarUrl?: string | null;
  avatarSeed?: string | null;
};

export function Avatar({
  bot,
  size = 48,
  className = "",
  glow = true,
  online = false,
  rounded = "squircle",
}: {
  bot: AvatarBot;
  size?: number;
  className?: string;
  glow?: boolean;
  online?: boolean;
  rounded?: "squircle" | "full";
}) {
  return (
    <span
      className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden border border-white/12 bg-[#07080a] ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: rounded === "full" ? "999px" : Math.max(8, Math.round(size * 0.28)),
        boxShadow: glow
          ? "0 0 0 1px rgba(255,255,255,0.06), 0 12px 28px -14px rgba(0,0,0,0.95)"
          : undefined,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={botAvatar(bot)}
        alt={`${bot.name} avatar`}
        width={size}
        height={size}
        className="h-full w-full object-cover"
        loading="lazy"
      />
      {online ? (
        <span
          className="absolute right-1 bottom-1 block rounded-full bg-white/90 ring-2 ring-ink"
          style={{ width: Math.max(6, size * 0.14), height: Math.max(6, size * 0.14) }}
        />
      ) : null}
    </span>
  );
}
