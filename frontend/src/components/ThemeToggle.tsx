import React from "react";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "../theme/ThemeProvider";

type ThemeToggleProps = {
  className?: string;
};

const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = "" }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  const combinedClassName = [
    "inline-flex items-center justify-center rounded-full border transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
    "border-amber-200 bg-white hover:bg-amber-50 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10",
    className,
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={combinedClassName}
    >
      <span className="sr-only">
        {isDark ? "Activate light mode" : "Activate dark mode"}
      </span>
      {isDark ? (
        <Sun className="w-5 h-5 text-amber-400" />
      ) : (
        <Moon className="w-5 h-5 text-amber-700" />
      )}
    </button>
  );
};

export default ThemeToggle;
