interface UserProfileProps {
  name: string;
  meta: string;
}

export default function UserProfile({ name, meta }: UserProfileProps) {
  return (
    <div className="flex items-center gap-3 rounded-lg bg-surface-muted px-3 py-1.5 shadow-soft">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-primary text-white">
        <svg
          xmlns="http://www.w3.org/2000/svg"
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
          <circle cx="12" cy="7" r="4" />
        </svg>
      </div>
      <div className="flex flex-col leading-tight">
        <span className="text-sm font-semibold text-foreground">{name}</span>
        <span className="text-xs text-muted-foreground">{meta}</span>
      </div>
    </div>
  );
}
