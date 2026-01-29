import React from "react";

type SurfaceProps = React.HTMLAttributes<HTMLElement> & {
  as?: React.ElementType;
  borderColor?: string;
};

const Surface: React.FC<SurfaceProps> = ({
  as: Component = "div",
  className = "",
  style,
  borderColor,
  ...rest
}) => {
  const mergedStyle = {
    backgroundColor: "var(--color-surface)",
    color: "var(--color-text)",
    borderColor: borderColor ?? "var(--color-border)",
    transition: "background-color 0.2s ease, border-color 0.2s ease, color 0.2s ease",
    ...style,
  };

  return (
    <Component
      className={`surface rounded-2xl border shadow-sm ${className}`}
      style={mergedStyle}
      {...rest}
    />
  );
};

export default Surface;
