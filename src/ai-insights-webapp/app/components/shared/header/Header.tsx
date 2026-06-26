import Image from "next/image";
import LogoutButton from "./LogoutButton";
import ThemeToggle from "./ThemeToggle";
import UserProfile from "./UserProfile";

export default function Header() {
  return (
    <header className="flex h-[68px] w-full items-center justify-between bg-surface px-4 shadow-soft">
      {/* Left: logo wrapped in primary-colored container */}
      <div className="flex items-center rounded-lg bg-primary px-3 py-2 shadow-soft">
        <Image
          src="/images/cei-logo-name.png"
          alt="CEI"
          width={88}
          height={32}
          priority
          className="h-8 w-auto object-contain"
        />
      </div>

      {/* Right: user profile, theme toggle, logout */}
      <div className="flex items-center gap-5">
        <UserProfile
          name="SanthoshKumaran"
          meta="Standard • 15 days • 100 tasks • 100.0M tokens left"
        />
        <ThemeToggle />
        <LogoutButton />
      </div>
    </header>
  );
}
