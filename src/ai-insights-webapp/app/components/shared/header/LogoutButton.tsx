"use client";

export default function LogoutButton() {
  const handleLogout = () => {
    // TODO: wire up actual auth/session sign-out
  };

  return (
    <button
      type="button"
      onClick={handleLogout}
      className="flex h-9 items-center gap-2 rounded-md bg-surface px-3 text-sm font-medium text-foreground shadow-soft transition-[transform,box-shadow] hover:scale-105 hover:shadow-soft-hover"
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
        <polyline points="16 17 21 12 16 7" />
        <line x1="21" y1="12" x2="9" y2="12" />
      </svg>
      Logout
    </button>
  );
}
